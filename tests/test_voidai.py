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

    def cli(self, *args, env=None, input_text=None):
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
            input=input_text,
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
        self.assertGreater(state["narrative"], phb.DEFAULT_STATE["narrative"])
        extreme = {name: 1.0 for name in phb.LAYERS}
        again = phb.nudge(extreme, "why? what if? code")
        self.assertTrue(all(0.0 <= value <= 1.0 for value in again.values()))

    def test_modes_include_compact_and_github(self):
        from voidai import phb
        for mode in ("ultra", "mini", "github", "predict", "protein"):
            self.assertIn(mode, phb.MODES)
            self.assertIn("CIRCUIT EMPHASIS", phb.system_prompt(mode))
        self.assertIn("curiosity + openness", phb.system_prompt("fast"))
        self.assertIn("rigor + focus", phb.system_prompt("coder"))
        self.assertIn("PREDICTION MODE", phb.system_prompt("predict"))
        self.assertIn("rigor + curiosity", phb.system_prompt("predict"))
        self.assertIn("PROTEIN MODE", phb.system_prompt("protein"))
        self.assertIn("CPU design mode", phb.system_prompt("protein"))
        self.assertIn("GPT-6.2", phb.system_prompt("protein"))
        self.assertIn("rigor + curiosity", phb.system_prompt("protein"))

    def test_gates_follow_state(self):
        from voidai import phb
        low = {name: 0.2 for name in phb.LAYERS}
        low["reflex"] = 0.6
        prompt = phb.system_prompt("fast", state=low)
        for token in ("INTENT GATE", "NARRATIVE GATE", "PACING NOTE"):
            self.assertIn(token, prompt)
        high = {name: 0.9 for name in phb.LAYERS}
        prompt = phb.system_prompt("fast", state=high)
        for token in ("INTENT GATE", "NARRATIVE GATE", "PACING NOTE"):
            self.assertNotIn(token, prompt)

    def test_reflect_raises_narrative_and_rebalances(self):
        from voidai import phb
        base = {name: 0.3 for name in phb.LAYERS}
        base["reflex"] = 0.6
        state = phb.reflect(base, "hello", "A long answer. " * 100)
        self.assertGreater(state["narrative"], 0.3)
        self.assertGreater(state["intent"], 0.3)
        self.assertGreater(state["coherence"], 0.3)
        self.assertTrue(all(0.0 <= value <= 1.0 for value in state.values()))

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
            from voidai import phb
            self.assertGreater(
                phb.load_state("recap-user")["narrative"],
                phb.DEFAULT_STATE["narrative"],
            )

    def test_predict_command_uses_prediction_mode(self):
        from voidai import chat

        class RecordingStub:
            model = "stub"
            def __init__(self):
                self.calls = []
            def chat(self, messages, **kwargs):
                self.calls.append(messages)
                return "Forecast."

        with patched_env(VOIDAI_HOME=self.home):
            stub = RecordingStub()
            self.assertEqual(
                chat.answer(user_id="future-user", user_text="@future", client=stub),
                "Forecast.",
            )
            self.assertIn("PREDICTION MODE", stub.calls[0][0]["content"])
            self.assertIn("Forecast: the future of AI", stub.calls[0][-1]["content"])

            stub2 = RecordingStub()
            chat.answer(user_id="future-user", user_text="@predict quantum computing", client=stub2)
            self.assertIn("Forecast: quantum computing", stub2.calls[0][-1]["content"])


