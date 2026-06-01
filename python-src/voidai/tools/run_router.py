#!/usr/bin/env python3
import json, sys, time

data = json.load(sys.stdin)
mode = data.get("mode", "sync")

time.sleep(1)

print(json.dumps({
    "router_mode": mode,
    "status": "online",
    "nodes_connected": 5,
    "latency_ms": 12,
    "message": "Router sync complete."
}))
