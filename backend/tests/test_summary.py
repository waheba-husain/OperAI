from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import AuditLog, Kitchen, Order, ProposedAction
from app.timeutil import IST


def _add_order(db, kitchen, day: date, *, status: str, deadline: datetime | None = None):
    order = Order(
        id=uuid4(),
        kitchen_id=kitchen.id,
        customer_name="Summary customer",
        customer_phone=None,
        channel="direct",
        deadline=deadline or datetime.combine(day, time(12), tzinfo=IST),
        status=status,
        total_amount=Decimal("100.00"),
        data_source="simulated",
        created_at=datetime.combine(day, time(9), tzinfo=IST),
    )
    db.add(order)
    db.flush()
    return order


def _add_action(
    db,
    kitchen,
    *,
    action_type="recovery",
    status="executed",
    event_type="action_executed",
    event_at: datetime,
    impact=None,
    undo_of_audit_id=None,
):
    action = ProposedAction(
        id=uuid4(),
        kitchen_id=kitchen.id,
        group_id=uuid4(),
        option_number=1,
        action_type=action_type,
        title="Summary test action",
        payload={},
        impact=impact or {},
        status=status,
        base_plan_version=kitchen.plan_version,
        stock_fingerprint="test-fingerprint",
        undo_of_audit_id=undo_of_audit_id,
        created_at=event_at - timedelta(minutes=1),
        expires_at=event_at + timedelta(minutes=30),
        executed_at=event_at if status == "executed" else None,
    )
    db.add(action)
    db.flush()
    audit = AuditLog(
        id=uuid4(),
        kitchen_id=kitchen.id,
        action_id=action.id,
        event_type=event_type,
        actor="owner",
        summary="Summary test audit event",
        before_snapshot=None,
        after_snapshot=None,
        plan_version_before=kitchen.plan_version,
        plan_version_after=kitchen.plan_version,
        created_at=event_at,
    )
    db.add(audit)
    db.flush()
    return action, audit


def _impact(
    *,
    orders_protected=3,
    late_orders=1,
    baseline_revenue=1180.0,
    remainder=300.0,
    extra_cost=-147.2,
):
    return {
        "late_orders": late_orders,
        "orders_protected": orders_protected,
        "revenue_at_risk_without_action": float(baseline_revenue),
        "revenue_at_risk_after": float(remainder),
        "extra_cost": float(extra_cost),
    }


