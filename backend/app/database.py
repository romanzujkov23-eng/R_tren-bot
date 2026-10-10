import asyncio

from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


def _build_engine():
    url = make_url(settings.DATABASE_URL.strip())
    connect_args: dict = {}
    kwargs: dict = {}

    if url.drivername in ("postgres", "postgresql", "postgresql+psycopg2", "postgresql+asyncpg"):
        query = dict(url.query)
        sslmode = query.pop("sslmode", None)
        query.pop("channel_binding", None)
        url = url.set(drivername="postgresql+asyncpg", query=query)
        local = url.host in (None, "localhost", "127.0.0.1", "postgres", "db")
        if sslmode in ("require", "verify-ca", "verify-full") or not local:
            connect_args["ssl"] = "require"
        if url.host and "-pooler" in url.host:
            connect_args["statement_cache_size"] = 0
        kwargs.update(pool_pre_ping=True, pool_recycle=240, pool_size=10, max_overflow=10)
    elif url.drivername == "sqlite":
        url = url.set(drivername="sqlite+aiosqlite")

    return create_async_engine(url, echo=False, connect_args=connect_args, **kwargs)


engine = _build_engine()
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

ro_engine = engine.execution_options(isolation_level="AUTOCOMMIT")
AsyncSessionRO = async_sessionmaker(ro_engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def get_db_ro():
    async with AsyncSessionRO() as session:
        yield session


NEW_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "users": [
        ("timezone", "VARCHAR(64) DEFAULT 'UTC'"),
        ("weekly_goal", "INTEGER DEFAULT 3"),
        ("reminder_enabled", "BOOLEAN DEFAULT FALSE"),
        ("reminder_time", "VARCHAR(5) DEFAULT '18:00'"),
        ("reminder_days", "VARCHAR(20) DEFAULT '0,2,4'"),
        ("reminder_last_date", "VARCHAR(10)"),
        ("app_mode", "VARCHAR(10) DEFAULT 'full'"),
        ("active_program", "VARCHAR(20)"),
        ("rest_timer_enabled", "BOOLEAN DEFAULT TRUE"),
    ],
    "workouts": [("program_id", "VARCHAR(20)"), ("day_index", "INTEGER")],
    "diary_entries": [("subtype", "VARCHAR(20)"), ("migrated", "BOOLEAN DEFAULT FALSE")],
}


def _add_missing_columns(sync_conn) -> None:
    insp = inspect(sync_conn)
    for table, cols in NEW_COLUMNS.items():
        existing = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols:
            if name not in existing:
                sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


async def _backfill_programs(conn) -> None:
    from app.catalog import PROGRAMS

    for prog in PROGRAMS:
        for i, (day_name, _) in enumerate(prog["days"]):
            await conn.execute(
                text(
                    "UPDATE workouts SET program_id = :p, day_index = :i "
                    "WHERE program_id IS NULL AND name = :n AND description = :d"
                ),
                {"p": prog["id"], "i": i, "n": day_name, "d": prog["name"]},
            )
    await conn.execute(
        text(
            "UPDATE users SET active_program = ("
            "  SELECT w.program_id FROM workouts w WHERE w.user_id = users.id AND w.program_id IS NOT NULL "
            "  ORDER BY w.id DESC LIMIT 1) "
            "WHERE active_program IS NULL AND EXISTS ("
            "  SELECT 1 FROM workouts w WHERE w.user_id = users.id AND w.program_id IS NOT NULL)"
        )
    )


async def _migrate_diary_to_marks(conn) -> None:
    await conn.execute(
        text(
            "INSERT INTO day_marks (user_id, day, slot, kind, subtype, counts, note, created_at) "
            "SELECT d.user_id, d.day, 0, d.kind, d.subtype, TRUE, d.note, d.created_at FROM diary_entries d "
            "WHERE (d.migrated IS NULL OR d.migrated = FALSE) "
            "AND NOT EXISTS (SELECT 1 FROM day_marks m WHERE m.user_id = d.user_id AND m.day = d.day AND m.slot = 0)"
        )
    )
    await conn.execute(text("UPDATE diary_entries SET migrated = TRUE WHERE migrated IS NULL OR migrated = FALSE"))


async def create_tables() -> None:
    from app import models

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
        await conn.execute(text("DROP TABLE IF EXISTS user_achievements"))
        await _backfill_programs(conn)
        await _migrate_diary_to_marks(conn)


async def run_parallel(*funcs):

    async def one(fn):
        async with AsyncSessionRO() as session:
            return await fn(session)

    return await asyncio.gather(*(one(f) for f in funcs))
