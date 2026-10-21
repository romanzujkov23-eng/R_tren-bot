import pytest

from app.catalog import CATALOG_BY_NAME, CATALOG_WORKOUTS_BY_ID, QUICK_WORKOUTS, measure_for, norm
from app.services import suggest_next
from tests.test_api import client, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _exercise(client, h, name):
    exercises = (await client.get("/api/exercises", headers=h)).json()
    found = next((e for e in exercises if e["name"] == name), None)
    if found:
        return found
    r = await client.post("/api/exercises", json={"name": name, "muscle_group": "other"}, headers=h)
    assert r.status_code == 201
    return r.json()


async def test_measure_derived_from_name():
    assert measure_for("Планка (секунды)") == "seconds"
    assert measure_for("Бег (минуты)") == "minutes"
    assert measure_for("Жим штанги лёжа") == "reps"


async def test_quick_workouts_reference_catalog():
    ids = [w["id"] for w in QUICK_WORKOUTS]
    assert len(ids) == len(set(ids))
    for spec in CATALOG_WORKOUTS_BY_ID.values():
        assert len(spec["id"]) <= 20
        for name, sets, reps in spec["items"]:
            assert norm(name) in CATALOG_BY_NAME and sets >= 1 and reps >= 1


async def test_exercise_measure_in_api(client):
    h, _ = await login(client, tg_id=701, name="Время")
    exercises = (await client.get("/api/exercises", headers=h)).json()
    by_name = {e["name"]: e for e in exercises}
    assert by_name["Планка (секунды)"]["measure"] == "seconds"
    assert by_name["Бег (минуты)"]["measure"] == "minutes"
    assert by_name["Подтягивания"]["measure"] == "reps"

    r = await client.post(
        "/api/exercises", json={"name": "Бой с тенью", "muscle_group": "cardio", "measure": "minutes"}, headers=h
    )
    assert r.json()["measure"] == "minutes"
    r = await client.post("/api/exercises", json={"name": "Что-то (секунды)", "muscle_group": "core"}, headers=h)
    assert r.json()["measure"] == "seconds"
    bad = await client.post("/api/exercises", json={"name": "Ещё", "measure": "km"}, headers=h)
    assert bad.status_code == 422


async def test_timed_sets_do_not_count_as_volume_or_reps(client):
    h, _ = await login(client, tg_id=702, name="Планка")
    plank = await _exercise(client, h, "Планка (секунды)")
    run = await _exercise(client, h, "Бег (минуты)")
    pull = await _exercise(client, h, "Подтягивания")

    sid = (await client.post("/api/sessions", json={}, headers=h)).json()["id"]
    await client.post(f"/api/sessions/{sid}/sets", json={"exercise_id": pull["id"], "reps": 8, "weight": 10}, headers=h)
    await client.post(f"/api/sessions/{sid}/sets", json={"exercise_id": plank["id"], "reps": 45}, headers=h)
    r = await client.post(
        f"/api/sessions/{sid}/sets", json={"exercise_id": run["id"], "reps": 30, "distance": 5.2}, headers=h
    )
    body = r.json()
    assert body["total_sets"] == 3
    assert body["total_reps"] == 8
    assert body["total_volume"] == 80
    timed = {s["exercise"]["name"]: s for s in body["sets"]}
    assert timed["Планка (секунды)"]["volume"] == 0 and timed["Планка (секунды)"]["est_1rm"] == 0
    assert timed["Бег (минуты)"]["distance"] == 5.2
    assert (await client.post(f"/api/sessions/{sid}/finish", json={}, headers=h)).status_code == 200


