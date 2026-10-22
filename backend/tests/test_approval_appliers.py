from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4, UUID

import pytest
from sqlalchemy import delete, select

from app.models import AuditLog, Ingredient, Kitchen, MenuItem, Order, OrderItem, PlanTask, ProposedAction
from app.services.recovery import _fingerprint


def _utc(value):
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _create_order_task(db_session, kitchen, menu, *, start, burner=1, cook_no=1, locked=False, task_type="cook"):
    order = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Kitchen Test", customer_phone="919800000011",
        channel="direct", deadline=start + timedelta(hours=2), status="planned",
        total_amount=Decimal("180.00"), data_source="simulated", created_at=start,
    )
    db_session.add(order)
    db_session.flush()
    item = OrderItem(
        id=uuid4(), order_id=order.id, menu_item_id=menu.id, quantity=1,
        unit_price=Decimal("180.00"), swapped_from_item_id=None,
    )
    db_session.add(item)
    db_session.flush()
    task = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=item.id, task_type=task_type,
        burner_no=burner, cook_no=cook_no, start_at=start, end_at=start + timedelta(minutes=30),
        status="scheduled", locked=locked, plan_version=kitchen.plan_version,
    )
    db_session.add(task)
    db_session.flush()
    return order, item, task


def _create_action(db_session, kitchen, *, payload, option_number=1, group_id=None):
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    now = datetime.now(timezone.utc)
    action = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=group_id or uuid4(), option_number=option_number,
        action_type="recovery", title="Test recovery", payload=payload, impact={}, status="pending",
        base_plan_version=kitchen.plan_version, stock_fingerprint=_fingerprint(ingredients),
        created_at=now, expires_at=now + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()
    return action


