"""End-to-end tests for the VOIDAI CLI, HTTP server and backend.

The tests run the real code against a local OpenAI-compatible HTTP server.
Nothing under test is mocked.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_SRC = os.path.join(ROOT, "python-src")
BACKEND = os.path.join(ROOT, "voidai-backend")
sys.path.insert(0, PY_SRC)


class FakeOpenAI(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    requests = []
    auth_headers = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {}
        FakeOpenAI.requests.append(payload)
        FakeOpenAI.auth_headers.append(self.headers.get("Authorization"))
        model = payload.get("model")
        if model == "empty-model":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if model == "error-model":
            body = json.dumps({"error": {"message": "boom"}}).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        last_user = ""
        for message in reversed(payload.get("messages") or []):
            if message.get("role") == "user":
                last_user = message.get("content") or ""
                break
        body = json.dumps({
            "choices": [{"message": {"role": "assistant", "content": "ECHO: " + last_user}}]
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_fake_openai():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOpenAI)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, "http://127.0.0.1:%d/v1" % server.server_address[1]


@contextmanager
def patched_env(**values):
    saved = {}
    for key, value in values.items():
        saved[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class BaseCase(unittest.TestCase):
    server = None
    base_url = None
    home = None

    @classmethod
    def setUpClass(cls):
        cls.server, cls.base_url = start_fake_openai()
        cls.home = tempfile.mkdtemp(prefix="voidai-test-")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.home, ignore_errors=True)

    def cli(self, *args, env=None):
        full_env = {
            "PATH": os.environ.get("PATH", ""),
            "PYTHONPATH": PY_SRC,
            "VOIDAI_HOME": self.home,
            "OPENAI_BASE_URL": self.base_url,
            "OPENAI_API_KEY": "test-key",
        }
        full_env.update(env or {})
        full_env = {k: v for k, v in full_env.items() if v is not None}
        return subprocess.run(
            [sys.executable, "-m", "voidai"] + list(args),
            env=full_env,
            capture_output=True,
            text=True,
            timeout=60,
        )


class LLMClientTests(BaseCase):
    def test_success(self):
        from voidai.llm import LLMClient
        with patched_env(OPENAI_API_KEY="k", OPENAI_BASE_URL=self.base_url):
            reply = LLMClient().chat([{"role": "user", "content": "hi"}])
        self.assertEqual(reply, "ECHO: hi")

    def test_empty_204_raises(self):
        from voidai.llm import LLMClient, LLMError
        with patched_env(OPENAI_API_KEY="k", OPENAI_BASE_URL=self.base_url):
            with self.assertRaises(LLMError) as caught:
                LLMClient().chat([{"role": "user", "content": "hi"}], model="empty-model")
        self.assertIn("Empty response", str(caught.exception))

    def test_http_error_raises(self):
        from voidai.llm import LLMClient, LLMError
        with patched_env(OPENAI_API_KEY="k", OPENAI_BASE_URL=self.base_url):
            with self.assertRaises(LLMError) as caught:
                LLMClient(max_retries=0).chat([{"role": "user", "content": "hi"}], model="error-model")
        self.assertEqual(caught.exception.status, 400)
        self.assertIn("boom", str(caught.exception))

    def test_missing_key(self):
        from voidai.llm import LLMClient, LLMError
        with patched_env(OPENAI_API_KEY=None, VOIDAI_GPT_KEY=None, VOIDAI_API_KEY=None,
                         OPENROUTER_API_KEY=None, OPENAI_BASE_URL="https://api.openai.com/v1"):
            with self.assertRaises(LLMError):
                LLMClient().chat([{"role": "user", "content": "hi"}])

    def test_local_endpoint_without_key(self):
        from voidai.llm import LLMClient
        with patched_env(OPENAI_API_KEY=None, OPENAI_BASE_URL=self.base_url):
            self.assertEqual(LLMClient().chat([{"role": "user", "content": "local"}]),
                             "ECHO: local")

    def test_rejects_bad_messages(self):
        from voidai.llm import LLMClient
        with patched_env(OPENAI_API_KEY="k", OPENAI_BASE_URL=self.base_url):
            with self.assertRaises(ValueError):
                LLMClient().chat([{"role": "tool", "content": "x"}])


class PHBTests(BaseCase):
    def test_prompt_contains_basis(self):
        from voidai import phb
        prompt = phb.system_prompt("deep")
        for token in ("PHB BASIS", "phb-human-agent-v2", "PHB LAYERS",
                      "REASONING CIRCUITS", "coherence", "reflex", "working",
                      "circuit", "intent", "narrative",
                      "not a physiological or medical measurement", "built by Jacob"):
            self.assertIn(token, prompt)
        self.assertIn("step by step", prompt)

    def test_nudge_moves_layers_and_clamps(self):
        from voidai import phb
        state = phb.nudge(phb.DEFAULT_STATE, "debug this function and prove the algorithm")
        self.assertGreater(state["working"], phb.DEFAULT_STATE["working"])
        self.assertGreater(state["intent"], phb.DEFAULT_STATE["intent"])
        extreme = {name: 1.0 for name in phb.LAYERS}
        again = phb.nudge(extreme, "why? what if? code")
        self.assertTrue(all(0.0 <= value <= 1.0 for value in again.values()))

    def test_sync_moves_toward_targets(self):
        from voidai import phb
        state = phb.sync({name: 0.2 for name in phb.LAYERS})
        self.assertTrue(all(state[name] > 0.2 for name in phb.LAYERS))
        self.assertTrue(all(state[name] <= phb.DEFAULT_TARGETS[name] for name in phb.LAYERS))

    def test_state_roundtrip_per_user(self):
        from voidai import phb
        with patched_env(VOIDAI_HOME=self.home):
            phb.save_state({"intent": 0.9}, "state-user")
            self.assertAlmostEqual(phb.load_state("state-user")["intent"], 0.9)
            self.assertAlmostEqual(phb.load_state("other-user")["intent"], 0.7)


class ChatCommandTests(BaseCase):
    def test_sync_and_recap(self):
        from voidai import chat

        class Stub:
            model = "stub"
            def chat(self, messages, **kwargs):
                return "First sentence. Second sentence."

        with patched_env(VOIDAI_HOME=self.home):
            reply = chat.answer(user_id="recap-user", user_text="hello", client=Stub())
            self.assertIn("First sentence", reply)
            self.assertEqual(
                chat.answer(user_id="recap-user", user_text="@recap", client=Stub()),
                "Recap: First sentence.",
            )
            self.assertIn(
                "PHB layers",
                chat.answer(user_id="recap-user", user_text="@sync", client=Stub()),
            )


class ConfigTests(BaseCase):
    def test_sanitize_user(self):
        from voidai import config
        self.assertEqual(config.sanitize_user("../../etc/passwd"), "etc-passwd")
        fallback = config.sanitize_user("")
        self.assertTrue(fallback)
        self.assertNotIn("/", fallback)
        self.assertNotIn("..", fallback)

    def test_memory_is_per_user(self):
        from voidai import memory_mesh
        with patched_env(VOIDAI_HOME=self.home):
            memory_mesh.store_fragment("code", "alice snippet", user="alice")
            memory_mesh.store_fragment("code", "bob snippet", user="bob")
            self.assertEqual([f["text"] for f in memory_mesh.recall("code", user="alice")], ["alice snippet"])
            self.assertEqual([f["text"] for f in memory_mesh.recall("code", user="bob")], ["bob snippet"])


class CLITests(BaseCase):
    def test_one_shot(self):
        result = self.cli("--user", "oneshot", "hello there")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ECHO: hello there")

    def test_json_output(self):
        result = self.cli("--user", "jsonuser", "--json", "hi")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["reply"], "ECHO: hi")
        self.assertEqual(data["user"], "jsonuser")
        self.assertEqual(data["mode"], "fast")

    def test_local_command_without_key(self):
        result = self.cli("--user", "nokey", "@help", env={"OPENAI_API_KEY": None})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("VOIDAI help", result.stdout)

    def test_local_endpoint_without_key(self):
        result = self.cli("--user", "localmodel", "hello local", env={"OPENAI_API_KEY": None})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ECHO: hello local")

    def test_missing_key_fails_cleanly(self):
        result = self.cli("--user", "nokey", "hi",
                          env={"OPENAI_API_KEY": None,
                               "OPENAI_BASE_URL": "https://api.openai.com/v1"})
        self.assertEqual(result.returncode, 3)
        self.assertIn("No API key", result.stderr)

    def test_print_system_without_key(self):
        result = self.cli("--print-system", env={"OPENAI_API_KEY": None})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PHB BASIS", result.stdout)

    def test_message_too_long(self):
        result = self.cli("--user", "longuser", "x" * 33000)
        self.assertEqual(result.returncode, 2)
        self.assertIn("too long", result.stderr)

    def test_user_isolation(self):
        self.assertEqual(self.cli("--user", "alice", "remember this").returncode, 0)
        alice = self.cli("--user", "alice", "@memory")
        bob = self.cli("--user", "bob", "@memory")
        self.assertIn("Memory for alice", alice.stdout)
        self.assertIn("general", alice.stdout)
        self.assertIn("No memory stored yet", bob.stdout)

    def test_phb_prompt_and_history_are_sent(self):
        marker = "history-marker-12345"
        self.assertEqual(self.cli("--user", "histuser", "first turn").returncode, 0)
        result = self.cli("--user", "histuser", marker)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = FakeOpenAI.requests[-1]
        self.assertEqual(payload["max_tokens"], 4096)
        self.assertIn("PHB BASIS", payload["messages"][0]["content"])
        roles = [m["role"] for m in payload["messages"]]
        self.assertEqual(roles[:2], ["system", "system"])
        self.assertEqual(roles[-2:], ["assistant", "user"])
        self.assertEqual(payload["messages"][-2]["content"], "ECHO: first turn")
        self.assertEqual(payload["messages"][-1]["content"], marker)

    def test_no_memory_flag(self):
        self.assertEqual(self.cli("--user", "nomem", "alpha").returncode, 0)
        result = self.cli("--user", "nomem", "--no-memory", "beta")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = FakeOpenAI.requests[-1]
        self.assertEqual(payload["messages"][-1]["content"], "beta")
        self.assertEqual([m["role"] for m in payload["messages"][:2]], ["system", "system"])


class ServerTests(BaseCase):
    def setUp(self):
        from voidai.server import create_server
        self.env = patched_env(
            VOIDAI_HOME=self.home,
            OPENAI_API_KEY="k",
            OPENAI_BASE_URL=self.base_url,
        )
        self.env.__enter__()
        self.srv = create_server("127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.env.__exit__(None, None, None)

    def call(self, method, path, body=None, raw=None, headers=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(
            "http://127.0.0.1:%d%s" % (self.port, path),
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, dict(response.headers), response.read().decode()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read().decode()

    def test_health(self):
        status, headers, body = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        data = json.loads(body)
        self.assertEqual(data["persona"], "phb-human-agent-v2")
        self.assertTrue(data["llm"]["key_set"])

    def test_agents(self):
        status, _, body = self.call("GET", "/api/agents")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(json.loads(body)["agents"]),
                         ["phb-sync", "void-builder", "void-identity", "void-research"])

    def test_chat_and_memory(self):
        status, headers, body = self.call("POST", "/api/chat",
                                          {"message": "server hello", "user_id": "carol"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        data = json.loads(body)
        self.assertEqual(data["response"], "ECHO: server hello")
        self.assertEqual(data["user_id"], "carol")
        status, _, body = self.call("GET", "/api/memory?user=carol")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["memory"].get("general"), 1)

    def test_agent_chat(self):
        status, _, body = self.call("POST", "/api/chat",
                                    {"message": "agent hello", "agent_id": "void-builder"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["response"], "ECHO: agent hello")
        payload = FakeOpenAI.requests[-1]
        self.assertIn("technical build agent", payload["messages"][0]["content"])

    def test_validation(self):
        self.assertEqual(self.call("POST", "/api/chat", {"message": ""})[0], 400)
        self.assertEqual(self.call("POST", "/api/chat", {"message": "x", "mode": "nope"})[0], 400)
        self.assertEqual(self.call("POST", "/api/chat", raw=b"{bad json")[0], 400)
        self.assertEqual(self.call("POST", "/api/chat", {"message": "x", "agent_id": "nope"})[0], 404)
        self.assertEqual(self.call("POST", "/api/chat", {"message": "x", "model": "error-model"})[0], 502)
        self.assertEqual(self.call("GET", "/nope")[0], 404)

    def test_options(self):
        status, headers, _ = self.call("OPTIONS", "/api/chat")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")

    def test_tool(self):
        status, _, body = self.call("POST", "/api/tool",
                                    {"tool_name": "run_router", "args": {"mode": "sync"}})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["result"]["status"], "online")
        status, _, body = self.call("POST", "/api/tool", {"tool_name": "../etc/passwd"})
        self.assertEqual(status, 200)
        self.assertIn("invalid tool name", json.loads(body)["result"]["error"])

    def test_optional_token(self):
        with patched_env(VOIDAI_SERVER_TOKEN="secret"):
            self.assertEqual(self.call("GET", "/api/agents")[0], 401)
            self.assertEqual(self.call("POST", "/api/chat", {"message": "x"})[0], 401)
            self.assertEqual(self.call("GET", "/health")[0], 200)
            status, _, _ = self.call("GET", "/api/agents",
                                     headers={"Authorization": "Bearer secret"})
            self.assertEqual(status, 200)
            status, _, _ = self.call("POST", "/api/chat", {"message": "token hello"},
                                     headers={"X-VOIDAI-TOKEN": "secret"})
            self.assertEqual(status, 200)

            status, _, _ = self.call("POST", "/api/chat", {"message": "bearer hello"},
                                     headers={"Authorization": "Bearer secret"})
            self.assertEqual(status, 200)
            self.assertEqual(FakeOpenAI.auth_headers[-1], "Bearer k")


class BackendTests(BaseCase):
    def setUp(self):
        self.env = patched_env(
            VOIDAI_BACKEND_HOME=os.path.join(self.home, "backend"),
            VOIDAI_API_KEY="k",
            VOIDAI_BASE_URL=self.base_url,
            VOIDAI_MODEL="backend-model",
            VOIDAI_USER="alice",
        )
        self.env.__enter__()
        if BACKEND not in sys.path:
            sys.path.insert(0, BACKEND)
        import engine
        import server as backend_server
        self.engine = engine
        self.backend_server = backend_server

    def tearDown(self):
        self.env.__exit__(None, None, None)

    def test_generate_reply(self):
        reply = self.engine.generate_reply([{"role": "user", "content": "hi"}], user_id="alice")
        self.assertEqual(reply, "ECHO: hi")
        self.assertEqual(FakeOpenAI.requests[-1]["model"], "backend-model")

    def test_tool_memory_is_per_user(self):
        out = self.engine.apply_tools_from_reply(
            'ok\nTOOL: {"action": "save_note", "content": "likes rust"}\ndone', "alice")
        self.assertEqual(out, "ok\ndone")
        self.assertEqual([n["content"] for n in self.engine.load_memory("alice")["notes"]],
                         ["likes rust"])
        self.assertEqual(self.engine.load_memory("bob")["notes"], [])
        read = self.engine.apply_tools_from_reply('TOOL: {"action": "read_notes"}', "alice")
        self.assertIn("likes rust", read)

    def test_unconfigured_message(self):
        with patched_env(VOIDAI_API_KEY=None, DEEPSEEK_API_KEY=None,
                         OPENAI_API_KEY=None, OPENROUTER_API_KEY=None,
                         VOIDAI_BASE_URL=None, DEEPSEEK_ENDPOINT=None):
            reply = self.engine.generate_reply([{"role": "user", "content": "yo"}], user_id="alice")
        self.assertIn("not configured", reply)
        self.assertIn("yo", reply)

    def test_keyless_local_endpoint(self):
        with patched_env(VOIDAI_API_KEY=None, DEEPSEEK_API_KEY=None,
                         OPENAI_API_KEY=None, OPENROUTER_API_KEY=None,
                         VOIDAI_BASE_URL=self.base_url):
            reply = self.engine.generate_reply([{"role": "user", "content": "local"}],
                                               user_id="alice")
        self.assertEqual(reply, "ECHO: local")

    def test_server(self):
        srv = self.backend_server.create_server("127.0.0.1", 0)
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()

        def call(method, path, body=None, headers=None):
            data = json.dumps(body).encode() if body is not None else None
            request = urllib.request.Request(
                "http://127.0.0.1:%d%s" % (port, path),
                data=data, method=method,
                headers={"Content-Type": "application/json", **(headers or {})})
            try:
                with urllib.request.urlopen(request, timeout=15) as response:
                    return response.status, dict(response.headers), response.read().decode()
            except urllib.error.HTTPError as exc:
                return exc.code, dict(exc.headers), exc.read().decode()

        try:
            status, headers, body = call("GET", "/health")
            self.assertEqual(status, 200)
            self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
            self.assertTrue(json.loads(body)["engine_loaded"])

            status, _, body = call("POST", "/chat", {"message": "backend hello", "user_id": "dave"})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["reply"], "ECHO: backend hello")
            self.assertEqual(json.loads(body)["user_id"], "dave")

            self.assertEqual(call("POST", "/chat", {"messages": "bad"})[0], 400)
            self.assertEqual(call("POST", "/nope", {})[0], 404)

            with patched_env(VOIDAI_BACKEND_TOKEN="secret"):
                self.assertEqual(call("POST", "/chat", {"message": "x"})[0], 401)
                self.assertEqual(call("GET", "/health")[0], 200)
                status, _, _ = call("POST", "/chat", {"message": "token hello"},
                                    headers={"Authorization": "Bearer secret"})
                self.assertEqual(status, 200)
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
