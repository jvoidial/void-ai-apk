from .memory_mesh import classify, store_fragment, recall, summary
from .knowledge_layer import ingest, summarize_focus

def answer(session_id: str, user_text: str) -> str:
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

    focus_term = kg_info["concepts"][0] if kg_info["concepts"] else None
    if focus_term:
        knowledge_view = summarize_focus(focus_term)
    else:
        knowledge_view = "No focus term yet for knowledge graph."

    prompt = f\"\"\"
You are VOIDAI with:
- a persistent GPT-style memory mesh
- a symbolic knowledge graph (concepts + relations)

User message:
{user_text}

Memory mesh context:
{memory_context}

Knowledge graph view:
{knowledge_view}
\"\"\".strip()

    reply = f"[VOIDAI KNOWLEDGE LAYER]\\n{prompt[:400]}..."

    return reply
