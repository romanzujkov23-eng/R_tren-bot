import hashlib
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True)

    BOT_TOKEN: str = ""
    SECRET_KEY: str = "dev-secret-change-me"
    DATABASE_URL: str = "sqlite+aiosqlite:///./trenbot.db"

    PUBLIC_URL: str = ""

    BOT_MODE: str = "off"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    TOKEN_TTL_DAYS: int = 14
    AUTH_MAX_AGE_SECONDS: int = 86400

    STATIC_DIR: str = ""

    @property
    def public_url(self) -> str:
        url = self.PUBLIC_URL or os.environ.get("RENDER_EXTERNAL_URL", "")
        return url.rstrip("/")

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def webhook_secret(self) -> str:
        raw = f"{self.BOT_TOKEN}:{self.SECRET_KEY}".encode()
        return hashlib.sha256(raw).hexdigest()

    @property
    def static_dir(self) -> Path | None:
        candidates = [self.STATIC_DIR] if self.STATIC_DIR else []
        candidates.append(str(Path(__file__).resolve().parent.parent / "static"))
        for c in candidates:
            p = Path(c)
            if p.is_dir() and (p / "index.html").exists():
                return p
        return None


settings = Settings()
