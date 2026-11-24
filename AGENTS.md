# AGENTS.md

VOIDAI has three runtime surfaces:

- `android-app/app/src/main/assets/index.html` - Android WebView UI (single file).
- `cloudflare-worker/worker.js` - Worker that talks to Groq/OpenRouter/Gemini and Supabase.
- `python-src/voidai/` - CLI, HTTP server and PHB layer (standard library only).

## Commands

    # Python tests (real HTTP, no mocks)
    python3 -m unittest discover -s tests -v

    # CLI
    PYTHONPATH=python-src python3 -m voidai --user alice "explain quicksort"
    PYTHONPATH=python-src python3 -m voidai --print-system

    # HTTP server
    PYTHONPATH=python-src python3 -m voidai.server

    # Backend server
    python3 voidai-backend/server.py

    # Syntax checks
    node --check cloudflare-worker/worker.js
    python3 -m py_compile $(find python-src voidai-backend -name '*.py')

## Conventions

- Keep the Python core dependency-free; `networkx`, `pandas`, `flask` are optional extras.
- All per-user data goes under `$VOIDAI_HOME/users/<id>/` through `voidai.config`.
- Every user id passes through `config.sanitize_user` before it touches the filesystem.
- Credentials come from environment variables. Never hardcode keys in source or tests.
- The Cloudflare Worker and Supabase wiring are load-bearing; do not change keys or bindings.
- Both Python servers return CORS headers and support an optional bearer token
  (`VOIDAI_SERVER_TOKEN`, `VOIDAI_BACKEND_TOKEN`).
