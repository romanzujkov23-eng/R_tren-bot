from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import reminders
from app.database import get_db, get_db_ro
from app.models import (
    BodyMeasurement, CompletedSet, DayMark, DiaryEntry, Exercise, Goal, User, Workout, WorkoutExercise, WorkoutSession,
)
from app.schemas import ReminderIn, UserOut, UserUpdate
from app.security import get_current_user, get_current_user_ro
from app.services import export_user_data

router = APIRouter()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user_ro)):
    return user


@router.get("/me/export")
async def export_me(user: User = Depends(get_current_user_ro), db: AsyncSession = Depends(get_db_ro)):
    return await export_user_data(db, user)


@router.put("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    data = body.model_dump(exclude_unset=True)
    if data.get("timezone"):
        try:
            ZoneInfo(data["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            data.pop("timezone")
    for field, value in data.items():
        if value is not None:
            setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    if "timezone" in data:
        reminders.update_schedule(user)
    return user


@router.put("/me/reminders", response_model=UserOut)
async def set_reminders(
    body: ReminderIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    if body.enabled and not body.days:
        raise HTTPException(400, "Выберите хотя бы один день недели")

    if body.enabled:
        from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError

        try:
            await reminders.send_text(
                user.telegram_id,
                f"Напоминания включены. Буду писать в {body.time} по вашему времени.",
                with_button=False,
            )
        except TelegramForbiddenError:
            raise HTTPException(400, "Бот не может вам писать. Откройте чат с ботом, нажмите Start и повторите.")
        except (TelegramAPIError, RuntimeError):
            raise HTTPException(400, "Не удалось отправить сообщение через Telegram. Попробуйте позже.")

    user.reminder_enabled = body.enabled
    user.reminder_time = body.time
    user.reminder_days = ",".join(str(d) for d in body.days)
    user.reminder_last_date = None
    await db.commit()
    await db.refresh(user)
    reminders.update_schedule(user)
    return user


@router.delete("/me", status_code=204)
async def delete_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sess_ids = select(WorkoutSession.id).where(WorkoutSession.user_id == user.id)
    work_ids = select(Workout.id).where(Workout.user_id == user.id)
    await db.execute(delete(CompletedSet).where(CompletedSet.session_id.in_(sess_ids)))
    await db.execute(delete(WorkoutSession).where(WorkoutSession.user_id == user.id))
    await db.execute(delete(WorkoutExercise).where(WorkoutExercise.workout_id.in_(work_ids)))
    await db.execute(delete(Workout).where(Workout.user_id == user.id))
    await db.execute(delete(Exercise).where(Exercise.user_id == user.id))
    await db.execute(delete(Goal).where(Goal.user_id == user.id))
    await db.execute(delete(DayMark).where(DayMark.user_id == user.id))
    await db.execute(delete(DiaryEntry).where(DiaryEntry.user_id == user.id))
    await db.execute(delete(BodyMeasurement).where(BodyMeasurement.user_id == user.id))
    reminders.remove_from_schedule(user.id)
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
