from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app import reminders
from app.streaks import compute_streak, week_start
from app.catalog import CATALOG, PROGRAMS
from app.database import AsyncSessionLocal, _add_missing_columns, engine
from app.models import User
from app.services import suggest_next
from tests.test_api import client, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_catalog_consistent():
    names = {c["name"] for c in CATALOG}
    assert len(names) == len(CATALOG)
    for p in PROGRAMS:
        for _, items in p["days"]:
            for n, sets, reps in items:
                assert n in names and sets >= 1 and reps >= 1
    assert all(c["how"] for c in CATALOG)


async def test_suggest_next_double_progression():
    r = suggest_next([(60, 12), (60, 12), (60, 12)], None)
    assert r["weight"] == 62.5 and r["reps"] == 8
    r = suggest_next([(60, 10), (60, 9)], None)
    assert r["weight"] == 60 and r["reps"] == 10
    r = suggest_next([(80, 8), (80, 8)], 8)
    assert r["weight"] == 82.5 and r["reps"] == 8
    r = suggest_next([(40, 12), (80, 8), (80, 7)], 8)
    assert r["weight"] == 80 and r["reps"] == 8
    assert suggest_next([(0, 15)], None)["reps"] == 16


async def test_streak():
    today = date(2026, 10, 7)
    w = week_start(today)
    weeks = lambda *offs: {w - timedelta(weeks=o): 3 for o in offs}
    assert compute_streak({**weeks(1, 2), w: 1}, 3, today) == (2, 2)
    assert compute_streak(weeks(0, 1, 2), 3, today) == (3, 3)
    assert compute_streak(weeks(2, 3, 4), 3, today) == (0, 3)
    assert compute_streak({}, 3, today) == (0, 0)


async def test_catalog_and_program_activation_flow(client):
    h, data = await login(client, tg_id=501, name="Кат")
    cat = (await client.get("/api/catalog", headers=h)).json()
    assert len(cat) == len(CATALOG)
    progs = (await client.get("/api/programs", headers=h)).json()
    assert {p["id"] for p in progs} >= {"fullbody", "ppl", "home"}
    assert (await client.get("/api/catalog")).status_code == 401

    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"] is None and plan["own"] == []
    assert (await client.get("/api/statistics/dashboard", headers=h)).json()["next_workout"] is None

    assert (await client.post("/api/programs/nope/activate", headers=h)).status_code == 404
    assert (await client.post("/api/programs/fullbody/activate", headers=h)).json() == {"created": 2, "kept": 0}
    me = (await client.get("/api/users/me", headers=h)).json()
    assert me["active_program"] == "fullbody"

    plan = (await client.get("/api/plan", headers=h)).json()
    prog = plan["program"]
    assert prog["id"] == "fullbody" and [d["name"] for d in prog["days"]] == ["Фулбади A", "Фулбади B"]
    assert prog["days"][0]["exercises"][0]["name"] == "Приседания со штангой"
    assert prog["next_workout_id"] == prog["days"][0]["workout_id"]
    nxt = (await client.get("/api/statistics/dashboard", headers=h)).json()["next_workout"]
    assert nxt["name"] == "Фулбади A" and nxt["exercises"] == 5 and "Фулбади" in nxt["program_name"]

    names = [e["name"] for e in (await client.get("/api/exercises", headers=h)).json()]
    assert names.count("Приседания со штангой") == 1

    async def do(workout_id):
        s = (await client.post("/api/sessions", json={"workout_id": workout_id}, headers=h)).json()
        ex = prog["days"][0]["exercises"][0]["exercise_id"]
        await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": ex, "reps": 5, "weight": 20}, headers=h)
        await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)

    await do(prog["days"][0]["workout_id"])
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"]["next_workout_id"] == prog["days"][1]["workout_id"]
    assert plan["program"]["days"][0]["last_done"] is not None and plan["program"]["days"][1]["last_done"] is None
    await do(prog["days"][1]["workout_id"])
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"]["next_workout_id"] == prog["days"][0]["workout_id"]

    own = (await client.post("/api/workouts", json={"name": "Моя", "items": []}, headers=h)).json()
    assert (await client.post("/api/programs/ppl/activate", headers=h)).json() == {"created": 3, "kept": 0}
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"]["id"] == "ppl" and len(plan["program"]["days"]) == 3
    assert [w["name"] for w in plan["own"]] == ["Моя"] and plan["own"][0]["workout_id"] == own["id"]
    all_names = [w["name"] for w in (await client.get("/api/workouts", headers=h)).json()]
    assert "Фулбади A" not in all_names
    hist = (await client.get("/api/sessions", headers=h)).json()
    assert len(hist) == 2 and {x["name"] for x in hist} == {"Фулбади A", "Фулбади B"}

    await client.post("/api/programs/ppl/activate", headers=h)
    assert len((await client.get("/api/plan", headers=h)).json()["program"]["days"]) == 3


