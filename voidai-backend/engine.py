"""VOIDAI GOD-CODE backend engine.

Standard library only. Every path and credential comes from the environment,
so the same engine runs on Termux, Linux, macOS or a container.

Environment:
    VOIDAI_BACKEND_HOME   data directory (default: $VOIDAI_HOME/backend)
    VOIDAI_API_KEY        API key (also reads DEEPSEEK_API_KEY / OPENAI_API_KEY)
    DEEPSEEK_ENDPOINT     chat completions URL
    DEEPSEEK_MODEL        model name
    VOIDAI_USER           default user id
"""

import getpass
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List

DEFAULT_ENDPOINT = "https://api.deepseek.com/v1/chat/completions"
DEFAULT_MODEL = "deepseek-chat"
PLACEHOLDER_KEYS = ("", "YOUR_DEEPSEEK_API_KEY_HERE")


def _backend_home() -> Path:
    raw = os.environ.get("VOIDAI_BACKEND_HOME")
    if not raw:
        base = os.environ.get("VOIDAI_HOME")
        if base:
            raw = os.path.join(base, "backend")
        else:
            raw = os.path.join(os.path.expanduser("~"), ".local", "share", "voidai", "backend")
    path = Path(raw).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _gcs_dir(env_name, default):
    return Path(os.environ.get(env_name) or default).expanduser()


HOME = _backend_home()
GCS_VORTEX = _gcs_dir("VOIDAI_GCS_VORTEX", HOME / "gcs" / "vortex")
GCS_AI = _gcs_dir("VOIDAI_GCS_AI", HOME / "gcs" / "ai")
GCS_RESTORE = _gcs_dir("VOIDAI_GCS_RESTORE", HOME / "gcs" / "restore")
MEMORY_DIR = Path(os.environ.get("VOIDAI_MEMORY_DIR") or (HOME / "memory"))
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

_SAFE_USER = re.compile(r"[^A-Za-z0-9._-]+")


def default_user() -> str:
    raw = os.environ.get("VOIDAI_USER") or getpass.getuser() or "anonymous"
    cleaned = _SAFE_USER.sub("-", raw).strip("-._")[:64]
    return cleaned or "anonymous"


def sanitize_user(user_id) -> str:
    raw = (str(user_id).strip() if user_id else "") or default_user()
    cleaned = _SAFE_USER.sub("-", raw).strip("-._")[:64]
    return cleaned or default_user()


def _endpoint(base):
    base = (base or "").rstrip("/")
    if not base:
        return ""
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def api_config():
    explicit_endpoint = _endpoint(os.environ.get("VOIDAI_BASE_URL") or os.environ.get("DEEPSEEK_ENDPOINT"))
    explicit_model = os.environ.get("VOIDAI_MODEL") or os.environ.get("DEEPSEEK_MODEL")

    if os.environ.get("VOIDAI_API_KEY"):
        key = os.environ["VOIDAI_API_KEY"]
        endpoint = explicit_endpoint or DEFAULT_ENDPOINT
        model = explicit_model or DEFAULT_MODEL
    elif os.environ.get("DEEPSEEK_API_KEY"):
        key = os.environ["DEEPSEEK_API_KEY"]
        endpoint = explicit_endpoint or DEFAULT_ENDPOINT
        model = explicit_model or DEFAULT_MODEL
    elif os.environ.get("OPENAI_API_KEY"):
        key = os.environ["OPENAI_API_KEY"]
        endpoint = explicit_endpoint or "https://api.openai.com/v1/chat/completions"
        model = explicit_model or "gpt-4o-mini"
    elif os.environ.get("OPENROUTER_API_KEY"):
        key = os.environ["OPENROUTER_API_KEY"]
        endpoint = explicit_endpoint or "https://openrouter.ai/api/v1/chat/completions"
        model = explicit_model or "openai/gpt-4o-mini"
    else:
        key, endpoint, model = "", explicit_endpoint or DEFAULT_ENDPOINT, explicit_model or DEFAULT_MODEL

    return key.strip(), endpoint, model


def _local(endpoint):
    host = urllib.parse.urlparse(endpoint).hostname or ""
    return host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local")


def configured() -> bool:
    key, endpoint, _ = api_config()
    return key not in PLACEHOLDER_KEYS or _local(endpoint)


def load_gcs(path) -> Dict:
    data = {}
    path = Path(path)
    if not path.exists():
        return data
    for root, _dirs, files in os.walk(path):
        for name in files:
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(root, name), "r", encoding="utf-8") as handle:
                    data[name] = json.load(handle)
            except (OSError, ValueError):
                continue
    return data


def memory_path(user_id: str) -> Path:
    return MEMORY_DIR / (sanitize_user(user_id) + ".json")


def load_memory(user_id: str) -> Dict:
    path = memory_path(user_id)
    if not path.exists():
        return {"notes": [], "last_updated": None}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise ValueError("memory must be an object")
        data.setdefault("notes", [])
        return data
    except (OSError, ValueError):
        return {"notes": [], "last_updated": None}


