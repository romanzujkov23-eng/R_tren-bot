from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.streaks import (
    diary_days, get_tz, streak_from, to_local_date, week_start,
)
from app.catalog import muscles_for
from app.database import get_db_ro, run_parallel
from app.models import CompletedSet, Exercise, User, WorkoutSession
from app.plan import build_plan, load_last_done, load_workouts, next_workout
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
            func.max(CompletedSet.weight),
            func.max(CompletedSet.est_1rm),
            func.max(CompletedSet.reps),
        )
        .join(CompletedSet, CompletedSet.exercise_id == Exercise.id)
        .join(WorkoutSession, WorkoutSession.id == CompletedSet.session_id)
        .where(WorkoutSession.user_id == user_id)
        .group_by(Exercise.id, Exercise.name, Exercise.muscle_group)
        .order_by(func.max(CompletedSet.est_1rm).desc())
    )
    result = [
        {
            "exercise_id": r[0],
            "name": r[1],
            "muscle_group": r[2],
            "best_weight": float(r[3] or 0),
            "best_1rm": float(r[4] or 0),
            "best_reps": int(r[5] or 0),
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

    rows, act, days, workouts, last_done = await run_parallel(
        lambda s: _completed_rows(s, uid),
        active,
        lambda s: diary_days(s, uid),
        lambda s: load_workouts(s, uid),
        lambda s: load_last_done(s, uid),
    )
    streak = streak_from([r.finished_at for r in rows], days, user)
    plan = build_plan(user.active_program, workouts, last_done)
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


PERIODS = (4, 8, 12, 26)


@router.get("/overview")
async def overview(weeks: int = Query(12), user: User = Depends(get_current_user_ro)):
    if weeks not in PERIODS:
        weeks = 12
    tz = get_tz(user.timezone)
    this_week = week_start(datetime.now(tz).date())
    start = this_week - timedelta(weeks=weeks - 1)
    prev_start = start - timedelta(weeks=weeks)
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

    cur_rows, prev_rows = [], []
    buckets = {start + timedelta(weeks=i): {"workouts": 0, "volume": 0.0, "sets": 0} for i in range(weeks)}
    for r in sess:
        d = to_local_date(r.finished_at, tz)
        if d >= start:
            cur_rows.append(r)
            b = buckets.get(week_start(d))
            if b:
                b["workouts"] += 1
                b["volume"] += float(r.total_volume or 0)
                b["sets"] += int(r.total_sets or 0)
        elif d >= prev_start:
            prev_rows.append(r)
    cur, prev = agg(cur_rows), agg(prev_rows)

    muscle_sets: dict[str, int] = {}
    per_ex: dict[int, dict] = {}
    for r in sett:
        d = to_local_date(r.finished_at, tz)
        if d < start:
            continue
        if r.muscle_group != "cardio":
            for m in muscles_for(r.name, r.muscle_group):
                muscle_sets[m] = muscle_sets.get(m, 0) + 1
        ex = per_ex.setdefault(r.exercise_id, {"name": r.name, "sessions": {}, "best": None})
        sess_best = ex["sessions"].get(r.session_id)
        if sess_best is None or r.est_1rm > sess_best[1]:
            ex["sessions"][r.session_id] = (r.finished_at, float(r.est_1rm), float(r.weight), int(r.reps))
        key = (float(r.est_1rm), float(r.weight), int(r.reps))
        if ex["best"] is None or key > ex["best"][0]:
            ex["best"] = (key, r.finished_at)

    total_sets = sum(muscle_sets.values()) or 1
    muscles = [
        {"name": m, "sets": c, "share": round(c / total_sets, 3)}
        for m, c in sorted(muscle_sets.items(), key=lambda kv: -kv[1])[:10]
    ]
    exercises = []
    for ex_id, ex in per_ex.items():
        ordered = sorted(ex["sessions"].values(), key=lambda v: v[0])
        (e1, w, reps), best_dt = ex["best"][0], ex["best"][1]
        exercises.append({
            "exercise_id": ex_id,
            "name": ex["name"],
            "sessions": len(ordered),
            "best_weight": w,
            "best_reps": reps,
            "best_1rm": e1,
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
        "kpi": {
            "workouts": pair("workouts", 0), "volume": pair("volume"), "sets": pair("sets", 0),
            "minutes": pair("minutes", 0), "avg_minutes": pair("avg_minutes", 0), "per_week": pair("per_week"),
        },
        "weekly": [
            {"week": w.strftime("%d.%m"), "workouts": v["workouts"], "volume": round(v["volume"], 1), "sets": v["sets"]}
            for w, v in buckets.items()
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
        "exercise": {"id": ex.id, "name": ex.name},
        "points": [
            {
                "date": r[1].strftime("%d.%m"),
                "max_weight": float(r[2] or 0),
                "est_1rm": float(r[3] or 0),
                "volume": round(float(r[4] or 0), 1),
            }
            for r in rows
        ],
    }
