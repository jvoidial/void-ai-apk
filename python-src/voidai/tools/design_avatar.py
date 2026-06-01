#!/usr/bin/env python3
import json, sys, time

data = json.load(sys.stdin)
style = data.get("style", "voidal")

time.sleep(1)

print(json.dumps({
    "style": style,
    "palette": ["#ff0a0a", "#1a1a1a", "#0a0a0a"],
    "concept": "A dark cyberpunk avatar with glowing red accents and geometric shadows.",
    "notes": "Use sharp angles, neon edges, and minimalistic VOID aesthetic."
}))
