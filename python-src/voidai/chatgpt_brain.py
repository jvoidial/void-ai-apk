"""ChatGPT-backed brain helper.

Configuration is optional. Resolution order:
1. explicit ``config_path``
2. ``$VOIDAI_CHATGPT_CONFIG``
3. ``~/.config/voidai/chatgpt.json``
4. environment variables (OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL)
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from . import config, phb
from .llm import LLMClient, LLMError

DEFAULT_CONFIG = Path.home() / ".config" / "voidai" / "chatgpt.json"


class ChatGPTBrain:
    def __init__(self, config_path: Optional[str] = None):
        data = {}
        path = Path(config_path or os.environ.get("VOIDAI_CHATGPT_CONFIG") or DEFAULT_CONFIG).expanduser()
        if path.is_file():
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    loaded = json.load(handle)
                if isinstance(loaded, dict):
                    data = loaded
            except (OSError, ValueError):
                data = {}
        self.model = data.get("model") or config.model()
        self.max_tokens = int(data.get("max_tokens") or 2048)
        self.temperature = float(data.get("temperature") if data.get("temperature") is not None else 0.7)
        self.client = LLMClient(
            api_key=data.get("api_key") or None,
            base_url=data.get("base_url") or None,
            model=self.model,
        )

    def available(self) -> bool:
        return self.client.configured()

    def ask(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        system = system_prompt or phb.system_prompt()
        try:
            return self.client.chat(
                [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                max_tokens=self.max_tokens,
                temperature=self.temperature,
            ).strip()
        except (LLMError, ValueError) as exc:
            return "Error: %s" % exc

    def ask_with_context(self, prompt: str, context: Dict[str, Any]) -> str:
        context_str = json.dumps(context, indent=2, default=str)
        return self.ask("Context:\n%s\n\nQuestion: %s" % (context_str, prompt))
