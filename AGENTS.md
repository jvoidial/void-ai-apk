# AGENTS.md

VOIDAI has four runtime surfaces:

- `android-app/app/src/main/assets/index.html` - Android WebView UI (single file).
- `cloudflare-worker/worker.js` - Worker that talks to Groq/OpenRouter/Gemini and Supabase.
- `python-src/voidai/` - CLI, HTTP server and PHB layer (standard library only).
- `ios-app/` - WKWebView clone; the build copies the shared Android `index.html`.

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

    # iOS unsigned IPA (macOS + Xcode + XcodeGen)
    cd ios-app && ./build-unsigned-ipa.sh

    # Syntax checks
    node --check cloudflare-worker/worker.js
    python3 -m py_compile $(find python-src voidai-backend -name '*.py')

## Conventions

- Keep the Python core dependency-free; `networkx`, `pandas`, `flask` are optional extras.
- All per-user data goes under `$VOIDAI_HOME/users/<id>/` through `voidai.config`.
- Every user id passes through `config.sanitize_user` before it touches the filesystem.
- Credentials come from environment variables. Never hardcode keys in source or tests.
- The Cloudflare Worker and Supabase wiring are load-bearing; do not change keys or bindings.
- The six PHB layers are a style guide, not a medical or physiological claim.
  Keep Android, iOS, Worker and Python persona copy aligned.
- Keep image support end to end: Android needs `WebChromeClient` file chooser,
  iOS needs `WKUIDelegate`/PHPicker, and the web layer downscales before `/vision`.
- Both Python servers return CORS headers and support an optional bearer token
  (`VOIDAI_SERVER_TOKEN`, `VOIDAI_BACKEND_TOKEN`).