def test_dish_swap_keeps_customer_price_and_undo_restores_state(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    original_menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani")
    )
    swapped_menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Veg Pulao")
    )
    now = datetime.now(timezone.utc)
    order = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Test Customer", customer_phone="919800000010",
        channel="direct", deadline=now + timedelta(hours=3), status="planned",
        total_amount=Decimal("360.00"), data_source="simulated", created_at=now,
    )
    db_session.add(order)
    db_session.flush()
    item = OrderItem(
        id=uuid4(), order_id=order.id, menu_item_id=original_menu.id, quantity=2,
        unit_price=Decimal("180.00"), swapped_from_item_id=None,
    )
    db_session.add(item)
    db_session.flush()
    start = now.replace(second=0, microsecond=0)
    prep = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=item.id, task_type="prep", burner_no=None,
        cook_no=1, start_at=start, end_at=start + timedelta(minutes=15), status="scheduled",
        locked=False, plan_version=kitchen.plan_version,
    )
    cook = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=item.id, task_type="cook", burner_no=1,
        cook_no=1, start_at=start + timedelta(minutes=15), end_at=start + timedelta(minutes=50),
        status="scheduled", locked=False, plan_version=kitchen.plan_version,
    )
    db_session.add_all([prep, cook])
    db_session.flush()

    before = {
        "menu_item_id": item.menu_item_id,
        "swapped_from_item_id": item.swapped_from_item_id,
        "unit_price": item.unit_price,
        "total_amount": order.total_amount,
        "stock_qty": paneer.stock_qty,
        "prep_start": prep.start_at,
        "prep_end": prep.end_at,
        "cook_start": cook.start_at,
        "cook_end": cook.end_at,
        "prep_version": prep.plan_version,
        "cook_version": cook.plan_version,
    }
    fingerprint = _fingerprint(
        db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    )
    group_id = uuid4()
    now = datetime.now(timezone.utc)
    action = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=group_id, option_number=1,
        action_type="recovery", title="Swap to Veg Pulao", payload={
            "option_type": "dish_swap",
            "swaps": [{"order_item_id": str(item.id), "menu_item_id": str(swapped_menu.id)}],
            "stock_update": {"ingredient_id": str(paneer.id), "reported_available_qty": "0.600"},
        }, impact={}, status="pending", base_plan_version=kitchen.plan_version,
        stock_fingerprint=fingerprint, created_at=now, expires_at=now + timedelta(minutes=30),
    )
    sibling = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=group_id, option_number=2,
        action_type="recovery", title="Sibling option", payload={"option_type": "dish_swap", "swaps": []},
        impact={}, status="pending", base_plan_version=kitchen.plan_version,
        stock_fingerprint=fingerprint, created_at=now, expires_at=now + timedelta(minutes=30),
    )
    db_session.add_all([action, sibling])
    db_session.flush()

    approved = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert approved.status_code == 200
    db_session.refresh(item)
    db_session.refresh(order)
    db_session.refresh(paneer)
    db_session.refresh(prep)
    db_session.refresh(cook)
    db_session.refresh(kitchen)
    db_session.refresh(sibling)
    assert item.menu_item_id == swapped_menu.id
    assert item.swapped_from_item_id == original_menu.id
    assert item.unit_price == before["unit_price"]
    assert order.total_amount == before["total_amount"]
    assert paneer.stock_qty == Decimal("0.600")
    assert _utc(prep.start_at) == _utc(before["prep_start"])
    assert _utc(prep.end_at) == _utc(prep.start_at) + timedelta(minutes=swapped_menu.prep_minutes)
    assert _utc(cook.start_at) == _utc(before["cook_start"])
    assert _utc(cook.end_at) == _utc(cook.start_at) + timedelta(minutes=swapped_menu.cook_minutes)
    assert kitchen.plan_version == action.base_plan_version + 1
    assert sibling.status == "expired"
    audit = db_session.get(AuditLog, UUID(approved.json()["audit_id"]))
    assert audit.event_type == "action_executed"
    assert set(audit.before_snapshot) == {"ingredients", "order_items", "plan_tasks"}
    assert set(audit.after_snapshot) == set(audit.before_snapshot)
    assert {row["id"] for row in audit.before_snapshot["order_items"]} == {str(item.id)}
    assert {row["id"] for row in audit.after_snapshot["order_items"]} == {str(item.id)}

    repeated = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "ACTION_NOT_PENDING"

    undo_proposal = client.post(f"/api/audit/{audit.id}/undo")
    assert undo_proposal.status_code == 201
    undo_id = undo_proposal.json()["action"]["id"]
    undone = client.post(f"/api/actions/{undo_id}/approve", json={"confirm_option_number": 1})
    assert undone.status_code == 200
    db_session.refresh(item)
    db_session.refresh(order)
    db_session.refresh(paneer)
    db_session.refresh(prep)
    db_session.refresh(cook)
    assert item.menu_item_id == before["menu_item_id"]
    assert item.swapped_from_item_id == before["swapped_from_item_id"]
    assert item.unit_price == before["unit_price"]
    assert order.total_amount == before["total_amount"]
    assert paneer.stock_qty == before["stock_qty"]
    assert _utc(prep.start_at) == _utc(before["prep_start"])
    assert _utc(prep.end_at) == _utc(before["prep_end"])
    assert prep.plan_version == before["prep_version"]
    assert _utc(cook.start_at) == _utc(before["cook_start"])
    assert _utc(cook.end_at) == _utc(before["cook_end"])
    assert cook.plan_version == before["cook_version"]


