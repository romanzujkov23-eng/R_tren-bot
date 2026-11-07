from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import PROGRAMS_BY_ID, is_hidden_program_id
from app.database import get_db, get_db_ro
from app.models import CustomProgram, CustomProgramDay, User, Workout
from app.plan import custom_id, parse_custom_id
from app.routers.catalog import release_program_workouts
from app.schemas import CustomProgramIn
from app.security import get_current_user, get_current_user_ro

router = APIRouter()


def _out(p: CustomProgram, workouts: dict[int, Workout], active: str | None) -> dict:
    days = [workouts[d.workout_id] for d in p.days if d.workout_id in workouts]
    return {
        "id": p.id,
        "key": custom_id(p.id),
        "name": p.name,
        "active": active == custom_id(p.id),
        "workout_ids": [w.id for w in days],
        "days": [{"workout_id": w.id, "name": w.name, "exercises": len(w.items)} for w in days],
    }


async def _workouts(db: AsyncSession, user_id: int) -> dict[int, Workout]:
    rows = await db.execute(select(Workout).where(Workout.user_id == user_id))
    return {w.id: w for w in rows.scalars().all() if not is_hidden_program_id(w.program_id)}


async def _own(db: AsyncSession, user: User, program_id: int) -> CustomProgram:
    p = await db.get(CustomProgram, program_id)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Программа не найдена")
    return p


def _validate(body: CustomProgramIn, workouts: dict[int, Workout]) -> list[int]:
    ids = body.workout_ids
    if any(i not in workouts for i in ids):
        raise HTTPException(400, "Среди тренировок есть несуществующие")
    return ids


@router.get("")
async def list_programs(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    rows = await db.execute(
        select(CustomProgram).where(CustomProgram.user_id == user.id).order_by(CustomProgram.id.desc())
    )
    workouts = await _workouts(db, user.id)
    return [_out(p, workouts, user.active_program) for p in rows.scalars().all()]


@router.post("", status_code=201)
async def create_program(
    body: CustomProgramIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    workouts = await _workouts(db, user.id)
    ids = _validate(body, workouts)
    p = CustomProgram(user_id=user.id, name=body.name.strip())
    p.days = [CustomProgramDay(workout_id=wid, position=pos) for pos, wid in enumerate(ids)]
    db.add(p)
    await db.commit()
    return _out(p, workouts, user.active_program)


@router.put("/{program_id}")
async def update_program(
    program_id: int,
    body: CustomProgramIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p = await _own(db, user, program_id)
    workouts = await _workouts(db, user.id)
    ids = _validate(body, workouts)
    p.name = body.name.strip()
    p.days.clear()
    await db.flush()
    p.days.extend(CustomProgramDay(workout_id=wid, position=pos) for pos, wid in enumerate(ids))
    await db.commit()
    await db.refresh(p)
    return _out(p, workouts, user.active_program)


@router.delete("/{program_id}", status_code=204)
async def delete_program(program_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await _own(db, user, program_id)
    if user.active_program == custom_id(p.id):
        user.active_program = None
    await db.delete(p)
    await db.commit()


@router.post("/{program_id}/activate")
async def activate_program(program_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await _own(db, user, program_id)
    if user.active_program in PROGRAMS_BY_ID:
        await release_program_workouts(db, user, {user.active_program})
    user.active_program = custom_id(p.id)
    await db.commit()
    return {"active_program": user.active_program}
