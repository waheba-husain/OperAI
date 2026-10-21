import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.errors import AppError
from app.models import (
    Ingredient,
    Kitchen,
    MenuItem,
    Order,
    OrderItem,
    PlanTask,
    ProposedAction,
    RecipeItem,
    Substitution,
)
from app.schemas import (
    ProposedActionListResponse,
    ProposedActionOut,
    RecoveryBaseline,
    RecoveryImpact,
    RecoveryOption,
    RecoveryProposeResponse,
    RecoveryScoring,
    RecoveryShortage,
    RecoveryWeights,
)
from app.services.kitchen import get_kitchen
from app.services.pricing import compute_dish_economics
from app.timeutil import IST, day_bounds

ZERO = Decimal("0")
HUNDRED = Decimal("100")


def _fingerprint(ingredients: list[Ingredient]) -> str:
    stock = [(str(row.id), str(row.stock_qty)) for row in sorted(ingredients, key=lambda r: str(r.id))]
    return hashlib.sha256(json.dumps(stock, separators=(",", ":")).encode()).hexdigest()


def _order_required(order: Order, ingredient_id: UUID) -> Decimal:
    return sum(
        (
            ri.qty_per_portion * item.quantity
            for item in order.items
            for ri in item.menu_item.recipe_items
            if ri.ingredient_id == ingredient_id
        ),
        ZERO,
    )


def _order_economics(order: Order, kitchen: Kitchen) -> tuple[Decimal, Decimal]:
    revenue = ZERO
    profit = ZERO
    for item in order.items:
        menu = item.menu_item
        economics = compute_dish_economics(
            price=item.unit_price,
            packaging_cost=menu.packaging_cost,
            ingredient_lines=(
                (ri.qty_per_portion, ri.ingredient.cost_per_unit)
                for ri in menu.recipe_items
            ),
            commission_pct=kitchen.commission_pct,
            overhead_pct=kitchen.overhead_pct,
            target_margin_pct=kitchen.target_margin_pct,
        )
        revenue += item.unit_price * item.quantity
        profit += economics.profit * item.quantity
    return revenue, profit


def _menu_total_cost(menu: MenuItem, unit_price: Decimal, kitchen: Kitchen) -> Decimal:
    return compute_dish_economics(
        price=unit_price,
        packaging_cost=menu.packaging_cost,
        ingredient_lines=(
            (ri.qty_per_portion, ri.ingredient.cost_per_unit) for ri in menu.recipe_items
        ),
        commission_pct=kitchen.commission_pct,
        overhead_pct=kitchen.overhead_pct,
        target_margin_pct=kitchen.target_margin_pct,
    ).total


def _orders_for_day(db: Session, kitchen_id: UUID, target_date: date) -> list[Order]:
    start, end = day_bounds(target_date)
    return db.scalars(
        select(Order)
        .where(
            Order.kitchen_id == kitchen_id,
            Order.deadline >= start,
            Order.deadline < end,
            Order.status.not_in(["cancelled", "completed"]),
        )
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.menu_item)
            .selectinload(MenuItem.recipe_items)
            .selectinload(RecipeItem.ingredient)
        )
        .order_by(Order.deadline, Order.created_at, Order.id)
    ).all()


def _is_substitution_compatible(original: Ingredient, substitute: Ingredient) -> bool:
    # Keep every diet claim on the original ingredient; any new allergen is surfaced
    # as a customer-consent requirement on the option rather than silently ignored.
    return set(original.diet_tags).issubset(set(substitute.diet_tags))


