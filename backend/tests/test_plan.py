from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import get_db
from app.main import app
from app.models import AuditLog, Base, Kitchen, MenuItem, Order, OrderItem, PlanTask
from app.timeutil import IST


# Allow SQLite to compile PostgreSQL ARRAY types for in-memory testing
@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"


@pytest.fixture
def test_setup():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSessionLocal()

    # Seed baseline test kitchen
    kitchen = Kitchen(
        id=uuid4(),
        name="Test Cloud Kitchen",
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

    # Seed test menu items
    dish1 = MenuItem(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Paneer Biryani",
        price=Decimal("180.00"),
        packaging_cost=Decimal("14.00"),
        prep_minutes=15,
        cook_minutes=35,
        is_active=True,
        data_source="simulated",
    )
    dish2 = MenuItem(
        id=uuid4(),
        kitchen_id=kitchen.id,
        name="Jeera Rice",
        price=Decimal("90.00"),
        packaging_cost=Decimal("8.00"),
        prep_minutes=5,
        cook_minutes=20,
        is_active=True,
        data_source="simulated",
    )
    session.add_all([dish1, dish2])
    session.commit()
    session.close()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        client.headers["X-API-Key"] = settings.api_key
        yield client, TestingSessionLocal, kitchen, dish1, dish2

    app.dependency_overrides.clear()
    engine.dispose()


def create_test_order(
    session_factory,
    kitchen: Kitchen,
    dish: MenuItem,
    deadline_ist: datetime,
    customer: str = "Test Customer",
    quantity: int = 1,
    status: str = "new",
) -> Order:
    session = session_factory()
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name=customer,
        channel="whatsapp",
        deadline=deadline_ist,
        status=status,
        total_amount=dish.price * quantity,
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    session.add(order)
    item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=dish.id,
        quantity=quantity,
        unit_price=dish.price,
    )
    session.add(item)
    session.commit()
    session.close()
    return order


# 1. Successful plan generation and structure
def test_plan_generate_success(test_setup):
    client, session_factory, kitchen, dish1, dish2 = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)

    create_test_order(session_factory, kitchen, dish1, dl, "Cust A")
    create_test_order(session_factory, kitchen, dish2, dl, "Cust B")

    r = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    assert r.status_code == 201
    body = r.json()
    assert body["date"] == "2026-10-17"
    assert body["plan_version"] == 2
    assert body["solver"] == "greedy"
    assert body["feasible"] is True
    assert body["orders_scheduled"] == 2
    assert body["task_count"] == 4  # 2 prep + 2 cook
    assert body["late_orders"] == []


# 2. Retrieval of generated plan
def test_get_plan_success(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl, "Cust A")

    client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})

    r = client.get("/api/plan", params={"date": "2026-10-17"})
    assert r.status_code == 200
    body = r.json()
    assert body["date"] == "2026-10-17"
    assert body["plan_version"] == 2
    assert len(body["tasks"]) == 2

    prep = next(t for t in body["tasks"] if t["task_type"] == "prep")
    cook = next(t for t in body["tasks"] if t["task_type"] == "cook")

    assert prep["dish"] == "Paneer Biryani"
    assert prep["burner_no"] is None
    assert prep["cook_no"] in (1, 2)
    assert prep["status"] == "scheduled"
    assert prep["locked"] is False
    assert prep["start_at"].endswith("+05:30")
    assert prep["end_at"].endswith("+05:30")

    assert cook["dish"] == "Paneer Biryani"
    assert cook["burner_no"] in (1, 2, 3)
    assert cook["cook_no"] in (1, 2)


# 3. Missing plan returns 404 PLAN_NOT_FOUND
def test_get_plan_not_found(test_setup):
    client, _, _, _, _ = test_setup
    r = client.get("/api/plan", params={"date": "2026-10-25"})
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "PLAN_NOT_FOUND"


