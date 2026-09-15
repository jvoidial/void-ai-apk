<p align="center"><img src="assets/voidai-logo.png" alt="VOID AI" width="240"></p>

<h1 align="center">VOIDAI</h1>

Android app with GitHub sign-in, Supabase storage, and AI chat via Cloudflare Workers + Groq.

## Download

- **APK** — open the [latest green build](https://github.com/jvoidial/void-ai-apk/actions/workflows/build.yml), scroll to Artifacts, download `void-ai-debug`
- **Source** — [Download ZIP](https://github.com/jvoidial/void-ai-apk/archive/refs/heads/main.zip)

## Features

- Chat, code, math, reasoning — GPT-OSS 120B via Groq
- Live weather anywhere on Earth — Open-Meteo (keyless)
- Live facts — Wikipedia summary API
- Worldwide location resolver — coords, UK postcodes, US zips, landmarks, cities
- Consensus reasoning — two models in parallel, adjudication on disagreement
- Time & units — timezone clock, C-F, km-mi, kg-lb, m-ft
- Sign-in — GitHub OAuth via Supabase
- Storage — per-user files, RLS-isolated
- Cost: **$0**

## Architecture

    APK WebView -> Cloudflare Worker -> Groq (LLM)
                         |
                    Open-Meteo (weather)
                    Wikipedia  (facts)

## Verify the live Worker

    KEY=$(grep -o "VOIDAI_KEY = '[^']*'" android-app/app/src/main/assets/index.html | sed "s/VOIDAI_KEY = '//;s/'//")
    curl -H "X-VOID-KEY: $KEY" https://void-ai-proxy.jacoboliverrevellangel.workers.dev

Expected: `{"status":"ok","model":"openai/gpt-oss-120b","provider":"groq","search":false}`

## License

Personal project.
