from .memory_mesh import recall


def best_code_context(limit=5, user=None):
    code_snips = recall("code", limit=limit, user=user)
    math_snips = recall("math", limit=limit, user=user)
    sci_snips = recall("science", limit=limit, user=user)

    ctx = ""
    if code_snips:
        ctx += "Recent code snippets:\n" + "\n".join(f"- {c['text']}" for c in code_snips) + "\n\n"
    if math_snips:
        ctx += "Recent math notes:\n" + "\n".join(f"- {m['text']}" for m in math_snips) + "\n\n"
    if sci_snips:
        ctx += "Recent science notes:\n" + "\n".join(f"- {s['text']}" for s in sci_snips) + "\n\n"
    return ctx.strip()