# 4. Duplicate generation without regenerate=true returns 409 PLAN_EXISTS
def test_plan_generate_already_exists_conflict(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl)

    r1 = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    assert r1.status_code == 201

    r2 = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "PLAN_EXISTS"


# 5. Regeneration with regenerate=true replaces plan and increments version
def test_plan_generate_regeneration_success(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl)

    r1 = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    assert r1.status_code == 201
    assert r1.json()["plan_version"] == 2

    r2 = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": True})
    assert r2.status_code == 201
    assert r2.json()["plan_version"] == 3


# 6. No orders for date returns 422 NO_ORDERS_FOR_DATE
def test_plan_generate_no_orders(test_setup):
    client, _, _, _, _ = test_setup
    r = client.post("/api/plan/generate", json={"date": "2026-10-30", "regenerate": False})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "NO_ORDERS_FOR_DATE"


# 7. No overlapping assignments for the same cook
def test_no_cook_overlap(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    for i in range(4):
        create_test_order(session_factory, kitchen, dish1, dl, f"Cust {i}")

    client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    r = client.get("/api/plan", params={"date": "2026-10-17"})
    tasks = r.json()["tasks"]
    prep_tasks = [t for t in tasks if t["task_type"] == "prep"]

    by_cook = {1: [], 2: []}
    for pt in prep_tasks:
        s = datetime.fromisoformat(pt["start_at"])
        e = datetime.fromisoformat(pt["end_at"])
        by_cook[pt["cook_no"]].append((s, e))

    for cook_no, intervals in by_cook.items():
        intervals.sort(key=lambda x: x[0])
        for i in range(len(intervals) - 1):
            assert intervals[i][1] <= intervals[i + 1][0], f"Cook {cook_no} tasks overlap"


# 8. No overlapping cooking assignments for the same burner
def test_no_burner_overlap(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 13, 0, tzinfo=IST)
    for i in range(5):
        create_test_order(session_factory, kitchen, dish1, dl, f"Cust {i}")

    client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    r = client.get("/api/plan", params={"date": "2026-10-17"})
    tasks = r.json()["tasks"]
    cook_tasks = [t for t in tasks if t["task_type"] == "cook"]

    by_burner = {1: [], 2: [], 3: []}
    for ct in cook_tasks:
        s = datetime.fromisoformat(ct["start_at"])
        e = datetime.fromisoformat(ct["end_at"])
        by_burner[ct["burner_no"]].append((s, e))

    for burner_no, intervals in by_burner.items():
        intervals.sort(key=lambda x: x[0])
        for i in range(len(intervals) - 1):
            assert intervals[i][1] <= intervals[i + 1][0], f"Burner {burner_no} tasks overlap"


# 9. Kitchen resource limits are strictly respected
def test_kitchen_resource_limits(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 14, 0, tzinfo=IST)
    for i in range(6):
        create_test_order(session_factory, kitchen, dish1, dl, f"Cust {i}")

    client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    r = client.get("/api/plan", params={"date": "2026-10-17"})
    tasks = r.json()["tasks"]

    for t in tasks:
        assert 1 <= t["cook_no"] <= kitchen.cook_count
        if t["task_type"] == "cook":
            assert 1 <= t["burner_no"] <= kitchen.burner_count


# 10. Preparation and cooking tasks obey required ordering
def test_task_sequence_ordering(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl)

    client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    r = client.get("/api/plan", params={"date": "2026-10-17"})
    tasks = r.json()["tasks"]

    by_item = {}
    for t in tasks:
        by_item.setdefault(t["order_item_id"], {})[t["task_type"]] = t

    for item_id, item_tasks in by_item.items():
        prep = item_tasks["prep"]
        cook = item_tasks["cook"]
        prep_end = datetime.fromisoformat(prep["end_at"])
        cook_start = datetime.fromisoformat(cook["start_at"])
        assert prep_end <= cook_start, "Cook started before prep completed"


# 11. Late orders reported accurately
def test_late_orders_reported(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    # Dish1 takes 15 min prep + 35 min cook = 50 min. Starting at 09:00 means ends 09:50.
    # Set impossible deadline of 09:30.
    impossible_dl = datetime(2026, 10, 17, 9, 30, tzinfo=IST)
    order = create_test_order(session_factory, kitchen, dish1, impossible_dl, "Late Customer")

    r = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    assert r.status_code == 201
    body = r.json()
    assert body["feasible"] is False
    assert str(order.id) in body["late_orders"]


# 12. Audit log entry and plan version persist
def test_plan_version_and_audit_log(test_setup):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl)

    r = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})
    assert r.status_code == 201

    session = session_factory()
    k = session.get(Kitchen, kitchen.id)
    assert k.plan_version == 2

    audit = session.query(AuditLog).filter(AuditLog.kitchen_id == kitchen.id).first()
    assert audit is not None
    assert audit.event_type == "plan_generated"
    assert audit.actor == "system"
    assert audit.plan_version_before == 1
    assert audit.plan_version_after == 2
    session.close()


