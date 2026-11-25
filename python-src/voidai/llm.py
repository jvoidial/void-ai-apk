"""Zero-dependency OpenAI-compatible chat client.

Works with OpenAI, OpenRouter, Groq, LM Studio, Ollama's OpenAI shim, or any
endpoint that implements POST /chat/completions. Only the standard library is
used so the CLI runs on a bare Python install.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

VALID_ROLES = ("system", "user", "assistant")


class LLMError(RuntimeError):
    def __init__(self, message, status=None, body=None):
        super().__init__(config.redact(message))
        self.status = status
        self.body = config.redact(body)


def _clean_messages(messages):
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a non-empty list")
    cleaned = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("each message must be an object")
        role = message.get("role")
        if role not in VALID_ROLES:
            raise ValueError("invalid role: %r" % (role,))
        content = message.get("content")
        if content is None:
            continue
        cleaned.append({"role": role, "content": str(content)})
    if not cleaned:
        raise ValueError("messages contained no content")
    return cleaned


class LLMClient:
    def __init__(self, api_key=None, base_url=None, model=None, timeout=60,
                 max_retries=1, extra_headers=None):
        self.api_key = api_key if api_key is not None else config.api_key()
        self.base_url = (base_url or config.base_url()).rstrip("/")
        self.model = model or config.model()
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self.extra_headers = dict(extra_headers or {})

    def endpoint(self):
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return self.base_url + "/chat/completions"

    def _local_endpoint(self):
        host = urllib.parse.urlparse(self.base_url).hostname or ""
        return host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local")

    def configured(self):
        return bool(self.api_key) or self._local_endpoint()

    def describe(self):
        return {
            "base_url": config.redact(self.base_url),
            "model": self.model,
            "key_set": self.configured(),
        }

    def chat(self, messages, model=None, max_tokens=4096, temperature=0.6, timeout=None):
        if not self.configured():
            raise LLMError(
                "No API key configured. Set OPENAI_API_KEY (or VOIDAI_GPT_KEY), "
                "or point --base-url at a local model server."
            )
        payload = {
            "model": model or self.model,
            "messages": _clean_messages(messages),
            "max_tokens": int(max_tokens),
            "temperature": float(temperature),
        }
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        headers.update(self.extra_headers)
        request = urllib.request.Request(self.endpoint(), data=body, headers=headers, method="POST")
        timeout = timeout if timeout is not None else self.timeout

        attempt = 0
        while True:
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    raw = response.read().decode("utf-8", "replace")
                return self._extract(raw)
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace") if exc.fp else ""
                if exc.code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                    attempt += 1
                    time.sleep(0.5 * attempt)
                    continue
                raise LLMError(self._error_message(exc.code, raw), status=exc.code, body=raw)
            except urllib.error.URLError as exc:
                raise LLMError("Cannot reach %s: %s" % (self.endpoint(), exc.reason))
            except TimeoutError:
                raise LLMError("Request to %s timed out" % self.endpoint())

    def complete(self, prompt, system=None, **kwargs):
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return self.chat(messages, **kwargs)

    @staticmethod
    def _error_message(status, raw):
        message = ""
        try:
            data = json.loads(raw) if raw and raw.strip() else None
        except ValueError:
            data = None
        if isinstance(data, dict):
            error = data.get("error")
            if isinstance(error, dict):
                message = error.get("message") or ""
            elif isinstance(error, str):
                message = error
            if not message:
                message = data.get("message") or ""
        if not message:
            message = (raw or "").strip()[:300]
        return "HTTP %s%s" % (status, (": " + message) if message else "")

    @staticmethod
    def _extract(raw):
        if not raw or not raw.strip():
            raise LLMError("Empty response from model endpoint")
        try:
            data = json.loads(raw)
        except ValueError:
            raise LLMError("Model endpoint returned non-JSON: " + raw.strip()[:200])
        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            error = data.get("error") if isinstance(data, dict) else None
            detail = error.get("message") if isinstance(error, dict) else (error or data)
            raise LLMError("No choices in response: %s" % (detail,))
        message = choices[0].get("message") or {}
        content = message.get("content")
        if content is None:
            raise LLMError("Response contained no message content")
        return str(content)