async def test_backfill_links_old_program_workouts(client):
    from app import database

    h, data = await login(client, tg_id=511, name="Старый")
    w = (await client.post(
        "/api/workouts",
        json={"name": "Верх A", "description": "Верх / Низ, 4 дня", "items": []},
        headers=h,
    )).json()
    assert (await client.get("/api/plan", headers=h)).json()["program"] is None
    async with engine.begin() as conn:
        await database._backfill_programs(conn)
        await database._backfill_programs(conn)
    me = (await client.get("/api/users/me", headers=h)).json()
    assert me["active_program"] == "upper_lower"
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"]["id"] == "upper_lower" and plan["program"]["days"][0]["workout_id"] == w["id"]


async def test_suggestion_endpoint_and_streak_flow(client):
    h, _ = await login(client, tg_id=502, name="Прог")
    bench = next(e for e in (await client.get("/api/exercises", headers=h)).json() if e["name"] == "Жим штанги лёжа")

    r = (await client.get(f"/api/exercises/{bench['id']}/suggestion", headers=h)).json()
    assert r == {"last": None, "suggested": None}

    s = (await client.post("/api/sessions", json={}, headers=h)).json()
    for _ in range(3):
        await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": bench["id"], "reps": 12, "weight": 60}, headers=h)
    fin = (await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)).json()
    assert fin["status"] == "completed" and "new_achievements" not in fin

    r = (await client.get(f"/api/exercises/{bench['id']}/suggestion", headers=h)).json()
    assert len(r["last"]["sets"]) == 3
    assert r["suggested"]["weight"] == 62.5 and r["suggested"]["reps"] == 8

    s2 = (await client.post("/api/sessions", json={}, headers=h)).json()
    await client.post(f"/api/sessions/{s2['id']}/sets", json={"exercise_id": bench["id"], "reps": 8, "weight": 62.5}, headers=h)
    await client.post(f"/api/sessions/{s2['id']}/finish", json={}, headers=h)
    assert (await client.get("/api/achievements", headers=h)).status_code == 404

    dash = (await client.get("/api/statistics/dashboard", headers=h)).json()
    assert dash["streak"]["this_week"] == 1
    assert dash["summary"]["total_workouts"] == 2


async def test_body_measurements(client):
    h, _ = await login(client, tg_id=503, name="Тело")
    assert (await client.post("/api/body", json={}, headers=h)).status_code == 400
    assert (await client.post("/api/body", json={"weight": -5}, headers=h)).status_code == 422
    r = await client.post("/api/body", json={"weight": 80.5, "waist": 85}, headers=h)
    assert r.status_code == 201
    entry = r.json()
    assert entry["weight"] == 80.5 and "new_achievements" not in entry
    await client.post("/api/body", json={"weight": 80.1}, headers=h)
    lst = (await client.get("/api/body", headers=h)).json()
    assert len(lst) == 2 and lst[0]["weight"] == 80.1
    hb, _ = await login(client, tg_id=504, name="Чужой")
    assert (await client.delete(f"/api/body/{entry['id']}", headers=hb)).status_code == 404
    assert (await client.delete(f"/api/body/{entry['id']}", headers=h)).status_code == 204
    exp = (await client.get("/api/users/me/export", headers=h)).json()
    assert len(exp["body_measurements"]) == 1


async def test_settings_goal_timezone_reminders(client, monkeypatch):
    h, data = await login(client, tg_id=505, name="Напом")
    assert data["user"]["weekly_goal"] == 3 and data["user"]["reminder_enabled"] is False

    r = await client.put("/api/users/me", json={"weekly_goal": 4, "timezone": "Asia/Yekaterinburg"}, headers=h)
    assert r.json()["weekly_goal"] == 4 and r.json()["timezone"] == "Asia/Yekaterinburg"
    r = await client.put("/api/users/me", json={"timezone": "Mars/Base"}, headers=h)
    assert r.json()["timezone"] == "Asia/Yekaterinburg"
    assert (await client.put("/api/users/me", json={"weekly_goal": 9}, headers=h)).status_code == 422

    sent = []

    async def fake_send(tg_id, text_, with_button=True):
        sent.append((tg_id, text_))

    monkeypatch.setattr(reminders, "send_text", fake_send)
    r = await client.put("/api/users/me/reminders", json={"enabled": True, "time": "19:30", "days": [0, 2, 4]}, headers=h)
    assert r.status_code == 200 and r.json()["reminder_days"] == [0, 2, 4] and r.json()["reminder_time"] == "19:30"
    assert len(sent) == 1
    assert (await client.put("/api/users/me/reminders", json={"enabled": True, "time": "25:99"}, headers=h)).status_code == 422
    assert (await client.put("/api/users/me/reminders", json={"enabled": True, "days": []}, headers=h)).status_code == 400

    from aiogram.exceptions import TelegramForbiddenError
    from aiogram.methods import SendMessage

    async def forbidden(*a, **k):
        raise TelegramForbiddenError(SendMessage(chat_id=1, text="x"), "blocked")

    monkeypatch.setattr(reminders, "send_text", forbidden)
    h2, _ = await login(client, tg_id=506, name="Блок")
    r = await client.put("/api/users/me/reminders", json={"enabled": True, "time": "10:00", "days": [1]}, headers=h2)
    assert r.status_code == 400 and "Start" in r.json()["error"]
    assert (await client.get("/api/users/me", headers=h2)).json()["reminder_enabled"] is False


