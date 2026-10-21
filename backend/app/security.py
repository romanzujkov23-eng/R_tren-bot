import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_db, get_db_ro
from app.models import User, utcnow


def validate_init_data(init_data: str, bot_token: str, max_age: int) -> dict:
    if not init_data or not bot_token:
        raise ValueError("empty init data")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ValueError("no hash")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise ValueError("bad signature")

    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        raise ValueError("bad auth_date")
    if time.time() - auth_date > max_age:
        raise ValueError("init data expired")

    if "user" in pairs:
        pairs["user"] = json.loads(pairs["user"])
    return pairs


def create_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=settings.TOKEN_TTL_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": exp}, settings.SECRET_KEY, algorithm="HS256")


async def _resolve_user(authorization: str | None, db: AsyncSession) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется авторизация")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Сессия недействительна, откройте приложение заново")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(401, "Пользователь не найден")
    return user


def _is_stale(user: User) -> bool:
    return (utcnow() - (user.last_active_at or datetime.min)).total_seconds() > 600


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await _resolve_user(authorization, db)
    if _is_stale(user):
        user.last_active_at = utcnow()
        await db.commit()
    return user


async def get_current_user_ro(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_ro),
) -> User:
    user = await _resolve_user(authorization, db)
    if _is_stale(user):
        user.last_active_at = utcnow()
        async with AsyncSessionLocal() as w:
            await w.execute(update(User).where(User.id == user.id).values(last_active_at=user.last_active_at))
            await w.commit()
    return user
