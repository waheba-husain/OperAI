from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models import AuditLog, Ingredient, Kitchen, Order, OrderItem, PlanTask, ProposedAction
from app.schemas import AuditEntryOut, AuditListResponse, UndoActionOut, UndoActionResponse
from app.services.kitchen import get_kitchen
from app.services.recovery import _fingerprint


def record_audit_log(
    db: Session,
    *,
    kitchen_id: UUID,
    event_type: str,
    actor: str,
    summary: str,
    action_id: UUID | None = None,
    before_snapshot: dict | None = None,
    after_snapshot: dict | None = None,
    plan_version_before: int | None = None,
    plan_version_after: int | None = None,
) -> AuditLog:
    """Append an immutable entry to audit_logs."""
    entry = AuditLog(
        id=uuid4(),
        kitchen_id=kitchen_id,
        action_id=action_id,
        event_type=event_type,
        actor=actor,
        summary=summary,
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
        plan_version_before=plan_version_before,
        plan_version_after=plan_version_after,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()
    return entry


def latest_undoable_audit_id(db: Session, *, kitchen_id: UUID) -> UUID | None:
    """Return the newest executed change that has no pending or completed undo."""
    consumed = select(ProposedAction.undo_of_audit_id).where(
        ProposedAction.kitchen_id == kitchen_id,
        ProposedAction.undo_of_audit_id.is_not(None),
        ProposedAction.status.in_(["pending", "executed"]),
    )
    return db.scalar(
        select(AuditLog.id)
        .where(
            AuditLog.kitchen_id == kitchen_id,
            AuditLog.event_type == "action_executed",
            AuditLog.id.not_in(consumed),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(1)
    )


def list_audit(
    db: Session,
    *,
    limit: int,
    event_type: str | None,
    include_snapshots: bool,
) -> AuditListResponse:
    kitchen = get_kitchen(db)
    query = select(AuditLog).where(AuditLog.kitchen_id == kitchen.id)
    if event_type is not None:
        query = query.where(AuditLog.event_type == event_type)
    rows = db.scalars(query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)).all()
    undoable_id = latest_undoable_audit_id(db, kitchen_id=kitchen.id)
    data = []
    for row in rows:
        values = {
            "id": row.id,
            "action_id": row.action_id,
            "event_type": row.event_type,
            "actor": row.actor,
            "summary": row.summary,
            "plan_version_before": row.plan_version_before,
            "plan_version_after": row.plan_version_after,
            "undoable": row.id == undoable_id,
            "created_at": row.created_at,
        }
        if include_snapshots:
            values["before_snapshot"] = row.before_snapshot
            values["after_snapshot"] = row.after_snapshot
        data.append(AuditEntryOut(**values))
    return AuditListResponse(data=data, count=len(data))


def propose_undo(db: Session, *, audit_id: UUID) -> UndoActionResponse:
    kitchen = get_kitchen(db)
    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.id == audit_id, AuditLog.kitchen_id == kitchen.id)
        .with_for_update()
    )
    if audit is None:
        raise AppError(404, "AUDIT_NOT_FOUND", f"Audit entry {audit_id} not found", {"audit_id": str(audit_id)})
    if (
        audit.event_type != "action_executed"
        or latest_undoable_audit_id(db, kitchen_id=kitchen.id) != audit.id
    ):
        raise AppError(409, "UNDO_NOT_ALLOWED", "This audit entry cannot be undone", {"audit_id": str(audit_id)})
    if not audit.before_snapshot:
        raise AppError(
            409,
            "UNDO_NOT_ALLOWED",
            "Nothing to restore for this change",
            {"audit_id": str(audit_id)},
        )

    now = datetime.now(timezone.utc)
    ingredients = db.scalars(select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)).all()
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type="undo",
        title=f"Undo: {audit.summary}",
        payload=audit.before_snapshot or {},
        impact={},
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=_fingerprint(ingredients),
        undo_of_audit_id=audit.id,
        created_at=now,
        expires_at=now + timedelta(minutes=settings.recovery_action_ttl_minutes),
    )
    db.add(action)
    db.flush()
    return UndoActionResponse(action=UndoActionOut(
        id=action.id, group_id=action.group_id, option_number=action.option_number,
        action_type="undo", title=action.title, status="pending", undo_of_audit_id=audit.id,
        base_plan_version=action.base_plan_version, expires_at=action.expires_at,
    ))
