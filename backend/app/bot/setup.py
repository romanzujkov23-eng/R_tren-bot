import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import MenuButtonWebApp, WebAppInfo

from app.bot.handlers import router
from app.config import settings

log = logging.getLogger(__name__)


def create_bot() -> Bot | None:
    if not settings.BOT_TOKEN:
        return None
    return Bot(token=settings.BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))


def create_dispatcher() -> Dispatcher:
    dp = Dispatcher()
    dp.include_router(router)
    return dp


async def configure_bot(bot: Bot) -> None:
    from aiogram.types import BotCommand

    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Открыть приложение"),
            BotCommand(command="stats", description="Моя статистика"),
            BotCommand(command="records", description="Личные рекорды"),
            BotCommand(command="export", description="Резервная копия данных"),
            BotCommand(command="help", description="Помощь"),
        ]
    )
    if settings.public_url.startswith("https://"):
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Тренировки", web_app=WebAppInfo(url=settings.public_url))
        )


async def setup_webhook(bot: Bot) -> None:
    url = f"{settings.public_url}/telegram/webhook"
    await bot.set_webhook(
        url=url,
        secret_token=settings.webhook_secret,
        allowed_updates=["message", "callback_query"],
    )
    log.info("Webhook установлен: %s", url)
