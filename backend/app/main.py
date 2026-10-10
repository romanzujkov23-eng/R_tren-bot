import asyncio
import logging
import time
from contextlib import asynccontextmanager

from aiogram.types import Update
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app import reminders
from app.bot.instance import bot, dp
from app.bot.setup import configure_bot, setup_webhook
from app.config import settings
from app.database import create_tables
from app.routers import auth, body, catalog, diary, exercises, goals, plan, sessions, statistics, users, workouts

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("trenbot")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    log.info("База данных готова")

    if bot and settings.BOT_MODE == "webhook":
        if not settings.public_url.startswith("https://"):
            log.error("BOT_MODE=webhook, но PUBLIC_URL не задан или не https - вебхук не установлен")
        else:
            try:
                await setup_webhook(bot)
                await configure_bot(bot)
            except Exception:
                log.exception("Не удалось настроить Telegram (проверьте BOT_TOKEN)")
    elif bot and settings.BOT_MODE == "polling":
        await bot.delete_webhook()
        await configure_bot(bot)
        app.state.polling = asyncio.create_task(dp.start_polling(bot, handle_signals=False))

    if bot and settings.BOT_MODE in ("webhook", "polling"):
        try:
            n = await reminders.load_schedule()
            log.info("Напоминания: в расписании %s пользователей", n)
            app.state.reminders = asyncio.create_task(reminders.reminder_loop())
        except Exception:
            log.exception("Не удалось запустить напоминания")

    yield

    for name in ("polling", "reminders"):
        task = getattr(app.state, name, None)
        if task:
            task.cancel()
    if bot:
        await bot.session.close()


app = FastAPI(
    title="TrenBot API",
    lifespan=lifespan,
    docs_url="/api/docs" if not settings.is_production or settings.DEBUG else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if not settings.is_production or settings.DEBUG else None,
)

app.add_middleware(GZipMiddleware, minimum_size=600)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - started) * 1000
    if request.url.path.startswith("/api"):
        response.headers["Server-Timing"] = f"app;dur={ms:.0f}"
        if ms > 800:
            log.warning("Медленный запрос %s %s: %.0f мс", request.method, request.url.path, ms)
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error")
    return JSONResponse({"error": "Внутренняя ошибка сервера"}, status_code=500)


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok"}


@app.post("/telegram/webhook", include_in_schema=False)
async def telegram_webhook(request: Request):
    if request.headers.get("X-Telegram-Bot-Api-Secret-Token") != settings.webhook_secret:
        raise HTTPException(403, "forbidden")
    if not bot:
        raise HTTPException(503, "bot disabled")
    update = Update.model_validate(await request.json(), context={"bot": bot})
    await dp.feed_update(bot, update)
    return {"ok": True}


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(exercises.router, prefix="/api/exercises", tags=["exercises"])
app.include_router(workouts.router, prefix="/api/workouts", tags=["workouts"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(statistics.router, prefix="/api/statistics", tags=["statistics"])
app.include_router(catalog.router, prefix="/api", tags=["catalog"])
app.include_router(plan.router, prefix="/api/plan", tags=["plan"])
app.include_router(body.router, prefix="/api/body", tags=["body"])
app.include_router(diary.router, prefix="/api/diary", tags=["diary"])
app.include_router(goals.router, prefix="/api/goals", tags=["goals"])

STATIC = settings.static_dir
if STATIC:
    log.info("Раздаю фронтенд из %s", STATIC)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith(("api/", "telegram/")):
            raise HTTPException(404, "Not found")
        candidate = (STATIC / full_path).resolve()
        if full_path and candidate.is_file() and STATIC.resolve() in candidate.parents:
            if full_path.startswith("assets/"):
                cache = "public, max-age=31536000, immutable"
            elif full_path.startswith("ex/"):
                cache = "public, max-age=2592000"
            else:
                cache = "no-cache"
            return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
