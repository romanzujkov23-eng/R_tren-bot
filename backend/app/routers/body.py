from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_db_ro
from app.streaks import get_tz
from app.models import BodyMeasurement, User
from app.schemas import BodyIn, BodyOut
from app.security import get_current_user, get_current_user_ro

router = APIRouter()


@router.get("", response_model=list[BodyOut])
async def list_body(
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user_ro),
    db: AsyncSession = Depends(get_db_ro),
):
    rows = await db.execute(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == user.id)
        .order_by(BodyMeasurement.measured_at.desc(), BodyMeasurement.id.desc())
        .limit(limit)
    )
    return rows.scalars().all()


@router.post("", response_model=BodyOut, status_code=201)
async def add_body(body: BodyIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    values = body.model_dump(exclude={"day"})
    if all(v is None for v in values.values()):
        raise HTTPException(400, "Введите хотя бы одно значение")
    extra = {}
    if body.day:
        local_today = datetime.now(timezone.utc).astimezone(get_tz(user.timezone)).date()
        if body.day > local_today + timedelta(days=1):
            raise HTTPException(400, "Нельзя записать замер в будущем")
        extra["measured_at"] = datetime.combine(body.day, time(12, 0))
    entry = BodyMeasurement(user_id=user.id, **values, **extra)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
async def delete_body(entry_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    e = await db.get(BodyMeasurement, entry_id)
    if not e or e.user_id != user.id:
        raise HTTPException(404, "Запись не найдена")
    await db.delete(e)
    await db.commit()