def test_emergency_purchase_applies_snapshots_and_undoes_exactly(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani"))
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    order, item, task = _create_order_task(db_session, kitchen, menu, start=now)
    locked_task = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=item.id, task_type="cook", burner_no=2,
        cook_no=2, start_at=now + timedelta(hours=2), end_at=now + timedelta(hours=2, minutes=30),
        status="scheduled", locked=True, plan_version=kitchen.plan_version,
    )
    db_session.add(locked_task)
    db_session.flush()
    prior = {
        "stock": paneer.stock_qty,
        "order_status": order.status,
        "task_start": task.start_at,
        "task_end": task.end_at,
        "task_version": task.plan_version,
        "locked_start": locked_task.start_at,
        "locked_end": locked_task.end_at,
    }
    group_id = uuid4()
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(paneer.id),
        "quantity": "0.400", "delay_minutes": 30, "order_ids": [str(order.id)],
        "stock_update": {"ingredient_id": str(paneer.id), "reported_available_qty": "0.500"},
    }, group_id=group_id)
    sibling = _create_action(
        db_session, kitchen, payload={"option_type": "emergency_purchase"},
        option_number=2, group_id=group_id,
    )

    approved = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert approved.status_code == 200
    db_session.refresh(paneer)
    db_session.refresh(order)
    db_session.refresh(task)
    db_session.refresh(locked_task)
    db_session.refresh(kitchen)
    db_session.refresh(sibling)
    assert paneer.stock_qty == Decimal("0.900")
    assert order.status == "delayed"
    assert _utc(task.start_at) == _utc(prior["task_start"]) + timedelta(minutes=30)
    assert _utc(task.end_at) == _utc(prior["task_end"]) + timedelta(minutes=30)
    assert task.status == "scheduled"
    assert task.plan_version == kitchen.plan_version
    assert _utc(locked_task.start_at) == _utc(prior["locked_start"])
    assert _utc(locked_task.end_at) == _utc(prior["locked_end"])
    assert locked_task.status == "scheduled"
    assert sibling.status == "expired"
    assert kitchen.plan_version == action.base_plan_version + 1
    assert "about 30 minutes late" in approved.json()["customer_messages"][0]["message"]
    assert approved.json()["customer_messages"][0]["needs_consent"] is True
    audit = db_session.get(AuditLog, UUID(approved.json()["audit_id"]))
    assert set(audit.before_snapshot) == {"ingredients", "orders", "plan_tasks"}
    assert set(audit.after_snapshot) == set(audit.before_snapshot)
    for table in audit.before_snapshot:
        assert {row["id"] for row in audit.before_snapshot[table]} == {
            row["id"] for row in audit.after_snapshot[table]
        }
        assert all(set(row) == {column.name for column in {
            "ingredients": Ingredient.__table__.columns,
            "orders": Order.__table__.columns,
            "plan_tasks": PlanTask.__table__.columns,
        }[table]} for row in audit.before_snapshot[table])
    assert audit.after_snapshot["ingredients"][0]["stock_qty"] == "0.900"
    repeated = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "ACTION_NOT_PENDING"

    undo_proposal = client.post(f"/api/audit/{audit.id}/undo")
    assert undo_proposal.status_code == 201
    undone = client.post(
        f"/api/actions/{undo_proposal.json()['action']['id']}/approve",
        json={"confirm_option_number": 1},
    )
    assert undone.status_code == 200
    db_session.refresh(paneer)
    db_session.refresh(order)
    db_session.refresh(task)
    assert paneer.stock_qty == prior["stock"]
    assert order.status == prior["order_status"]
    assert _utc(task.start_at) == _utc(prior["task_start"])
    assert _utc(task.end_at) == _utc(prior["task_end"])
    assert task.plan_version == prior["task_version"]


def test_emergency_overlap_pushes_later_unlocked_task(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani"))
    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    order, _item, shifted = _create_order_task(db_session, kitchen, menu, start=start)
    other_order, _other_item, other = _create_order_task(
        db_session, kitchen, menu, start=start + timedelta(minutes=45), cook_no=2
    )
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(paneer.id), "quantity": "0.200",
        "delay_minutes": 30, "order_ids": [str(order.id)],
    })
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 200
    db_session.refresh(shifted)
    db_session.refresh(other)
    assert _utc(shifted.start_at) == _utc(start) + timedelta(minutes=30)
    assert _utc(other.start_at) == _utc(shifted.end_at)
    assert not (_utc(shifted.start_at) < _utc(other.end_at) and _utc(other.start_at) < _utc(shifted.end_at))
    assert other_order.status == "planned"


def test_emergency_locked_overlap_rolls_back(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani"))
    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    order, _item, shifted = _create_order_task(db_session, kitchen, menu, start=start)
    _locked_order, _locked_item, blocker = _create_order_task(
        db_session, kitchen, menu, start=start + timedelta(minutes=45), cook_no=2, locked=True
    )
    before_stock, before_status = paneer.stock_qty, order.status
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(paneer.id), "quantity": "0.200",
        "delay_minutes": 30, "order_ids": [str(order.id)],
        "stock_update": {"ingredient_id": str(paneer.id), "reported_available_qty": "0.500"},
    })
    version = kitchen.plan_version
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PLAN_CHANGED"
    db_session.refresh(paneer)
    db_session.refresh(order)
    db_session.refresh(shifted)
    db_session.refresh(blocker)
    db_session.refresh(kitchen)
    assert paneer.stock_qty == before_stock
    assert order.status == before_status
    assert _utc(shifted.start_at) == _utc(start)
    assert _utc(blocker.start_at) == _utc(start) + timedelta(minutes=45)
    assert kitchen.plan_version == version


