import json, time, uuid, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
MEM = ROOT / "memory"

def _load(path):
    if not path.exists():
        return []
    return json.loads(path.read_text())

def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))

def classify(text: str) -> str:
    t = text.lower()
    if any(k in t for k in ["def ", "class ", "function", "import ", "console.log", "public static void"]):
        return "code"
    if any(k in t for k in ["theorem", "proof", "equation", "integral", "derivative", "matrix"]):
        return "math"
    if any(k in t for k in ["experiment", "hypothesis", "physics", "biology", "chemistry", "neuron"]):
        return "science"
    if "error" in t or "stack trace" in t or "bug" in t:
        return "issues"
    if "idea" in t or "concept" in t or "design" in t:
        return "ideas"
    if "plan" in t or "roadmap" in t or "steps" in t:
        return "plan"
    return "general"

def store_fragment(kind: str, text: str, tags=None):
    path = MEM / "fragments" / f"{kind}.json"
    data = _load(path)
    frag = {
        "id": f"frag_{uuid.uuid4().hex[:8]}",
            "kind": kind,
            "text": text,
            "tags": tags or [],
            "created_at": int(time.time())
    }
    data.append(frag)
    _save(path, data)
    return frag

def recall(kind: str, limit: int = 5):
    path = MEM / "fragments" / f"{kind}.json"
    data = _load(path)
    return data[-limit:]

def summary():
    base = MEM / "fragments"
    counts = {}
    if not base.exists():
        return counts
    for p in base.glob("*.json"):
        data = _load(p)
        counts[p.stem] = len(data)
    return counts
