import re
import urllib.parse
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Ingredient, Kitchen, Order, ProposedAction
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

    # 2. Fetch original and replacement ingredients for descriptions
    orig_ing = None
    if "ingredient_id" in payload:
        try:
            orig_ing = db.get(Ingredient, UUID(str(payload["ingredient_id"])))
        except (ValueError, TypeError):
            pass

    sub_ing = None
    if "substitute_ingredient_id" in payload:
        try:
            sub_ing = db.get(Ingredient, UUID(str(payload["substitute_ingredient_id"])))
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
            )
        ).all()
        orders_map = {o.id: o for o in orders}

    customer_messages: list[CustomerMessageOut] = []
    for oid in order_ids:
        order = orders_map.get(oid)
        if order is None:
            continue
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

    order_count = len(order_ids)
    if orig_ing and sub_ing:
        action_summary_base = f"Swapped {orig_name} for {sub_name} in {order_count} orders"
    else:
        action_summary_base = action.title

    changes_summary = f"{action_summary_base}; {late_orders} orders late"
    audit_summary = f"{action_summary_base}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}"
    if transcript:
        audit_summary += f" (transcript: {transcript})"

    changes = ActionChangesOut(
        orders_affected=[str(oid) for oid in order_ids],
        tasks_rescheduled=0,
        summary=changes_summary,
    )

    return changes, customer_messages, before_snapshot, after_snapshot, audit_summary


APPLIERS = {
    ("recovery", "substitute"): _apply_substitute,
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

    # 2. Lock and retrieve the action within the current kitchen
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

    # 6. Lock the kitchen and validate base_plan_version
    kitchen_locked = db.scalar(
        select(Kitchen).where(Kitchen.id == kitchen.id).with_for_update()
    )
    if kitchen_locked.plan_version != action.base_plan_version:
        raise AppError(
            409,
            "PLAN_CHANGED",
            f"Plan version changed from {action.base_plan_version} to {kitchen_locked.plan_version}",
            {"expected_version": action.base_plan_version, "current_version": kitchen_locked.plan_version},
        )

    # 7. Recompute the stock fingerprint using the existing _fingerprint helper and validate it
    ingredients = db.scalars(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)
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

    # Expire pending sibling actions in the same group
    siblings = db.scalars(
        select(ProposedAction)
        .where(
            ProposedAction.kitchen_id == kitchen.id,
            ProposedAction.group_id == action.group_id,
            ProposedAction.id != action.id,
            ProposedAction.status == "pending",
        )
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
        event_type="action_executed",
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
