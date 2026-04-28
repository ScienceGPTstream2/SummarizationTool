"""
Centralized logging configuration.

Call setup_logging() once at server startup (before other imports in main.py).
Outputs structured JSON to stdout and backend/output/logs/app.log.
Optionally ships logs to Loki when LOKI_URL is set.
"""

import logging
import os
import sys
from pathlib import Path

import structlog

LOG_DIR = Path(__file__).resolve().parents[1] / "output" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"

# Processors shared between structlog-native calls and stdlib bridge
_SHARED_PROCESSORS = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso"),
]


def setup_logging(level: int = logging.INFO) -> None:
    """Configure structured JSON logging with optional Loki shipping."""
    structlog.configure(
        processors=_SHARED_PROCESSORS
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    json_formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
        foreign_pre_chain=_SHARED_PROCESSORS,
    )

    handlers: list[logging.Handler] = [
        _stream_handler(json_formatter),
        _file_handler(json_formatter),
    ]

    loki_url = os.getenv("LOKI_URL")
    if loki_url:
        try:
            import logging_loki

            loki_handler = logging_loki.LokiHandler(
                url=f"{loki_url.rstrip('/')}/loki/api/v1/push",
                tags={"app": "summarization-backend"},
                version="1",
            )
            loki_handler.setFormatter(json_formatter)
            handlers.append(loki_handler)
        except Exception as exc:
            print(f"[logging] Loki handler unavailable: {exc}", flush=True)

    root = logging.getLogger()
    root.setLevel(level)
    for h in root.handlers[:]:
        root.removeHandler(h)
    for h in handlers:
        root.addHandler(h)

    # Suppress chatty third-party libraries
    for noisy in ("httpx", "httpcore", "urllib3", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger("app").info(
        "Logging initialized — writing to %s (loki=%s)", LOG_FILE, bool(loki_url)
    )


def _stream_handler(formatter: logging.Formatter) -> logging.StreamHandler:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(formatter)
    return h


def _file_handler(formatter: logging.Formatter) -> logging.FileHandler:
    h = logging.FileHandler(LOG_FILE, encoding="utf-8")
    h.setFormatter(formatter)
    return h
