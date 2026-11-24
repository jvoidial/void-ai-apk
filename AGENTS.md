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

## CI notes

- Android CI (`build.yml`) runs `./gradlew assembleDebug` and uploads `void-ai-debug`.
- iOS CI (`.github/workflows/ios-unsigned.yml`) needs an Intel macOS runner in this
  repo. `macos-14` resolves to an unsupported arm64 configuration; use
  `macos-15-intel` (or another Intel label that the account supports).
- WKWebView's `runOpenPanelWith` delegate is iOS 18.4+. On older iOS, the built-in
  file input handles images; do not remove the availability guard.

## PHB behavior

- `phb.nudge()` runs before the reply; `phb.reflect()` runs after and is saved
  to the per-user state. The reflection pass is behavioral bookkeeping, not a
  medical or physiological claim.
- Keep the mode-to-circuit mapping (`MODE_CIRCUITS`) aligned with the Worker's
  `modeCircuits` table.
- Low intent, low narrative, or coherence below reflex adds a short prompt gate;
  do not hardcode the sample snapshot values from chat reports.

## Prediction mode

- Keep `predict` aligned across `phb.MODES`, `MODE_CIRCUITS`, the CLI
  `@future`/`@predict` commands, the Worker `modeInstructions`/`modeCircuits`,
  and the frontend `requestedMode` override.
- Forecasts must use horizons, scenarios, leading indicators, falsifiers, and
  confidence labels. Never compile invented citations or exact future dates.
- `@future` uses `DEFAULT_PREDICTION_TOPIC`; `@predict TOPIC` replaces it.

## Supabase memory schema compatibility

Production uses a different memory schema than the Worker's legacy bootstrap DDL:

- `voidai_reflections`: `kind`, `content`, `weight`
- `voidai_working_memory`: `content`, `importance`, `last_used`
- `voidai_self_narrative`: `summary`

The Worker writes those columns first and falls back to the legacy
`turn/mood/insight/note`, `key/value`, and `narrative` columns. Reads accept
both shapes. Do not drop either shape without checking production data.

## Worker reflection persistence

The Worker's `runReflectionPass` uses `DEFAULT_MODEL` with a JSON-only prompt,
strips markdown fences, and falls back to writing a reflection plus an intent
row if the model response cannot be parsed. Any change here must be followed by
a real turn and a Supabase row check for `user_id = 'jacob'`; `/health` alone
does not prove persistence.

## Protein / Bio Phase 2

- `protein` is an additive mode; existing modes are unchanged.
- `POST /protein/fold` accepts a user-provided amino-acid sequence, enforces a
  benign-target attestation and biosecurity blocklist, then calls ESMFold via
  ESM Atlas. It returns PDB text and an explicit "not wet-lab validated" notice.
- `POST /protein/design` uses a CPU-only heuristic search when no external
  backend is configured. It accepts a seed/scaffold, a mutation budget, fixed
  positions, and an optional ESMFold pLDDT filter. It returns ranked candidate
  sequences with mutations and a "not validated" notice.
- With `PROTEIN_DESIGN_URL`, the same route proxies to an external design
  backend instead.
- CPU design does not require a local GPU. ESMFold filtering is remote and
  optional; it is a confidence check, not proof of function.
- Phase 2 does not create or modify Supabase tables and does not claim binding
  or laboratory results.
- Android exposes `/protein` for the chat mode, `/fold SEQUENCE` for ESMFold,
  and `/design SEQUENCE | TARGET` for CPU candidate generation.
