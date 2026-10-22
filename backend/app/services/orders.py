import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ai.extractor import extract_order_from_text
from app.config import settings
from app.errors import AppError
from app.models import Ingredient, MenuItem, Order, OrderItem, ProposedAction
from app.schemas import (
    OrderCompleteResponse,
    OrderDraftItemOut,
    OrderDraftOut,
    OrderExtractActionOut,
    OrderExtractAmbiguousResponse,
    OrderExtractSuccessResponse,
    OrderItemOut,
    OrderListResponse,
    OrderOut,
)
from app.services.kitchen import get_kitchen
from app.services.pricing import as_money
from app.services.recovery import _fingerprint
from app.timeutil import IST, day_bounds

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
    data = [_order_to_out(order) for order in rows]
    return OrderListResponse(data=data, count=len(data))


def _order_to_out(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        customer_name=order.customer_name,
        channel=order.channel,
        deadline=order.deadline,
        status=order.status,
        total_amount=as_money(order.total_amount),
        items=[
            OrderItemOut(
                menu_item_id=item.menu_item_id,
                name=item.menu_item.name if item.menu_item else "Unknown",
                quantity=item.quantity,
                unit_price=as_money(item.unit_price),
            )
            for item in order.items
        ],
    )


def complete_order(db: Session, *, order_id: UUID) -> OrderCompleteResponse:
    kitchen = get_kitchen(db)
    order = db.scalars(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
    ).first()

    if order is None or order.kitchen_id != kitchen.id:
        raise AppError(
            404,
            "ORDER_NOT_FOUND",
            f"Order {order_id} not found",
            {"order_id": str(order_id)},
        )

    if order.status == "completed":
        return OrderCompleteResponse(
            order=_order_to_out(order),
            already_completed=True,
            message="Order is already completed",
        )

    if order.status == "cancelled":
        raise AppError(
            422,
            "INVALID_STATUS_TRANSITION",
            f"Cannot complete order with status '{order.status}'",
            {"order_id": str(order_id), "current_status": order.status},
        )

    if order.status not in ("new", "planned", "in_progress", "delayed", "partial"):
        raise AppError(
            422,
            "INVALID_STATUS_TRANSITION",
            f"Cannot complete order with status '{order.status}'",
            {"order_id": str(order_id), "current_status": order.status},
        )

    order.status = "completed"
    if hasattr(order, "updated_at"):
        setattr(order, "updated_at", datetime.now(timezone.utc))

    db.flush()

    return OrderCompleteResponse(
        order=_order_to_out(order),
        already_completed=False,
        message="Order marked as completed",
    )


VALID_CHANNELS = {
    "whatsapp",
    "instagram",
    "swiggy",
    "zomato",
    "direct",
}


def _match_dish_candidates(dish_text: str, menu_items: list[MenuItem]) -> list[MenuItem]:
    """
    Matches raw dish text against kitchen MenuItem records.
    Returns:
      - Exact match if one exists
      - Substring / word-overlap matches
    """
    cleaned = re.sub(r"^\d+\s*(?:x\s*)?", "", dish_text).strip().lower()
    if not cleaned:
        return []

    # 1. Exact match (case-insensitive)
    exact = [m for m in menu_items if m.name.lower() == cleaned]
    if exact:
        return exact

    # 2. Substring match
    substr = [m for m in menu_items if cleaned in m.name.lower() or m.name.lower() in cleaned]
    if substr:
        return substr

    # 3. Word token overlap
    tokens = {t for t in re.findall(r"\w+", cleaned) if len(t) > 2}
    if not tokens:
        return []
    matches = [
        m for m in menu_items
        if tokens & {t for t in re.findall(r"\w+", m.name.lower())}
    ]
    return matches


