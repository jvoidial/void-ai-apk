import os
import requests

API_URL = "https://api.openai.com/v1/chat/completions"
API_KEY = os.getenv("VOIDAI_GPT_KEY")

def call_gpt(prompt: str) -> str:
    if not API_KEY:
        return "[GPT ERROR] API key not set."

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are VOIDAI, a Copilot-style assistant with memory, knowledge, continuity and reasoning."},
            {"role": "user", "content": prompt}
        ]
    }

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post(API_URL, json=payload, headers=headers, timeout=30)
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"[GPT ERROR] {str(e)}"
