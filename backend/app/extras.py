"""Дополнительные дни в круге программы: умный день жима и любые свои тренировки (кардио и т.д.)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import bench as B
from app.catalog import muscles_for, norm
import json

from app.models import Exercise, ProgramExtra, ProgramOrder, User, Workout
from app.plan import ExtraView


def program_key(user: User) -> str:
    return user.active_program or ""


async def bench_summary(db: AsyncSession, user: User) -> dict | None:
    """Краткое описание следующего дня жима для карточки в плане."""
    from app.routers.bench import _active_program, compute  # локально, чтобы не было цикла импортов

    prog = await _active_program(db, user)
    if prog is None:
        return None
    c = await compute(db, user, prog)
    plan = c["next_plan"]
    mine = (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars().all()
    by_name = {norm(e.name): e for e in mine}

    def row(name: str, sets: int, reps: int, weight: float | None) -> dict:
        e = by_name.get(norm(name))
        return {
            "exercise_id": e.id if e else 0,
            "name": name,
            "muscle_group": e.muscle_group if e else "chest",
            "measure": "reps",
            "muscles": ", ".join(muscles_for(e.name, e.muscle_group, e.primary, e.secondary)) if e else "",
            "sets": sets,
            "reps": reps,
            "weight": weight,
        }

    base = {"e1rm": c["e1rm"], "done": c["done"], "total": c["total"]}
    if plan is None:
        return {"title": "Жим лёжа: цикл завершён", "exercises": [], "info": {**base, "complete": True, "week": B.WEEKS, "day": 0, "phase": "Тест"}}
    sets = plan["sets"]
    exercises = [row(plan["main"], len(sets), sets[0]["reps"], sets[0]["weight"])]
    sec = plan.get("secondary")
    if sec:
        exercises.append(row(sec["name"], len(sec["sets"]), sec["sets"][0]["reps"], sec["sets"][0]["weight"]))
    exercises += [row(a["name"], a["sets"], a["reps"], None) for a in plan["accessories"]]
    return {
        "title": f"Жим лёжа: {plan['title'].lower()}",
        "exercises": exercises,
        "info": {**base, "complete": False, "week": plan["week"], "day": plan["day"], "phase": plan["phase"]},
    }


async def load_extras(db: AsyncSession, user: User) -> list[ExtraView]:
    rows = (
        await db.execute(
            select(ProgramExtra)
            .where(ProgramExtra.user_id == user.id, ProgramExtra.program_key == program_key(user))
            .order_by(ProgramExtra.position, ProgramExtra.id)
        )
    ).scalars().all()
    if not rows:
        return []
    ids = [r.workout_id for r in rows if r.kind == "workout" and r.workout_id]
    workouts: dict[int, Workout] = {}
    if ids:
        found = (await db.execute(select(Workout).where(Workout.id.in_(ids), Workout.user_id == user.id))).scalars().all()
        workouts = {w.id: w for w in found}
    bench = await bench_summary(db, user) if any(r.kind == "bench" for r in rows) else None
    out: list[ExtraView] = []
    for r in rows:
        if r.kind == "workout" and r.workout_id in workouts:
            out.append(ExtraView(id=r.id, kind="workout", workout=workouts[r.workout_id]))
        elif r.kind == "bench" and bench is not None:
            out.append(ExtraView(id=r.id, kind="bench", bench=bench))
    return out


async def load_order(db: AsyncSession, user: User) -> list[str]:
    row = (
        await db.execute(
            select(ProgramOrder).where(ProgramOrder.user_id == user.id, ProgramOrder.program_key == program_key(user)).order_by(ProgramOrder.id.desc())
        )
    ).scalars().first()
    if row is None:
        return []
    try:
        data = json.loads(row.order_json)
    except ValueError:
        return []
    return [k for k in data if isinstance(k, str)] if isinstance(data, list) else []
