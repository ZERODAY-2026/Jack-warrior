"""Run the backend: ``python -m clausewise`` (from the backend/ directory)."""

import sys

import uvicorn

from . import privacy
from .app import create_app
from .config import ConfigError, Settings


def main() -> int:
    privacy.configure_logging()
    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    app = create_app(settings)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info", server_header=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
