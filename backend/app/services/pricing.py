from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import MenuItem, RecipeItem
from app.schemas import CostBreakdown, MenuItemOut, MenuListResponse
from app.services.kitchen import get_kitchen

MONEY = Decimal("0.01")
MARGIN = Decimal("0.1")
HUNDRED = Decimal("100")


def as_money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def as_margin_pct(profit: Decimal, price: Decimal) -> Decimal:
    if price == 0:
        return Decimal("0.0").quantize(MARGIN)
    return (profit / price * HUNDRED).quantize(MARGIN, rounding=ROUND_HALF_UP)


def margin_status(
    profit: Decimal, margin_pct: Decimal, target_margin_pct: Decimal
) -> Literal["loss", "below_target", "healthy"]:
    if profit < 0:
        return "loss"
    if margin_pct < target_margin_pct:
        return "below_target"
    return "healthy"


@dataclass(frozen=True)
class DishEconomics:
    ingredients: Decimal
    packaging: Decimal
    commission: Decimal
    overhead: Decimal
    total: Decimal
    profit: Decimal
    margin_pct: Decimal
    status: Literal["loss", "below_target", "healthy"]


def compute_dish_economics(
    *,
    price: Decimal,
    packaging_cost: Decimal,
    ingredient_lines: Iterable[tuple[Decimal, Decimal]],
    commission_pct: Decimal,
    overhead_pct: Decimal,
    target_margin_pct: Decimal,
) -> DishEconomics:
    ingredients = as_money(
        sum((qty * cost_per_unit for qty, cost_per_unit in ingredient_lines), Decimal("0"))
    )
    commission = as_money(price * commission_pct / HUNDRED)
    overhead = as_money(price * overhead_pct / HUNDRED)
    packaging = as_money(packaging_cost)
    total = as_money(ingredients + packaging + commission + overhead)
    profit = as_money(price - total)
    margin_pct = as_margin_pct(profit, price)
    status = margin_status(profit, margin_pct, target_margin_pct)
    return DishEconomics(
        ingredients=ingredients,
        packaging=packaging,
        commission=commission,
        overhead=overhead,
        total=total,
        profit=profit,
        margin_pct=margin_pct,
        status=status,
    )


def list_menu(db: Session) -> MenuListResponse:
    kitchen = get_kitchen(db)
    items = db.scalars(
        select(MenuItem)
        .where(MenuItem.kitchen_id == kitchen.id)
        .options(selectinload(MenuItem.recipe_items).selectinload(RecipeItem.ingredient))
        .order_by(MenuItem.name)
    ).all()

    data: list[MenuItemOut] = []
    for item in items:
        economics = compute_dish_economics(
            price=item.price,
            packaging_cost=item.packaging_cost,
            ingredient_lines=(
                (line.qty_per_portion, line.ingredient.cost_per_unit) for line in item.recipe_items
            ),
            commission_pct=kitchen.commission_pct,
            overhead_pct=kitchen.overhead_pct,
            target_margin_pct=kitchen.target_margin_pct,
        )
        data.append(
            MenuItemOut(
                id=item.id,
                name=item.name,
                price=as_money(item.price),
                cost_breakdown=CostBreakdown(
                    ingredients=economics.ingredients,
                    packaging=economics.packaging,
                    commission=economics.commission,
                    overhead=economics.overhead,
                    total=economics.total,
                ),
                profit_per_order=economics.profit,
                margin_pct=economics.margin_pct,
                margin_status=economics.status,
                is_active=item.is_active,
                data_source=item.data_source,
            )
        )
    return MenuListResponse(data=data, count=len(data))
