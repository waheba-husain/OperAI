from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.errors import AppError
from app.models import AuditLog, Kitchen, Order, OrderItem, PlanTask
from app.schemas import (
    PlanGenerateResponse,
    PlanResponse,
    PlanTaskOut,
)
from app.services.kitchen import get_kitchen
from app.timeutil import IST, day_bounds


def ensure_ist(dt: datetime) -> datetime:
    """Ensure datetime has IST timezone for safe comparison and serialization."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=IST)
    return dt.astimezone(IST)


def find_earliest_slot(
    intervals: list[tuple[datetime, datetime]],
    earliest_start: datetime,
    duration_minutes: int,
) -> datetime:
    """Find the earliest start time >= earliest_start where a slot of duration_minutes is free."""
    sorted_intervals = sorted(intervals, key=lambda x: x[0])
    candidate = earliest_start
    duration = timedelta(minutes=duration_minutes)

    while True:
        conflict = False
        for start, end in sorted_intervals:
            if candidate < end and (candidate + duration) > start:
                candidate = max(candidate, end)
                conflict = True
                break
        if not conflict:
            return candidate


def book_interval(
    intervals: list[tuple[datetime, datetime]],
    start: datetime,
    end: datetime,
) -> None:
    """Insert a booked interval into the list."""
    intervals.append((start, end))


def schedule_greedy(
    orders: list[Order],
    cook_count: int,
    burner_count: int,
    day_start: datetime,
    locked_tasks: list[PlanTask],
    kitchen_id: object,
    plan_version: int,
) -> tuple[list[PlanTask], list[str]]:
    """
    Greedy forward scheduler from 09:00 IST sorting orders by deadline.
    Respects cook and burner resource capacities and preserves locked tasks.
    """
    cook_intervals: dict[int, list[tuple[datetime, datetime]]] = {
        c: [] for c in range(1, cook_count + 1)
    }
    burner_intervals: dict[int, list[tuple[datetime, datetime]]] = {
        b: [] for b in range(1, burner_count + 1)
    }

    # Populate intervals with locked tasks so new tasks never overlap them
    for lt in locked_tasks:
        s_at = ensure_ist(lt.start_at)
        e_at = ensure_ist(lt.end_at)
        if lt.task_type == "prep":
            if 1 <= lt.cook_no <= cook_count:
                book_interval(cook_intervals[lt.cook_no], s_at, e_at)
        elif lt.task_type == "cook":
            if lt.burner_no is not None and 1 <= lt.burner_no <= burner_count:
                book_interval(burner_intervals[lt.burner_no], s_at, e_at)

    locked_item_ids = {lt.order_item_id for lt in locked_tasks}
    new_tasks: list[PlanTask] = []
    order_task_ends: dict[object, list[datetime]] = {o.id: [] for o in orders}

    # Record locked task ends
    for lt in locked_tasks:
        for o in orders:
            for item in o.items:
                if item.id == lt.order_item_id:
                    order_task_ends[o.id].append(lt.end_at)

    for order in orders:
        for item in order.items:
            if item.id in locked_item_ids:
                continue

            menu = item.menu_item
            prep_min = menu.prep_minutes
            cook_min = menu.cook_minutes

            prep_end_time = day_start
            prep_cook_no = 1

            # Schedule Prep Task (needs a cook for prep_minutes)
            if prep_min > 0:
                best_cook = 1
                best_prep_start = None
                for c in range(1, cook_count + 1):
                    slot_start = find_earliest_slot(cook_intervals[c], day_start, prep_min)
                    if (
                        best_prep_start is None
                        or slot_start < best_prep_start
                        or (slot_start == best_prep_start and c < best_cook)
                    ):
                        best_prep_start = slot_start
                        best_cook = c

                prep_start = best_prep_start if best_prep_start is not None else day_start
                prep_end = prep_start + timedelta(minutes=prep_min)
                book_interval(cook_intervals[best_cook], prep_start, prep_end)

                prep_end_time = prep_end
                prep_cook_no = best_cook

                prep_task = PlanTask(
                    id=uuid4(),
                    kitchen_id=kitchen_id,
                    order_item_id=item.id,
                    task_type="prep",
                    burner_no=None,
                    cook_no=best_cook,
                    start_at=prep_start,
                    end_at=prep_end,
                    status="scheduled",
                    locked=False,
                    plan_version=plan_version,
                )
                new_tasks.append(prep_task)
                order_task_ends[order.id].append(prep_end)

            # Schedule Cook Task (uses a burner for cook_minutes; cook_no records who started it)
            if cook_min > 0:
                earliest_cook_start = max(day_start, prep_end_time)
                best_burner = 1
                best_cook_start = None
                for b in range(1, burner_count + 1):
                    slot_start = find_earliest_slot(burner_intervals[b], earliest_cook_start, cook_min)
                    if (
                        best_cook_start is None
                        or slot_start < best_cook_start
                        or (slot_start == best_cook_start and b < best_burner)
                    ):
                        best_cook_start = slot_start
                        best_burner = b

                cook_start = best_cook_start if best_cook_start is not None else earliest_cook_start
                cook_end = cook_start + timedelta(minutes=cook_min)
                book_interval(burner_intervals[best_burner], cook_start, cook_end)

                cook_task = PlanTask(
                    id=uuid4(),
                    kitchen_id=kitchen_id,
                    order_item_id=item.id,
                    task_type="cook",
                    burner_no=best_burner,
                    cook_no=prep_cook_no,
                    start_at=cook_start,
                    end_at=cook_end,
                    status="scheduled",
                    locked=False,
                    plan_version=plan_version,
                )
                new_tasks.append(cook_task)
                order_task_ends[order.id].append(cook_end)

    # Check deadlines
    late_orders: list[str] = []
    for order in orders:
        ends = order_task_ends.get(order.id, [])
        order_dl = ensure_ist(order.deadline)
        if ends and max(ensure_ist(e) for e in ends) > order_dl:
            late_orders.append(str(order.id))

    return new_tasks, late_orders


def generate_plan(
    db: Session,
    *,
    target_date: date,
    regenerate: bool = False,
) -> PlanGenerateResponse:
    kitchen = get_kitchen(db)
    date_str = target_date.isoformat()
    start_bound, end_bound = day_bounds(target_date)

    # Check existing plan tasks for this date
    existing_tasks = db.scalars(
        select(PlanTask).where(
            PlanTask.kitchen_id == kitchen.id,
            PlanTask.start_at >= start_bound,
            PlanTask.start_at < end_bound,
            PlanTask.status != "cancelled",
        )
    ).all()

    if existing_tasks and not regenerate:
        raise AppError(
            409,
            "PLAN_EXISTS",
            f"A plan already exists for date {date_str} and regenerate is false",
            {"date": date_str},
        )

    # Load orders for the date sorted by deadline
    orders = db.scalars(
        select(Order)
        .where(
            Order.kitchen_id == kitchen.id,
            Order.deadline >= start_bound,
            Order.deadline < end_bound,
            Order.status.not_in(["cancelled", "completed"]),
        )
        .options(selectinload(Order.items).selectinload(OrderItem.menu_item))
        .order_by(Order.deadline, Order.created_at, Order.id)
    ).all()

    if not orders:
        raise AppError(
            422,
            "NO_ORDERS_FOR_DATE",
            f"No orders found for date {date_str}",
            {"date": date_str},
        )

    locked_tasks: list[PlanTask] = []
    if existing_tasks and regenerate:
        # AGENTS.md Hard Rule 10: Locked plan tasks never move during a replan.
        for t in existing_tasks:
            if t.locked:
                locked_tasks.append(t)
            else:
                db.delete(t)
        db.flush()

    day_start = datetime(target_date.year, target_date.month, target_date.day, 9, 0, tzinfo=IST)
    next_plan_version = kitchen.plan_version + 1

    new_tasks, late_orders = schedule_greedy(
        orders=orders,
        cook_count=kitchen.cook_count,
        burner_count=kitchen.burner_count,
        day_start=day_start,
        locked_tasks=locked_tasks,
        kitchen_id=kitchen.id,
        plan_version=next_plan_version,
    )

    # Persist newly scheduled tasks
    db.add_all(new_tasks)

    # Transition orders from 'new' to 'planned'
    for order in orders:
        if order.status == "new":
            order.status = "planned"

    # Bump kitchen plan_version
    old_version = kitchen.plan_version
    kitchen.plan_version = next_plan_version

    # Write audit log entry
    all_tasks_count = len(locked_tasks) + len(new_tasks)
    event_type = "plan_regenerated" if (existing_tasks and regenerate) else "plan_generated"
    summary = (
        f"Generated schedule for {date_str}: {len(orders)} orders, "
        f"{all_tasks_count} tasks; plan v{kitchen.plan_version}"
    )

    audit_entry = AuditLog(
        id=uuid4(),
        kitchen_id=kitchen.id,
        action_id=None,
        event_type=event_type,
        actor="system",
        summary=summary,
        before_snapshot=None,
        after_snapshot={"task_count": all_tasks_count, "orders_scheduled": len(orders)},
        plan_version_before=old_version,
        plan_version_after=kitchen.plan_version,
        created_at=datetime.now(timezone.utc),
    )
    db.add(audit_entry)
    db.flush()

    return PlanGenerateResponse(
        date=date_str,
        plan_version=kitchen.plan_version,
        solver="greedy",
        feasible=(len(late_orders) == 0),
        orders_scheduled=len(orders),
        task_count=all_tasks_count,
        late_orders=late_orders,
    )


def get_plan(db: Session, *, target_date: date) -> PlanResponse:
    kitchen = get_kitchen(db)
    date_str = target_date.isoformat()
    start_bound, end_bound = day_bounds(target_date)

    tasks = db.scalars(
        select(PlanTask)
        .where(
            PlanTask.kitchen_id == kitchen.id,
            PlanTask.start_at >= start_bound,
            PlanTask.start_at < end_bound,
            PlanTask.status != "cancelled",
        )
        .options(
            selectinload(PlanTask.order_item).selectinload(OrderItem.menu_item),
            selectinload(PlanTask.order_item).selectinload(OrderItem.order),
        )
        .order_by(PlanTask.start_at, PlanTask.id)
    ).all()

    if not tasks:
        raise AppError(
            404,
            "PLAN_NOT_FOUND",
            f"No plan found for date {date_str}",
            {"date": date_str},
        )

    late_order_ids: set[str] = set()
    task_outs: list[PlanTaskOut] = []

    for t in tasks:
        order = t.order_item.order if t.order_item else None
        dish_name = t.order_item.menu_item.name if (t.order_item and t.order_item.menu_item) else "Unknown"
        order_id = order.id if order else t.order_item.order_id
        t_start = ensure_ist(t.start_at)
        t_end = ensure_ist(t.end_at)

        if order and t_end > ensure_ist(order.deadline):
            late_order_ids.add(str(order.id))

        task_outs.append(
            PlanTaskOut(
                id=t.id,
                order_id=order_id,
                order_item_id=t.order_item_id,
                dish=dish_name,
                task_type=t.task_type,
                burner_no=t.burner_no,
                cook_no=t.cook_no,
                start_at=t_start,
                end_at=t_end,
                status=t.status,
                locked=t.locked,
            )
        )

    max_version = max((t.plan_version for t in tasks), default=kitchen.plan_version)

    return PlanResponse(
        date=date_str,
        plan_version=max_version,
        tasks=task_outs,
        late_orders=sorted(list(late_order_ids)),
    )
