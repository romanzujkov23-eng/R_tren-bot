from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.streaks import (
    diary_days, get_tz, streak_from, to_local_date,
)
from app.catalog import muscle_split, split_muscles
from app.database import get_db_ro, run_parallel
from app.models import CompletedSet, Exercise, User, Workout, WorkoutSession
from app.muscle_map import (
    build_map, collect_loads, cycle_window, default_targets, exercise_hints, next_workout_muscles, percent_filled,
    program_targets, scale_targets, week_bounds,
)
from app.plan import build_plan, load_custom, load_last_done, load_recent, load_workouts, next_workout
from app.security import get_current_user_ro

router = APIRouter()


async def _completed_rows(db: AsyncSession, user_id: int):
    rows = await db.execute(
        select(
            WorkoutSession.id,
            WorkoutSession.name,
            WorkoutSession.finished_at,
            WorkoutSession.duration_seconds,
            WorkoutSession.total_sets,
            WorkoutSession.total_volume,
            WorkoutSession.feeling,
        )
        .where(WorkoutSession.user_id == user_id, WorkoutSession.status == "completed")
        .order_by(WorkoutSession.finished_at.desc())
    )
    return rows.all()


def _summary(rows, streak: dict) -> dict:
    return {
        "total_workouts": len(rows),
        "total_volume": round(sum(float(r.total_volume or 0) for r in rows), 1),
        "total_sets": int(sum(r.total_sets or 0 for r in rows)),
        "total_minutes": int(sum(r.duration_seconds or 0 for r in rows)) // 60,
        "workouts_this_week": streak["this_week"],
    }


async def compute_summary(db: AsyncSession, user: User) -> dict:
    rows, days = await run_parallel(lambda s: _completed_rows(s, user.id), lambda s: diary_days(s, user.id))
    return _summary(rows, streak_from([r.finished_at for r in rows], days, user))


async def compute_records(db: AsyncSession, user_id: int, limit: int | None = None) -> list[dict]:
    rows = await db.execute(
        select(
            Exercise.id,
            Exercise.name,
            Exercise.muscle_group,
            Exercise.measure,
            func.max(CompletedSet.weight),
            func.max(CompletedSet.est_1rm),
            func.max(CompletedSet.reps),
        )
        .join(CompletedSet, CompletedSet.exercise_id == Exercise.id)
        .join(WorkoutSession, WorkoutSession.id == CompletedSet.session_id)
        .where(WorkoutSession.user_id == user_id)
        .group_by(Exercise.id, Exercise.name, Exercise.muscle_group, Exercise.measure)
        .order_by(func.max(CompletedSet.est_1rm).desc(), func.max(CompletedSet.reps).desc())
    )
    result = [
        {
            "exercise_id": r[0],
            "name": r[1],
            "muscle_group": r[2],
            "measure": r[3] or "reps",
            "best_weight": float(r[4] or 0),
            "best_1rm": float(r[5] or 0),
            "best_reps": int(r[6] or 0),
        }
        for r in rows
    ]
    return result[:limit] if limit else result


@router.get("/dashboard")
async def dashboard(user: User = Depends(get_current_user_ro)):
    uid = user.id

    async def active(db):
        return (
            await db.execute(
                select(WorkoutSession.id, WorkoutSession.name, WorkoutSession.total_sets).where(
                    WorkoutSession.user_id == uid, WorkoutSession.status == "active"
                )
            )
        ).first()

    rows, act, days, workouts, last_done, custom, recent = await run_parallel(
        lambda s: _completed_rows(s, uid),
        active,
        lambda s: diary_days(s, uid),
        lambda s: load_workouts(s, uid),
        lambda s: load_last_done(s, uid),
        lambda s: load_custom(s, uid, user.active_program),
        lambda s: load_recent(s, uid),
    )
    streak = streak_from([r.finished_at for r in rows], days, user)
    plan = build_plan(user.active_program, workouts, last_done, custom, recent)
    return {
        "summary": _summary(rows, streak),
        "streak": streak,
        "next_workout": next_workout(plan),
        "recent": [
            {
                "id": r.id,
                "name": r.name,
                "finished_at": r.finished_at,
                "duration_seconds": r.duration_seconds,
                "total_sets": r.total_sets,
                "total_volume": r.total_volume,
                "feeling": r.feeling,
            }
            for r in rows[:5]
        ],
        "active": {"id": act[0], "name": act[1], "total_sets": act[2]} if act else None,
    }


