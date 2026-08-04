#!/usr/bin/env python3
"""three.js キャプチャページから POST された連番フレームをディスクへ書く。

使い方: python3 pv/tools/truth-render/capture_server.py [root] [port]
既定の root は pv/renders、port は 8932。127.0.0.1 にのみバインドする。
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# check_scene_readiness.py は常にこのファイルと同じディレクトリにある。直接
# 実行時 (python3 capture_server.py) はスクリプト自身のディレクトリが
# sys.path[0] に自動追加されるため素の import で足りるが、他モジュールから
# import capture_server された場合 (test_capture_server.py 等) はその保証が
# ないため、ここで明示的に自分のディレクトリを足しておく。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_scene_readiness import check_scene_readiness  # noqa: E402

KINDS = {"base", "segmentation", "instance", "edge", "depth", "normal", "probe"}
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
MAX_BODY = 64 * 1024 * 1024

# POST path -> filename written under <root>/<shot>/. Both carry a JSON body.
# The filenames are fixed constants here, never taken from the request, so the
# only attacker-controlled path component remains <shot> — which SAFE_NAME
# already constrains.
JSON_DOCS = {
    "/instance-legend": "instance-legend.json",
    "/shot": "shot.json",
}


def make_server(root: Path, port: int = 0) -> ThreadingHTTPServer:
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

        def _read_body(self):
            """Read a bounded request body, or reply 400 and return None.

            Deliberately a separate helper rather than a refactor of the
            /frame branch below: /frame's inline validation is load-bearing
            and was signed off as-is, so it is left byte for byte alone. The
            bounds here are the same ones.
            """
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._reply(400, "bad length")
                return None
            if length <= 0 or length > MAX_BODY:
                self._reply(400, "bad length")
                return None
            return self.rfile.read(length)

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
                # capture-runner.mjs 側の待ち(furniture GLBのロード完了待ち)は
                # 二度と踏み外さない保証ではない -- ここは、その待ちが何であれ
                # 出力そのものが実際に揃っていたかを見る独立した最後の砦。
                # 失敗した場合は DONE を書かず FAIL を書く。DONE の有無だけを
                # 見る下流の消費者が、壊れたレンダを良いレンダと取り違えない
                # ようにするため。
                ok, message = check_scene_readiness(target)
                # 同じ shot id を撮り直したとき、前回の結果を示すマーカーが
                # 残ったままだと「今回」の判定と食い違って見える。常に片方
                # だけが残るようにする。
                (target / "DONE").unlink(missing_ok=True)
                (target / "FAIL").unlink(missing_ok=True)
                if not ok:
                    (target / "FAIL").write_text(message + "\n")
                    return self._reply(422, message)
                (target / "DONE").write_text("done\n")
                return self._reply(200, "ok")

            if self.path in JSON_DOCS:
                body = self._read_body()
                if body is None:
                    return
                try:
                    json.loads(body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    return self._reply(400, "body is not valid JSON")
                target = root / shot
                target.mkdir(parents=True, exist_ok=True)
                (target / JSON_DOCS[self.path]).write_bytes(body)
                return self._reply(200, "ok")

            if self.path != "/frame":
                return self._reply(404)

            kind = self.headers.get("X-PV-Kind", "")
            if kind not in KINDS:
                return self._reply(400, "bad kind")

            index = self.headers.get("X-PV-Index", "")
            if not index.isdigit():
                return self._reply(400, "bad index")

            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._reply(400, "bad length")
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
