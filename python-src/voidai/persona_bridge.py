import os, requests

PHB_URL = os.getenv("PHB_API_URL", "http://localhost:8000")

def call_phb_persona(session_id: str, user_text: str) -> str:
    try:
        payload = {
            "session_id": session_id,
            "message": user_text,
            "channel": "voidai",
            "mode": "persona"
        }
        r = requests.post(f"{PHB_URL}/api/voidai/persona", json=payload, timeout=10)
        if r.status_code == 200:
            data = r.json()
            return data.get("reply", "[PHB persona: no reply field]")
        return f"[PHB persona error] status={r.status_code}"
    except Exception as e:
        return f"[PHB persona unreachable] {e}"
