"""Per-user memory fragments.

Storage lives under VOIDAI_HOME/users/<user>/memory, so two people using the
same machine (or the same server) never see each other's fragments.
"""

import json
import time
import uuid

from . import config


def _fragment_path(kind, user=None):
    return config.memory_dir(user) / "fragments" / (config.safe_kind(kind) + ".json")


def _load(path):
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def classify(text: str) -> str:
    lowered = (text or "").lower()
    if any(k in lowered for k in ("def ", "class ", "function", "import ", "console.log", "public static void")):
        return "code"
    if any(k in lowered for k in ("theorem", "proof", "equation", "integral", "derivative", "matrix")):
        return "math"
    if any(k in lowered for k in ("experiment", "hypothesis", "physics", "biology", "chemistry", "neuron")):
        return "science"
    if "error" in lowered or "stack trace" in lowered or "bug" in lowered:
        return "issues"
    if "idea" in lowered or "concept" in lowered or "design" in lowered:
        return "ideas"
    if "plan" in lowered or "roadmap" in lowered or "steps" in lowered:
        return "plan"
    return "general"


def store_fragment(kind: str, text: str, tags=None, user=None):
    path = _fragment_path(kind, user)
    data = _load(path)
    fragment = {
        "id": "frag_" + uuid.uuid4().hex[:8],
        "kind": config.safe_kind(kind),
        "text": text,
        "tags": list(tags or []),
        "created_at": int(time.time()),
    }
    data.append(fragment)
    _save(path, data[-2000:])
    return fragment


def recall(kind: str, limit: int = 5, user=None):
    data = _load(_fragment_path(kind, user))
    return data[-max(1, int(limit)):]


def summary(user=None):
    base = config.memory_dir(user) / "fragments"
    counts = {}
    if not base.exists():
        return counts
    for path in sorted(base.glob("*.json")):
        counts[path.stem] = len(_load(path))
    return counts


def recent(user=None, limit: int = 10):
    base = config.memory_dir(user) / "fragments"
    items = []
    if not base.exists():
        return items
    for path in base.glob("*.json"):
        items.extend(_load(path))
    items.sort(key=lambda item: item.get("created_at", 0), reverse=True)
    return items[:max(1, int(limit))]