def save_memory(user_id: str, mem: Dict):
    mem["last_updated"] = time.time()
    path = memory_path(user_id)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(mem, handle, indent=2)
    tmp.replace(path)


def apply_tools_from_reply(reply: str, user_id: str) -> str:
    """Execute TOOL: lines emitted by the model and strip them from the reply."""
    new_lines = []
    mem = load_memory(user_id)

    for line in (reply or "").splitlines():
        if not line.strip().startswith("TOOL:"):
            new_lines.append(line)
            continue
        try:
            obj = json.loads(line.strip()[5:].strip())
        except ValueError:
            continue
        action = obj.get("action")
        if action == "save_note":
            content = obj.get("content", "")
            if content:
                mem.setdefault("notes", []).append({"content": content, "ts": time.time()})
                save_memory(user_id, mem)
        elif action == "read_notes":
            notes = mem.get("notes", [])
            if notes:
                new_lines.append("Stored notes:\n" + "\n".join("- " + n["content"] for n in notes))
            else:
                new_lines.append("No stored notes yet.")

    return "\n".join(new_lines)


def build_system_prompt(user_id: str) -> str:
    vortex_state = load_gcs(GCS_VORTEX)
    ai_state = load_gcs(GCS_AI)
    restore_state = load_gcs(GCS_RESTORE)
    mem = load_memory(user_id)

    return (
        "You are VOIDAI, running with the PHB human-agent layer in the VOIDAI backend.\n"
        "Built by Jacob. Never claim to be ChatGPT, GPT-4, Claude, or another product.\n"
        "Do not claim sentience, feelings, or phenomenal experience.\n"
        "PHB layers (internal style guide, not a physiological or medical measurement):\n"
        "  coherence (pacing), reflex (directness), working (context),\n"
        "  circuit (reasoning mode), intent (goal tracking), narrative (continuity).\n"
        "Reasoning circuits: curiosity, focus, openness, rigor, creativity.\n"
        "Use the layers to tune pacing, directness, context, mode switching,\n"
        "goal tracking, and continuity.\n\n"
        "You have access to:\n"
        "- Symbolic state from a GOD-CODE rootless tree (VORTEX/AI/RESTORE GCS).\n"
        "- Long-term memory per user, stored as notes.\n"
        "- Simple tools for memory:\n"
        "  * save_note(content)\n"
        "  * read_notes()\n\n"
        "TOOL PROTOCOL:\n"
        "- To save a note, include a line:\n"
        '  TOOL: {"action": "save_note", "content": "text to remember"}\n'
        "- To read notes, include a line:\n"
        '  TOOL: {"action": "read_notes"}\n'
        "These TOOL lines are not shown to the user; they run server-side.\n\n"
        "VORTEX keys: %s\n"
        "AI keys: %s\n"
        "RESTORE keys: %s\n"
        "Existing memory notes: %d\n\n"
        "Be concise, technical, and high-signal. Use tools only when helpful.\n"
        % (list(vortex_state), list(ai_state), list(restore_state), len(mem.get("notes", [])))
    )


def call_model(messages: List[Dict[str, str]], user_id: str) -> str:
    key, endpoint, model = api_config()
    if not configured():
        last_user = ""
        for message in reversed(messages):
            if message.get("role") == "user":
                last_user = message.get("content", "")
                break
        return (
            "VOIDAI GOD-CODE (model not configured)\n"
            "Set VOIDAI_API_KEY (or DEEPSEEK_API_KEY) and DEEPSEEK_ENDPOINT to enable the LLM.\n\n"
            "User said: " + last_user
        )

    chat_messages = [{"role": "system", "content": build_system_prompt(user_id)}]
    for message in messages:
        if message.get("role") in ("user", "assistant") and message.get("content"):
            chat_messages.append({"role": message["role"], "content": str(message["content"])})

    payload = {
        "model": model,
        "messages": chat_messages,
        "temperature": 0.7,
        "max_tokens": 4096,
    }
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace") if exc.fp else ""
        raise RuntimeError("model endpoint HTTP %s: %s" % (exc.code, body.strip()[:300]))
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError("cannot reach model endpoint: %s" % getattr(exc, "reason", exc))

    if not raw.strip():
        raise RuntimeError("model endpoint returned an empty response")
    try:
        data = json.loads(raw)
    except ValueError:
        raise RuntimeError("model endpoint returned non-JSON")
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("model endpoint returned no choices")
    content = (choices[0].get("message") or {}).get("content") or ""
    if not content:
        raise RuntimeError("model endpoint returned empty content")
    return content


def generate_reply(messages: List[Dict[str, str]], user_id: str = None) -> str:
    """Entry point used by the backend server."""
    uid = sanitize_user(user_id)
    if not isinstance(messages, list):
        return "VOIDAI backend error: messages must be a list"
    try:
        raw_reply = call_model(messages, uid)
    except Exception as exc:
        return "VOIDAI backend error: %s" % exc
    return apply_tools_from_reply(raw_reply, uid)
