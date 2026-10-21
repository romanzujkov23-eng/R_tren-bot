from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import is_hidden_program_id
from app.database import get_db, get_db_ro
from app.models import CustomProgram, CustomProgramDay, Exercise, User, Workout, WorkoutExercise
from app.plan import custom_id
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
    return [w for w in rows.scalars().all() if not is_hidden_program_id(w.program_id)]


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
    touched = set(
        (await db.execute(select(CustomProgramDay.program_id).where(CustomProgramDay.workout_id == w.id))).scalars().all()
    )
    await db.execute(delete(CustomProgramDay).where(CustomProgramDay.workout_id == w.id))
    await db.delete(w)
    await db.flush()
    for pid in touched:
        left = (
            await db.execute(select(func.count()).select_from(CustomProgramDay).where(CustomProgramDay.program_id == pid))
        ).scalar_one()
        if left == 0:
            prog = await db.get(CustomProgram, pid)
            if prog:
                if user.active_program == custom_id(pid):
                    user.active_program = None
                await db.delete(prog)
    await db.commit()
