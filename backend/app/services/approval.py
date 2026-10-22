import re
import urllib.parse
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from app.services.scheduler import book_interval, ensure_ist, find_earliest_slot
from app.timeutil import IST, day_bounds

from sqlalchemy import DateTime, Numeric, Uuid, select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import AuditLog, Ingredient, Kitchen, MenuItem, Order, OrderItem, PlanTask, ProposedAction
from app.schemas import (
    ActionApproveActionOut,
    ActionApproveResponse,
    ActionChangesOut,
    ActionRejectActionOut,
    ActionRejectResponse,
    CustomerMessageOut,
)
from app.services.audit import record_audit_log
from app.services.kitchen import get_kitchen
from app.services.recovery import _fingerprint


def _snapshot_ingredient(ing: Ingredient) -> dict:
    return {
        "id": str(ing.id),
        "kitchen_id": str(ing.kitchen_id),
        "name": ing.name,
        "unit": ing.unit,
        "stock_qty": str(ing.stock_qty),
        "cost_per_unit": str(ing.cost_per_unit),
        "allergen_tags": list(ing.allergen_tags) if ing.allergen_tags else [],
        "diet_tags": list(ing.diet_tags) if ing.diet_tags else [],
        "data_source": ing.data_source,
        "updated_at": ing.updated_at.isoformat() if ing.updated_at else None,
    }