def test_emergency_unknown_ids_are_skipped(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    before_stock = paneer.stock_qty
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(uuid4()), "quantity": "0.200",
        "delay_minutes": 10, "order_ids": ["not-a-uuid", str(uuid4())],
        "stock_update": {"ingredient_id": str(uuid4()), "reported_available_qty": "0.500"},
    })
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 200
    db_session.refresh(paneer)
    assert paneer.stock_qty == before_stock
    assert response.json()["changes"]["orders_affected"] == []
    assert response.json()["customer_messages"] == []


def test_emergency_failure_midway_rolls_back(client, db_session, monkeypatch):
    from app.services import approval as approval_module

    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani"))
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    order, _item, task = _create_order_task(db_session, kitchen, menu, start=now)
    before_stock, before_status, before_start = paneer.stock_qty, order.status, task.start_at
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(paneer.id), "quantity": "0.200",
        "delay_minutes": 20, "order_ids": [str(order.id)],
        "stock_update": {"ingredient_id": str(paneer.id), "reported_available_qty": "0.500"},
    })
    snapshot_row = approval_module._snapshot_row

    def fail_after_stock(row):
        if isinstance(row, Order):
            raise RuntimeError("injected emergency failure")
        return snapshot_row(row)

    monkeypatch.setattr(approval_module, "_snapshot_row", fail_after_stock)
    with pytest.raises(RuntimeError, match="injected emergency failure"):
        client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    db_session.refresh(paneer)
    db_session.refresh(order)
    db_session.refresh(task)
    db_session.refresh(kitchen)
    assert paneer.stock_qty == before_stock
    assert order.status == before_status
    assert _utc(task.start_at) == _utc(before_start)
    assert kitchen.plan_version == action.base_plan_version


def test_dish_swap_overlap_uses_shared_resolver(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    original_menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani")
    )
    swapped_menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Veg Pulao")
    )
    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    _order, item, target = _create_order_task(db_session, kitchen, original_menu, start=start)
    target.start_at = start + timedelta(minutes=15)
    target.end_at = target.start_at + timedelta(minutes=35)
    _other_order, _other_item, later = _create_order_task(
        db_session, kitchen, original_menu, start=start + timedelta(minutes=35), cook_no=2
    )
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    now = datetime.now(timezone.utc)
    action = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=uuid4(), option_number=1, action_type="recovery",
        title="Dish swap overlap", payload={"option_type": "dish_swap", "swaps": [
            {"order_item_id": str(item.id), "menu_item_id": str(swapped_menu.id)}
        ]}, impact={}, status="pending", base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients), created_at=now, expires_at=now + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 200
    db_session.refresh(target)
    db_session.refresh(later)
    assert _utc(target.end_at) == _utc(target.start_at) + timedelta(minutes=swapped_menu.cook_minutes)
    assert _utc(later.start_at) == _utc(target.end_at)
    assert not (_utc(target.start_at) < _utc(later.end_at) and _utc(later.start_at) < _utc(target.end_at))


@pytest.mark.parametrize("other_type", ["cook", "prep"])
def test_different_task_resource_rules_do_not_move_unrelated_task(client, db_session, other_type):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani"))
    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    order, _item, delayed = _create_order_task(db_session, kitchen, menu, start=start, burner=1, cook_no=7)
    _other_order, _other_item, unrelated = _create_order_task(
        db_session, kitchen, menu, start=start + timedelta(minutes=35), burner=2, cook_no=7,
        task_type=other_type,
    )
    if other_type == "prep":
        unrelated.task_type = "prep"
    prior_delayed = (delayed.start_at, delayed.end_at)
    prior_unrelated = (unrelated.start_at, unrelated.end_at)
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(paneer.id), "quantity": "0.100",
        "delay_minutes": 30, "order_ids": [str(order.id)],
    })
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 200
    db_session.refresh(delayed)
    db_session.refresh(unrelated)
    assert _utc(delayed.start_at) == _utc(prior_delayed[0]) + timedelta(minutes=30)
    assert _utc(unrelated.start_at) == _utc(prior_unrelated[0])
    assert _utc(unrelated.end_at) == _utc(prior_unrelated[1])

    audit = db_session.get(AuditLog, UUID(response.json()["audit_id"]))
    undo = client.post(f"/api/audit/{audit.id}/undo")
    assert undo.status_code == 201
    undone = client.post(f"/api/actions/{undo.json()['action']['id']}/approve", json={"confirm_option_number": 1})
    assert undone.status_code == 200
    db_session.refresh(delayed)
    db_session.refresh(unrelated)
    assert _utc(delayed.start_at) == _utc(prior_delayed[0])
    assert _utc(delayed.end_at) == _utc(prior_delayed[1])
    assert _utc(unrelated.start_at) == _utc(prior_unrelated[0])
    assert _utc(unrelated.end_at) == _utc(prior_unrelated[1])


