from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import require_api_key
from app.schemas import OrderListResponse
from app.services.orders import list_orders

router = APIRouter(tags=["orders"], dependencies=[Depends(require_api_key)])


@router.get("/api/orders", response_model=OrderListResponse)
def get_orders(
    db: Session = Depends(get_db),
    date: date | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int | None = Query(default=None),
) -> OrderListResponse:
    result = list_orders(
        db,
        filter_date=date,
        status=status,
        limit=limit if limit is not None else settings.list_default_limit,
    )
    db.commit()
    return result
