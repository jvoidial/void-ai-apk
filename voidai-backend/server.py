import json
from http.server import BaseHTTPRequestHandler, HTTPServer

try:
    from phb_godcode_vortex.engine import generate_reply
except:
    generate_reply = None

class Handler(BaseHTTPRequestHandler):
    def _set_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

    def do_POST(self):
        if self.path != "/chat":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")

        try:
            data = json.loads(body)
            messages = data.get("messages", [])
        except:
            messages = []

        if generate_reply:
            reply = generate_reply(messages)
        else:
            last_user = ""
            for m in reversed(messages):
                if m.get("role") == "user":
                    last_user = m.get("content", "")
                    break
            reply = f"VOIDAI Godcode stub:\\nUser said:\\n{last_user}"

        self._set_headers()
        self.wfile.write(json.dumps({"reply": reply}).encode("utf-8"))

def run():
    server = HTTPServer(("0.0.0.0", 11435), Handler)
    print("VOIDAI backend running on port 11435")
    server.serve_forever()

if __name__ == "__main__":
    run()
