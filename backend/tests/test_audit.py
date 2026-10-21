from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models import AuditLog, Ingredient, Kitchen, Order, OrderItem, PlanTask, ProposedAction
from app.services.audit import record_audit_log
from app.services.recovery import _fingerprint


def _audit(db, kitchen, event_type, summary, *, before=None, after=None, action_id=None):
    return record_audit_log(
        db,
        kitchen_id=kitchen.id,
        event_type=event_type,
        actor="owner",
        summary=summary,
        action_id=action_id,
        before_snapshot=before,
        after_snapshot=after,
    )


def _execute_stock_change(db, kitchen, ingredient):
    now = datetime.now(timezone.utc)
    ingredients = db.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    action = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=uuid4(), option_number=1,
        action_type="recovery", title="Update stock", payload={
            "option_type": "substitute", "stock_update": {
                "ingredient_id": str(ingredient.id), "reported_available_qty": "0.250"
            }, "order_ids": []
        }, impact={}, status="pending", base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients), created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    db.add(action)
    db.flush()
    return action


@pytest.fixture
def audit_setup(db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer"))
    now = datetime.now(timezone.utc)
    order = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Aditi", customer_phone=None,
        channel="direct", deadline=now + timedelta(hours=3), status="planned",
        total_amount=Decimal("180.00"), data_source="simulated", created_at=now,
    )
    db_session.add(order)
    db_session.flush()
    from app.models import MenuItem
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id).limit(1))
    item = OrderItem(id=uuid4(), order_id=order.id, menu_item_id=menu.id, quantity=1, unit_price=Decimal("180.00"))
    db_session.add(item)
    db_session.flush()
    task = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=item.id, task_type="cook", burner_no=1,
        cook_no=1, start_at=now, end_at=now + timedelta(minutes=30), status="scheduled",
        locked=False, plan_version=kitchen.plan_version,
    )
    db_session.add(task)
    db_session.flush()
    return {"kitchen": kitchen, "paneer": paneer, "order": order, "order_item": item, "task": task}


def test_audit_list_filter_limit_and_snapshots(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    older = _audit(db_session, kitchen, "order_created", "older")
    newer = _audit(db_session, kitchen, "action_rejected", "newer", before={"x": 1}, after={"x": 2})
    db_session.flush()

    response = client.get("/api/audit?limit=1")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["data"]] == [str(newer.id)]
    assert "before_snapshot" not in response.json()["data"][0]

    response = client.get("/api/audit?event_type=order_created&include_snapshots=true")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["data"]] == [str(older.id)]
    assert response.json()["data"][0]["before_snapshot"] is None


