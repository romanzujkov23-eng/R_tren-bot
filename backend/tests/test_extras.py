from tests.test_api import client, login  # noqa: F401

BODY = {"best_weight": 100, "best_reps": 1, "work_weight": 70, "work_reps": 8, "days_per_week": 1}


async def _do(client, h, workout_id):
    s = (await client.post("/api/sessions", json={"workout_id": workout_id}, headers=h)).json()
    first = s["plan"][0]
    await client.post(
        f"/api/sessions/{s['id']}/sets",
        json={"exercise_id": first["exercise_id"], "reps": first["target_reps"] or 8, "weight": first["target_weight"] or 20}, headers=h,
    )
    assert (await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)).status_code == 200


async def _bench_day(client, h):
    s = (await client.post("/api/bench/start", headers=h)).json()
    main = s["plan"][0]
    for sp in main["sets_plan"]:
        await client.post(
            f"/api/sessions/{s['id']}/sets",
            json={"exercise_id": main["exercise_id"], "reps": sp["reps"], "weight": sp["weight"]}, headers=h,
        )
    assert (await client.post(f"/api/sessions/{s['id']}/finish", json={}, headers=h)).status_code == 200


async def test_bench_becomes_fourth_day_of_a_three_day_program(client):
    h, _ = await login(client, tg_id=9601)
    # без программы добавлять день некуда
    assert (await client.post("/api/extras", json={"kind": "bench"}, headers=h)).status_code == 400
    await client.post("/api/programs/ppl/activate", headers=h)
    # пока жим не настроен, добавить его нельзя
    assert (await client.post("/api/extras", json={"kind": "bench"}, headers=h)).status_code == 400

    # настройка жима сама добавляет день в текущую программу
    st = (await client.post("/api/bench", json=BODY, headers=h)).json()
    assert st["in_program"] is True
    assert (await client.post("/api/extras", json={"kind": "bench"}, headers=h)).status_code == 409

    plan = (await client.get("/api/plan", headers=h)).json()["program"]
    assert len(plan["days"]) == 3 and len(plan["extras"]) == 1
    assert plan["extras"][0]["workout_id"] == -1 and plan["extras"][0]["extra"]["kind"] == "bench"
    assert plan["extras"][0]["exercises"][0]["name"] == "Жим штанги лёжа"
    assert "Жим" in plan["extras"][0]["name"] and plan["extras"][0]["bench"]["week"] == 1

    # круг из четырёх дней: Push, Pull, Legs, жим, снова Push
    order = []
    for _ in range(5):
        p = (await client.get("/api/plan", headers=h)).json()["program"]
        nxt = p["next_workout_id"]
        order.append(nxt)
        if nxt == -1:
            await _bench_day(client, h)
        else:
            await _do(client, h, nxt)
    ids = [d["workout_id"] for d in plan["days"]]
    assert order == ids + [-1, ids[0]]

    dash = (await client.get("/api/statistics/dashboard", headers=h)).json()
    assert dash["next_workout"]["id"] == ids[1] and dash["next_workout"]["kind"] == "workout"

    # убрать день жима из программы можно, история остаётся
    eid = plan["extras"][0]["extra"]["id"]
    assert (await client.delete(f"/api/extras/{eid}", headers=h)).status_code == 204
    p = (await client.get("/api/plan", headers=h)).json()["program"]
    assert p["extras"] == []
    assert (await client.get("/api/bench", headers=h)).json()["in_program"] is False
    # и вернуть обратно
    assert (await client.post("/api/extras", json={"kind": "bench"}, headers=h)).status_code == 201


