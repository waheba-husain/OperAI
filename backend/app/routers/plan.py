from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_api_key
from app.schemas import (
    PlanGenerateRequest,
    PlanGenerateResponse,
    PlanResponse,
    PlanTaskCompleteResponse,
)
from app.services.scheduler import complete_task, generate_plan, get_plan

router = APIRouter(tags=["plan"], dependencies=[Depends(require_api_key)])


@router.post(
    "/api/plan/generate",
    response_model=PlanGenerateResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_generate_plan(
    payload: PlanGenerateRequest,
    db: Session = Depends(get_db),
) -> PlanGenerateResponse:
    result = generate_plan(
        db,
        target_date=payload.date,
        regenerate=payload.regenerate,
    )
    db.commit()
    return result


@router.get("/api/plan", response_model=PlanResponse)
def get_daily_plan(
    date: date = Query(..., description="Schedule date in YYYY-MM-DD format"),
    db: Session = Depends(get_db),
) -> PlanResponse:
    result = get_plan(db, target_date=date)
    return result


@router.post(
    "/api/plan/tasks/{task_id}/complete",
    response_model=PlanTaskCompleteResponse,
    status_code=status.HTTP_200_OK,
)
def post_complete_task(
    task_id: UUID,
    db: Session = Depends(get_db),
) -> PlanTaskCompleteResponse:
    result = complete_task(db, task_id=task_id)
    db.commit()
    return result

