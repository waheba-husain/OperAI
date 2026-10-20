from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Ingredient, MenuItem, Order, OrderItem, RecipeItem
from app.schemas import AtRiskOrderOut, BriefResponse, ShortageOut
from app.services.kitchen import get_kitchen
from app.services.pricing import as_money
from app.timeutil import IST, day_bounds


def get_risk_brief(
    db: Session,
    *,
    target_date: date | None = None,
) -> BriefResponse:
    """
    Deterministic risk brief service (Feature 3).
    Compares the day's recipe needs against available stock and identifies:
      1. Shortages (needed_qty > stock_qty)
      2. At-risk orders (orders walked by deadline against running stock; non-coverable orders are marked at-risk and not deducted)
      3. Revenue at risk (sum of total_amount of at-risk orders)

    Read-only: does not modify or commit any database records.
    """
    if target_date is None:
        target_date = (datetime.now(IST) + timedelta(days=1)).date()

    kitchen = get_kitchen(db)
    date_str = target_date.isoformat()
    start_bound, end_bound = day_bounds(target_date)

    # 1. Query active orders for the day, ordered deterministically by deadline, created_at, id
    orders = db.scalars(
        select(Order)
        .where(
            Order.kitchen_id == kitchen.id,
            Order.deadline >= start_bound,
            Order.deadline < end_bound,
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

    order_count = len(orders)

    # Early exit if no active orders exist for the date
    if order_count == 0:
        return BriefResponse(
            date=date_str,
            order_count=0,
            shortages=[],
            at_risk_orders=[],
            revenue_at_risk=as_money(Decimal("0.00")),
            data_source=kitchen.data_source,
        )

    # 2. Query all kitchen ingredients
    kitchen_ingredients = db.scalars(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)
    ).all()
    stock_map = {ing.id: ing for ing in kitchen_ingredients}

    # 3. Calculate gross ingredient demand across all selected orders
    total_needed: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0.000"))
    for order in orders:
        for item in order.items:
            for r in item.menu_item.recipe_items:
                total_needed[r.ingredient_id] += Decimal(item.quantity) * r.qty_per_portion

    # 4. Identify shortages: needed_qty > stock_qty
    shortages: list[ShortageOut] = []
    for ing_id, needed_qty in total_needed.items():
        ing = stock_map.get(ing_id)
        if ing is None:
            continue
        if needed_qty > ing.stock_qty:
            short_by = needed_qty - ing.stock_qty
            shortages.append(
                ShortageOut(
                    ingredient_id=ing.id,
                    name=ing.name,
                    unit=ing.unit,
                    stock_qty=ing.stock_qty,
                    needed_qty=needed_qty,
                    short_by=short_by,
                )
            )
    shortages.sort(key=lambda s: s.name)

    # 5. Identify at-risk orders by walking orders in chronological order against running stock
    # ponytail: in-memory balance walk; fine for ~20-30 orders; upgrade path: batch/priority knapsack if order volume scales
    running_stock: dict[UUID, Decimal] = {
        ing.id: Decimal(str(ing.stock_qty)) for ing in kitchen_ingredients
    }

    at_risk_orders: list[AtRiskOrderOut] = []
    for order in orders:
        # Calculate requirements across all items of this order first
        order_reqs: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0.000"))
        for item in order.items:
            for r in item.menu_item.recipe_items:
                order_reqs[r.ingredient_id] += Decimal(item.quantity) * r.qty_per_portion

        can_fulfill = True
        for ing_id, req_qty in order_reqs.items():
            if running_stock.get(ing_id, Decimal("0.000")) < req_qty:
                can_fulfill = False
                break

        if can_fulfill:
            # Safe order: deduct requirements from running stock
            for ing_id, req_qty in order_reqs.items():
                running_stock[ing_id] -= req_qty
        else:
            # At-risk order: do NOT deduct any ingredient requirements from running stock
            at_risk_orders.append(
                AtRiskOrderOut(
                    order_id=order.id,
                    customer_name=order.customer_name,
                    deadline=order.deadline,
                    total_amount=as_money(order.total_amount),
                )
            )

    # 6. Revenue at risk is sum of total_amount of all at-risk orders
    revenue_at_risk = as_money(
        sum((order.total_amount for order in at_risk_orders), Decimal("0.00"))
    )

    return BriefResponse(
        date=date_str,
        order_count=order_count,
        shortages=shortages,
        at_risk_orders=at_risk_orders,
        revenue_at_risk=revenue_at_risk,
        data_source=kitchen.data_source,
    )
