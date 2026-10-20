from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import get_db
from app.main import app
from app.models import Base, Ingredient, Kitchen, MenuItem, Order, OrderItem, PlanTask, RecipeItem
from app.services.risk import get_risk_brief
from app.timeutil import IST



# Allow SQLite to compile PostgreSQL ARRAY types for in-memory testing
@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"


sqlite3.register_adapter(list, lambda l: str(l))



@pytest.fixture
def seed_session():
    """Sets up an in-memory SQLite database matching backend/seed/seed.py exactly."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSessionLocal()

    # 1. Kitchen
    kitchen = Kitchen(
        id=uuid4(),
        name="Demo Kitchen",
        burner_count=3,
        cook_count=2,
        overhead_pct=Decimal("12.00"),
        commission_pct=Decimal("20.00"),
        target_margin_pct=Decimal("25.00"),
        plan_version=1,
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    session.add(kitchen)

    # 2. Ingredients from seed.py
    ing_defs = [
        ("paneer", "Paneer", "kg", Decimal("1.000"), Decimal("380.00")),
        ("tofu", "Tofu", "kg", Decimal("3.000"), Decimal("220.00")),
        ("rice", "Basmati rice", "kg", Decimal("12.000"), Decimal("110.00")),
        ("veg", "Mixed vegetables", "kg", Decimal("6.000"), Decimal("60.00")),
        ("onion", "Onion", "kg", Decimal("8.000"), Decimal("40.00")),
    ]
    ings: dict[str, Ingredient] = {}
    for key, name, unit, stock, cost in ing_defs:
        ing = Ingredient(
            id=uuid4(),
            kitchen_id=kitchen.id,
            name=name,
            unit=unit,
            stock_qty=stock,
            cost_per_unit=cost,
            allergen_tags=[],
            diet_tags=["veg"],
            data_source="simulated",
            updated_at=datetime.now(timezone.utc),
        )
        session.add(ing)
        ings[key] = ing

    # 3. Dishes & recipes from seed.py
    dish_defs = [
        ("B", "Paneer Biryani", Decimal("180.00"), Decimal("14.00"), 15, 35, {"paneer": Decimal("0.150"), "rice": Decimal("0.120"), "onion": Decimal("0.050")}),
        ("P", "Paneer Butter Masala", Decimal("220.00"), Decimal("16.00"), 10, 25, {"paneer": Decimal("0.120"), "onion": Decimal("0.080")}),
        ("V", "Veg Pulao", Decimal("150.00"), Decimal("12.00"), 10, 25, {"rice": Decimal("0.120"), "veg": Decimal("0.100"), "onion": Decimal("0.040")}),
        ("VB", "Veg Biryani", Decimal("160.00"), Decimal("14.00"), 15, 35, {"rice": Decimal("0.120"), "veg": Decimal("0.120"), "onion": Decimal("0.050")}),
        ("J", "Jeera Rice", Decimal("90.00"), Decimal("8.00"), 5, 20, {"rice": Decimal("0.150")}),
    ]
    dishes: dict[str, MenuItem] = {}
    for key, name, price, pack, prep, cook, recipe in dish_defs:
        menu_item = MenuItem(
            id=uuid4(),
            kitchen_id=kitchen.id,
            name=name,
            price=price,
            packaging_cost=pack,
            prep_minutes=prep,
            cook_minutes=cook,
            is_active=True,
            data_source="simulated",
        )
        session.add(menu_item)
        dishes[key] = menu_item
        for ikey, qty in recipe.items():
            session.add(
                RecipeItem(
                    id=uuid4(),
                    menu_item_id=menu_item.id,
                    ingredient_id=ings[ikey].id,
                    qty_per_portion=qty,
                )
            )

    # 4. 25 Orders from seed.py for 2026-10-17
    orders_data = [
        ("11:00", "Customer A", "whatsapp", [("B", 2)]),
        ("11:10", "Customer B", "swiggy", [("V", 1)]),
        ("11:20", "Customer C", "whatsapp", [("P", 1)]),
        ("11:30", "Customer D", "instagram", [("J", 2)]),
        ("11:40", "Customer E", "zomato", [("B", 1)]),
        ("11:50", "Customer F", "whatsapp", [("VB", 1)]),
        ("12:00", "Customer G", "direct", [("P", 2)]),
        ("12:10", "Customer H", "swiggy", [("V", 2)]),
        ("12:20", "Customer I", "whatsapp", [("B", 1)]),
        ("12:30", "Customer J", "zomato", [("J", 1)]),
        ("12:40", "Customer K", "whatsapp", [("B", 1), ("P", 1)]),
        ("12:50", "Customer L", "swiggy", [("VB", 2)]),
        ("13:00", "Customer M", "direct", [("B", 2)]),
        ("13:10", "Customer N", "whatsapp", [("V", 2)]),
        ("13:20", "Customer O", "instagram", [("J", 3)]),
        ("13:30", "Customer P", "zomato", [("P", 1), ("B", 1)]),
        ("13:40", "Customer Q", "whatsapp", [("VB", 1)]),
        ("13:50", "Customer R", "swiggy", [("V", 1)]),
        ("14:00", "Customer S", "direct", [("P", 1)]),
        ("14:10", "Customer T", "whatsapp", [("J", 2)]),
        ("14:20", "Customer U", "zomato", [("VB", 2)]),
        ("14:30", "Customer V", "swiggy", [("V", 2)]),
        ("14:40", "Customer W", "whatsapp", [("J", 1)]),
        ("14:50", "Customer X", "direct", [("VB", 1)]),
        ("15:00", "Customer Y", "instagram", [("V", 1)]),
    ]

    for n, (hhmm, customer, channel, items) in enumerate(orders_data, start=1):
        h, m = map(int, hhmm.split(":"))
        deadline = datetime(2026, 10, 17, h, m, tzinfo=IST)
        created_at = datetime(2026, 10, 16, 9, 0, tzinfo=IST) + timedelta(minutes=n)
        total = sum(dishes[d].price * q for d, q in items)
        order = Order(
            id=uuid4(),
            kitchen_id=kitchen.id,
            customer_name=customer,
            customer_phone=f"9198000{n:05d}",
            channel=channel,
            deadline=deadline,
            status="new",
            total_amount=total,
            data_source="simulated",
            created_at=created_at,
        )
        session.add(order)
        for d, q in items:
            session.add(
                OrderItem(
                    id=uuid4(),
                    order_id=order.id,
                    menu_item_id=dishes[d].id,
                    quantity=q,
                    unit_price=dishes[d].price,
                )
            )

    session.commit()
    yield session
    session.close()


@pytest.fixture
def client(seed_session: Session):
    def override_get_db():
        yield seed_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        test_client.headers["X-API-Key"] = settings.api_key
        yield test_client
    app.dependency_overrides.clear()



# 1. Existing seeded scenario for 2026-10-17
def test_risk_brief_seeded_scenario(seed_session: Session):
    brief = get_risk_brief(seed_session, target_date=date(2026, 10, 17))

    assert brief.date == "2026-10-17"
    assert brief.order_count == 25
    assert brief.data_source == "simulated"

    # Paneer is the only short ingredient
    assert len(brief.shortages) == 1
    paneer_shortage = brief.shortages[0]
    assert paneer_shortage.name == "Paneer"
    assert paneer_shortage.unit == "kg"
    assert paneer_shortage.stock_qty == Decimal("1.000")
    assert paneer_shortage.needed_qty == Decimal("1.920")
    assert paneer_shortage.short_by == Decimal("0.920")

    # Exactly 4 orders are at risk: Customers K, M, P, and S
    assert len(brief.at_risk_orders) == 4
    at_risk_names = [o.customer_name for o in brief.at_risk_orders]
    assert at_risk_names == ["Customer K", "Customer M", "Customer P", "Customer S"]

    # Revenue at risk: 400 + 360 + 400 + 220 = 1380.00
    assert brief.revenue_at_risk == Decimal("1380.00")


# 2. An order that can be fulfilled with available stock is not marked at risk
def test_order_fulfillable_with_stock(seed_session: Session):
    brief = get_risk_brief(seed_session, target_date=date(2026, 10, 17))
    at_risk_names = {o.customer_name for o in brief.at_risk_orders}

    # Customers A, C, E, G, I consume paneer and are early enough to be fully covered
    assert "Customer A" not in at_risk_names
    assert "Customer C" not in at_risk_names
    assert "Customer E" not in at_risk_names
    assert "Customer G" not in at_risk_names
    assert "Customer I" not in at_risk_names


# 3. An order that cannot be fulfilled because one ingredient is insufficient
def test_order_unfulfillable_due_to_shortage(seed_session: Session):
    brief = get_risk_brief(seed_session, target_date=date(2026, 10, 17))
    at_risk_names = [o.customer_name for o in brief.at_risk_orders]

    # Customer K needs 0.270 kg paneer at 12:40, but only 0.040 kg remains
    assert "Customer K" in at_risk_names
    k_order = next(o for o in brief.at_risk_orders if o.customer_name == "Customer K")
    assert k_order.total_amount == Decimal("400.00")


# 4. Multi-ingredient order: if one ingredient is insufficient, NONE of the ingredients are deducted
def test_multi_ingredient_no_deduction_on_shortage(seed_session: Session):
    kitchen = seed_session.scalars(select(Kitchen)).first()

    # Create two test ingredients
    ing_a = Ingredient(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="IngA_Rare",
        unit="kg",
        stock_qty=Decimal("1.000"),
        cost_per_unit=Decimal("100.00"),
        allergen_tags=[],
        diet_tags=["veg"],
        data_source="simulated",
        updated_at=datetime.now(timezone.utc),
    )
    ing_b = Ingredient(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="IngB_Plentiful",
        unit="kg",
        stock_qty=Decimal("10.000"),
        cost_per_unit=Decimal("50.00"),
        allergen_tags=[],
        diet_tags=["veg"],
        data_source="simulated",
        updated_at=datetime.now(timezone.utc),
    )
    seed_session.add_all([ing_a, ing_b])

    # Dish needing both IngA (2 kg) and IngB (5 kg)
    combo_dish = MenuItem(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Combo Dish",
        price=Decimal("300.00"),
        packaging_cost=Decimal("10.00"),
        prep_minutes=10,
        cook_minutes=20,
        is_active=True,
        data_source="simulated",
    )
    seed_session.add(combo_dish)
    seed_session.add(RecipeItem(id=uuid4(), menu_item_id=combo_dish.id, ingredient_id=ing_a.id, qty_per_portion=Decimal("2.000")))
    seed_session.add(RecipeItem(id=uuid4(), menu_item_id=combo_dish.id, ingredient_id=ing_b.id, qty_per_portion=Decimal("5.000")))

    # Dish needing only IngB (8 kg)
    side_dish = MenuItem(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Side Dish",
        price=Decimal("150.00"),
        packaging_cost=Decimal("5.00"),
        prep_minutes=5,
        cook_minutes=10,
        is_active=True,
        data_source="simulated",
    )
    seed_session.add(side_dish)
    seed_session.add(RecipeItem(id=uuid4(), menu_item_id=side_dish.id, ingredient_id=ing_b.id, qty_per_portion=Decimal("8.000")))

    # Order 1 (earlier): needs Combo Dish -> requires 2 kg IngA (we only have 1 kg) and 5 kg IngB (we have 10 kg).
    # Order 1 must fail due to IngA. IngB must NOT be deducted.
    target_d = date(2026, 11, 1)
    o1 = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Failed Combo Cust",
        channel="direct",
        deadline=datetime(2026, 11, 1, 12, 0, tzinfo=IST),
        status="new",
        total_amount=Decimal("300.00"),
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    seed_session.add(o1)
    seed_session.add(OrderItem(id=uuid4(), order_id=o1.id, menu_item_id=combo_dish.id, quantity=1, unit_price=Decimal("300.00")))

    # Order 2 (later): needs Side Dish -> requires 8 kg IngB.
    # If IngB had been deducted by Order 1, only 5 kg would remain and Order 2 would fail!
    # Because IngB was NOT deducted, 10 kg remains and Order 2 MUST SUCCEED.
    o2 = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Succeeding Side Cust",
        channel="direct",
        deadline=datetime(2026, 11, 1, 13, 0, tzinfo=IST),
        status="new",
        total_amount=Decimal("150.00"),
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    seed_session.add(o2)
    seed_session.add(OrderItem(id=uuid4(), order_id=o2.id, menu_item_id=side_dish.id, quantity=1, unit_price=Decimal("150.00")))
    seed_session.commit()

    brief = get_risk_brief(seed_session, target_date=target_d)
    assert brief.order_count == 2
    assert len(brief.at_risk_orders) == 1
    assert brief.at_risk_orders[0].customer_name == "Failed Combo Cust"
    assert brief.revenue_at_risk == Decimal("300.00")


# 5. A later smaller order can still be fulfilled after an earlier order was skipped
def test_later_smaller_order_fulfilled_after_skipped_order(seed_session: Session):
    kitchen = seed_session.scalars(select(Kitchen)).first()

    # Ingredient with 5 kg stock
    flour = Ingredient(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Flour",
        unit="kg",
        stock_qty=Decimal("5.000"),
        cost_per_unit=Decimal("40.00"),
        allergen_tags=[],
        diet_tags=["veg"],
        data_source="simulated",
        updated_at=datetime.now(timezone.utc),
    )
    seed_session.add(flour)

    cake = MenuItem(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Big Cake",
        price=Decimal("500.00"),
        packaging_cost=Decimal("20.00"),
        prep_minutes=15,
        cook_minutes=45,
        is_active=True,
        data_source="simulated",
    )
    cookie = MenuItem(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Small Cookie",
        price=Decimal("100.00"),
        packaging_cost=Decimal("5.00"),
        prep_minutes=5,
        cook_minutes=15,
        is_active=True,
        data_source="simulated",
    )
    seed_session.add_all([cake, cookie])
    seed_session.add(RecipeItem(id=uuid4(), menu_item_id=cake.id, ingredient_id=flour.id, qty_per_portion=Decimal("8.000")))
    seed_session.add(RecipeItem(id=uuid4(), menu_item_id=cookie.id, ingredient_id=flour.id, qty_per_portion=Decimal("3.000")))

    target_d = date(2026, 11, 2)
    # Order 1 (12:00): Cake needs 8 kg (stock is 5 kg) -> At risk, skipped
    o1 = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Huge Cake Order",
        channel="direct",
        deadline=datetime(2026, 11, 2, 12, 0, tzinfo=IST),
        status="new",
        total_amount=Decimal("500.00"),
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    seed_session.add(o1)
    seed_session.add(OrderItem(id=uuid4(), order_id=o1.id, menu_item_id=cake.id, quantity=1, unit_price=Decimal("500.00")))

    # Order 2 (13:00): Cookie needs 3 kg (stock is still 5 kg) -> Must be fulfilled!
    o2 = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Small Cookie Order",
        channel="direct",
        deadline=datetime(2026, 11, 2, 13, 0, tzinfo=IST),
        status="new",
        total_amount=Decimal("100.00"),
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    seed_session.add(o2)
    seed_session.add(OrderItem(id=uuid4(), order_id=o2.id, menu_item_id=cookie.id, quantity=1, unit_price=Decimal("100.00")))
    seed_session.commit()

    brief = get_risk_brief(seed_session, target_date=target_d)
    assert brief.order_count == 2
    assert len(brief.at_risk_orders) == 1
    assert brief.at_risk_orders[0].customer_name == "Huge Cake Order"
    assert brief.revenue_at_risk == Decimal("500.00")


# 6. Cancelled and completed orders are excluded from demand and at-risk evaluation
def test_cancelled_and_completed_orders_excluded(seed_session: Session):
    # Retrieve Customer K and Customer M from seed data and change their statuses
    k_order = seed_session.scalars(select(Order).where(Order.customer_name == "Customer K")).first()
    m_order = seed_session.scalars(select(Order).where(Order.customer_name == "Customer M")).first()
    assert k_order is not None and m_order is not None

    k_order.status = "cancelled"
    m_order.status = "completed"
    seed_session.commit()

    brief = get_risk_brief(seed_session, target_date=date(2026, 10, 17))
    assert brief.order_count == 23

    at_risk_names = [o.customer_name for o in brief.at_risk_orders]
    assert "Customer K" not in at_risk_names
    assert "Customer M" not in at_risk_names


# 7. Date with no active orders returns zeroed/empty response
def test_date_with_no_active_orders(seed_session: Session):
    brief = get_risk_brief(seed_session, target_date=date(2026, 12, 25))

    assert brief.date == "2026-12-25"
    assert brief.order_count == 0
    assert brief.shortages == []
    assert brief.at_risk_orders == []
    assert brief.revenue_at_risk == Decimal("0.00")
    assert brief.data_source == "simulated"


# 8. No-shortage behavior when stock is fully sufficient
def test_no_shortage_behavior(seed_session: Session):
    # Set paneer stock high enough to cover all orders (needed is 1.920 kg)
    paneer = seed_session.scalars(select(Ingredient).where(Ingredient.name == "Paneer")).first()
    assert paneer is not None
    paneer.stock_qty = Decimal("5.000")
    seed_session.commit()

    brief = get_risk_brief(seed_session, target_date=date(2026, 10, 17))

    assert brief.order_count == 25
    assert brief.shortages == []
    assert brief.at_risk_orders == []
    assert brief.revenue_at_risk == Decimal("0.00")


# 9. Deterministic ordering when multiple orders share the same deadline
def test_deterministic_tie_breaking_for_same_deadline(seed_session: Session):
    kitchen = seed_session.scalars(select(Kitchen)).first()
    paneer = seed_session.scalars(select(Ingredient).where(Ingredient.name == "Paneer")).first()
    biryani = seed_session.scalars(select(MenuItem).where(MenuItem.name == "Paneer Biryani")).first()

    # Set paneer stock to exactly 0.150 kg (can fulfill exactly 1 biryani portion)
    paneer.stock_qty = Decimal("0.150")

    target_d = date(2026, 11, 10)
    same_dl = datetime(2026, 11, 10, 12, 0, tzinfo=IST)
    base_t = datetime(2026, 11, 9, 10, 0, tzinfo=IST)

    # Order Alpha was created earlier
    order_alpha = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Customer Alpha",
        channel="whatsapp",
        deadline=same_dl,
        status="new",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=base_t,
    )
    seed_session.add(order_alpha)
    seed_session.add(OrderItem(id=uuid4(), order_id=order_alpha.id, menu_item_id=biryani.id, quantity=1, unit_price=Decimal("180.00")))

    # Order Beta was created 10 minutes later
    order_beta = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Customer Beta",
        channel="whatsapp",
        deadline=same_dl,
        status="new",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=base_t + timedelta(minutes=10),
    )
    seed_session.add(order_beta)
    seed_session.add(OrderItem(id=uuid4(), order_id=order_beta.id, menu_item_id=biryani.id, quantity=1, unit_price=Decimal("180.00")))
    seed_session.commit()

    brief = get_risk_brief(seed_session, target_date=target_d)
    assert brief.order_count == 2
    # Alpha gets the stock; Beta is at risk because Alpha was created first
    assert len(brief.at_risk_orders) == 1
    assert brief.at_risk_orders[0].customer_name == "Customer Beta"


# 10. Read-only invariance: calculating the brief does not modify persisted state
def test_read_only_invariance(seed_session: Session):
    paneer_before = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Paneer")).first()
    rice_before = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Basmati rice")).first()

    # Execute risk brief calculation
    brief = get_risk_brief(seed_session, target_date=date(2026, 10, 17))
    assert brief.order_count == 25

    # Verify persisted ingredient stock quantities did not change
    paneer_after = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Paneer")).first()
    rice_after = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Basmati rice")).first()

    assert paneer_before == paneer_after
    assert rice_before == rice_after


# 11. Default target_date is tomorrow in IST
def test_default_target_date_tomorrow(seed_session: Session):
    tomorrow = (datetime.now(IST) + timedelta(days=1)).date()
    brief = get_risk_brief(seed_session)
    assert brief.date == tomorrow.isoformat()


# ============================================================================
# API Integration Tests (Milestone 2)
# ============================================================================

# 12. GET /api/brief?date=2026-10-17 returns 200 with the expected response schema
def test_api_brief_seeded_scenario_success(client: TestClient):
    r = client.get("/api/brief", params={"date": "2026-10-17"})
    assert r.status_code == 200
    data = r.json()

    assert data["date"] == "2026-10-17"
    assert data["order_count"] == 25
    assert data["revenue_at_risk"] == 1380.00
    assert data["data_source"] == "simulated"

    # Verify shortages schema & values
    assert len(data["shortages"]) == 1
    shortage = data["shortages"][0]
    assert shortage["name"] == "Paneer"
    assert shortage["unit"] == "kg"
    assert shortage["stock_qty"] == 1.0
    assert shortage["needed_qty"] == 1.92
    assert shortage["short_by"] == 0.92
    assert "severity" not in shortage  # Critical check: no severity field

    # Verify at_risk_orders schema & values
    assert len(data["at_risk_orders"]) == 4
    at_risk_names = [o["customer_name"] for o in data["at_risk_orders"]]
    assert at_risk_names == ["Customer K", "Customer M", "Customer P", "Customer S"]
    assert "severity" not in data
    for o in data["at_risk_orders"]:
        assert "severity" not in o
        assert "+05:30" in o["deadline"]


# 13. Omitting date uses tomorrow in IST
def test_api_brief_omitted_date_uses_tomorrow(client: TestClient):
    r = client.get("/api/brief")
    assert r.status_code == 200
    tomorrow = (datetime.now(IST) + timedelta(days=1)).date().isoformat()
    assert r.json()["date"] == tomorrow


# 14. Missing API key returns 401 UNAUTHORIZED in documented error envelope
def test_api_brief_missing_api_key():
    unauth_client = TestClient(app)
    r = unauth_client.get("/api/brief", params={"date": "2026-10-17"})
    assert r.status_code == 401
    assert r.json() == {
        "error": {
            "code": "UNAUTHORIZED",
            "message": "Missing or invalid API key",
            "details": {},
        }
    }


# 15. Invalid API key returns 401 UNAUTHORIZED in documented error envelope
def test_api_brief_invalid_api_key():
    unauth_client = TestClient(app)
    r = unauth_client.get(
        "/api/brief",
        params={"date": "2026-10-17"},
        headers={"X-API-Key": "invalid-secret"},
    )
    assert r.status_code == 401
    assert r.json() == {
        "error": {
            "code": "UNAUTHORIZED",
            "message": "Missing or invalid API key",
            "details": {},
        }
    }


# 16. Invalid date returns 422 VALIDATION_ERROR in documented error envelope
def test_api_brief_invalid_date_format(client: TestClient):
    r = client.get("/api/brief", params={"date": "not-a-valid-date"})
    assert r.status_code == 422
    data = r.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert data["error"]["message"] == "Invalid request"
    assert "details" in data["error"]


# 17. A date with no active orders returns 200 with zero counts, empty arrays, and 0 revenue at risk
def test_api_brief_date_with_no_active_orders(client: TestClient):
    r = client.get("/api/brief", params={"date": "2026-12-25"})
    assert r.status_code == 200
    assert r.json() == {
        "date": "2026-12-25",
        "order_count": 0,
        "shortages": [],
        "at_risk_orders": [],
        "revenue_at_risk": 0.0,
        "data_source": "simulated",
    }


# 18. Endpoint does not modify persisted stock or other relevant application state
def test_api_brief_read_only_invariance(client: TestClient, seed_session: Session):
    paneer_before = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Paneer")).first()
    rice_before = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Basmati rice")).first()

    r = client.get("/api/brief", params={"date": "2026-10-17"})
    assert r.status_code == 200

    paneer_after = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Paneer")).first()
    rice_after = seed_session.scalars(select(Ingredient.stock_qty).where(Ingredient.name == "Basmati rice")).first()

    assert paneer_before == paneer_after
    assert rice_before == rice_after


# 19. Endpoint works without a generated production plan
def test_api_brief_works_without_production_plan(client: TestClient, seed_session: Session):
    # Verify no plan tasks exist
    assert seed_session.scalars(select(PlanTask)).all() == []

    # Call brief
    r = client.get("/api/brief", params={"date": "2026-10-17"})
    assert r.status_code == 200
    assert r.json()["order_count"] == 25

    # Verify still no plan tasks exist
    assert seed_session.scalars(select(PlanTask)).all() == []


# 20. Endpoint does not change existing scheduler, pricing, health, or other API behavior
def test_api_brief_does_not_affect_other_endpoints(client: TestClient):
    # Health endpoint
    r_health = client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json() == {"status": "ok"}

    # Brief endpoint succeeds
    r_brief = client.get("/api/brief", params={"date": "2026-10-17"})
    assert r_brief.status_code == 200

    # Health endpoint still succeeds
    r_health2 = client.get("/health")
    assert r_health2.status_code == 200
    assert r_health2.json() == {"status": "ok"}
