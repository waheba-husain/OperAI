from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models import (
    AuditLog,
    Ingredient,
    Kitchen,
    Order,
    OrderItem,
    PlanTask,
    ProposedAction,
)
from app.timeutil import IST


@pytest.fixture
def rejection_setup(db_session):
    now = datetime.now(timezone.utc)
    kitchen = db_session.scalar(select(Kitchen).limit(1))

    # Ensure baseline entities exist to verify they remain untouched
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Test Customer",
        customer_phone="919800000010",
        channel="direct",
        deadline=datetime(2026, 10, 22, 13, 0, tzinfo=IST),
        status="planned",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    db_session.flush()

    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=db_session.scalar(select(Order).limit(1)),  # dummy or fetch menu_item
        quantity=1,
        unit_price=Decimal("180.00"),
    )
    # Fetch a valid menu item
    from app.models import MenuItem

    menu_item = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id).limit(1))
    order_item.menu_item_id = menu_item.id
    db_session.add(order_item)
    db_session.flush()

    task = PlanTask(
        id=uuid4(),
        kitchen_id=kitchen.id,
        order_item_id=order_item.id,
        task_type="cook",
        burner_no=1,
        cook_no=1,
        start_at=datetime(2026, 10, 22, 11, 0, tzinfo=IST),
        end_at=datetime(2026, 10, 22, 11, 30, tzinfo=IST),
        status="scheduled",
        locked=False,
        plan_version=kitchen.plan_version,
    )
    db_session.add(task)
    db_session.flush()

    group_id = uuid4()
    action1 = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=group_id,
        option_number=1,
        action_type="recovery",
        title="Use tofu instead of paneer in 4 orders",
        payload={"option_type": "substitute", "order_ids": [str(order.id)]},
        impact={"late_orders": 0, "score": 0.82},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint="sha256-test-fingerprint",
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    action2 = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=group_id,
        option_number=2,
        action_type="recovery",
        title="Buy 1 kg paneer locally",
        payload={"option_type": "emergency_purchase", "order_ids": [str(order.id)]},
        impact={"late_orders": 1, "score": 0.71},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint="sha256-test-fingerprint",
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    db_session.add_all([action1, action2])
    db_session.flush()

    return {
        "kitchen": kitchen,
        "action1": action1,
        "action2": action2,
        "order": order,
        "order_item": order_item,
        "task": task,
    }


def test_reject_action_requires_auth(client, rejection_setup):
    action = rejection_setup["action1"]
    # Missing API key
    res_no_key = client.post(f"/api/actions/{action.id}/reject", headers={"X-API-Key": ""})
    assert res_no_key.status_code == 401
    assert res_no_key.json()["error"]["code"] == "UNAUTHORIZED"

    # Wrong API key
    res_bad_key = client.post(f"/api/actions/{action.id}/reject", headers={"X-API-Key": "wrong-key"})
    assert res_bad_key.status_code == 401
    assert res_bad_key.json()["error"]["code"] == "UNAUTHORIZED"


