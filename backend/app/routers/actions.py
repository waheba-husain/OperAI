from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import require_api_key
from app.schemas import ProposedActionListResponse
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
