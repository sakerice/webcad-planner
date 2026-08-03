import http.client
import shutil
import socket
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
        self.thread.join(timeout=5)
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

    def test_malformed_content_length_is_rejected(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(("127.0.0.1", self.port))
        request = b"POST /frame HTTP/1.1\r\n"
        request += b"Host: 127.0.0.1\r\n"
        request += b"X-PV-Shot: S08\r\n"
        request += b"X-PV-Kind: base\r\n"
        request += b"X-PV-Index: 0\r\n"
        request += b"Content-Length: not_a_number\r\n"
        request += b"\r\n"
        sock.sendall(request)
        response = sock.recv(1024)
        sock.close()
        self.assertIn(b"400", response)
        self.assertEqual(list(self.root.rglob("*.png")), [])


if __name__ == "__main__":
    unittest.main()
