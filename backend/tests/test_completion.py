from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from app.config import settings
from app.models import Kitchen, MenuItem, Order, OrderItem, PlanTask
from app.services.kitchen import get_kitchen


def test_order_completion_success(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)

    # Create an order in 'planned' status
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Aarav Sharma",
        customer_phone="9876543210",
        channel="whatsapp",
        deadline=now,
        status="planned",
        total_amount=Decimal("350.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    db_session.commit()

    res = client.post(f"/api/orders/{order.id}/complete")
    assert res.status_code == 200
    data = res.json()
    assert data["order"]["id"] == str(order.id)
    assert data["order"]["status"] == "completed"
    assert data["already_completed"] is False
    assert data["message"] == "Order marked as completed"

    # Verify directly in DB
    refreshed = db_session.get(Order, order.id)
    assert refreshed.status == "completed"
    assert refreshed.customer_name == "Aarav Sharma"
    assert refreshed.total_amount == Decimal("350.00")


def test_order_completion_already_completed(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)

    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Priya Patel",
        customer_phone=None,
        channel="swiggy",
        deadline=now,
        status="completed",
        total_amount=Decimal("220.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    db_session.commit()

    res = client.post(f"/api/orders/{order.id}/complete")
    assert res.status_code == 200
    data = res.json()
    assert data["order"]["id"] == str(order.id)
    assert data["order"]["status"] == "completed"
    assert data["already_completed"] is True
    assert data["message"] == "Order is already completed"


def test_order_completion_invalid_transition(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)

    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Rohan Mehra",
        channel="direct",
        deadline=now,
        status="cancelled",
        total_amount=Decimal("150.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    db_session.commit()

    res = client.post(f"/api/orders/{order.id}/complete")
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "INVALID_STATUS_TRANSITION"


def test_order_completion_missing_id(client):
    non_existent = uuid4()
    res = client.post(f"/api/orders/{non_existent}/complete")
    assert res.status_code == 404
    err = res.json()["error"]
    assert err["code"] == "ORDER_NOT_FOUND"


def test_order_completion_kitchen_isolation(client, db_session):
    other_kitchen = Kitchen(
        id=uuid4(),
        name="Other Kitchen",
        burner_count=2,
        cook_count=1,
        overhead_pct=Decimal("10.00"),
        commission_pct=Decimal("15.00"),
        target_margin_pct=Decimal("20.00"),
        plan_version=1,
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(other_kitchen)

    now = datetime.now(timezone.utc)
    other_order = Order(
        id=uuid4(),
        kitchen_id=other_kitchen.id,
        customer_name="Sneha Rao",
        channel="instagram",
        deadline=now,
        status="planned",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(other_order)
    db_session.commit()

    # Requesting with current kitchen client must return 404
    res = client.post(f"/api/orders/{other_order.id}/complete")
    assert res.status_code == 404
    err = res.json()["error"]
    assert err["code"] == "ORDER_NOT_FOUND"


def test_order_completion_auth(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Test Auth",
        channel="direct",
        deadline=now,
        status="new",
        total_amount=Decimal("100.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    db_session.commit()

    # Missing API Key
    res_no_key = client.post(
        f"/api/orders/{order.id}/complete",
        headers={"X-API-Key": ""}
    )
    assert res_no_key.status_code == 401

    # Bad API Key
    res_bad_key = client.post(
        f"/api/orders/{order.id}/complete",
        headers={"X-API-Key": "wrong-key"}
    )
    assert res_bad_key.status_code == 401


def test_task_completion_success(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)

    # Need menu_item, order, order_item, plan_task
    menu_item = db_session.query(MenuItem).filter(MenuItem.kitchen_id == kitchen.id).first()
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Vikram Singh",
        channel="zomato",
        deadline=now,
        status="planned",
        total_amount=Decimal("200.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)

    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=menu_item.id,
        quantity=1,
        unit_price=Decimal("200.00"),
    )
    db_session.add(order_item)

    task = PlanTask(
        id=uuid4(),
        kitchen_id=kitchen.id,
        order_item_id=order_item.id,
        task_type="cook",
        burner_no=1,
        cook_no=1,
        start_at=now,
        end_at=now + timedelta(minutes=15),
        status="scheduled",
        locked=False,
        plan_version=1,
    )
    db_session.add(task)
    db_session.commit()

    res = client.post(f"/api/plan/tasks/{task.id}/complete")
    assert res.status_code == 200
    data = res.json()
    assert data["task"]["id"] == str(task.id)
    assert data["task"]["status"] == "done"
    assert data["task"]["locked"] is True
    assert data["already_completed"] is False
    assert data["message"] == "Task marked as done"

    # Verify directly in DB
    refreshed = db_session.get(PlanTask, task.id)
    assert refreshed.status == "done"
    assert refreshed.locked is True


def test_task_completion_already_completed(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)
    menu_item = db_session.query(MenuItem).filter(MenuItem.kitchen_id == kitchen.id).first()
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Anita Roy",
        channel="whatsapp",
        deadline=now,
        status="planned",
        total_amount=Decimal("200.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=menu_item.id,
        quantity=1,
        unit_price=Decimal("200.00"),
    )
    db_session.add(order_item)

    task = PlanTask(
        id=uuid4(),
        kitchen_id=kitchen.id,
        order_item_id=order_item.id,
        task_type="prep",
        burner_no=None,
        cook_no=2,
        start_at=now,
        end_at=now + timedelta(minutes=15),
        status="done",
        locked=True,
        plan_version=1,
    )
    db_session.add(task)
    db_session.commit()

    res = client.post(f"/api/plan/tasks/{task.id}/complete")
    assert res.status_code == 200
    data = res.json()
    assert data["task"]["status"] == "done"
    assert data["already_completed"] is True
    assert data["message"] == "Task is already completed"


def test_task_completion_invalid_transition(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)
    menu_item = db_session.query(MenuItem).filter(MenuItem.kitchen_id == kitchen.id).first()
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Karan Johar",
        channel="swiggy",
        deadline=now,
        status="planned",
        total_amount=Decimal("200.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=menu_item.id,
        quantity=1,
        unit_price=Decimal("200.00"),
    )
    db_session.add(order_item)

    task = PlanTask(
        id=uuid4(),
        kitchen_id=kitchen.id,
        order_item_id=order_item.id,
        task_type="pack",
        burner_no=None,
        cook_no=1,
        start_at=now,
        end_at=now + timedelta(minutes=15),
        status="cancelled",
        locked=False,
        plan_version=1,
    )
    db_session.add(task)
    db_session.commit()

    res = client.post(f"/api/plan/tasks/{task.id}/complete")
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "INVALID_STATUS_TRANSITION"


def test_task_completion_missing_id(client):
    non_existent = uuid4()
    res = client.post(f"/api/plan/tasks/{non_existent}/complete")
    assert res.status_code == 404
    err = res.json()["error"]
    assert err["code"] == "TASK_NOT_FOUND"


def test_task_completion_kitchen_isolation(client, db_session):
    other_kitchen = Kitchen(
        id=uuid4(),
        name="Other Kitchen 2",
        burner_count=2,
        cook_count=1,
        overhead_pct=Decimal("10.00"),
        commission_pct=Decimal("15.00"),
        target_margin_pct=Decimal("20.00"),
        plan_version=1,
        data_source="simulated",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(other_kitchen)

    now = datetime.now(timezone.utc)
    menu_item = MenuItem(
        id=uuid4(),
        kitchen_id=other_kitchen.id,
        name="Other Dish",
        price=Decimal("100.00"),
        packaging_cost=Decimal("10.00"),
        prep_minutes=5,
        cook_minutes=10,
        is_active=True,
        data_source="simulated",
    )
    db_session.add(menu_item)
    order = Order(
        id=uuid4(),
        kitchen_id=other_kitchen.id,
        customer_name="Other Customer",
        channel="direct",
        deadline=now,
        status="planned",
        total_amount=Decimal("100.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=menu_item.id,
        quantity=1,
        unit_price=Decimal("100.00"),
    )
    db_session.add(order_item)

    task = PlanTask(
        id=uuid4(),
        kitchen_id=other_kitchen.id,
        order_item_id=order_item.id,
        task_type="cook",
        burner_no=1,
        cook_no=1,
        start_at=now,
        end_at=now + timedelta(minutes=15),
        status="scheduled",
        locked=False,
        plan_version=1,
    )
    db_session.add(task)
    db_session.commit()

    res = client.post(f"/api/plan/tasks/{task.id}/complete")
    assert res.status_code == 404
    err = res.json()["error"]
    assert err["code"] == "TASK_NOT_FOUND"


def test_task_completion_auth(client, db_session):
    kitchen = get_kitchen(db_session)
    now = datetime.now(timezone.utc)
    menu_item = db_session.query(MenuItem).filter(MenuItem.kitchen_id == kitchen.id).first()
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Auth Task",
        channel="direct",
        deadline=now,
        status="planned",
        total_amount=Decimal("100.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=menu_item.id,
        quantity=1,
        unit_price=Decimal("100.00"),
    )
    db_session.add(order_item)

    task = PlanTask(
        id=uuid4(),
        kitchen_id=kitchen.id,
        order_item_id=order_item.id,
        task_type="cook",
        burner_no=1,
        cook_no=1,
        start_at=now,
        end_at=now + timedelta(minutes=15),
        status="scheduled",
        locked=False,
        plan_version=1,
    )
    db_session.add(task)
    db_session.commit()

    res_no_key = client.post(
        f"/api/plan/tasks/{task.id}/complete",
        headers={"X-API-Key": ""}
    )
    assert res_no_key.status_code == 401
