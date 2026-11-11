import os
import tempfile

_db = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.update(
    BOT_TOKEN="123456:TEST_TOKEN",
    SECRET_KEY="test-secret",
    DATABASE_URL=os.environ.get("TEST_DATABASE_URL", f"sqlite+aiosqlite:///{_db}"),
    BOT_MODE="off",
    ENVIRONMENT="development",
    DEBUG="true",
)
