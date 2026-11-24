"""Coding helpers built on the shared LLM client."""

from . import phb
from .llm import LLMClient

BASE_SYSTEM = (
    "You are VOIDAI, a Copilot-style coding assistant. "
    "You understand all major programming languages and can generate, fix, improve, "
    "explain, plan, and convert code. Always return clean, well-formatted code blocks."
)


def _ask(task: str, user_text: str, extra: str = "", user=None, mode="coder") -> str:
    system = phb.system_prompt(mode=mode) + "\n\n" + BASE_SYSTEM
    prompt = "Task: %s\n\nDetails:\n%s" % (task, user_text)
    if extra:
        prompt += "\n\nExtra context:\n" + extra
    return LLMClient().complete(prompt, system=system)


def generate_code(spec: str, context: str = "", user=None) -> str:
    return _ask("Generate code", spec, context, user=user)


def fix_code(code: str, context: str = "", user=None) -> str:
    return _ask("Fix and debug this code", code, context, user=user)


def improve_code(code: str, context: str = "", user=None) -> str:
    return _ask("Refactor and improve this code", code, context, user=user)


def explain_code(code: str, context: str = "", user=None) -> str:
    return _ask("Explain this code in detail", code, context, user=user)


def plan_code(spec: str, context: str = "", user=None) -> str:
    return _ask("Plan the architecture and modules for this", spec, context, user=user)


def convert_code(code: str, target_lang: str, context: str = "", user=None) -> str:
    details = "Convert this code to %s.\n\nCode:\n%s" % (target_lang, code)
    return _ask("Convert code between languages", details, context, user=user)
