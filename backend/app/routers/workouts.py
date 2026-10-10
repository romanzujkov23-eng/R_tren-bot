from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_db_ro
from app.models import Exercise, User, Workout, WorkoutExercise
from app.schemas import WorkoutIn, WorkoutOut
from app.security import get_current_user, get_current_user_ro

router = APIRouter()


async def _own(db: AsyncSession, user: User, workout_id: int) -> Workout:
    w = await db.get(Workout, workout_id)
    if not w or w.user_id != user.id:
        raise HTTPException(404, "Тренировка не найдена")
    return w


async def _reload(db: AsyncSession, workout_id: int) -> Workout:
    row = await db.execute(
        select(Workout).where(Workout.id == workout_id).execution_options(populate_existing=True)
    )
    return row.scalar_one()


async def _build_items(db: AsyncSession, user: User, body: WorkoutIn) -> list[WorkoutExercise]:
    ids = {i.exercise_id for i in body.items}
    if ids:
        rows = await db.execute(
            select(Exercise.id).where(
                Exercise.id.in_(ids), Exercise.user_id == user.id, Exercise.is_archived.is_(False)
            )
        )
        if {r[0] for r in rows} != ids:
            raise HTTPException(400, "Среди упражнений есть несуществующие")
    return [
        WorkoutExercise(
            exercise_id=i.exercise_id,
            order_index=idx,
            target_sets=i.target_sets,
            target_reps=i.target_reps,
            target_weight=i.target_weight,
        )
        for idx, i in enumerate(body.items)
    ]


@router.get("", response_model=list[WorkoutOut])
async def list_workouts(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    rows = await db.execute(select(Workout).where(Workout.user_id == user.id).order_by(Workout.id.desc()))
    return rows.scalars().all()


@router.post("", response_model=WorkoutOut, status_code=201)
async def create_workout(
    body: WorkoutIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    w = Workout(user_id=user.id, name=body.name.strip(), description=body.description)
    w.items = await _build_items(db, user, body)
    db.add(w)
    await db.commit()
    return await _reload(db, w.id)


@router.get("/{workout_id}", response_model=WorkoutOut)
async def get_workout(
    workout_id: int, user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)
):
    return await _own(db, user, workout_id)


@router.put("/{workout_id}", response_model=WorkoutOut)
async def update_workout(
    workout_id: int,
    body: WorkoutIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    w = await _own(db, user, workout_id)
    new_items = await _build_items(db, user, body)
    w.name = body.name.strip()
    w.description = body.description
    w.items.clear()
    await db.flush()
    w.items.extend(new_items)
    await db.commit()
    return await _reload(db, w.id)


@router.delete("/{workout_id}", status_code=204)
async def delete_workout(
    workout_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    w = await _own(db, user, workout_id)
    await db.delete(w)
    await db.commit()