@pytest.mark.parametrize("query", ["limit=0", "limit=201", "event_type=bogus"])
def test_audit_list_validation_errors(client, query):
    response = client.get(f"/api/audit?{query}")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_undoable_only_latest_unundone_executed_change(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    first = _audit(db_session, kitchen, "action_executed", "first")
    second = _audit(db_session, kitchen, "action_executed", "second")
    rejected = _audit(db_session, kitchen, "action_rejected", "rejected")
    db_session.flush()
    response = client.get("/api/audit")
    assert response.status_code == 200
    flags = {r["id"]: r["undoable"] for r in response.json()["data"]}
    assert flags[str(second.id)] is True
    assert flags[str(first.id)] is False
    assert flags[str(rejected.id)] is False


def test_undo_pending_then_approval_restores_stock_and_logs(client, db_session, audit_setup):
    kitchen = audit_setup["kitchen"]
    paneer = audit_setup["paneer"]
    before_stock = paneer.stock_qty
    action = _execute_stock_change(db_session, kitchen, paneer)
    approved = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert approved.status_code == 200
    source = db_session.get(AuditLog, UUID(approved.json()["audit_id"]))
    assert paneer.stock_qty == Decimal("0.250")
    version = kitchen.plan_version

    proposal = client.post(f"/api/audit/{source.id}/undo")
    assert proposal.status_code == 201
    result = proposal.json()["action"]
    assert result["action_type"] == "undo"
    assert result["status"] == "pending"
    assert result["option_number"] == 1
    assert result["undo_of_audit_id"] == str(source.id)
    assert paneer.stock_qty == Decimal("0.250")
    assert kitchen.plan_version == version

    applied = client.post(f"/api/actions/{result['id']}/approve", json={"confirm_option_number": 1})
    assert applied.status_code == 200
    db_session.refresh(paneer)
    db_session.refresh(kitchen)
    assert paneer.stock_qty == before_stock
    assert kitchen.plan_version == version + 1
    undo_log = db_session.get(AuditLog, UUID(applied.json()["audit_id"]))
    assert undo_log.event_type == "undo_executed"
    assert undo_log.before_snapshot and undo_log.after_snapshot
    twice = client.post(f"/api/actions/{result['id']}/approve", json={"confirm_option_number": 1})
    assert twice.status_code == 409
    assert twice.json()["error"]["code"] == "ACTION_NOT_PENDING"
    already_undone = client.post(f"/api/audit/{source.id}/undo")
    assert already_undone.status_code == 409
    assert already_undone.json()["error"]["code"] == "UNDO_NOT_ALLOWED"


def test_undo_only_latest_and_once(client, db_session, audit_setup):
    kitchen = audit_setup["kitchen"]
    first = _audit(db_session, kitchen, "action_executed", "first", before={"ingredients": []}, after={"ingredients": []})
    second = _audit(db_session, kitchen, "action_executed", "second", before={"ingredients": []}, after={"ingredients": []})
    db_session.flush()
    response = client.post(f"/api/audit/{first.id}/undo")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "UNDO_NOT_ALLOWED"
    response = client.post(f"/api/audit/{second.id}/undo")
    assert response.status_code == 201
    repeated = client.post(f"/api/audit/{second.id}/undo")
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "UNDO_NOT_ALLOWED"


def test_undo_rejected_when_before_snapshot_is_empty(client, db_session, audit_setup):
    entry = _audit(db_session, audit_setup["kitchen"], "action_executed", "empty snapshot")
    db_session.flush()
    response = client.post(f"/api/audit/{entry.id}/undo")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "UNDO_NOT_ALLOWED"


@pytest.mark.parametrize("event_type", ["action_rejected", "order_created"])
def test_undo_non_executed_audit_rejected(client, db_session, audit_setup, event_type):
    entry = _audit(db_session, audit_setup["kitchen"], event_type, event_type)
    db_session.flush()
    response = client.post(f"/api/audit/{entry.id}/undo")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "UNDO_NOT_ALLOWED"


def test_unknown_audit_undo(client):
    response = client.post(f"/api/audit/{uuid4()}/undo")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "AUDIT_NOT_FOUND"


def test_undo_restores_all_snapshotted_rows_and_removes_added_rows(client, db_session, audit_setup):
    kitchen, order, item, task = (audit_setup[k] for k in ("kitchen", "order", "order_item", "task"))
    ingredient = audit_setup["paneer"]
    before = {
        "ingredients": [{"id": str(ingredient.id), "kitchen_id": str(kitchen.id), "name": ingredient.name,
                         "unit": ingredient.unit, "stock_qty": "1.000", "cost_per_unit": "380.00",
                         "allergen_tags": ["dairy"], "diet_tags": ["veg"], "data_source": "simulated",
                         "updated_at": ingredient.updated_at.isoformat()}],
        "orders": [{"id": str(order.id), "kitchen_id": str(kitchen.id), "customer_name": order.customer_name,
                    "customer_phone": order.customer_phone, "channel": order.channel,
                    "deadline": order.deadline.isoformat(), "status": order.status,
                    "total_amount": "180.00", "source_text": None, "extraction_confidence": None,
                    "data_source": order.data_source, "created_at": order.created_at.isoformat()}],
        "order_items": [{"id": str(item.id), "order_id": str(item.order_id), "menu_item_id": str(item.menu_item_id),
                         "quantity": 1, "unit_price": "180.00", "swapped_from_item_id": None}],
        "plan_tasks": [{"id": str(task.id), "kitchen_id": str(task.kitchen_id), "order_item_id": str(task.order_item_id),
                        "task_type": task.task_type, "burner_no": task.burner_no, "cook_no": task.cook_no,
                        "start_at": task.start_at.isoformat(), "end_at": task.end_at.isoformat(),
                        "status": task.status, "locked": False, "plan_version": task.plan_version}],
    }
    after = {key: [dict(row) for row in value] for key, value in before.items()}
    after["ingredients"][0]["stock_qty"] = "0.500"
    after["orders"][0]["total_amount"] = "99.00"
    after["order_items"][0]["quantity"] = 2
    after["plan_tasks"][0]["locked"] = True
    after["plan_tasks"][0]["start_at"] = (task.start_at + timedelta(minutes=5)).isoformat()
    extra_id = str(uuid4())
    after["orders"].append({**after["orders"][0], "id": extra_id})
    source = _audit(db_session, kitchen, "action_executed", "synthetic snapshot", before=before, after=after)
    db_session.flush()
    # Current state is the after state, including an extra order. The stock fingerprint is current.
    ingredient.stock_qty = Decimal("0.500")
    order.total_amount = Decimal("99.00")
    item.quantity = 2
    task.locked = False
    task.start_at = task.start_at + timedelta(minutes=5)
    added = Order(**{**{c.name: getattr(order, c.name) for c in Order.__table__.columns}, "id": UUID(extra_id), "total_amount": Decimal("99.00")})
    db_session.add(added)
    db_session.flush()
    proposal = client.post(f"/api/audit/{source.id}/undo")
    assert proposal.status_code == 201
    result = client.post(f"/api/actions/{proposal.json()['action']['id']}/approve", json={"confirm_option_number": 1})
    assert result.status_code == 200
    db_session.refresh(ingredient); db_session.refresh(order); db_session.refresh(item); db_session.refresh(task)
    assert ingredient.stock_qty == Decimal("1.000")
    assert order.total_amount == Decimal("180.00")
    assert item.quantity == 1
    assert task.start_at.replace(tzinfo=timezone.utc) == datetime.fromisoformat(before["plan_tasks"][0]["start_at"])
    assert db_session.get(Order, added.id) is None


def test_locked_task_prevents_undo_movement(client, db_session, audit_setup):
    kitchen, task = audit_setup["kitchen"], audit_setup["task"]
    before = {"plan_tasks": [{"id": str(task.id), "kitchen_id": str(task.kitchen_id),
                              "order_item_id": str(task.order_item_id), "task_type": task.task_type,
                              "burner_no": task.burner_no, "cook_no": task.cook_no,
                              "start_at": task.start_at.isoformat(), "end_at": task.end_at.isoformat(),
                              "status": task.status, "locked": False, "plan_version": task.plan_version}]}
    after = {"plan_tasks": [{**before["plan_tasks"][0], "start_at": (task.start_at + timedelta(minutes=5)).isoformat()}]}
    source = _audit(db_session, kitchen, "action_executed", "task move", before=before, after=after)
    db_session.flush()
    task.locked = True
    proposal = client.post(f"/api/audit/{source.id}/undo")
    assert proposal.status_code == 201
    applied = client.post(f"/api/actions/{proposal.json()['action']['id']}/approve", json={"confirm_option_number": 1})
    assert applied.status_code == 409
    assert applied.json()["error"]["code"] == "PLAN_CHANGED"


def test_undo_approval_failure_rolls_back_all_changes(client, db_session, audit_setup, monkeypatch):
    from app.services import approval as approval_module
    kitchen, ingredient = audit_setup["kitchen"], audit_setup["paneer"]
    order = audit_setup["order"]

    def snapshot(row):
        values = {}
        for column in row.__table__.columns:
            value = getattr(row, column.name)
            if isinstance(value, UUID):
                value = str(value)
            elif isinstance(value, Decimal):
                value = str(value)
            elif isinstance(value, datetime):
                value = value.isoformat()
            values[column.name] = value
        return values

    before_order = snapshot(order)
    before_ingredient = snapshot(ingredient)
    after_order = {**before_order, "total_amount": "200.00"}
    after_ingredient = {**before_ingredient, "stock_qty": "0.250"}
    order.total_amount = Decimal("200.00")
    ingredient.stock_qty = Decimal("0.250")
    source = _audit(
        db_session,
        kitchen,
        "action_executed",
        "Multi-table change",
        before={"orders": [before_order], "ingredients": [before_ingredient]},
        after={"orders": [after_order], "ingredients": [after_ingredient]},
    )
    db_session.flush()
    proposal = client.post(f"/api/audit/{source.id}/undo")
    undo_id = proposal.json()["action"]["id"]

    restore_value = approval_module._restore_value
    def fail_during_second_table(column, value):
        if column.name == "stock_qty":
            raise RuntimeError("forced midway undo failure")
        return restore_value(column, value)

    monkeypatch.setattr(approval_module, "_restore_value", fail_during_second_table)
    plan_version_before = kitchen.plan_version
    with pytest.raises(RuntimeError, match="forced midway undo failure"):
        client.post(f"/api/actions/{undo_id}/approve", json={"confirm_option_number": 1})
    db_session.refresh(order)
    db_session.refresh(ingredient)
    assert order.total_amount == Decimal("200.00")
    assert ingredient.stock_qty == Decimal("0.250")
    assert db_session.get(ProposedAction, UUID(undo_id)).status == "pending"
    assert db_session.scalar(select(Kitchen.plan_version).where(Kitchen.id == kitchen.id)) == plan_version_before
