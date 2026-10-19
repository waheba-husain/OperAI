def test_list_ingredients(client):
    r = client.get("/api/ingredients")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == len(body["data"])
    assert body["count"] >= 1
    names = {row["name"] for row in body["data"]}
    assert "Paneer" in names
    paneer = next(row for row in body["data"] if row["name"] == "Paneer")
    assert paneer["unit"] == "kg"
    assert paneer["stock_qty"] == 1.0
    assert paneer["cost_per_unit"] == 380.0
    assert paneer["allergen_tags"] == ["dairy"]
    assert paneer["diet_tags"] == ["veg"]
    assert paneer["data_source"] == "simulated"
    assert "id" in paneer
