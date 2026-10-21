from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import require_api_key
from app.schemas import (
    ActionApproveRequest,
    ActionApproveResponse,
    ActionRejectRequest,
    ActionRejectResponse,
    ProposedActionListResponse,
)
from app.services.approval import approve_action, reject_action
from app.services.recovery import list_actions

router = APIRouter(tags=["actions"], dependencies=[Depends(require_api_key)])


@router.get("/api/actions", response_model=ProposedActionListResponse)
def get_actions(
    db: Session = Depends(get_db),
    status: Literal["pending", "executed", "rejected", "expired", "failed"] | None = Query(default=None),
    group_id: UUID | None = Query(default=None),
    limit: int = Query(default=settings.list_default_limit, ge=1, le=settings.list_max_limit),
) -> ProposedActionListResponse:
    return list_actions(db, status=status, group_id=group_id, limit=limit)


@router.post("/api/actions/{id}/approve", response_model=ActionApproveResponse)
def post_approve_action(
    id: UUID,
    payload: ActionApproveRequest,
    db: Session = Depends(get_db),
) -> ActionApproveResponse:
    result = approve_action(
        db,
        action_id=id,
        confirm_option_number=payload.confirm_option_number,
        input_mode=payload.input_mode,
        transcript=payload.transcript,
    )
    db.commit()
    return result


@router.post("/api/actions/{id}/reject", response_model=ActionRejectResponse)
def post_reject_action(
    id: UUID,
    payload: ActionRejectRequest | None = Body(default=None),
    db: Session = Depends(get_db),
) -> ActionRejectResponse:
    reason = payload.reason if payload else None
    result = reject_action(db, action_id=id, reason=reason)
    db.commit()
    return result
