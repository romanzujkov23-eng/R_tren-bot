import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import bench as B
from app.catalog import muscle_split, norm, split_muscles
from app.database import get_db, get_db_ro
from app.extras import program_key
from app.models import BenchProgram, CompletedSet, Exercise, ProgramExtra, User, Workout, WorkoutExercise, WorkoutSession, utcnow
from app.routers.sessions import _active, _reload, _to_out
from app.schemas import SessionOut
from app.security import get_current_user, get_current_user_ro
from app.services import ensure_exercises

router = APIRouter()


class BenchIn(BaseModel):
    best_weight: float = Field(ge=20, le=500)
    best_reps: int = Field(default=1, ge=1, le=12)
    work_weight: float = Field(ge=20, le=500)
    work_reps: int = Field(default=8, ge=1, le=15)
    days_per_week: int = Field(default=3, ge=1, le=4)


def _fmt(x: float) -> str:
    return f"{x:g}"


def describe_sets(sets: list[dict]) -> str:
    groups: list[list] = []
    for s in sets:
        if groups and groups[-1][0] == (s["weight"], s["reps"]):
            groups[-1][1] += 1
        else:
            groups.append([(s["weight"], s["reps"]), 1])
    parts = []
    for (w, r), n in groups:
        parts.append(f"{_fmt(w)}×{r}" if n == 1 else f"{n}×{_fmt(w)}×{r}")
    return ", ".join(parts)