async def test_reminder_scheduler(client, monkeypatch):
    sent = []

    async def fake_send(tg_id, text_, with_button=True):
        sent.append((tg_id, text_))

    monkeypatch.setattr(reminders, "send_text", fake_send)
    reminders._schedule.clear()

    h, data = await login(client, tg_id=507, name="Планировщик")
    await client.put("/api/users/me", json={"timezone": "Asia/Yekaterinburg"}, headers=h)
    await client.put("/api/users/me/reminders", json={"enabled": True, "time": "18:00", "days": [0, 1, 2, 3, 4, 5, 6]}, headers=h)
    sent.clear()
    assert len(reminders._schedule) == 1

    base = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)
    assert await reminders.check_due(base) == 0
    assert await reminders.check_due(base + timedelta(hours=1, minutes=5)) == 1
    assert "Пора на тренировку" in sent[-1][1]
    assert await reminders.check_due(base + timedelta(hours=1, minutes=6)) == 0
    reminders._schedule[data["user"]["id"]].last_date = None
    assert await reminders.check_due(base + timedelta(hours=8)) == 0

    reminders._schedule[data["user"]["id"]].last_date = None
    now_utc = datetime.now(timezone.utc)
    s = (await client.post("/api/sessions", json={}, headers=h)).json()
    ex = (await client.get("/api/exercises", headers=h)).json()[0]
    await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": ex["id"], "reps": 5, "weight": 10}, headers=h)
    await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)
    entry = reminders._schedule[data["user"]["id"]]
    local = now_utc.astimezone(__import__("zoneinfo").ZoneInfo("Asia/Yekaterinburg"))
    entry.hour, entry.minute = local.hour, local.minute
    sent.clear()
    assert await reminders.check_due(now_utc + timedelta(minutes=1)) == 0 and not sent

    await client.put("/api/users/me/reminders", json={"enabled": False}, headers=h)
    assert data["user"]["id"] not in reminders._schedule


async def test_migration_adds_columns_to_old_table():
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS legacy_users"))
        await conn.execute(text("CREATE TABLE legacy_users (id INTEGER PRIMARY KEY, telegram_id BIGINT)"))
    from app import database

    old = database.NEW_COLUMNS
    database.NEW_COLUMNS = {"legacy_users": [("timezone", "VARCHAR(64) DEFAULT 'UTC'"), ("weekly_goal", "INTEGER DEFAULT 3"),
                                             ("reminder_enabled", "BOOLEAN DEFAULT FALSE")]}
    try:
        async with engine.begin() as conn:
            await conn.execute(text("INSERT INTO legacy_users (id, telegram_id) VALUES (1, 111)"))
            await conn.run_sync(database._add_missing_columns)
            await conn.run_sync(database._add_missing_columns)
            row = (await conn.execute(text("SELECT timezone, weekly_goal, reminder_enabled FROM legacy_users"))).one()
            await conn.execute(text("DROP TABLE legacy_users"))
    finally:
        database.NEW_COLUMNS = old
    assert row[0] == "UTC" and row[1] == 3 and not row[2]