def _apply_substitute(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    payload = action.payload or {}

    # 1. Handle stock update if present in payload
    stock_update = payload.get("stock_update")
    before_snapshot: dict = {}
    after_snapshot: dict = {}
    if stock_update and "ingredient_id" in stock_update and "reported_available_qty" in stock_update:
        ing_id = UUID(str(stock_update["ingredient_id"]))
        reported_qty = Decimal(str(stock_update["reported_available_qty"]))
        ing = db.scalar(
            select(Ingredient)
            .where(Ingredient.id == ing_id, Ingredient.kitchen_id == kitchen.id)
            .with_for_update()
        )
        if ing is not None:
            before_snapshot["ingredients"] = [_snapshot_ingredient(ing)]
            ing.stock_qty = reported_qty
            ing.updated_at = now
            after_snapshot["ingredients"] = [_snapshot_ingredient(ing)]

    # 2. Fetch original and replacement ingredients for descriptions (strictly kitchen-scoped)
    orig_ing = None
    if "ingredient_id" in payload:
        try:
            orig_id = UUID(str(payload["ingredient_id"]))
            orig_ing = db.scalar(
                select(Ingredient).where(
                    Ingredient.id == orig_id,
                    Ingredient.kitchen_id == kitchen.id,
                )
            )
        except (ValueError, TypeError):
            pass

    sub_ing = None
    if "substitute_ingredient_id" in payload:
        try:
            sub_id = UUID(str(payload["substitute_ingredient_id"]))
            sub_ing = db.scalar(
                select(Ingredient).where(
                    Ingredient.id == sub_id,
                    Ingredient.kitchen_id == kitchen.id,
                )
            )
        except (ValueError, TypeError):
            pass

    orig_name = orig_ing.name.lower() if orig_ing else "an ingredient"
    sub_name = sub_ing.name.lower() if sub_ing else "a substitute"

    # 3. Process affected orders and construct customer message drafts
    order_ids_raw = payload.get("order_ids", [])
    order_ids: list[UUID] = []
    for oid in order_ids_raw:
        try:
            order_ids.append(UUID(str(oid)))
        except (ValueError, TypeError):
            pass

    orders_map: dict[UUID, Order] = {}
    if order_ids:
        orders = db.scalars(
            select(Order).where(
                Order.kitchen_id == kitchen.id,
                Order.id.in_(order_ids),
                Order.status.not_in(["cancelled", "completed"]),
            )
        ).all()
        orders_map = {o.id: o for o in orders}

    customer_messages: list[CustomerMessageOut] = []
    verified_order_ids: list[UUID] = []
    seen_order_ids: set[UUID] = set()
    for oid in order_ids:
        if oid in seen_order_ids:
            continue
        order = orders_map.get(oid)
        if order is None:
            continue
        seen_order_ids.add(oid)
        verified_order_ids.append(order.id)
        msg_text = f"Hi {order.customer_name}, we are short of {orig_name}. May we use {sub_name} instead? Reply YES to confirm."
        text_encoded = urllib.parse.quote(msg_text)
        if order.customer_phone:
            cleaned_phone = re.sub(r"[^\d]", "", order.customer_phone)
            wa_url = f"https://wa.me/{cleaned_phone}?text={text_encoded}"
        else:
            wa_url = f"https://wa.me/?text={text_encoded}"
        customer_messages.append(
            CustomerMessageOut(
                order_id=order.id,
                customer_name=order.customer_name,
                needs_consent=True,
                message=msg_text,
                whatsapp_url=wa_url,
            )
        )

    # 4. Impact and summaries
    late_orders = 0
    if isinstance(action.impact, dict):
        late_orders = action.impact.get("late_orders", 0)

    order_count = len(verified_order_ids)
    if orig_ing and sub_ing:
        action_summary_base = f"Swapped {orig_name} for {sub_name} in {order_count} orders"
    else:
        action_summary_base = action.title

    changes_summary = f"{action_summary_base}; {late_orders} orders late"
    audit_summary = f"{action_summary_base}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}"
    if transcript:
        audit_summary += f" (transcript: {transcript})"

    changes = ActionChangesOut(
        orders_affected=[str(oid) for oid in verified_order_ids],
        tasks_rescheduled=0,
        summary=changes_summary,
    )

    return changes, customer_messages, before_snapshot, after_snapshot, audit_summary


def _wa_url(phone: str | None, message: str) -> str:
    encoded = urllib.parse.quote(message)
    if phone:
        clean_phone = re.sub(r"[^\d]", "", phone)
        return f"https://wa.me/{clean_phone}?text={encoded}"
    return f"https://wa.me/?text={encoded}"


def _task_conflicts(left: PlanTask, right: PlanTask) -> bool:
    same_burner = (
        left.burner_no is not None
        and right.burner_no is not None
        and left.burner_no == right.burner_no
    )
    same_cook = (
        left.task_type != "cook"
        and right.task_type != "cook"
        and left.cook_no == right.cook_no
    )
    same_resource = same_burner or same_cook
    return same_resource and left.start_at < right.end_at and right.start_at < left.end_at


def _resolve_task_overlaps(
    active_tasks: list[PlanTask],
    *,
    kitchen: Kitchen,
    before_rows: dict[str, dict[str, dict]],
    after_rows: dict[str, dict[str, dict]],
    locked_message: str = "A locked task blocks the dish swap replan",
) -> None:
    """Resolve resource overlaps and keep each prep before its cook task."""
    while True:
        moved_dependency = False
        tasks_by_item: dict[UUID, list[PlanTask]] = {}
        for task in active_tasks:
            tasks_by_item.setdefault(task.order_item_id, []).append(task)
        for item_tasks in tasks_by_item.values():
            prep_tasks = [task for task in item_tasks if task.task_type == "prep"]
            cook_tasks = [task for task in item_tasks if task.task_type == "cook"]
            for prep in prep_tasks:
                for cook in cook_tasks:
                    if prep.end_at <= cook.start_at:
                        continue
                    if cook.locked:
                        raise AppError(
                            409,
                            "PLAN_CHANGED",
                            locked_message,
                            {"task_id": str(cook.id)},
                        )
                    if str(cook.id) not in before_rows.get("plan_tasks", {}):
                        before_rows.setdefault("plan_tasks", {})[str(cook.id)] = _snapshot_row(cook)
                    duration = cook.end_at - cook.start_at
                    cook.start_at = prep.end_at
                    cook.end_at = cook.start_at + duration
                    cook.plan_version = kitchen.plan_version + 1
                    after_rows.setdefault("plan_tasks", {})[str(cook.id)] = _snapshot_row(cook)
                    moved_dependency = True

        conflict_pair = None
        ordered = sorted(active_tasks, key=lambda task: (task.start_at, str(task.id)))
        for index, left in enumerate(ordered):
            for right in ordered[index + 1:]:
                if _task_conflicts(left, right):
                    conflict_pair = (left, right)
                    break
            if conflict_pair:
                break
        if conflict_pair is None:
            if moved_dependency:
                continue
            break
        left, right = conflict_pair
        if right.locked:
            raise AppError(
                409,
                "PLAN_CHANGED",
                locked_message,
                {"task_id": str(right.id)},
            )
        if str(right.id) not in before_rows.get("plan_tasks", {}):
            before_rows.setdefault("plan_tasks", {})[str(right.id)] = _snapshot_row(right)
        duration = right.end_at - right.start_at
        right.start_at = left.end_at
        right.end_at = right.start_at + duration
        right.plan_version = kitchen.plan_version + 1
        after_rows.setdefault("plan_tasks", {})[str(right.id)] = _snapshot_row(right)


def _apply_dish_swap(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    payload = action.payload or {}
    before_rows: dict[str, dict[str, dict]] = {}
    after_rows: dict[str, dict[str, dict]] = {}

    def remember(table: str, row, *, before: bool) -> None:
        rows = before_rows if before else after_rows
        rows.setdefault(table, {}).setdefault(str(row.id), _snapshot_row(row))

    with db.begin_nested():
        stock_update = payload.get("stock_update")
        if isinstance(stock_update, dict):
            try:
                ingredient_id = UUID(str(stock_update["ingredient_id"]))
                reported_qty = Decimal(str(stock_update["reported_available_qty"]))
            except (KeyError, TypeError, ValueError):
                ingredient_id = None
            if ingredient_id is not None and reported_qty >= 0:
                ingredient = db.scalar(
                    select(Ingredient)
                    .where(Ingredient.id == ingredient_id, Ingredient.kitchen_id == kitchen.id)
                    .with_for_update()
                )
                if ingredient is not None:
                    remember("ingredients", ingredient, before=True)
                    ingredient.stock_qty = reported_qty
                    ingredient.updated_at = now
                    remember("ingredients", ingredient, before=False)

        changed_items: dict[UUID, tuple[Order, OrderItem, MenuItem, str]] = {}
        seen_item_ids: set[UUID] = set()
        for swap in payload.get("swaps", []):
            if not isinstance(swap, dict):
                continue
            try:
                item_id = UUID(str(swap["order_item_id"]))
                menu_id = UUID(str(swap["menu_item_id"]))
            except (KeyError, TypeError, ValueError):
                continue
            if item_id in seen_item_ids:
                continue
            seen_item_ids.add(item_id)

            item = db.scalar(
                select(OrderItem).where(OrderItem.id == item_id).with_for_update()
            )
            if item is None:
                continue
            order = db.scalar(
                select(Order)
                .where(
                    Order.id == item.order_id,
                    Order.kitchen_id == kitchen.id,
                    Order.status.not_in(["cancelled", "completed"]),
                )
                .with_for_update()
            )
            new_menu = db.scalar(
                select(MenuItem)
                .where(MenuItem.id == menu_id, MenuItem.kitchen_id == kitchen.id, MenuItem.is_active.is_(True))
                .with_for_update()
            )
            if order is None or new_menu is None or item.menu_item_id == new_menu.id:
                continue
            old_menu = db.scalar(
                select(MenuItem).where(MenuItem.id == item.menu_item_id, MenuItem.kitchen_id == kitchen.id)
            )
            remember("order_items", item, before=True)
            old_menu_name = old_menu.name if old_menu is not None else "the original dish"
            if item.swapped_from_item_id is None:
                item.swapped_from_item_id = item.menu_item_id
            item.menu_item_id = new_menu.id
            # Keep the accepted customer price unchanged; recovery impact math uses it.
            remember("order_items", item, before=False)
            changed_items[item.id] = (order, item, new_menu, old_menu_name)

        item_ids = list(changed_items)
        tasks = db.scalars(
            select(PlanTask)
            .where(
                PlanTask.kitchen_id == kitchen.id,
                PlanTask.order_item_id.in_(item_ids),
                PlanTask.status != "cancelled",
            )
            .order_by(PlanTask.start_at, PlanTask.id)
            .with_for_update()
        ).all() if item_ids else []
        active_tasks = db.scalars(
            select(PlanTask)
            .where(PlanTask.kitchen_id == kitchen.id, PlanTask.status != "cancelled")
            .order_by(PlanTask.start_at, PlanTask.id)
            .with_for_update()
        ).all()
        for task in tasks:
            if task.locked:
                continue
            new_menu = changed_items[task.order_item_id][2]
            duration = (
                new_menu.prep_minutes if task.task_type == "prep"
                else new_menu.cook_minutes if task.task_type == "cook"
                else None
            )
            if duration is None:
                continue
            remember("plan_tasks", task, before=True)
            task.end_at = task.start_at + timedelta(minutes=duration)
            task.plan_version = kitchen.plan_version + 1
            remember("plan_tasks", task, before=False)

        _resolve_task_overlaps(
            active_tasks,
            kitchen=kitchen,
            before_rows=before_rows,
            after_rows=after_rows,
        )

        db.flush()
        for table, rows in after_rows.items():
            model = _UNDO_MODELS[table]
            ids = [UUID(row_id) for row_id in rows]
            actual = db.scalars(select(model).where(model.id.in_(ids))).all()
            after_rows[table] = {str(row.id): _snapshot_row(row) for row in actual}

    before_snapshot = {table: list(rows.values()) for table, rows in before_rows.items()}
    after_snapshot = {table: list(rows.values()) for table, rows in after_rows.items()}

    messages: list[CustomerMessageOut] = []
    affected_order_ids: list[UUID] = []
    dish_names_by_order: dict[UUID, list[str]] = {}
    order_by_id: dict[UUID, Order] = {}
    for order, _item, new_menu, _old_name in changed_items.values():
        if order.id not in order_by_id:
            affected_order_ids.append(order.id)
            order_by_id[order.id] = order
        dish_names_by_order.setdefault(order.id, [])
        if new_menu.name not in dish_names_by_order[order.id]:
            dish_names_by_order[order.id].append(new_menu.name)
    for order_id in affected_order_ids:
        order = order_by_id[order_id]
        dish_names = ", ".join(dish_names_by_order[order_id])
        message = f"Hi {order.customer_name}, your dish was changed to {dish_names}. Reply if you have any concerns."
        messages.append(CustomerMessageOut(
            order_id=order.id,
            customer_name=order.customer_name,
            needs_consent=True,
            message=message,
            whatsapp_url=_wa_url(order.customer_phone, message),
        ))

    summary = f"Swapped {len(changed_items)} order items to in-stock dishes"
    if transcript:
        summary += f" (transcript: {transcript})"
    return (
        ActionChangesOut(
            orders_affected=[str(order_id) for order_id in affected_order_ids],
            tasks_rescheduled=len(before_rows.get("plan_tasks", {})),
            summary=summary,
        ),
        messages,
        before_snapshot,
        after_snapshot,
        f"{summary}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}",
    )


def _apply_emergency_purchase(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    payload = action.payload or {}
    before_rows: dict[str, dict[str, dict]] = {}
    after_rows: dict[str, dict[str, dict]] = {}

    def remember(table: str, row, *, before: bool) -> None:
        rows = before_rows if before else after_rows
        snapshot = _snapshot_ingredient(row) if table == "ingredients" else _snapshot_row(row)
        if before:
            rows.setdefault(table, {}).setdefault(str(row.id), snapshot)
        else:
            rows.setdefault(table, {})[str(row.id)] = snapshot

    try:
        ingredient_id = UUID(str(payload["ingredient_id"]))
        quantity = Decimal(str(payload["quantity"]))
        delay_minutes = int(payload["delay_minutes"])
    except (KeyError, TypeError, ValueError, InvalidOperation):
        ingredient_id = None
        quantity = Decimal("0")
        delay_minutes = 0
    if quantity < 0 or delay_minutes < 0:
        raise AppError(422, "VALIDATION_ERROR", "Purchase quantity and delay must be nonnegative")

    affected_orders: list[Order] = []
    active_tasks: list[PlanTask] = []
    with db.begin_nested():
        stock_update = payload.get("stock_update")
        if isinstance(stock_update, dict):
            try:
                reported_id = UUID(str(stock_update["ingredient_id"]))
                reported_qty = Decimal(str(stock_update["reported_available_qty"]))
            except (KeyError, TypeError, ValueError, InvalidOperation):
                reported_id = None
            if reported_id is not None and reported_qty >= 0:
                reported_ingredient = db.scalar(
                    select(Ingredient)
                    .where(Ingredient.id == reported_id, Ingredient.kitchen_id == kitchen.id)
                    .with_for_update()
                )
                if reported_ingredient is not None:
                    remember("ingredients", reported_ingredient, before=True)
                    reported_ingredient.stock_qty = reported_qty
                    reported_ingredient.updated_at = now
                    remember("ingredients", reported_ingredient, before=False)

        ingredient = None
        if ingredient_id is not None:
            ingredient = db.scalar(
                select(Ingredient)
                .where(Ingredient.id == ingredient_id, Ingredient.kitchen_id == kitchen.id)
                .with_for_update()
            )
        if ingredient is not None:
            remember("ingredients", ingredient, before=True)
            ingredient.stock_qty += quantity
            ingredient.updated_at = now
            remember("ingredients", ingredient, before=False)

        order_ids: list[UUID] = []
        for raw_order_id in payload.get("order_ids") or []:
            try:
                parsed_id = UUID(str(raw_order_id))
            except (TypeError, ValueError):
                continue
            if parsed_id not in order_ids:
                order_ids.append(parsed_id)
        orders_by_id: dict[UUID, Order] = {}
        if order_ids:
            affected_orders = db.scalars(
                select(Order)
                .where(
                    Order.kitchen_id == kitchen.id,
                    Order.id.in_(order_ids),
                    Order.status.not_in(["cancelled", "completed"]),
                )
                .order_by(Order.id)
                .with_for_update()
            ).all()
            orders_by_id = {order.id: order for order in affected_orders}

        task_order_ids = list(orders_by_id)
        if task_order_ids:
            target_tasks = db.scalars(
                select(PlanTask)
                .join(OrderItem, OrderItem.id == PlanTask.order_item_id)
                .where(
                    PlanTask.kitchen_id == kitchen.id,
                    PlanTask.status != "cancelled",
                    OrderItem.order_id.in_(task_order_ids),
                )
                .order_by(PlanTask.start_at, PlanTask.id)
                .with_for_update()
            ).all()
            for task in target_tasks:
                if task.locked:
                    continue
                remember("plan_tasks", task, before=True)
                task.start_at += timedelta(minutes=delay_minutes)
                task.end_at += timedelta(minutes=delay_minutes)
                task.plan_version = kitchen.plan_version + 1
                remember("plan_tasks", task, before=False)

            for order in affected_orders:
                remember("orders", order, before=True)
                order.status = "delayed"
                remember("orders", order, before=False)

            active_tasks = db.scalars(
                select(PlanTask)
                .where(PlanTask.kitchen_id == kitchen.id, PlanTask.status != "cancelled")
                .order_by(PlanTask.start_at, PlanTask.id)
                .with_for_update()
            ).all()
            _resolve_task_overlaps(
                active_tasks,
                kitchen=kitchen,
                before_rows=before_rows,
                after_rows=after_rows,
                locked_message="A locked task blocks the emergency purchase replan",
            )
        else:
            for order in affected_orders:
                remember("orders", order, before=True)
                order.status = "delayed"
                remember("orders", order, before=False)

        db.flush()
        for table, rows in after_rows.items():
            model = _UNDO_MODELS[table]
            row_ids = [UUID(row_id) for row_id in rows]
            current_rows = db.scalars(select(model).where(model.id.in_(row_ids))).all()
            after_rows[table] = {
                str(row.id): _snapshot_ingredient(row) if table == "ingredients" else _snapshot_row(row)
                for row in current_rows
            }

    messages: list[CustomerMessageOut] = []
    for order in affected_orders:
        message = (
            f"Hi {order.customer_name}, your order will be about {delay_minutes} minutes late. "
            "We will keep you updated."
        )
        messages.append(CustomerMessageOut(
            order_id=order.id,
            customer_name=order.customer_name,
            needs_consent=True,
            message=message,
            whatsapp_url=_wa_url(order.customer_phone, message),
        ))

    summary = f"Purchased {quantity} units and delayed {len(affected_orders)} orders by {delay_minutes} minutes"
    if transcript:
        summary += f" (transcript: {transcript})"
    return (
        ActionChangesOut(
            orders_affected=[str(order.id) for order in affected_orders],
            tasks_rescheduled=len(before_rows.get("plan_tasks", {})),
            summary=summary,
        ),
        messages,
        {table: list(rows.values()) for table, rows in before_rows.items()},
        {table: list(rows.values()) for table, rows in after_rows.items()},
        f"{summary}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}",
    )


_UNDO_MODELS = {
    "ingredients": Ingredient,
    "orders": Order,
    "order_items": OrderItem,
    "plan_tasks": PlanTask,
}
_UNDO_RESTORE_ORDER = ("orders", "order_items", "plan_tasks", "ingredients")
_UNDO_DELETE_ORDER = ("plan_tasks", "order_items", "orders", "ingredients")


def _json_value(value):
    if isinstance(value, (UUID,)):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _snapshot_row(row) -> dict:
    return {column.name: _json_value(getattr(row, column.name)) for column in row.__table__.columns}


def _restore_value(column, value):
    if value is None:
        return None
    if isinstance(column.type, Uuid):
        return UUID(str(value))
    if isinstance(column.type, Numeric):
        return Decimal(str(value))
    if isinstance(column.type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def _same_value(column, current, desired) -> bool:
    if isinstance(column.type, DateTime) and current is not None and desired is not None:
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        if desired.tzinfo is None:
            desired = desired.replace(tzinfo=timezone.utc)
        return current == desired
    return current == desired


def _apply_undo(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    source = db.scalar(select(AuditLog).where(
        AuditLog.id == action.undo_of_audit_id,
        AuditLog.kitchen_id == kitchen.id,
        AuditLog.event_type == "action_executed",
    ))
    if source is None:
        raise AppError(409, "UNDO_NOT_ALLOWED", "The source audit entry is no longer undoable")

    target_snapshot = action.payload or {}
    changed_before: dict[str, list[dict]] = {}
    changed_after: dict[str, list[dict]] = {}
    with db.begin_nested():
        for table in _UNDO_DELETE_ORDER:
            model = _UNDO_MODELS[table]
            before_rows = {str(row.get("id")): row for row in target_snapshot.get(table, [])}
            after_rows = {str(row.get("id")): row for row in (source.after_snapshot or {}).get(table, [])}
            for row_id in after_rows.keys() - before_rows.keys():
                record = db.scalar(select(model).where(model.id == UUID(row_id)).with_for_update())
                if record is None or getattr(record, "kitchen_id", kitchen.id) != kitchen.id:
                    continue
                if isinstance(record, PlanTask) and record.locked:
                    raise AppError(409, "PLAN_CHANGED", "Undo cannot remove a locked plan task", {"task_id": row_id})
                changed_before.setdefault(table, []).append(_snapshot_row(record))
                db.delete(record)

        for table in _UNDO_RESTORE_ORDER:
            model = _UNDO_MODELS[table]
            for row in target_snapshot.get(table, []):
                row_id = UUID(str(row["id"]))
                current = db.scalar(select(model).where(model.id == row_id).with_for_update())
                if current is not None and getattr(current, "kitchen_id", kitchen.id) != kitchen.id:
                    raise AppError(409, "PLAN_CHANGED", "Undo snapshot references another kitchen")
                if isinstance(current, PlanTask) and current.locked:
                    desired = {
                        column.name: _restore_value(column, row.get(column.name))
                        for column in model.__table__.columns
                    }
                    current_values = {
                        column.name: getattr(current, column.name)
                        for column in model.__table__.columns
                    }
                    if any(
                        not _same_value(column, current_values[column.name], desired[column.name])
                        for column in model.__table__.columns
                    ):
                        raise AppError(
                            409,
                            "PLAN_CHANGED",
                            "Undo cannot move a locked plan task",
                            {"task_id": str(row_id)},
                        )
                    continue
                if current is not None:
                    changed_before.setdefault(table, []).append(_snapshot_row(current))
                values = {
                    column.name: _restore_value(column, row.get(column.name))
                    for column in model.__table__.columns
                }
                if current is None:
                    current = model(**values)
                    db.add(current)
                else:
                    for key, value in values.items():
                        setattr(current, key, value)
                changed_after.setdefault(table, []).append(dict(row))
        db.flush()
        for table in _UNDO_MODELS:
            if table in changed_after or table in changed_before:
                model = _UNDO_MODELS[table]
                ids = {row["id"] for row in changed_before.get(table, []) + changed_after.get(table, [])}
                changed_after[table] = [
                    _snapshot_row(row)
                    for row in db.scalars(
                        select(model).where(model.id.in_([UUID(str(value)) for value in ids]))
                    ).all()
                ]
    summary = f"Undid audit entry {source.id}; plan v{kitchen.plan_version} to v{kitchen.plan_version + 1}"
    return (
        ActionChangesOut(orders_affected=[], tasks_rescheduled=len(changed_after.get("plan_tasks", [])), summary=f"Restored state from audit {source.id}"),
        [],
        changed_before or {},
        changed_after or {},
        summary,
    )


def _apply_order_intake(
    db: Session,
    *,
    kitchen: Kitchen,
    action: ProposedAction,
    now: datetime,
    transcript: str | None = None,
) -> tuple[ActionChangesOut, list[CustomerMessageOut], dict, dict, str]:
    payload = action.payload or {}
    customer_name = payload.get("customer_name") or "Customer"
    customer_phone = payload.get("customer_phone")
    channel = payload.get("channel", "whatsapp")
    deadline_raw = payload.get("deadline")
    if not deadline_raw:
        raise AppError(422, "VALIDATION_ERROR", "Order deadline is required in payload")
    deadline = datetime.fromisoformat(str(deadline_raw))
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=IST)
    else:
        deadline = deadline.astimezone(IST)

    total_amount = Decimal(str(payload.get("total_amount", "0.00")))
    source_text = payload.get("source_text")
    confidence = Decimal(str(payload.get("confidence", "1.00")))

    target_date = deadline.date()
    start_bound, end_bound = day_bounds(target_date)

    # Require an existing daily plan on the target date
    existing_tasks = db.scalars(
        select(PlanTask).where(
            PlanTask.kitchen_id == kitchen.id,
            PlanTask.start_at >= start_bound,
            PlanTask.start_at < end_bound,
            PlanTask.status != "cancelled",
        ).with_for_update()
    ).all()

    if not existing_tasks:
        raise AppError(
            404,
            "PLAN_NOT_FOUND",
            f"No plan exists for date {target_date.isoformat()}; call /api/plan/generate first",
            {"date": target_date.isoformat()},
        )

    # 1. Insert Order
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        channel=channel,
        deadline=deadline,
        status="planned",
        total_amount=total_amount,
        source_text=source_text,
        extraction_confidence=confidence,
        data_source="simulated",
        created_at=now,
    )
    db.add(order)
    db.flush()

    # 2. Insert OrderItems
    order_items: list[OrderItem] = []
    for it_data in payload.get("items", []):
        oi = OrderItem(
            id=uuid4(),
            order_id=order.id,
            menu_item_id=UUID(str(it_data["menu_item_id"])),
            quantity=int(it_data["quantity"]),
            unit_price=Decimal(str(it_data["unit_price"])),
            swapped_from_item_id=None,
        )
        db.add(oi)
        order_items.append(oi)
    db.flush()

    # 3. Schedule ONLY new tasks into existing timeline (locked tasks never move)
    day_start = datetime(target_date.year, target_date.month, target_date.day, 9, 0, tzinfo=IST)
    cook_intervals: dict[int, list[tuple[datetime, datetime]]] = {
        c: [] for c in range(1, kitchen.cook_count + 1)
    }
    burner_intervals: dict[int, list[tuple[datetime, datetime]]] = {
        b: [] for b in range(1, kitchen.burner_count + 1)
    }

    # Book all existing tasks as occupied intervals
    for t in existing_tasks:
        s_at = ensure_ist(t.start_at)
        e_at = ensure_ist(t.end_at)
        if t.task_type == "prep":
            if 1 <= t.cook_no <= kitchen.cook_count:
                book_interval(cook_intervals[t.cook_no], s_at, e_at)
        elif t.task_type == "cook":
            if t.burner_no is not None and 1 <= t.burner_no <= kitchen.burner_count:
                book_interval(burner_intervals[t.burner_no], s_at, e_at)

    new_tasks: list[PlanTask] = []
    task_version = kitchen.plan_version + 1
    max_end_time = day_start

    for oi in order_items:
        menu = db.scalar(
            select(MenuItem).where(MenuItem.id == oi.menu_item_id, MenuItem.kitchen_id == kitchen.id)
        )
        if menu is None:
            continue
        prep_min = menu.prep_minutes
        cook_min = menu.cook_minutes

        prep_end = day_start
        prep_cook = 1

        if prep_min > 0:
            best_cook = 1
            best_prep_start = None
            for c in range(1, kitchen.cook_count + 1):
                slot_start = find_earliest_slot(cook_intervals[c], day_start, prep_min)
                if (
                    best_prep_start is None
                    or slot_start < best_prep_start
                    or (slot_start == best_prep_start and c < best_cook)
                ):
                    best_prep_start = slot_start
                    best_cook = c
            p_start = best_prep_start if best_prep_start is not None else day_start
            p_end = p_start + timedelta(minutes=prep_min)
            book_interval(cook_intervals[best_cook], p_start, p_end)
            prep_end = p_end
            prep_cook = best_cook

            p_task = PlanTask(
                id=uuid4(),
                kitchen_id=kitchen.id,
                order_item_id=oi.id,
                task_type="prep",
                burner_no=None,
                cook_no=best_cook,
                start_at=p_start,
                end_at=p_end,
                status="scheduled",
                locked=False,
                plan_version=task_version,
            )
            new_tasks.append(p_task)
            if p_end > max_end_time:
                max_end_time = p_end

        if cook_min > 0:
            earliest_cook = max(day_start, prep_end)
            best_burner = 1
            best_cook_start = None
            for b in range(1, kitchen.burner_count + 1):
                slot_start = find_earliest_slot(burner_intervals[b], earliest_cook, cook_min)
                if (
                    best_cook_start is None
                    or slot_start < best_cook_start
                    or (slot_start == best_cook_start and b < best_burner)
                ):
                    best_cook_start = slot_start
                    best_burner = b
            c_start = best_cook_start if best_cook_start is not None else earliest_cook
            c_end = c_start + timedelta(minutes=cook_min)
            book_interval(burner_intervals[best_burner], c_start, c_end)

            c_task = PlanTask(
                id=uuid4(),
                kitchen_id=kitchen.id,
                order_item_id=oi.id,
                task_type="cook",
                burner_no=best_burner,
                cook_no=prep_cook,
                start_at=c_start,
                end_at=c_end,
                status="scheduled",
                locked=False,
                plan_version=task_version,
            )
            new_tasks.append(c_task)
            if c_end > max_end_time:
                max_end_time = c_end

    db.add_all(new_tasks)

    # Check deadline
    if max_end_time > ensure_ist(order.deadline):
        order.status = "delayed"

    before_snapshot: dict = {
        "orders": [],
        "order_items": [],
        "plan_tasks": [],
    }
    after_snapshot = {
        "orders": [_snapshot_row(order)],
        "order_items": [_snapshot_row(it) for it in order_items],
        "plan_tasks": [_snapshot_row(pt) for pt in new_tasks],
    }
    audit_summary = (
        f"Approved order intake for {order.customer_name} ({len(order_items)} items); "
        f"scheduled {len(new_tasks)} tasks"
    )
    changes = ActionChangesOut(
        orders_affected=[str(order.id)],
        tasks_rescheduled=len(new_tasks),
        summary=audit_summary,
    )
    return changes, [], before_snapshot, after_snapshot, audit_summary


APPLIERS = {
    ("recovery", "substitute"): _apply_substitute,
    ("recovery", "dish_swap"): _apply_dish_swap,
    ("recovery", "emergency_purchase"): _apply_emergency_purchase,
    ("undo", None): _apply_undo,
    ("order_intake", None): _apply_order_intake,
    ("order_intake", "order_intake"): _apply_order_intake,
}


def approve_action(
    db: Session,
    *,
    action_id: UUID,
    confirm_option_number: int,
    input_mode: str | None = None,
    transcript: str | None = None,
) -> ActionApproveResponse:
    kitchen = get_kitchen(db)

    # 1. Lock kitchen first to establish a top-down lock hierarchy and prevent circular wait
    kitchen_locked = db.scalar(
        select(Kitchen).where(Kitchen.id == kitchen.id).with_for_update()
    )
    if kitchen_locked is None:
        raise AppError(500, "INTERNAL_ERROR", "No kitchen configured")

    # 2. Lock and retrieve the action within the locked kitchen
    action = db.scalar(
        select(ProposedAction)
        .where(ProposedAction.id == action_id, ProposedAction.kitchen_id == kitchen_locked.id)
        .with_for_update()
    )
    if action is None:
        raise AppError(
            404,
            "ACTION_NOT_FOUND",
            f"Action {action_id} not found",
            {"action_id": str(action_id)},
        )

    # 3. Require status == "pending"
    if action.status != "pending":
        raise AppError(
            409,
            "ACTION_NOT_PENDING",
            f"Action {action_id} is no longer pending",
            {"action_id": str(action_id), "status": action.status},
        )

    # 4. Reject expired actions
    now = datetime.now(timezone.utc)
    expires_at = action.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now >= expires_at:
        raise AppError(
            409,
            "ACTION_EXPIRED",
            f"Action {action_id} has expired",
            {"action_id": str(action_id), "expires_at": action.expires_at.isoformat()},
        )

    # 5. Validate confirm_option_number
    if confirm_option_number != action.option_number:
        raise AppError(
            422,
            "OPTION_MISMATCH",
            f"Option number mismatch: requested {confirm_option_number}, action is option {action.option_number}",
            {"expected": action.option_number, "provided": confirm_option_number},
        )

    # 6. Validate base_plan_version against locked kitchen
    if kitchen_locked.plan_version != action.base_plan_version:
        raise AppError(
            409,
            "PLAN_CHANGED",
            f"Plan version changed from {action.base_plan_version} to {kitchen_locked.plan_version}",
            {"expected_version": action.base_plan_version, "current_version": kitchen_locked.plan_version},
        )

    # 7. Recompute the stock fingerprint using the existing _fingerprint helper and validate it
    ingredients = db.scalars(
        select(Ingredient).where(Ingredient.kitchen_id == kitchen_locked.id)
    ).all()
    current_fingerprint = _fingerprint(ingredients)
    if current_fingerprint != action.stock_fingerprint:
        raise AppError(
            409,
            "STOCK_CHANGED",
            "Stock changed since proposal was created",
            {"expected_fingerprint": action.stock_fingerprint, "current_fingerprint": current_fingerprint},
        )

    # Resolve applier
    payload = action.payload or {}
    option_type = payload.get("option_type") if isinstance(payload, dict) else None
    applier = APPLIERS.get((action.action_type, option_type))
    if applier is None:
        raise AppError(
            422,
            "UNSUPPORTED_ACTION",
            f"Action '{action.action_type}' with option '{option_type}' is not supported",
            {"action_type": action.action_type, "option_type": option_type},
        )

    # Execute applier
    changes, customer_messages, before_snapshot, after_snapshot, audit_summary = applier(
        db,
        kitchen=kitchen_locked,
        action=action,
        now=now,
        transcript=transcript,
    )

    # Expire pending sibling actions in the same group in deterministic ID order
    siblings = db.scalars(
        select(ProposedAction)
        .where(
            ProposedAction.kitchen_id == kitchen_locked.id,
            ProposedAction.group_id == action.group_id,
            ProposedAction.id != action.id,
            ProposedAction.status == "pending",
        )
        .order_by(ProposedAction.id)
        .with_for_update()
    ).all()
    expired_action_ids: list[UUID] = []
    for sibling in siblings:
        sibling.status = "expired"
        sibling.decided_at = now
        expired_action_ids.append(sibling.id)

    # Increment kitchen plan version
    plan_version_before = kitchen_locked.plan_version
    plan_version_after = plan_version_before + 1
    kitchen_locked.plan_version = plan_version_after

    # Record audit log
    audit_entry = record_audit_log(
        db,
        kitchen_id=kitchen.id,
        action_id=action.id,
        event_type="undo_executed" if action.action_type == "undo" else "action_executed",
        actor="owner",
        summary=audit_summary,
        before_snapshot=before_snapshot if before_snapshot else None,
        after_snapshot=after_snapshot if after_snapshot else None,
        plan_version_before=plan_version_before,
        plan_version_after=plan_version_after,
    )

    # Transition approved action to executed
    action.status = "executed"
    action.decided_at = now
    action.executed_at = now

    return ActionApproveResponse(
        action=ActionApproveActionOut(
            id=action.id,
            status="executed",
            executed_at=action.executed_at,
        ),
        plan_version_before=plan_version_before,
        plan_version_after=plan_version_after,
        audit_id=audit_entry.id,
        changes=changes,
        customer_messages=customer_messages,
        expired_action_ids=expired_action_ids,
    )


def reject_action(
    db: Session,
    *,
    action_id: UUID,
    reason: str | None = None,
) -> ActionRejectResponse:
    kitchen = get_kitchen(db)
    action = db.scalar(
        select(ProposedAction)
        .where(ProposedAction.id == action_id, ProposedAction.kitchen_id == kitchen.id)
        .with_for_update()
    )
    if action is None:
        raise AppError(
            404,
            "ACTION_NOT_FOUND",
            f"Action {action_id} not found",
            {"action_id": str(action_id)},
        )

    if action.status != "pending":
        raise AppError(
            409,
            "ACTION_NOT_PENDING",
            f"Action {action_id} is no longer pending",
            {"action_id": str(action_id), "status": action.status},
        )

    now = datetime.now(timezone.utc)
    action.status = "rejected"
    action.decided_at = now

    summary = f"Rejected proposal: {action.title}"
    if reason:
        summary += f" ({reason})"

    audit_entry = record_audit_log(
        db,
        kitchen_id=kitchen.id,
        action_id=action.id,
        event_type="action_rejected",
        actor="owner",
        summary=summary,
        before_snapshot=None,
        after_snapshot=None,
        plan_version_before=kitchen.plan_version,
        plan_version_after=kitchen.plan_version,
    )

    return ActionRejectResponse(
        action=ActionRejectActionOut(
            id=action.id,
            status="rejected",
            decided_at=action.decided_at,
        ),
        audit_id=audit_entry.id,
    )