PERIODS = (1, 3, 6, 13)
DEFAULT_PERIOD = 1
DAILY_BUCKETS_UP_TO = 3
ASSIST_WEIGHT = 0.5


@router.get("/overview")
async def overview(weeks: int = Query(DEFAULT_PERIOD), user: User = Depends(get_current_user_ro)):
    if weeks not in PERIODS:
        weeks = DEFAULT_PERIOD
    tz = get_tz(user.timezone)
    today = datetime.now(tz).date()
    days = weeks * 7
    start = today - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)
    lo = datetime.combine(prev_start - timedelta(days=1), datetime.min.time())
    uid = user.id

    async def sessions(db):
        rows = await db.execute(
            select(
                WorkoutSession.finished_at, WorkoutSession.duration_seconds,
                WorkoutSession.total_sets, WorkoutSession.total_volume,
            ).where(
                WorkoutSession.user_id == uid, WorkoutSession.status == "completed",
                WorkoutSession.finished_at >= lo,
            )
        )
        return rows.all()

    async def sets(db):
        rows = await db.execute(
            select(
                CompletedSet.session_id, CompletedSet.exercise_id, CompletedSet.weight, CompletedSet.reps,
                CompletedSet.est_1rm, WorkoutSession.finished_at, Exercise.name, Exercise.muscle_group,
                Exercise.measure, Exercise.primary_muscles, Exercise.secondary_muscles,
            )
            .join(WorkoutSession, WorkoutSession.id == CompletedSet.session_id)
            .join(Exercise, Exercise.id == CompletedSet.exercise_id)
            .where(
                WorkoutSession.user_id == uid, WorkoutSession.status == "completed",
                WorkoutSession.finished_at >= datetime.combine(start - timedelta(days=1), datetime.min.time()),
            )
        )
        return rows.all()

    sess, sett = await run_parallel(sessions, sets)

    def agg(rows):
        n = len(rows)
        minutes = sum((r.duration_seconds or 0) for r in rows) / 60
        return {
            "workouts": n,
            "volume": sum(float(r.total_volume or 0) for r in rows),
            "sets": sum(int(r.total_sets or 0) for r in rows),
            "minutes": minutes,
            "avg_minutes": minutes / n if n else 0,
            "per_week": n / weeks,
        }

    daily = weeks <= DAILY_BUCKETS_UP_TO
    n_buckets = days if daily else weeks
    step = 1 if daily else 7
    buckets = [
        {"label": (start + timedelta(days=i * step)).strftime("%d.%m"), "workouts": 0, "volume": 0.0, "sets": 0}
        for i in range(n_buckets)
    ]

    cur_rows, prev_rows = [], []
    for r in sess:
        d = to_local_date(r.finished_at, tz)
        if d >= start:
            cur_rows.append(r)
            idx = (d - start).days // step
            if 0 <= idx < n_buckets:
                b = buckets[idx]
                b["workouts"] += 1
                b["volume"] += float(r.total_volume or 0)
                b["sets"] += int(r.total_sets or 0)
        elif d >= prev_start:
            prev_rows.append(r)
    cur, prev = agg(cur_rows), agg(prev_rows)

    per_ex: dict[int, dict] = {}
    muscle_src: dict[int, list] = {}
    for r in sett:
        d = to_local_date(r.finished_at, tz)
        if d < start:
            continue
        if r.muscle_group != "cardio":
            src = muscle_src.setdefault(
                r.exercise_id,
                [r.name, r.muscle_group, 0, d, split_muscles(r.primary_muscles), split_muscles(r.secondary_muscles)],
            )
            src[2] += 1
            src[3] = max(src[3], d)
        ex = per_ex.setdefault(
            r.exercise_id, {"name": r.name, "measure": r.measure or "reps", "sessions": {}, "best": None}
        )
        sess_best = ex["sessions"].get(r.session_id)
        if r.measure and r.measure != "reps":
            score = float(r.reps)
        else:
            score = float(r.est_1rm)
        if sess_best is None or score > sess_best[1]:
            ex["sessions"][r.session_id] = (r.finished_at, score, float(r.weight), int(r.reps))
        key = (score, float(r.weight), int(r.reps))
        if ex["best"] is None or key > ex["best"][0]:
            ex["best"] = (key, r.finished_at)

    muscle_stats: dict[str, dict] = {}
    for name, group, count, last, own_primary, own_secondary in muscle_src.values():
        primary, secondary = muscle_split(name, group, own_primary, own_secondary)
        for m in primary:
            st = muscle_stats.setdefault(m, {"sets": 0, "assist": 0, "last": last})
            st["sets"] += count
            st["last"] = max(st["last"], last)
        for m in secondary:
            if m not in primary:
                st = muscle_stats.setdefault(m, {"sets": 0, "assist": 0, "last": last})
                st["assist"] += count
                st["last"] = max(st["last"], last)

    loads = {m: v["sets"] + ASSIST_WEIGHT * v["assist"] for m, v in muscle_stats.items()}
    total_load = sum(loads.values()) or 1
    muscles = [
        {
            "name": m,
            "sets": muscle_stats[m]["sets"],
            "assist": muscle_stats[m]["assist"],
            "load": round(load, 1),
            "share": round(load / total_load, 3),
            "last_days": (today - muscle_stats[m]["last"]).days,
        }
        for m, load in sorted(loads.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    exercises = []
    for ex_id, ex in per_ex.items():
        ordered = sorted(ex["sessions"].values(), key=lambda v: v[0])
        (e1, w, reps), best_dt = ex["best"][0], ex["best"][1]
        exercises.append({
            "exercise_id": ex_id,
            "name": ex["name"],
            "measure": ex["measure"],
            "sessions": len(ordered),
            "best_weight": w,
            "best_reps": reps,
            "best_1rm": e1 if ex["measure"] == "reps" else 0,
            "first_1rm": ordered[0][1],
            "last_1rm": ordered[-1][1],
            "delta_1rm": round(ordered[-1][1] - ordered[0][1], 1) if len(ordered) > 1 else None,
            "best_date": best_dt.isoformat() + "Z",
        })
    exercises.sort(key=lambda e: (-e["sessions"], -e["best_1rm"], e["name"]))

    def pair(key, digits=1):
        return {"value": round(cur[key], digits), "prev": round(prev[key], digits)}

    return {
        "weeks": weeks,
        "bucket": "day" if daily else "week",
        "kpi": {
            "workouts": pair("workouts", 0), "volume": pair("volume"), "sets": pair("sets", 0),
            "minutes": pair("minutes", 0), "avg_minutes": pair("avg_minutes", 0), "per_week": pair("per_week"),
        },
        "weekly": [
            {"week": b["label"], "workouts": b["workouts"], "volume": round(b["volume"], 1), "sets": b["sets"]}
            for b in buckets
        ],
        "muscles": muscles,
        "exercises": exercises[:15],
    }


@router.get("/records")
async def records(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    return await compute_records(db, user.id)


@router.get("/progress/{exercise_id}")
async def progress(
    exercise_id: int, user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)
):
    ex = await db.get(Exercise, exercise_id)
    if not ex or ex.user_id != user.id:
        raise HTTPException(404, "Упражнение не найдено")
    rows = await db.execute(
        select(
            WorkoutSession.id,
            WorkoutSession.finished_at,
            func.max(CompletedSet.weight),
            func.max(CompletedSet.est_1rm),
            func.sum(CompletedSet.volume),
            func.max(CompletedSet.reps),
        )
        .join(CompletedSet, CompletedSet.session_id == WorkoutSession.id)
        .where(
            WorkoutSession.user_id == user.id,
            WorkoutSession.status == "completed",
            CompletedSet.exercise_id == exercise_id,
        )
        .group_by(WorkoutSession.id, WorkoutSession.finished_at)
        .order_by(WorkoutSession.finished_at)
    )
    return {
        "exercise": {"id": ex.id, "name": ex.name, "measure": ex.measure or "reps"},
        "points": [
            {
                "date": r[1].strftime("%d.%m"),
                "max_weight": float(r[2] or 0),
                "est_1rm": float(r[3] or 0),
                "volume": round(float(r[4] or 0), 1),
                "max_reps": int(r[5] or 0),
            }
            for r in rows
        ],
    }


@router.get("/muscle-map")
async def muscle_map(scope: str = Query("week"), user: User = Depends(get_current_user_ro)):
    tz = get_tz(user.timezone)
    today = datetime.now(tz).date()
    uid = user.id
    workouts, last_done, custom, recent, program_sessions = await run_parallel(
        lambda s: load_workouts(s, uid),
        lambda s: load_last_done(s, uid),
        lambda s: load_custom(s, uid, user.active_program),
        lambda s: load_recent(s, uid),
        lambda s: _program_sessions(s, uid),
    )
    plan = build_plan(user.active_program, workouts, last_done, custom, recent)
    prog = plan["program"]
    by_id: dict[int, Workout] = {w.id: w for w in workouts}
    cycle: list[Workout] = []
    if prog:
        source = prog["cycle"] or prog["days"]
        cycle = [by_id[c["workout_id"]] for c in source if c["workout_id"] in by_id]
    cycle_ids = {w.id for w in cycle}
    cycle_available = bool(cycle)
    if scope != "cycle" or not cycle_available:
        scope = "week"

    base = program_targets(cycle) if cycle else {}
    nxt_w = by_id.get(prog["next_workout_id"]) if prog else None
    local = lambda dt: to_local_date(dt, tz)
    result: dict = {
        "scope": scope,
        "cycle_available": cycle_available,
        "program_name": prog["name"] if prog else None,
        "source": "program" if base else "default",
    }

    if scope == "week":
        week_start, week_end = week_bounds(today)
        prev_start = week_start - timedelta(days=7)
        factor = min(1.0, (user.weekly_goal or 3) / max(len(cycle), 1))
        targets = scale_targets(base, factor) if base else default_targets()
        rows = await _set_rows(user, datetime.combine(prev_start - timedelta(days=1), datetime.min.time()))
        cur = collect_loads(rows, lambda f: f if local(f) >= week_start else None)
        prev = collect_loads(rows, lambda f: f if prev_start <= local(f) < week_start else None)
        result.update({
            "start": week_start.isoformat(),
            "end": week_end.isoformat(),
            "days_left": (week_end - today).days,
            "prev_percent": percent_filled(prev, targets),
            "cycle": None,
        })
    else:
        in_program = [fin for wid, fin in program_sessions if wid in cycle_ids and fin]
        start_dt, done, completed = cycle_window(len(cycle), in_program)
        targets = base
        rows = await _set_rows(user, start_dt) if start_dt else []
        cur = collect_loads(rows, lambda f: f if start_dt and f >= start_dt else None)
        result.update({
            "start": local(start_dt).isoformat() if start_dt else None,
            "end": None,
            "days_left": None,
            "prev_percent": None,
            "cycle": {"done": done, "total": len(cycle), "completed": completed},
        })

    muscles = build_map(cur, targets, exercise_hints(cycle), today, local)
    goal = [m for m in muscles if m["progress"] is not None]
    result.update({
        "percent": percent_filled(cur, targets),
        "filled": sum(1 for m in goal if m["progress"] >= 1),
        "total": len(goal),
        "muscles": muscles,
        "next_workout": next_workout_muscles(nxt_w, muscles),
    })
    return result


async def _program_sessions(db: AsyncSession, uid: int):
    rows = await db.execute(
        select(WorkoutSession.workout_id, WorkoutSession.finished_at).where(
            WorkoutSession.user_id == uid,
            WorkoutSession.status == "completed",
            WorkoutSession.workout_id.is_not(None),
            WorkoutSession.finished_at.is_not(None),
        )
    )
    return rows.all()


async def _set_rows(user: User, lo: datetime):
    async def fetch(db: AsyncSession):
        rows = await db.execute(
            select(
                WorkoutSession.finished_at, Exercise.name, Exercise.muscle_group,
                Exercise.primary_muscles, Exercise.secondary_muscles,
            )
            .select_from(CompletedSet)
            .join(WorkoutSession, WorkoutSession.id == CompletedSet.session_id)
            .join(Exercise, Exercise.id == CompletedSet.exercise_id)
            .where(
                WorkoutSession.user_id == user.id,
                WorkoutSession.status == "completed",
                WorkoutSession.finished_at >= lo,
                Exercise.muscle_group != "cardio",
            )
        )
        return rows.all()

    return (await run_parallel(fetch))[0]