async def history_hint(db: AsyncSession, user: User) -> dict | None:
    """Что приложение знает о жиме лёжа из прошлых тренировок."""
    mine = (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars().all()
    ex = next((e for e in mine if norm(e.name) == norm(B.BENCH)), None)
    if ex is None:
        return None
    rows = (
        await db.execute(
            select(CompletedSet.weight, CompletedSet.reps, CompletedSet.est_1rm, WorkoutSession.id, WorkoutSession.finished_at)
            .join(WorkoutSession, CompletedSet.session_id == WorkoutSession.id)
            .where(WorkoutSession.user_id == user.id, WorkoutSession.status == "completed", CompletedSet.exercise_id == ex.id, CompletedSet.weight > 0)
        )
    ).all()
    if not rows:
        return None
    best = max(rows, key=lambda r: (float(r[0]), int(r[1])))
    now = utcnow()
    recent = [r for r in rows if r[4] and r[4] >= now - timedelta(days=56)]
    last4 = [r for r in rows if r[4] and r[4] >= now - timedelta(days=28)]
    e_recent = max((float(r[2]) for r in recent if r[1] <= 8), default=None)
    work = max((r for r in last4 if r[1] >= 5), key=lambda r: (float(r[0]), int(r[1])), default=None)
    sessions4 = {r[3] for r in last4}
    last_at = max((r[4] for r in rows if r[4]), default=None)
    return {
        "hours_since_bench": round((now - last_at).total_seconds() / 3600, 1) if last_at else None,
        "best_weight": float(best[0]),
        "best_reps": int(best[1]),
        "recent_e1rm": round(e_recent, 1) if e_recent else None,
        "work_weight": float(work[0]) if work else None,
        "work_reps": int(work[1]) if work else None,
        "weekly_sets": round(len(last4) / 4, 1) if len(last4) >= 4 else None,
        "sessions_per_week": round(len(sessions4) / 4, 1) if sessions4 else None,
    }


async def hours_since_chest(db: AsyncSession, user: User) -> float | None:
    """Сколько часов назад была работа на грудные (жим, разводка, отжимания) в любой тренировке, за последние трое суток."""
    since = utcnow() - timedelta(hours=72)
    rows = (
        await db.execute(
            select(Exercise, WorkoutSession.finished_at)
            .join(CompletedSet, CompletedSet.exercise_id == Exercise.id)
            .join(WorkoutSession, CompletedSet.session_id == WorkoutSession.id)
            .where(WorkoutSession.user_id == user.id, WorkoutSession.status == "completed", WorkoutSession.finished_at >= since)
        )
    ).all()
    last = None
    for ex, at in rows:
        primary, _ = muscle_split(ex.name, ex.muscle_group, split_muscles(ex.primary_muscles), split_muscles(ex.secondary_muscles))
        if "Грудные" in primary and at and (last is None or at > last):
            last = at
    return round((utcnow() - last).total_seconds() / 3600, 1) if last else None


def _build(body: BenchIn, hint: dict | None) -> tuple[float, float, list[str]]:
    e0, notes = B.baseline(
        body.best_weight, body.best_reps, body.work_weight, body.work_reps, hint["recent_e1rm"] if hint else None,
    )
    vf = B.volume_factor(body.days_per_week, hint["weekly_sets"] if hint else None)
    if body.days_per_week == 1:
        notes.append("Один дополнительный день в неделю: объём жима в ваших обычных тренировках остаётся прежним.")
    elif hint and hint["weekly_sets"] and vf != 1.0:
        notes.append(
            f"За последние 4 недели вы делали около {hint['weekly_sets']:g} подходов жима в неделю, поэтому объём программы "
            + ("уменьшен" if vf < 1 else "увеличен")
            + " относительно стандартного."
        )
    return e0, vf, notes


def _week_rows(params: B.Params, results: dict, next_key: tuple[int, int] | None) -> list[dict]:
    weeks: dict[int, dict] = {}
    for week, day, kind in B.schedule(params.days):
        w = weeks.setdefault(week, {"week": week, "phase": B.PHASES[week][0], "focus": B.PHASES[week][1], "days": []})
        res = results.get((week, day))
        if res:
            w["days"].append({"day": day, "kind": kind, "title": res["title"], "state": "done", "summary": res["summary"], "session_id": res["session_id"]})
        else:
            plan = B.plan_day(week, day, kind, params)
            w["days"].append({
                "day": day, "kind": kind, "title": plan["title"],
                "state": "next" if next_key == (week, day) else "planned",
                "summary": describe_sets(plan["sets"]), "session_id": None,
            })
    return list(weeks.values())


async def _results(db: AsyncSession, user: User, prog: BenchProgram) -> dict[tuple[int, int], dict]:
    rows = (
        await db.execute(
            select(WorkoutSession, Workout)
            .join(Workout, WorkoutSession.workout_id == Workout.id)
            .where(
                WorkoutSession.user_id == user.id,
                WorkoutSession.status == "completed",
                Workout.program_id.like(f"b:{prog.id}:%"),
            )
            .order_by(WorkoutSession.finished_at)
        )
    ).all()
    out: dict[tuple[int, int], dict] = {}
    for sess, workout in rows:
        try:
            _, _, w, d = workout.program_id.split(":")
            key = (int(w), int(d))
        except ValueError:
            continue
        main = next((i for i in workout.items if i.sets_plan), None)
        if main is None:
            continue
        done = [(float(s.weight), int(s.reps), s.rpe) for s in sess.sets if s.exercise_id == main.exercise_id]
        if not done:
            continue  # пустая тренировка или без основного упражнения: день не засчитывается
        out[key] = {"session": sess, "plan_sets": main.sets_plan or [], "done": done, "main": main.exercise.name}
    return out


async def compute(db: AsyncSession, user: User, prog: BenchProgram) -> dict:
    kinds = {(w, d): k for w, d, k in B.schedule(prog.days_per_week)}
    results = await _results(db, user, prog)
    params = B.Params(e1rm=prog.baseline_e1rm, days=prog.days_per_week, volume_factor=prog.volume_factor)

    e = prog.baseline_e1rm
    shown: dict[tuple[int, int], dict] = {}
    last = None
    next_key = None
    for week, day, kind in B.schedule(prog.days_per_week):
        res = results.get((week, day))
        if res is None:
            next_key = (week, day)
            break
        est = B.evidence(res["plan_sets"], res["done"], kind) if res["main"] == B.BENCH else None
        before = e
        e = B.adjust(e, est, kind)
        title = B.TITLES[kind]
        done_sets = [{"weight": w, "reps": r} for w, r, _ in res["done"]]
        item = {
            "week": week, "day": day, "kind": kind, "title": title,
            "session_id": res["session"].id,
            "summary": describe_sets(done_sets),
            "date": (res["session"].finished_at.isoformat() + "Z") if res["session"].finished_at else None,
            "e_before": before, "e_after": e, "est": round(est, 1) if est else None,
            "had_rpe": any(rpe is not None for _, _, rpe in res["done"]),
        }
        shown[(week, day)] = item
        last = item

    params.e1rm = e
    next_plan = None
    if next_key:
        next_plan = B.plan_day(next_key[0], next_key[1], kinds[next_key], params)

    last_out = None
    if last:
        delta = round(last["e_after"] - last["e_before"], 1)
        if last["kind"] == "deload":
            tip = "Разгрузка выполнена. Дальше пойдёт тест: вы должны чувствовать себя свежее обычного."
        elif last["kind"] == "test":
            tip = f"Новый расчётный максимум {last['e_after']:g} кг ({last['e_after'] - prog.baseline_e1rm:+.1f} кг к старту)."
        elif last["est"] is None:
            tip = "Эта тренировка не меняет расчёт максимума: веса идут по плану."
        elif delta > 0:
            tip = f"Подходы дались легче плана. Расчётный максимум вырос на {delta:g} кг, веса следующих тренировок выше."
        elif delta < 0:
            tip = f"Подходы дались тяжелее плана. Расчётный максимум снижен на {abs(delta):g} кг, веса следующих тренировок ниже. Проверьте сон и питание и не добивайте подходы до отказа."
        else:
            tip = "Всё в рамках плана. Веса следующих тренировок без изменений."
        if last["kind"] in ("heavy", "volume") and not last["had_rpe"]:
            tip += " Отмечайте запас повторов после подхода, и программа подстроится точнее."
        last_out = {**last, "tip": tip, "e_delta": delta}

    complete = next_key is None
    done_count = len(shown)
    total = B.total_days(prog.days_per_week)
    week_rows = _week_rows(params, {k: v for k, v in shown.items()}, next_key)
    notes = json.loads(prog.notes_json) if prog.notes_json else []

    active_session = await _active(db, user)
    resume_id = None
    if active_session and active_session.workout_id and next_key:
        w = await db.get(Workout, active_session.workout_id)
        if w and w.program_id == f"b:{prog.id}:{next_key[0]}:{next_key[1]}":
            resume_id = active_session.id

    return {
        "program": prog,
        "e1rm": e,
        "next_key": next_key,
        "next_plan": next_plan,
        "last": last_out,
        "weeks": week_rows,
        "complete": complete,
        "done": done_count,
        "total": total,
        "notes": notes,
        "resume_session_id": resume_id,
    }


async def bench_in_program(db: AsyncSession, user: User) -> bool:
    row = (
        await db.execute(
            select(ProgramExtra.id).where(
                ProgramExtra.user_id == user.id, ProgramExtra.program_key == program_key(user), ProgramExtra.kind == "bench"
            )
        )
    ).first()
    return row is not None


def _payload(c: dict, hint: dict | None = None, chest_hours: float | None = None, in_program: bool = False) -> dict:
    prog: BenchProgram = c["program"]
    nk = c["next_key"]
    return {
        "active": True,
        "program": {
            "id": prog.id,
            "days_per_week": prog.days_per_week,
            "weeks": B.WEEKS,
            "best_weight": prog.best_weight, "best_reps": prog.best_reps,
            "work_weight": prog.work_weight, "work_reps": prog.work_reps,
            "baseline_e1rm": prog.baseline_e1rm,
            "e1rm": c["e1rm"],
            "started_at": prog.created_at.isoformat() + "Z",
            "notes": c["notes"],
        },
        "progress": {
            "done": c["done"], "total": c["total"], "complete": c["complete"],
            "week": nk[0] if nk else B.WEEKS, "day": nk[1] if nk else 0,
            "phase": B.PHASES[nk[0] if nk else B.WEEKS][0],
        },
        "next": c["next_plan"],
        "resume_session_id": c["resume_session_id"],
        "last": c["last"],
        "weeks": c["weeks"],
        "hint": hint,
        "chest_hours": chest_hours,
        "in_program": in_program,
    }


async def _active_program(db: AsyncSession, user: User) -> BenchProgram | None:
    return (
        await db.execute(
            select(BenchProgram).where(BenchProgram.user_id == user.id, BenchProgram.status == "active").order_by(BenchProgram.id.desc())
        )
    ).scalars().first()


@router.get("")
async def state(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    hint = await history_hint(db, user)
    prog = await _active_program(db, user)
    if prog is None:
        return {"active": False, "hint": hint}
    return _payload(await compute(db, user, prog), hint, await hours_since_chest(db, user), await bench_in_program(db, user))


@router.post("/preview")
async def preview(body: BenchIn, user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    hint = await history_hint(db, user)
    e0, vf, notes = _build(body, hint)
    params = B.Params(e1rm=e0, days=body.days_per_week, volume_factor=vf)
    return {"e1rm": e0, "volume_factor": vf, "notes": notes, "weeks": _week_rows(params, {}, (1, 1))}


@router.post("", status_code=201)
async def create(body: BenchIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prog = await _active_program(db, user)
    if prog is not None:
        c = await compute(db, user, prog)
        if not c["complete"]:
            raise HTTPException(409, "У вас уже есть активная программа. Завершите её, чтобы начать новую.")
        prog.status, prog.finished_at = "finished", utcnow()
    hint = await history_hint(db, user)
    e0, vf, notes = _build(body, hint)
    new = BenchProgram(
        user_id=user.id, days_per_week=body.days_per_week,
        best_weight=body.best_weight, best_reps=body.best_reps,
        work_weight=body.work_weight, work_reps=body.work_reps,
        baseline_e1rm=e0, volume_factor=vf, notes_json=json.dumps(notes, ensure_ascii=False),
    )
    db.add(new)
    # новый цикл сразу становится днём текущей программы, если она выбрана
    if user.active_program and not await bench_in_program(db, user):
        position = (await db.execute(select(ProgramExtra.position).where(
            ProgramExtra.user_id == user.id, ProgramExtra.program_key == program_key(user)
        ).order_by(ProgramExtra.position.desc()))).scalars().first()
        db.add(ProgramExtra(user_id=user.id, program_key=program_key(user), kind="bench", position=(position + 1) if position is not None else 0))
    await db.commit()
    await db.refresh(new)
    return _payload(await compute(db, user, new), hint, await hours_since_chest(db, user), await bench_in_program(db, user))


@router.post("/finish")
async def finish(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prog = await _active_program(db, user)
    if prog is None:
        raise HTTPException(404, "Активной программы нет")
    prog.status, prog.finished_at = "finished", utcnow()
    await db.execute(delete(ProgramExtra).where(ProgramExtra.user_id == user.id, ProgramExtra.kind == "bench"))
    await db.commit()
    return {"active": False, "hint": await history_hint(db, user)}


@router.post("/start", response_model=SessionOut, status_code=201)
async def start(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prog = await _active_program(db, user)
    if prog is None:
        raise HTTPException(404, "Активной программы нет")
    c = await compute(db, user, prog)
    plan = c["next_plan"]
    if plan is None:
        raise HTTPException(400, "Цикл уже завершён")

    pid = f"b:{prog.id}:{plan['week']}:{plan['day']}"
    existing = await _active(db, user)
    if existing:
        w = await db.get(Workout, existing.workout_id) if existing.workout_id else None
        if w and w.program_id == pid:
            return await _to_out(db, existing)
        raise HTTPException(409, "Сначала завершите или отмените текущую тренировку")

    secondary = plan.get("secondary")
    names = [plan["main"]] + ([secondary["name"]] if secondary else []) + [a["name"] for a in plan["accessories"]]
    exs = await ensure_exercises(db, user, names)
    sets = plan["sets"]
    lines = []
    if plan["warmup"]:
        lines.append("Разминка (не записывайте): " + ", ".join(f"{_fmt(x['weight'])}×{x['reps']}" for x in plan["warmup"]))
    rest = plan["rest_seconds"]
    lines.append(f"Отдых между рабочими подходами: {rest // 60} мин" + (f" {rest % 60} с" if rest % 60 else ""))
    if plan["main_note"]:
        lines.append(plan["main_note"])
    main_note = "\n".join(lines)

    items = [
        WorkoutExercise(
            exercise_id=exs[norm(plan["main"])].id, exercise=exs[norm(plan["main"])], order_index=0,
            target_sets=len(sets), target_reps=sets[0]["reps"], target_weight=sets[0]["weight"],
            note=main_note, sets_plan_json=json.dumps(sets, ensure_ascii=False),
        )
    ]
    if secondary:
        ex2 = exs[norm(secondary["name"])]
        items.append(WorkoutExercise(
            exercise_id=ex2.id, exercise=ex2, order_index=1, target_sets=len(secondary["sets"]),
            target_reps=secondary["sets"][0]["reps"], target_weight=secondary["sets"][0]["weight"],
            note=secondary["note"], sets_plan_json=json.dumps(secondary["sets"], ensure_ascii=False),
        ))
    for i, a in enumerate(plan["accessories"], start=len(items)):
        ex = exs[norm(a["name"])]
        items.append(WorkoutExercise(
            exercise_id=ex.id, exercise=ex, order_index=i, target_sets=a["sets"], target_reps=a["reps"], note=a["note"],
        ))

    name = f"Жим: неделя {plan['week']}, {plan['title'].lower()}"
    workout = (await db.execute(select(Workout).where(Workout.user_id == user.id, Workout.program_id == pid))).scalars().first()
    if workout is None:
        workout = Workout(user_id=user.id, name=name, description=f"Прогрессия жима лёжа, {plan['phase'].lower()}", program_id=pid)
        db.add(workout)
    workout.name = name
    workout.items = items
    await db.flush()

    s = WorkoutSession(user_id=user.id, workout_id=workout.id, name=name)
    db.add(s)
    await db.commit()
    return await _to_out(db, await _reload(db, s.id))
