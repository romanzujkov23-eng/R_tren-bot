from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import PROGRAMS_BY_ID, muscles_for
from app.models import Workout, WorkoutSession


async def load_workouts(db: AsyncSession, user_id: int) -> list[Workout]:
    rows = await db.execute(select(Workout).where(Workout.user_id == user_id).order_by(Workout.id))
    return list(rows.scalars().all())


async def load_last_done(db: AsyncSession, user_id: int) -> dict[int, datetime]:
    rows = await db.execute(
        select(WorkoutSession.workout_id, func.max(WorkoutSession.finished_at))
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "completed",
            WorkoutSession.workout_id.is_not(None),
        )
        .group_by(WorkoutSession.workout_id)
    )
    return {wid: fin for wid, fin in rows if fin}


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def _day(w: Workout, last: datetime | None) -> dict:
    return {
        "workout_id": w.id,
        "name": w.name,
        "day_index": w.day_index,
        "last_done": _iso(last),
        "exercises": [
            {
                "exercise_id": i.exercise_id,
                "name": i.exercise.name,
                "muscle_group": i.exercise.muscle_group,
                "muscles": ", ".join(muscles_for(i.exercise.name, i.exercise.muscle_group)),
                "sets": i.target_sets,
                "reps": i.target_reps,
                "weight": i.target_weight,
            }
            for i in w.items
        ],
    }


def build_plan(active_id: str | None, workouts: list[Workout], last_done: dict[int, datetime]) -> dict:
    meta = PROGRAMS_BY_ID.get(active_id) if active_id else None
    days = sorted(
        (w for w in workouts if meta and w.program_id == active_id), key=lambda w: (w.day_index or 0, w.id)
    )
    own = [w for w in workouts if not (meta and w.program_id == active_id)]

    program = None
    if meta and days:
        done = [(last_done[w.id], pos) for pos, w in enumerate(days) if w.id in last_done]
        nxt = days[(max(done)[1] + 1) % len(days)] if done else days[0]
        program = {
            "id": meta["id"],
            "name": meta["name"],
            "level": meta["level"],
            "description": meta["description"],
            "next_workout_id": nxt.id,
            "days": [_day(w, last_done.get(w.id)) for w in days],
        }
    return {"program": program, "own": [_day(w, last_done.get(w.id)) for w in sorted(own, key=lambda w: -w.id)]}


def next_workout(plan: dict) -> dict | None:
    prog = plan["program"]
    if not prog:
        return None
    day = next(d for d in prog["days"] if d["workout_id"] == prog["next_workout_id"])
    return {
        "id": day["workout_id"],
        "name": day["name"],
        "exercises": len(day["exercises"]),
        "program_name": prog["name"],
    }
