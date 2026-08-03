#!/usr/bin/env python3
"""three.js キャプチャページから POST された連番フレームをディスクへ書く。

使い方: python3 pv/tools/truth-render/capture_server.py [root] [port]
既定の root は pv/renders、port は 8932。127.0.0.1 にのみバインドする。
"""
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

KINDS = {"base", "segmentation", "instance", "edge", "depth", "normal", "probe"}
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_BODY = 64 * 1024 * 1024


def make_server(root: Path, port: int = 8932) -> ThreadingHTTPServer:
    root = Path(root)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _reply(self, status: int, text: str = ""):
            body = text.encode()
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "X-PV-Shot, X-PV-Kind, X-PV-Index, Content-Type")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self._reply(200)

        def do_GET(self):
            if self.path == "/health":
                self._reply(200, "ok")
            else:
                self._reply(404)

        def do_POST(self):
            shot = self.headers.get("X-PV-Shot", "")
            if not SAFE_NAME.match(shot):
                return self._reply(400, "bad shot id")

            if self.path == "/done":
                target = root / shot
                target.mkdir(parents=True, exist_ok=True)
                (target / "DONE").write_text("done\n")
                return self._reply(200, "ok")

            if self.path != "/frame":
                return self._reply(404)

            kind = self.headers.get("X-PV-Kind", "")
            if kind not in KINDS:
                return self._reply(400, "bad kind")

            index = self.headers.get("X-PV-Index", "")
            if not index.isdigit():
                return self._reply(400, "bad index")

            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self._reply(400, "bad length")
            body = self.rfile.read(length)

            target = root / shot / kind
            target.mkdir(parents=True, exist_ok=True)
            (target / f"{int(index):04d}.png").write_bytes(body)
            self._reply(200, "ok")

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    root_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "renders"
    port_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 8932
    srv = make_server(root_arg, port_arg)
    print(f"capture server on http://127.0.0.1:{srv.server_address[1]} -> {root_arg}")
    srv.serve_forever()
