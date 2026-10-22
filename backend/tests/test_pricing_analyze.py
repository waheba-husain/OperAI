from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select

from app.config import settings
from app.models import Ingredient, MenuItem, ProposedAction
from app.services.recovery import _fingerprint


def _biryani_id(client):
    items = client.get("/api/menu").json()["data"]
    return next(i["id"] for i in items if i["name"] == "Paneer Biryani")


def test_analyze_at_150(client):
    r = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": _biryani_id(client), "price": 150},
    )
    assert r.status_code == 200
    d = r.json()
    assert float(d["cost_breakdown"]["total"]) == 134.20
    assert float(d["profit_per_order"]) == 15.80
    assert float(d["margin_pct"]) == 10.5
    assert d["margin_status"] == "below_target"
    assert float(d["suggested_price"]) == 205.00
    assert float(d["suggested_margin_pct"]) == 26.0
    assert d["action"] is None


def test_defaults_to_current_price(client):
    r = client.post("/api/pricing/analyze", json={"menu_item_id": _biryani_id(client)})
    d = r.json()
    assert float(d["analyzed_price"]) == 180.00
    assert float(d["profit_per_order"]) == 36.20
    assert float(d["margin_pct"]) == 20.1


def test_matches_menu_endpoint(client):
    menu = client.get("/api/menu").json()["data"]
    biryani = next(i for i in menu if i["name"] == "Paneer Biryani")
    r = client.post("/api/pricing/analyze", json={"menu_item_id": biryani["id"]})
    assert float(r.json()["profit_per_order"]) == float(biryani["profit_per_order"])
    assert float(r.json()["margin_pct"]) == float(biryani["margin_pct"])


def test_propose_change_false_creates_no_action(client, db_session):
    before = db_session.scalar(select(func.count(ProposedAction.id)))
    r = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": _biryani_id(client), "propose_change": False},
    )
    assert r.status_code == 200
    assert r.json()["action"] is None
    after = db_session.scalar(select(func.count(ProposedAction.id)))
    assert after == before


def test_propose_change_creates_pending_price_action(client, db_session):
    menu_item_id = UUID(_biryani_id(client))
    menu = db_session.get(MenuItem, menu_item_id)
    old_price = menu.price
    ingredients = db_session.scalars(select(Ingredient)).all()
    now = datetime.now(timezone.utc)
    response = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": str(menu_item_id), "price": 150, "propose_change": True},
    )
    assert response.status_code == 201
    body = response.json()
    action_out = body["action"]
    assert action_out["action_type"] == "price_change"
    assert action_out["status"] == "pending"
    assert action_out["option_number"] == 1
    assert action_out["title"] == "Set Paneer Biryani price to ₹205.00"
    action = db_session.get(ProposedAction, UUID(action_out["id"]))
    assert action is not None
    assert action.payload == {
        "menu_item_id": str(menu_item_id),
        "old_price": str(old_price),
        "new_price": "205.00",
    }
    assert action.impact == {
        "profit_per_order_before": 36.2,
        "profit_per_order_after": 53.2,
    }
    assert action.base_plan_version == 1
    assert action.stock_fingerprint == _fingerprint(ingredients)
    expires_at = datetime.fromisoformat(action_out["expires_at"])
    assert expires_at == action.expires_at.replace(tzinfo=timezone.utc)
    assert 0 < (expires_at - now).total_seconds() <= settings.recovery_action_ttl_minutes * 60 + 1
    db_session.refresh(menu)
    assert menu.price == old_price


def test_unknown_menu_item(client):
    r = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MENU_ITEM_NOT_FOUND"


def test_price_must_be_positive(client):
    r = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": _biryani_id(client), "price": 0},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_requires_api_key(client):
    r = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": "00000000-0000-0000-0000-000000000000"},
        headers={"X-API-Key": "wrong"},
    )
    assert r.status_code == 401
