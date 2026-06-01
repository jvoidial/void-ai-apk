#!/usr/bin/env python3
import json, sys, urllib.request, urllib.error, os

data = json.load(sys.stdin)
query = data.get("query", "")

api_key = os.environ.get("OPENROUTER_API_KEY", "")

if not api_key:
    print(json.dumps({"error": "No API key set"}))
    sys.exit(0)

payload = json.dumps({
    "model": "gpt-3.5-turbo",
    "messages": [
        {"role": "system", "content": "You are a research engine. Provide concise factual summaries."},
        {"role": "user", "content": f"Research this: {query}"}
    ]
}).encode()

req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=payload)
req.add_header("Content-Type", "application/json")
req.add_header("Authorization", f"Bearer {api_key}")

try:
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode())
        print(json.dumps({"result": data["choices"][0]["message"]["content"]}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
