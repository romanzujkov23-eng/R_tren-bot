from app import bench as B
from tests.test_api import client, login  # noqa: F401

BODY = {"best_weight": 100, "best_reps": 1, "work_weight": 80, "work_reps": 8, "days_per_week": 3}


def test_planner_basics():
    assert B.e1rm_of(100, 1) == 100
    assert 125 < B.e1rm_of(100, 8) < 130
    # вес растёт от недели к неделе в тяжёлые дни и не превышает максимум до теста
    p = B.Params(e1rm=100, days=3)
    tops = [B.plan_day(w, 1, "heavy", p)["sets"][0]["weight"] for w in range(1, 8)]
    assert tops == sorted(tops) and tops[-1] < 100 and tops[0] < 80
    assert all(w % 2.5 == 0 for w in tops)
    test = B.plan_day(9, 2, "test", p)["sets"]
    assert [s["weight"] for s in test] == sorted(s["weight"] for s in test) and test[-1]["weight"] > 100
    assert len(B.schedule(3)) == B.total_days(3) == 26 and len(B.schedule(2)) == 18 and len(B.schedule(4)) == 34
    wu = B.warmup(100)
    assert wu[0]["weight"] == 20 and all(x["weight"] < 100 for x in wu)
    assert [x["weight"] for x in wu] == sorted(x["weight"] for x in wu)


def test_evidence_and_adjust():
    plan = [{"kind": "top", "weight": 80, "reps": 5, "rir": 2, "e": 98.7}, {"kind": "backoff", "weight": 74, "reps": 5, "rir": None, "e": 98.7}]
    as_planned = B.evidence(plan, [(80, 5, None), (74, 5, None)], "heavy")
    stronger = B.evidence(plan, [(80, 8, None), (74, 7, None)], "heavy")
    weaker = B.evidence(plan, [(80, 3, None), (74, 3, None)], "heavy")
    assert weaker < as_planned < stronger
    assert B.evidence(plan, [(80, 5, None)], "deload") is None
    e = 100.0
    assert B.adjust(e, 101.5, "heavy") == e
    assert B.adjust(e, 130, "heavy") == 103.0  # не больше 3% за тренировку
    assert B.adjust(e, 70, "heavy") == 97.0
    assert B.adjust(e, 104, "test") == 104


def test_baseline_uses_history_and_warns():
    base, notes = B.baseline(100, 1, 70, 8, None)
    assert 90 < base < 100 and notes and "Разница" in notes[0]
    up, n2 = B.baseline(100, 1, 70, 8, 125)
    assert up > base and any("сильнее" in x for x in n2)
    assert B.volume_factor(3, None) == 1.0 and B.volume_factor(3, 2) == 0.75 and B.volume_factor(3, 40) == 1.2


async def test_bench_program_flow(client):
    h, _ = await login(client, tg_id=9501)
    r = (await client.get("/api/bench", headers=h)).json()
    assert r["active"] is False

    pv = (await client.post("/api/bench/preview", json=BODY, headers=h)).json()
    assert pv["e1rm"] > 100 and len(pv["weeks"]) == 9

    assert (await client.post("/api/bench", json={**BODY, "days_per_week": 7}, headers=h)).status_code == 422
    st = (await client.post("/api/bench", json=BODY, headers=h)).json()
    assert st["active"] and st["progress"]["done"] == 0 and st["next"]["kind"] == "heavy"
    assert (await client.post("/api/bench", json=BODY, headers=h)).status_code == 409

    # обычные программы и список тренировок не затронуты
    assert (await client.get("/api/workouts", headers=h)).json() == []
    assert (await client.get("/api/plan", headers=h)).json()["program"] is None

    s = (await client.post("/api/bench/start", headers=h)).json()
    main = s["plan"][0]
    assert main["exercise"]["name"] == "Жим штанги лёжа" and main["sets_plan"] and main["note"]
    assert len(s["plan"]) == 3  # жим и две подсобки
    again = (await client.post("/api/bench/start", headers=h)).json()
    assert again["id"] == s["id"]
    assert (await client.get("/api/bench", headers=h)).json()["resume_session_id"] == s["id"]

    # выполняем с запасом больше плана: максимум должен вырасти
    base_e = st["program"]["e1rm"]
    for sp in main["sets_plan"]:
        await client.post(
            f"/api/sessions/{s['id']}/sets",
            json={"exercise_id": main["exercise_id"], "reps": sp["reps"] + 3, "weight": sp["weight"], "rpe": 6}, headers=h,
        )
    await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)

    st2 = (await client.get("/api/bench", headers=h)).json()
    assert st2["progress"]["done"] == 1 and st2["next"]["kind"] == "volume"
    assert st2["program"]["e1rm"] > base_e and st2["last"]["e_delta"] > 0
    assert (await client.get("/api/workouts", headers=h)).json() == []
    # подходы жима попали в мышечную карту недели
    mm = (await client.get("/api/statistics/muscle-map?scope=week", headers=h)).json()
    assert next(m for m in mm["muscles"] if m["name"] == "Грудные")["load"] >= len(main["sets_plan"])

    fin = (await client.post("/api/bench/finish", headers=h)).json()
    assert fin["active"] is False and fin["hint"]["best_weight"] > 0


