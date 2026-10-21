import re
import urllib.parse
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, Numeric, Uuid, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import AuditLog, Ingredient, Kitchen, Order, OrderItem, PlanTask, ProposedAction
from app.schemas import (
    ActionApproveActionOut,
    ActionApproveResponse,
    ActionChangesOut,
    ActionRejectActionOut,
    ActionRejectResponse,
    CustomerMessageOut,
)
from app.services.audit import record_audit_log
from app.services.kitchen import get_kitchen
from app.services.recovery import _fingerprint


def _snapshot_ingredient(ing: Ingredient) -> dict:
    return {
        "id": str(ing.id),
        "kitchen_id": str(ing.kitchen_id),
        "name": ing.name,
        "unit": ing.unit,
        "stock_qty": str(ing.stock_qty),
        "cost_per_unit": str(ing.cost_per_unit),
        "allergen_tags": list(ing.allergen_tags) if ing.allergen_tags else [],
        "diet_tags": list(ing.diet_tags) if ing.diet_tags else [],
        "data_source": ing.data_source,
        "updated_at": ing.updated_at.isoformat() if ing.updated_at else None,
    }


def _apply_substitute(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    payload = action.payload or {}

    # 1. Handle stock update if present in payload
    stock_update = payload.get("stock_update")
    before_snapshot: dict = {}
    after_snapshot: dict = {}
    if stock_update and "ingredient_id" in stock_update and "reported_available_qty" in stock_update:
        ing_id = UUID(str(stock_update["ingredient_id"]))
        reported_qty = Decimal(str(stock_update["reported_available_qty"]))
        ing = db.scalar(
            select(Ingredient)
            .where(Ingredient.id == ing_id, Ingredient.kitchen_id == kitchen.id)
            .with_for_update()
        )
        if ing is not None:
            before_snapshot["ingredients"] = [_snapshot_ingredient(ing)]
            ing.stock_qty = reported_qty
            ing.updated_at = now
            after_snapshot["ingredients"] = [_snapshot_ingredient(ing)]

    # 2. Fetch original and replacement ingredients for descriptions (strictly kitchen-scoped)
    orig_ing = None
    if "ingredient_id" in payload:
        try:
            orig_id = UUID(str(payload["ingredient_id"]))
            orig_ing = db.scalar(
                select(Ingredient).where(
                    Ingredient.id == orig_id,
                    Ingredient.kitchen_id == kitchen.id,
                )
            )
        except (ValueError, TypeError):
            pass

    sub_ing = None
    if "substitute_ingredient_id" in payload:
        try:
            sub_id = UUID(str(payload["substitute_ingredient_id"]))
            sub_ing = db.scalar(
                select(Ingredient).where(
                    Ingredient.id == sub_id,
                    Ingredient.kitchen_id == kitchen.id,
                )
            )
        except (ValueError, TypeError):
            pass

    orig_name = orig_ing.name.lower() if orig_ing else "an ingredient"
    sub_name = sub_ing.name.lower() if sub_ing else "a substitute"

    # 3. Process affected orders and construct customer message drafts
    order_ids_raw = payload.get("order_ids", [])
    order_ids: list[UUID] = []
    for oid in order_ids_raw:
        try:
            order_ids.append(UUID(str(oid)))
        except (ValueError, TypeError):
            pass

    orders_map: dict[UUID, Order] = {}
    if order_ids:
        orders = db.scalars(
            select(Order).where(
                Order.kitchen_id == kitchen.id,
                Order.id.in_(order_ids),
                Order.status.not_in(["cancelled", "completed"]),
            )
        ).all()
        orders_map = {o.id: o for o in orders}

    customer_messages: list[CustomerMessageOut] = []
    verified_order_ids: list[UUID] = []
    seen_order_ids: set[UUID] = set()
    for oid in order_ids:
        if oid in seen_order_ids:
            continue
        order = orders_map.get(oid)
        if order is None:
            continue
        seen_order_ids.add(oid)
        verified_order_ids.append(order.id)
        msg_text = f"Hi {order.customer_name}, we are short of {orig_name}. May we use {sub_name} instead? Reply YES to confirm."
        text_encoded = urllib.parse.quote(msg_text)
        if order.customer_phone:
            cleaned_phone = re.sub(r"[^\d]", "", order.customer_phone)
            wa_url = f"https://wa.me/{cleaned_phone}?text={text_encoded}"
        else:
            wa_url = f"https://wa.me/?text={text_encoded}"
        customer_messages.append(
            CustomerMessageOut(
                order_id=order.id,
                customer_name=order.customer_name,
                needs_consent=True,
                message=msg_text,
                whatsapp_url=wa_url,
            )
        )

    # 4. Impact and summaries
    late_orders = 0
    if isinstance(action.impact, dict):
        late_orders = action.impact.get("late_orders", 0)

    order_count = len(verified_order_ids)
    if orig_ing and sub_ing:
        action_summary_base = f"Swapped {orig_name} for {sub_name} in {order_count} orders"
    else:
        action_summary_base = action.title

    changes_summary = f"{action_summary_base}; {late_orders} orders late"
    audit_summary = f"{action_summary_base}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}"
    if transcript:
        audit_summary += f" (transcript: {transcript})"

    changes = ActionChangesOut(
        orders_affected=[str(oid) for oid in verified_order_ids],
        tasks_rescheduled=0,
        summary=changes_summary,
    )

    return changes, customer_messages, before_snapshot, after_snapshot, audit_summary


_UNDO_MODELS = {
    "ingredients": Ingredient,
    "orders": Order,
    "order_items": OrderItem,
    "plan_tasks": PlanTask,
}
_UNDO_RESTORE_ORDER = ("orders", "order_items", "plan_tasks", "ingredients")
_UNDO_DELETE_ORDER = ("plan_tasks", "order_items", "orders", "ingredients")


def _json_value(value):
    if isinstance(value, (UUID,)):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _snapshot_row(row) -> dict:
    return {column.name: _json_value(getattr(row, column.name)) for column in row.__table__.columns}


def _restore_value(column, value):
    if value is None:
        return None
    if isinstance(column.type, Uuid):
        return UUID(str(value))
    if isinstance(column.type, Numeric):
        return Decimal(str(value))
    if isinstance(column.type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def _same_value(column, current, desired) -> bool:
    if isinstance(column.type, DateTime) and current is not None and desired is not None:
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        if desired.tzinfo is None:
            desired = desired.replace(tzinfo=timezone.utc)
        return current == desired
    return current == desired


def _apply_undo(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    source = db.scalar(select(AuditLog).where(
        AuditLog.id == action.undo_of_audit_id,
        AuditLog.kitchen_id == kitchen.id,
        AuditLog.event_type == "action_executed",
    ))
    if source is None:
        raise AppError(409, "UNDO_NOT_ALLOWED", "The source audit entry is no longer undoable")

    target_snapshot = action.payload or {}
    changed_before: dict[str, list[dict]] = {}
    changed_after: dict[str, list[dict]] = {}
    with db.begin_nested():
        for table in _UNDO_DELETE_ORDER:
            model = _UNDO_MODELS[table]
            before_rows = {str(row.get("id")): row for row in target_snapshot.get(table, [])}
            after_rows = {str(row.get("id")): row for row in (source.after_snapshot or {}).get(table, [])}
            for row_id in after_rows.keys() - before_rows.keys():
                record = db.scalar(select(model).where(model.id == UUID(row_id)).with_for_update())
                if record is None or getattr(record, "kitchen_id", kitchen.id) != kitchen.id:
                    continue
                if isinstance(record, PlanTask) and record.locked:
                    raise AppError(409, "PLAN_CHANGED", "Undo cannot remove a locked plan task", {"task_id": row_id})
                changed_before.setdefault(table, []).append(_snapshot_row(record))
                db.delete(record)

        for table in _UNDO_RESTORE_ORDER:
            model = _UNDO_MODELS[table]
            for row in target_snapshot.get(table, []):
                row_id = UUID(str(row["id"]))
                current = db.scalar(select(model).where(model.id == row_id).with_for_update())
                if current is not None and getattr(current, "kitchen_id", kitchen.id) != kitchen.id:
                    raise AppError(409, "PLAN_CHANGED", "Undo snapshot references another kitchen")
                if isinstance(current, PlanTask) and current.locked:
                    desired = {
                        column.name: _restore_value(column, row.get(column.name))
                        for column in model.__table__.columns
                    }
                    current_values = {
                        column.name: getattr(current, column.name)
                        for column in model.__table__.columns
                    }
                    if any(
                        not _same_value(column, current_values[column.name], desired[column.name])
                        for column in model.__table__.columns
                    ):
                        raise AppError(
                            409,
                            "PLAN_CHANGED",
                            "Undo cannot move a locked plan task",
                            {"task_id": str(row_id)},
                        )
                    continue
                if current is not None:
                    changed_before.setdefault(table, []).append(_snapshot_row(current))
                values = {
                    column.name: _restore_value(column, row.get(column.name))
                    for column in model.__table__.columns
                }
                if current is None:
                    current = model(**values)
                    db.add(current)
                else:
                    for key, value in values.items():
                        setattr(current, key, value)
                changed_after.setdefault(table, []).append(dict(row))
        db.flush()
        for table in _UNDO_MODELS:
            if table in changed_after or table in changed_before:
                model = _UNDO_MODELS[table]
                ids = {row["id"] for row in changed_before.get(table, []) + changed_after.get(table, [])}
                changed_after[table] = [
                    _snapshot_row(row)
                    for row in db.scalars(
                        select(model).where(model.id.in_([UUID(str(value)) for value in ids]))
                    ).all()
                ]
    summary = f"Undid audit entry {source.id}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}"
    return (
        ActionChangesOut(orders_affected=[], tasks_rescheduled=len(changed_after.get("plan_tasks", [])), summary=f"Restored state from audit {source.id}"),
        [],
        changed_before or {},
        changed_after or {},
        summary,
    )


APPLIERS = {
    ("recovery", "substitute"): _apply_substitute,
    ("undo", None): _apply_undo,
}


def approve_action(
    db: Session,
    *,
    action_id: UUID,
    confirm_option_number: int,
    input_mode: str | None = None,
    transcript: str | None = None,
) -> ActionApproveResponse:
    kitchen = get_kitchen(db)

    # 1. Lock kitchen first to establish a top-down lock hierarchy and prevent circular wait
    kitchen_locked = db.scalar(
        select(Kitchen).where(Kitchen.id == kitchen.id).with_for_update()
    )
    if kitchen_locked is None:
        raise AppError(500, "INTERNAL_ERROR", "No kitchen configured")

    # 2. Lock and retrieve the action within the locked kitchen
    action = db.scalar(
        select(ProposedAction)
        .where(ProposedAction.id == action_id, ProposedAction.kitchen_id == kitchen_locked.id)
        .with_for_update()
    )
    if action is None:
        raise AppError(
            404,
            "ACTION_NOT_FOUND",
            f"Action {action_id} not found",
            {"action_id": str(action_id)},
        )

    # 3. Require status == "pending"
    if action.status != "pending":
        raise AppError(
            409,
            "ACTION_NOT_PENDING",
            f"Action {action_id} is no longer pending",
            {"action_id": str(action_id), "status": action.status},
        )

    # 4. Reject expired actions
    now = datetime.now(timezone.utc)
    expires_at = action.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now >= expires_at:
        raise AppError(
            409,
            "ACTION_EXPIRED",
            f"Action {action_id} has expired",
            {"action_id": str(action_id), "expires_at": action.expires_at.isoformat()},
        )

    # 5. Validate confirm_option_number
    if confirm_option_number != action.option_number:
        raise AppError(
            422,
            "OPTION_MISMATCH",
            f"Option number mismatch: requested {confirm_option_number}, action is option {action.option_number}",
            {"expected": action.option_number, "provided": confirm_option_number},
        )

    # 6. Validate base_plan_version against locked kitchen
    if kitchen_locked.plan_version != action.base_plan_version:
        raise AppError(
            409,
            "PLAN_CHANGED",
            f"Plan version changed from {action.base_plan_version} to {kitchen_locked.plan_version}",
            {"expected_version": action.base_plan_version, "current_version": kitchen_locked.plan_version},
        )

    # 7. Recompute the stock fingerprint using the existing _fingerprint helper and validate it
    ingredients = db.scalars(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen_locked.id)
    ).all()
    current_fingerprint = _fingerprint(ingredients)
    if current_fingerprint != action.stock_fingerprint:
        raise AppError(
            409,
            "STOCK_CHANGED",
            "Stock changed since proposal was created",
            {"expected_fingerprint": action.stock_fingerprint, "current_fingerprint": current_fingerprint},
        )

    # Resolve applier
    payload = action.payload or {}
    option_type = payload.get("option_type") if isinstance(payload, dict) else None
    applier = APPLIERS.get((action.action_type, option_type))
    if applier is None:
        raise AppError(
            422,
            "UNSUPPORTED_ACTION",
            f"Action '{action.action_type}' with option '{option_type}' is not supported",
            {"action_type": action.action_type, "option_type": option_type},
        )

    # Execute applier
    changes, customer_messages, before_snapshot, after_snapshot, audit_summary = applier(
        db,
        kitchen=kitchen_locked,
        action=action,
        now=now,
        transcript=transcript,
    )

    # Expire pending sibling actions in the same group in deterministic ID order
    siblings = db.scalars(
        select(ProposedAction)
        .where(
            ProposedAction.kitchen_id == kitchen_locked.id,
            ProposedAction.group_id == action.group_id,
            ProposedAction.id != action.id,
            ProposedAction.status == "pending",
        )
        .order_by(ProposedAction.id)
        .with_for_update()
    ).all()
    expired_action_ids: list[UUID] = []
    for sibling in siblings:
        sibling.status = "expired"
        sibling.decided_at = now
        expired_action_ids.append(sibling.id)

    # Increment kitchen plan version
    plan_version_before = kitchen_locked.plan_version
    plan_version_after = plan_version_before + 1
    kitchen_locked.plan_version = plan_version_after

    # Record audit log
    audit_entry = record_audit_log(
        db,
        kitchen_id=kitchen.id,
        action_id=action.id,
        event_type="undo_executed" if action.action_type == "undo" else "action_executed",
        actor="owner",
        summary=audit_summary,
        before_snapshot=before_snapshot if before_snapshot else None,
        after_snapshot=after_snapshot if after_snapshot else None,
        plan_version_before=plan_version_before,
        plan_version_after=plan_version_after,
    )

    # Transition approved action to executed
    action.status = "executed"
    action.decided_at = now
    action.executed_at = now

    return ActionApproveResponse(
        action=ActionApproveActionOut(
            id=action.id,
            status="executed",
            executed_at=action.executed_at,
        ),
        plan_version_before=plan_version_before,
        plan_version_after=plan_version_after,
        audit_id=audit_entry.id,
        changes=changes,
        customer_messages=customer_messages,
        expired_action_ids=expired_action_ids,
    )


def reject_action(
    db: Session,
    *,
    action_id: UUID,
    reason: str | None = None,
) -> ActionRejectResponse:
    kitchen = get_kitchen(db)
    action = db.scalar(
        select(ProposedAction)
        .where(ProposedAction.id == action_id, ProposedAction.kitchen_id == kitchen.id)
        .with_for_update()
    )
    if action is None:
        raise AppError(
            404,
            "ACTION_NOT_FOUND",
            f"Action {action_id} not found",
            {"action_id": str(action_id)},
        )

    if action.status != "pending":
        raise AppError(
            409,
            "ACTION_NOT_PENDING",
            f"Action {action_id} is no longer pending",
            {"action_id": str(action_id), "status": action.status},
        )

    now = datetime.now(timezone.utc)
    action.status = "rejected"
    action.decided_at = now

    summary = f"Rejected proposal: {action.title}"
    if reason:
        summary += f" ({reason})"

    audit_entry = record_audit_log(
        db,
        kitchen_id=kitchen.id,
        action_id=action.id,
        event_type="action_rejected",
        actor="owner",
        summary=summary,
        before_snapshot=None,
        after_snapshot=None,
        plan_version_before=kitchen.plan_version,
        plan_version_after=kitchen.plan_version,
    )

    return ActionRejectResponse(
        action=ActionRejectActionOut(
            id=action.id,
            status="rejected",
            decided_at=action.decided_at,
        ),
        audit_id=audit_entry.id,
    )
