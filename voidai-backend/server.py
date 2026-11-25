"""VOIDAI backend HTTP server (standard library only).

Run:
    python voidai-backend/server.py

Environment:
    VOIDAI_BACKEND_HOST  default 0.0.0.0
    VOIDAI_BACKEND_PORT  default 11435
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from engine import generate_reply, sanitize_user
except Exception as exc:  # pragma: no cover - import guard
    generate_reply = None
    _IMPORT_ERROR = exc

    def sanitize_user(value):
        return str(value or "anonymous")
else:
    _IMPORT_ERROR = None

MAX_BODY = 2 * 1024 * 1024
_SECRET_ENV = (
    "VOIDAI_BACKEND_TOKEN", "VOIDAI_SERVER_TOKEN", "OPENAI_API_KEY",
    "GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY",
)


def _redact(value):
    """Strip credential-shaped text before writing it to a client or log."""
    text = "" if value is None else str(value)
    for name in _SECRET_ENV:
        secret = os.environ.get(name)
        if secret and len(secret) >= 8:
            text = text.replace(secret, "[redacted]")
    import re
    text = re.sub(r"([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+",
                  r"\1[redacted]", text, flags=re.IGNORECASE)
    text = re.sub(r"(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}",
                  r"\1[redacted]", text, flags=re.IGNORECASE)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
                  "[redacted-jwt]", text)
    return text


def _token():
    return (os.environ.get("VOIDAI_BACKEND_TOKEN") or os.environ.get("VOIDAI_SERVER_TOKEN") or "").strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "VOIDAIBackend/0.2"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        try:
            message = fmt % args
        except Exception:
            message = fmt
        sys.stderr.write("[backend] " + _redact(message) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-VOIDAI-USER, X-VOIDAI-TOKEN")

    def _authorized(self):
        token = _token()
        if not token:
            return True
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer ") and auth[7:].strip() == token:
            return True
        return (self.headers.get("X-VOIDAI-TOKEN") or "").strip() == token

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _user(self, body):
        header = self.headers.get("X-VOIDAI-USER")
        if header:
            return sanitize_user(header)
        return sanitize_user((body or {}).get("user_id"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {
                "status": "ok",
                "engine_loaded": generate_reply is not None,
            })
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if self.path not in ("/chat", "/api/chat"):
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, {"error": "invalid Content-Length"})
        if length <= 0:
            return self._send(400, {"error": "empty body"})
        if length > MAX_BODY:
            return self._send(413, {"error": "body too large"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return self._send(400, {"error": "invalid json"})
        if not isinstance(data, dict):
            return self._send(400, {"error": "body must be an object"})

        messages = data.get("messages")
        if not messages and data.get("message"):
            messages = [{"role": "user", "content": str(data["message"])}]
        if not isinstance(messages, list):
            return self._send(400, {"error": "messages must be a list"})

        user_id = self._user(data)
        if generate_reply is None:
            last_user = ""
            for message in reversed(messages):
                if isinstance(message, dict) and message.get("role") == "user":
                    last_user = message.get("content", "")
                    break
            reply = "VOIDAI Godcode stub:\nUser said:\n" + str(last_user)
        else:
            try:
                reply = generate_reply(messages, user_id=user_id)
            except TypeError:
                reply = generate_reply(messages)
            except Exception as exc:  # keep serving
                return self._send(500, {"error": "backend error: %s" % _redact(exc)})

        return self._send(200, {"reply": reply, "user_id": user_id})


def create_server(host=None, port=None):
    host = host or os.environ.get("VOIDAI_BACKEND_HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "localhost", "::1") and not _token():
        raise RuntimeError("VOIDAI_BACKEND_TOKEN is required when binding beyond loopback")
    port = int(port if port is not None else os.environ.get("VOIDAI_BACKEND_PORT", "11435"))
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def run():
    server = create_server()
    print("VOIDAI backend running on %s:%s" % server.server_address[:2])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
