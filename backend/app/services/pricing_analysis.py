from decimal import ROUND_CEILING, Decimal
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.errors import AppError
from app.models import Ingredient, MenuItem, ProposedAction, RecipeItem
from app.services.kitchen import get_kitchen
from app.services.pricing import as_money, compute_dish_economics
from app.services.recovery import _fingerprint

FIVE = Decimal("5")
HUNDRED = Decimal("100")


def _economics(item, kitchen, price: Decimal):
    return compute_dish_economics(
        price=price,
        packaging_cost=item.packaging_cost,
        ingredient_lines=[
            (line.qty_per_portion, line.ingredient.cost_per_unit)
            for line in item.recipe_items
        ],
        commission_pct=kitchen.commission_pct,
        overhead_pct=kitchen.overhead_pct,
        target_margin_pct=kitchen.target_margin_pct,
    )


def analyze_price(
    db: Session,
    menu_item_id: UUID,
    price: Decimal | None,
    *,
    propose_change: bool = False,
) -> dict:
    kitchen = get_kitchen(db)
    item = db.scalar(
        select(MenuItem)
        .where(MenuItem.id == menu_item_id, MenuItem.kitchen_id == kitchen.id)
        .options(selectinload(MenuItem.recipe_items).selectinload(RecipeItem.ingredient))
    )
    if item is None:
        raise AppError(404, "MENU_ITEM_NOT_FOUND", "Menu item not found")

    if price is not None and price <= 0:
        raise AppError(422, "VALIDATION_ERROR", "price must be greater than 0")

    current_price = as_money(item.price)
    analyzed_price = as_money(price) if price is not None else current_price
    now = _economics(item, kitchen, analyzed_price)

    # suggested = (ingredients + packaging) / (1 - commission% - overhead% - target%),
    # rounded up to the next 5 rupees
    denominator = Decimal(1) - (
        kitchen.commission_pct + kitchen.overhead_pct + kitchen.target_margin_pct
    ) / HUNDRED
    if denominator <= 0:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "Commission, overhead and target margin leave no room for a price",
        )
    raw = (now.ingredients + now.packaging) / denominator
    suggested_price = as_money((raw / FIVE).to_integral_value(rounding=ROUND_CEILING) * FIVE)
    sug = _economics(item, kitchen, suggested_price)

    response = {
        "menu_item_id": item.id,
        "name": item.name,
        "analyzed_price": float(analyzed_price),
        "current_price": float(current_price),
        "cost_breakdown": {
            "ingredients": float(now.ingredients),
            "packaging": float(now.packaging),
            "commission": float(now.commission),
            "overhead": float(now.overhead),
            "total": float(now.total),
        },
        "profit_per_order": float(now.profit),
        "margin_pct": float(now.margin_pct),
        "margin_status": now.status,
        "suggested_price": float(suggested_price),
        "suggested_profit_per_order": float(sug.profit),
        "suggested_margin_pct": float(sug.margin_pct),
        "assumptions": {
            "commission_pct": float(kitchen.commission_pct),
            "overhead_pct": float(kitchen.overhead_pct),
            "target_margin_pct": float(kitchen.target_margin_pct),
            "data_source": item.data_source,
        },
        "action": None,
    }
    if propose_change:
        before = _economics(item, kitchen, current_price)
        now_utc = datetime.now(timezone.utc)
        ingredients = db.scalars(
            select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)
        ).all()
        action = ProposedAction(
            id=uuid4(),
            kitchen_id=kitchen.id,
            group_id=uuid4(),
            option_number=1,
            action_type="price_change",
            title=f"Set {item.name} price to ₹{suggested_price:.2f}",
            payload={
                "menu_item_id": str(item.id),
                "old_price": str(current_price),
                "new_price": str(suggested_price),
            },
            impact={
                "profit_per_order_before": float(before.profit),
                "profit_per_order_after": float(sug.profit),
            },
            status="pending",
            base_plan_version=kitchen.plan_version,
            stock_fingerprint=_fingerprint(ingredients),
            created_at=now_utc,
            expires_at=now_utc + timedelta(minutes=settings.recovery_action_ttl_minutes),
        )
        db.add(action)
        db.flush()
        response["action"] = {
            "id": action.id,
            "group_id": action.group_id,
            "option_number": action.option_number,
            "action_type": action.action_type,
            "title": action.title,
            "status": action.status,
            "impact": action.impact,
            "expires_at": action.expires_at,
        }
    return response
