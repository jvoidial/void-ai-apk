from .memory_mesh import classify, store_fragment, recall, summary
from .knowledge_layer import ingest, summarize_focus, summarize_map
from .jules_continuity import JULES

def answer(session_id: str, user_text: str) -> str:
    if user_text.startswith("@focus "):
        term = user_text.replace("@focus ", "").strip()
        return summarize_focus(term)

    if user_text.strip() == "@map":
        return summarize_map()

    if user_text.startswith("@thread "):
        topic = user_text.replace("@thread ", "").strip()
        return JULES.continuity_view(topic)

    if user_text.strip() == "@coherence":
        return JULES.global_coherence()

    kind = classify(user_text)
    frag = store_fragment(kind, user_text)
    kg_info = ingest(user_text)

    topic, voxel = JULES.add_voxel(kg_info["concepts"], kind, user_text)

    recent_code = recall("code", limit=3)
    recent_ideas = recall("ideas", limit=3)
    recent_issues = recall("issues", limit=3)

    mem_summary = summary()

    memory_context = ""
    if recent_code:
        memory_context += "Recent code:\\n" + "\\n".join(f"- {f['text']}" for f in recent_code) + "\\n\\n"
    if recent_ideas:
        memory_context += "Recent ideas:\\n" + "\\n".join(f"- {f['text']}" for f in recent_ideas) + "\\n\\n"
    if recent_issues:
        memory_context += "Recent issues:\\n" + "\\n".join(f"- {f['text']}" for f in recent_issues) + "\\n\\n"

    memory_context += f"Memory mesh summary: {mem_summary}\\n"
    memory_context += f"Continuity topic: {topic}, voxels: {len(JULES.threads[topic])}\\n"

    prompt = f\"\"\"
VOIDAI Jules Continuity Engine

User message:
{user_text}

Memory mesh + continuity:
{memory_context}
\"\"\".strip()

    return f"[VOIDAI JULES]\\n{prompt[:400]}..."
