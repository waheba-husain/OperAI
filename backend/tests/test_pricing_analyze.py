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


def test_propose_change_is_ignored(client):
    r = client.post(
        "/api/pricing/analyze",
        json={"menu_item_id": _biryani_id(client), "propose_change": True},
    )
    assert r.status_code == 200
    assert r.json()["action"] is None


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