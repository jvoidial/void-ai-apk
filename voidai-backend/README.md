# VOIDAI Backend

Standard-library backend for the VOIDAI GOD-CODE engine. It runs on Termux,
Linux, macOS or a container; nothing is tied to a Termux path.

Includes:
- OpenAI/DeepSeek-compatible LLM calls
- GOD-CODE symbolic engine
- Per-user long-term memory
- Tool-calling support
- Rootless GCS integration

## Run

```
python3 voidai-backend/server.py
# or
voidai-backend/run_backend.sh
```

Endpoints: `GET /health`, `POST /chat`, `POST /api/chat`.

## Environment

| Variable | Purpose |
|---|---|
| `VOIDAI_API_KEY` | model key (falls back to `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) |
| `DEEPSEEK_ENDPOINT` / `VOIDAI_BASE_URL` | chat completions URL |
| `DEEPSEEK_MODEL` / `VOIDAI_MODEL` | model name |
| `VOIDAI_USER` | default user id |
| `VOIDAI_BACKEND_HOME` | data directory (memory, GCS defaults) |
| `VOIDAI_BACKEND_HOST` / `VOIDAI_BACKEND_PORT` | bind address (default `127.0.0.1:11435`) |
| `VOIDAI_BACKEND_TOKEN` | optional bearer token required by the server |

Each user gets their own memory file under `$VOIDAI_BACKEND_HOME/memory/`.
