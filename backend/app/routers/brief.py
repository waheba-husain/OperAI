from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_api_key
from app.schemas import BriefResponse
from app.services.risk import get_risk_brief

router = APIRouter(tags=["brief"], dependencies=[Depends(require_api_key)])


@router.get("/api/brief", response_model=BriefResponse)
def get_brief(
    date: date | None = Query(
        None,
        description="Risk brief date in YYYY-MM-DD format (defaults to tomorrow in IST)",
    ),
    db: Session = Depends(get_db),
) -> BriefResponse:
    return get_risk_brief(db, target_date=date)
