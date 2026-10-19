def test_menu_paneer_biryani_shape(client):
    r = client.get("/api/menu")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == len(body["data"])
    biryani = next(row for row in body["data"] if row["name"] == "Paneer Biryani")
    assert biryani["price"] == 180.0
    assert biryani["cost_breakdown"] == {
        "ingredients": 72.2,
        "packaging": 14.0,
        "commission": 36.0,
        "overhead": 21.6,
        "total": 143.8,
    }
    assert biryani["profit_per_order"] == 36.2
    assert biryani["margin_pct"] == 20.1
    assert biryani["margin_status"] == "below_target"
    assert biryani["is_active"] is True
    assert biryani["data_source"] == "simulated"
