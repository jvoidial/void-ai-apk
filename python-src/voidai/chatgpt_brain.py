#!/data/data/com.termux/files/usr/bin/python
"""
ChatGPT Brain for VOID AI APK
"""
import os
import json
import openai
from typing import Optional, Dict, Any

CONFIG_PATH = os.path.expanduser("~/void-ai-apk/config/chatgpt_config.json")

class ChatGPTBrain:
    def __init__(self, config_path: Optional[str] = None):
        path = config_path or CONFIG_PATH
        with open(path, 'r') as f:
            self.config = json.load(f)
        openai.api_key = self.config.get('api_key')
        self.model = self.config.get('model', 'gpt-3.5-turbo')
        self.max_tokens = self.config.get('max_tokens', 1000)
        self.temperature = self.config.get('temperature', 0.7)

    def ask(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        try:
            response = openai.ChatCompletion.create(
                model=self.model,
                messages=messages,
                max_tokens=self.max_tokens,
                temperature=self.temperature
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            return f"Error: {e}"

    def ask_with_context(self, prompt: str, context: Dict[str, Any]) -> str:
        context_str = json.dumps(context, indent=2)
        full_prompt = f"Context:\n{context_str}\n\nQuestion: {prompt}"
        return self.ask(full_prompt)