class ConfigTests(BaseCase):
    def test_sanitize_user(self):
        from voidai import config
        self.assertEqual(config.sanitize_user("../../etc/passwd"), "etc-passwd")
        fallback = config.sanitize_user("")
        self.assertTrue(fallback)
        self.assertNotIn("/", fallback)
        self.assertNotIn("..", fallback)

    def test_redacts_secret_values_and_urls(self):
        from voidai import config
        with patched_env(OPENAI_API_KEY="unit-test-key-123456789"):
            text = config.redact(
                "key unit-test-key-123456789 at https://example.test?key=abc123456789 "
                "Bearer abcdefghijklmnop"
            )
        self.assertNotIn("unit-test-key-123456789", text)
        self.assertNotIn("abc123456789", text)
        self.assertNotIn("abcdefghijklmnop", text)
        self.assertGreaterEqual(text.count("[redacted]"), 3)

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

    def test_predict_system_prompt(self):
        result = self.cli("--mode", "predict", "--print-system",
                          env={"OPENAI_API_KEY": None})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PREDICTION MODE", result.stdout)
        self.assertIn("rigor + curiosity", result.stdout)

    def test_protein_system_prompt(self):
        result = self.cli("--mode", "protein", "--print-system",
                          env={"OPENAI_API_KEY": None})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PROTEIN MODE", result.stdout)
        self.assertIn("benign, non-pathogenic", result.stdout)
        self.assertIn("rigor + curiosity", result.stdout)

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

    def test_repl_local_commands_and_history(self):
        script = "\n".join([
            "@help",
            "@state",
            "@memory",
            "@mode builder",
            "hello from repl",
            "@history",
            "@quit",
            "",
        ])
        result = self.cli("--user", "repluser", input_text=script)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("VOIDAI help", result.stdout)
        self.assertIn("PHB layers", result.stdout)
        self.assertIn("mode set to builder", result.stdout)
        self.assertIn("ECHO: hello from repl", result.stdout)
        self.assertIn("assistant: ECHO: hello from repl", result.stdout)
        path = os.path.join(self.home, "users", "repluser", "history.json")
        with open(path, "r", encoding="utf-8") as handle:
            saved = json.load(handle)
        self.assertEqual(saved[-2]["content"], "hello from repl")
        self.assertEqual(saved[-1]["content"], "ECHO: hello from repl")

    def test_builder_mode_alias(self):
        result = self.cli("--user", "builderalias", "@builder build a bounded wave")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ECHO: build a bounded wave")
        payload = FakeOpenAI.requests[-1]
        self.assertIn("BUILDER MODE", payload["messages"][0]["content"])
        self.assertEqual(payload["messages"][-1]["content"], "build a bounded wave")

    def test_help_lists_builder(self):
        result = self.cli("--user", "helpbuilder", "@help", env={"OPENAI_API_KEY": None})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("builder", result.stdout)
        self.assertIn("@history", result.stdout)


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
        history = [{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "ECHO: earlier"}]
        status, headers, body = self.call("POST", "/api/chat",
                                          {"message": "server hello", "user_id": "carol",
                                           "history": history})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        data = json.loads(body)
        self.assertEqual(data["response"], "ECHO: server hello")
        self.assertEqual(data["user_id"], "carol")
        self.assertEqual(data["history"][-1]["content"], "ECHO: server hello")
        self.assertEqual(data["history"][-2]["content"], "server hello")
        status, _, body = self.call("GET", "/api/memory?user=carol")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["memory"].get("general"), 1)
        status, _, body = self.call("GET", "/api/history?user=ghost")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["history"], [])

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
        self.assertEqual(self.call("POST", "/api/chat",
                                    {"message": "x", "base_url": "https://evil.example/v1"})[0], 400)
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


