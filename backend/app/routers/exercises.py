from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_db_ro
from app.models import CompletedSet, Exercise, User, WorkoutSession
from app.schemas import ExerciseIn, ExerciseOut
from app.catalog import norm
from app.security import get_current_user, get_current_user_ro
from app.services import suggest_next

router = APIRouter()


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
    last = (
        await db.execute(
            select(WorkoutSession.id, WorkoutSession.finished_at)
            .join(CompletedSet, CompletedSet.session_id == WorkoutSession.id)
            .where(
                WorkoutSession.user_id == user.id,
                WorkoutSession.status == "completed",
                CompletedSet.exercise_id == ex.id,
            )
            .order_by(WorkoutSession.finished_at.desc())
            .limit(1)
        )
    ).first()
    if not last:
        return {"last": None, "suggested": None}

    rows = (
        await db.execute(
            select(CompletedSet.weight, CompletedSet.reps)
            .where(CompletedSet.session_id == last[0], CompletedSet.exercise_id == ex.id)
            .order_by(CompletedSet.id)
        )
    ).all()
    pairs = [(float(w), int(r)) for w, r in rows]
    return {
        "last": {"date": last[1].isoformat() + "Z", "sets": [{"weight": w, "reps": r} for w, r in pairs]},
        "suggested": suggest_next(pairs, target_reps),
    }


@router.post("", response_model=ExerciseOut, status_code=201)
async def create_exercise(
    body: ExerciseIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    name = body.name.strip()
    mine = (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars().all()
    same = next((e for e in mine if norm(e.name) == norm(name)), None)
    if same:
        if same.is_archived:
            same.is_archived = False
            same.muscle_group = body.muscle_group
            await db.commit()
            await db.refresh(same)
        return same
    ex = Exercise(user_id=user.id, name=name, muscle_group=body.muscle_group)
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
    ex.muscle_group = body.muscle_group
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