async def test_diary_mark_edit_remove_and_month_view(client):
    h, data = await login(client, tg_id=601, name="Дневник")
    await client.put("/api/users/me", json={"timezone": "UTC", "weekly_goal": 2}, headers=h)
    today = datetime.now(timezone.utc).date()
    month = today.strftime("%Y-%m")

    v = (await client.get(f"/api/diary?month={month}", headers=h)).json()
    assert v["entries"] == [] and v["marked_days"] == 0 and v["streak"]["this_week"] == 0

    r = await client.put(f"/api/diary/{today.isoformat()}", json={}, headers=h)
    assert r.status_code == 200 and r.json()["kind"] == "strength"
    r = await client.put(
        f"/api/diary/{today.isoformat()}", json={"kind": "cardio", "subtype": "run", "note": "  бег 5 км "}, headers=h
    )
    assert r.json()["kind"] == "cardio" and r.json()["subtype"] == "run" and r.json()["note"] == "бег 5 км"
    r = await client.put(f"/api/diary/{today.isoformat()}", json={"kind": "strength"}, headers=h)
    assert r.json()["subtype"] is None
    r = await client.put(
        f"/api/diary/{today.isoformat()}", json={"kind": "cardio", "subtype": "run", "note": "  бег 5 км "}, headers=h
    )
    assert (await client.put(f"/api/diary/{today.isoformat()}", json={"subtype": "Bad Value!"}, headers=h)).status_code == 422
    v = (await client.get(f"/api/diary?month={month}", headers=h)).json()
    assert len(v["entries"]) == 1 and v["marked_days"] == 1 and v["streak"]["this_week"] == 1

    future = (today + timedelta(days=2)).isoformat()
    assert (await client.put(f"/api/diary/{future}", json={}, headers=h)).status_code == 400
    assert (await client.put(f"/api/diary/{today.isoformat()}", json={"kind": "xxx"}, headers=h)).status_code == 422
    assert (await client.get("/api/diary?month=2026-13", headers=h)).status_code == 422

    s = (await client.post("/api/sessions", json={"name": "Зал"}, headers=h)).json()
    ex = (await client.get("/api/exercises", headers=h)).json()[0]
    await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": ex["id"], "reps": 5, "weight": 20}, headers=h)
    await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)
    v = (await client.get(f"/api/diary?month={month}", headers=h)).json()
    assert len(v["workouts"]) == 1 and v["workouts"][0]["name"] == "Зал"
    assert v["marked_days"] == 1 and v["streak"]["this_week"] == 1

    y = today - timedelta(days=1)
    await client.put(f"/api/diary/{y.isoformat()}", json={}, headers=h)
    v = (await client.get(f"/api/diary?month={y.strftime('%Y-%m')}", headers=h)).json()
    assert any(e["day"] == y.isoformat() for e in v["entries"])

    assert (await client.delete(f"/api/diary/{today.isoformat()}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/diary/{today.isoformat()}", headers=h)).status_code == 204
    exp = (await client.get("/api/users/me/export", headers=h)).json()
    assert [d["day"] for d in exp["diary"]] == [y.isoformat()]


async def test_diary_isolated_and_deleted_with_account(client):
    ha, _ = await login(client, tg_id=602, name="A")
    hb, _ = await login(client, tg_id=603, name="B")
    today = datetime.now(timezone.utc).date().isoformat()
    await client.put(f"/api/diary/{today}", json={}, headers=ha)
    month = today[:7]
    assert (await client.get(f"/api/diary?month={month}", headers=hb)).json()["entries"] == []
    assert (await client.delete("/api/users/me", headers=ha)).status_code == 204


async def test_diary_counts_for_weekly_streak(client):
    h, _ = await login(client, tg_id=604, name="Серия")
    await client.put("/api/users/me", json={"timezone": "UTC", "weekly_goal": 1}, headers=h)
    today = datetime.now(timezone.utc).date()
    last_week = today - timedelta(weeks=1)
    for d in (today, last_week):
        await client.put(f"/api/diary/{d.isoformat()}", json={}, headers=h)
    st = (await client.get(f"/api/diary?month={today.strftime('%Y-%m')}", headers=h)).json()["streak"]
    assert st["current"] == 2 and st["this_week"] == 1
    dash = (await client.get("/api/statistics/dashboard", headers=h)).json()
    assert dash["streak"]["current"] == 2


async def test_dashboard_and_summary_shape(client):
    h, _ = await login(client, tg_id=605, name="Форма")
    d = (await client.get("/api/statistics/dashboard", headers=h)).json()
    assert set(d) == {"summary", "streak", "next_workout", "recent", "active"}
    ov = (await client.get("/api/statistics/overview", headers=h)).json()
    assert ov["weeks"] == 12 and len(ov["weekly"]) == 12 and ov["kpi"]["workouts"] == {"value": 0, "prev": 0}
    assert ov["muscles"] == [] and ov["exercises"] == []
    assert (await client.get("/api/statistics/overview?weeks=7", headers=h)).json()["weeks"] == 12


