#!/usr/bin/env python3
"""Minimal local Whisper speech-to-text service for VOIDAI.

POST raw audio bytes to /listen and receive {"text": "..."}.
The app records a short WebM/M4A clip and sends it here.
"""

import argparse
import json
import os
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = int(os.environ.get("VOIDAI_STT_MAX_BYTES", str(25 * 1024 * 1024)))
TOKEN = os.environ.get("VOIDAI_STT_TOKEN", "")
MODEL_NAME = os.environ.get("VOIDAI_WHISPER_MODEL", "tiny")
DEVICE = os.environ.get("VOIDAI_WHISPER_DEVICE", "cpu")

_model = None
_model_lock = threading.Lock()
_MODEL_SUFFIX = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/flac": ".flac",
}


def model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                import whisper
                print(f"[VOIDAI-STT] loading Whisper {MODEL_NAME} on {DEVICE}", flush=True)
                _model = whisper.load_model(MODEL_NAME, device=DEVICE)
    return _model


class Handler(BaseHTTPRequestHandler):
    server_version = "VOIDAI-STT/1.0"

    def log_message(self, fmt, *args):
        print("[VOIDAI-STT] " + (fmt % args), flush=True)

    def _headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-VOIDAI-TOKEN")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self._headers(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not TOKEN:
            return True
        supplied = self.headers.get("X-VOIDAI-TOKEN", "")
        if supplied == TOKEN:
            return True
        self._json({"error": "unauthorized"}, 401)
        return False

    def do_OPTIONS(self):
        self._headers(204)
        self.end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] not in ("/health", "/"):
            self._json({"error": "not found"}, 404)
            return
        self._json({
            "status": "ok",
            "service": "voidai-stt",
            "model": MODEL_NAME,
            "device": DEVICE,
            "loaded": _model is not None,
            "ffmpeg": bool(shutil.which("ffmpeg")),
        })

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/listen", "/transcribe", "/"):
            self._json({"error": "not found"}, 404)
            return
        if not self._authorized():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json({"error": "invalid content length"}, 400)
            return
        if length <= 0:
            self._json({"error": "empty audio body"}, 400)
            return
        if length > MAX_BYTES:
            self._json({"error": f"audio too large (max {MAX_BYTES} bytes)"}, 413)
            return
        if not shutil.which("ffmpeg"):
            self._json({"error": "ffmpeg is required for browser audio; install ffmpeg"}, 503)
            return

        body = self.rfile.read(length)
        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        suffix = _MODEL_SUFFIX.get(content_type, ".webm")
        path_name = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(body)
                path_name = tmp.name
            result = model().transcribe(path_name, fp16=False)
            text = str(result.get("text") or "").strip()
            self._json({
                "text": text,
                "language": result.get("language"),
                "model": MODEL_NAME,
            })
        except ImportError:
            self._json({
                "error": "openai-whisper is not installed",
                "hint": "pip install -r local-media/requirements-stt.txt",
            }, 503)
        except Exception as exc:
            self._json({"error": "transcription failed", "message": str(exc)[:500]}, 500)
        finally:
            if path_name:
                try:
                    os.unlink(path_name)
                except OSError:
                    pass


def main():
    global MODEL_NAME
    parser = argparse.ArgumentParser(description="VOIDAI local Whisper STT service")
    parser.add_argument("--host", default=os.environ.get("VOIDAI_STT_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOIDAI_STT_PORT", "8002")))
    parser.add_argument("--model", default=MODEL_NAME)
    args = parser.parse_args()
    MODEL_NAME = args.model
    print(f"[VOIDAI-STT] listening on http://{args.host}:{args.port}/listen", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