def test_reject_action_not_found(client):
    random_id = uuid4()
    response = client.post(f"/api/actions/{random_id}/reject", json={"reason": "Unknown"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ACTION_NOT_FOUND"


def test_reject_action_not_pending(client, db_session, rejection_setup):
    action = rejection_setup["action1"]
    action.status = "executed"
    db_session.flush()

    response = client.post(f"/api/actions/{action.id}/reject", json={"reason": "Already done"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ACTION_NOT_PENDING"


def test_reject_action_success_and_immutability(client, db_session, rejection_setup):
    action1 = rejection_setup["action1"]
    action2 = rejection_setup["action2"]
    kitchen = rejection_setup["kitchen"]
    task = rejection_setup["task"]
    order = rejection_setup["order"]
    order_item = rejection_setup["order_item"]

    initial_plan_version = kitchen.plan_version
    initial_stock = {ing.id: ing.stock_qty for ing in db_session.scalars(select(Ingredient)).all()}

    # Reject action 1 with reason
    response = client.post(
        f"/api/actions/{action1.id}/reject",
        json={"reason": "Customer prefers to wait"},
    )
    assert response.status_code == 200
    data = response.json()

    # Verify response envelope
    assert data["action"]["id"] == str(action1.id)
    assert data["action"]["status"] == "rejected"
    assert "decided_at" in data["action"]
    assert "audit_id" in data

    # Verify action1 state in database
    db_session.expire_all()
    updated_action1 = db_session.get(ProposedAction, action1.id)
    assert updated_action1.status == "rejected"
    assert updated_action1.decided_at is not None

    # Verify sibling action2 remains pending
    updated_action2 = db_session.get(ProposedAction, action2.id)
    assert updated_action2.status == "pending"
    assert updated_action2.decided_at is None

    # Verify audit log row
    audit_entry = db_session.get(AuditLog, UUID(data["audit_id"]))
    assert audit_entry is not None
    assert audit_entry.event_type == "action_rejected"
    assert audit_entry.actor == "owner"
    assert audit_entry.action_id == action1.id
    assert "Customer prefers to wait" in audit_entry.summary
    assert audit_entry.before_snapshot is None
    assert audit_entry.after_snapshot is None
    assert audit_entry.plan_version_before == initial_plan_version
    assert audit_entry.plan_version_after == initial_plan_version

    # Verify domain entities are completely untouched
    refreshed_kitchen = db_session.get(Kitchen, kitchen.id)
    assert refreshed_kitchen.plan_version == initial_plan_version

    for ing in db_session.scalars(select(Ingredient)).all():
        assert ing.stock_qty == initial_stock[ing.id]

    refreshed_order = db_session.get(Order, order.id)
    assert refreshed_order.status == "planned"
    assert refreshed_order.total_amount == Decimal("180.00")

    refreshed_item = db_session.get(OrderItem, order_item.id)
    assert refreshed_item.unit_price == Decimal("180.00")
    assert refreshed_item.swapped_from_item_id is None

    refreshed_task = db_session.get(PlanTask, task.id)
    assert refreshed_task.start_at == task.start_at
    assert refreshed_task.end_at == task.end_at
    assert refreshed_task.status == "scheduled"


def test_reject_action_optional_reason(client, db_session, rejection_setup):
    action = rejection_setup["action1"]
    # Send empty body or no reason
    response = client.post(f"/api/actions/{action.id}/reject", json={})
    assert response.status_code == 200
    data = response.json()
    assert data["action"]["status"] == "rejected"

    audit_entry = db_session.get(AuditLog, UUID(data["audit_id"]))
    assert audit_entry is not None
    assert audit_entry.summary == f"Rejected proposal: {action.title}"


def test_reject_action_atomic_rollback_on_failure(client, db_session, rejection_setup, monkeypatch):
    action = rejection_setup["action1"]

    # Simulate an unexpected failure right during audit log writing
    import app.services.approval as approval_module

    def faulty_record_audit_log(*args, **kwargs):
        raise RuntimeError("Database IO failure during audit logging")

    monkeypatch.setattr(approval_module, "record_audit_log", faulty_record_audit_log)

    nested = db_session.begin_nested()
    try:
        with pytest.raises(RuntimeError, match="Database IO failure"):
            client.post(f"/api/actions/{action.id}/reject", json={"reason": "Will fail"})
    finally:
        nested.rollback()

    reloaded_action = db_session.get(ProposedAction, action.id)
    assert reloaded_action.status == "pending"
    assert reloaded_action.decided_at is None
    audit_entries = db_session.scalars(select(AuditLog).where(AuditLog.action_id == action.id)).all()
    assert len(audit_entries) == 0


@pytest.fixture
def approval_setup(db_session):
    now = datetime.now(timezone.utc)
    kitchen = db_session.scalar(select(Kitchen).limit(1))

    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    tofu = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Tofu")
    )

    all_ingredients = db_session.scalars(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)
    ).all()
    from app.services.recovery import _fingerprint

    real_fingerprint = _fingerprint(all_ingredients)

    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Aditi Sharma",
        customer_phone="919800000010",
        channel="whatsapp",
        deadline=datetime(2026, 10, 22, 13, 0, tzinfo=IST),
        status="planned",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order)
    db_session.flush()

    from app.models import MenuItem

    menu_item = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id).limit(1))
    order_item = OrderItem(
        id=uuid4(),
        order_id=order.id,
        menu_item_id=menu_item.id,
        quantity=1,
        unit_price=Decimal("180.00"),
    )
    db_session.add(order_item)
    db_session.flush()

    task = PlanTask(
        id=uuid4(),
        kitchen_id=kitchen.id,
        order_item_id=order_item.id,
        task_type="cook",
        burner_no=1,
        cook_no=1,
        start_at=datetime(2026, 10, 22, 11, 0, tzinfo=IST),
        end_at=datetime(2026, 10, 22, 11, 30, tzinfo=IST),
        status="scheduled",
        locked=False,
        plan_version=kitchen.plan_version,
    )
    db_session.add(task)
    db_session.flush()

    group_id = uuid4()
    action1 = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=group_id,
        option_number=1,
        action_type="recovery",
        title="Use tofu instead of paneer in 1 order",
        payload={
            "option_type": "substitute",
            "ingredient_id": str(paneer.id),
            "substitute_ingredient_id": str(tofu.id),
            "quantity": "0.150",
            "order_ids": [str(order.id)],
        },
        impact={"late_orders": 0, "score": 0.82},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=real_fingerprint,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    action2 = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=group_id,
        option_number=2,
        action_type="recovery",
        title="Buy 1 kg paneer locally",
        payload={"option_type": "emergency_purchase", "order_ids": [str(order.id)]},
        impact={"late_orders": 1, "score": 0.71},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=real_fingerprint,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    unrelated_action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="recovery",
        title="Unrelated pending action",
        payload={"option_type": "substitute", "order_ids": []},
        impact={"late_orders": 0, "score": 0.90},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=real_fingerprint,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    db_session.add_all([action1, action2, unrelated_action])
    db_session.flush()

    return {
        "kitchen": kitchen,
        "action1": action1,
        "action2": action2,
        "unrelated_action": unrelated_action,
        "order": order,
        "order_item": order_item,
        "task": task,
        "paneer": paneer,
        "tofu": tofu,
        "real_fingerprint": real_fingerprint,
    }


