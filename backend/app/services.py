from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import CATALOG_BY_NAME, is_hidden_program_id, measure_for, norm
from app.models import CompletedSet, Exercise, User, WorkoutSession, utcnow

DEFAULT_EXERCISES = [
    ("Жим штанги лёжа", "chest"),
    ("Жим гантелей на наклонной скамье", "chest"),
    ("Отжимания на брусьях", "chest"),
    ("Подтягивания", "back"),
    ("Тяга штанги в наклоне", "back"),
    ("Тяга верхнего блока", "back"),
    ("Становая тяга", "back"),
    ("Приседания со штангой", "legs"),
    ("Жим ногами", "legs"),
    ("Румынская тяга", "legs"),
    ("Выпады с гантелями", "legs"),
    ("Жим штанги стоя", "shoulders"),
    ("Махи гантелей в стороны", "shoulders"),
    ("Подъём штанги на бицепс", "arms"),
    ("Французский жим", "arms"),
    ("Скручивания", "core"),
    ("Планка (секунды)", "core"),
    ("Бег (минуты)", "cardio"),
]


async def seed_exercises(db: AsyncSession, user: User) -> None:
    db.add_all(Exercise(user_id=user.id, name=n, muscle_group=g, measure=measure_for(n)) for n, g in DEFAULT_EXERCISES)
    await db.commit()