def test_summary_empty_day_returns_zero_counts_and_amounts(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    _add_order(db_session, kitchen, date(2026, 10, 20), status="completed")
    response = client.get("/api/summary?date=2026-10-20")

    assert response.status_code == 200
    assert response.json() == {
        "date": "2026-10-20",
        "orders_total": 0,
        "orders_completed": 0,
        "actions_executed": 0,
        "actions_undone": 0,
        "orders_protected": 0,
        "revenue_protected": 0.0,
        "net_extra_cost": 0.0,
        "data_source": "simulated",
    }


def test_summary_applies_baseline_minus_option_formulas_and_order_conventions(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    day = date(2026, 10, 20)
    _add_order(db_session, kitchen, day, status="planned")
    _add_order(db_session, kitchen, day, status="completed")
    _add_order(db_session, kitchen, day, status="cancelled")
    _add_action(
        db_session,
        kitchen,
        event_at=datetime(2026, 10, 20, 12, tzinfo=IST),
        impact=_impact(),
    )

    response = client.get("/api/summary?date=2026-10-20")
    audit_history = client.get("/api/audit?event_type=action_executed")

    assert response.status_code == 200
    assert audit_history.status_code == 200
    assert response.json()["actions_executed"] == audit_history.json()["count"]
    assert response.json() == {
        "date": "2026-10-20",
        "orders_total": 2,
        "orders_completed": 1,
        "actions_executed": 1,
        "actions_undone": 0,
        "orders_protected": 3,  # (1 late + 3 protected) baseline - 1 option late
        "revenue_protected": 880.0,  # baseline at risk - option remainder
        "net_extra_cost": -147.2,
        "data_source": "simulated",
    }


def test_summary_aggregates_multiple_executed_recovery_actions(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    day = date(2026, 10, 20)
    for impact in (
        _impact(),
        _impact(orders_protected=1, late_orders=2, baseline_revenue=500, remainder=350, extra_cost=10),
    ):
        _add_action(
            db_session,
            kitchen,
            event_at=datetime(2026, 10, 20, 12, tzinfo=IST),
            impact=impact,
        )

    response = client.get("/api/summary?date=2026-10-20")

    assert response.status_code == 200
    assert response.json()["actions_executed"] == 2
    assert response.json()["orders_protected"] == 4
    assert response.json()["revenue_protected"] == 1030.0
    assert response.json()["net_extra_cost"] == -137.2


def test_summary_undo_is_counted_on_undo_date_and_retroactively_excludes_totals(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    execution_day = date(2026, 10, 20)
    undo_day = date(2026, 10, 21)
    _add_order(db_session, kitchen, execution_day, status="completed")
    source_action, source_audit = _add_action(
        db_session,
        kitchen,
        event_at=datetime(2026, 10, 20, 12, tzinfo=IST),
        impact=_impact(),
    )
    pending_undo = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=uuid4(), option_number=1,
        action_type="undo", title="Pending undo", payload={}, impact={}, status="pending",
        base_plan_version=kitchen.plan_version, stock_fingerprint="pending-undo",
        undo_of_audit_id=source_audit.id,
        created_at=datetime(2026, 10, 20, 12, tzinfo=IST),
        expires_at=datetime(2026, 10, 20, 12, 30, tzinfo=IST),
    )
    db_session.add(pending_undo)
    db_session.flush()
    before_undo = client.get("/api/summary?date=2026-10-20").json()
    assert before_undo["orders_protected"] == 3
    _add_action(
        db_session,
        kitchen,
        action_type="undo",
        event_type="undo_executed",
        event_at=datetime(2026, 10, 21, 12, tzinfo=IST),
        undo_of_audit_id=source_audit.id,
    )

    execution_response = client.get("/api/summary?date=2026-10-20")
    undo_response = client.get("/api/summary?date=2026-10-21")

    assert execution_response.status_code == 200
    assert execution_response.json()["actions_executed"] == 1
    assert execution_response.json()["actions_undone"] == 0
    assert execution_response.json()["orders_total"] == 1
    assert execution_response.json()["orders_completed"] == 1
    assert execution_response.json()["orders_protected"] == 0
    assert execution_response.json()["revenue_protected"] == 0.0
    assert execution_response.json()["net_extra_cost"] == -147.2
    assert undo_response.status_code == 200
    assert undo_response.json()["actions_executed"] == 0
    assert undo_response.json()["actions_undone"] == 1
    assert undo_response.json()["orders_protected"] == 0
    assert db_session.get(ProposedAction, source_action.id).status == "executed"


def test_summary_excludes_nonexecuted_and_nonrecovery_actions(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    day = date(2026, 10, 20)
    event_at = datetime(2026, 10, 20, 12, tzinfo=IST)
    _add_action(
        db_session,
        kitchen,
        status="rejected",
        event_type="action_rejected",
        event_at=event_at,
        impact=_impact(),
    )
    _, order_intake_audit = _add_action(
        db_session,
        kitchen,
        action_type="order_intake",
        event_at=event_at,
        impact=_impact(),
    )
    _add_action(
        db_session,
        kitchen,
        action_type="undo",
        event_type="undo_executed",
        event_at=event_at,
        undo_of_audit_id=order_intake_audit.id,
    )
    pending = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=uuid4(), option_number=1,
        action_type="recovery", title="Pending", payload={}, impact=_impact(), status="pending",
        base_plan_version=kitchen.plan_version, stock_fingerprint="pending",
        created_at=event_at, expires_at=event_at + timedelta(minutes=30),
    )
    expired = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=uuid4(), option_number=1,
        action_type="recovery", title="Expired", payload={}, impact=_impact(), status="expired",
        base_plan_version=kitchen.plan_version, stock_fingerprint="expired",
        created_at=event_at, expires_at=event_at + timedelta(minutes=30),
    )
    failed = ProposedAction(
        id=uuid4(), kitchen_id=kitchen.id, group_id=uuid4(), option_number=1,
        action_type="recovery", title="Failed", payload={}, impact=_impact(), status="failed",
        base_plan_version=kitchen.plan_version, stock_fingerprint="failed",
        created_at=event_at, expires_at=event_at + timedelta(minutes=30),
    )
    db_session.add_all([pending, expired, failed])
    db_session.flush()

    response = client.get("/api/summary?date=2026-10-20")

    assert response.status_code == 200
    assert response.json()["actions_executed"] == 0
    assert response.json()["actions_undone"] == 1
    assert response.json()["orders_total"] == 0
    assert response.json()["revenue_protected"] == 0.0


def test_summary_uses_ist_audit_event_day_boundaries(client, db_session):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    _add_order(
        db_session,
        kitchen,
        date(2026, 10, 20),
        status="planned",
        deadline=datetime(2026, 10, 20, 0, 0, tzinfo=IST),
    )
    _add_order(
        db_session,
        kitchen,
        date(2026, 10, 20),
        status="completed",
        deadline=datetime(2026, 10, 20, 23, 59, tzinfo=IST),
    )
    _add_order(
        db_session,
        kitchen,
        date(2026, 10, 21),
        status="cancelled",
        deadline=datetime(2026, 10, 21, 0, 0, tzinfo=IST),
    )
    _add_action(
        db_session,
        kitchen,
        event_at=datetime(2026, 10, 20, 18, 29, tzinfo=timezone.utc).astimezone(IST),
        impact=_impact(),
    )
    _add_action(
        db_session,
        kitchen,
        event_at=datetime(2026, 10, 20, 18, 30, tzinfo=timezone.utc).astimezone(IST),
        impact=_impact(),
    )

    before_midnight = client.get("/api/summary?date=2026-10-20").json()
    after_midnight = client.get("/api/summary?date=2026-10-21").json()

    assert before_midnight["actions_executed"] == 1
    assert before_midnight["orders_total"] == 2
    assert before_midnight["orders_completed"] == 1
    assert after_midnight["actions_executed"] == 1
    assert after_midnight["orders_total"] == 0
    assert after_midnight["orders_completed"] == 0


@pytest.mark.parametrize(
    "impact",
    [
        {},
        {**_impact(), "revenue_at_risk_without_action": "not-numeric"},
    ],
)
def test_summary_rejects_missing_or_malformed_impact(client, db_session, impact):
    kitchen = db_session.scalar(select(Kitchen).limit(1))
    event_at = datetime(2026, 10, 20, 12, tzinfo=IST)
    _add_action(db_session, kitchen, event_at=event_at, impact=impact)

    response = client.get("/api/summary?date=2026-10-20")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"


def test_summary_invalid_date_and_api_key(client):
    invalid_date = client.get("/api/summary?date=not-a-date")
    unauthorized = client.get("/api/summary?date=2026-10-20", headers={"X-API-Key": "invalid"})

    assert invalid_date.status_code == 422
    assert invalid_date.json()["error"]["code"] == "VALIDATION_ERROR"
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "UNAUTHORIZED"


def test_summary_missing_date_defaults_to_today_in_ist(client, monkeypatch):
    from app.services import audit as audit_service

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 22, 18, 45, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(audit_service, "datetime", FrozenDateTime)

    response = client.get("/api/summary")

    assert response.status_code == 200
    assert response.json()["date"] == "2026-10-23"
    assert response.json()["actions_executed"] == 0
