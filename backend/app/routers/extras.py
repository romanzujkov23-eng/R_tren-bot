from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import CATALOG, is_hidden_program_id, measure_for, norm
from app.database import get_db, get_db_ro
from app.extras import program_key
from app.models import BenchProgram, CustomProgramDay, ProgramExtra, User, Workout, WorkoutExercise
from app.security import get_current_user, get_current_user_ro
from app.services import ensure_exercises

router = APIRouter()

CARDIO = [c["name"] for c in CATALOG if c["group"] == "cardio" and measure_for(c["name"]) == "minutes"]


class ExtraIn(BaseModel):
    kind: Literal["bench", "workout", "cardio"]
    workout_id: Optional[int] = None
    exercise: Optional[str] = None
    minutes: int = Field(default=20, ge=1, le=240)


def _out(e: ProgramExtra) -> dict:
    return {"id": e.id, "kind": e.kind, "workout_id": e.workout_id, "position": e.position}


async def _mine(db: AsyncSession, user: User) -> list[ProgramExtra]:
    return list(
        (
            await db.execute(
                select(ProgramExtra)
                .where(ProgramExtra.user_id == user.id, ProgramExtra.program_key == program_key(user))
                .order_by(ProgramExtra.position, ProgramExtra.id)
            )
        ).scalars().all()
    )


@router.get("")
async def list_extras(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    return {"cardio": CARDIO, "extras": [_out(e) for e in await _mine(db, user)]}


@router.post("", status_code=201)
async def add_extra(body: ExtraIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.active_program:
        raise HTTPException(400, "Сначала выберите программу, к которой добавить день")
    mine = await _mine(db, user)
    position = (max((e.position for e in mine), default=-1)) + 1

    if body.kind == "bench":
        active = (
            await db.execute(select(BenchProgram.id).where(BenchProgram.user_id == user.id, BenchProgram.status == "active"))
        ).first()
        if active is None:
            raise HTTPException(400, "Сначала настройте программу жима")
        if any(e.kind == "bench" for e in mine):
            raise HTTPException(409, "День жима уже добавлен в программу")
        extra = ProgramExtra(user_id=user.id, program_key=program_key(user), kind="bench", position=position)
    else:
        if body.kind == "cardio":
            name = body.exercise or ""
            if name not in CARDIO:
                raise HTTPException(400, "Неизвестный вид кардио")
            exs = await ensure_exercises(db, user, [name])
            title = "Кардио: " + name.split(" (")[0]
            workout = Workout(user_id=user.id, name=title, description="Дополнительный день: кардио")
            workout.items = [
                WorkoutExercise(exercise_id=exs[norm(name)].id, exercise=exs[norm(name)], order_index=0, target_sets=1, target_reps=body.minutes)
            ]
            db.add(workout)
            await db.flush()
        else:
            workout = await db.get(Workout, body.workout_id) if body.workout_id else None
            if workout is None or workout.user_id != user.id or is_hidden_program_id(workout.program_id):
                raise HTTPException(404, "Тренировка не найдена")
            if workout.program_id and workout.program_id == user.active_program:
                raise HTTPException(400, "Эта тренировка уже входит в программу")
            in_custom = (
                await db.execute(select(func.count()).select_from(CustomProgramDay).where(CustomProgramDay.workout_id == workout.id))
            ).scalar_one()
            if in_custom and (user.active_program or "").startswith("c"):
                raise HTTPException(400, "Эта тренировка уже входит в программу")
            if any(e.workout_id == workout.id for e in mine):
                raise HTTPException(409, "Этот день уже добавлен в программу")
        extra = ProgramExtra(user_id=user.id, program_key=program_key(user), kind="workout", workout_id=workout.id, position=position)

    db.add(extra)
    await db.commit()
    await db.refresh(extra)
    return _out(extra)


@router.delete("/{extra_id}", status_code=204)
async def remove_extra(extra_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    e = await db.get(ProgramExtra, extra_id)
    if e is None or e.user_id != user.id:
        raise HTTPException(404, "День не найден")
    await db.delete(e)
    await db.commit()