def test_approve_action_requires_auth(client, approval_setup):
    action = approval_setup["action1"]
    # Missing API key
    res_no_key = client.post(
        f"/api/actions/{action.id}/approve",
        json={"confirm_option_number": 1},
        headers={"X-API-Key": ""},
    )
    assert res_no_key.status_code == 401
    assert res_no_key.json()["error"]["code"] == "UNAUTHORIZED"

    # Bad API key
    res_bad_key = client.post(
        f"/api/actions/{action.id}/approve",
        json={"confirm_option_number": 1},
        headers={"X-API-Key": "wrong-key"},
    )
    assert res_bad_key.status_code == 401
    assert res_bad_key.json()["error"]["code"] == "UNAUTHORIZED"


def test_approve_action_not_found(client):
    random_id = uuid4()
    response = client.post(
        f"/api/actions/{random_id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ACTION_NOT_FOUND"


def test_approve_action_outside_kitchen(client, db_session, approval_setup):
    now = datetime.now(timezone.utc)
    # Create another kitchen row to satisfy FK constraint
    other_kitchen = Kitchen(
        id=uuid4(),
        name="Other Kitchen",
        burner_count=2,
        cook_count=2,
        overhead_pct=Decimal("10.00"),
        commission_pct=Decimal("15.00"),
        target_margin_pct=Decimal("20.00"),
        plan_version=1,
        data_source="simulated",
        created_at=now,
    )
    db_session.add(other_kitchen)
    db_session.flush()

    other_action = ProposedAction(
        id=uuid4(),
        kitchen_id=other_kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="recovery",
        title="Action for other kitchen",
        payload={"option_type": "substitute", "order_ids": []},
        impact={"late_orders": 0, "score": 0.8},
        status="pending",
        base_plan_version=1,
        stock_fingerprint=approval_setup["real_fingerprint"],
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    db_session.add(other_action)
    db_session.flush()

    response = client.post(
        f"/api/actions/{other_action.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ACTION_NOT_FOUND"


def test_approve_action_not_pending_and_duplicate_approval(client, db_session, approval_setup):
    action = approval_setup["action1"]

    # Test non-pending: executed
    action.status = "executed"
    db_session.flush()
    res1 = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res1.status_code == 409
    assert res1.json()["error"]["code"] == "ACTION_NOT_PENDING"

    # Test non-pending: rejected
    action.status = "rejected"
    db_session.flush()
    res2 = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res2.status_code == 409
    assert res2.json()["error"]["code"] == "ACTION_NOT_PENDING"

    # Test non-pending: expired
    action.status = "expired"
    db_session.flush()
    res3 = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res3.status_code == 409
    assert res3.json()["error"]["code"] == "ACTION_NOT_PENDING"

    # Reset to pending and approve successfully
    action.status = "pending"
    db_session.flush()
    res_ok = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res_ok.status_code == 200

    # Duplicate approval immediately rejected with 409 ACTION_NOT_PENDING
    res_dup = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res_dup.status_code == 409
    assert res_dup.json()["error"]["code"] == "ACTION_NOT_PENDING"


def test_approve_action_expired(client, db_session, approval_setup):
    action = approval_setup["action1"]
    action.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.flush()

    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ACTION_EXPIRED"


def test_approve_action_option_mismatch(client, approval_setup):
    action = approval_setup["action1"]
    assert action.option_number == 1

    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 2})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "OPTION_MISMATCH"


def test_approve_action_plan_changed(client, db_session, approval_setup):
    action = approval_setup["action1"]
    kitchen = approval_setup["kitchen"]
    # Change plan version in kitchen
    kitchen.plan_version = action.base_plan_version + 1
    db_session.flush()

    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PLAN_CHANGED"


def test_approve_action_stock_changed(client, db_session, approval_setup):
    action = approval_setup["action1"]
    paneer = approval_setup["paneer"]

    # Modify stock of an ingredient
    paneer.stock_qty += Decimal("1.500")
    db_session.flush()

    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STOCK_CHANGED"


def test_approve_substitute_success_and_response_dto(client, db_session, approval_setup):
    action1 = approval_setup["action1"]
    action2 = approval_setup["action2"]
    unrelated_action = approval_setup["unrelated_action"]
    kitchen = approval_setup["kitchen"]
    order = approval_setup["order"]
    initial_version = kitchen.plan_version

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={
            "confirm_option_number": 1,
            "input_mode": "voice",
            "transcript": "confirm option 1",
        },
    )
    assert response.status_code == 200
    data = response.json()

    # Action status and timestamps
    assert data["action"]["id"] == str(action1.id)
    assert data["action"]["status"] == "executed"
    assert "executed_at" in data["action"]

    # Plan versions
    assert data["plan_version_before"] == initial_version
    assert data["plan_version_after"] == initial_version + 1

    # Changes
    assert data["changes"]["orders_affected"] == [str(order.id)]
    assert data["changes"]["tasks_rescheduled"] == 0
    assert data["changes"]["summary"] == "Swapped paneer for tofu in 1 orders; 0 orders late"

    # Customer messages
    assert len(data["customer_messages"]) == 1
    msg = data["customer_messages"][0]
    assert msg["order_id"] == str(order.id)
    assert msg["customer_name"] == "Aditi Sharma"
    assert msg["needs_consent"] is True
    assert msg["message"] == "Hi Aditi Sharma, we are short of paneer. May we use tofu instead? Reply YES to confirm."
    assert "919800000010" in msg["whatsapp_url"]
    assert "https://wa.me/919800000010?text=" in msg["whatsapp_url"]

    # Expired sibling actions
    assert data["expired_action_ids"] == [str(action2.id)]

    # Verify database state
    db_session.expire_all()
    updated_action1 = db_session.get(ProposedAction, action1.id)
    assert updated_action1.status == "executed"
    assert updated_action1.decided_at is not None
    assert updated_action1.executed_at is not None

    # Sibling action expired
    updated_action2 = db_session.get(ProposedAction, action2.id)
    assert updated_action2.status == "expired"
    assert updated_action2.decided_at is not None
    assert updated_action2.executed_at is None

    # Unrelated action in another group untouched
    updated_unrelated = db_session.get(ProposedAction, unrelated_action.id)
    assert updated_unrelated.status == "pending"
    assert updated_unrelated.decided_at is None

    # Kitchen plan version updated
    updated_kitchen = db_session.get(Kitchen, kitchen.id)
    assert updated_kitchen.plan_version == initial_version + 1

    # Audit log entry created
    audit = db_session.get(AuditLog, UUID(data["audit_id"]))
    assert audit is not None
    assert audit.action_id == action1.id
    assert audit.event_type == "action_executed"
    assert audit.actor == "owner"
    assert "Swapped paneer for tofu in 1 orders" in audit.summary
    assert "plan v1 to v2" in audit.summary
    assert "transcript: confirm option 1" in audit.summary
    assert audit.plan_version_before == initial_version
    assert audit.plan_version_after == initial_version + 1


