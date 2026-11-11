from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_db_ro
from app.models import CompletedSet, Exercise, User, WorkoutSession
from app.schemas import ExerciseIn, ExerciseOut
from app.catalog import clean_muscles, group_for_muscles, measure_for, norm
from app.security import get_current_user, get_current_user_ro
from app.services import suggest_next

router = APIRouter()


def _measure(body: ExerciseIn, name: str) -> str:
    derived = measure_for(name)
    if derived != "reps":
        return derived
    return body.measure or "reps"


def _muscles(body: ExerciseIn) -> tuple[list[str], list[str], str]:
    primary = clean_muscles(body.primary)
    secondary = [m for m in clean_muscles(body.secondary) if m not in primary]
    return primary, secondary, group_for_muscles(primary, body.muscle_group)


def _apply(ex: Exercise, body: ExerciseIn, measure: str) -> None:
    primary, secondary, group = _muscles(body)
    ex.muscle_group = group
    ex.primary_muscles = ",".join(primary) or None
    ex.secondary_muscles = ",".join(secondary) or None
    ex.measure = measure


async def _own(db: AsyncSession, user: User, exercise_id: int) -> Exercise:
    ex = await db.get(Exercise, exercise_id)
    if not ex or ex.user_id != user.id or ex.is_archived:
        raise HTTPException(404, "Упражнение не найдено")
    return ex


@router.get("", response_model=list[ExerciseOut])
async def list_exercises(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    rows = await db.execute(
        select(Exercise)
        .where(Exercise.user_id == user.id, Exercise.is_archived.is_(False))
        .order_by(Exercise.muscle_group, Exercise.name)
    )
    return rows.scalars().all()


@router.get("/{exercise_id}/suggestion")
async def suggestion(
    exercise_id: int,
    target_reps: int | None = Query(None, ge=1, le=200),
    user: User = Depends(get_current_user_ro),
    db: AsyncSession = Depends(get_db_ro),
):
    ex = await _own(db, user, exercise_id)
    rows = (
        await db.execute(
            select(CompletedSet.weight, CompletedSet.reps, CompletedSet.distance, WorkoutSession.id, WorkoutSession.finished_at)
            .join(WorkoutSession, CompletedSet.session_id == WorkoutSession.id)
            .where(
                WorkoutSession.user_id == user.id,
                WorkoutSession.status == "completed",
                CompletedSet.exercise_id == ex.id,
            )
            .order_by(WorkoutSession.finished_at, CompletedSet.id)
        )
    ).all()
    if not rows:
        return {"best": None, "last": None, "suggested": None}

    last_id, last_at = rows[-1][3], rows[-1][4]
    last_rows = [r for r in rows if r[3] == last_id]
    best_row = max(rows, key=lambda r: (float(r[0]), int(r[1])))
    return {
        "best": {
            "date": best_row[4].isoformat() + "Z",
            "weight": float(best_row[0]),
            "reps": int(best_row[1]),
            "distance": best_row[2],
        },
        "last": {
            "date": last_at.isoformat() + "Z",
            "sets": [{"weight": float(w), "reps": int(r), "distance": d} for w, r, d, _, _ in last_rows],
        },
        "suggested": suggest_next([(float(r[0]), int(r[1])) for r in rows], target_reps, ex.measure or "reps"),
    }


@router.post("", response_model=ExerciseOut, status_code=201)
async def create_exercise(
    body: ExerciseIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    name = body.name.strip()
    measure = _measure(body, name)
    mine = (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars().all()
    same = next((e for e in mine if norm(e.name) == norm(name)), None)
    if same:
        if same.is_archived:
            same.is_archived = False
            _apply(same, body, measure)
            await db.commit()
            await db.refresh(same)
        return same
    ex = Exercise(user_id=user.id, name=name)
    _apply(ex, body, measure)
    db.add(ex)
    await db.commit()
    await db.refresh(ex)
    return ex


@router.put("/{exercise_id}", response_model=ExerciseOut)
async def update_exercise(
    exercise_id: int,
    body: ExerciseIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ex = await _own(db, user, exercise_id)
    ex.name = body.name.strip()
    _apply(ex, body, _measure(body, ex.name))
    await db.commit()
    await db.refresh(ex)
    return ex


@router.delete("/{exercise_id}", status_code=204)
async def delete_exercise(
    exercise_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    ex = await _own(db, user, exercise_id)
    ex.is_archived = True
    await db.commit()