def test_perfect_execution_does_not_drift():
    """Если подходы выполнены ровно по плану, расчётный максимум не должен уходить."""
    for start in (60.0, 87.3, 100.0, 142.0):
        for days in (1, 2, 3, 4):
            e = start
            for week, day, kind in B.schedule(days):
                plan = B.plan_day(week, day, kind, B.Params(e1rm=e, days=days))
                done = [(s["weight"], s["reps"], None) for s in plan["sets"]]
                e = B.adjust(e, B.evidence(plan["sets"], done, kind) if plan["main"] == B.BENCH else None, kind)
                if kind != "test":
                    assert abs(e - start) / start < 0.005, (start, days, week, day, kind, e)


def test_ppl_addon_mode():
    assert len(B.schedule(1)) == B.total_days(1) == 10
    assert [k for _, _, k in B.schedule(1)][:7] == ["heavy"] * 7
    plan = B.plan_day(3, 1, "heavy", B.Params(e1rm=100, days=1))
    # расширенный день: вариация с узким хватом и подсобные
    assert plan["secondary"]["name"] == B.CLOSE_GRIP and len(plan["secondary"]["sets"]) == 3
    assert 65 <= plan["secondary"]["sets"][0]["weight"] <= 75 and len(plan["accessories"]) == 4
    assert any("дополнительный" in t for t in plan["tips"])
    assert B.plan_day(8, 1, "deload", B.Params(e1rm=100, days=1))["secondary"] is None
    assert B.plan_day(3, 1, "heavy", B.Params(e1rm=100, days=3))["accessories"]
    assert B.volume_factor(1, 30) == 1.0


async def test_ppl_addon_api(client):
    h, _ = await login(client, tg_id=9502)
    await client.post("/api/programs/ppl/activate", headers=h)
    st = (await client.post("/api/bench", json={**BODY, "days_per_week": 1}, headers=h)).json()
    assert st["next"]["kind"] == "heavy" and len(st["next"]["accessories"]) == 4 and st["next"]["secondary"]
    assert any("дополнительный" in n for n in st["program"]["notes"])
    plan_before = (await client.get("/api/plan", headers=h)).json()
    s = (await client.post("/api/bench/start", headers=h)).json()
    assert len(s["plan"]) == 6  # жим, узкий хват и четыре подсобных
    assert s["plan"][1]["exercise"]["name"] == "Жим штанги узким хватом" and s["plan"][1]["sets_plan"]
    await client.post(f"/api/sessions/{s['id']}/cancel", headers=h)
    # обычная программа осталась на месте
    plan_after = (await client.get("/api/plan", headers=h)).json()
    assert plan_after["program"] and plan_after["program"]["id"] == plan_before["program"]["id"]
    hint = (await client.get("/api/bench", headers=h)).json()["hint"]
    assert hint is None or "hours_since_bench" in hint


async def test_chest_rest_hint_counts_any_program(client):
    h, _ = await login(client, tg_id=9503)
    await client.post("/api/programs/ppl/activate", headers=h)
    await client.post("/api/bench", json={**BODY, "days_per_week": 1}, headers=h)
    assert (await client.get("/api/bench", headers=h)).json()["chest_hours"] is None
    # жим на наклонной скамье в обычной тренировке тоже считается нагрузкой на грудь
    incline = next(e for e in (await client.get("/api/exercises", headers=h)).json() if "наклон" in e["name"].lower() and "жим" in e["name"].lower())
    s = (await client.post("/api/sessions", json={}, headers=h)).json()
    await client.post(f"/api/sessions/{s['id']}/sets", json={"exercise_id": incline["id"], "reps": 8, "weight": 40}, headers=h)
    await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)
    hours = (await client.get("/api/bench", headers=h)).json()["chest_hours"]
    assert hours is not None and hours < 1


def test_region_weight_tables_match_parts():
    from app import anatomy as A

    for parent, parts in A.REGIONS.items():
        assert len(A.DEFAULTS[parent]) == len(parts), parent
        assert abs(sum(A.DEFAULTS[parent]) - 1) < 1e-9, parent
        for words, weights in A.RULES.get(parent, []):
            assert len(weights) == len(parts), (parent, words)
            assert abs(sum(weights) - 1) < 1e-9, (parent, words)
    # анатомически цельные мышцы не делятся на части
    assert "Пресс" not in A.REGIONS and "Широчайшие" not in A.REGIONS


def test_bench_tables_cover_every_planned_week():
    for w in range(1, 8):
        assert w in B.HEAVY and w in B.VOLUME and w in B.SPEED and w in B.VARIATION
    for days in (1, 2, 3, 4):
        for week, day, kind in B.schedule(days):
            plan = B.plan_day(week, day, kind, B.Params(e1rm=90, days=days))
            assert plan["sets"] and all(s["weight"] >= 0 and s["reps"] >= 1 for s in plan["sets"])
            assert plan["warmup"] == sorted(plan["warmup"], key=lambda x: x["weight"])


