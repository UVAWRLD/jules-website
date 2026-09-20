"""Static server for the prototype, plus a drop box for frame grabs.

Same as python -m http.server, with one addition: POST /_grab with a data URL in the body
writes it to tools/grabs/<name>.png. That lets a page hand back exactly what the GPU drew,
at full resolution, so renders can be judged without a screenshot of a screenshot.

    python tools/devserver.py [port]
"""
import base64, http.server, pathlib, socketserver, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRABS = ROOT / "tools" / "grabs"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_POST(self):
        if not self.path.startswith("/_grab"):
            return self.send_error(404)
        name = self.path.split("?", 1)[-1] or "grab"
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        data = body.split(",", 1)[-1]
        GRABS.mkdir(parents=True, exist_ok=True)
        out = GRABS / (name.replace("/", "_") + ".png")
        out.write_bytes(base64.b64decode(data))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(str(out).encode())

    def log_message(self, *a):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", port), Handler) as httpd:
    print(f"serving {ROOT} on http://localhost:{port}  (POST /_grab?name saves a PNG)")
    httpd.serve_forever()
