import http.client
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from capture_server import make_server

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class CaptureServerTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.server = make_server(self.root, port=0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.root, ignore_errors=True)

    def post(self, path, body=b"", headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", path, body=body, headers=headers or {})
        resp = conn.getresponse()
        status = resp.status
        resp.read()
        conn.close()
        return status

    def test_frame_is_written_to_expected_path(self):
        status = self.post("/frame", PNG, {
            "X-PV-Shot": "S08-ldk-push", "X-PV-Kind": "base", "X-PV-Index": "7"})
        self.assertEqual(status, 200)
        written = self.root / "S08-ldk-push" / "base" / "0007.png"
        self.assertTrue(written.exists())
        self.assertEqual(written.read_bytes(), PNG)

    def test_unknown_kind_is_rejected(self):
        status = self.post("/frame", PNG, {
            "X-PV-Shot": "S08", "X-PV-Kind": "bogus", "X-PV-Index": "0"})
        self.assertEqual(status, 400)
        self.assertEqual(list(self.root.rglob("*.png")), [])

    def test_path_traversal_in_shot_is_rejected(self):
        status = self.post("/frame", PNG, {
            "X-PV-Shot": "../../etc", "X-PV-Kind": "base", "X-PV-Index": "0"})
        self.assertEqual(status, 400)
        self.assertEqual(list(self.root.rglob("*.png")), [])

    def test_non_numeric_index_is_rejected(self):
        status = self.post("/frame", PNG, {
            "X-PV-Shot": "S08", "X-PV-Kind": "base", "X-PV-Index": "abc"})
        self.assertEqual(status, 400)
        self.assertEqual(list(self.root.rglob("*.png")), [])

    def test_done_writes_marker(self):
        status = self.post("/done", b"", {"X-PV-Shot": "S08"})
        self.assertEqual(status, 200)
        self.assertTrue((self.root / "S08" / "DONE").exists())


if __name__ == "__main__":
    unittest.main()
