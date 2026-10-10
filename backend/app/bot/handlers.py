from aiogram import F, Router
from aiogram.filters import Command, CommandStart
import json

from aiogram.types import BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import User


def _unit(user: User) -> str:
    return "кг"

router = Router(name="main")


def open_app_keyboard() -> InlineKeyboardMarkup | None:
    if not settings.public_url.startswith("https://"):
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=settings.public_url))]
        ]
    )


@router.message(CommandStart())
async def cmd_start(message: Message):
    name = message.from_user.first_name if message.from_user else "атлет"
    text = (
        f"Привет, {name}.\n\n"
        "Дневник тренировок: календарь, программы, подходы и прогресс.\n\n"
        "Нажмите кнопку ниже, чтобы открыть приложение."
    )
    kb = open_app_keyboard()
    if not kb:
        text += "\n\nАдрес приложения (PUBLIC_URL) ещё не настроен."
    await message.answer(text, reply_markup=kb)


@router.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(
        "<b>Команды</b>\n"
        "/start - открыть приложение\n"
        "/stats - сводка по тренировкам\n"
        "/records - личные рекорды\n"
        "/export - выгрузить данные файлом (резервная копия)\n\n"
        "Тренировки записываются в приложении.",
        reply_markup=open_app_keyboard(),
    )


@router.message(Command("stats"))
async def cmd_stats(message: Message):
    from app.routers.statistics import compute_summary

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.telegram_id == message.from_user.id))
        ).scalar_one_or_none()
        if not user:
            await message.answer("Вы ещё не открывали приложение. Нажмите /start.")
            return
        s = await compute_summary(db, user)

    await message.answer(
        "<b>Статистика</b>\n\n"
        f"Тренировок всего: <b>{s['total_workouts']}</b>\n"
        f"На этой неделе: <b>{s['workouts_this_week']}</b>\n"
        f"Подходов: <b>{s['total_sets']}</b>\n"
        f"Общий тоннаж: <b>{s['total_volume']:g}</b> {_unit(user)}\n"
        f"Время в зале: <b>{s['total_minutes']}</b> мин",
        reply_markup=open_app_keyboard(),
    )


@router.message(Command("records"))
async def cmd_records(message: Message):
    from app.routers.statistics import compute_records

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.telegram_id == message.from_user.id))
        ).scalar_one_or_none()
        if not user:
            await message.answer("Вы ещё не открывали приложение. Нажмите /start.")
            return
        records = await compute_records(db, user.id, limit=10)

    if not records:
        await message.answer("Рекордов пока нет: они появятся после первых тренировок.")
        return
    lines = [f"• {r['name']}: <b>{r['best_weight']:g} {_unit(user)}</b> (1ПМ ≈ {r['best_1rm']:g})" for r in records]
    await message.answer("<b>Личные рекорды</b>\n\n" + "\n".join(lines))


@router.message(Command("export"))
async def cmd_export(message: Message):
    from app.services import export_user_data

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.telegram_id == message.from_user.id))
        ).scalar_one_or_none()
        if not user:
            await message.answer("Вы ещё не открывали приложение. Нажмите /start.")
            return
        data = await export_user_data(db, user)
    raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    await message.answer_document(
        BufferedInputFile(raw, filename="trenbot-backup.json"),
        caption="Резервная копия данных",
    )


@router.message(F.text)
async def fallback(message: Message):
    await message.answer("Не понял. Нажмите /start, чтобы открыть приложение.", reply_markup=open_app_keyboard())