def _option_impact(
    *,
    baseline_late: int,
    baseline_revenue: Decimal,
    protected_orders: list[Order],
    extra_cost: Decimal,
    risk_level: str,
    baseline_margin: Decimal,
) -> RecoveryImpact:
    protected_revenue = sum((order.total_amount for order in protected_orders), ZERO)
    after_revenue = max(ZERO, baseline_revenue - protected_revenue)
    late_after = max(0, baseline_late - len(protected_orders))
    margin_score = max(ZERO, min(Decimal("1"), Decimal("1") - extra_cost / baseline_revenue)) if baseline_revenue else ZERO
    risk_score = {"low": Decimal("0.2"), "medium": Decimal("0.5"), "high": Decimal("0.8")}[risk_level]
    score = (
        settings.recovery_lateness_weight * (Decimal("1") - Decimal(late_after) / Decimal(baseline_late))
        + settings.recovery_margin_weight * margin_score
        + settings.recovery_customer_risk_weight * (Decimal("1") - risk_score)
    ) if baseline_late else ZERO
    after_margin = baseline_margin
    if baseline_revenue:
        after_margin = baseline_margin - extra_cost / baseline_revenue * HUNDRED
    return RecoveryImpact(
        late_orders=late_after,
        orders_protected=len(protected_orders),
        revenue_at_risk_after=after_revenue,
        extra_cost=extra_cost.quantize(Decimal("0.01")),
        margin_before_pct=baseline_margin.quantize(Decimal("0.1")),
        margin_after_pct=after_margin.quantize(Decimal("0.1")),
        customer_risk=risk_level,
        score=score.quantize(Decimal("0.01")),
    )