class MemoryIdentityTests(unittest.TestCase):
    """Guard the client identity and restore paths that keep memory per user."""

    def test_worker_scopes_phb_memory_to_request_user(self):
        worker = open(os.path.join(ROOT, "cloudflare-worker", "worker.js"),
                      encoding="utf-8").read()
        self.assertIn("const memoryUserId = safeUserId(body.user_id || body.userId);", worker)
        self.assertIn("runReflectionPass(userText, assistantText, memoryUserId", worker)
        self.assertIn("saveMindState(updated, env, memoryUserId)", worker)
        for hardcoded in ("loadMindState(env, 'jacob')", "loadRecentReflections(env, 'jacob')",
                          "loadIntentState('jacob', env)", "loadSelfNarrative(env, 'jacob')",
                          "loadWorkingMemory(env, 'jacob')"):
            self.assertNotIn(hardcoded, worker)

    def test_web_client_sends_user_and_restores_session(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        self.assertIn("user_id: currentUserId()", html)
        self.assertIn("window.voidaiAdoptAccount", html)
        android = open(os.path.join(ROOT, "android-app", "app", "src", "main", "java",
                                    "com", "voidai", "app", "MainActivity.kt"),
                       encoding="utf-8").read()
        self.assertIn("private fun restoreSignedInState()", android)
        self.assertIn("override fun onResume()", android)

    def test_ios_keeps_session_and_web_storage(self):
        root = os.path.join(ROOT, "ios-app", "VOIDAI")
        auth = open(os.path.join(root, "AuthManager.swift"), encoding="utf-8").read()
        view = open(os.path.join(root, "ViewController.swift"), encoding="utf-8").read()
        self.assertIn("grant_type=pkce", auth)
        self.assertIn("kSecClassGenericPassword", auth)
        self.assertIn("config.websiteDataStore = .default()", view)
        self.assertIn("appDidBecomeActive", view)


class ConversationHistorySyncTests(unittest.TestCase):
    """Guard long history and signed-in cross-device thread storage."""

    def test_worker_accepts_longer_chat_context(self):
        worker = open(os.path.join(ROOT, "cloudflare-worker", "worker.js"),
                      encoding="utf-8").read()
        self.assertIn("const MAX_MESSAGES = 200;", worker)
        self.assertIn("const MAX_CHARS = 40000;", worker)
        self.assertIn("const MAX_TOTAL_CHARS = 180000;", worker)
        self.assertIn("const VOIDAI_CHUNK_THRESHOLD = 180000;", worker)

    def test_worker_has_scoped_conversation_archive(self):
        worker = open(os.path.join(ROOT, "cloudflare-worker", "worker.js"),
                      encoding="utf-8").read()
        for route in ("/conversations/list", "/conversations/save",
                      "/conversations/save-all", "/conversations/delete"):
            self.assertIn(route, worker)
        self.assertIn("conversationArchiveScope", worker)
        self.assertIn("CONVERSATION_ARCHIVE_SUFFIX", worker)
        self.assertIn("normalizeArchivedConversation", worker)
        self.assertIn("listArchivedConversations", worker)
        self.assertIn("deleteArchivedConversation", worker)
        self.assertIn("conversation_sync: true", worker)

    def test_client_restores_and_syncs_full_threads(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        self.assertIn("var HISTORY_TURNS = 200;", html)
        self.assertIn("var MAX_RESTORE_MSGS = 400;", html)
        self.assertIn("window.voidaiPullCloud", html)
        self.assertIn("voidaiCloudQueue", html)
        self.assertIn("voidaiMergeCloud", html)
        self.assertIn("voidaiMergeCloud(remote)", html)
        self.assertIn("/conversations/save-all", html)
        self.assertIn("voidai-sync-status", html)
        self.assertIn("voidaiCloudDelete", html)
        self.assertIn("voidai_deleted_convs", html)
        self.assertIn("currentUserId: currentUserId", html)
        self.assertIn("window.voidaiPullCloud();", html)
        self.assertIn("var previous = 'guest';", html)
        self.assertIn("localStorage.setItem('voidai_owner', 'guest')", html)

    def test_archive_storage_is_bounded_and_deletes_are_batched(self):
        worker = open(os.path.join(ROOT, "cloudflare-worker", "worker.js"),
                      encoding="utf-8").read()
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        self.assertIn("pruneArchivedConversations", worker)
        self.assertIn("weight=is.null", worker)
        self.assertIn("bulkInsertArchivedConversations", worker)
        self.assertIn("deleteArchivedConversations", worker)
        self.assertIn("ids: voidaiDeleted.slice(0, 200)", html)
        self.assertIn("delete voidaiCloudDirty[id]", html)
        self.assertIn("AbortController", html)
        self.assertIn("voidaiCloudDelete(clearedId)", html)
        self.assertIn("slice(-100).map", html)
        self.assertIn("compactSource = snapshot.slice(0, 20)", html)
        self.assertIn("compactSource.push(active)", html)


class SecurityHardeningTests(unittest.TestCase):
    """Regression guards for the security review surfaces."""

    def test_android_blocks_remote_pages_and_backup(self):
        root = os.path.join(ROOT, "android-app", "app", "src", "main")
        manifest = open(os.path.join(root, "AndroidManifest.xml"), encoding="utf-8").read()
        activity = open(os.path.join(root, "java", "com", "voidai", "app", "MainActivity.kt"),
                        encoding="utf-8").read()
        self.assertIn('android:allowBackup="false"', manifest)
        self.assertIn("allowUniversalAccessFromFileURLs = false", activity)
        self.assertIn("allowFileAccessFromFileURLs = false", activity)
        self.assertIn("shouldOverrideUrlLoading", activity)
        self.assertIn("WebResourceRequest", activity)
        self.assertIn("flowType = FlowType.PKCE", activity)
        self.assertIn('if (scheme == "blob") return false', activity)
        self.assertIn("SAFE_DATA_IMAGE", activity)
        self.assertNotIn("allowUniversalAccessFromFileURLs = true", activity)
        self.assertNotIn("sessionFromUrl", activity)

    def test_ios_rejects_unsigned_callbacks_and_remote_navigation(self):
        root = os.path.join(ROOT, "ios-app", "VOIDAI")
        auth = open(os.path.join(root, "AuthManager.swift"), encoding="utf-8").read()
        view = open(os.path.join(root, "ViewController.swift"), encoding="utf-8").read()
        self.assertIn('params["state"] == expected', auth)
        self.assertIn('params["code"]', auth)
        self.assertNotIn("importSession(params", auth)
        self.assertIn("decidePolicyFor navigationAction", view)
        self.assertIn("UIApplication.shared.open", view)
        self.assertIn("shouldPerformDownload", view)
        self.assertIn("data:image/png", view)

    def test_worker_has_no_hardcoded_identity_fallback(self):
        worker = open(os.path.join(ROOT, "cloudflare-worker", "worker.js"),
                      encoding="utf-8").read()
        self.assertNotIn("|| 'jacob'", worker)
        self.assertNotIn("return 'jacob'", worker)
        self.assertNotIn("user_id: 'jacob'", worker)
        self.assertIn("|| 'guest'", worker)

    def test_cdn_assets_use_subresource_integrity(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        self.assertEqual(html.count('integrity="sha384-'), 5)
        self.assertEqual(html.count('crossorigin="anonymous"'), 5)

    def test_feature_surfaces_remain_wired(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        worker = open(os.path.join(ROOT, "cloudflare-worker", "worker.js"),
                      encoding="utf-8").read()
        modes = ["fast", "deep", "research", "companion", "ultra", "coder",
                 "mini", "github", "predict", "protein", "builder"]
        for mode in modes:
            self.assertIn("'%s'" % mode, worker)
        self.assertIn("Modes (11)", worker)
        self.assertIn("MODE: Builder", worker)
        self.assertIn("X-Image-Fallback", worker)
        self.assertIn("useWorkersFlux", worker)
        for marker in ["voidaiOpenBuilder", "voidaiOpenLive", "voidaiOpenImage",
                       "voidaiOpenProtein", "voidaiGenerateProtein",
                       "voidaiGenerateWebGLScene", "downloadImageMaker",
                       "voidaiToggleMic", "voidaiToggleListen", "voidaiReadLast",
                       "voidaiCaptureCamera", "voidaiCaptureScreen",
                       "voidaiShowCapabilities"]:
            self.assertIn(marker, html)
        for route in ["/image", "/vision", "/protein/fold", "/protein/design",
                      "/protein/design-llm", "/brain", "/capabilities", "/diagnose"]:
            self.assertIn("pathname === '%s'" % route, worker)
        self.assertIn("const MAX_TOTAL_CHARS = 180000;", worker)
        self.assertIn("code: 'empty_upstream'", worker)

    def test_ios_photo_is_gallery_only_and_voice_is_two_way(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        swift = open(os.path.join(ROOT, "ios-app", "VOIDAI", "ViewController.swift"),
                     encoding="utf-8").read()
        plist = open(os.path.join(ROOT, "ios-app", "VOIDAI", "Info.plist"),
                     encoding="utf-8").read()
        readme = open(os.path.join(ROOT, "ios-app", "README.md"),
                      encoding="utf-8").read()

        self.assertIn("PHPickerViewController", swift)
        self.assertIn("presentPhotoPicker", swift)
        self.assertIn("voidaiAttachImage(false)", swift)
        self.assertNotIn("UIImagePickerController", swift)
        self.assertIn("Live camera is disabled on iOS", swift)
        self.assertIn("getUserMedia", swift)
        self.assertNotIn("AVCaptureSession", swift)
        self.assertIn("camera is never used for live video", readme)
        self.assertNotIn("NSCameraUsageDescription", plist)
        self.assertIn("NSPhotoLibraryUsageDescription", plist)
        self.assertIn("NSSpeechRecognitionUsageDescription", plist)
        self.assertNotIn('data-va-action="live"', html)
        self.assertNotIn('data-va-action="screen"', html)
        self.assertNotIn("VOIDAI LIVE", html)
        self.assertNotIn("data-va-live", html)
        self.assertIn("voidaiAttachImage(false)", html)
        manifest = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                     "AndroidManifest.xml"), encoding="utf-8").read()
        activity = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                     "java", "com", "voidai", "app", "MainActivity.kt"),
                        encoding="utf-8").read()
        self.assertNotIn("android.permission.CAMERA", manifest)
        self.assertNotIn("RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA", activity)
        self.assertIn("request.deny()", activity)

        self.assertIn("voiceMode: false", html)
        self.assertIn("voiceSpeaking: false", html)
        self.assertIn("function startVoiceMode()", html)
        self.assertIn("function stopVoiceMode()", html)
        self.assertIn("function resumeVoice()", html)
        self.assertIn("state.voiceMode || state.liveVoice", html)
        self.assertIn("data-va-tool=\"mic\" title=\"Two-way voice conversation\"", html)
        self.assertIn("id=\"voidai-voice-chip\"", html)
        self.assertIn("id=\"va-voice-select\"", html)
        self.assertIn("function populateVoiceSelects()", html)
        self.assertIn("u.voice = voice", html)
        self.assertIn("u.rate = state.voiceRate", html)

    def test_scene_extraction_drops_trailing_prose(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        start = html.index("  function sceneSyntaxError(code)")
        end = html.index("  function generateScene(prompt)", start)
        harness = html[start:end] + r"""
var cases = [
  "var COUNT = 1;\nfor (var i=0;i<COUNT;i++){}\nwindow.update = function(t){};\nThis scene wants more objects.",
  "Here is the scene:\nvar x = 1;\nwindow.update = function(t){};\nThis scene wants more.",
  "```javascript\nvar y = 2;\nwindow.update = function(t){};\n```\nThe scene wants more."
];
var out = cases.map(function(c) {
  var scene = extractSceneCode(c);
  return {code: scene, error: sceneSyntaxError(scene)};
});
process.stdout.write(JSON.stringify(out));
"""
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(harness)
            path = fh.name
        try:
            result = subprocess.run([node, path], check=True, text=True,
                                    capture_output=True)
            repairs = json.loads(result.stdout)
        finally:
            os.unlink(path)
        for repair in repairs:
            self.assertEqual(repair["error"], "")
            self.assertNotIn("wants", repair["code"])
            self.assertIn("window.update", repair["code"])

    def test_builder_dimension_sync(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        start = html.index("  function parseTemplate(input)")
        end = html.index("  function codeFor(key, count)", start)
        harness = html[start:end] + r"""
var cases = [
  ["build 60 bouncing objects", 3, "objects", 3],
  ["4d tesseract", 3, "tesseract", 4],
  ["5D penteract", 3, "penteract", 5],
  ["neon city", 5, "penteract", 5],
  ["3d objects", 5, "objects", 3],
  ["4-dimensional hypercube", 3, "tesseract", 4]
];
var out = cases.map(function(c) {
  var cfg = sceneConfigFor(c[0], c[1]);
  return {key: cfg.key, dim: cfg.dim, expectedKey: c[2], expectedDim: c[3]};
});
process.stdout.write(JSON.stringify(out));
"""
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(harness)
            path = fh.name
        try:
            result = subprocess.run([node, path], check=True, text=True,
                                    capture_output=True)
            repairs = json.loads(result.stdout)
        finally:
            os.unlink(path)
        for repair in repairs:
            self.assertEqual(repair["key"], repair["expectedKey"])
            self.assertEqual(repair["dim"], repair["expectedDim"])

    def test_builder_uses_prompt_in_3d_4d_and_5d(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        self.assertIn("Build the requested object itself, not a generic tesseract or penteract", html)
        self.assertIn("function isKnownSceneRequest(input)", html)
        self.assertIn("function isSimSceneRequest(input)", html)
        self.assertIn("generateScene(request);", html)
        self.assertIn("window.voidaiOpenWebGL('ai ' + prompt + ' ' + dim + 'd')", html)
        self.assertNotIn("if (cfg.dim >= 4) {\n      // 4D/5D are mathematical projections", html)

    def test_whisper_listening_path_and_service(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        server = open(os.path.join(ROOT, "local-media", "stt_server.py"),
                      encoding="utf-8").read()
        manifest = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                     "AndroidManifest.xml"), encoding="utf-8").read()
        info = open(os.path.join(ROOT, "ios-app", "VOIDAI", "Info.plist"),
                    encoding="utf-8").read()
        self.assertIn("function startWhisperMic(liveAuto)", html)
        self.assertIn("function transcribeWhisper(blob, liveAuto)", html)
        self.assertIn("fetch(state.sttUrl", html)
        self.assertIn("id=\"va-stt-url\"", html)
        self.assertIn("save-stt", html)
        self.assertIn("def do_POST(self):", server)
        self.assertIn('path not in ("/listen", "/transcribe", "/")', server)
        self.assertIn("whisper.load_model", server)
        self.assertIn('android:usesCleartextTraffic="true"', manifest)
        self.assertIn("NSAllowsLocalNetworking", info)
        ios = open(os.path.join(ROOT, "ios-app", "VOIDAI", "ViewController.swift"),
                   encoding="utf-8").read()
        android = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                    "java", "com", "voidai", "app", "MainActivity.kt"),
                       encoding="utf-8").read()
        self.assertIn("requestMediaCapturePermissionFor", ios)
        self.assertIn("type == .microphone", ios)
        self.assertIn("function startNativeMic(liveAuto)", html)
        self.assertIn("function nativeSttBridge()", html)
        self.assertIn("window.voidaiNativeSpeechResult", html)
        self.assertIn("SpeechRecognizer.createSpeechRecognizer", android)
        self.assertIn("fun startListening(): Boolean", android)
        self.assertIn("SFSpeechRecognizer(locale:", ios)
        self.assertIn("case \"startListening\":", ios)

    def test_voice_has_native_tts_fallback(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        android = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                    "java", "com", "voidai", "app", "MainActivity.kt"),
                       encoding="utf-8").read()
        ios = open(os.path.join(ROOT, "ios-app", "VOIDAI", "ViewController.swift"),
                   encoding="utf-8").read()
        self.assertIn("function nativeTtsBridge()", html)
        self.assertIn("window.voidaiNativeSpeechDone", html)
        self.assertIn("fun speak(text: String, rate: Float, pitch: Float, token: String): Boolean", android)
        self.assertIn("TextToSpeech(this)", android)
        self.assertIn("selectFemaleTtsVoice", android)
        self.assertIn("private let speechSynth = AVSpeechSynthesizer()", ios)
        self.assertIn("case \"speak\":", ios)
        self.assertIn("preferredSpeechVoice", ios)

    def test_voice_prefers_young_female_english(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        start = html.index("  function isFemaleVoice(v)")
        end = html.index("  function selectedVoice()", start)
        harness = html[start:end] + r"""
var cases = [
  [[{name:"David",lang:"en-US"},{name:"Samantha",lang:"en-US"},{name:"Zira",lang:"en-US"}]],
  [[{name:"Daniel",lang:"en-GB"},{name:"Karen",lang:"en-GB"}]],
  [[{name:"English (United States)",lang:"en-US"},{name:"Daniel",lang:"en-GB"}]],
  [[{name:"Thomas",lang:"fr-FR"},{name:"Amelie",lang:"fr-FR"}]]
];
var out = cases.map(function(c) { var v = pickPreferredVoice(c[0]); return v ? v.name : null; });
process.stdout.write(JSON.stringify(out));
"""
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(harness)
            path = fh.name
        try:
            result = subprocess.run([node, path], check=True, text=True,
                                    capture_output=True)
            picked = json.loads(result.stdout)
        finally:
            os.unlink(path)
        self.assertEqual(picked, ["Samantha", "Karen", "English (United States)", "Thomas"])
        self.assertIn("savedAutoSpeak === null ? true", html)
        self.assertIn("u.pitch = state.voiceURI ? 1.0 : 1.12", html)
        self.assertIn("VOICE: AUTO (FEMALE)", html)

    def test_builder_routes_object_prompts_by_dimension(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")

        sim_start = html.index("  function isSimSceneRequest(input)")
        sim_end = html.index("  function parsePrompt(input)", sim_start)
        sim_harness = html[sim_start:sim_end] + r"""
process.stdout.write(JSON.stringify({
  human: isSimSceneRequest("build a human"),
  tesseract: isSimSceneRequest("4d tesseract"),
  orbit: isSimSceneRequest("300 orbiting objects")
}));
"""
        known_start = html.index("  function isKnownSceneRequest(input)")
        known_end = html.index("  function codeFor(key, count)", known_start)
        known_harness = html[known_start:known_end] + r"""
process.stdout.write(JSON.stringify({
  human: isKnownSceneRequest("build a human"),
  objects: isKnownSceneRequest("60 bouncing objects"),
  explicit4d: isExplicitNDTemplate("4d tesseract")
}));
"""
        for harness, expected in (
            (sim_harness, {"human": False, "tesseract": True, "orbit": True}),
            (known_harness, {"human": False, "objects": True, "explicit4d": True}),
        ):
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
                fh.write(harness)
                path = fh.name
            try:
                result = subprocess.run([node, path], check=True, text=True,
                                        capture_output=True)
                self.assertEqual(json.loads(result.stdout), expected)
            finally:
                os.unlink(path)

    def test_builder_normalizer_strips_imports_and_global_redeclarations(self):
        html = open(os.path.join(ROOT, "android-app", "app", "src", "main",
                                 "assets", "index.html"), encoding="utf-8").read()
        start = html.index("  function sceneSyntaxError(code)")
        end = html.index("  function generateScene(prompt)", start)
        sample = """```javascript
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const mesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
scene.add(mesh);
window.update = function(t) { mesh.rotation.y = t; };
```"""
        harness = html[start:end] + "\nvar c = normalizeSceneCode(extractSceneCode(" + json.dumps(sample) + "));\nprocess.stdout.write(JSON.stringify({code: c, error: sceneSyntaxError(c)}));\n"
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(harness)
            path = fh.name
        try:
            result = subprocess.run([node, path], check=True, text=True,
                                    capture_output=True)
            normalized = json.loads(result.stdout)
        finally:
            os.unlink(path)
        self.assertEqual(normalized["error"], "")
        self.assertNotIn("import ", normalized["code"])
        self.assertNotIn("const scene", normalized["code"])
        self.assertNotIn("const camera", normalized["code"])
        self.assertNotIn("const renderer", normalized["code"])
        self.assertIn("scene.add", normalized["code"])
        self.assertIn("window.update", normalized["code"])

    def test_python_rejects_untrusted_llm_base_url(self):
        sys.path.insert(0, PY_SRC)
        from voidai import server as py_server
        self.assertEqual(py_server.safe_base_url("https://api.openai.com/v1"),
                         "https://api.openai.com/v1")
        self.assertEqual(py_server.safe_base_url("http://127.0.0.1:8080/v1"),
                         "http://127.0.0.1:8080/v1")
        self.assertIsNone(py_server.safe_base_url("https://evil.example/v1"))
        self.assertIsNone(py_server.safe_base_url("http://api.openai.com/v1"))
        with patched_env(VOIDAI_SERVER_TOKEN=None):
            with self.assertRaises(RuntimeError):
                py_server.create_server("0.0.0.0", 0)


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