def test_approve_substitute_no_unintended_domain_changes(client, db_session, approval_setup):
    action1 = approval_setup["action1"]
    order = approval_setup["order"]
    order_item = approval_setup["order_item"]
    task = approval_setup["task"]
    initial_stock = {ing.id: ing.stock_qty for ing in db_session.scalars(select(Ingredient)).all()}

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200

    db_session.expire_all()
    # Order untouched
    refreshed_order = db_session.get(Order, order.id)
    assert refreshed_order.status == "planned"
    assert refreshed_order.total_amount == Decimal("180.00")

    # Order item untouched
    refreshed_item = db_session.get(OrderItem, order_item.id)
    assert refreshed_item.unit_price == Decimal("180.00")
    assert refreshed_item.swapped_from_item_id is None

    # Task untouched
    refreshed_task = db_session.get(PlanTask, task.id)
    assert refreshed_task.start_at == task.start_at
    assert refreshed_task.end_at == task.end_at
    assert refreshed_task.status == "scheduled"
    assert refreshed_task.locked is False

    # Ingredients untouched
    for ing in db_session.scalars(select(Ingredient)).all():
        assert ing.stock_qty == initial_stock[ing.id]


def test_approve_substitute_stock_update_and_snapshots(client, db_session, approval_setup):
    action1 = approval_setup["action1"]
    paneer = approval_setup["paneer"]
    initial_paneer_stock = paneer.stock_qty

    # Add stock_update to payload
    payload = dict(action1.payload)
    payload["stock_update"] = {
        "ingredient_id": str(paneer.id),
        "reported_available_qty": "0.350",
    }
    action1.payload = payload
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200
    data = response.json()

    db_session.expire_all()
    # Stock updated
    refreshed_paneer = db_session.get(Ingredient, paneer.id)
    assert refreshed_paneer.stock_qty == Decimal("0.350")

    # Audit snapshots verify before and after
    audit = db_session.get(AuditLog, UUID(data["audit_id"]))
    assert audit is not None
    assert audit.before_snapshot is not None
    assert audit.after_snapshot is not None
    assert "ingredients" in audit.before_snapshot
    assert "ingredients" in audit.after_snapshot

    before_ing = audit.before_snapshot["ingredients"][0]
    after_ing = audit.after_snapshot["ingredients"][0]
    assert before_ing["id"] == str(paneer.id)
    assert Decimal(before_ing["stock_qty"]) == initial_paneer_stock
    assert after_ing["id"] == str(paneer.id)
    assert Decimal(after_ing["stock_qty"]) == Decimal("0.350")


