import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, AsyncSessionRO
from app.models import User, utcnow
from app.schemas import AuthOut, TelegramLogin, UserOut
from app.security import create_token, validate_init_data
from app.services import seed_exercises

router = APIRouter()
log = logging.getLogger(__name__)


async def _get_or_create(tg: dict) -> tuple[User, bool]:
    async with AsyncSessionRO() as ro:
        user = (await ro.execute(select(User).where(User.telegram_id == tg["id"]))).scalar_one_or_none()

    if user:
        changed = (
            user.username != tg.get("username")
            or user.first_name != (tg.get("first_name") or user.first_name)
            or user.last_name != tg.get("last_name")
            or (utcnow() - (user.last_active_at or utcnow())).total_seconds() > 600
        )
        if changed:
            async with AsyncSessionLocal() as db:
                user = await db.get(User, user.id)
                user.username = tg.get("username")
                user.first_name = tg.get("first_name") or user.first_name
                user.last_name = tg.get("last_name")
                user.last_active_at = utcnow()
                await db.commit()
        return user, False

    async with AsyncSessionLocal() as db:
        user = User(
            telegram_id=tg["id"],
            username=tg.get("username"),
            first_name=tg.get("first_name") or "Атлет",
            last_name=tg.get("last_name"),
            language_code=tg.get("language_code"),
            app_mode="ask",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        await seed_exercises(db, user)
    return user, True


@router.post("/telegram", response_model=AuthOut)
async def login_with_telegram(body: TelegramLogin):
    try:
        data = validate_init_data(body.init_data, settings.BOT_TOKEN, settings.AUTH_MAX_AGE_SECONDS)
        tg = data["user"]
        tg["id"]
    except (ValueError, KeyError, TypeError) as e:
        log.warning("Auth rejected: %s", e)
        raise HTTPException(401, "Не удалось подтвердить вход через Telegram")

    user, is_new = await _get_or_create(tg)
    return AuthOut(token=create_token(user.id), user=UserOut.model_validate(user), is_new=is_new)


@router.post("/dev", response_model=AuthOut)
async def dev_login():
    if settings.is_production or not settings.DEBUG:
        raise HTTPException(404, "Not found")
    user, is_new = await _get_or_create({"id": 1, "username": "demo", "first_name": "Demo", "language_code": "ru"})
    return AuthOut(token=create_token(user.id), user=UserOut.model_validate(user), is_new=is_new)
