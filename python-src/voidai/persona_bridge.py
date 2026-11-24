"""Bridge to an external PHB persona service.

The service is optional. When it is not running, callers get a readable error
string instead of an exception, which keeps the CLI and servers usable.
"""

import json
import os
import urllib.error
import urllib.request

PHB_URL = os.environ.get("PHB_API_URL", "http://localhost:8000").rstrip("/")
PHB_TOKEN = os.environ.get("PHB_API_TOKEN", "")


def call_phb_persona(session_id: str, user_text: str, timeout: float = 10.0) -> str:
    payload = {
        "session_id": session_id,
        "message": user_text,
        "channel": "voidai",
        "mode": "persona",
    }
    headers = {"Content-Type": "application/json"}
    if PHB_TOKEN:
        headers["Authorization"] = "Bearer " + PHB_TOKEN
    request = urllib.request.Request(
        PHB_URL + "/api/voidai/persona",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return "[PHB persona error] status=%s" % exc.code
    except (urllib.error.URLError, TimeoutError) as exc:
        return "[PHB persona unreachable] %s" % getattr(exc, "reason", exc)
    if not raw or not raw.strip():
        return "[PHB persona error] empty response"
    try:
        data = json.loads(raw)
    except ValueError:
        return "[PHB persona error] non-JSON response"
    if isinstance(data, dict):
        return data.get("reply", "[PHB persona: no reply field]")
    return "[PHB persona: unexpected payload]"