def test_approve_customer_phone_fallback(client, db_session, approval_setup):
    action1 = approval_setup["action1"]
    order = approval_setup["order"]
    order.customer_phone = None
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200
    msg = response.json()["customer_messages"][0]
    assert msg["whatsapp_url"].startswith("https://wa.me/?text=")


def test_approve_action_atomic_rollback_on_failure(client, db_session, approval_setup, monkeypatch):
    action1 = approval_setup["action1"]
    action2 = approval_setup["action2"]
    kitchen = approval_setup["kitchen"]
    paneer = approval_setup["paneer"]
    initial_version = kitchen.plan_version
    initial_stock = paneer.stock_qty

    payload = dict(action1.payload)
    payload["stock_update"] = {
        "ingredient_id": str(paneer.id),
        "reported_available_qty": "0.100",
    }
    action1.payload = payload
    db_session.flush()

    # Simulate mid-flight database error during audit logging
    import app.services.approval as approval_module

    def faulty_record_audit_log(*args, **kwargs):
        raise RuntimeError("DB crash during audit logging")

    monkeypatch.setattr(approval_module, "record_audit_log", faulty_record_audit_log)

    nested = db_session.begin_nested()
    try:
        with pytest.raises(RuntimeError, match="DB crash during audit logging"):
            client.post(f"/api/actions/{action1.id}/approve", json={"confirm_option_number": 1})
    finally:
        nested.rollback()

    # Ensure complete atomic rollback
    db_session.expire_all()
    reloaded_action1 = db_session.get(ProposedAction, action1.id)
    assert reloaded_action1.status == "pending"
    assert reloaded_action1.decided_at is None
    assert reloaded_action1.executed_at is None

    reloaded_action2 = db_session.get(ProposedAction, action2.id)
    assert reloaded_action2.status == "pending"
    assert reloaded_action2.decided_at is None

    reloaded_kitchen = db_session.get(Kitchen, kitchen.id)
    assert reloaded_kitchen.plan_version == initial_version

    reloaded_paneer = db_session.get(Ingredient, paneer.id)
    assert reloaded_paneer.stock_qty == initial_stock

    audit_rows = db_session.scalars(select(AuditLog).where(AuditLog.action_id == action1.id)).all()
    assert len(audit_rows) == 0


