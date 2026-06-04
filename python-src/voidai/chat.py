from .memory_mesh import classify, store_fragment, recall, summary
from .knowledge_layer import ingest, summarize_focus, summarize_map

def answer(session_id: str, user_text: str) -> str:
    if user_text.startswith("@focus "):
        term = user_text.replace("@focus ", "").strip()
        return summarize_focus(term)

    if user_text.strip() == "@map":
        return summarize_map()

    kind = classify(user_text)
    frag = store_fragment(kind, user_text)

    kg_info = ingest(user_text)

    recent_code = recall("code", limit=3)
    recent_ideas = recall("ideas", limit=3)
    recent_issues = recall("issues", limit=3)

    mem_summary = summary()

    memory_context = ""
    if recent_code:
        memory_context += "Recent code you shared:\\n" + "\\n".join(
            f"- {f['text']}" for f in recent_code
        ) + "\\n\\n"
    if recent_ideas:
        memory_context += "Recent ideas you shared:\\n" + "\\n".join(
            f"- {f['text']}" for f in recent_ideas
        ) + "\\n\\n"
    if recent_issues:
        memory_context += "Recent issues you mentioned:\\n" + "\\n".join(
            f"- {f['text']}" for f in recent_issues
        ) + "\\n\\n"

    memory_context += f"Memory mesh summary: {mem_summary}\\n"
    memory_context += f\"\"\"Knowledge layer ingest:
kind={kg_info['kind']}
concepts={kg_info['concepts']}
\"\"\" + "\\n"

    prompt = f\"\"\"
VOIDAI AGI Knowledge Layer

User message:
{user_text}

Memory mesh:
{memory_context}
\"\"\".strip()

    return f"[VOIDAI AGI]\\n{prompt[:400]}..."