def propose_recovery(
    db: Session,
    *,
    target_date: date,
    ingredient_id: UUID,
    reported_available_qty: Decimal | None = None,
) -> RecoveryProposeResponse:
    kitchen = get_kitchen(db)
    start, end = day_bounds(target_date)
    has_plan = db.scalar(
        select(PlanTask.id).where(
            PlanTask.kitchen_id == kitchen.id,
            PlanTask.start_at >= start,
            PlanTask.start_at < end,
            PlanTask.status != "cancelled",
        ).limit(1)
    )
    if has_plan is None:
        raise AppError(404, "PLAN_NOT_FOUND", "No plan found for the requested date", {"date": target_date.isoformat()})

    ingredient = db.scalar(
        select(Ingredient).where(Ingredient.id == ingredient_id, Ingredient.kitchen_id == kitchen.id)
    )
    if ingredient is None:
        raise AppError(404, "INGREDIENT_NOT_FOUND", "Ingredient not found", {"ingredient_id": str(ingredient_id)})

    effective_stock = ingredient.stock_qty if reported_available_qty is None else reported_available_qty
    orders = _orders_for_day(db, kitchen.id, target_date)
    if not orders:
        raise AppError(404, "PLAN_NOT_FOUND", "No plan found for the requested date", {"date": target_date.isoformat()})
    total_needed = sum((_order_required(order, ingredient.id) for order in orders), ZERO)
    short_by = total_needed - effective_stock
    if short_by <= ZERO:
        raise AppError(409, "NO_SHORTAGE_DETECTED", "Stock covers the day's needs", {"ingredient_id": str(ingredient.id)})

    remaining_stock = effective_stock
    at_risk: list[Order] = []
    for order in orders:
        need = _order_required(order, ingredient.id)
        if need > remaining_stock:
            at_risk.append(order)
        else:
            remaining_stock -= need
    baseline_revenue = sum((order.total_amount for order in at_risk), ZERO)
    baseline_profit = sum((_order_economics(order, kitchen)[1] for order in at_risk), ZERO)
    baseline_margin = (baseline_profit / baseline_revenue * HUNDRED) if baseline_revenue else ZERO
    baseline = RecoveryBaseline(late_orders=len(at_risk), revenue_at_risk=baseline_revenue)
    group_id = uuid4()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.recovery_action_ttl_minutes)
    fingerprint = _fingerprint(db.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all())
    stock_update = {"ingredient_id": str(ingredient.id), "reported_available_qty": str(reported_available_qty)} if reported_available_qty is not None else None

    candidates: list[tuple[str, str, bool, dict, RecoveryImpact]] = []

    substitutions = db.execute(
        select(Substitution, Ingredient)
        .join(Ingredient, Ingredient.id == Substitution.substitute_ingredient_id)
        .where(
            Substitution.kitchen_id == kitchen.id,
            Substitution.ingredient_id == ingredient.id,
            Substitution.is_active.is_(True),
        )
        .order_by(Substitution.id)
    ).all()
    original = ingredient
    for substitution, replacement in substitutions:
        if not _is_substitution_compatible(original, replacement):
            continue
        qty_needed = short_by * substitution.ratio
        if replacement.stock_qty < qty_needed:
            continue
        protected = [o for o in at_risk if _order_required(o, ingredient.id) > ZERO]
        extra_cost = (
            qty_needed * replacement.cost_per_unit
            - short_by * ingredient.cost_per_unit
        )
        added_allergens = set(replacement.allergen_tags) - set(original.allergen_tags)
        consent = substitution.needs_consent or bool(added_allergens)
        impact = _option_impact(
            baseline_late=len(at_risk), baseline_revenue=baseline_revenue,
            protected_orders=protected, extra_cost=extra_cost, risk_level="medium",
            baseline_margin=baseline_margin,
        )
        candidates.append(("substitute", f"Use {replacement.name} instead of {ingredient.name} in {len(protected)} orders", consent,
                           {"option_type": "substitute", "ingredient_id": str(ingredient.id), "substitute_ingredient_id": str(replacement.id),
                            "quantity": str(qty_needed), "order_ids": [str(o.id) for o in protected]}, impact))

    purchase_cost = short_by * ingredient.cost_per_unit * settings.recovery_emergency_purchase_premium
    impacted_ids = {o.id for o in at_risk}
    latest_by_order: dict[UUID, datetime] = {}
    locked_order_ids: set[UUID] = set()
    task_rows = db.execute(
        select(PlanTask, OrderItem.order_id)
        .join(OrderItem, PlanTask.order_item_id == OrderItem.id)
        .where(
            OrderItem.order_id.in_(impacted_ids),
            PlanTask.status != "cancelled",
        )
    ).all()
    for task, order_id in task_rows:
        if task.locked:
            locked_order_ids.add(order_id)
        end_at = task.end_at
        if end_at.tzinfo is None:
            end_at = end_at.replace(tzinfo=IST)
        latest_by_order[order_id] = max(latest_by_order.get(order_id, end_at), end_at)
    delay = timedelta(minutes=settings.recovery_emergency_delay_minutes)
    now = datetime.now(IST)
    purchased: list[Order] = []
    for order in at_risk:
        if order.id in locked_order_ids:
            continue
        deadline = order.deadline
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=IST)
        latest_task_end = latest_by_order.get(order.id)
        completion_with_delay = (latest_task_end if latest_task_end is not None else now) + delay
        if completion_with_delay <= deadline:
            purchased.append(order)
    if purchased:
        purchase_impact = _option_impact(
            baseline_late=len(at_risk), baseline_revenue=baseline_revenue,
            protected_orders=purchased, extra_cost=purchase_cost, risk_level="low",
            baseline_margin=baseline_margin,
        )
        candidates.append(("emergency_purchase", f"Buy {short_by} {ingredient.unit} of {ingredient.name}; delay affected orders by {settings.recovery_emergency_delay_minutes} min",
                           True, {"option_type": "emergency_purchase", "ingredient_id": str(ingredient.id),
                            "quantity": str(short_by), "delay_minutes": settings.recovery_emergency_delay_minutes,
                            "order_ids": [str(o.id) for o in purchased]}, purchase_impact))

    # A swap candidate must be active, within 20% of the original price and fully in stock.
    menu_rows = db.scalars(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.is_active.is_(True))
        .options(selectinload(MenuItem.recipe_items).selectinload(RecipeItem.ingredient))
    ).all()
    swap_protected: list[Order] = []
    swap_payload: list[dict] = []
    swap_extra_cost = ZERO
    stock_copy = {i.id: i.stock_qty for i in db.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()}
    for order in at_risk:
        local_stock = dict(stock_copy)
        local_swaps: list[dict] = []
        local_extra_cost = ZERO
        can_swap_order = True
        for order_item in order.items:
            if not any(ri.ingredient_id == ingredient.id for ri in order_item.menu_item.recipe_items):
                continue
            options = []
            for menu in menu_rows:
                if menu.id == order_item.menu_item_id or not menu.recipe_items:
                    continue
                if abs(menu.price - order_item.unit_price) > order_item.unit_price * Decimal("0.2"):
                    continue
                required = [(ri.ingredient_id, ri.qty_per_portion * order_item.quantity) for ri in menu.recipe_items]
                if all(local_stock.get(iid, ZERO) >= qty for iid, qty in required):
                    options.append((abs(menu.price - order_item.unit_price), menu.name, menu, required))
            if options:
                _, _, selected, required = min(options, key=lambda row: (row[0], row[1]))
                for iid, qty in required:
                    local_stock[iid] -= qty
                local_swaps.append({"order_item_id": str(order_item.id), "menu_item_id": str(selected.id)})
                local_extra_cost += (
                    _menu_total_cost(selected, order_item.unit_price, kitchen)
                    - _menu_total_cost(order_item.menu_item, order_item.unit_price, kitchen)
                ) * order_item.quantity
            else:
                can_swap_order = False
                break
        if can_swap_order and local_swaps:
            stock_copy = local_stock
            swap_payload.extend(local_swaps)
            swap_extra_cost += local_extra_cost
            swap_protected.append(order)
    if swap_protected:
        # De-duplicate orders if more than one affected line was replaced.
        swap_protected = list({o.id: o for o in swap_protected}.values())
        swap_impact = _option_impact(
            baseline_late=len(at_risk), baseline_revenue=baseline_revenue,
            protected_orders=swap_protected, extra_cost=swap_extra_cost, risk_level="high",
            baseline_margin=baseline_margin,
        )
        candidates.append(("dish_swap", f"Swap {len(swap_protected)} at-risk orders to in-stock dishes", True,
                           {"option_type": "dish_swap", "swaps": swap_payload}, swap_impact))

    candidates.sort(key=lambda candidate: candidate[4].score, reverse=True)
    response_options: list[RecoveryOption] = []
    for number, (kind, title, consent, payload, impact) in enumerate(candidates, start=1):
        if stock_update is not None:
            payload["stock_update"] = stock_update
        stored_impact = impact.model_dump(mode="json")
        # Keep the do-nothing baseline with the proposal so day summaries can
        # calculate protected revenue from the same simulation after approval.
        stored_impact["revenue_at_risk_without_action"] = float(baseline_revenue)
        action = ProposedAction(
            id=uuid4(), kitchen_id=kitchen.id, group_id=group_id, option_number=number,
            action_type="recovery", title=title, payload=payload,
            impact=stored_impact, status="pending",
            base_plan_version=kitchen.plan_version, stock_fingerprint=fingerprint,
            created_at=now, expires_at=expires_at,
        )
        db.add(action)
        response_options.append(RecoveryOption(
            action_id=action.id, option_number=number, option_type=kind, title=title,
            status="pending", needs_customer_consent=consent, impact=impact,
            expires_at=expires_at,
        ))
    db.flush()
    return RecoveryProposeResponse(
        group_id=group_id,
        shortage=RecoveryShortage(ingredient_id=ingredient.id, name=ingredient.name, short_by=short_by, unit=ingredient.unit),
        baseline=baseline,
        scoring=RecoveryScoring(weights=RecoveryWeights(
            lateness=settings.recovery_lateness_weight, margin=settings.recovery_margin_weight,
            customer_risk=settings.recovery_customer_risk_weight,
        )),
        recommended_option_number=1 if response_options else None,
        options=response_options,
        escalation=None if response_options else "No feasible option found. Contact customers or restock.",
    )


def list_actions(
    db: Session,
    *,
    status: str | None = None,
    group_id: UUID | None = None,
    limit: int = 50,
) -> ProposedActionListResponse:
    kitchen = get_kitchen(db)
    query = select(ProposedAction).where(ProposedAction.kitchen_id == kitchen.id)
    if status is not None:
        query = query.where(ProposedAction.status == status)
    if group_id is not None:
        query = query.where(ProposedAction.group_id == group_id)
    actions = db.scalars(query.order_by(ProposedAction.created_at.desc(), ProposedAction.option_number).limit(limit)).all()
    return ProposedActionListResponse(
        data=[ProposedActionOut(
            id=row.id, group_id=row.group_id, option_number=row.option_number, action_type=row.action_type,
            title=row.title, status=row.status, impact=row.impact, base_plan_version=row.base_plan_version,
            created_at=row.created_at, expires_at=row.expires_at,
        ) for row in actions],
        count=len(actions),
    )
