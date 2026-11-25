"""VOIDAI HTTP server (standard library only).

Run:
    python -m voidai.server
    VOIDAI_HOST=0.0.0.0 VOIDAI_PORT=3000 python -m voidai.server

Endpoints:
    GET  /health
    GET  /api/agents
    GET  /api/memory?user=<id>
    GET  /api/history?user=<id>
    POST /api/chat      {"message", "user_id"?, "session_id"?, "mode"?, "history"?}
    POST /api/tool      {"tool_name", "args"?}
    GET  /web/<path>    static files from VOIDAI_WEB_DIR (optional)
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import chat, config, phb
from .llm import LLMClient, LLMError
from .memory_mesh import summary as memory_summary

PKG_DIR = Path(__file__).resolve().parent
AGENTS_DIR = Path(os.environ.get("VOIDAI_AGENTS_DIR") or (PKG_DIR / "agents"))
TOOLS_DIR = Path(os.environ.get("VOIDAI_TOOLS_DIR") or (PKG_DIR / "tools"))
WEB_DIR = Path(os.environ.get("VOIDAI_WEB_DIR") or (PKG_DIR / "web"))
MAX_BODY = 2 * 1024 * 1024
TOOL_TIMEOUT = 60


def load_agents():
    agents = {}
    if not AGENTS_DIR.is_dir():
        return agents
    for path in sorted(AGENTS_DIR.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                agents[path.stem] = data
        except (OSError, ValueError):
            continue
    return agents


def run_tool(name, args=None):
    if not name or not isinstance(name, str) or not name.replace("-", "").replace("_", "").isalnum():
        return {"error": "invalid tool name"}
    script = TOOLS_DIR / (name + ".py")
    if not script.is_file():
        return {"error": "unknown tool: %s" % name}
    try:
        proc = subprocess.run(
            [sys.executable, str(script)],
            input=json.dumps(args or {}),
            capture_output=True,
            text=True,
            timeout=TOOL_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"error": "tool timed out"}
    except OSError as exc:
        return {"error": "tool failed to start: %s" % exc}
    if proc.returncode != 0:
        detail = (proc.stderr or "tool exited with %d" % proc.returncode).strip()[:500]
        return {"error": config.redact(detail)}
    try:
        return json.loads(proc.stdout or "{}")
    except ValueError:
        return {"error": "tool returned non-JSON", "stdout": config.redact((proc.stdout or "")[:500])}


def _safe_child(base, relative):
    try:
        target = (base / relative).resolve()
        base_resolved = base.resolve()
    except OSError:
        return None
    if target == base_resolved or base_resolved in target.parents:
        return target
    return None


class VoidAIHandler(BaseHTTPRequestHandler):
    server_version = "VOIDAI/0.2"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        try:
            message = fmt % args
        except Exception:
            message = fmt
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        sys.stderr.write("[%s] %s\n" % (stamp, config.redact(message)))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-KEY, X-VOIDAI-USER, X-VOIDAI-TOKEN")

    def _send(self, code, payload, content_type="application/json"):
        if isinstance(payload, (dict, list)):
            body = json.dumps(payload).encode("utf-8")
        elif isinstance(payload, bytes):
            body = payload
        else:
            body = str(payload).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("invalid Content-Length")
        if length <= 0:
            raise ValueError("empty body")
        if length > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ValueError("invalid json")
        if not isinstance(data, dict):
            raise ValueError("body must be a JSON object")
        return data

    def _api_key(self):
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
            server_token = config.server_token()
            if not server_token or token != server_token:
                return token
        for name in ("X-API-KEY", "X-OPENROUTER-KEY", "X-VOID-KEY"):
            value = self.headers.get(name)
            if value:
                return value.strip()
        return config.api_key()

    def _user(self, body=None):
        header = self.headers.get("X-VOIDAI-USER")
        if header:
            return config.sanitize_user(header)
        if isinstance(body, dict):
            value = body.get("user_id") or body.get("session_id")
            if value:
                return config.sanitize_user(value)
        return config.default_user()

    def _client(self, body=None, model=None):
        key = self._api_key()
        base = (body or {}).get("base_url") or None
        model = model or (body or {}).get("model_name") or (body or {}).get("model")
        return LLMClient(api_key=key, base_url=base, model=model)

    def _authorized(self):
        token = config.server_token()
        if not token:
            return True
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer ") and auth[7:].strip() == token:
            return True
        return (self.headers.get("X-VOIDAI-TOKEN") or "").strip() == token

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/health" and not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if parsed.path == "/health":
            client = self._client()
            return self._send(200, {
                "status": "ok",
                "persona": phb.PERSONA,
                "llm": client.describe(),
                "modes": sorted(phb.MODES),
            })
        if parsed.path == "/api/agents":
            return self._send(200, {"agents": load_agents()})
        if parsed.path == "/api/memory":
            query = parse_qs(parsed.query)
            uid = config.sanitize_user((query.get("user") or query.get("agent_id") or [None])[0])
            return self._send(200, {
                "user": uid,
                "memory": memory_summary(uid),
                "phb": phb.load_state(uid),
            })
        if parsed.path == "/api/history":
            query = parse_qs(parsed.query)
            uid = config.sanitize_user((query.get("user") or query.get("session_id") or [None])[0])
            messages = []
            try:
                with open(config.history_path(uid), "r", encoding="utf-8") as handle:
                    loaded = json.load(handle)
                if isinstance(loaded, list):
                    messages = [
                        {"role": item["role"], "content": str(item["content"])}
                        for item in loaded
                        if isinstance(item, dict)
                        and item.get("role") in ("user", "assistant")
                        and item.get("content")
                    ][-2 * chat.MAX_HISTORY:]
            except (OSError, ValueError):
                messages = []
            return self._send(200, {"user": uid, "history": messages})
        if parsed.path.startswith("/web/"):
            if not WEB_DIR.is_dir():
                return self._send(404, {"error": "web directory not configured"})
            target = _safe_child(WEB_DIR, parsed.path[len("/web/"):])
            if not target or not target.is_file():
                return self._send(404, {"error": "not found"})
            content_type = "text/html; charset=utf-8" if target.suffix in (".html", ".htm") else "text/plain; charset=utf-8"
            return self._send(200, target.read_bytes(), content_type)
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        try:
            body = self._read_json()
        except ValueError as exc:
            return self._send(400, {"error": str(exc)})

        if parsed.path == "/api/chat":
            return self._chat(body)
        if parsed.path == "/api/tool":
            name = body.get("tool_name") or body.get("tool")
            return self._send(200, {"tool": name, "result": run_tool(name, body.get("args") or body.get("input"))})
        return self._send(404, {"error": "not found"})

    def _chat(self, body):
        message = body.get("message") or body.get("prompt")
        if not isinstance(message, str) or not message.strip():
            return self._send(400, {"error": "message is required"})
        uid = self._user(body)
        session = config.sanitize_user(body.get("session_id") or uid)
        mode = body.get("mode") or "fast"
        if mode not in phb.MODES:
            return self._send(400, {"error": "unknown mode: %s" % mode})
        history = body.get("history")
        if history is not None and not isinstance(history, list):
            return self._send(400, {"error": "history must be a list"})

        client = self._client(body)
        agent_id = body.get("agent_id")
        try:
            if agent_id:
                agent = load_agents().get(agent_id)
                if not agent:
                    return self._send(404, {"error": "unknown agent: %s" % agent_id})
                messages = [{"role": "system", "content": agent.get("system_prompt", "")}]
                for item in (history or [])[-chat.MAX_HISTORY:]:
                    if isinstance(item, dict) and item.get("role") in ("user", "assistant") and item.get("content"):
                        messages.append({"role": item["role"], "content": str(item["content"])})
                messages.append({"role": "user", "content": message})
                reply = client.chat(messages, max_tokens=4096, temperature=0.6)
            else:
                reply = chat.answer(
                    session_id=session,
                    user_text=message,
                    user_id=uid,
                    history=history,
                    mode=mode,
                    client=client,
                )
        except ValueError as exc:
            return self._send(400, {"error": config.redact(str(exc))})
        except LLMError as exc:
            return self._send(502, {"error": config.redact(str(exc))})
        except Exception as exc:  # keep the server alive, do not leak internals
            self.log_message("chat failed: %s", config.redact(str(exc)))
            return self._send(500, {"error": "internal error"})
        payload = {
            "response": reply,
            "user_id": uid,
            "session_id": session,
            "mode": mode,
            "model": client.model,
        }
        if isinstance(history, list):
            payload["history"] = history[-2 * chat.MAX_HISTORY:]
        return self._send(200, payload)


def create_server(host=None, port=None):
    host = host or os.environ.get("VOIDAI_HOST", "127.0.0.1")
    port = int(port if port is not None else os.environ.get("VOIDAI_PORT", "3000"))
    server = ThreadingHTTPServer((host, port), VoidAIHandler)
    server.daemon_threads = True
    return server


def main():
    server = create_server()
    host, port = server.server_address[:2]
    print("VOIDAI server on http://%s:%s (persona=%s)" % (host, port, phb.PERSONA))
    print("Agents: %s" % (", ".join(sorted(load_agents())) or "none"))
    print("User home: %s" % config.home())
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        server.server_close()
    return 0


run = main

if __name__ == "__main__":
    raise SystemExit(main())
