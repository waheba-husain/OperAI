from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import require_api_key
from app.schemas import (
    OrderCompleteResponse,
    OrderExtractAmbiguousResponse,
    OrderExtractRequest,
    OrderExtractSuccessResponse,
    OrderListResponse,
)
from app.services.orders import complete_order, extract_order, list_orders

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


@router.post(
    "/api/orders/extract",
    response_model=OrderExtractSuccessResponse | OrderExtractAmbiguousResponse,
    status_code=201,
)
def post_extract_order(
    payload: OrderExtractRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> OrderExtractSuccessResponse | OrderExtractAmbiguousResponse:
    result = extract_order(db, payload.text)
    if isinstance(result, OrderExtractAmbiguousResponse):
        response.status_code = 200
        return result
    db.commit()
    return result


@router.post(
    "/api/orders/{order_id}/complete",
    response_model=OrderCompleteResponse,
    status_code=status.HTTP_200_OK,
)
def post_complete_order(
    order_id: UUID,
    db: Session = Depends(get_db),
) -> OrderCompleteResponse:
    result = complete_order(db, order_id=order_id)
    db.commit()
    return result