async def test_timed_personal_record_is_longer_time(client):
    h, _ = await login(client, tg_id=703, name="Рекорд")
    plank = await _exercise(client, h, "Планка (секунды)")

    async def session_with(seconds):
        sid = (await client.post("/api/sessions", json={}, headers=h)).json()["id"]
        r = await client.post(
            f"/api/sessions/{sid}/sets", json={"exercise_id": plank["id"], "reps": seconds}, headers=h
        )
        await client.post(f"/api/sessions/{sid}/finish", json={}, headers=h)
        return r.json()["sets"][-1]["is_pr"]

    assert await session_with(30) is False
    assert await session_with(40) is True
    assert await session_with(35) is False

    records = (await client.get("/api/statistics/records", headers=h)).json()
    row = next(r for r in records if r["name"] == "Планка (секунды)")
    assert row["measure"] == "seconds" and row["best_reps"] == 40


async def test_suggest_timed():
    r = suggest_next([(0, 30), (0, 30)], None, "seconds")
    assert r["reps"] == 35 and r["weight"] == 0
    r = suggest_next([(0, 28)], 30, "seconds")
    assert r["reps"] == 30
    r = suggest_next([(0, 40)], 30, "seconds")
    assert r["reps"] == 30 and r["reason"] == "по плану"
    r = suggest_next([(0, 30)], None, "minutes")
    assert r["reps"] == 31


async def test_suggestion_endpoint_for_timed_exercise(client):
    h, _ = await login(client, tg_id=704, name="Подсказка")
    run = await _exercise(client, h, "Бег (минуты)")
    sid = (await client.post("/api/sessions", json={}, headers=h)).json()["id"]
    await client.post(
        f"/api/sessions/{sid}/sets", json={"exercise_id": run["id"], "reps": 25, "distance": 4}, headers=h
    )
    await client.post(f"/api/sessions/{sid}/finish", json={}, headers=h)
    data = (await client.get(f"/api/exercises/{run['id']}/suggestion", headers=h)).json()
    assert data["last"]["sets"][0]["distance"] == 4
    assert data["suggested"]["reps"] == 26


async def test_set_is_idempotent_by_client_id(client):
    h, _ = await login(client, tg_id=705, name="Связь")
    pull = await _exercise(client, h, "Подтягивания")
    sid = (await client.post("/api/sessions", json={}, headers=h)).json()["id"]
    payload = {"exercise_id": pull["id"], "reps": 8, "weight": 0, "client_id": "abcd-1234-efgh"}
    first = await client.post(f"/api/sessions/{sid}/sets", json=payload, headers=h)
    second = await client.post(f"/api/sessions/{sid}/sets", json=payload, headers=h)
    assert first.status_code == 201 and second.status_code == 201
    assert second.json()["total_sets"] == 1
    assert second.json()["sets"][0]["client_id"] == "abcd-1234-efgh"

    other = {**payload, "client_id": "abcd-1234-zzzz"}
    third = await client.post(f"/api/sessions/{sid}/sets", json=other, headers=h)
    assert third.json()["total_sets"] == 2
    await client.post(f"/api/sessions/{sid}/finish", json={}, headers=h)
    again = await client.post(f"/api/sessions/{sid}/sets", json=payload, headers=h)
    assert again.status_code == 201 and again.json()["total_sets"] == 2
    fresh = await client.post(
        f"/api/sessions/{sid}/sets", json={**payload, "client_id": "new-client-id"}, headers=h
    )
    assert fresh.status_code == 400
    short = await client.post(f"/api/sessions/{sid}/sets", json={**payload, "client_id": "x"}, headers=h)
    assert short.status_code == 422


async def test_quick_workouts_listing(client):
    h, _ = await login(client, tg_id=706, name="Каталог")
    assert (await client.get("/api/quick-workouts")).status_code == 401
    data = (await client.get("/api/quick-workouts", headers=h)).json()
    assert data["groups"][0] == "Кардио"
    assert {i["group"] for i in data["items"]} <= set(data["groups"])
    run = next(i for i in data["items"] if i["id"] == "q:run")
    assert run["exercises"] == [{"name": "Бег (минуты)", "sets": 1, "reps": 30, "measure": "minutes"}]


