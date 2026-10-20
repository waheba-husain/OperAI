
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional


@dataclass(frozen=True)
class TaskRequest:
    """The durations and resource requirements for one order item."""
    order_item_id: str
    prep_minutes: int
    cook_minutes: int
    deadline: datetime


@dataclass(frozen=True)
class ScheduledTask:
    """One scheduled preparation or cooking task."""
    order_item_id: str
    task_type: str
    cook_no: int
    start_at: datetime
    end_at: datetime
    burner_no: Optional[int] = None


def schedule_order_item(
    request: TaskRequest,
    start_at: datetime,
    cook_count: int,
    burner_count: int,
) -> list[ScheduledTask]:
    """Schedule prep followed by cooking for a single order item."""
    if cook_count < 1 or burner_count < 1:
        raise ValueError("At least one cook and one burner are required.")

    if request.prep_minutes < 0 or request.cook_minutes < 0:
        raise ValueError("Task durations cannot be negative.")

    if request.prep_minutes == 0 or request.cook_minutes == 0:
        raise ValueError("Prep and cook durations must be positive.")

    prep_end = start_at + timedelta(minutes=request.prep_minutes)
    cook_end = prep_end + timedelta(minutes=request.cook_minutes)

    return [
        ScheduledTask(
            order_item_id=request.order_item_id,
            task_type="prep",
            cook_no=1,
            start_at=start_at,
            end_at=prep_end,
        ),
        ScheduledTask(
            order_item_id=request.order_item_id,
            task_type="cook",
            cook_no=1,
            burner_no=1,
            start_at=prep_end,
            end_at=cook_end,
        ),
    ]


def schedule_order_items(
    requests: list[TaskRequest],
    start_at: datetime,
    cook_count: int,
    burner_count: int,
) -> list[ScheduledTask]:
    """Schedule multiple order items without resource conflicts."""
    if cook_count < 1 or burner_count < 1:
        raise ValueError("At least one cook and one burner are required.")

    # Track when each cook and burner becomes available.
    cook_available = [start_at] * cook_count
    burner_available = [start_at] * burner_count

    scheduled_tasks = []

    # Process earlier deadlines first.
    ordered_requests = sorted(requests, key=lambda item: item.deadline)

    for request in ordered_requests:
        if request.prep_minutes <= 0 or request.cook_minutes <= 0:
            raise ValueError("Prep and cook durations must be positive.")

        # Find the cook who becomes available first.
        cook_no = min(
            range(cook_count),
            key=lambda i: cook_available[i],
        )

        prep_start = cook_available[cook_no]
        prep_end = prep_start + timedelta(minutes=request.prep_minutes)

        scheduled_tasks.append(
            ScheduledTask(
                order_item_id=request.order_item_id,
                task_type="prep",
                cook_no=cook_no + 1,
                start_at=prep_start,
                end_at=prep_end,
            )
        )

        # The same cook must finish prep before starting cooking.
        # Cooking also waits for a burner to become available.
        burner_no = min(
            range(burner_count),
            key=lambda i: max(prep_end, burner_available[i]),
        )

        cook_start = max(prep_end, burner_available[burner_no])
        cook_end = cook_start + timedelta(minutes=request.cook_minutes)

        scheduled_tasks.append(
            ScheduledTask(
                order_item_id=request.order_item_id,
                task_type="cook",
                cook_no=cook_no + 1,
                burner_no=burner_no + 1,
                start_at=cook_start,
                end_at=cook_end,
            )
        )

        cook_available[cook_no] = cook_end
        burner_available[burner_no] = cook_end

    return scheduled_tasks
