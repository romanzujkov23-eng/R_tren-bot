from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.streaks import get_tz, streak_info, to_local_date
from app.database import get_db, run_parallel
from app.models import DayMark, User, WorkoutSession
from app.schemas import DiaryIn, DiaryOut
from app.security import get_current_user, get_current_user_ro

router = APIRouter()


@router.get("")
async def month_view(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM"),
    user: User = Depends(get_current_user_ro),
):
    year, mon = int(month[:4]), int(month[5:])
    first = date(year, mon, 1)
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    tz = get_tz(user.timezone)
    uid = user.id
    lo = datetime.combine(first - timedelta(days=1), datetime.min.time())
    hi = datetime.combine(last + timedelta(days=2), datetime.min.time())

    async def entries(db):
        rows = await db.execute(
            select(DayMark).where(DayMark.user_id == uid, DayMark.day >= first, DayMark.day <= last)
            .order_by(DayMark.day, DayMark.slot)
        )
        return rows.scalars().all()

    async def sessions(db):
        rows = await db.execute(
            select(
                WorkoutSession.id, WorkoutSession.name, WorkoutSession.finished_at, WorkoutSession.total_sets,
                WorkoutSession.duration_seconds, WorkoutSession.total_volume, WorkoutSession.feeling, WorkoutSession.note,
            )
            .where(
                WorkoutSession.user_id == uid,
                WorkoutSession.status == "completed",
                WorkoutSession.finished_at >= lo,
                WorkoutSession.finished_at < hi,
            )
            .order_by(WorkoutSession.finished_at)
        )
        return rows.all()

    diary, sess, streak = await run_parallel(entries, sessions, lambda s: streak_info(s, user))

    workouts = []
    for r in sess:
        d = to_local_date(r.finished_at, tz)
        if first <= d <= last:
            workouts.append(
                {
                    "id": r.id,
                    "day": d.isoformat(),
                    "name": r.name,
                    "sets": r.total_sets,
                    "minutes": round((r.duration_seconds or 0) / 60),
                    "volume": round(float(r.total_volume or 0), 1),
                    "feeling": r.feeling,
                    "note": r.note,
                }
            )
    marked = {e.day for e in diary if e.counts} | {date.fromisoformat(w["day"]) for w in workouts}
    return {
        "month": month,
        "entries": [DiaryOut.model_validate(e).model_dump(mode="json") for e in diary],
        "workouts": workouts,
        "marked_days": len(marked),
        "streak": streak,
    }


def _local_today(user: User) -> date:
    return datetime.now(timezone.utc).astimezone(get_tz(user.timezone)).date()


def _clean(body: DiaryIn) -> dict:
    note = (body.note or "").strip() or None
    if body.kind == "custom":
        return {
            "kind": "custom",
            "subtype": None,
            "emoji": (body.emoji or "").strip() or None,
            "color": body.color.lower() if body.color else None,
            "label": (body.label or "").strip() or None,
            "counts": body.counts,
            "note": note,
        }
    return {
        "kind": body.kind,
        "subtype": body.subtype,
        "emoji": None,
        "color": None,
        "label": None,
        "counts": True,
        "note": note,
    }


@router.put("/{day}", response_model=DiaryOut)
async def mark_day(
    day: date, body: DiaryIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    if day > _local_today(user) + timedelta(days=1):
        raise HTTPException(400, "Нельзя отметить тренировку в будущем")
    entry = (
        await db.execute(
            select(DayMark).where(DayMark.user_id == user.id, DayMark.day == day, DayMark.slot == body.slot)
        )
    ).scalar_one_or_none()
    values = _clean(body)
    if entry:
        for k, v in values.items():
            setattr(entry, k, v)
    else:
        entry = DayMark(user_id=user.id, day=day, slot=body.slot, **values)
        db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{day}", status_code=204)
async def unmark_day(
    day: date,
    slot: int | None = Query(None, ge=0, le=1, description="Какую отметку убрать; без параметра - все за день"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = delete(DayMark).where(DayMark.user_id == user.id, DayMark.day == day)
    if slot is not None:
        q = q.where(DayMark.slot == slot)
    await db.execute(q)
    await db.commit()
