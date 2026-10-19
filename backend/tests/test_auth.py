from fastapi.testclient import TestClient

from app.main import app

unauth = TestClient(app)

ENDPOINTS = ("/api/ingredients", "/api/menu", "/api/orders")


def test_health_does_not_need_key():
    r = unauth.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_read_endpoints_401_without_key():
    for path in ENDPOINTS:
        r = unauth.get(path)
        assert r.status_code == 401
        body = r.json()
        assert body["error"]["code"] == "UNAUTHORIZED"


def test_read_endpoints_401_wrong_key():
    for path in ENDPOINTS:
        r = unauth.get(path, headers={"X-API-Key": "not-the-key"})
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHORIZED"
