from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.errors import AppError
from app.models import Order, OrderItem
from app.schemas import OrderItemOut, OrderListResponse, OrderOut
from app.services.kitchen import get_kitchen
from app.services.pricing import as_money
from app.timeutil import day_bounds

VALID_STATUSES = {
    "new",
    "planned",
    "in_progress",
    "delayed",
    "partial",
    "completed",
    "cancelled",
}


def list_orders(
    db: Session,
    *,
    filter_date: date | None = None,
    status: str | None = None,
    limit: int | None = None,
) -> OrderListResponse:
    if limit is None:
        limit = settings.list_default_limit
    if limit < 1 or limit > settings.list_max_limit:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            f"limit must be between 1 and {settings.list_max_limit}",
            {"limit": limit},
        )
    if status is not None and status not in VALID_STATUSES:
        raise AppError(422, "VALIDATION_ERROR", "Unknown status", {"status": status})

    kitchen = get_kitchen(db)
    query = (
        select(Order)
        .where(Order.kitchen_id == kitchen.id)
        .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
        .order_by(Order.deadline, Order.created_at)
        .limit(limit)
    )
    if filter_date is not None:
        start, end = day_bounds(filter_date)
        query = query.where(Order.deadline >= start, Order.deadline < end)
    if status is not None:
        query = query.where(Order.status == status)

    rows = db.scalars(query).all()
    data = [
        OrderOut(
            id=order.id,
            customer_name=order.customer_name,
            channel=order.channel,
            deadline=order.deadline,
            status=order.status,
            total_amount=as_money(order.total_amount),
            items=[
                OrderItemOut(
                    menu_item_id=item.menu_item_id,
                    name=item.menu_item.name,
                    quantity=item.quantity,
                    unit_price=as_money(item.unit_price),
                )
                for item in order.items
            ],
        )
        for order in rows
    ]
    return OrderListResponse(data=data, count=len(data))
