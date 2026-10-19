from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import MenuItem, RecipeItem
from app.services.kitchen import get_kitchen
from app.services.pricing import compute_dish_economics, list_menu


def test_paneer_biryani_at_180():
    result = compute_dish_economics(
        price=Decimal("180.00"),
        packaging_cost=Decimal("14.00"),
        ingredient_lines=(
            (Decimal("0.150"), Decimal("380.00")),
            (Decimal("0.120"), Decimal("110.00")),
            (Decimal("0.050"), Decimal("40.00")),
        ),
        commission_pct=Decimal("20.00"),
        overhead_pct=Decimal("12.00"),
        target_margin_pct=Decimal("25.00"),
    )
    assert result.ingredients == Decimal("72.20")
    assert result.packaging == Decimal("14.00")
    assert result.commission == Decimal("36.00")
    assert result.overhead == Decimal("21.60")
    assert result.total == Decimal("143.80")
    assert result.profit == Decimal("36.20")
    assert result.margin_pct == Decimal("20.1")
    assert result.status == "below_target"


def test_margin_status_loss_and_healthy():
    loss = compute_dish_economics(
        price=Decimal("10.00"),
        packaging_cost=Decimal("14.00"),
        ingredient_lines=(),
        commission_pct=Decimal("20.00"),
        overhead_pct=Decimal("12.00"),
        target_margin_pct=Decimal("25.00"),
    )
    assert loss.profit < 0
    assert loss.status == "loss"

    healthy = compute_dish_economics(
        price=Decimal("220.00"),
        packaging_cost=Decimal("16.00"),
        ingredient_lines=(
            (Decimal("0.120"), Decimal("380.00")),
            (Decimal("0.080"), Decimal("40.00")),
        ),
        commission_pct=Decimal("20.00"),
        overhead_pct=Decimal("12.00"),
        target_margin_pct=Decimal("25.00"),
    )
    assert healthy.total == Decimal("135.20")
    assert healthy.profit == Decimal("84.80")
    assert healthy.margin_pct == Decimal("38.5")
    assert healthy.status == "healthy"


def test_list_menu_paneer_biryani_from_seed(db_session):
    kitchen = get_kitchen(db_session)
    item = db_session.scalars(
        select(MenuItem)
        .where(MenuItem.name == "Paneer Biryani")
        .options(selectinload(MenuItem.recipe_items).selectinload(RecipeItem.ingredient))
    ).one()
    result = compute_dish_economics(
        price=item.price,
        packaging_cost=item.packaging_cost,
        ingredient_lines=(
            (line.qty_per_portion, line.ingredient.cost_per_unit) for line in item.recipe_items
        ),
        commission_pct=kitchen.commission_pct,
        overhead_pct=kitchen.overhead_pct,
        target_margin_pct=kitchen.target_margin_pct,
    )
    assert result.total == Decimal("143.80")
    assert result.profit == Decimal("36.20")
    assert result.margin_pct == Decimal("20.1")

    menu = list_menu(db_session)
    biryani = next(row for row in menu.data if row.name == "Paneer Biryani")
    assert biryani.cost_breakdown.total == Decimal("143.80")
    assert biryani.profit_per_order == Decimal("36.20")
    assert biryani.margin_pct == Decimal("20.1")
    assert biryani.margin_status == "below_target"
