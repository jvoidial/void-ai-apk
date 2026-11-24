"""Optional Flask API exposing chat and brain helpers.

Requires flask and flask-cors (see requirements.txt). The standard-library
server in ``voidai.server`` has no dependencies and is the recommended path.
"""

import os
import tempfile

try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:  # pragma: no cover - optional dependency
    Flask = None
    CORS = None
    jsonify = None
    request = None

try:
    from .brain_analyzer import BrainAnalyzer
    from .chatgpt_brain import ChatGPTBrain
except ImportError:  # direct execution: python brain_api.py
    from brain_analyzer import BrainAnalyzer
    from chatgpt_brain import ChatGPTBrain


def create_app():
    if Flask is None:
        raise RuntimeError("Flask is not installed. Run: pip install flask flask-cors")

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
    CORS(app)

    state = {}

    def brain():
        if "brain" not in state:
            state["brain"] = ChatGPTBrain()
        return state["brain"]

    def analyzer():
        if "analyzer" not in state:
            state["analyzer"] = BrainAnalyzer()
        return state["analyzer"]

    @app.get("/health")
    def health():
        return jsonify({
            "status": "ok",
            "brain_ready": brain().available(),
            "model": brain().model,
        })

    @app.post("/api/chat")
    def chat_endpoint():
        data = request.get_json(silent=True) or {}
        prompt = data.get("prompt") or data.get("message") or ""
        if not prompt.strip():
            return jsonify({"error": "No prompt provided"}), 400
        system = data.get("system")
        response = brain().ask(prompt, system)
        return jsonify({"response": response})

    @app.get("/api/brain/scan")
    def scan():
        return jsonify(analyzer().scan())

    @app.get("/api/brain/summary/<dataset_id>")
    def summary(dataset_id):
        return jsonify(analyzer().get_brain_summary(dataset_id))

    @app.post("/api/brain/analyze")
    def analyze():
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return jsonify({"error": "No file provided"}), 400
        suffix = os.path.splitext(upload.filename)[1].lower()
        if suffix not in (".graphml", ".csv"):
            return jsonify({"error": "Unsupported format"}), 400
        fd, target = tempfile.mkstemp(prefix="voidai-upload", suffix=suffix)
        os.close(fd)
        upload.save(target)
        try:
            return jsonify(analyzer().analyze_graph(target))
        finally:
            try:
                os.remove(target)
            except OSError:
                pass

    return app


app = create_app() if Flask is not None else None


def main():
    application = create_app()
    application.run(
        host=os.environ.get("VOIDAI_HOST", "127.0.0.1"),
        port=int(os.environ.get("VOIDAI_BRAIN_PORT", "5000")),
        debug=os.environ.get("VOIDAI_DEBUG") == "1",
    )


if __name__ == "__main__":
    main()
