from .memory_mesh import classify, store_fragment, recall, summary
from .knowledge_layer import ingest, summarize_focus, summarize_map
from .jules_continuity import JULES
from .code_brain import best_code_context
from .metacognition import think_steps, self_reflect
from .gpt_client import call_gpt
from .code_reasoner import (
    generate_code,
    fix_code,
    improve_code,
    explain_code,
    plan_code,
    convert_code,
)

_last_answer = {}

HELP_TEXT = \"\"\"VOIDAI Help Menu

General:
- @help                 : show this help menu

Knowledge / continuity:
- @focus TERM           : zoom in on a concept
- @map                  : show global knowledge map
- @thread TOPIC         : show continuity thread
- @coherence            : show global continuity overview

Thinking:
- @reason TEXT          : show reasoning steps
- @reflect              : reflect on last answer

Code (all languages):
- @code SPEC            : generate code from a spec
- @fix CODE             : fix / debug code
- @improve CODE         : refactor / improve code
- @explain CODE         : explain code
- @plan SPEC            : plan architecture / modules
- @convert LANG CODE    : convert code to target language
\"\"\"

def answer(session_id: str, user_text: str) -> str:
    global _last_answer

    txt = user_text.strip()

    if txt == "@help":
        return HELP_TEXT

    if txt.startswith("@focus "):
        return summarize_focus(txt.replace("@focus ", "", 1).strip())

    if txt == "@map":
        return summarize_map()

    if txt.startswith("@thread "):
        return JULES.continuity_view(txt.replace("@thread ", "", 1).strip())

    if txt == "@coherence":
        return JULES.global_coherence()

    if txt.startswith("@reason "):
        return think_steps(txt.replace("@reason ", "", 1).strip())

    if txt == "@reflect":
        last = _last_answer.get(session_id, "No previous answer stored.")
        return self_reflect(last)

    # Code commands
    if txt.startswith("@code "):
        spec = txt.replace("@code ", "", 1).strip()
        reply = generate_code(spec)
        _last_answer[session_id] = reply
        return reply

    if txt.startswith("@fix "):
        code = txt.replace("@fix ", "", 1).strip()
        reply = fix_code(code)
        _last_answer[session_id] = reply
        return reply

    if txt.startswith("@improve "):
        code = txt.replace("@improve ", "", 1).strip()
        reply = improve_code(code)
        _last_answer[session_id] = reply
        return reply

    if txt.startswith("@explain "):
        code = txt.replace("@explain ", "", 1).strip()
        reply = explain_code(code)
        _last_answer[session_id] = reply
        return reply

    if txt.startswith("@plan "):
        spec = txt.replace("@plan ", "", 1).strip()
        reply = plan_code(spec)
        _last_answer[session_id] = reply
        return reply

    if txt.startswith("@convert "):
        parts = txt.split(" ", 2)
        if len(parts) < 3:
            return "Usage: @convert TARGET_LANG CODE"
        target_lang = parts[1]
        code = parts[2]
        reply = convert_code(code, target_lang)
        _last_answer[session_id] = reply
        return reply

    # Normal chat path with full brain context, but UI sees only GPT reply
    kind = classify(user_text)
    store_fragment(kind, user_text)
    kg_info = ingest(user_text)
    topic, _ = JULES.add_voxel(kg_info["concepts"], kind, user_text)

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
You are VOIDAI, a Copilot-style assistant.

User message:
{user_text}

Internal context:
{memory_context}
\"\"\".strip()

    reply = call_gpt(prompt)
    _last_answer[session_id] = reply
    return reply
