from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.models import AuditLog


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
