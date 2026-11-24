"""Optional Google Cloud Vision / Translation helpers.

Credentials path resolution:
    $VOIDAI_GOOGLE_CREDENTIALS
    ~/void-ai-apk/config/google-cloud/credentials.json
"""

import base64
import json
import os
from pathlib import Path

import urllib.error
import urllib.request

DEFAULT_CONFIG = Path.home() / "void-ai-apk" / "config" / "google-cloud" / "credentials.json"


class GoogleAIIntegration:
    def __init__(self, config_path=None):
        path = Path(config_path or os.environ.get("VOIDAI_GOOGLE_CREDENTIALS") or DEFAULT_CONFIG).expanduser()
        if not path.is_file():
            raise FileNotFoundError(
                "Google credentials not found at %s. Set VOIDAI_GOOGLE_CREDENTIALS." % path
            )
        with open(path, "r", encoding="utf-8") as handle:
            self.config = json.load(handle)
        self.project_id = self.config.get("project_id", "")
        self.project_number = self.config.get("project_number", "")

    def _post(self, url, payload):
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8", "replace") or "{}")
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            return {"error": str(exc)}

    def _api_key(self, name):
        keys = self.config.get("api_keys") or {}
        key = keys.get(name)
        if not key:
            raise KeyError("missing api_keys.%s in Google credentials" % name)
        return key

    def analyze_image(self, image_data: bytes) -> dict:
        payload = {
            "requests": [{
                "image": {"content": base64.b64encode(image_data).decode("ascii")},
                "features": [{"type": "LABEL_DETECTION", "maxResults": 10}],
            }]
        }
        return self._post(
            "https://vision.googleapis.com/v1/images:annotate?key=" + self._api_key("vision"),
            payload,
        )

    def translate_text(self, text: str, target_lang: str = "en") -> dict:
        payload = {"q": text, "target": target_lang}
        return self._post(
            "https://translation.googleapis.com/language/translate/v2?key=" + self._api_key("translate"),
            payload,
        )

    def get_project_info(self) -> dict:
        return {
            "project_id": self.project_id,
            "project_number": self.project_number,
            "services": self.config.get("services", []),
        }