async def test_catalog_has_specific_muscles():
    from app.catalog import MUSCLE_MAP, muscles_for

    assert len(CATALOG) >= 75
    for c in CATALOG:
        assert c["primary"], c["name"]
        assert c["muscles"] == ", ".join(c["primary"])
    assert muscles_for("Приседания со штангой", "legs") == ["Квадрицепс", "Ягодичные"]
    assert muscles_for("Моё упражнение", "legs") == ["Ноги"]
    assert set(MUSCLE_MAP) == {c["name"] for c in CATALOG}
    for p in PROGRAMS:
        assert p["goal"] and p["per_week"] >= 1 and p["equipment"]


async def test_programs_api_has_filters_and_muscles(client):
    h, _ = await login(client, tg_id=701, name="Каталог")
    progs = (await client.get("/api/programs", headers=h)).json()
    assert len(progs) >= 10
    p = next(x for x in progs if x["id"] == "fullbody")
    assert p["goal"] == "Общая форма" and p["per_week"] == 3 and p["equipment"] == "Зал"
    assert p["days"][0]["items"][0]["muscles"] == "Квадрицепс, Ягодичные"
    await client.post("/api/programs/fullbody/activate", headers=h)
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"]["days"][0]["exercises"][0]["muscles"] == "Квадрицепс, Ягодичные"
    for x in progs:
        assert (await client.post(f"/api/programs/{x['id']}/activate", headers=h)).status_code == 200


async def test_rest_timer_removed_from_api(client):
    h, data = await login(client, tg_id=702, name="Таймер")
    assert "rest_timer_enabled" not in data["user"] and "default_rest_seconds" not in data["user"]
    r = await client.put("/api/users/me", json={"rest_timer_enabled": False, "weekly_goal": 4}, headers=h)
    assert r.status_code == 200 and r.json()["weekly_goal"] == 4 and "rest_timer_enabled" not in r.json()


async def test_body_entry_with_date(client):
    h, _ = await login(client, tg_id=703, name="Дата")
    old_day = (datetime.now(timezone.utc).date() - timedelta(days=20)).isoformat()
    r = await client.post("/api/body", json={"weight": 82.0, "day": old_day}, headers=h)
    assert r.status_code == 201 and r.json()["measured_at"].startswith(old_day)
    await client.post("/api/body", json={"weight": 81.0}, headers=h)
    lst = (await client.get("/api/body", headers=h)).json()
    assert [e["weight"] for e in lst] == [81.0, 82.0]
    future = (datetime.now(timezone.utc).date() + timedelta(days=5)).isoformat()
    assert (await client.post("/api/body", json={"weight": 80, "day": future}, headers=h)).status_code == 400


async def test_diary_month_has_session_details(client):
    h, _ = await login(client, tg_id=704, name="День")
    await client.put("/api/users/me", json={"timezone": "UTC"}, headers=h)
    ex = (await client.get("/api/exercises", headers=h)).json()[0]
    s = (await client.post("/api/sessions", json={"name": "Зал"}, headers=h)).json()
    await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": ex["id"], "reps": 5, "weight": 40}, headers=h)
    await client.post(f"/api/sessions/{s['id']}/finish", json={"feeling": 4, "note": "тяжело"}, headers=h)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    w = (await client.get(f"/api/diary?month={month}", headers=h)).json()["workouts"][0]
    assert w["id"] == s["id"] and w["volume"] == 200 and w["feeling"] == 4 and w["note"] == "тяжело"
    assert (await client.delete(f"/api/sessions/{s['id']}", headers=h)).status_code == 204
    assert (await client.get(f"/api/diary?month={month}", headers=h)).json()["workouts"] == []


