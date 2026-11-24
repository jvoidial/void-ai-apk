"""Legacy single-shot helper.

Kept for backward compatibility with earlier scripts. New code should use
``voidai.llm.LLMClient`` directly so it can pass conversation history.
"""

from . import phb
from .llm import LLMClient, LLMError


def call_gpt(prompt: str) -> str:
    try:
        return LLMClient().complete(prompt, system=phb.system_prompt())
    except (LLMError, ValueError) as exc:
        return "[GPT ERROR] %s" % exc
