from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import get_db
from app.main import app
from app.models import (
    Base,
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
from app.timeutil import IST


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"


@event.listens_for(Ingredient, "load")
def load_sqlite_ingredient_tags(ingredient, _context):
    for field in ("allergen_tags", "diet_tags"):
        value = getattr(ingredient, field)
        if isinstance(value, str):
            setattr(ingredient, field, json.loads(value))


@pytest.fixture
def recovery_setup():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db = factory()
    now = datetime.now(timezone.utc)
    kitchen = Kitchen(
        id=uuid4(), name="Recovery Test Kitchen", burner_count=2, cook_count=1,
        overhead_pct=Decimal("10"), commission_pct=Decimal("10"),
        target_margin_pct=Decimal("20"), plan_version=2, data_source="simulated", created_at=now,
    )
    paneer = Ingredient(
        id=uuid4(), kitchen_id=kitchen.id, name="Paneer", unit="kg", stock_qty=Decimal("0.1"),
        cost_per_unit=Decimal("380"), allergen_tags=json.dumps(["dairy"]), diet_tags=json.dumps(["veg"]),
        data_source="simulated", updated_at=now,
    )
    tofu = Ingredient(
        id=uuid4(), kitchen_id=kitchen.id, name="Tofu", unit="kg", stock_qty=Decimal("1"),
        cost_per_unit=Decimal("220"), allergen_tags=json.dumps(["soy"]), diet_tags=json.dumps(["veg", "vegan"]),
        data_source="simulated", updated_at=now,
    )
    rice = Ingredient(
        id=uuid4(), kitchen_id=kitchen.id, name="Rice", unit="kg", stock_qty=Decimal("5"),
        cost_per_unit=Decimal("100"), allergen_tags=json.dumps([]), diet_tags=json.dumps(["veg", "vegan"]),
        data_source="simulated", updated_at=now,
    )
    paneer_dish = MenuItem(
        id=uuid4(), kitchen_id=kitchen.id, name="Paneer Dish", price=Decimal("100"),
        packaging_cost=Decimal("5"), prep_minutes=10, cook_minutes=20, is_active=True,
        data_source="simulated",
    )
    rice_dish = MenuItem(
        id=uuid4(), kitchen_id=kitchen.id, name="Rice Dish", price=Decimal("100"),
        packaging_cost=Decimal("5"), prep_minutes=10, cook_minutes=20, is_active=True,
        data_source="simulated",
    )
    db.add_all([kitchen, paneer_dish, rice_dish])
    db.flush()
    for ingredient in (paneer, tofu, rice):
        db.execute(text(
            "INSERT INTO ingredients (id, kitchen_id, name, unit, stock_qty, cost_per_unit, "
            "allergen_tags, diet_tags, data_source, updated_at) "
            "VALUES (:id, :kitchen_id, :name, :unit, :stock_qty, :cost_per_unit, "
            ":allergen_tags, :diet_tags, :data_source, :updated_at)"
        ), {
            "id": ingredient.id.hex, "kitchen_id": kitchen.id.hex, "name": ingredient.name,
            "unit": ingredient.unit, "stock_qty": float(ingredient.stock_qty),
            "cost_per_unit": float(ingredient.cost_per_unit),
            "allergen_tags": ingredient.allergen_tags, "diet_tags": ingredient.diet_tags,
            "data_source": ingredient.data_source, "updated_at": now.isoformat(),
        })
    db.add_all([
        RecipeItem(id=uuid4(), menu_item_id=paneer_dish.id, ingredient_id=paneer.id, qty_per_portion=Decimal("0.3")),
        RecipeItem(id=uuid4(), menu_item_id=rice_dish.id, ingredient_id=rice.id, qty_per_portion=Decimal("0.1")),
        Substitution(id=uuid4(), kitchen_id=kitchen.id, ingredient_id=paneer.id,
                     substitute_ingredient_id=tofu.id, ratio=Decimal("1"), needs_consent=True,
                     notes=None, is_active=True),
    ])
    order = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Test Customer", customer_phone=None,
        channel="direct", deadline=datetime(2026, 10, 20, 13, 0, tzinfo=IST), status="planned",
        total_amount=Decimal("100"), data_source="simulated", created_at=now,
    )
    db.add(order)
    db.flush()
    order_item = OrderItem(
        id=uuid4(), order_id=order.id, menu_item_id=paneer_dish.id, quantity=1,
        unit_price=Decimal("100"),
    )
    db.add(order_item)
    db.flush()
    task = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=order_item.id, task_type="cook",
        burner_no=1, cook_no=1, start_at=datetime(2026, 10, 20, 11, 0, tzinfo=IST),
        end_at=datetime(2026, 10, 20, 11, 30, tzinfo=IST), status="scheduled", locked=False,
        plan_version=kitchen.plan_version,
    )
    db.add(task)
    db.commit()
    ids = {
        "kitchen": kitchen.id, "paneer": paneer.id, "tofu": tofu.id, "rice": rice.id,
        "order": order.id, "task": task.id,
    }
    db.close()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        client.headers["X-API-Key"] = settings.api_key
        yield client, factory, ids
    app.dependency_overrides.clear()
    engine.dispose()