def extract_order(
    db: Session,
    text: str,
) -> OrderExtractSuccessResponse | OrderExtractAmbiguousResponse:
    if not text or len(text.strip()) == 0:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "text is required and cannot be empty",
            {"text": text},
        )
    if len(text) > 2000:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "text exceeds maximum allowed length of 2000 characters",
            {"length": len(text)},
        )

    # 1. AI Extraction (treats text strictly as data)
    raw = extract_order_from_text(text)
    if not raw.items:
        raise AppError(
            422,
            "EXTRACTION_FAILED",
            "No order could be found in the text",
            {"source_text": text},
        )

    kitchen = get_kitchen(db)
    active_menu = db.scalars(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.is_active.is_(True))
    ).all()

    # 2. In-code dish resolution and ambiguity detection
    ambiguous_questions: list[str] = []
    matched_pairs: list[tuple[Any, MenuItem]] = []

    for item in raw.items:
        candidates = _match_dish_candidates(item.dish, active_menu)
        if len(candidates) > 1:
            names = " or ".join(m.name for m in candidates)
            ambiguous_questions.append(f"Which dish: {names}?")
        elif len(candidates) == 1:
            matched_pairs.append((item, candidates[0]))
        else:
            raise AppError(
                422,
                "EXTRACTION_FAILED",
                f"No menu item matches dish '{item.dish}'",
                {"dish": item.dish},
            )

    if ambiguous_questions:
        return OrderExtractAmbiguousResponse(
            draft=None,
            confidence=float(raw.confidence),
            clarifying_questions=ambiguous_questions,
            action=None,
        )

    # 3. Resolve customer details, deadline, and total amount
    customer_name = raw.customer_name.strip() if raw.customer_name and raw.customer_name.strip() else "Customer"
    customer_phone = raw.customer_phone.strip() if raw.customer_phone else None
    channel = raw.channel.strip().lower() if raw.channel and raw.channel.strip().lower() in VALID_CHANNELS else "whatsapp"

    deadline: datetime | None = None
    if raw.deadline:
        try:
            deadline = datetime.fromisoformat(raw.deadline)
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=IST)
            else:
                deadline = deadline.astimezone(IST)
        except (ValueError, TypeError):
            pass

    if deadline is None:
        now_ist = datetime.now(IST)
        tomorrow = (now_ist + timedelta(days=1)).date()
        deadline = datetime(tomorrow.year, tomorrow.month, tomorrow.day, 13, 0, tzinfo=IST)

    draft_items: list[OrderDraftItemOut] = []
    total_amount = Decimal("0.00")
    for raw_item, menu_item in matched_pairs:
        qty = int(raw_item.quantity)
        price = as_money(menu_item.price)
        total_amount += price * qty
        draft_items.append(
            OrderDraftItemOut(
                menu_item_id=menu_item.id,
                name=menu_item.name,
                quantity=qty,
                unit_price=price,
            )
        )
    total_amount = as_money(total_amount)

    # 4. Compute stock fingerprint
    ingredients = db.scalars(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen.id)
    ).all()
    stock_fp = _fingerprint(ingredients)

    # 5. Create pending ProposedAction
    action_id = uuid4()
    group_id = uuid4()
    now_utc = datetime.now(timezone.utc)
    expires_at = now_utc + timedelta(minutes=settings.recovery_action_ttl_minutes)
    items_summary = ", ".join(f"{di.quantity} x {di.name}" for di in draft_items)
    title = f"Add order from {customer_name} ({items_summary})"

    payload = {
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "channel": channel,
        "deadline": deadline.isoformat(),
        "total_amount": float(total_amount),
        "confidence": float(raw.confidence),
        "source_text": text,
        "items": [
            {
                "menu_item_id": str(di.menu_item_id),
                "name": di.name,
                "quantity": di.quantity,
                "unit_price": float(di.unit_price),
            }
            for di in draft_items
        ],
    }
    impact = {
        "total_amount": float(total_amount),
        "items_count": len(draft_items),
    }

    action = ProposedAction(
        id=action_id,
        kitchen_id=kitchen.id,
        group_id=group_id,
        option_number=1,
        action_type="order_intake",
        title=title,
        payload=payload,
        impact=impact,
        status="pending",
        base_plan_version=kitchen.plan_version,
        stock_fingerprint=stock_fp,
        created_at=now_utc,
        expires_at=expires_at,
    )
    db.add(action)
    db.flush()

    draft = OrderDraftOut(
        customer_name=customer_name,
        customer_phone=customer_phone,
        channel=channel,
        deadline=deadline,
        items=draft_items,
        total_amount=total_amount,
    )

    return OrderExtractSuccessResponse(
        draft=draft,
        confidence=float(raw.confidence),
        warnings=raw.warnings,
        action=OrderExtractActionOut(
            id=action.id,
            group_id=action.group_id,
            option_number=action.option_number,
            action_type=action.action_type,
            title=action.title,
            status=action.status,
            expires_at=action.expires_at,
        ),
    )