def test_overlapping_prep_tasks_with_same_cook_are_resolved_and_undoable(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    paneer = db_session.scalar(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id, Ingredient.name == "Paneer")
    )
    menu = db_session.scalar(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani"))
    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    order, _item, delayed = _create_order_task(
        db_session, kitchen, menu, start=start, burner=1, cook_no=8, task_type="prep"
    )
    _other_order, _other_item, later = _create_order_task(
        db_session, kitchen, menu, start=start + timedelta(minutes=45), burner=2, cook_no=8,
        task_type="prep",
    )
    original = {"delayed": (delayed.start_at, delayed.end_at), "later": (later.start_at, later.end_at)}
    action = _create_action(db_session, kitchen, payload={
        "option_type": "emergency_purchase", "ingredient_id": str(paneer.id), "quantity": "0.100",
        "delay_minutes": 30, "order_ids": [str(order.id)],
    })
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 200
    db_session.refresh(delayed)
    db_session.refresh(later)
    assert _utc(delayed.start_at) == _utc(original["delayed"][0]) + timedelta(minutes=30)
    assert _utc(later.start_at) == _utc(delayed.end_at)
    assert not (_utc(delayed.start_at) < _utc(later.end_at) and _utc(later.start_at) < _utc(delayed.end_at))

    audit = db_session.get(AuditLog, UUID(response.json()["audit_id"]))
    undo = client.post(f"/api/audit/{audit.id}/undo")
    assert undo.status_code == 201
    undone = client.post(f"/api/actions/{undo.json()['action']['id']}/approve", json={"confirm_option_number": 1})
    assert undone.status_code == 200
    db_session.refresh(delayed)
    db_session.refresh(later)
    for task, key in ((delayed, "delayed"), (later, "later")):
        assert _utc(task.start_at) == _utc(original[key][0])
        assert _utc(task.end_at) == _utc(original[key][1])


def test_dish_swap_prep_dependency_moves_cook_and_undo_restores(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    original_menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani")
    )
    swapped_menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Veg Pulao")
    )
    swapped_menu.prep_minutes = original_menu.prep_minutes + 10
    start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    order, item, cook = _create_order_task(db_session, kitchen, original_menu, start=start + timedelta(minutes=15))
    prep = PlanTask(
        id=uuid4(), kitchen_id=kitchen.id, order_item_id=item.id, task_type="prep", burner_no=None,
        cook_no=1, start_at=start, end_at=start + timedelta(minutes=15), status="scheduled",
        locked=False, plan_version=kitchen.plan_version,
    )
    db_session.add(prep)
    db_session.flush()
    before = {"prep": (prep.start_at, prep.end_at), "cook": (cook.start_at, cook.end_at)}
    action = _create_action(db_session, kitchen, payload={
        "option_type": "dish_swap",
        "swaps": [{"order_item_id": str(item.id), "menu_item_id": str(swapped_menu.id)}],
    })
    response = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert response.status_code == 200
    db_session.refresh(prep)
    db_session.refresh(cook)
    assert _utc(prep.end_at) == _utc(start) + timedelta(minutes=swapped_menu.prep_minutes)
    assert _utc(cook.start_at) == _utc(prep.end_at)
    assert _utc(cook.end_at) == _utc(cook.start_at) + timedelta(minutes=swapped_menu.cook_minutes)

    audit = db_session.get(AuditLog, UUID(response.json()["audit_id"]))
    undo = client.post(f"/api/audit/{audit.id}/undo")
    assert undo.status_code == 201
    undone = client.post(f"/api/actions/{undo.json()['action']['id']}/approve", json={"confirm_option_number": 1})
    assert undone.status_code == 200
    db_session.refresh(prep)
    db_session.refresh(cook)
    assert _utc(prep.start_at) == _utc(before["prep"][0])
    assert _utc(prep.end_at) == _utc(before["prep"][1])
    assert _utc(cook.start_at) == _utc(before["cook"][0])
    assert _utc(cook.end_at) == _utc(before["cook"][1])