def test_recovery_propose_creates_ranked_options_without_applying(recovery_setup):
    client, factory, ids = recovery_setup
    response = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
    })
    assert response.status_code == 201
    body = response.json()
    assert body["shortage"]["short_by"] == 0.2
    assert body["baseline"]["late_orders"] == 1
    assert body["recommended_option_number"] == 1
    assert {option["option_type"] for option in body["options"]} == {
        "substitute", "emergency_purchase", "dish_swap"
    }
    assert [option["option_number"] for option in body["options"]] == [1, 2, 3]
    assert body["options"][0]["impact"]["score"] >= body["options"][1]["impact"]["score"]

    db = factory()
    assert db.get(Ingredient, ids["paneer"]).stock_qty == Decimal("0.100")
    assert db.get(Kitchen, ids["kitchen"]).plan_version == 2
    assert db.query(PlanTask).count() == 1
    assert db.query(ProposedAction).count() == 3
    assert {row.status for row in db.query(ProposedAction).all()} == {"pending"}
    assert all(
        Decimal(str(row.impact["revenue_at_risk_without_action"])) == Decimal("100.00")
        for row in db.query(ProposedAction).all()
    )
    db.close()


def test_reported_stock_is_only_saved_in_pending_payload(recovery_setup):
    client, factory, ids = recovery_setup
    response = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
        "reported_available_qty": 0,
    })
    assert response.status_code == 201
    db = factory()
    actions = db.query(ProposedAction).all()
    assert all(row.payload["stock_update"]["reported_available_qty"] == "0" for row in actions)
    assert db.get(Ingredient, ids["paneer"]).stock_qty == Decimal("0.100")
    db.close()


def test_no_shortage_and_bad_reported_stock(recovery_setup):
    client, _, ids = recovery_setup
    no_shortage = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
        "reported_available_qty": 1,
    })
    assert no_shortage.status_code == 409
    assert no_shortage.json()["error"]["code"] == "NO_SHORTAGE_DETECTED"
    invalid = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
        "reported_available_qty": -1,
    })
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"


def test_recovery_requires_plan_and_actions_list_filters(recovery_setup):
    client, _, ids = recovery_setup
    missing = client.post("/api/recovery/propose", json={
        "date": "2026-10-21", "ingredient_id": str(ids["paneer"]),
    })
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PLAN_NOT_FOUND"

    proposed = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
    })
    group_id = proposed.json()["group_id"]
    listed = client.get("/api/actions", params={"status": "pending", "group_id": group_id})
    assert listed.status_code == 200
    assert listed.json()["count"] == 3
    assert "payload" not in listed.json()["data"][0]


def test_no_feasible_options_escalates_without_creating_actions(recovery_setup, monkeypatch):
    client, factory, ids = recovery_setup
    db = factory()
    tofu = db.get(Ingredient, ids["tofu"])
    tofu.stock_qty = Decimal("0")
    db.get(Ingredient, ids["rice"]).stock_qty = Decimal("0")
    db.commit()
    db.close()
    monkeypatch.setattr(settings, "recovery_emergency_delay_minutes", 180)
    response = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
        "reported_available_qty": 0,
    })
    assert response.status_code == 200
    assert response.json()["options"] == []
    assert response.json()["escalation"]
    db = factory()
    assert db.query(ProposedAction).count() == 0
    db.close()


