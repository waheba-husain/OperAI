
from datetime import datetime, timedelta

import pytest

from app.services.scheduler import TaskRequest, schedule_order_item


def test_prep_finishes_before_cooking_starts():
    start = datetime(2026, 10, 19, 9, 0)

    request = TaskRequest(
        order_item_id="item-1",
        prep_minutes=15,
        cook_minutes=25,
        deadline=datetime(2026, 10, 19, 10, 0),
    )

    tasks = schedule_order_item(
        request=request,
        start_at=start,
        cook_count=2,
        burner_count=3,
    )

    assert len(tasks) == 2

    prep, cook = tasks

    assert prep.task_type == "prep"
    assert prep.start_at == start
    assert prep.end_at == start + timedelta(minutes=15)

    assert cook.task_type == "cook"
    assert cook.start_at == prep.end_at
    assert cook.end_at == start + timedelta(minutes=40)


def test_invalid_resource_counts_are_rejected():
    request = TaskRequest(
        order_item_id="item-1",
        prep_minutes=15,
        cook_minutes=25,
        deadline=datetime(2026, 10, 19, 10, 0),
    )

    with pytest.raises(ValueError):
        schedule_order_item(request, datetime(2026, 10, 19, 9, 0), 0, 3)


def test_zero_task_duration_is_rejected():
    request = TaskRequest(
        order_item_id="item-1",
        prep_minutes=0,
        cook_minutes=25,
        deadline=datetime(2026, 10, 19, 10, 0),
    )

    with pytest.raises(ValueError):
        schedule_order_item(request, datetime(2026, 10, 19, 9, 0), 2, 3)

def test_multiple_order_items_use_available_resources():
    from app.services.scheduler import schedule_order_items

    start = datetime(2026, 10, 19, 9, 0)

    requests = [
        TaskRequest(
            order_item_id="item-1",
            prep_minutes=10,
            cook_minutes=20,
            deadline=datetime(2026, 10, 19, 10, 0),
        ),
        TaskRequest(
            order_item_id="item-2",
            prep_minutes=10,
            cook_minutes=15,
            deadline=datetime(2026, 10, 19, 10, 30),
        ),
    ]

    tasks = schedule_order_items(
        requests=requests,
        start_at=start,
        cook_count=2,
        burner_count=2,
    )

    assert len(tasks) == 4

    # Each order item must have prep and cook tasks.
    for item_id in ("item-1", "item-2"):
        item_tasks = [
            task for task in tasks
            if task.order_item_id == item_id
        ]
        assert [task.task_type for task in item_tasks] == [
            "prep", "cook"
        ]
        assert item_tasks[0].end_at <= item_tasks[1].start_at

    # Tasks assigned to the same cook must not overlap.
    prep_tasks = [task for task in tasks if task.task_type == "prep"]
    for i, first in enumerate(prep_tasks):
        for second in prep_tasks[i + 1:]:
            if first.cook_no == second.cook_no:
                assert (
                    first.end_at <= second.start_at
                    or second.end_at <= first.start_at
                )

    # Cooking tasks assigned to the same burner must not overlap.
    cook_tasks = [task for task in tasks if task.task_type == "cook"]
    for i, first in enumerate(cook_tasks):
        for second in cook_tasks[i + 1:]:
            if first.burner_no == second.burner_no:
                assert (
                    first.end_at <= second.start_at
                    or second.end_at <= first.start_at
                )


