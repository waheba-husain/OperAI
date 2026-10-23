import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.ai.extractor import RawExtractedItem, extract_order_from_text
from app.config import settings
from app.errors import AppError
from app.models import Ingredient, Kitchen, MenuItem, Order, OrderItem, ProposedAction
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


DATE_CUE_PATTERN = re.compile(
    r"\b(?:today|tomorrow|day after tomorrow|(?:this|next)\s+(?:week|weekend)|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2})\b",
    re.IGNORECASE,
)
TIME_CUE_PATTERN = re.compile(
    r"\b(?:\d{1,2}(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)|"
    r"\d{1,2}:[0-5]\d|noon|midnight)\b",
    re.IGNORECASE,
)
QUANTITY_WORDS = {
    "one": 1,
    "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20,
}


def _normalized_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def _source_supports(text: str, value: str | None) -> bool:
    normalized_value = _normalized_text(value or "")
    return bool(normalized_value and normalized_value in _normalized_text(text))


def _source_supports_quantity(text: str, quantity: int) -> bool:
    if re.search(rf"(?<!\d){quantity}(?!\d)", text):
        return True
    matches = list(re.finditer(r"\b(" + "|".join(QUANTITY_WORDS) + r")\b", text, re.IGNORECASE))
    for index, match in enumerate(matches):
        amount = QUANTITY_WORDS[match.group(1).casefold()]
        if (
            amount < 10
            and index > 0
            and matches[index - 1].group(1).casefold() == "twenty"
            and matches[index - 1].end() == match.start() - 1
        ):
            amount += 20
        if amount == quantity:
            return True
    return False


