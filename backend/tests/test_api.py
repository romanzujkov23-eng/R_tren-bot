import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.database import create_tables
from app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")


def make_init_data(user: dict, token: str = None, auth_date: int = None) -> str:
    token = token or settings.BOT_TOKEN
    fields = {"auth_date": str(auth_date or int(time.time())), "query_id": "AAH", "user": json.dumps(user)}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture(scope="session")
async def client():
    await create_tables()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def login(client, tg_id=42, name="Иван"):
    init = make_init_data({"id": tg_id, "first_name": name, "username": "ivan"})
    r = await client.post("/api/auth/telegram", json={"init_data": init})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()


async def test_health(client):
    assert (await client.get("/health")).json() == {"status": "ok"}


async def test_rejects_forged_and_expired_init_data(client):
    bad = make_init_data({"id": 1, "first_name": "X"}, token="999:OTHER")
    assert (await client.post("/api/auth/telegram", json={"init_data": bad})).status_code == 401
    old = make_init_data({"id": 1, "first_name": "X"}, auth_date=int(time.time()) - 10 * 86400)
    assert (await client.post("/api/auth/telegram", json={"init_data": old})).status_code == 401
    assert (await client.post("/api/auth/telegram", json={"init_data": ""})).status_code == 401


async def test_requires_token(client):
    assert (await client.get("/api/users/me")).status_code == 401
    r = await client.get("/api/users/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


async def test_full_flow(client):
    h, data = await login(client)
    assert data["is_new"] is True
    assert data["user"]["first_name"] == "Иван"
    assert (await login(client))[1]["is_new"] is False

    ex = (await client.get("/api/exercises", headers=h)).json()
    assert len(ex) >= 15
    bench = next(e for e in ex if "лёжа" in e["name"])
    squat = next(e for e in ex if "Приседания" in e["name"])

    r = await client.post("/api/exercises", json={"name": "Моё", "muscle_group": "arms"}, headers=h)
    assert r.status_code == 201
    assert (await client.post("/api/exercises", json={"name": "x", "muscle_group": "bad"}, headers=h)).status_code == 422

    r = await client.post(
        "/api/workouts",
        json={
            "name": "Грудь+ноги",
            "items": [
                {"exercise_id": bench["id"], "target_sets": 3, "target_reps": 8, "target_weight": 60},
                {"exercise_id": squat["id"], "target_sets": 4, "target_reps": 5},
            ],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    workout = r.json()
    assert [i["exercise"]["name"] for i in workout["items"]] == [bench["name"], squat["name"]]

    r = await client.post("/api/workouts", json={"name": "bad", "items": [{"exercise_id": 99999}]}, headers=h)
    assert r.status_code == 400

    r = await client.put(
        f"/api/workouts/{workout['id']}",
        json={"name": "Грудь+ноги 2", "items": [{"exercise_id": bench["id"], "target_sets": 5, "target_reps": 5}]},
        headers=h,
    )
    assert r.status_code == 200 and len(r.json()["items"]) == 1 and r.json()["name"] == "Грудь+ноги 2"

    r = await client.post("/api/sessions", json={"workout_id": workout["id"]}, headers=h)
    assert r.status_code == 201
    s1 = r.json()
    assert s1["name"] == "Грудь+ноги 2" and len(s1["plan"]) == 1
    assert (await client.post("/api/sessions", json={}, headers=h)).json()["id"] == s1["id"]

    r = await client.post(f"/api/sessions/{s1['id']}/sets", json={"exercise_id": bench["id"], "reps": 10, "weight": 60}, headers=h)
    assert r.status_code == 201
    assert r.json()["sets"][0]["est_1rm"] == 80.0 and r.json()["sets"][0]["is_pr"] is False
    r = await client.post(f"/api/sessions/{s1['id']}/sets", json={"exercise_id": bench["id"], "reps": 8, "weight": 60}, headers=h)
    assert r.json()["total_sets"] == 2 and r.json()["sets"][-1]["set_number"] == 2
    r = await client.delete(f"/api/sessions/{s1['id']}/sets/{r.json()['sets'][-1]['id']}", headers=h)
    assert r.json()["total_sets"] == 1 and r.json()["total_volume"] == 600

    r = await client.post(f"/api/sessions/{s1['id']}/finish", json={"feeling": 4, "note": "ок"}, headers=h)
    assert r.json()["status"] == "completed" and r.json()["feeling"] == 4
    r = await client.post(f"/api/sessions/{s1['id']}/sets", json={"exercise_id": bench["id"], "reps": 1, "weight": 1}, headers=h)
    assert r.status_code == 400

    s2 = (await client.post("/api/sessions", json={"name": "Вторая"}, headers=h)).json()
    r = await client.post(f"/api/sessions/{s2['id']}/sets", json={"exercise_id": bench["id"], "reps": 10, "weight": 70}, headers=h)
    assert r.json()["sets"][0]["is_pr"] is True
    await client.post(f"/api/sessions/{s2['id']}/finish", json={}, headers=h)

    dash = (await client.get("/api/statistics/dashboard", headers=h)).json()
    assert dash["summary"]["total_workouts"] == 2 and dash["active"] is None
    recs = (await client.get("/api/statistics/records", headers=h)).json()
    assert recs[0]["best_weight"] == 70
    ov = (await client.get("/api/statistics/overview?weeks=4", headers=h)).json()
    assert ov["weeks"] == 4 and len(ov["weekly"]) == 4 and ov["kpi"]["workouts"]["value"] == 2
    assert ov["kpi"]["sets"]["value"] == 2 and ov["kpi"]["volume"]["value"] == 1300
    assert ov["weekly"][-1]["workouts"] == 2 and ov["muscles"][0]["name"] == "Грудные"
    bench_row = next(e for e in ov["exercises"] if e["name"] == "Жим штанги лёжа")
    assert bench_row["sessions"] == 2 and bench_row["best_weight"] == 70 and bench_row["delta_1rm"] > 0
    prog = (await client.get(f"/api/statistics/progress/{bench['id']}", headers=h)).json()
    assert len(prog["points"]) == 2
    hist = (await client.get("/api/sessions", headers=h)).json()
    assert len(hist) == 2

    assert data["user"]["app_mode"] == "ask"
    r = await client.put("/api/users/me", json={"app_mode": "simple"}, headers=h)
    assert r.json()["app_mode"] == "simple"
    assert (await client.put("/api/users/me", json={"app_mode": "weird"}, headers=h)).status_code == 422
    assert "weight_unit" not in r.json()


async def test_data_isolated_between_users(client):
    ha, _ = await login(client, tg_id=100, name="A")
    hb, _ = await login(client, tg_id=200, name="B")
    ex_a = (await client.get("/api/exercises", headers=ha)).json()[0]
    w = (await client.post("/api/workouts", json={"name": "A", "items": []}, headers=ha)).json()
    assert (await client.get(f"/api/workouts/{w['id']}", headers=hb)).status_code == 404
    assert (await client.delete(f"/api/workouts/{w['id']}", headers=hb)).status_code == 404
    r = await client.post("/api/workouts", json={"name": "B", "items": [{"exercise_id": ex_a["id"]}]}, headers=hb)
    assert r.status_code == 400
    s = (await client.post("/api/sessions", json={}, headers=ha)).json()
    assert (await client.get(f"/api/sessions/{s['id']}", headers=hb)).status_code == 404


async def test_dev_login_and_delete_account(client):
    r = await client.post("/api/auth/dev")
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert (await client.delete("/api/users/me", headers=h)).status_code == 204
    assert (await client.get("/api/users/me", headers=h)).status_code == 401


async def test_webhook_secret(client):
    assert (await client.post("/telegram/webhook", json={})).status_code == 403


async def test_export(client):
    h, _ = await login(client, tg_id=300, name="Экс")
    r = await client.get("/api/users/me/export", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert d["user"]["telegram_id"] == 300 and len(d["exercises"]) >= 15
    assert (await client.get("/api/users/me/export")).status_code == 401