async def test_day_two_marks_emoji_and_color(client):
    h, _ = await login(client, tg_id=801, name="Отметки")
    await client.put("/api/users/me", json={"timezone": "UTC", "weekly_goal": 1}, headers=h)
    today = datetime.now(timezone.utc).date()
    day = today.isoformat()
    month = today.strftime("%Y-%m")

    r = await client.put(
        f"/api/diary/{day}",
        json={"slot": 0, "kind": "custom", "emoji": " 🔥 ", "label": " Огонь ", "counts": False}, headers=h,
    )
    assert r.status_code == 200 and r.json()["emoji"] == "🔥" and r.json()["label"] == "Огонь" and r.json()["slot"] == 0
    r = await client.put(f"/api/diary/{day}", json={"slot": 1, "kind": "custom", "color": "#FF6FB5", "counts": False}, headers=h)
    assert r.status_code == 200 and r.json()["color"] == "#ff6fb5"
    v = (await client.get(f"/api/diary?month={month}", headers=h)).json()
    assert [(e["slot"], e["emoji"], e["color"]) for e in v["entries"]] == [(0, "🔥", None), (1, None, "#ff6fb5")]

    assert v["marked_days"] == 0 and v["streak"]["this_week"] == 0

    assert (await client.put(f"/api/diary/{day}", json={"slot": 2, "kind": "custom", "emoji": "x"}, headers=h)).status_code == 422
    assert (await client.put(f"/api/diary/{day}", json={"kind": "custom"}, headers=h)).status_code == 422
    assert (await client.put(f"/api/diary/{day}", json={"kind": "custom", "color": "red"}, headers=h)).status_code == 422

    r = await client.put(f"/api/diary/{day}", json={"slot": 0, "kind": "cardio", "subtype": "run", "emoji": "🔥"}, headers=h)
    assert r.json()["emoji"] is None and r.json()["counts"] is True and r.json()["kind"] == "cardio"
    v = (await client.get(f"/api/diary?month={month}", headers=h)).json()
    assert len(v["entries"]) == 2 and v["marked_days"] == 1 and v["streak"]["this_week"] == 1

    assert (await client.delete(f"/api/diary/{day}?slot=0", headers=h)).status_code == 204
    v = (await client.get(f"/api/diary?month={month}", headers=h)).json()
    assert [e["slot"] for e in v["entries"]] == [1] and v["marked_days"] == 0
    await client.put(f"/api/diary/{day}", json={"slot": 0, "kind": "custom", "emoji": "💪"}, headers=h)
    assert (await client.delete(f"/api/diary/{day}", headers=h)).status_code == 204
    assert (await client.get(f"/api/diary?month={month}", headers=h)).json()["entries"] == []

    await client.put(f"/api/diary/{day}", json={"slot": 1, "kind": "custom", "color": "#00aa00", "label": "Отпуск"}, headers=h)
    exp = (await client.get("/api/users/me/export", headers=h)).json()
    assert exp["diary"][0]["color"] == "#00aa00" and exp["diary"][0]["label"] == "Отпуск" and exp["diary"][0]["slot"] == 1


async def test_old_diary_entries_migrate_to_marks(client):
    from app import database

    h, data = await login(client, tg_id=802, name="Миграция")
    uid = data["user"]["id"]
    d1, d2 = date(2026, 3, 3), date(2026, 3, 4)
    async with engine.begin() as conn:
        for d, kind, sub in ((d1, "cardio", "run"), (d2, "home", None)):
            await conn.execute(
                text(
                    "INSERT INTO diary_entries (user_id, day, kind, subtype, note, created_at, migrated) "
                    "VALUES (:u, :d, :k, :s, 'старая', CURRENT_TIMESTAMP, FALSE)"
                ),
                {"u": uid, "d": d, "k": kind, "s": sub},
            )
        await database._migrate_diary_to_marks(conn)
        await database._migrate_diary_to_marks(conn)
    v = (await client.get("/api/diary?month=2026-03", headers=h)).json()
    assert [(e["day"], e["kind"], e["subtype"], e["note"], e["slot"], e["counts"]) for e in v["entries"]] == [
        ("2026-03-03", "cardio", "run", "старая", 0, True),
        ("2026-03-04", "home", None, "старая", 0, True),
    ]
    await client.delete("/api/diary/2026-03-03", headers=h)
    async with engine.begin() as conn:
        await database._migrate_diary_to_marks(conn)
    v = (await client.get("/api/diary?month=2026-03", headers=h)).json()
    assert [e["day"] for e in v["entries"]] == ["2026-03-04"]
    assert (await client.delete("/api/users/me", headers=h)).status_code == 204


async def test_create_exercise_does_not_duplicate(client):
    h, _ = await login(client, tg_id=803, name="Свои")
    a = (await client.post("/api/exercises", json={"name": "Мой жим", "muscle_group": "chest"}, headers=h)).json()
    b = (await client.post("/api/exercises", json={"name": "  мой   ЖИМ ", "muscle_group": "chest"}, headers=h)).json()
    assert a["id"] == b["id"]
    await client.delete(f"/api/exercises/{a['id']}", headers=h)
    assert a["id"] not in [e["id"] for e in (await client.get("/api/exercises", headers=h)).json()]
    c = (await client.post("/api/exercises", json={"name": "Мой жим", "muscle_group": "arms"}, headers=h)).json()
    assert c["id"] == a["id"] and c["muscle_group"] == "arms"