async def test_quick_workout_does_not_touch_program(client):
    h, _ = await login(client, tg_id=707, name="Кардио")
    assert (await client.post("/api/programs/ppl/activate", headers=h)).status_code == 200
    before = (await client.get("/api/plan", headers=h)).json()
    assert before["program"]["id"] == "ppl" and before["own"] == []
    workouts_before = (await client.get("/api/workouts", headers=h)).json()

    s = await client.post("/api/sessions", json={"catalog_id": "q:mix"}, headers=h)
    assert s.status_code == 201
    body = s.json()
    assert body["name"] == "Кардио-микс"
    assert [p["exercise"]["name"] for p in body["plan"]] == [
        "Эллипс (минуты)", "Гребной тренажёр (минуты)", "Велотренажёр (минуты)",
    ]
    assert body["plan"][0]["exercise"]["measure"] == "minutes"
    eid = body["plan"][0]["exercise_id"]
    await client.post(f"/api/sessions/{body['id']}/sets", json={"exercise_id": eid, "reps": 15}, headers=h)
    assert (await client.post(f"/api/sessions/{body['id']}/finish", json={}, headers=h)).status_code == 200

    after = (await client.get("/api/plan", headers=h)).json()
    assert after["program"]["id"] == "ppl"
    assert after["program"]["next_workout_id"] == before["program"]["next_workout_id"]
    assert after["own"] == []
    assert (await client.get("/api/workouts", headers=h)).json() == workouts_before
    me = (await client.get("/api/users/me", headers=h)).json()
    assert me["active_program"] == "ppl"
    export = (await client.get("/api/users/me/export", headers=h)).json()
    assert all(not w["name"].startswith("Кардио-микс") for w in export["workouts"])
    assert any(s["name"] == "Кардио-микс" for s in export["sessions"])


async def test_quick_workout_reuses_hidden_template(client):
    h, _ = await login(client, tg_id=708, name="Повтор")
    for _ in range(2):
        sid = (await client.post("/api/sessions", json={"catalog_id": "q:core"}, headers=h)).json()["id"]
        await client.post(f"/api/sessions/{sid}/finish", json={}, headers=h)
    exercises = (await client.get("/api/exercises", headers=h)).json()
    assert len([e for e in exercises if e["name"] == "Планка (секунды)"]) == 1
    from sqlalchemy import func, select
    from app.database import AsyncSessionLocal
    from app.models import User, Workout

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.telegram_id == 708))).scalar_one()
        count = (
            await db.execute(select(func.count(Workout.id)).where(Workout.user_id == user.id, Workout.program_id == "q:core"))
        ).scalar_one()
    assert count == 1


async def test_program_day_from_catalog_and_unknown_id(client):
    h, _ = await login(client, tg_id=709, name="День")
    r = await client.post("/api/sessions", json={"catalog_id": "d:ppl:1"}, headers=h)
    assert r.status_code == 201 and r.json()["name"] == "Pull (тяги)"
    assert len(r.json()["plan"]) == 6
    await client.delete(f"/api/sessions/{r.json()['id']}", headers=h)
    assert (await client.post("/api/sessions", json={"catalog_id": "q:nope"}, headers=h)).status_code == 404
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["own"] == [] and plan["program"] is None


async def test_plan_exposes_measure(client):
    h, _ = await login(client, tg_id=710, name="План")
    await client.post("/api/programs/fullbody/activate", headers=h)
    plan = (await client.get("/api/plan", headers=h)).json()
    plank = next(e for d in plan["program"]["days"] for e in d["exercises"] if e["name"] == "Планка (секунды)")
    assert plank["measure"] == "seconds"
    progs = (await client.get("/api/programs", headers=h)).json()
    fb = next(p for p in progs if p["id"] == "fullbody")
    item = next(i for d in fb["days"] for i in d["items"] if i["name"] == "Планка (секунды)")
    assert item["measure"] == "seconds"