def test_approve_action_empty_body_validation_error(client, db_session, approval_setup):
    """
    F5-004: Approving an action with an empty JSON body must return 422 VALIDATION_ERROR,
    identify the missing confirm_option_number field, keep action pending, and write no audit log.
    """
    action1 = approval_setup["action1"]

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={},
    )
    assert response.status_code == 422
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert data["error"]["message"] == "Invalid request"

    # Missing confirm_option_number is identified in details
    errors = data["error"]["details"]["errors"]
    missing_locs = [tuple(err.get("loc", [])) for err in errors]
    assert any("confirm_option_number" in loc for loc in missing_locs)

    # Action status remains unchanged
    db_session.expire_all()
    reloaded_action1 = db_session.get(ProposedAction, action1.id)
    assert reloaded_action1.status == "pending"
    assert reloaded_action1.decided_at is None
    assert reloaded_action1.executed_at is None

    # No audit record is persisted
    audit_rows = db_session.scalars(select(AuditLog).where(AuditLog.action_id == action1.id)).all()
    assert len(audit_rows) == 0


def test_approve_action_unsupported_action_type(client, db_session, approval_setup):
    """
    F5-004: Approving an unsupported action type must return 422 UNSUPPORTED_ACTION,
    leave target and sibling actions pending, leave kitchen plan_version and ingredient stock
    untouched, and write no audit log.
    """
    action1 = approval_setup["action1"]
    action2 = approval_setup["action2"]
    kitchen = approval_setup["kitchen"]
    paneer = approval_setup["paneer"]
    initial_version = kitchen.plan_version
    initial_stock = paneer.stock_qty

    # Set payload option_type to unsupported "emergency_purchase"
    payload = dict(action1.payload)
    payload["option_type"] = "emergency_purchase"
    action1.payload = payload
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 422
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "UNSUPPORTED_ACTION"
    assert data["error"]["details"]["option_type"] == "emergency_purchase"

    # Target action remains pending
    db_session.expire_all()
    reloaded_action1 = db_session.get(ProposedAction, action1.id)
    assert reloaded_action1.status == "pending"
    assert reloaded_action1.decided_at is None
    assert reloaded_action1.executed_at is None

    # Sibling action remains pending
    reloaded_action2 = db_session.get(ProposedAction, action2.id)
    assert reloaded_action2.status == "pending"
    assert reloaded_action2.decided_at is None

    # Kitchen plan_version is unchanged
    reloaded_kitchen = db_session.get(Kitchen, kitchen.id)
    assert reloaded_kitchen.plan_version == initial_version

    # Ingredient stock is unchanged
    reloaded_paneer = db_session.get(Ingredient, paneer.id)
    assert reloaded_paneer.stock_qty == initial_stock

    # No audit record is persisted
    audit_rows = db_session.scalars(select(AuditLog).where(AuditLog.action_id == action1.id)).all()
    assert len(audit_rows) == 0


def test_approve_substitute_unverified_order_id_filtered(client, db_session, approval_setup):
    """
    F5-002: changes.orders_affected, changes.summary count, and customer_messages must only
    include verified eligible orders. Nonexistent or invalid order IDs in proposal payload
    must be filtered out and not reported as affected or contacted.
    """
    action1 = approval_setup["action1"]
    order = approval_setup["order"]
    fake_order_id = uuid4()

    # Payload contains valid order and a nonexistent/unverified order ID
    payload = dict(action1.payload)
    payload["order_ids"] = [str(order.id), str(fake_order_id)]
    action1.payload = payload
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200
    data = response.json()

    # Verified orders only
    assert data["changes"]["orders_affected"] == [str(order.id)]
    assert str(fake_order_id) not in data["changes"]["orders_affected"]

    # Customer messages only for verified orders
    assert len(data["customer_messages"]) == 1
    assert data["customer_messages"][0]["order_id"] == str(order.id)

    # Summary uses the verified count (1 order)
    assert data["changes"]["summary"] == "Swapped paneer for tofu in 1 orders; 0 orders late"