@pytest.mark.parametrize(
    ("ratio", "expected_quantity", "expected_extra_cost"),
    [
        ("1", "0.2", -32),
        ("2", "0.4", 12),
        ("0.5", "0.1", -54),
    ],
)
def test_substitution_ratio_cost_and_payload(recovery_setup, ratio, expected_quantity, expected_extra_cost):
    client, factory, ids = recovery_setup
    db = factory()
    substitution = db.query(Substitution).one()
    substitution.ratio = Decimal(ratio)
    db.commit()
    db.close()

    response = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
    })
    assert response.status_code == 201
    option = next(row for row in response.json()["options"] if row["option_type"] == "substitute")
    db = factory()
    action = db.get(ProposedAction, UUID(option["action_id"]))
    assert Decimal(action.payload["quantity"]) == Decimal(expected_quantity)
    assert Decimal(str(action.impact["extra_cost"])) == Decimal(str(expected_extra_cost))
    db.close()


def test_substitution_is_skipped_when_ratio_exceeds_replacement_stock(recovery_setup):
    client, factory, ids = recovery_setup
    db = factory()
    db.query(Substitution).one().ratio = Decimal("6")
    db.commit()
    db.close()

    response = client.post("/api/recovery/propose", json={
        "date": "2026-10-20", "ingredient_id": str(ids["paneer"]),
    })
    assert response.status_code == 201
    assert all(row["option_type"] != "substitute" for row in response.json()["options"])


def _frozen_clock(monkeypatch, now):
    from app.services import recovery

    real_datetime = datetime

    class FrozenDatetime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz is not None else now.replace(tzinfo=None)

    monkeypatch.setattr(recovery, "datetime", FrozenDatetime)


def _emergency_option(client, ingredient_id, target_date="2026-10-20"):
    response = client.post("/api/recovery/propose", json={
        "date": target_date, "ingredient_id": str(ingredient_id),
    })
    assert response.status_code in (200, 201)
    return next(
        (row for row in response.json()["options"] if row["option_type"] == "emergency_purchase"),
        None,
    )


def test_emergency_purchase_protects_order_and_uses_premium_cost(recovery_setup):
    client, factory, ids = recovery_setup
    option = _emergency_option(client, ids["paneer"])
    assert option is not None
    db = factory()
    action = db.get(ProposedAction, UUID(option["action_id"]))
    assert action.payload["order_ids"] == [str(ids["order"])]
    assert Decimal(str(action.impact["extra_cost"])) == Decimal("91.20")
    db.close()


def test_emergency_purchase_rejects_delay_that_misses_deadline(recovery_setup, monkeypatch):
    client, _, ids = recovery_setup
    monkeypatch.setattr(settings, "recovery_emergency_delay_minutes", 180)
    assert _emergency_option(client, ids["paneer"]) is None


def test_locked_order_task_cannot_be_protected_by_delay(recovery_setup):
    client, factory, ids = recovery_setup
    db = factory()
    db.get(PlanTask, ids["task"]).locked = True
    db.commit()
    db.close()
    assert _emergency_option(client, ids["paneer"]) is None


def test_emergency_purchase_filters_taskless_orders_by_current_deadline(recovery_setup, monkeypatch):
    client, factory, ids = recovery_setup
    frozen_now = datetime(2026, 10, 20, 10, 0, tzinfo=IST)
    _frozen_clock(monkeypatch, frozen_now.astimezone(timezone.utc))
    db = factory()
    kitchen = db.get(Kitchen, ids["kitchen"])
    dish = db.query(MenuItem).filter(MenuItem.name == "Paneer Dish").one()
    far = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Far Taskless", customer_phone=None,
        channel="direct", deadline=datetime(2026, 10, 20, 12, 0, tzinfo=IST), status="planned",
        total_amount=Decimal("100"), data_source="simulated", created_at=frozen_now,
    )
    near = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Near Taskless", customer_phone=None,
        channel="direct", deadline=datetime(2026, 10, 20, 10, 10, tzinfo=IST), status="planned",
        total_amount=Decimal("100"), data_source="simulated", created_at=frozen_now,
    )
    db.add_all([far, near])
    db.flush()
    db.add_all([
        OrderItem(id=uuid4(), order_id=far.id, menu_item_id=dish.id, quantity=1, unit_price=Decimal("100")),
        OrderItem(id=uuid4(), order_id=near.id, menu_item_id=dish.id, quantity=1, unit_price=Decimal("100")),
    ])
    db.commit()
    db.close()

    option = _emergency_option(client, ids["paneer"])
    assert option is not None
    db = factory()
    action = db.get(ProposedAction, UUID(option["action_id"]))
    assert set(action.payload["order_ids"]) == {str(ids["order"]), str(far.id)}
    assert str(near.id) not in action.payload["order_ids"]
    db.close()
