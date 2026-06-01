#!/usr/bin/env python3
# ============================================================
# VOID AI Backend Server
# Pure Python • No Dependencies • Termux Safe
# ============================================================

import json, os, sys, subprocess, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime

BASE = os.path.expanduser("~/void-ai/backend")
AGENTS_DIR = os.path.join(BASE, "agents")
TOOLS_DIR = os.path.join(BASE, "tools")
MEMORY_DIR = os.path.join(BASE, "memory")

PORT = 3000

# ============================================================
# Memory System
# ============================================================

class Memory:
    def __init__(self, agent_id):
        self.path = os.path.join(MEMORY_DIR, f"{agent_id}_memory.json")
        if not os.path.exists(self.path):
            with open(self.path, "w") as f:
                json.dump({"conversations": []}, f)

    def load(self):
        with open(self.path, "r") as f:
            return json.load(f)

    def save(self, data):
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    def add(self, role, content):
        data = self.load()
        data["conversations"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "role": role,
            "content": content
        })
        self.save(data)

# ============================================================
# Agent Loader
# ============================================================

def load_agents():
    agents = {}
    for file in os.listdir(AGENTS_DIR):
        if file.endswith(".json"):
            agent_id = file.replace(".json", "")
            with open(os.path.join(AGENTS_DIR, file)) as f:
                agents[agent_id] = json.load(f)
    return agents

# ============================================================
# Model Caller (OpenRouter/OpenAI Compatible)
# ============================================================

def call_model(messages, model_name):
    api_key = self.headers.get("X-VOID-KEY", "") or os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        return "⚠️ No API key set. Please set OPENROUTER_API_KEY."

    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = json.dumps({
        "model": model_name,
        "messages": messages
    }).encode()

    req = urllib.request.Request(url, data=payload)
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read().decode())
            return data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        return f"HTTP Error: {e.code}"
    except Exception as e:
        return f"Error: {str(e)}"

# ============================================================
# Tool Runner
# ============================================================

def run_tool(tool_name, args):
    tool_path = os.path.join(TOOLS_DIR, f"{tool_name}.py")
    if not os.path.exists(tool_path):
        return {"error": "Tool not found"}

    proc = subprocess.Popen(
        ["python3", tool_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    out, err = proc.communicate(json.dumps(args))
    try:
        return json.loads(out)
    except:
        return {"error": "Invalid tool output", "stdout": out, "stderr": err}

# ============================================================
# HTTP Handler
# ============================================================

class VoidAIHandler(BaseHTTPRequestHandler):

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/api/agents":
            return self._json(200, {"agents": load_agents()})

        if self.path.startswith("/api/memory"):
            agent_id = self.path.split("=")[-1]
            mem = Memory(agent_id)
            return self._json(200, mem.load())

        # Serve web UI
        if self.path.startswith("/web"):
            path = self.path.replace("/web", "")
            if path == "" or path == "/":
                path = "/index.html"
            full = os.path.expanduser("~/void-ai/web" + path)
            if os.path.exists(full):
                self.send_response(200)
                self.end_headers()
                with open(full, "rb") as f:
                    self.wfile.write(f.read())
                return
            return self._json(404, {"error": "Not found"})

        return self._json(404, {"error": "Unknown endpoint"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode())

        if self.path == "/api/chat":
            agent_id = body["agent_id"]
            message = body["message"]
            model = body.get("model_name", "gpt-3.5-turbo")

            agents = load_agents()
            agent = agents.get(agent_id)
            if not agent:
                return self._json(404, {"error": "Agent not found"})

            mem = Memory(agent_id)
            mem.add("user", message)

            messages = [
                {"role": "system", "content": agent["system_prompt"]},
                *mem.load()["conversations"],
                {"role": "user", "content": message}
            ]

            reply = call_model(messages, model)
            mem.add("assistant", reply)

            return self._json(200, {
                "agent_id": agent_id,
                "response": reply,
                "timestamp": datetime.utcnow().isoformat()
            })

        if self.path == "/api/tool":
            agent_id = body["agent_id"]
            tool = body["tool_name"]
            args = body.get("args", {})
            result = run_tool(tool, args)
            return self._json(200, result)

        return self._json(404, {"error": "Unknown endpoint"})

# ============================================================
# Server Start
# ============================================================

print("============================================================")
print(" VOID AI Backend Server")
print("============================================================")
print(f"Running on: http://127.0.0.1:{PORT}")
print(f"Agents: {AGENTS_DIR}")
print(f"Tools:  {TOOLS_DIR}")
print(f"Memory: {MEMORY_DIR}")
print("============================================================")

HTTPServer(("127.0.0.1", PORT), VoidAIHandler).serve_forever()
