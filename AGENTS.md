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
- Provider credentials come from environment variables. The WebView carries only the pre-existing Worker gate key; never add a Groq/OpenRouter/Gemini/Supabase-service key to source, tests, or the app.
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

## Astra layer (web UI)

- `index.html` appends a self-contained Astra script after the main app IIFE. It
  adds the toolbar (`BUILDER / CAM / MIC / READ / TOOLS`), mode selector, capability
  sheet, live camera modal, screen capture, SpeechRecognition dictation, and TTS.
- Live frame capture draws the current video frame to a canvas and sends a
  downscaled JPEG through the existing `voidaiSendImage` -> `/vision` bridge.
- Keep the camera fallback: if `getUserMedia` is unavailable or denied, the
  file input with `capture="environment"` must still open the phone camera.
- Android needs `CAMERA` and `RECORD_AUDIO` in the manifest plus
  `WebChromeClient.onPermissionRequest` runtime grants. iOS needs
  `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`.
- Slash commands are normalized by removing the leading `@` or `/`; local
  commands return before the Worker request. Do not reintroduce the old
  `replace(/^@/, '')` form.
- Keep all eleven modes aligned with `phb.MODES`, the Worker mode arrays, and
  the Astra `MODES` table.
- Never render `VOIDAI_KEY` or provider keys in the capability sheet, chat,
  logs, or artifacts. The sheet may show model/provider names and tool names.
- Full PHB system prompt stays server-side in the Worker. The client may show a
  persona summary but must not replace the Worker prompt.

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

## Image generation

- `POST /image` generates an image from a text prompt.
- It uses the Cloudflare Workers AI binding `AI` with
  `@cf/black-forest-labs/flux-1-schnell` when available, then falls back to
  Pollinations.
- No local GPU and no additional API key are required. Cloudflare account
  billing/limits apply to Workers AI.
- The endpoint blocks a small set of explicit/abusive prompts and returns
  `image_safety_block` for those.
- Android and iOS expose `/image PROMPT` (aliases `/img`, `/draw`).

## N-D simulation workbench

- `/builder` opens the editable Three.js code and live-preview builder.
- `/sim`, `/simulate`, and `/simulator` open the full-screen Canvas 2D workbench.
- 3D scenes: orbit/N-body, Lorenz attractor, wave field, and particle cloud.
- 4D/5D scenes: tesseract, penteract, N-D lattice, and N-D harmonic state curve.
  These are mathematical N-dimensional projections, not physical 4D/5D spacetime
  simulations. Keep that distinction in UI and docs.
- The workbench is self-contained: no GPU, no Worker call, no external library,
  and no network request. It supports BUILD prompt-to-preset mapping, dimension
  buttons, speed/count sliders, pause/reset, drag orbit, pinch/zoom, and PNG
  snapshot.
- Prompt examples: `/sim 4d tesseract`, `/sim 5d state`, `/sim lorenz`,
  `/sim wave`, `/sim 300 particles`.
- Do not claim that the 4D/5D views are physical dimensions or that the
  workbench is a general-purpose scientific simulator. The 3D scenes are
  real-time spatial projections; the 4D/5D scenes visualize N-D state and
  polytope geometry.

## WebGL lab and sandboxed code runner

- `/webgl`, `/gl`, `/three`, and `/threejs` open the Three.js lab. The
  simulation workbench also has a `WEBGL LAB` button.
- The lab is a real WebGL renderer (Three.js r160) inside an iframe with
  `sandbox="allow-scripts"`. It has no same-origin access, no app cookies, no
  app storage, and no network access except the Three.js CDN.
- CSP blocks `connect-src`, forms, objects, and base-URI changes. The sandbox
  is intended for editable scene code, not for untrusted third-party programs.
- Templates: orbit/N-body, wave surface, particle field, Lorenz attractor,
  4D tesseract, and 5D penteract. The 4D/5D templates are mathematical
  projections, not physical spacetime.
- The code editor runs edited JavaScript in a fresh sandboxed iframe on RUN.
  RESET restores the selected template. Code is capped at 30,000 characters.
- The sandbox does not isolate CPU or GPU usage. A runaway loop can still hang
  the WebView. Keep "run only trusted code" in the UI and do not describe this
  as a hardened arbitrary-code sandbox.
- Three.js is loaded from jsDelivr. If the CDN is blocked, the WebGL lab shows
  an error and the offline Canvas 2D workbench remains available.
