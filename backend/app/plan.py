from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import PROGRAMS_BY_ID, is_hidden_program_id, muscles_for
from app.models import CustomProgram, Workout, WorkoutSession


async def load_workouts(db: AsyncSession, user_id: int) -> list[Workout]:
    rows = await db.execute(select(Workout).where(Workout.user_id == user_id).order_by(Workout.id))
    return [w for w in rows.scalars().all() if not is_hidden_program_id(w.program_id)]


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


async def load_recent(db: AsyncSession, user_id: int, limit: int = 40) -> list[int]:
    rows = await db.execute(
        select(WorkoutSession.workout_id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "completed",
            WorkoutSession.workout_id.is_not(None),
        )
        .order_by(WorkoutSession.finished_at.desc(), WorkoutSession.id.desc())
        .limit(limit)
    )
    return [wid for (wid,) in rows]


def cycle_next_index(cycle: list[int], recent: list[int]) -> int:
    n = len(cycle)
    members = set(cycle)
    history = [wid for wid in recent if wid in members]
    if not history:
        return 0
    best_pos, best_score = 0, -1
    for pos in range(n):
        if cycle[pos] != history[0]:
            continue
        score = 0
        while score < len(history) and score < n and history[score] == cycle[(pos - score) % n]:
            score += 1
        if score > best_score:
            best_pos, best_score = pos, score
    return (best_pos + 1) % n


def custom_id(program_id: int) -> str:
    return f"c{program_id}"


def parse_custom_id(active_id: str | None) -> int | None:
    if active_id and active_id.startswith("c") and active_id[1:].isdigit():
        return int(active_id[1:])
    return None


async def load_custom(db: AsyncSession, user_id: int, active_id: str | None) -> CustomProgram | None:
    pid = parse_custom_id(active_id)
    if pid is None:
        return None
    prog = await db.get(CustomProgram, pid)
    return prog if prog and prog.user_id == user_id else None


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
                "measure": i.exercise.measure or "reps",
                "muscles": ", ".join(muscles_for(i.exercise.name, i.exercise.muscle_group, i.exercise.primary, i.exercise.secondary)),
                "sets": i.target_sets,
                "reps": i.target_reps,
                "weight": i.target_weight,
            }
            for i in w.items
        ],
    }


def build_plan(
    active_id: str | None,
    workouts: list[Workout],
    last_done: dict[int, datetime],
    custom: CustomProgram | None = None,
    recent: list[int] | None = None,
) -> dict:
    cycle_days: list[Workout] = []
    if custom:
        by_id = {w.id: w for w in workouts}
        cycle_days = [by_id[d.workout_id] for d in custom.days if d.workout_id in by_id]
        days = list({w.id: w for w in cycle_days}.values())
        meta = {
            "id": custom_id(custom.id),
            "name": custom.name,
            "level": "Своя",
            "description": f"Круг из {len(cycle_days)} тренировок, по порядку и снова сначала.",
            "custom": True,
        }
        in_program = {w.id for w in days}
        own = [w for w in workouts if w.id not in in_program]
    else:
        meta = PROGRAMS_BY_ID.get(active_id) if active_id else None
        days = sorted(
            (w for w in workouts if meta and w.program_id == active_id), key=lambda w: (w.day_index or 0, w.id)
        )
        own = [w for w in workouts if not (meta and w.program_id == active_id)]

    program = None
    if meta and days:
        if custom:
            nxt = cycle_days[cycle_next_index([w.id for w in cycle_days], recent or [])]
        else:
            done = [(last_done[w.id], pos) for pos, w in enumerate(days) if w.id in last_done]
            nxt = days[(max(done)[1] + 1) % len(days)] if done else days[0]
        program = {
            "id": meta["id"],
            "name": meta["name"],
            "level": meta["level"],
            "description": meta["description"],
            "custom": bool(meta.get("custom")),
            "next_workout_id": nxt.id,
            "cycle": [{"workout_id": w.id, "name": w.name} for w in cycle_days],
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