async def test_cardio_and_own_workout_as_extra_days(client):
    h, _ = await login(client, tg_id=9602)
    await client.post("/api/programs/ppl/activate", headers=h)
    lst = (await client.get("/api/extras", headers=h)).json()
    assert "Бег (минуты)" in lst["cardio"] and lst["extras"] == []

    assert (await client.post("/api/extras", json={"kind": "cardio", "exercise": "Штанга", "minutes": 20}, headers=h)).status_code == 400
    r = await client.post("/api/extras", json={"kind": "cardio", "exercise": "Бег (минуты)", "minutes": 25}, headers=h)
    assert r.status_code == 201
    plan = (await client.get("/api/plan", headers=h)).json()
    ex = plan["program"]["extras"]
    assert len(ex) == 1 and ex[0]["name"] == "Кардио: Бег" and ex[0]["exercises"][0]["reps"] == 25
    assert all(d["workout_id"] != ex[0]["workout_id"] for d in plan["own"])  # не дублируется в «своих»

    # своя тренировка тоже подходит в качестве дня
    ex_row = next(e for e in (await client.get("/api/exercises", headers=h)).json() if e["name"] == "Жим штанги лёжа")
    w = (await client.post("/api/workouts", json={"name": "Руки", "items": [{"exercise_id": ex_row["id"], "target_sets": 3, "target_reps": 10}]}, headers=h)).json()
    assert (await client.post("/api/extras", json={"kind": "workout", "workout_id": w["id"]}, headers=h)).status_code == 201
    assert (await client.post("/api/extras", json={"kind": "workout", "workout_id": w["id"]}, headers=h)).status_code == 409
    # день самой программы добавить нельзя
    own_day = plan["program"]["days"][0]["workout_id"]
    assert (await client.post("/api/extras", json={"kind": "workout", "workout_id": own_day}, headers=h)).status_code == 400

    # дополнительные дни входят в круг на карте мышц
    mm = (await client.get("/api/statistics/muscle-map?scope=cycle", headers=h)).json()
    assert mm["cycle_available"] is True


async def test_extras_work_with_a_custom_program_and_are_private(client):
    h, _ = await login(client, tg_id=9603)
    ws = []
    for name in ("A", "B"):
        ex = next(e for e in (await client.get("/api/exercises", headers=h)).json() if e["name"] == "Жим штанги лёжа")
        ws.append((await client.post("/api/workouts", json={"name": name, "items": [{"exercise_id": ex["id"], "target_sets": 3, "target_reps": 8}]}, headers=h)).json())
    p = (await client.post("/api/my-programs", json={"name": "Моя", "workout_ids": [ws[0]["id"], ws[1]["id"]]}, headers=h)).json()
    await client.post(f"/api/my-programs/{p['id']}/activate", headers=h)
    await client.post("/api/extras", json={"kind": "cardio", "exercise": "Велотренажёр (минуты)", "minutes": 30}, headers=h)
    plan = (await client.get("/api/plan", headers=h)).json()["program"]
    assert plan["custom"] and len(plan["cycle"]) == 3  # A, B и кардио
    cardio_id = plan["extras"][0]["workout_id"]
    order = []
    for _ in range(4):
        pl = (await client.get("/api/plan", headers=h)).json()["program"]
        order.append(pl["next_workout_id"])
        await _do(client, h, pl["next_workout_id"])
    assert order == [ws[0]["id"], ws[1]["id"], cardio_id, ws[0]["id"]]

    # чужой пользователь не видит и не может удалить дни
    h2, _ = await login(client, tg_id=9604)
    eid = plan["extras"][0]["extra"]["id"]
    assert (await client.delete(f"/api/extras/{eid}", headers=h2)).status_code == 404
    assert (await client.post("/api/extras", json={"kind": "workout", "workout_id": ws[0]["id"]}, headers=h2)).status_code in (400, 404)


async def test_finishing_bench_cycle_removes_its_day_from_program(client):
    h, _ = await login(client, tg_id=9605)
    await client.post("/api/programs/ppl/activate", headers=h)
    await client.post("/api/bench", json=BODY, headers=h)
    assert len((await client.get("/api/plan", headers=h)).json()["program"]["extras"]) == 1
    await client.post("/api/bench/finish", headers=h)
    assert (await client.get("/api/plan", headers=h)).json()["program"]["extras"] == []


