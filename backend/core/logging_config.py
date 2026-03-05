"""
Centralized logging configuration.

Call setup_logging() once at server startup (before other imports in main.py).
Writes to both stdout and backend/output/logs/app.log.
"""

import logging
import sys
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parents[1] / "output" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"

_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger with console + rotating file output."""
    logging.basicConfig(
        level=level,
        format=_FORMAT,
        datefmt=_DATE_FORMAT,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
        ],
        force=True,  # override any handlers set by imported libraries
    )

    # Suppress chatty third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    logging.getLogger("app").info(
        "Logging initialized — writing to %s", LOG_FILE
    )
