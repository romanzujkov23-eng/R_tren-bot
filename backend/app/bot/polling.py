import asyncio
import logging

from app.bot.setup import configure_bot, create_bot, create_dispatcher


async def main():
    logging.basicConfig(level=logging.INFO)
    bot = create_bot()
    if not bot:
        raise SystemExit("BOT_TOKEN не задан в .env")
    await bot.delete_webhook()
    await configure_bot(bot)
    await create_dispatcher().start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