def _existing_order_intake_response(
    action: ProposedAction,
) -> OrderExtractSuccessResponse:
    payload = action.payload or {}
    draft = OrderDraftOut(
        customer_name=payload["customer_name"],
        customer_phone=payload.get("customer_phone"),
        channel=payload.get("channel", "whatsapp"),
        deadline=payload["deadline"],
        items=[
            OrderDraftItemOut(
                menu_item_id=UUID(str(item["menu_item_id"])),
                name=item["name"],
                quantity=item["quantity"],
                unit_price=Decimal(str(item["unit_price"])),
            )
            for item in payload["items"]
        ],
        total_amount=Decimal(str(payload["total_amount"])),
    )
    return OrderExtractSuccessResponse(
        draft=draft,
        confidence=float(payload.get("confidence", 0)),
        warnings=["An existing pending proposal for this exact message was returned."],
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
) -> tuple[OrderExtractSuccessResponse | OrderExtractAmbiguousResponse, bool]:
    if not text or len(text.strip()) == 0:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "text is required and cannot be empty",
        )
    if len(text) > 2000:
        raise AppError(
            422,
            "VALIDATION_ERROR",
            "text exceeds maximum allowed length of 2000 characters",
            {"length": len(text)},
        )

    kitchen = get_kitchen(db)
    # Serialize extraction submissions for the single kitchen so simultaneous retries
    # cannot create separate pending actions for the same customer message.
    kitchen = db.scalar(
        select(Kitchen).where(Kitchen.id == kitchen.id).with_for_update()
    )
    if kitchen is None:
        raise AppError(500, "INTERNAL_ERROR", "No kitchen configured")

    normalized_source = re.sub(r"\s+", " ", text).strip().casefold()
    existing_orders = db.scalars(
        select(Order).where(
            Order.kitchen_id == kitchen.id,
            Order.source_text.is_not(None),
        )
    ).all()
    if any(
        re.sub(r"\s+", " ", order.source_text or "").strip().casefold() == normalized_source
        for order in existing_orders
    ):
        return (
            OrderExtractAmbiguousResponse(
                draft=None,
                confidence=0.0,
                clarifying_questions=[
                    "An order was already created from this exact message. Confirm whether this is a separate new order before submitting it again."
                ],
                action=None,
            ),
            False,
        )

    pending_actions = db.scalars(
        select(ProposedAction)
        .where(
            ProposedAction.kitchen_id == kitchen.id,
            ProposedAction.action_type == "order_intake",
            ProposedAction.status == "pending",
        )
        .order_by(ProposedAction.created_at.desc())
    ).all()
    now_utc = datetime.now(timezone.utc)
    for existing in pending_actions:
        source = (existing.payload or {}).get("source_text")
        if not isinstance(source, str):
            continue
        if re.sub(r"\s+", " ", source).strip().casefold() != normalized_source:
            continue
        expiration = existing.expires_at
        if expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=timezone.utc)
        if expiration > now_utc:
            return _existing_order_intake_response(existing), False

    # AI extraction treats the pasted message strictly as data. The raw result is
    # schema-validated before any menu lookup or proposed action is created.
    raw = extract_order_from_text(text)
    if not raw.items:
        raise AppError(
            422,
            "EXTRACTION_FAILED",
            "No order could be found in the text",
        )

    active_menu = db.scalars(
        select(MenuItem).where(MenuItem.kitchen_id == kitchen.id, MenuItem.is_active.is_(True))
    ).all()

    # 2. In-code dish resolution and ambiguity detection
    ambiguous_questions: list[str] = []
    matched_pairs: list[tuple[RawExtractedItem, MenuItem]] = []

    for item in raw.items:
        if not _source_supports(text, item.dish):
            ambiguous_questions.append(
                f"Please confirm the dish '{item.dish}'; that dish was not found in the customer message."
            )
            continue
        if not _source_supports_quantity(text, item.quantity):
            ambiguous_questions.append(
                f"Please confirm the quantity for '{item.dish}'; the extracted quantity was not found in the customer message."
            )
            continue
        candidates = _match_dish_candidates(item.dish, active_menu)
        if len(candidates) > 1:
            names = " or ".join(m.name for m in candidates)
            ambiguous_questions.append(f"Which dish: {names}?")
        elif len(candidates) == 1:
            matched_pairs.append((item, candidates[0]))
        else:
            ambiguous_questions.append(
                f"Which active menu item did the customer mean by '{item.dish}'? No active menu item matches it."
            )

    customer_name = raw.customer_name.strip() if raw.customer_name and raw.customer_name.strip() else None
    if not _source_supports(text, customer_name):
        customer_name = None
        ambiguous_questions.append("What customer name should be used for this order?")

    customer_phone = raw.customer_phone.strip() if raw.customer_phone and raw.customer_phone.strip() else None
    if customer_phone:
        phone_digits = re.sub(r"\D", "", customer_phone)
        message_digits = re.sub(r"\D", "", text)
        if not phone_digits or phone_digits not in message_digits:
            customer_phone = None

    has_date_cue = bool(DATE_CUE_PATTERN.search(text))
    has_time_cue = bool(TIME_CUE_PATTERN.search(text))
    if not has_date_cue:
        ambiguous_questions.append("What delivery date should we use?")
    if not has_time_cue:
        ambiguous_questions.append("What delivery time should we use?")

    deadline: datetime | None = None
    if raw.deadline:
        try:
            deadline = datetime.fromisoformat(raw.deadline)
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=IST)
            else:
                deadline = deadline.astimezone(IST)
        except (ValueError, TypeError):
            deadline = None
    has_deadline_time = bool(
        raw.deadline
        and re.search(r"[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?", raw.deadline)
    )
    if deadline is None or not has_deadline_time:
        if has_date_cue and has_time_cue:
            ambiguous_questions.append("Please confirm the delivery date and time.")

    if ambiguous_questions or customer_name is None or deadline is None or not has_deadline_time:
        return OrderExtractAmbiguousResponse(
            draft=None,
            confidence=float(raw.confidence),
            clarifying_questions=list(dict.fromkeys(ambiguous_questions)),
            action=None,
        ), False

    # 3. Resolve source-backed customer details and code-owned menu prices.
    channel = "whatsapp"

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

    return (
        OrderExtractSuccessResponse(
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
        ),
        True,
    )