async def test_days_of_the_program_can_be_reordered_with_extras(client):
    h, _ = await login(client, tg_id=9606)
    await client.post("/api/programs/ppl/activate", headers=h)
    await client.post("/api/bench", json=BODY, headers=h)
    p = (await client.get("/api/plan", headers=h)).json()["program"]
    keys = p["order"]
    assert keys == [d["key"] for d in p["days"]] + [d["key"] for d in p["extras"]]  # по умолчанию: дни, затем дополнительные
    push, pull, legs, bench = keys

    # жим между Pull и Legs, а Legs первым
    new = [legs, push, pull, bench]
    assert (await client.put("/api/plan/order", json={"order": new}, headers=h)).status_code == 200
    p = (await client.get("/api/plan", headers=h)).json()["program"]
    assert p["order"] == new
    by_key = {d["key"]: d["workout_id"] for d in p["days"] + p["extras"]}
    assert p["next_workout_id"] == by_key[legs]  # ещё ничего не делали: первым идёт первый в порядке

    # ротация идёт по новому порядку: Legs, Push, Pull, жим, снова Legs
    seen = []
    for _ in range(5):
        pl = (await client.get("/api/plan", headers=h)).json()["program"]
        nxt = pl["next_workout_id"]
        seen.append(nxt)
        if nxt == -1:
            await _bench_day(client, h)
        else:
            await _do(client, h, nxt)
    assert seen == [by_key[legs], by_key[push], by_key[pull], -1, by_key[legs]]

    # новый дополнительный день встаёт в конец, остальной порядок сохраняется
    r = await client.post("/api/extras", json={"kind": "cardio", "exercise": "Бег (минуты)", "minutes": 20}, headers=h)
    assert r.status_code == 201
    p = (await client.get("/api/plan", headers=h)).json()["program"]
    assert p["order"][:4] == new and len(p["order"]) == 5

    # проверка ввода и сброс
    assert (await client.put("/api/plan/order", json={"order": ["w1", "w1"]}, headers=h)).status_code == 400
    assert (await client.put("/api/plan/order", json={"order": ["bad"]}, headers=h)).status_code == 400
    assert (await client.delete("/api/plan/order", headers=h)).status_code == 204
    p = (await client.get("/api/plan", headers=h)).json()["program"]
    assert p["order"][0] == push


async def test_reordering_a_custom_program_and_no_program_case(client):
    h, _ = await login(client, tg_id=9607)
    assert (await client.put("/api/plan/order", json={"order": ["w1"]}, headers=h)).status_code == 400  # без программы
    ex = next(e for e in (await client.get("/api/exercises", headers=h)).json() if e["name"] == "Жим штанги лёжа")
    ws = [
        (await client.post("/api/workouts", json={"name": n, "items": [{"exercise_id": ex["id"], "target_sets": 3, "target_reps": 8}]}, headers=h)).json()
        for n in ("A", "B", "C")
    ]
    p = (await client.post("/api/my-programs", json={"name": "Моя", "workout_ids": [w["id"] for w in ws]}, headers=h)).json()
    await client.post(f"/api/my-programs/{p['id']}/activate", headers=h)
    plan = (await client.get("/api/plan", headers=h)).json()["program"]
    a, b, c = [d["key"] for d in plan["days"]]
    await client.put("/api/plan/order", json={"order": [c, a, b]}, headers=h)
    plan = (await client.get("/api/plan", headers=h)).json()["program"]
    assert plan["order"] == [c, a, b]
    order = []
    for _ in range(4):
        pl = (await client.get("/api/plan", headers=h)).json()["program"]
        order.append(pl["next_workout_id"])
        await _do(client, h, pl["next_workout_id"])
    ids = {d["key"]: d["workout_id"] for d in plan["days"]}
    assert order == [ids[c], ids[a], ids[b], ids[c]]
