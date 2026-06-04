from .memory_mesh import classify, store_fragment, recall, summary
from .knowledge_layer import ingest, summarize_focus, summarize_map
from .jules_continuity import JULES
from .code_brain import best_code_context
from .metacognition import think_steps, self_reflect

_last_answer = {}

HELP_TEXT = \"\"\"VOIDAI Help Menu

Core:
- Type normally to chat.
- Memory, knowledge, continuity and reasoning run automatically.

Commands:
- @help          : show this help menu
- @focus TERM    : zoom in on a concept
- @map           : show global knowledge map
- @thread TOPIC  : show continuity thread
- @coherence     : show global continuity overview
- @reason TEXT   : show human-style reasoning steps
- @reflect       : reflect on the last answer
\"\"\"

def answer(session_id: str, user_text: str) -> str:
    global _last_answer

    if user_text.strip() == "@help":
        return HELP_TEXT

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

    if user_text.startswith("@reason "):
        q = user_text.replace("@reason ", "").strip()
        return think_steps(q)

    if user_text.strip() == "@reflect":
        last = _last_answer.get(session_id, "No previous answer stored.")
        return self_reflect(last)

    kind = classify(user_text)
    frag = store_fragment(kind, user_text)
    kg_info = ingest(user_text)

    topic, voxel = JULES.add_voxel(kg_info["concepts"], kind, user_text)

    recent_code = recall("code", limit=3)
    recent_ideas = recall("ideas", limit=3)
    recent_issues = recall("issues", limit=3)

    mem_summary = summary()
    code_ctx = best_code_context(limit=5)

    memory_context = ""
    if recent_code:
        memory_context += "Recent code:\\n" + "\\n".join(f"- {f['text']}" for f in recent_code) + "\\n\\n"
    if recent_ideas:
        memory_context += "Recent ideas:\\n" + "\\n".join(f"- {f['text']}" for f in recent_ideas) + "\\n\\n"
    if recent_issues:
        memory_context += "Recent issues:\\n" + "\\n".join(f"- {f['text']}" for f in recent_issues) + "\\n\\n"

    if code_ctx:
        memory_context += "Code/Math/Science context:\\n" + code_ctx + "\\n\\n"

    memory_context += f"Memory mesh summary: {mem_summary}\\n"
    memory_context += f"Continuity topic: {topic}, voxels: {len(JULES.threads[topic])}\\n"
    memory_context += f"Knowledge ingest: {kg_info}\\n"

    prompt = f\"\"\"
VOIDAI Brain

User message:
{user_text}

Context:
{memory_context}
\"\"\".strip()

    answer_text = f"[VOIDAI]\\n{prompt[:400]}..."
    _last_answer[session_id] = answer_text
    return answer_text