async def test_any_exercise_can_be_added_to_program_day(client):
    h, _ = await login(client, tg_id=804, name="Любое")
    await client.post("/api/programs/fullbody/activate", headers=h)
    day = (await client.get("/api/plan", headers=h)).json()["program"]["days"][0]
    mine = (await client.post("/api/exercises", json={"name": "Моё упражнение", "muscle_group": "core"}, headers=h)).json()
    w = (await client.get(f"/api/workouts/{day['workout_id']}", headers=h)).json()
    items = [{"exercise_id": i["exercise_id"], "target_sets": i["target_sets"], "target_reps": i["target_reps"],
              "target_weight": i["target_weight"]} for i in w["items"]]
    items.append({"exercise_id": mine["id"], "target_sets": 4, "target_reps": 12, "target_weight": None})
    r = await client.put(f"/api/workouts/{day['workout_id']}", json={"name": w["name"], "description": w["description"], "items": items}, headers=h)
    assert r.status_code == 200 and r.json()["items"][-1]["exercise"]["name"] == "Моё упражнение"
    plan_day = (await client.get("/api/plan", headers=h)).json()["program"]["days"][0]
    assert plan_day["exercises"][-1]["name"] == "Моё упражнение" and plan_day["exercises"][-1]["sets"] == 4


async def test_kettlebell_program(client):
    h, _ = await login(client, tg_id=805, name="Гиря")
    progs = (await client.get("/api/programs", headers=h)).json()
    kb = next(p for p in progs if p["id"] == "kettlebell")
    assert kb["equipment"] == "Гиря" and kb["per_week"] == 3 and len(kb["days"]) == 3
    assert all("гир" in i["name"].lower() or "подъём" in i["name"].lower() or "планка" in i["name"].lower()
               for d in kb["days"] for i in d["items"])
    assert (await client.post("/api/programs/kettlebell/activate", headers=h)).json() == {"created": 3, "kept": 0}
    plan = (await client.get("/api/plan", headers=h)).json()["program"]
    assert plan["id"] == "kettlebell" and plan["days"][0]["exercises"][0]["name"] == "Мах гирей двумя руками"


async def test_switching_program_keeps_customized_days(client):
    h, _ = await login(client, tg_id=806, name="Сохранить")
    await client.post("/api/programs/fullbody/activate", headers=h)
    days = (await client.get("/api/plan", headers=h)).json()["program"]["days"]
    mine = (await client.post("/api/exercises", json={"name": "Моё упражнение", "muscle_group": "core"}, headers=h)).json()
    w = (await client.get(f"/api/workouts/{days[0]['workout_id']}", headers=h)).json()
    items = [{"exercise_id": i["exercise_id"], "target_sets": i["target_sets"], "target_reps": i["target_reps"],
              "target_weight": i["target_weight"]} for i in w["items"]]
    items.append({"exercise_id": mine["id"], "target_sets": 3, "target_reps": 10, "target_weight": None})
    await client.put(f"/api/workouts/{w['id']}", json={"name": w["name"], "description": w["description"], "items": items}, headers=h)

    r = (await client.post("/api/programs/ppl/activate", headers=h)).json()
    assert r == {"created": 3, "kept": 1}
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"]["id"] == "ppl"
    own = [d for d in plan["own"] if d["name"] == "Фулбади A"]
    assert len(own) == 1 and own[0]["exercises"][-1]["name"] == "Моё упражнение"
    assert not any(d["name"] == "Фулбади B" for d in plan["own"])

    await client.post("/api/programs/ppl/activate", headers=h)
    plan = (await client.get("/api/plan", headers=h)).json()
    assert len([d for d in plan["own"] if d["name"] == "Фулбади A"]) == 1


async def test_catalog_images_exist_on_disk():
    from pathlib import Path

    public = Path(__file__).resolve().parents[2] / "frontend" / "public"
    with_images = [c for c in CATALOG if c["images"]]
    assert len(with_images) >= 100
    for c in with_images:
        assert len(c["images"]) == 2
        for url in c["images"]:
            assert (public / url.lstrip("/")).is_file(), url


