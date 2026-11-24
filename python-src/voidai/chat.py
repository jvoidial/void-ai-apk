"""VOIDAI chat pipeline.

Ties together the PHB persona, per-user memory, the knowledge graph, the
continuity engine, the code helpers and the LLM client. Both the CLI and the
HTTP servers call :func:`answer`, so behaviour stays identical everywhere.
"""

import re

from . import config, phb
from .code_brain import best_code_context
from .code_reasoner import (
    convert_code,
    explain_code,
    fix_code,
    generate_code,
    improve_code,
    plan_code,
)
from .jules_continuity import engine_for
from .knowledge_layer import ingest, summarize_focus, summarize_map
from .llm import LLMClient
from .memory_mesh import classify, recall, store_fragment, summary
from .metacognition import self_reflect, think_steps

MAX_HISTORY = 40
MAX_MESSAGE_CHARS = 32000
MAX_CONTEXT_CHARS = 6000

_last_answer = {}

HELP_TEXT = """VOIDAI help

General:
- @help                 : show this help menu
- @state                : show PHB circuit levels
- @memory               : show what VOIDAI remembers about you
- @mode fast|deep|companion|research|coder : set the answer mode
- @clear                : clear this session's history
- @quit                 : exit the CLI

Knowledge / continuity:
- @focus TERM           : zoom in on a concept
- @map                  : show the knowledge map
- @thread TOPIC         : show a continuity thread
- @coherence            : show the continuity overview
- @sync                 : pull PHB layers back toward their targets
- @recap                : one-line recap of the previous answer

Thinking:
- @reason TEXT          : show reasoning steps
- @reflect              : reflect on the last answer

Code:
- @code SPEC            : generate code from a spec
- @fix CODE             : fix / debug code
- @improve CODE         : refactor / improve code
- @explain CODE         : explain code
- @plan SPEC            : plan architecture / modules
- @convert LANG CODE    : convert code to a target language"""


def user_key(user_id=None, session_id=None):
    return config.sanitize_user(user_id or session_id or None)


def _command(uid, text):
    """Run a @command. Returns (handled, result)."""
    if text == "@help":
        return True, HELP_TEXT
    if text == "@state":
        return True, phb.describe(phb.load_state(uid))
    if text == "@memory":
        counts = summary(uid)
        if not counts:
            return True, "No memory stored yet."
        lines = ["Memory for %s:" % uid]
        for kind in sorted(counts):
            lines.append("  %-10s %d" % (kind, counts[kind]))
        return True, "\n".join(lines)
    if text.startswith("@focus "):
        return True, summarize_focus(text[len("@focus "):].strip(), user=uid)
    if text == "@map":
        return True, summarize_map(user=uid)
    if text.startswith("@thread "):
        return True, engine_for(uid).continuity_view(text[len("@thread "):].strip())
    if text == "@coherence":
        return True, engine_for(uid).global_coherence()
    if text in ("@sync", "@sync now"):
        state = phb.sync(phb.load_state(uid))
        phb.save_state(state, uid)
        return True, "Synced.\n" + phb.describe(state)
    if text in ("@recap", "@recap now"):
        last = _last_answer.get(uid, "").strip()
        if not last:
            return True, "No previous answer to recap yet."
        sentence = re.split(r"(?<=[.!?])\s+", last)[0]
        if len(sentence) > 300:
            sentence = sentence[:297].rstrip() + "..."
        return True, "Recap: " + sentence
    if text.startswith("@reason "):
        return True, think_steps(text[len("@reason "):].strip())
    if text == "@reflect":
        return True, self_reflect(_last_answer.get(uid, "No previous answer stored."))

    code_commands = (
        ("@code ", lambda arg: generate_code(arg, user=uid)),
        ("@fix ", lambda arg: fix_code(arg, user=uid)),
        ("@improve ", lambda arg: improve_code(arg, user=uid)),
        ("@explain ", lambda arg: explain_code(arg, user=uid)),
        ("@plan ", lambda arg: plan_code(arg, user=uid)),
    )
    for prefix, handler in code_commands:
        if text.startswith(prefix):
            reply = handler(text[len(prefix):].strip())
            _last_answer[uid] = reply
            return True, reply

    if text.startswith("@convert "):
        parts = text.split(" ", 2)
        if len(parts) < 3:
            return True, "Usage: @convert TARGET_LANG CODE"
        reply = convert_code(parts[2], parts[1], user=uid)
        _last_answer[uid] = reply
        return True, reply

    return False, None


def _memory_context(uid, user_text, kind):
    lines = []
    recent_code = recall("code", limit=3, user=uid)
    recent_ideas = recall("ideas", limit=3, user=uid)
    recent_issues = recall("issues", limit=3, user=uid)
    if recent_code:
        lines.append("Recent code:")
        lines.extend("- " + f["text"] for f in recent_code)
    if recent_ideas:
        lines.append("Recent ideas:")
        lines.extend("- " + f["text"] for f in recent_ideas)
    if recent_issues:
        lines.append("Recent issues:")
        lines.extend("- " + f["text"] for f in recent_issues)

    code_ctx = best_code_context(limit=5, user=uid)
    if code_ctx:
        lines.append("Code/math/science context:")
        lines.append(code_ctx)

    counts = summary(uid)
    if counts:
        lines.append("Memory counts: " + ", ".join("%s=%d" % item for item in sorted(counts.items())))

    graph_info = ingest(user_text, user=uid)
    topic, _ = engine_for(uid).add_voxel(graph_info["concepts"], kind, user_text)
    lines.append("Continuity topic: %s (%d items)" % (topic, len(engine_for(uid).threads[topic])))
    lines.append("Extracted concepts: " + ", ".join(graph_info["concepts"][:10]))

    context = "\n".join(lines)
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS] + "\n...[context trimmed]"
    return context


def answer(session_id=None, user_text="", user_id=None, history=None, mode=None, client=None):
    """Answer one turn.

    ``history`` (optional) is a mutable list of ``{"role", "content"}`` dicts.
    When provided, the user turn and the reply are appended to it.
    """
    uid = user_key(user_id=user_id, session_id=session_id)
    text = (user_text or "").strip()
    if not text:
        return ""
    if len(text) > MAX_MESSAGE_CHARS:
        raise ValueError(
            "message too long (max %d chars)" % MAX_MESSAGE_CHARS
        )

    handled, result = _command(uid, text)
    if handled:
        return result

    kind = classify(text)
    store_fragment(kind, text, user=uid)

    state = phb.load_state(uid)
    state = phb.nudge(state, text)
    phb.save_state(state, uid)

    context = _memory_context(uid, text, kind)
    messages = [{"role": "system", "content": phb.system_prompt(mode or "fast", state=state)}]
    if context:
        messages.append({"role": "system", "content": "INTERNAL CONTEXT (do not quote verbatim):\n" + context})
    if history:
        for item in history[-MAX_HISTORY:]:
            if not isinstance(item, dict):
                continue
            if item.get("role") in ("user", "assistant") and item.get("content"):
                messages.append({"role": item["role"], "content": str(item["content"])})
    messages.append({"role": "user", "content": text})

    reply = (client or LLMClient()).chat(messages, max_tokens=4096, temperature=0.6)
    _last_answer[uid] = reply

    if history is not None:
        history.append({"role": "user", "content": text})
        history.append({"role": "assistant", "content": reply})
        del history[:-2 * MAX_HISTORY]

    return reply


def system_prompt_for(user_id=None, mode="fast"):
    uid = user_key(user_id=user_id)
    return phb.system_prompt(mode=mode, state=phb.load_state(uid))