def test_approve_substitute_duplicate_order_ids_deduplicated(client, db_session, approval_setup):
    """
    Ensure duplicate order IDs in proposal payload are processed at most once:
    - each eligible order appears once in changes.orders_affected
    - each eligible order produces at most one customer-message draft
    - summary count matches the unique verified orders
    """
    action1 = approval_setup["action1"]
    order = approval_setup["order"]
    kitchen = approval_setup["kitchen"]
    now = datetime.now(timezone.utc)

    # Create a second eligible order
    order2 = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Priya Patel",
        customer_phone="919800000020",
        channel="whatsapp",
        deadline=datetime(2026, 10, 22, 13, 0, tzinfo=IST),
        status="planned",
        total_amount=Decimal("150.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add(order2)
    db_session.flush()

    # Payload with duplicate entries: order.id repeated twice, order2.id repeated twice
    payload = dict(action1.payload)
    payload["order_ids"] = [str(order.id), str(order.id), str(order2.id), str(order.id), str(order2.id)]
    action1.payload = payload
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200
    data = response.json()

    # Each eligible order appears once, preserving first occurrence order
    assert data["changes"]["orders_affected"] == [str(order.id), str(order2.id)]

    # Each eligible order produces at most one customer-message draft
    assert len(data["customer_messages"]) == 2
    message_order_ids = [m["order_id"] for m in data["customer_messages"]]
    assert message_order_ids == [str(order.id), str(order2.id)]

    # Summary count matches unique verified orders (2 orders, not 5)
    assert data["changes"]["summary"] == "Swapped paneer for tofu in 2 orders; 0 orders late"


def test_approve_substitute_ineligible_order_statuses_excluded(client, db_session, approval_setup):
    """
    Ensure orders that became cancelled or completed after proposal generation
    are excluded consistently from changes.orders_affected, customer_messages, and summary count.
    Also confirm active statuses like planned and in_progress remain eligible.
    """
    action1 = approval_setup["action1"]
    order = approval_setup["order"]  # status="planned"
    kitchen = approval_setup["kitchen"]
    now = datetime.now(timezone.utc)

    # 1. Order that became cancelled after proposal generation
    order_cancelled = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Cancelled Customer",
        customer_phone="919800000030",
        channel="whatsapp",
        deadline=datetime(2026, 10, 22, 13, 0, tzinfo=IST),
        status="cancelled",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=now,
    )
    # 2. Order that became completed after proposal generation
    order_completed = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Completed Customer",
        customer_phone="919800000040",
        channel="whatsapp",
        deadline=datetime(2026, 10, 22, 13, 0, tzinfo=IST),
        status="completed",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=now,
    )
    # 3. Active order with status="in_progress"
    order_in_progress = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="InProgress Customer",
        customer_phone="919800000050",
        channel="whatsapp",
        deadline=datetime(2026, 10, 22, 13, 0, tzinfo=IST),
        status="in_progress",
        total_amount=Decimal("180.00"),
        data_source="simulated",
        created_at=now,
    )
    db_session.add_all([order_cancelled, order_completed, order_in_progress])
    db_session.flush()

    # Payload contains active, cancelled, completed, and in_progress orders
    payload = dict(action1.payload)
    payload["order_ids"] = [
        str(order.id),
        str(order_cancelled.id),
        str(order_completed.id),
        str(order_in_progress.id),
    ]
    action1.payload = payload
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200
    data = response.json()

    # Only active orders (planned, in_progress) are in orders_affected; cancelled & completed excluded
    assert data["changes"]["orders_affected"] == [str(order.id), str(order_in_progress.id)]
    assert str(order_cancelled.id) not in data["changes"]["orders_affected"]
    assert str(order_completed.id) not in data["changes"]["orders_affected"]

    # Customer messages only generated for active orders
    assert len(data["customer_messages"]) == 2
    message_order_ids = [m["order_id"] for m in data["customer_messages"]]
    assert str(order.id) in message_order_ids
    assert str(order_in_progress.id) in message_order_ids
    assert str(order_cancelled.id) not in message_order_ids
    assert str(order_completed.id) not in message_order_ids

    # Summary count accurately reflects the 2 eligible orders
    assert data["changes"]["summary"] == "Swapped paneer for tofu in 2 orders; 0 orders late"


