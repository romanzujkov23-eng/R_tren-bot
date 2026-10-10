from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import run_parallel
from app.models import DayMark, User, WorkoutSession


def get_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def to_local_date(dt_utc_naive: datetime, tz: ZoneInfo) -> date:
    return dt_utc_naive.replace(tzinfo=timezone.utc).astimezone(tz).date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def workout_days(finished: list[datetime], diary_days: list[date], tz: ZoneInfo) -> set[date]:
    return {to_local_date(f, tz) for f in finished if f} | set(diary_days)


def counts_by_week(days: set[date]) -> dict[date, int]:
    counts: dict[date, int] = {}
    for d in days:
        w = week_start(d)
        counts[w] = counts.get(w, 0) + 1
    return counts


def compute_streak(counts: dict[date, int], goal: int, today: date) -> tuple[int, int]:
    this_week = week_start(today)
    cur = 0
    w = this_week if counts.get(this_week, 0) >= goal else this_week - timedelta(weeks=1)
    while counts.get(w, 0) >= goal:
        cur += 1
        w -= timedelta(weeks=1)

    best = run = 0
    prev: date | None = None
    for w in sorted(k for k, v in counts.items() if v >= goal):
        run = run + 1 if prev is not None and w - prev == timedelta(weeks=1) else 1
        best = max(best, run)
        prev = w
    return cur, max(best, cur)


def streak_from(finished: list[datetime], diary_days: list[date], user: User) -> dict:
    tz = get_tz(user.timezone)
    counts = counts_by_week(workout_days(finished, diary_days, tz))
    goal = user.weekly_goal or 3
    today = datetime.now(tz).date()
    cur, best = compute_streak(counts, goal, today)
    return {"weekly_goal": goal, "this_week": counts.get(week_start(today), 0), "current": cur, "best": best}


async def finished_times(db: AsyncSession, user_id: int) -> list[datetime]:
    rows = await db.execute(
        select(WorkoutSession.finished_at).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == "completed",
            WorkoutSession.finished_at.is_not(None),
        )
    )
    return [r[0] for r in rows]


async def diary_days(db: AsyncSession, user_id: int) -> list[date]:
    rows = await db.execute(select(DayMark.day).where(DayMark.user_id == user_id, DayMark.counts.is_(True)).distinct())
    return [r[0] for r in rows]


async def streak_info(db: AsyncSession, user: User) -> dict:
    finished, days = await run_parallel(lambda s: finished_times(s, user.id), lambda s: diary_days(s, user.id))
    return streak_from(finished, days, user)