async def test_account_delete_removes_bench_and_export_has_it(client):
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import BenchProgram, User

    h, auth = await login(client, tg_id=9504)
    await client.post("/api/bench", json=BODY, headers=h)
    exp = (await client.get("/api/users/me/export", headers=h)).json()
    assert exp["bench_programs"] and exp["bench_programs"][0]["status"] == "active"
    # служебную тренировку дня жима нельзя удалить через обычный API
    s = (await client.post("/api/bench/start", headers=h)).json()
    assert (await client.delete(f"/api/workouts/{s['workout_id']}", headers=h)).status_code == 400

    async with AsyncSessionLocal() as db:
        uid = (await db.execute(select(User.id).where(User.telegram_id == 9504))).scalar_one()
        assert (await db.execute(select(BenchProgram).where(BenchProgram.user_id == uid))).scalars().all()
    assert (await client.delete("/api/users/me", headers=h)).status_code == 204
    async with AsyncSessionLocal() as db:
        assert not (await db.execute(select(BenchProgram).where(BenchProgram.user_id == uid))).scalars().all()


async def test_full_cycle_to_the_end_and_new_cycle(client):
    """Проходим все 34 тренировки цикла на 4 дня: все типы дней, тест максимума, завершение и новый цикл."""
    h, _ = await login(client, tg_id=9505)
    st = (await client.post("/api/bench", json={**BODY, "days_per_week": 4}, headers=h)).json()
    kinds_seen, names_seen = [], set()
    start_e = st["program"]["e1rm"]
    guard = 0
    while st["next"] and guard < 60:
        guard += 1
        plan = st["next"]
        kinds_seen.append(plan["kind"])
        s = (await client.post("/api/bench/start", headers=h)).json()
        names_seen |= {i["exercise"]["name"] for i in s["plan"]}
        main = s["plan"][0]
        assert main["sets_plan"] and [x["weight"] for x in main["sets_plan"]] == [x["weight"] for x in plan["sets"]]
        for sp in main["sets_plan"]:  # выполняем ровно по плану, на тесте берём все попытки
            r = await client.post(
                f"/api/sessions/{s['id']}/sets",
                json={"exercise_id": main["exercise_id"], "reps": sp["reps"], "weight": sp["weight"]}, headers=h,
            )
            assert r.status_code in (200, 201), r.text
        assert (await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)).status_code == 200
        st = (await client.get("/api/bench", headers=h)).json()
    assert guard == 34 and st["progress"]["complete"] and st["next"] is None
    assert set(kinds_seen) == {"heavy", "volume", "variation", "speed", "deload", "prep", "test"}
    assert "Жим штанги узким хватом" in names_seen and "Жим штанги лёжа" in names_seen
    # тест: самая тяжёлая попытка сделана, максимум обновился по результату теста
    assert st["program"]["e1rm"] > start_e and st["last"]["kind"] == "test"
    assert st["progress"]["done"] == st["progress"]["total"] == 34
    assert (await client.get("/api/workouts", headers=h)).json() == []

    # завершённый цикл можно заменить новым без ручного завершения
    new = await client.post("/api/bench", json={**BODY, "best_weight": 110, "days_per_week": 1}, headers=h)
    assert new.status_code == 201 and new.json()["progress"]["done"] == 0
    assert (await client.post("/api/bench", json=BODY, headers=h)).status_code == 409


def test_new_columns_exist_in_models():
    from app.database import NEW_COLUMNS
    from app.models import Base

    for table, cols in NEW_COLUMNS.items():
        assert table in Base.metadata.tables, table
        have = {c.name for c in Base.metadata.tables[table].columns}
        for name, _ in cols:
            assert name in have, (table, name)


async def test_empty_or_cancelled_bench_session_does_not_consume_a_day(client):
    h, _ = await login(client, tg_id=9506)
    await client.post("/api/bench", json={**BODY, "days_per_week": 1}, headers=h)

    s = (await client.post("/api/bench/start", headers=h)).json()
    r = await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)
    st = (await client.get("/api/bench", headers=h)).json()
    # пустая тренировка либо отклонена, либо не засчитана как выполненный день
    assert st["progress"]["done"] == 0 and st["progress"]["week"] == 1, (r.status_code, st["progress"])

    s2 = (await client.post("/api/bench/start", headers=h)).json()
    await client.delete(f"/api/sessions/{s2['id']}", headers=h)
    st = (await client.get("/api/bench", headers=h)).json()
    assert st["progress"]["done"] == 0 and st["resume_session_id"] is None
    # после отмены день снова можно начать
    assert (await client.post("/api/bench/start", headers=h)).status_code == 201


def test_hip_flexors_removed_from_muscle_model():
    from app.catalog import GROUP_LABELS, MUSCLES, MUSCLE_MAP
    from app.muscle_map import expand

    assert "Сгибатели бедра" not in MUSCLES and "Сгибатели бедра" not in GROUP_LABELS
    for name, (primary, secondary) in MUSCLE_MAP.items():
        assert "Сгибатели бедра" not in primary + secondary, name
        assert primary, name
    # старые свои упражнения с этой мышцей засчитываются в пресс
    assert expand(["Сгибатели бедра", "Пресс"]) == ["Пресс"]
