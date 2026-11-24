"""Portable configuration for VOIDAI.

Everything resolves from environment variables with sensible defaults, so the
same code runs on a laptop, a server, or Termux. No files are created at import
time.
"""

import getpass
import hashlib
import os
import re
from pathlib import Path

APP_NAME = "voidai"
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

_SAFE_USER = re.compile(r"[^A-Za-z0-9._-]+")
_SAFE_KIND = re.compile(r"[^a-z0-9_-]+")


def _env(*names, default=None):
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return default


def home() -> Path:
    """Return the writable VOIDAI data directory (created on demand)."""
    raw = os.environ.get("VOIDAI_HOME")
    if raw:
        path = Path(raw).expanduser()
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        path = (Path(xdg).expanduser() / APP_NAME) if xdg else (Path.home() / ".local" / "share" / APP_NAME)
    path.mkdir(parents=True, exist_ok=True)
    return path


def sanitize_user(value=None) -> str:
    """Turn any user identifier into a filesystem-safe, stable directory name."""
    raw = (value or "").strip()
    if not raw:
        raw = os.environ.get("VOIDAI_USER", "").strip() or getpass.getuser() or "anonymous"
    cleaned = _SAFE_USER.sub("-", raw).strip("-._")[:64]
    if cleaned:
        return cleaned
    return "user-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]


def default_user() -> str:
    return sanitize_user(os.environ.get("VOIDAI_USER"))


def safe_kind(value: str) -> str:
    kind = _SAFE_KIND.sub("-", (value or "").strip().lower()).strip("-")
    return kind or "general"


def user_dir(user=None) -> Path:
    path = home() / "users" / sanitize_user(user)
    path.mkdir(parents=True, exist_ok=True)
    return path


def memory_dir(user=None) -> Path:
    path = user_dir(user) / "memory"
    path.mkdir(parents=True, exist_ok=True)
    return path


def history_path(user=None) -> Path:
    return user_dir(user) / "history.json"


def state_path(user=None) -> Path:
    return user_dir(user) / "phb_state.json"


def api_key() -> str:
    return _env(
        "OPENAI_API_KEY",
        "VOIDAI_GPT_KEY",
        "VOIDAI_API_KEY",
        "OPENROUTER_API_KEY",
        default="",
    )


def base_url() -> str:
    explicit = _env("OPENAI_BASE_URL", "VOIDAI_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    if os.environ.get("OPENROUTER_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
        return OPENROUTER_BASE_URL
    return DEFAULT_BASE_URL


def model() -> str:
    return _env("OPENAI_MODEL", "VOIDAI_MODEL", default=DEFAULT_MODEL)


def server_token() -> str:
    return _env("VOIDAI_SERVER_TOKEN", default="")


def backend_token() -> str:
    return _env("VOIDAI_BACKEND_TOKEN", default="")