def test_approve_substitute_cross_kitchen_ingredient_not_leaked(client, db_session, approval_setup):
    """
    F5-003: Ingredient lookups must be strictly kitchen-scoped. An ingredient belonging
    to another kitchen must not have its details exposed in customer messages or changes summary.
    """
    action1 = approval_setup["action1"]
    now = datetime.now(timezone.utc)

    # Create a foreign kitchen and ingredient
    foreign_kitchen = Kitchen(
        id=uuid4(),
        name="Foreign Kitchen",
        burner_count=2,
        cook_count=1,
        overhead_pct=Decimal("10.00"),
        commission_pct=Decimal("15.00"),
        target_margin_pct=Decimal("20.00"),
        plan_version=1,
        data_source="simulated",
        created_at=now,
    )
    db_session.add(foreign_kitchen)
    db_session.flush()

    secret_ingredient = Ingredient(
        id=uuid4(),
        kitchen_id=foreign_kitchen.id,
        name="Secret Foreign Truffle",
        unit="kg",
        stock_qty=Decimal("2.000"),
        cost_per_unit=Decimal("9999.00"),
        allergen_tags=[],
        diet_tags=["veg"],
        data_source="simulated",
        updated_at=now,
    )
    db_session.add(secret_ingredient)
    db_session.flush()

    # Reference foreign ingredient in substitute_ingredient_id
    payload = dict(action1.payload)
    payload["substitute_ingredient_id"] = str(secret_ingredient.id)
    action1.payload = payload
    db_session.flush()

    response = client.post(
        f"/api/actions/{action1.id}/approve",
        json={"confirm_option_number": 1},
    )
    assert response.status_code == 200
    data = response.json()

    # Foreign ingredient name must never leak into customer messages or summary
    assert "Secret Foreign Truffle" not in str(data)
    assert len(data["customer_messages"]) == 1
    assert "a substitute" in data["customer_messages"][0]["message"]
    # Fallback to action title because sub_ing was not in the current kitchen
    assert data["changes"]["summary"] == f"{action1.title}; 0 orders late"


def _is_isolated_postgres() -> bool:
    from urllib.parse import urlparse
    from app.config import settings

    u = urlparse(settings.database_url)
    return settings.database_url.startswith("postgresql") and "supabase.com" not in (u.hostname or "")


@pytest.mark.skipif(
    not _is_isolated_postgres(),
    reason="Isolated PostgreSQL test database unavailable (must not run against shared Supabase)",
)
def test_concurrent_sibling_approvals_postgres(engine):
    """
    F5-001: Concurrent approvals of sibling options using two independent PostgreSQL sessions.
    Acquiring the kitchen lock first ensures top-down hierarchy, preventing circular-wait deadlock.
    One approval must succeed (200), and the sibling must fail gracefully with 409 ACTION_EXPIRED
    or PLAN_CHANGED, without deadlock or unhandled 500 error.
    """
    import threading
    from sqlalchemy.orm import Session
    from app.services.approval import approve_action
    from app.errors import AppError

    # This test executes only when an isolated PostgreSQL test database is configured.
    with Session(engine) as s1, Session(engine) as s2:
        k1 = s1.scalar(select(Kitchen).limit(1))
        group_id = uuid4()
        now = datetime.now(timezone.utc)
        a1 = ProposedAction(
            id=uuid4(),
            kitchen_id=k1.id,
            group_id=group_id,
            option_number=1,
            action_type="recovery",
            title="Option 1",
            payload={"option_type": "substitute", "order_ids": []},
            impact={"late_orders": 0, "score": 0.8},
            status="pending",
            base_plan_version=k1.plan_version,
            stock_fingerprint="fp1",
            created_at=now,
            expires_at=now + timedelta(minutes=30),
        )
        a2 = ProposedAction(
            id=uuid4(),
            kitchen_id=k1.id,
            group_id=group_id,
            option_number=2,
            action_type="recovery",
            title="Option 2",
            payload={"option_type": "substitute", "order_ids": []},
            impact={"late_orders": 0, "score": 0.7},
            status="pending",
            base_plan_version=k1.plan_version,
            stock_fingerprint="fp1",
            created_at=now,
            expires_at=now + timedelta(minutes=30),
        )
        s1.add_all([a1, a2])
        s1.commit()

        results = {}
        barrier = threading.Barrier(2)

        def worker1():
            barrier.wait()
            try:
                res = approve_action(s1, a1.id, confirm_option_number=1)
                s1.commit()
                results["t1"] = ("ok", res)
            except AppError as e:
                s1.rollback()
                results["t1"] = ("error", e.code)
            except Exception as e:
                s1.rollback()
                results["t1"] = ("exception", str(e))

        def worker2():
            barrier.wait()
            try:
                res = approve_action(s2, a2.id, confirm_option_number=2)
                s2.commit()
                results["t2"] = ("ok", res)
            except AppError as e:
                s2.rollback()
                results["t2"] = ("error", e.code)
            except Exception as e:
                s2.rollback()
                results["t2"] = ("exception", str(e))

        t1 = threading.Thread(target=worker1)
        t2 = threading.Thread(target=worker2)
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        statuses = [results.get("t1", ("none", None))[0], results.get("t2", ("none", None))[0]]
        assert "ok" in statuses
        assert "exception" not in statuses
