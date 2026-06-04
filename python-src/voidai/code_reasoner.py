from .gpt_client import call_gpt

BASE_SYSTEM = (
    "You are VOIDAI, a Copilot-style coding assistant. "
    "You understand all major programming languages and can generate, fix, improve, "
    "explain, plan, and convert code. Always return clean, well-formatted code blocks."
)

def _ask_gpt(task: str, user_text: str, extra: str = "") -> str:
    prompt = f\"\"\"{BASE_SYSTEM}

Task: {task}

Details:
{user_text}

Extra context:
{extra}
\"\"\".strip()
    return call_gpt(prompt)

def generate_code(spec: str, context: str = "") -> str:
    return _ask_gpt("Generate code", spec, context)

def fix_code(code: str, context: str = "") -> str:
    return _ask_gpt("Fix and debug this code", code, context)

def improve_code(code: str, context: str = "") -> str:
    return _ask_gpt("Refactor and improve this code", code, context)

def explain_code(code: str, context: str = "") -> str:
    return _ask_gpt("Explain this code in detail", code, context)

def plan_code(spec: str, context: str = "") -> str:
    return _ask_gpt("Plan the architecture and modules for this", spec, context)

def convert_code(code: str, target_lang: str, context: str = "") -> str:
    details = f"Convert this code to {target_lang}."
    full = details + "\\n\\nCode:\\n" + code
    return _ask_gpt("Convert code between languages", full, context)