async def test_goals_body_weight_lift_monthly(client):
    h, _ = await login(client, tg_id=810, name="Цели")
    await client.put("/api/users/me", json={"timezone": "UTC"}, headers=h)
    assert (await client.get("/api/goals", headers=h)).json() == []

    assert (await client.post("/api/goals", json={"kind": "body_weight", "target": 75}, headers=h)).status_code == 400
    await client.post("/api/body", json={"weight": 85}, headers=h)
    assert (await client.post("/api/goals", json={"kind": "body_weight", "target": 85}, headers=h)).status_code == 400
    assert (await client.post("/api/goals", json={"kind": "body_weight", "target": 75}, headers=h)).status_code == 201

    ex = (await client.post("/api/exercises", json={"name": "Жим цель", "muscle_group": "chest"}, headers=h)).json()
    assert (await client.post("/api/goals", json={"kind": "lift", "target": 100}, headers=h)).status_code == 422
    assert (await client.post("/api/goals", json={"kind": "lift", "target": 100, "exercise_id": 999999}, headers=h)).status_code == 404
    assert (await client.post("/api/goals", json={"kind": "lift", "target": 100, "exercise_id": ex["id"]}, headers=h)).status_code == 201
    assert (await client.post("/api/goals", json={"kind": "lift", "target": 20, "exercise_id": ex["id"], "metric": "reps"}, headers=h)).status_code == 201

    assert (await client.post("/api/goals", json={"kind": "monthly", "target": 12.5}, headers=h)).status_code == 422
    assert (await client.post("/api/goals", json={"kind": "monthly", "target": 40}, headers=h)).status_code == 422
    assert (await client.post("/api/goals", json={"kind": "monthly", "target": 2}, headers=h)).status_code == 201

    goals = {(g["kind"], g["metric"]): g for g in (await client.get("/api/goals", headers=h)).json()}
    assert goals[("body_weight", "weight")]["progress"] == 0 and goals[("body_weight", "weight")]["current"] == 85
    assert goals[("lift", "weight")]["current"] == 0 and goals[("lift", "weight")]["exercise_name"] == "Жим цель"

    s = (await client.post("/api/sessions", json={}, headers=h)).json()
    await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": ex["id"], "reps": 12, "weight": 80}, headers=h)
    await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)
    await client.post("/api/body", json={"weight": 80}, headers=h)
    goals = {(g["kind"], g["metric"]): g for g in (await client.get("/api/goals", headers=h)).json()}
    assert goals[("lift", "weight")]["progress"] == 0.8 and goals[("lift", "weight")]["current"] == 80
    assert goals[("lift", "reps")]["progress"] == 0.6
    assert goals[("body_weight", "weight")]["progress"] == 0.5
    assert goals[("monthly", "weight")]["current"] == 1 and goals[("monthly", "weight")]["progress"] == 0.5
    assert not goals[("monthly", "weight")]["achieved"]

    today = datetime.now(timezone.utc).date()
    other = today - timedelta(days=1) if today.day > 1 else today + timedelta(days=0)
    if other != today:
        await client.put(f"/api/diary/{other.isoformat()}", json={"kind": "custom", "emoji": "🔥", "counts": False}, headers=h)
        g = next(x for x in (await client.get("/api/goals", headers=h)).json() if x["kind"] == "monthly")
        assert g["current"] == 1
        await client.put(f"/api/diary/{other.isoformat()}", json={"slot": 1, "kind": "strength"}, headers=h)
        g = next(x for x in (await client.get("/api/goals", headers=h)).json() if x["kind"] == "monthly")
        assert g["current"] == 2 and g["achieved"] is True

    await client.post("/api/body", json={"weight": 74}, headers=h)
    wg = next(x for x in (await client.get("/api/goals", headers=h)).json() if x["kind"] == "body_weight")
    assert wg["achieved"] and wg["achieved_at"]
    await client.post("/api/body", json={"weight": 90}, headers=h)
    wg = next(x for x in (await client.get("/api/goals", headers=h)).json() if x["kind"] == "body_weight")
    assert wg["achieved"] is True

    lst = (await client.get("/api/goals", headers=h)).json()
    flags = [g["achieved"] for g in lst]
    assert flags == sorted(flags)
    h2, _ = await login(client, tg_id=811, name="Чужой")
    assert (await client.delete(f"/api/goals/{lst[0]['id']}", headers=h2)).status_code == 404
    assert (await client.delete(f"/api/goals/{lst[0]['id']}", headers=h)).status_code == 204
    assert len((await client.get("/api/goals", headers=h)).json()) == len(lst) - 1
    exp = (await client.get("/api/users/me/export", headers=h)).json()
    assert len(exp["goals"]) == len(lst) - 1


async def test_removed_program_does_not_break_existing_users(client):
    h, data = await login(client, tg_id=820, name="Старый")
    uid = data["user"]["id"]
    assert "fatloss" not in [p["id"] for p in (await client.get("/api/programs", headers=h)).json()]
    await client.post("/api/programs/fullbody/activate", headers=h)
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE workouts SET program_id = 'fatloss' WHERE user_id = :u"), {"u": uid})
        await conn.execute(text("UPDATE users SET active_program = 'fatloss' WHERE id = :u"), {"u": uid})
    plan = (await client.get("/api/plan", headers=h)).json()
    assert plan["program"] is None and len(plan["own"]) == 2
    assert (await client.get("/api/statistics/dashboard", headers=h)).status_code == 200
    r = (await client.post("/api/programs/ppl/activate", headers=h)).json()
    assert r["created"] == 3 and r["kept"] == 2
    assert len((await client.get("/api/plan", headers=h)).json()["own"]) == 2