async def ensure_exercises(db: AsyncSession, user: User, names: list[str]) -> dict[str, Exercise]:
    mine = {
        norm(e.name): e
        for e in (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars()
    }
    for name in names:
        key = norm(name)
        ex = mine.get(key)
        if ex is None:
            item = CATALOG_BY_NAME.get(key)
            ex = Exercise(
                user_id=user.id, name=name, muscle_group=item["group"] if item else "other", measure=measure_for(name)
            )
            db.add(ex)
            await db.flush()
            mine[key] = ex
        elif ex.is_archived:
            ex.is_archived = False
    return mine


def epley(weight: float, reps: int) -> float:
    if weight <= 0:
        return 0.0
    if reps <= 1:
        return round(weight, 1)
    return round(weight * (1 + reps / 30), 1)


async def is_personal_record(
    db: AsyncSession, user_id: int, exercise_id: int, weight: float, reps: int, est: float, measure: str = "reps"
) -> bool:
    base = (
        select(func.count(CompletedSet.id), func.max(CompletedSet.est_1rm), func.max(CompletedSet.reps))
        .join(WorkoutSession, WorkoutSession.id == CompletedSet.session_id)
        .where(WorkoutSession.user_id == user_id, CompletedSet.exercise_id == exercise_id)
    )
    if measure != "reps":
        base = base.where(CompletedSet.weight <= weight)
    count, best_1rm, best_reps = (await db.execute(base)).one()
    if not count:
        return False
    if measure != "reps":
        return reps > (best_reps or 0)
    if weight > 0:
        return est > (best_1rm or 0)
    return reps > (best_reps or 0)


def recompute_session_totals(session: WorkoutSession) -> None:
    session.total_sets = len(session.sets)
    session.total_reps = sum(s.reps for s in session.sets if (s.exercise.measure or "reps") == "reps")
    session.total_volume = round(sum(s.volume for s in session.sets), 1)


def duration_since(start: datetime) -> int:
    return max(0, int((utcnow() - start).total_seconds()))


async def export_user_data(db: AsyncSession, user: User) -> dict:
    from app.models import Exercise, Workout

    exercises = (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars().all()
    workouts = [
        w
        for w in (await db.execute(select(Workout).where(Workout.user_id == user.id))).scalars().all()
        if not is_hidden_program_id(w.program_id)
    ]
    sessions = (
        (await db.execute(select(WorkoutSession).where(WorkoutSession.user_id == user.id).order_by(WorkoutSession.id)))
        .scalars()
        .all()
    )
    from app.models import BodyMeasurement

    body = (
        (await db.execute(select(BodyMeasurement).where(BodyMeasurement.user_id == user.id).order_by(BodyMeasurement.id)))
        .scalars()
        .all()
    )
    from app.models import DayMark

    diary = (
        (await db.execute(select(DayMark).where(DayMark.user_id == user.id).order_by(DayMark.day, DayMark.slot)))
        .scalars()
        .all()
    )
    from app.models import Goal

    goals = (await db.execute(select(Goal).where(Goal.user_id == user.id).order_by(Goal.id))).scalars().all()
    names = {e.id: e.name for e in exercises}
    iso = lambda d: d.isoformat() + "Z" if d else None
    return {
        "exported_at": iso(utcnow()),
        "user": {"telegram_id": user.telegram_id, "username": user.username, "first_name": user.first_name},
        "exercises": [
            {"name": e.name, "muscle_group": e.muscle_group, "measure": e.measure, "archived": e.is_archived}
            for e in exercises
        ],
        "workouts": [
            {
                "name": w.name,
                "description": w.description,
                "items": [
                    {"exercise": i.exercise.name, "sets": i.target_sets, "reps": i.target_reps, "weight": i.target_weight}
                    for i in w.items
                ],
            }
            for w in workouts
        ],
        "diary": [
            {
                "day": d.day.isoformat(), "slot": d.slot, "kind": d.kind, "subtype": d.subtype,
                "emoji": d.emoji, "color": d.color, "label": d.label, "counts": d.counts, "note": d.note,
            }
            for d in diary
        ],
        "goals": [
            {"kind": g.kind, "exercise": names.get(g.exercise_id), "metric": g.metric, "target": g.target,
             "start": g.start_value, "deadline": g.deadline.isoformat() if g.deadline else None,
             "achieved_at": iso(g.achieved_at)}
            for g in goals
        ],
        "body_measurements": [
            {"date": iso(b.measured_at), "weight": b.weight, "waist": b.waist, "chest": b.chest,
             "hips": b.hips, "arm": b.arm, "thigh": b.thigh}
            for b in body
        ],
        "sessions": [
            {
                "name": s.name,
                "status": s.status,
                "started_at": iso(s.started_at),
                "finished_at": iso(s.finished_at),
                "duration_seconds": s.duration_seconds,
                "feeling": s.feeling,
                "note": s.note,
                "sets": [
                    {
                        "exercise": names.get(x.exercise_id, str(x.exercise_id)),
                        "set_number": x.set_number,
                        "reps": x.reps,
                        "weight": x.weight,
                        "distance": x.distance,
                        "est_1rm": x.est_1rm,
                        "is_pr": x.is_pr,
                    }
                    for x in s.sets
                ],
            }
            for s in sessions
        ],
    }


def suggest_timed(sets: list[tuple[float, int]], target: int | None, measure: str) -> dict:
    weight = max(w for w, _ in sets)
    best = max(r for w, r in sets if w == weight)
    step = 5 if measure == "seconds" else 1
    unit = "секунд" if measure == "seconds" else "минуту"
    if target and best >= target:
        return {"weight": weight, "reps": target, "reason": "по плану"}
    nxt = min(best + step, target) if target else best + step
    reason = f"на {step} {unit} дольше, чем в прошлый раз"
    return {"weight": weight, "reps": nxt, "reason": reason}


def suggest_next(sets: list[tuple[float, int]], target_reps: int | None, measure: str = "reps") -> dict:
    if measure != "reps":
        return suggest_timed(sets, target_reps, measure)
    top_w = max(w for w, _ in sets)
    min_reps = min(r for w, r in sets if w == top_w)
    low, high = (target_reps, target_reps) if target_reps else (8, 12)
    step = 2.5

    if top_w == 0:
        return {"weight": 0.0, "reps": min_reps + 1, "reason": "на 1 повторение больше, чем в прошлый раз"}
    if min_reps >= high:
        return {
            "weight": round(top_w + step, 2),
            "reps": low,
            "reason": f"прошлый раз всё выполнено - добавляем {step:g} кг",
        }
    return {"weight": top_w, "reps": min(min_reps + 1, high), "reason": "тот же вес, на 1 повторение больше"}
