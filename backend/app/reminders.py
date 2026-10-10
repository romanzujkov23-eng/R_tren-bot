
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.streaks import get_tz, streak_info, to_local_date
from app.database import AsyncSessionLocal
from app.models import DayMark, User, WorkoutSession

log = logging.getLogger(__name__)

CATCH_UP_WINDOW = timedelta(hours=3)


@dataclass
class Entry:
    user_id: int
    telegram_id: int
    tz: str
    days: set[int]
    hour: int
    minute: int
    last_date: str | None


_schedule: dict[int, Entry] = {}


def parse_days(raw: str | None) -> set[int]:
    return {int(x) for x in (raw or "").split(",") if x.strip().isdigit() and 0 <= int(x) <= 6}


def update_schedule(user: User) -> None:
    if not user.reminder_enabled:
        _schedule.pop(user.id, None)
        return
    try:
        hour, minute = (int(x) for x in (user.reminder_time or "18:00").split(":"))
    except ValueError:
        hour, minute = 18, 0
    _schedule[user.id] = Entry(
        user.id, user.telegram_id, user.timezone or "UTC", parse_days(user.reminder_days), hour, minute,
        user.reminder_last_date,
    )


def remove_from_schedule(user_id: int) -> None:
    _schedule.pop(user_id, None)


async def load_schedule() -> int:
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User).where(User.reminder_enabled.is_(True)))).scalars().all()
    _schedule.clear()
    for u in users:
        update_schedule(u)
    return len(_schedule)


async def send_text(telegram_id: int, text: str, with_button: bool = True) -> None:
    from app.bot.handlers import open_app_keyboard
    from app.bot.instance import bot

    if bot is None:
        raise RuntimeError("bot disabled")
    await bot.send_message(telegram_id, text, reply_markup=open_app_keyboard() if with_button else None)


def _is_due(e: Entry, now_utc: datetime) -> tuple[bool, str]:
    local = now_utc.astimezone(get_tz(e.tz))
    today = local.date().isoformat()
    if local.weekday() not in e.days or e.last_date == today:
        return False, today
    planned = local.replace(hour=e.hour, minute=e.minute, second=0, microsecond=0)
    return (timedelta(0) <= local - planned <= CATCH_UP_WINDOW), today


async def _trained_today(db, user: User) -> bool:
    tz = get_tz(user.timezone)
    today = datetime.now(tz).date()
    rows = await db.execute(
        select(WorkoutSession.finished_at).where(
            WorkoutSession.user_id == user.id,
            WorkoutSession.status == "completed",
            WorkoutSession.finished_at.is_not(None),
        ).order_by(WorkoutSession.finished_at.desc()).limit(5)
    )
    if any(to_local_date(f, tz) == today for (f,) in rows):
        return True
    marked = await db.execute(
        select(DayMark.id).where(DayMark.user_id == user.id, DayMark.day == today, DayMark.counts.is_(True)).limit(1)
    )
    return marked.first() is not None


async def check_due(now_utc: datetime | None = None) -> int:
    from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError

    now_utc = now_utc or datetime.now(timezone.utc)
    sent = 0
    for e in list(_schedule.values()):
        due, today = _is_due(e, now_utc)
        if not due:
            continue
        e.last_date = today
        async with AsyncSessionLocal() as db:
            user = await db.get(User, e.user_id)
            if not user or not user.reminder_enabled:
                remove_from_schedule(e.user_id)
                continue
            user.reminder_last_date = today
            skip = await _trained_today(db, user)
            info = None if skip else await streak_info(db, user)
            await db.commit()
        if skip:
            continue

        left = max(0, info["weekly_goal"] - info["this_week"])
        lines = ["Пора на тренировку."]
        if left:
            lines.append(f"До недельной цели осталось тренировок: {left}.")
        else:
            lines.append("Недельная цель уже выполнена, дополнительная тренировка не повредит.")
        if info["current"]:
            lines.append(f"Серия: {info['current']} нед. подряд")
        try:
            await send_text(e.telegram_id, "\n".join(lines))
            sent += 1
        except TelegramForbiddenError:
            log.info("Пользователь %s заблокировал бота - выключаю напоминания", e.user_id)
            async with AsyncSessionLocal() as db:
                u = await db.get(User, e.user_id)
                if u:
                    u.reminder_enabled = False
                    await db.commit()
            remove_from_schedule(e.user_id)
        except (TelegramAPIError, RuntimeError):
            log.exception("Не удалось отправить напоминание user=%s", e.user_id)
    return sent


async def reminder_loop() -> None:
    while True:
        try:
            await check_due()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Ошибка в цикле напоминаний")
        await asyncio.sleep(60)