# 13. Locked tasks remain unchanged during regeneration
def test_locked_tasks_remain_unchanged(test_setup):
    client, session_factory, kitchen, dish1, dish2 = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl, "Cust 1")
    create_test_order(session_factory, kitchen, dish2, dl, "Cust 2")

    # Generate initial plan
    client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})

    # Lock one task
    session = session_factory()
    task = session.query(PlanTask).filter(PlanTask.task_type == "cook").first()
    assert task is not None
    task.locked = True
    original_start = task.start_at
    original_end = task.end_at
    original_burner = task.burner_no
    original_id = task.id
    session.commit()
    session.close()

    # Regenerate plan
    r = client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": True})
    assert r.status_code == 201

    # Verify locked task was preserved exactly
    session = session_factory()
    preserved = session.get(PlanTask, original_id)
    assert preserved is not None
    assert preserved.locked is True
    assert preserved.start_at == original_start
    assert preserved.end_at == original_end
    assert preserved.burner_no == original_burner
    session.close()


# 14. Transaction atomicity: failure rolls back partial changes
def test_transaction_atomicity(test_setup, monkeypatch):
    client, session_factory, kitchen, dish1, _ = test_setup
    dl = datetime(2026, 10, 17, 12, 0, tzinfo=IST)
    create_test_order(session_factory, kitchen, dish1, dl)

    # Monkeypatch schedule_greedy to raise an error
    def broken_schedule(*args, **kwargs):
        raise RuntimeError("Simulated scheduler failure")

    monkeypatch.setattr("app.services.scheduler.schedule_greedy", broken_schedule)

    with pytest.raises(RuntimeError):
        client.post("/api/plan/generate", json={"date": "2026-10-17", "regenerate": False})

    session = session_factory()
    # Confirm nothing was saved
    assert session.query(PlanTask).count() == 0
    assert session.query(AuditLog).count() == 0
    k = session.get(Kitchen, kitchen.id)
    assert k.plan_version == 1
    session.close()


# 15. Authentication requirement (401 without or with invalid key)
def test_plan_auth_required(test_setup):
    client, _, _, _, _ = test_setup
    unauth = TestClient(app)

    # POST without key
    r1 = unauth.post("/api/plan/generate", json={"date": "2026-10-17"})
    assert r1.status_code == 401
    assert r1.json()["error"]["code"] == "UNAUTHORIZED"

    # GET without key
    r2 = unauth.get("/api/plan", params={"date": "2026-10-17"})
    assert r2.status_code == 401
    assert r2.json()["error"]["code"] == "UNAUTHORIZED"

    # With wrong key
    r3 = unauth.get("/api/plan", params={"date": "2026-10-17"}, headers={"X-API-Key": "wrong-key"})
    assert r3.status_code == 401
    assert r3.json()["error"]["code"] == "UNAUTHORIZED"