def test_price_change_approval_audit_and_undo(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    menu = db_session.scalar(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.name == "Paneer Biryani")
    )
    now = datetime.now(timezone.utc)
    order = Order(
        id=uuid4(), kitchen_id=kitchen.id, customer_name="Price Snapshot Customer",
        customer_phone="919800000012", channel="direct", deadline=now + timedelta(hours=2),
        status="planned", total_amount=Decimal("360.00"), data_source="simulated", created_at=now,
    )
    db_session.add(order)
    db_session.flush()
    order_item = OrderItem(
        id=uuid4(), order_id=order.id, menu_item_id=menu.id, quantity=2,
        unit_price=Decimal("180.00"), swapped_from_item_id=None,
    )
    db_session.add(order_item)
    db_session.flush()
    old_price = menu.price
    prior_total = order.total_amount
    prior_unit_price = order_item.unit_price
    plan_version = kitchen.plan_version

    proposal = client.post("/api/pricing/analyze", json={
        "menu_item_id": str(menu.id), "price": 150, "propose_change": True,
    })
    assert proposal.status_code == 201
    action_id = UUID(proposal.json()["action"]["id"])
    action = db_session.get(ProposedAction, action_id)
    before_row = {
        column.name: str(getattr(menu, column.name)) if isinstance(getattr(menu, column.name), Decimal)
        else str(getattr(menu, column.name)) if isinstance(getattr(menu, column.name), UUID)
        else getattr(menu, column.name)
        for column in MenuItem.__table__.columns
    }
    approved = client.post(f"/api/actions/{action_id}/approve", json={"confirm_option_number": 1})
    assert approved.status_code == 200
    db_session.refresh(menu)
    db_session.refresh(order)
    db_session.refresh(order_item)
    db_session.refresh(kitchen)
    assert menu.price == Decimal("205.00")
    assert order_item.unit_price == prior_unit_price
    assert order.total_amount == prior_total
    assert kitchen.plan_version == plan_version
    assert approved.json()["plan_version_before"] == plan_version
    assert approved.json()["plan_version_after"] == plan_version
    assert db_session.get(ProposedAction, action_id).status == "executed"
    audit = db_session.get(AuditLog, UUID(approved.json()["audit_id"]))
    assert audit.event_type == "action_executed"
    assert audit.plan_version_before == plan_version
    assert audit.plan_version_after == plan_version
    assert audit.summary == "Changed Paneer Biryani price from ₹180.00 to ₹205.00"
    assert set(audit.before_snapshot) == {"menu_items"}
    assert set(audit.after_snapshot) == {"menu_items"}
    assert set(audit.before_snapshot["menu_items"][0]) == {column.name for column in MenuItem.__table__.columns}
    assert audit.before_snapshot["menu_items"][0] == before_row
    assert audit.after_snapshot["menu_items"][0]["id"] == str(menu.id)
    assert audit.after_snapshot["menu_items"][0]["price"] == "205.00"
    assert audit.after_snapshot["menu_items"][0].keys() == audit.before_snapshot["menu_items"][0].keys()

    listed = client.get("/api/audit?event_type=action_executed")
    assert listed.status_code == 200
    assert next(row for row in listed.json()["data"] if row["id"] == str(audit.id))["undoable"] is True
    repeated = client.post(f"/api/actions/{action_id}/approve", json={"confirm_option_number": 1})
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "ACTION_NOT_PENDING"

    undo_proposal = client.post(f"/api/audit/{audit.id}/undo")
    assert undo_proposal.status_code == 201
    assert menu.price == Decimal("205.00")
    undone = client.post(
        f"/api/actions/{undo_proposal.json()['action']['id']}/approve",
        json={"confirm_option_number": 1},
    )
    assert undone.status_code == 200
    db_session.refresh(menu)
    db_session.refresh(kitchen)
    assert menu.price == old_price
    assert kitchen.plan_version == plan_version + 1
    undo_audit = db_session.get(AuditLog, UUID(undone.json()["audit_id"]))
    assert undo_audit.event_type == "undo_executed"
    assert undo_audit.before_snapshot["menu_items"][0]["price"] == "205.00"
    assert undo_audit.after_snapshot["menu_items"][0]["price"] == "180.00"


def test_price_change_wrong_option_number_is_rejected(client, db_session):
    menu = db_session.scalar(select(MenuItem).where(MenuItem.name == "Paneer Biryani"))
    old_price = menu.price
    response = client.post("/api/pricing/analyze", json={
        "menu_item_id": str(menu.id), "propose_change": True,
    })
    action_id = response.json()["action"]["id"]
    approved = client.post(f"/api/actions/{action_id}/approve", json={"confirm_option_number": 2})
    assert approved.status_code == 422
    assert approved.json()["error"]["code"] == "OPTION_MISMATCH"
    db_session.refresh(menu)
    assert menu.price == old_price


