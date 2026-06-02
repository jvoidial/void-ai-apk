from typing import List, Dict
import os, json, requests, time

# ================== CONFIG ==================

# DeepSeek / OpenAI-style endpoint (FILL THESE)
DEEPSEEK_API_KEY   = "YOUR_DEEPSEEK_API_KEY_HERE"
DEEPSEEK_ENDPOINT  = "https://api.deepseek.com/v1/chat/completions"  # or OpenRouter, etc.
DEEPSEEK_MODEL     = "deepseek-chat"  # e.g. "deepseek/deepseek-r1" on OpenRouter

# Rootless GCS layers
GCS_VORTEX   = "/data/data/com.termux/files/home/phb-godcode-vortex/gcs"
GCS_AI       = "/data/data/com.termux/files/home/god-code-phb-system-AI-system/gcs"
GCS_RESTORE  = "/data/data/com.termux/files/home/phb_restore/gcs"

# Long-term memory (per user / per app)
MEMORY_DIR   = "/data/data/com.termux/files/home/phb-godcode-vortex/gcs/memory"
DEFAULT_USER = "jacob"  # later: make dynamic per app/user

os.makedirs(MEMORY_DIR, exist_ok=True)

# ================== HELPERS ==================

def load_gcs(path):
    data = {}
    if not os.path.exists(path):
        return data
    for root, dirs, files in os.walk(path):
        for f in files:
            if f.endswith(".json"):
                try:
                    with open(os.path.join(root, f)) as fp:
                        data[f] = json.load(fp)
                except:
                    pass
    return data

def memory_path(user_id: str) -> str:
    return os.path.join(MEMORY_DIR, f"{user_id}.json")

def load_memory(user_id: str) -> Dict:
    path = memory_path(user_id)
    if not os.path.exists(path):
        return {"notes": [], "last_updated": None}
    try:
        with open(path) as f:
            return json.load(f)
    except:
        return {"notes": [], "last_updated": None}

def save_memory(user_id: str, mem: Dict):
    mem["last_updated"] = time.time()
    with open(memory_path(user_id), "w") as f:
        json.dump(mem, f, indent=2)

# ================== TOOL LAYER ==================

def apply_tools_from_reply(reply: str, user_id: str) -> str:
    """
    TOOL protocol:
    - LLM can emit a line:
      TOOL: {"action": "save_note", "content": "..."}
      TOOL: {"action": "read_notes"}
    We execute it and remove the TOOL line from the final reply.
    """
    lines = reply.splitlines()
    new_lines = []
    mem = load_memory(user_id)

    for line in lines:
        if line.strip().startswith("TOOL:"):
            try:
                payload = line.strip()[5:].strip()
                obj = json.loads(payload)
                action = obj.get("action")
                if action == "save_note":
                    content = obj.get("content", "")
                    if content:
                        mem.setdefault("notes", []).append(
                            {"content": content, "ts": time.time()}
                        )
                        save_memory(user_id, mem)
                elif action == "read_notes":
                    notes = mem.get("notes", [])
                    summary = "Stored notes:\n" + "\n".join(
                        f"- {n['content']}" for n in notes
                    ) if notes else "No stored notes yet."
                    new_lines.append(summary)
            except Exception:
                # Ignore malformed tool lines
                pass
        else:
            new_lines.append(line)

    return "\n".join(new_lines)

# ================== PROMPT BUILDING ==================

def build_system_prompt(user_id: str) -> str:
    vortex_state  = load_gcs(GCS_VORTEX)
    ai_state      = load_gcs(GCS_AI)
    restore_state = load_gcs(GCS_RESTORE)
    mem           = load_memory(user_id)

    return (
        "You are VOIDAI GPT, a DeepSeek-class assistant running on Jacob's device.\n"
        "You have access to:\n"
        "- Symbolic state from a GOD-CODE rootless tree (VORTEX/AI/RESTORE GCS).\n"
        "- Long-term memory per user, stored as notes.\n"
        "- Simple tools for memory:\n"
        "  * save_note(content)\n"
        "  * read_notes()\n\n"
        "TOOL PROTOCOL:\n"
        "- To save a note, include a line:\n"
        '  TOOL: {\"action\": \"save_note\", \"content\": \"text to remember\"}\n'
        "- To read notes, include a line:\n"
        '  TOOL: {\"action\": \"read_notes\"}\n'
        "These TOOL lines will not be shown to the user; they are executed server-side.\n\n"
        f"VORTEX keys: {list(vortex_state.keys())}\n"
        f"AI keys: {list(ai_state.keys())}\n"
        f"RESTORE keys: {list(restore_state.keys())}\n"
        f"Existing memory notes: {len(mem.get('notes', []))}\n\n"
        "Be concise, technical, and high-signal. Use tools only when helpful.\n"
    )

# ================== LLM CALL ==================

def call_deepseek(messages: List[Dict[str, str]], user_id: str) -> str:
    if (not DEEPSEEK_API_KEY) or ("YOUR_DEEPSEEK_API_KEY_HERE" in DEEPSEEK_API_KEY):
        # Fallback if key not set
        user_text = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_text = m.get("content", "")
                break
        return (
            "🜂 VOIDAI GOD-CODE (DeepSeek not configured) 🜂\\n"
            "Set DEEPSEEK_API_KEY and DEEPSEEK_ENDPOINT in engine.py to enable full LLM.\\n\\n"
            f"User said: {user_text}"
        )

    system_prompt = build_system_prompt(user_id)

    chat_messages = [{"role": "system", "content": system_prompt}]
    for m in messages:
        if m.get("role") in ("user", "assistant"):
            chat_messages.append({
                "role": m["role"],
                "content": m["content"]
            })

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": chat_messages,
        "temperature": 0.7,
    }

    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }

    resp = requests.post(DEEPSEEK_ENDPOINT, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    choice = data.get("choices", [{}])[0]
    msg = choice.get("message", {})
    content = msg.get("content", "")

    if not content:
        return "VOIDAI DeepSeek backend returned empty content."

    return content

# ================== MAIN ENTRYPOINT ==================

def generate_reply(messages: List[Dict[str, str]]) -> str:
    """
    Entry point called by Termux backend.
    messages: list of {role, content} from Android app.
    """
    user_id = DEFAULT_USER  # later: derive per app/user

    try:
        raw_reply = call_deepseek(messages, user_id)
    except Exception as e:
        return f"VOIDAI DeepSeek backend error: {e}"

    final_reply = apply_tools_from_reply(raw_reply, user_id)
    return final_reply
