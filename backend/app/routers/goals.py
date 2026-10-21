from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, run_parallel
from app.models import BodyMeasurement, CompletedSet, Exercise, Goal, User, WorkoutSession, utcnow
from app.schemas import GoalIn
from app.security import get_current_user
from app.streaks import diary_days, finished_times, get_tz, workout_days

router = APIRouter()

MAX_GOALS = 30


async def _latest_weight(db: AsyncSession, user_id: int) -> float | None:
    row = await db.execute(
        select(BodyMeasurement.weight)
        .where(BodyMeasurement.user_id == user_id, BodyMeasurement.weight.is_not(None))
        .order_by(BodyMeasurement.measured_at.desc(), BodyMeasurement.id.desc())
        .limit(1)
    )
    return row.scalar_one_or_none()


async def _bests(db: AsyncSession, user_id: int, ids: set[int]) -> dict[int, tuple[float, int]]:
    if not ids:
        return {}
    rows = await db.execute(
        select(CompletedSet.exercise_id, func.max(CompletedSet.weight), func.max(CompletedSet.reps))
        .join(WorkoutSession, WorkoutSession.id == CompletedSet.session_id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "completed",
            CompletedSet.exercise_id.in_(ids),
        )
        .group_by(CompletedSet.exercise_id)
    )
    return {r[0]: (float(r[1] or 0), int(r[2] or 0)) for r in rows}


def _num(x: float) -> float:
    return int(x) if float(x).is_integer() else round(float(x), 1)


def evaluate(g: Goal, weight: float | None, bests: dict[int, tuple[float, int]], month_days: int, ex_name: str | None) -> dict:
    unit = "кг"
    if g.kind == "body_weight":
        start = g.start_value if g.start_value is not None else (weight or g.target)
        cur = weight if weight is not None else start
        span = g.target - start
        if span == 0:
            progress = 1.0 if cur == g.target else 0.0
        else:
            progress = (cur - start) / span
        progress = max(0.0, min(1.0, progress))
        achieved = (cur <= g.target) if span < 0 else (cur >= g.target)
        title = f"Вес {_num(g.target)} кг"
    elif g.kind == "lift":
        w, r = bests.get(g.exercise_id or 0, (0.0, 0))
        cur = w if g.metric == "weight" else float(r)
        unit = "кг" if g.metric == "weight" else "повт."
        progress = max(0.0, min(1.0, cur / g.target))
        achieved = cur >= g.target
        what = f"{_num(g.target)} кг" if g.metric == "weight" else f"{_num(g.target)} повторов"
        title = f"{ex_name or 'Упражнение'}: {what}"
    else:
        cur = float(month_days)
        unit = "дн."
        progress = max(0.0, min(1.0, cur / g.target))
        achieved = cur >= g.target
        title = f"{_num(g.target)} тренировок в месяц"
    return {
        "id": g.id,
        "kind": g.kind,
        "title": title,
        "exercise_id": g.exercise_id,
        "exercise_name": ex_name,
        "metric": g.metric,
        "target": _num(g.target),
        "start": _num(g.start_value) if g.start_value is not None else None,
        "current": _num(cur),
        "unit": unit,
        "progress": round(progress, 4),
        "achieved": achieved,
        "achieved_at": (g.achieved_at.isoformat() + "Z") if g.achieved_at else None,
        "deadline": g.deadline.isoformat() if g.deadline else None,
        "created_at": g.created_at.isoformat() + "Z",
    }


@router.get("")
async def list_goals(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    goals = (await db.execute(select(Goal).where(Goal.user_id == user.id).order_by(Goal.id.desc()))).scalars().all()
    if not goals:
        return []
    uid = user.id
    ids = {g.exercise_id for g in goals if g.kind == "lift" and g.exercise_id}
    tz = get_tz(user.timezone)
    today = datetime.now(timezone.utc).astimezone(tz).date()

    weight, bests, finished, days = await run_parallel(
        lambda s: _latest_weight(s, uid),
        lambda s: _bests(s, uid, ids),
        lambda s: finished_times(s, uid),
        lambda s: diary_days(s, uid),
    )
    month_days = sum(1 for d in workout_days(finished, days, tz) if (d.year, d.month) == (today.year, today.month))
    names = {}
    if ids:
        rows = await db.execute(select(Exercise.id, Exercise.name).where(Exercise.id.in_(ids)))
        names = {r[0]: r[1] for r in rows}

    out, changed = [], False
    for g in goals:
        item = evaluate(g, weight, bests, month_days, names.get(g.exercise_id or 0))
        if g.kind != "monthly" and item["achieved"] and not g.achieved_at:
            g.achieved_at = utcnow()
            item["achieved_at"] = g.achieved_at.isoformat() + "Z"
            changed = True
        if g.kind != "monthly" and g.achieved_at:
            item["achieved"] = True
        out.append(item)
    if changed:
        await db.commit()
    out.sort(key=lambda x: (x["achieved"], -x["id"]))
    return out


@router.post("", status_code=201)
async def create_goal(body: GoalIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count = (await db.execute(select(func.count(Goal.id)).where(Goal.user_id == user.id))).scalar_one()
    if count >= MAX_GOALS:
        raise HTTPException(400, "Слишком много целей. Удалите ненужные.")
    tz = get_tz(user.timezone)
    if body.deadline and body.deadline < datetime.now(timezone.utc).astimezone(tz).date() - timedelta(days=1):
        raise HTTPException(400, "Срок уже прошёл")

    start: float | None = None
    exercise_id = None
    if body.kind == "body_weight":
        start = await _latest_weight(db, user.id)
        if start is None:
            raise HTTPException(400, "Сначала запишите свой вес во вкладке «Замеры тела»")
        if start == body.target:
            raise HTTPException(400, "Цель совпадает с текущим весом")
    elif body.kind == "lift":
        ex = await db.get(Exercise, body.exercise_id)
        if not ex or ex.user_id != user.id or ex.is_archived:
            raise HTTPException(404, "Упражнение не найдено")
        exercise_id = ex.id
        w, r = (await _bests(db, user.id, {ex.id})).get(ex.id, (0.0, 0))
        start = w if body.metric == "weight" else float(r)

    g = Goal(
        user_id=user.id, kind=body.kind, exercise_id=exercise_id, metric=body.metric if body.kind == "lift" else "weight",
        target=body.target, start_value=start, deadline=body.deadline,
    )
    db.add(g)
    await db.commit()
    return {"id": g.id}


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    g = await db.get(Goal, goal_id)
    if not g or g.user_id != user.id:
        raise HTTPException(404, "Цель не найдена")
    await db.delete(g)
    await db.commit()
