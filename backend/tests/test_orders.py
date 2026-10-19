from app.models import Order
from app.services.kitchen import get_kitchen


def test_orders_filter_by_date(client):
    r = client.get("/api/orders", params={"date": "2026-10-17"})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 25
    assert body["count"] == len(body["data"])
    first = body["data"][0]
    assert first["customer_name"] == "Customer A"
    assert first["status"] == "new"
    assert first["total_amount"] == 360.0
    assert first["items"][0]["name"] == "Paneer Biryani"
    assert first["items"][0]["quantity"] == 2
    assert first["items"][0]["unit_price"] == 180.0
    assert first["deadline"].endswith("+05:30")

    empty = client.get("/api/orders", params={"date": "2026-10-18"})
    assert empty.status_code == 200
    assert empty.json() == {"data": [], "count": 0}


def test_orders_filter_by_status(client, db_session):
    new_orders = client.get("/api/orders", params={"status": "new", "date": "2026-10-17"})
    assert new_orders.status_code == 200
    assert new_orders.json()["count"] == 25

    planned = client.get("/api/orders", params={"status": "planned"})
    assert planned.status_code == 200
    assert planned.json() == {"data": [], "count": 0}

    kitchen = get_kitchen(db_session)
    order = db_session.query(Order).filter(Order.kitchen_id == kitchen.id).first()
    order.status = "planned"
    db_session.flush()

    planned_after = client.get("/api/orders", params={"status": "planned"})
    assert planned_after.status_code == 200
    assert planned_after.json()["count"] == 1
    assert planned_after.json()["data"][0]["status"] == "planned"


def test_orders_limit_and_validation(client):
    r = client.get("/api/orders", params={"limit": 3, "date": "2026-10-17"})
    assert r.status_code == 200
    assert r.json()["count"] == 3

    bad_limit = client.get("/api/orders", params={"limit": 201})
    assert bad_limit.status_code == 422
    assert bad_limit.json()["error"]["code"] == "VALIDATION_ERROR"

    bad_status = client.get("/api/orders", params={"status": "bogus"})
    assert bad_status.status_code == 422
    assert bad_status.json()["error"]["code"] == "VALIDATION_ERROR"

    bad_date = client.get("/api/orders", params={"date": "17-10-2026"})
    assert bad_date.status_code == 422
    assert bad_date.json()["error"]["code"] == "VALIDATION_ERROR"
