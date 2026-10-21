from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import require_api_key
from app.schemas import AuditListResponse, DaySummaryResponse, UndoActionResponse
from app.services.audit import get_day_summary, list_audit, propose_undo

router = APIRouter(tags=["audit"], dependencies=[Depends(require_api_key)])


@router.get("/api/audit", response_model=AuditListResponse, response_model_exclude_unset=True)
def get_audit(
    db: Session = Depends(get_db),
    limit: int = Query(default=settings.list_default_limit, ge=1, le=settings.list_max_limit),
    event_type: Literal["action_executed", "action_rejected", "undo_executed", "order_created"] | None = Query(default=None),
    include_snapshots: bool = Query(default=False),
) -> AuditListResponse:
    return list_audit(db, limit=limit, event_type=event_type, include_snapshots=include_snapshots)


@router.get("/api/summary", response_model=DaySummaryResponse)
def get_summary(
    date: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> DaySummaryResponse:
    return get_day_summary(db, target_date=date)


@router.post("/api/audit/{id}/undo", response_model=UndoActionResponse, status_code=status.HTTP_201_CREATED)
def post_undo(id: UUID, db: Session = Depends(get_db)) -> UndoActionResponse:
    result = propose_undo(db, audit_id=id)
    db.commit()
    return result