def test_expired_price_change_is_rejected(client, db_session):
    menu = db_session.scalar(select(MenuItem).where(MenuItem.name == "Paneer Biryani"))
    response = client.post("/api/pricing/analyze", json={
        "menu_item_id": str(menu.id), "propose_change": True,
    })
    action = db_session.get(ProposedAction, UUID(response.json()["action"]["id"]))
    action.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.flush()
    approved = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert approved.status_code == 409
    assert approved.json()["error"]["code"] == "ACTION_EXPIRED"
    db_session.refresh(menu)
    assert menu.price == Decimal("180.00")


def test_deleted_menu_item_price_change_returns_not_found(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    menu = MenuItem(
        id=uuid4(), kitchen_id=kitchen.id, name=f"Unreferenced test dish {uuid4()}",
        price=Decimal("25.00"), packaging_cost=Decimal("5.00"), prep_minutes=10,
        cook_minutes=15, is_active=True, data_source="simulated",
    )
    db_session.add(menu)
    db_session.flush()
    plan_version = kitchen.plan_version
    response = client.post("/api/pricing/analyze", json={
        "menu_item_id": str(menu.id), "propose_change": True,
    })
    action_id = response.json()["action"]["id"]
    db_session.execute(delete(MenuItem).where(MenuItem.id == menu.id))
    db_session.flush()
    approved = client.post(f"/api/actions/{action_id}/approve", json={"confirm_option_number": 1})
    assert approved.status_code == 404
    assert approved.json()["error"]["code"] == "MENU_ITEM_NOT_FOUND"
    assert db_session.scalar(select(AuditLog.id).where(AuditLog.action_id == UUID(action_id))) is None
    assert db_session.get(ProposedAction, UUID(action_id)).status == "pending"
    assert db_session.scalar(select(Kitchen.plan_version).where(Kitchen.id == kitchen.id)) == plan_version


def test_approve_order_intake_success(client, db_session):
    from app.services.kitchen import get_kitchen

    kitchen = get_kitchen(db_session)
    menu = db_session.scalars(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id)).first()

    # Create baseline existing task for 2026-10-17 so daily plan exists
    target_dt = datetime(2026, 10, 17, 10, 0, tzinfo=timezone.utc)
    _create_order_task(db_session, kitchen, menu, start=target_dt)

    initial_version = kitchen.plan_version
    deadline_iso = "2026-10-17T13:00:00+05:30"
    payload = {
        "customer_name": "Test Customer Intake",
        "customer_phone": "9800000099",
        "channel": "whatsapp",
        "deadline": deadline_iso,
        "total_amount": 360.0,
        "confidence": 0.95,
        "source_text": "2 paneer biryani please",
        "items": [
            {
                "menu_item_id": str(menu.id),
                "name": menu.name,
                "quantity": 2,
                "unit_price": 180.0,
            }
        ],
    }
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    fp = _fingerprint(ingredients)
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="order_intake",
        title="Add order from Test Customer Intake",
        payload=payload,
        impact={"total_amount": 360.0, "items_count": 1},
        status="pending",
        base_plan_version=initial_version,
        stock_fingerprint=fp,
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()

    res = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res.status_code == 200
    body = res.json()
    assert body["action"]["status"] == "executed"
    assert body["plan_version_before"] == initial_version
    assert body["plan_version_after"] == initial_version + 1

    # Verify order in DB
    created_order = db_session.scalars(
        select(Order).where(Order.customer_name == "Test Customer Intake")
    ).first()
    assert created_order is not None
    assert created_order.status == "planned"
    assert len(created_order.items) == 1
    assert created_order.items[0].quantity == 2

    # Verify tasks scheduled
    tasks = db_session.scalars(
        select(PlanTask).where(PlanTask.order_item_id == created_order.items[0].id)
    ).all()
    assert len(tasks) >= 1

    # Verify audit log
    audit_id = UUID(body["audit_id"])
    audit = db_session.get(AuditLog, audit_id)
    assert audit is not None
    assert audit.event_type == "action_executed"
    assert "orders" in audit.after_snapshot
    assert "plan_tasks" in audit.after_snapshot


