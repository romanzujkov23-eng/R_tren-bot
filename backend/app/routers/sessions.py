from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_db_ro
from app.models import CompletedSet, Exercise, User, Workout, WorkoutSession, utcnow
from app.schemas import FinishIn, SessionBrief, SessionOut, SessionStart, SetIn, WorkoutItemOut
from app.security import get_current_user, get_current_user_ro
from app.services import duration_since, epley, is_personal_record, recompute_session_totals

router = APIRouter()


async def _own(db: AsyncSession, user: User, session_id: int) -> WorkoutSession:
    s = await db.get(WorkoutSession, session_id)
    if not s or s.user_id != user.id:
        raise HTTPException(404, "Тренировка не найдена")
    return s


async def _reload(db: AsyncSession, session_id: int) -> WorkoutSession:
    row = await db.execute(
        select(WorkoutSession).where(WorkoutSession.id == session_id).execution_options(populate_existing=True)
    )
    return row.scalar_one()


async def _to_out(db: AsyncSession, s: WorkoutSession) -> SessionOut:
    out = SessionOut.model_validate(s)
    if s.workout_id:
        w = await db.get(Workout, s.workout_id)
        if w:
            out.plan = [WorkoutItemOut.model_validate(i) for i in w.items]
    return out


async def _active(db: AsyncSession, user: User) -> WorkoutSession | None:
    rows = await db.execute(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user.id, WorkoutSession.status == "active")
        .order_by(WorkoutSession.id.desc())
    )
    return rows.scalars().first()


@router.post("", response_model=SessionOut, status_code=201)
async def start_session(
    body: SessionStart, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    existing = await _active(db, user)
    if existing:
        return await _to_out(db, existing)

    name = (body.name or "").strip() or "Свободная тренировка"
    workout_id = None
    if body.workout_id:
        w = await db.get(Workout, body.workout_id)
        if not w or w.user_id != user.id:
            raise HTTPException(404, "Шаблон тренировки не найден")
        workout_id, name = w.id, w.name

    s = WorkoutSession(user_id=user.id, workout_id=workout_id, name=name)
    db.add(s)
    await db.commit()
    return await _to_out(db, await _reload(db, s.id))


@router.get("/active", response_model=SessionOut | None)
async def get_active(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    s = await _active(db, user)
    return await _to_out(db, s) if s else None


@router.get("", response_model=list[SessionBrief])
async def history(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user_ro),
    db: AsyncSession = Depends(get_db_ro),
):
    rows = await db.execute(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user.id, WorkoutSession.status == "completed")
        .order_by(WorkoutSession.finished_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return rows.scalars().all()


@router.get("/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: int, user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)
):
    return await _to_out(db, await _own(db, user, session_id))


@router.post("/{session_id}/sets", response_model=SessionOut, status_code=201)
async def add_set(
    session_id: int,
    body: SetIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _own(db, user, session_id)
    if s.status != "active":
        raise HTTPException(400, "Тренировка уже завершена")

    ex = await db.get(Exercise, body.exercise_id)
    if not ex or ex.user_id != user.id or ex.is_archived:
        raise HTTPException(404, "Упражнение не найдено")

    est = epley(body.weight, body.reps)
    pr = await is_personal_record(db, user.id, ex.id, body.weight, body.reps, est)
    number = sum(1 for x in s.sets if x.exercise_id == ex.id) + 1

    s.sets.append(
        CompletedSet(
            exercise_id=ex.id,
            set_number=number,
            reps=body.reps,
            weight=body.weight,
            rpe=body.rpe,
            volume=round(body.weight * body.reps, 1),
            est_1rm=est,
            is_pr=pr,
        )
    )
    recompute_session_totals(s)
    await db.commit()
    return await _to_out(db, await _reload(db, s.id))


@router.delete("/{session_id}/sets/{set_id}", response_model=SessionOut)
async def delete_set(
    session_id: int,
    set_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _own(db, user, session_id)
    if s.status != "active":
        raise HTTPException(400, "Тренировка уже завершена")
    target = next((x for x in s.sets if x.id == set_id), None)
    if not target:
        raise HTTPException(404, "Подход не найден")
    s.sets.remove(target)
    await db.flush()
    counter: dict[int, int] = {}
    for x in s.sets:
        counter[x.exercise_id] = counter.get(x.exercise_id, 0) + 1
        x.set_number = counter[x.exercise_id]
    recompute_session_totals(s)
    await db.commit()
    return await _to_out(db, await _reload(db, s.id))


@router.post("/{session_id}/finish", response_model=SessionOut)
async def finish(
    session_id: int,
    body: FinishIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _own(db, user, session_id)
    if s.status == "active":
        s.status = "completed"
        s.finished_at = utcnow()
        s.duration_seconds = duration_since(s.started_at)
        s.feeling = body.feeling
        s.note = body.note
        recompute_session_totals(s)
        await db.commit()
        s = await _reload(db, s.id)
        return await _to_out(db, s)
    return await _to_out(db, s)


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    s = await _own(db, user, session_id)
    await db.delete(s)
    await db.commit()
