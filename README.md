<p align="center"><img src="assets/voidai-logo.png" alt="VOID AI" width="240"></p>

<h1 align="center">VOIDAI</h1>

Android app and unsigned iOS clone with GitHub sign-in, Supabase storage, and AI chat via Cloudflare Workers + Groq.

## Download

- **APK** — open the [latest green build](https://github.com/jvoidial/void-ai-apk/actions/workflows/build.yml), scroll to Artifacts, download `void-ai-debug`
- **iOS IPA (unsigned)** — open the [iOS workflow](https://github.com/jvoidial/void-ai-apk/actions/workflows/ios-unsigned.yml), download the `VOIDAI-unsigned-ipa` artifact
- **Source** — [Download ZIP](https://github.com/jvoidial/void-ai-apk/archive/refs/heads/main.zip)

## Features

- Chat, code, math, reasoning — GPT-OSS 120B via Groq
- Live weather anywhere on Earth — Open-Meteo (keyless)
- Live facts — Wikipedia summary API
- Worldwide location resolver — coords, UK postcodes, US zips, landmarks, cities
- Consensus reasoning — two models in parallel, adjudication on disagreement
- Time & units — timezone clock, C-F, km-mi, kg-lb, m-ft
- Image vision — attach a photo, downscaled on-device, analyzed via Groq with OpenRouter fallback
- Astra live layer — live camera preview, snap-and-ask vision, screen share, voice input, spoken replies, and a continuous voice loop
- Ten modes — fast, deep, research, companion, ultra, coder, mini, github, predict, protein
- Sandboxed creative tools — Three.js/WebGL lab and Canvas N-D simulation workbench
- PHB layers — coherence, reflex, working, circuit, intent, narrative
- Sign-in — GitHub OAuth via Supabase (Android + iOS)
- Storage — per-user files, RLS-isolated
- Cost: **$0**

### Astra-style live use

Tap **LIVE** to open the camera. Ask a question in the box and tap **LOOK**, or tap
**VOICE** for a hands-free loop: VOIDAI captures the current frame, answers, and
speaks the answer. **CAM** takes a photo, **MIC** dictates into the composer,
**READ** speaks the last reply, and **TOOLS** opens the mode, routing, PHB, and
capability panel.

The same tools are available as commands:

    /live  /astra  /camera  /look PROMPT  /screen  /voice  /read  /tools
    /mode  /mode deep  /help  /sync  /recap

Android asks for camera and microphone permission the first time a live tool
uses them. iOS does the same through the usage descriptions in `Info.plist`.
The phone camera has a file-picker fallback, so photo analysis still works when
`getUserMedia` is unavailable.

### Secrets

Provider keys (Groq, OpenRouter, Gemini, Supabase service role) stay in the
Cloudflare Worker environment. The app only carries the Worker access gate and
the Supabase anon key that the existing Android build already needs. No key is
shown in the UI, chat, or capability panel. Never put a provider key in the
WebView, a bundle, a screenshot, or a commit.

## CLI (GPT, PHB basis)

The Python CLI runs on a bare Python 3.9+ install. It uses the OpenAI-compatible
API, keeps per-user memory, and applies the same PHB persona as the worker.

    PYTHONPATH=python-src python3 -m voidai "explain quicksort"
    PYTHONPATH=python-src python3 -m voidai --user alice --mode deep
    PYTHONPATH=python-src python3 -m voidai --print-system

Modes: `fast`, `deep`, `research`, `companion`, `ultra`, `coder`, `mini`,
`github`, `predict`, `protein`. Each mode sets a circuit emphasis, and the PHB
layers update after each turn through a short behavioral reflection pass.

Prediction commands:
- `@future` forecasts the default AI/AGI/robotics/biotech/energy/quantum outlook.
- `@predict TOPIC` focuses the forecast on one technology or market.
- `--mode predict "..."` uses the same forecast rules in one-shot or REPL mode.

Forecasts are explicitly speculative: they use horizons, scenarios, leading
indicators, falsifiers, and confidence labels, and the prompt forbids invented
citations or exact dates.

Or install the `voidai` command:

    pip install -e .
    voidai --help

Environment:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` (or `VOIDAI_GPT_KEY`) | model key |
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint (default `https://api.openai.com/v1`; localhost endpoints work without a key) |
| `OPENAI_MODEL` | model name (default `gpt-4o-mini`) |
| `VOIDAI_USER` | default user id (default: OS user) |
| `VOIDAI_HOME` | data directory (default `~/.local/share/voidai`) |
| `VOIDAI_SERVER_TOKEN` | optional bearer token required by the HTTP server |
| `VOIDAI_HOST` / `VOIDAI_PORT` | server bind address (default `127.0.0.1:3000`) |

Each user gets separate memory, history and PHB state under
`$VOIDAI_HOME/users/<id>/`. Local commands (`@help`, `@state`, `@memory`, `@map`,
`@sync`, `@recap`) work without a key.

HTTP server (standard library, CORS enabled):

    PYTHONPATH=python-src python3 -m voidai.server
    # GET /health, GET /api/agents, GET /api/memory?user=ID
    # POST /api/chat {"message": "...", "user_id": "alice"}

Run the tests:

    python3 -m unittest discover -s tests -v

## iOS unsigned IPA

`ios-app/` is a WKWebView clone that reuses the same `index.html`. It supports
image attachment, live camera/voice when the installed iOS runtime allows it,
and Supabase GitHub sign-in through `ASWebAuthenticationSession`.

    brew install xcodegen
    cd ios-app
    ./build-unsigned-ipa.sh

The IPA is intentionally unsigned, so it must be signed with AltStore, Sideloadly,
or your own certificate before a stock iPhone will install it. The
`ios-unsigned.yml` workflow builds the same artifact on a macOS runner.

## Architecture

    APK WebView -> Cloudflare Worker -> Groq (LLM)
         |               |          |
         |          OpenRouter    Gemini (fallbacks)
         |               |
         |          Supabase memory + storage
         |
    camera / mic / screen -> /vision (Groq, OpenRouter fallback)

## Verify the live Worker

    read -rsp "Worker gate key: " KEY; echo
    curl -H "X-VOID-KEY: $KEY" https://void-ai-proxy.jacoboliverrevellangel.workers.dev

Expected: `{"status":"ok","model":"openai/gpt-oss-120b","provider":"groq","search":false}`

## License

Personal project.
