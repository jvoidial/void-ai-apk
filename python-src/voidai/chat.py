from .memory_mesh import classify, store_fragment, recall, summary

def answer(session_id: str, user_text: str) -> str:
    kind = classify(user_text)
    frag = store_fragment(kind, user_text)

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

    prompt = f\"\"\"
You are VOIDAI with a persistent GPT-style memory mesh.

User message:
{user_text}

Memory mesh context:
{memory_context}
\"\"\".strip()

    # Replace this with your GPT/DeepSeek call
    reply = f"[VOIDAI MEMORY MESH]\\n{prompt[:300]}..."

    return reply