def test_approve_order_intake_duplicate_rejected(client, db_session):
    from app.services.kitchen import get_kitchen

    kitchen = get_kitchen(db_session)
    menu = db_session.scalars(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id)).first()
    target_dt = datetime(2026, 10, 17, 10, 0, tzinfo=timezone.utc)
    _create_order_task(db_session, kitchen, menu, start=target_dt)

    payload = {
        "customer_name": "Dup Customer",
        "deadline": "2026-10-17T13:00:00+05:30",
        "total_amount": 180.0,
        "items": [{"menu_item_id": str(menu.id), "name": menu.name, "quantity": 1, "unit_price": 180.0}],
    }
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="order_intake",
        title="Dup order",
        payload=payload,
        impact={},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()

    r1 = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert r1.status_code == 200

    r2 = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "ACTION_NOT_PENDING"


def test_approve_order_intake_preserves_locked_tasks(client, db_session):
    from app.services.kitchen import get_kitchen

    kitchen = get_kitchen(db_session)
    menu = db_session.scalars(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id)).first()

    target_dt = datetime(2026, 10, 17, 9, 30, tzinfo=timezone.utc)
    _, _, locked_task = _create_order_task(
        db_session, kitchen, menu, start=target_dt, burner=1, cook_no=1, locked=True
    )
    locked_start = locked_task.start_at
    locked_end = locked_task.end_at

    payload = {
        "customer_name": "Intake With Locked",
        "deadline": "2026-10-17T13:00:00+05:30",
        "total_amount": 180.0,
        "items": [{"menu_item_id": str(menu.id), "name": menu.name, "quantity": 1, "unit_price": 180.0}],
    }
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="order_intake",
        title="Intake with locked",
        payload=payload,
        impact={},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()

    res = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res.status_code == 200

    db_session.refresh(locked_task)
    assert _utc(locked_task.start_at) == _utc(locked_start)
    assert _utc(locked_task.end_at) == _utc(locked_end)
    assert locked_task.locked is True


def test_approve_order_intake_no_plan_returns_404(client, db_session):
    from app.services.kitchen import get_kitchen

    kitchen = get_kitchen(db_session)
    menu = db_session.scalars(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id)).first()

    # Target date 2026-11-20 has no existing plan
    payload = {
        "customer_name": "No Plan Date Customer",
        "deadline": "2026-11-20T13:00:00+05:30",
        "total_amount": 180.0,
        "items": [{"menu_item_id": str(menu.id), "name": menu.name, "quantity": 1, "unit_price": 180.0}],
    }
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="order_intake",
        title="No plan order",
        payload=payload,
        impact={},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()

    res = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "PLAN_NOT_FOUND"


def test_undo_order_intake(client, db_session):
    from app.services.kitchen import get_kitchen

    kitchen = get_kitchen(db_session)
    menu = db_session.scalars(select(MenuItem).where(MenuItem.kitchen_id == kitchen.id)).first()
    target_dt = datetime(2026, 10, 17, 10, 0, tzinfo=timezone.utc)
    _create_order_task(db_session, kitchen, menu, start=target_dt)

    payload = {
        "customer_name": "Customer To Undo",
        "deadline": "2026-10-17T13:00:00+05:30",
        "total_amount": 180.0,
        "items": [{"menu_item_id": str(menu.id), "name": menu.name, "quantity": 1, "unit_price": 180.0}],
    }
    ingredients = db_session.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="order_intake",
        title="Customer To Undo",
        payload=payload,
        impact={},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db_session.add(action)
    db_session.flush()

    res = client.post(f"/api/actions/{action.id}/approve", json={"confirm_option_number": 1})
    assert res.status_code == 200
    audit_id = res.json()["audit_id"]

    created_order = db_session.scalars(
        select(Order).where(Order.customer_name == "Customer To Undo")
    ).first()
    assert created_order is not None
    order_id = created_order.id

    # Post undo
    undo_res = client.post(f"/api/audit/{audit_id}/undo")
    assert undo_res.status_code == 201
    undo_action_id = undo_res.json()["action"]["id"]

    # Approve undo
    approve_undo = client.post(f"/api/actions/{undo_action_id}/approve", json={"confirm_option_number": 1})
    assert approve_undo.status_code == 200

    # Verify order is deleted
    db_session.expire_all()
    deleted_order = db_session.get(Order, order_id)
    assert deleted_order is None
