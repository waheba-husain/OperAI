from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.config import settings
from app.errors import AppError
from app.models import AuditLog, Ingredient, Kitchen, Order, OrderItem, PlanTask, ProposedAction
from app.schemas import AuditEntryOut, AuditListResponse, DaySummaryResponse, UndoActionOut, UndoActionResponse
from app.services.kitchen import get_kitchen
from app.services.recovery import _fingerprint
from app.timeutil import IST, day_bounds


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


def _impact_decimal(action: ProposedAction, field: str, *, nonnegative: bool = False) -> Decimal:
    value = action.impact.get(field) if isinstance(action.impact, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise AppError(
            500,
            "INTERNAL_ERROR",
            "An executed recovery action has incomplete impact data",
            {"action_id": str(action.id), "field": field},
        )
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        result = Decimal("NaN")
    if not result.is_finite() or (nonnegative and result < 0):
        raise AppError(
            500,
            "INTERNAL_ERROR",
            "An executed recovery action has invalid impact data",
            {"action_id": str(action.id), "field": field},
        )
    return result


def _impact_count(action: ProposedAction, field: str) -> int:
    value = action.impact.get(field) if isinstance(action.impact, dict) else None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AppError(
            500,
            "INTERNAL_ERROR",
            "An executed recovery action has invalid impact data",
            {"action_id": str(action.id), "field": field},
        )
    return value


def get_day_summary(db: Session, *, target_date: date | None = None) -> DaySummaryResponse:
    kitchen = get_kitchen(db)
    target_date = target_date or datetime.now(IST).date()
    start, end = day_bounds(target_date)

    executed_rows = db.execute(
        select(AuditLog, ProposedAction)
        .join(ProposedAction, AuditLog.action_id == ProposedAction.id)
        .where(
            AuditLog.kitchen_id == kitchen.id,
            AuditLog.event_type == "action_executed",
            AuditLog.created_at >= start,
            AuditLog.created_at < end,
            ProposedAction.kitchen_id == kitchen.id,
            ProposedAction.action_type == "recovery",
            ProposedAction.status == "executed",
        )
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()

    undo_rows = db.execute(
        select(AuditLog, ProposedAction)
        .join(ProposedAction, AuditLog.action_id == ProposedAction.id)
        .where(
            AuditLog.kitchen_id == kitchen.id,
            AuditLog.event_type == "undo_executed",
            AuditLog.created_at >= start,
            AuditLog.created_at < end,
            ProposedAction.kitchen_id == kitchen.id,
            ProposedAction.action_type == "undo",
            ProposedAction.status == "executed",
        )
    ).all()
    actions_undone = len(undo_rows)

    SourceAudit = aliased(AuditLog)
    SourceAction = aliased(ProposedAction)
    all_undo_rows = db.execute(
        select(ProposedAction.undo_of_audit_id)
        .join(AuditLog, AuditLog.action_id == ProposedAction.id)
        .join(SourceAudit, ProposedAction.undo_of_audit_id == SourceAudit.id)
        .join(SourceAction, SourceAudit.action_id == SourceAction.id)
        .where(
            AuditLog.kitchen_id == kitchen.id,
            AuditLog.event_type == "undo_executed",
            ProposedAction.kitchen_id == kitchen.id,
            ProposedAction.action_type == "undo",
            ProposedAction.status == "executed",
            SourceAudit.event_type == "action_executed",
            SourceAction.kitchen_id == kitchen.id,
            SourceAction.action_type == "recovery",
            SourceAction.status == "executed",
        )
    ).all()
    undone_audit_ids = {row[0] for row in all_undo_rows}

    orders_total = 0
    orders_completed = 0
    orders_protected = 0
    revenue_protected = Decimal("0.00")
    net_extra_cost = Decimal("0.00")
    if executed_rows or undo_rows:
        order_scope = (
            Order.kitchen_id == kitchen.id,
            Order.deadline >= start,
            Order.deadline < end,
            Order.status != "cancelled",
        )
        orders_total = db.scalar(select(func.count(Order.id)).where(*order_scope)) or 0
        orders_completed = db.scalar(
            select(func.count(Order.id)).where(*order_scope, Order.status == "completed")
        ) or 0

    for audit, action in executed_rows:
        baseline_late = _impact_count(action, "orders_protected") + _impact_count(action, "late_orders")
        option_late = _impact_count(action, "late_orders")
        baseline_revenue = _impact_decimal(
            action, "revenue_at_risk_without_action", nonnegative=True
        )
        option_revenue = _impact_decimal(action, "revenue_at_risk_after", nonnegative=True)
        extra_cost = _impact_decimal(action, "extra_cost")
        protected_revenue = baseline_revenue - option_revenue
        if protected_revenue < 0:
            raise AppError(
                500,
                "INTERNAL_ERROR",
                "An executed recovery action has inconsistent impact data",
                {"action_id": str(action.id), "field": "revenue_at_risk_after"},
            )
        net_extra_cost += extra_cost
        if audit.id in undone_audit_ids:
            continue
        orders_protected += baseline_late - option_late
        revenue_protected += protected_revenue

    return DaySummaryResponse(
        date=target_date.isoformat(),
        orders_total=orders_total,
        orders_completed=orders_completed,
        actions_executed=len(executed_rows),
        actions_undone=actions_undone,
        orders_protected=orders_protected,
        revenue_protected=revenue_protected.quantize(Decimal("0.01")),
        net_extra_cost=net_extra_cost.quantize(Decimal("0.01")),
        data_source=kitchen.data_source,
    )


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
