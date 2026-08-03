# PV映像生成エンジン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 間取りデータとカメラパス定義（shot spec）から、設計に忠実な実カメラ移動の連番・制御画像・動画を出力し、Seedance出力の間取り改変を数値で自動検出するエンジンを作る。

**Architecture:** 3層。Layer 1 は three.js が間取り・カメラ・オクルージョンの真実を連番出力する。Layer 2 は Seedance がその動画を `@Video1` として受け取り外観だけを更新する（Topview Web上の手作業）。Layer 3 は出力フレームを Layer 1 の制御画像と数値比較し PASS/FAIL を機械判定する。設計の詳細は `docs/superpowers/specs/2026-08-03-pv-render-engine-design.md`。

**Tech Stack:** three.js（既存 index.html 内）／ Node v25 の `node --test`（依存追加なし）／ Python 3.14 標準 `unittest` + numpy 2.4 + PIL 11.3 ／ Swift + AVFoundation（ffmpeg は本機に存在しない）／ 既存 `tools/dev_server.py`。

## Global Constraints

- `index.html` への変更は `?pvCapture=1` でガードした `window.__PV_CAPTURE__` の露出1箇所のみ。既存関数の挙動を変更しない。既存行の削除・書き換えを行わない。
- `index.html` と `assets/default_plan.json` の未コミット差分は絶対にコミットに含めない。ステージングは常にファイルを明示指定する。`git add -A` と `git commit -a` を使わない。
- 新規依存パッケージをインストールしない（npm / pip とも）。Node は `node --test`、Python は `unittest` + numpy + PIL のみ。
- ffmpeg は存在しない。動画のエンコード・デコードは Swift + AVFoundation で行う。
- 作業ブランチは `pv/render-engine`。
- Topview 設定は固定: Seedance 2.0 / オムニリファレンス / 720p / 16:9 / 4s / 1本。
- 検証生成のみクレジットモードを使う。本番生成は無制限モード（cost 0）。既存のTopviewタスクをキャンセル・削除しない。ZUBASH Board へ混ぜない。
- 生成AIに三次元再構成をさせない。カメラワークとオクルージョンは Layer 1 の責務。
- S07 / S08 を本検証の成功をもって `approved` に昇格させない。

## File Structure

```
pv/tools/truth-render/
  camera-path.mjs          # カメラキーの時刻補間（純関数）
  shot-spec.mjs            # shot spec の検証とフレーム時刻算出（純関数）
  capture_server.py        # 連番POSTを受けてディスクへ書くローカルサーバ
  capture-runner.mjs       # index.html のページ内で連番キャプチャを駆動
  check_determinism.py     # 同一ポーズが byte 一致することを検証
  specs/                   # shot spec JSON の置き場
  tests/
    camera-path.test.mjs
    shot-spec.test.mjs
    test_capture_server.py
pv/tools/encode_image_sequence.swift   # PNG連番 → mp4
pv/tools/fidelity-qa/
  metrics.py               # 二値形態処理・エッジ一致・インスタンス別再現率
  report.py                # 2つのフレーム列を比較して PASS/FAIL レポート
  tests/
    test_metrics.py
    test_report.py
pv/renders/<shot-id>/       # 出力（gitignore 対象）
index.html                  # 露出フック1箇所のみ追記
```

各ファイルは1つの責務を持つ。`camera-path.mjs` と `shot-spec.mjs` はブラウザ・Node の両方から import される純粋モジュールで、DOM にも three.js にも依存しない。だからテストがブラウザ無しで回る。

---

### Task 1: カメラパス補間

**Files:**
- Create: `pv/tools/truth-render/camera-path.mjs`
- Test: `pv/tools/truth-render/tests/camera-path.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces: `sampleCameraPath(keys, t) -> { pos: number[3], target: number[3], fov: number }`。`keys` は `{ t, pos, target, fov }` の配列で `t` 昇順。

補間は Catmull-Rom。端点は複製ではなく**反射**（`2*P1 - P2`）で作る。複製にすると等間隔・共線のキーでも直線にならず、カメラが端で不自然に減速するため。キーが2点以下なら線形補間にフォールバックする。

- [ ] **Step 1: Write the failing test**

`pv/tools/truth-render/tests/camera-path.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleCameraPath } from '../camera-path.mjs';

const key = (t, x, fov = 60) => ({ t, pos: [x, 0, 0], target: [x, 0, -1], fov });

test('キー時刻ちょうどではキー値をそのまま返す', () => {
  const keys = [key(0, 0), key(1, 1), key(2, 2)];
  for (const k of keys) {
    const s = sampleCameraPath(keys, k.t);
    assert.deepEqual(s.pos, k.pos);
    assert.deepEqual(s.target, k.target);
  }
});

test('キーが2点なら線形補間する', () => {
  const keys = [key(0, 0), key(4, 4)];
  assert.equal(sampleCameraPath(keys, 1).pos[0], 1);
  assert.equal(sampleCameraPath(keys, 3).pos[0], 3);
});

test('等間隔で共線のキーは直線上を動く（反射端点の証拠）', () => {
  const keys = [key(0, 0), key(1, 1), key(2, 2)];
  assert.ok(Math.abs(sampleCameraPath(keys, 0.5).pos[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(sampleCameraPath(keys, 1.5).pos[0] - 1.5) < 1e-12);
});

test('範囲外の時刻は端にクランプされる', () => {
  const keys = [key(0, 0), key(1, 1), key(2, 2)];
  assert.deepEqual(sampleCameraPath(keys, -5).pos, [0, 0, 0]);
  assert.deepEqual(sampleCameraPath(keys, 99).pos, [2, 0, 0]);
});

test('fov も補間される', () => {
  const keys = [key(0, 0, 40), key(2, 2, 80)];
  assert.equal(sampleCameraPath(keys, 1).fov, 60);
});

test('キーが空なら例外を投げる', () => {
  assert.throws(() => sampleCameraPath([], 0), /non-empty/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pv/tools/truth-render/tests/camera-path.test.mjs`
Expected: FAIL — `Cannot find module '../camera-path.mjs'`

- [ ] **Step 3: Write minimal implementation**

`pv/tools/truth-render/camera-path.mjs`:

```js
// 時刻つきカメラキーの補間。DOM にも three.js にも依存しない純関数。

function reflect(a, b) {
  return a.map((v, i) => 2 * v - b[i]);
}

function lerp(a, b, u) {
  return a.map((v, i) => v + (b[i] - v) * u);
}

function catmullRom(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return p1.map((_, i) =>
    0.5 * (
      2 * p1[i] +
      (-p0[i] + p2[i]) * u +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3
    ));
}

export function sampleCameraPath(keys, t) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('sampleCameraPath: keys must be a non-empty array');
  }
  if (keys.length === 1) {
    return { pos: [...keys[0].pos], target: [...keys[0].target], fov: keys[0].fov };
  }

  const times = keys.map(k => k.t);
  const last = times.length - 1;
  const clamped = Math.min(Math.max(t, times[0]), times[last]);

  let i = 0;
  while (i < last - 1 && clamped >= times[i + 1]) i++;

  const span = times[i + 1] - times[i];
  const u = span === 0 ? 0 : (clamped - times[i]) / span;

  const pick = (field) => {
    const pts = keys.map(k => k[field]);
    if (pts.length < 3) return lerp(pts[0], pts[1], u);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p0 = i > 0 ? pts[i - 1] : reflect(p1, p2);
    const p3 = i + 2 <= last ? pts[i + 2] : reflect(p2, p1);
    return catmullRom(p0, p1, p2, p3, u);
  };

  return {
    pos: pick('pos'),
    target: pick('target'),
    fov: keys[i].fov + (keys[i + 1].fov - keys[i].fov) * u,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pv/tools/truth-render/tests/camera-path.test.mjs`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add pv/tools/truth-render/camera-path.mjs pv/tools/truth-render/tests/camera-path.test.mjs
git commit -m "Add camera path interpolation for PV truth renderer"
```

---

### Task 2: shot spec の検証とフレーム時刻

**Files:**
- Create: `pv/tools/truth-render/shot-spec.mjs`
- Test: `pv/tools/truth-render/tests/shot-spec.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces:
  - `validateShotSpec(spec) -> spec`（不正なら `Error` を投げる）
  - `frameTimes(spec) -> number[]`（長さ `round(duration*fps)`、値は `i/fps`）
  - `guideFrameIndices(spec) -> number[]`（`guideStride` ごとの索引。末尾フレームを必ず含む）
  - `GUIDE_KINDS -> string[]`（`['base','segmentation','instance','edge','depth','normal']`）

`guideFrameIndices` が末尾を必ず含むのは、Layer 3 が終端フレームの破綻を最も検出したいため。T63 は終盤で崩れた。

- [ ] **Step 1: Write the failing test**

`pv/tools/truth-render/tests/shot-spec.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateShotSpec, frameTimes, guideFrameIndices, GUIDE_KINDS } from '../shot-spec.mjs';

const valid = () => ({
  id: 'S08-ldk-push',
  plan: 'assets/default_plan.json',
  view: '3d-int',
  fps: 24,
  duration: 4,
  resolution: { width: 1920, height: 1080 },
  camera: {
    keys: [
      { t: 0, pos: [0, 1.2, 0], target: [0, 1.2, -1], fov: 75 },
      { t: 2, pos: [0, 1.2, -1], target: [0, 1.2, -2], fov: 75 },
      { t: 4, pos: [0, 1.2, -2], target: [0, 1.2, -3], fov: 75 },
    ],
  },
  guides: ['base', 'edge', 'instance'],
  guideStride: 24,
});

test('妥当な spec はそのまま返る', () => {
  const s = valid();
  assert.equal(validateShotSpec(s), s);
});

test('id が無ければフィールド名を含む例外', () => {
  const s = valid(); delete s.id;
  assert.throws(() => validateShotSpec(s), /id/);
});

test('view は 3d-int か 3d-ext のみ', () => {
  const s = valid(); s.view = 'plan';
  assert.throws(() => validateShotSpec(s), /view/);
});

test('キーの時刻が昇順でなければ例外', () => {
  const s = valid(); s.camera.keys[1].t = 3.5; s.camera.keys[2].t = 1;
  assert.throws(() => validateShotSpec(s), /ascending/);
});

test('最初のキーは t=0 でなければ例外', () => {
  const s = valid(); s.camera.keys[0].t = 0.5;
  assert.throws(() => validateShotSpec(s), /must start at t=0/);
});

test('最後のキーの時刻は duration と一致しなければ例外', () => {
  const s = valid(); s.duration = 5;
  assert.throws(() => validateShotSpec(s), /duration/);
});

test('未知の guide 種別は例外', () => {
  const s = valid(); s.guides = ['base', 'bogus'];
  assert.throws(() => validateShotSpec(s), /bogus/);
});

test('frameTimes は duration*fps 本で 0 始まり', () => {
  const ts = frameTimes(valid());
  assert.equal(ts.length, 96);
  assert.equal(ts[0], 0);
  assert.ok(Math.abs(ts[95] - 95 / 24) < 1e-12);
});

test('guideFrameIndices は stride 刻みで末尾を必ず含む', () => {
  const idx = guideFrameIndices(valid());
  assert.deepEqual(idx, [0, 24, 48, 72, 95]);
});

test('GUIDE_KINDS は6種', () => {
  assert.deepEqual(GUIDE_KINDS, ['base', 'segmentation', 'instance', 'edge', 'depth', 'normal']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pv/tools/truth-render/tests/shot-spec.test.mjs`
Expected: FAIL — `Cannot find module '../shot-spec.mjs'`

- [ ] **Step 3: Write minimal implementation**

`pv/tools/truth-render/shot-spec.mjs`:

```js
// shot spec の検証と、そこから導かれるフレーム索引の算出。

export const GUIDE_KINDS = ['base', 'segmentation', 'instance', 'edge', 'depth', 'normal'];

const VIEWS = ['3d-int', '3d-ext'];

function req(spec, field) {
  if (spec[field] === undefined || spec[field] === null || spec[field] === '') {
    throw new Error(`shot spec: required field "${field}" is missing`);
  }
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

export function validateShotSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('shot spec: must be an object');
  ['id', 'plan', 'view', 'fps', 'duration', 'resolution', 'camera', 'guides'].forEach(f => req(spec, f));

  if (!VIEWS.includes(spec.view)) {
    throw new Error(`shot spec: view must be one of ${VIEWS.join(', ')}, got "${spec.view}"`);
  }
  if (!(spec.fps > 0)) throw new Error('shot spec: fps must be positive');
  if (!(spec.duration > 0)) throw new Error('shot spec: duration must be positive');
  if (!(spec.resolution.width > 0) || !(spec.resolution.height > 0)) {
    throw new Error('shot spec: resolution.width and resolution.height must be positive');
  }

  spec.guides.forEach(g => {
    if (!GUIDE_KINDS.includes(g)) throw new Error(`shot spec: unknown guide kind "${g}"`);
  });

  const keys = spec.camera && spec.camera.keys;
  if (!Array.isArray(keys) || keys.length < 2) {
    throw new Error('shot spec: camera.keys must have at least 2 entries');
  }
  keys.forEach((k, i) => {
    if (typeof k.t !== 'number' || !Number.isFinite(k.t)) throw new Error(`shot spec: camera.keys[${i}].t must be a number`);
    if (!isVec3(k.pos)) throw new Error(`shot spec: camera.keys[${i}].pos must be 3 numbers`);
    if (!isVec3(k.target)) throw new Error(`shot spec: camera.keys[${i}].target must be 3 numbers`);
    if (!(k.fov > 0)) throw new Error(`shot spec: camera.keys[${i}].fov must be positive`);
    if (i > 0 && !(k.t > keys[i - 1].t)) throw new Error('shot spec: camera.keys times must be strictly ascending');
  });
  if (keys[0].t !== 0) throw new Error('shot spec: camera.keys must start at t=0');
  if (Math.abs(keys[keys.length - 1].t - spec.duration) > 1e-9) {
    throw new Error('shot spec: last camera key time must equal duration');
  }
  if (spec.guideStride !== undefined && !(spec.guideStride >= 1)) {
    throw new Error('shot spec: guideStride must be >= 1');
  }
  return spec;
}

export function frameTimes(spec) {
  const n = Math.round(spec.duration * spec.fps);
  return Array.from({ length: n }, (_, i) => i / spec.fps);
}

export function guideFrameIndices(spec) {
  const n = Math.round(spec.duration * spec.fps);
  const stride = spec.guideStride || 1;
  const out = [];
  for (let i = 0; i < n; i += stride) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pv/tools/truth-render/tests/shot-spec.test.mjs`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add pv/tools/truth-render/shot-spec.mjs pv/tools/truth-render/tests/shot-spec.test.mjs
git commit -m "Add shot spec validation and frame index derivation"
```

---

### Task 3: キャプチャ受信サーバ

**Files:**
- Create: `pv/tools/truth-render/capture_server.py`
- Test: `pv/tools/truth-render/tests/test_capture_server.py`

**Interfaces:**
- Consumes: なし
- Produces: `make_server(root: Path, port: int = 0) -> ThreadingHTTPServer`。エンドポイントは3つ。
  - `POST /frame` — ヘッダ `X-PV-Shot`, `X-PV-Kind`, `X-PV-Index`、ボディは PNG バイト列。`<root>/<shot>/<kind>/<index:04d>.png` に書く。
  - `POST /done` — ヘッダ `X-PV-Shot`。`<root>/<shot>/DONE` を書く。
  - `GET /health` — `200 ok`。

ブラウザは同一オリジンではないので CORS を許可する。ただし**バインドは 127.0.0.1 固定**。`shot` と `kind` はパス要素になるためディレクトリ脱出を防ぐ検証が必須で、これはテストで守る。

- [ ] **Step 1: Write the failing test**

`pv/tools/truth-render/tests/test_capture_server.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s pv/tools/truth-render/tests -p 'test_*.py' -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'capture_server'`

- [ ] **Step 3: Write minimal implementation**

`pv/tools/truth-render/capture_server.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s pv/tools/truth-render/tests -p 'test_*.py' -v`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add pv/tools/truth-render/capture_server.py pv/tools/truth-render/tests/test_capture_server.py
git commit -m "Add local capture server for truth render frame sequences"
```

---

### Task 4: index.html への露出フックと決定性の証明

**Files:**
- Modify: `index.html`（末尾のスクリプト末端に追記のみ。既存行は一切変更しない）
- Create: `pv/tools/truth-render/check_determinism.py`

**Interfaces:**
- Consumes: 既存の `getActive3DCamera()` (index.html:16717), `ensureAiRenderable3D()` (index.html:16723), `captureCurrent3DDataUrl()` (index.html:16736), `captureSegmentation3DDataUrl()` (index.html:16852), `captureAiOverrideGuideDataUrl(kind)` (index.html:16891), `captureInstance3DData()` (index.html:16977), `makeEdgeDataUrlFromSegmentation(dataUrl)` (index.html:17036)
- Produces: `window.__PV_CAPTURE__` = `{ version, ensure3D(), setPose(pos, target, fov), renderNow(), captureBase(), captureGuide(kind) -> Promise<string dataUrl> }`

このタスクの本当の合否は「同じポーズを2回セットしたら**バイト一致した PNG** が出るか」である。一致しなければカメラ制御に隠れ状態（OrbitControls の damping、shadowMap の遅延更新など）が残っており、連番の再現性が無い。ここを通さずに先へ進んではいけない。

- [ ] **Step 1: 依存する既存関数の実在と副作用を確認する**

Run:
```bash
grep -n "function getActive3DCamera\|function ensureAiRenderable3D\|function captureCurrent3DDataUrl\|function captureSegmentation3DDataUrl\|function captureAiOverrideGuideDataUrl\|function captureInstance3DData\|function makeEdgeDataUrlFromSegmentation" index.html
grep -n "enableDamping\|autoRotate" index.html
```
Expected: 前者は7件すべてヒットする。後者がヒットした場合、`setPose` の中で該当プロパティを一時的に false にする必要がある（Step 3 のコメント参照）。

- [ ] **Step 2: 決定性チェッカを書く（実装より先に判定基準を置く）**

`pv/tools/truth-render/check_determinism.py`:

```python
#!/usr/bin/env python3
"""probe/0000.png と probe/0002.png が byte 一致することを検証する。

capture-runner.mjs を determinism モードで走らせると、ポーズ A → B → A の
3枚が probe/ に出力される。0番と2番が一致しなければカメラ制御に隠れ状態があり、
連番キャプチャは再現不能である。

使い方: python3 pv/tools/truth-render/check_determinism.py pv/renders/<shot-id>
"""
import hashlib
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check_determinism.py <shot-render-dir>", file=sys.stderr)
        return 2
    probe = Path(sys.argv[1]) / "probe"
    a, b, c = probe / "0000.png", probe / "0001.png", probe / "0002.png"
    for p in (a, b, c):
        if not p.exists():
            print(f"FAIL missing {p}", file=sys.stderr)
            return 1

    def digest(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    da, db, dc = digest(a), digest(b), digest(c)
    if da != dc:
        print(f"FAIL pose A is not reproducible\n  0000 {da}\n  0002 {dc}", file=sys.stderr)
        return 1
    if da == db:
        print("FAIL pose B is identical to pose A; setPose had no effect", file=sys.stderr)
        return 1
    print(f"PASS pose A reproducible ({da[:12]}), pose B distinct ({db[:12]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`da == db` も失敗にするのが要点。`setPose` が黙って無視された場合、3枚とも同一になって「一致した」と誤判定してしまう。

- [ ] **Step 3: index.html にフックを追記する**

`index.html` の最終 `</script>` の直前に、以下を**追記のみ**で入れる。既存行は触らない。

```js
/* ===== PV capture hook (guarded; no effect unless ?pvCapture=1) ===== */
(function(){
  try{
    if(new URLSearchParams(location.search||'').get('pvCapture')!=='1') return;
    window.__PV_CAPTURE__={
      version:1,
      ensure3D:function(){ return ensureAiRenderable3D(); },
      setPose:function(pos,target,fov){
        var cam=getActive3DCamera();
        if(!cam) throw new Error('no active 3D camera');
        // OrbitControls の damping / autoRotate は再現性を壊すので必ず切る。
        if(typeof orbit!=='undefined' && orbit){
          orbit.enableDamping=false;
          orbit.autoRotate=false;
        }
        cam.position.set(pos[0],pos[1],pos[2]);
        if(typeof fov==='number' && fov>0){ cam.fov=fov; }
        cam.updateProjectionMatrix();
        if(typeof orbit!=='undefined' && orbit && orbit.object===cam){
          orbit.target.set(target[0],target[1],target[2]);
          orbit.update();
        }else{
          cam.lookAt(new THREE.Vector3(target[0],target[1],target[2]));
        }
        cam.updateMatrixWorld(true);
      },
      renderNow:function(){
        if(ren&&ren.shadowMap) ren.shadowMap.needsUpdate=true;
        var cam=getActive3DCamera();
        if(typeof composer!=='undefined' && composer) composer.render();
        else ren.render(sc3,cam);
      },
      captureBase:function(){ return Promise.resolve(captureCurrent3DDataUrl()); },
      captureGuide:function(kind){
        if(kind==='base') return Promise.resolve(captureCurrent3DDataUrl());
        if(kind==='segmentation') return Promise.resolve(captureSegmentation3DDataUrl());
        if(kind==='depth') return Promise.resolve(captureAiOverrideGuideDataUrl('depth'));
        if(kind==='normal') return Promise.resolve(captureAiOverrideGuideDataUrl('normal'));
        if(kind==='instance') return Promise.resolve(captureInstance3DData().dataUrl);
        if(kind==='edge') return makeEdgeDataUrlFromSegmentation(captureInstance3DData().dataUrl);
        return Promise.reject(new Error('unknown guide kind: '+kind));
      }
    };
    import('/pv/tools/truth-render/capture-runner.mjs').catch(function(e){
      console.error('[pv-capture] runner failed to load',e);
    });
  }catch(e){ console.error('[pv-capture] hook init failed',e); }
})();
```

- [ ] **Step 4: 通常利用に影響が無いことを確認する**

Run:
```bash
node tools/check-html-js.cjs
python3 tools/dev_server.py 8931 &
sleep 1
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8931/index.html
```
Expected: 構文チェックがエラー無しで通り、`200` が返る。ブラウザで `http://localhost:8931/index.html`（パラメータ無し）を開き、`window.__PV_CAPTURE__` が `undefined` であること、3D表示が従来通りであることを目視確認する。

- [ ] **Step 5: 決定性を検証する（Task 5 完了後に実行するゲート）**

このステップは Task 5 の `capture-runner.mjs` が必要なため、Task 5 の Step 4 で実行する。ここでは checker のみコミットする。

- [ ] **Step 6: Commit**

```bash
git add index.html pv/tools/truth-render/check_determinism.py
git commit -m "Expose guarded PV capture hook and determinism checker"
```

`git add` は必ずこの2ファイルを明示指定する。`assets/default_plan.json` を巻き込まないため。`git status --short` で `assets/default_plan.json` が ` M`（未ステージ）のままであることを確認してからコミットする。

---

### Task 5: 連番キャプチャランナー

**Files:**
- Create: `pv/tools/truth-render/capture-runner.mjs`
- Create: `pv/tools/truth-render/specs/probe-determinism.json`

**Interfaces:**
- Consumes: `window.__PV_CAPTURE__`（Task 4）、`sampleCameraPath`（Task 1）、`validateShotSpec` / `frameTimes` / `guideFrameIndices`（Task 2）、`POST /frame` `/done`（Task 3）
- Produces: なし（終端の実行体）

URL パラメータ `?pvCapture=1&pvShot=<spec-name>&pvServer=<port>` で駆動する。`pvShot=probe-determinism` のときだけ determinism モードに入り、ポーズ A → B → A を `probe/` へ3枚出す。

- [ ] **Step 1: determinism 用 spec を書く**

`pv/tools/truth-render/specs/probe-determinism.json`:

```json
{
  "id": "probe-determinism",
  "plan": "assets/default_plan.json",
  "view": "3d-int",
  "fps": 1,
  "duration": 2,
  "resolution": { "width": 1280, "height": 720 },
  "camera": {
    "keys": [
      { "t": 0, "pos": [0.0, 1.4, 0.0], "target": [0.0, 1.4, -1.0], "fov": 75 },
      { "t": 1, "pos": [1.2, 1.4, -0.8], "target": [0.4, 1.4, -1.8], "fov": 75 },
      { "t": 2, "pos": [0.0, 1.4, 0.0], "target": [0.0, 1.4, -1.0], "fov": 75 }
    ]
  },
  "guides": ["base"],
  "guideStride": 1
}
```

キー0とキー2が完全に同一である点が肝。実際の間取りに合わせた座標は Step 4 の実行時に調整してよいが、**キー0とキー2は必ず同値に保つ**。

- [ ] **Step 2: ランナーを書く**

`pv/tools/truth-render/capture-runner.mjs`:

```js
// index.html のページ内で連番キャプチャを駆動する。
// window.__PV_CAPTURE__ が既に露出している前提。

import { sampleCameraPath } from './camera-path.mjs';
import { validateShotSpec, frameTimes, guideFrameIndices } from './shot-spec.mjs';

const params = new URLSearchParams(location.search || '');
const shotName = params.get('pvShot');
const serverPort = params.get('pvServer') || '8932';
const server = `http://127.0.0.1:${serverPort}`;

const log = (...a) => console.log('[pv-capture]', ...a);

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)[1];
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

async function postFrame(shot, kind, index, dataUrl) {
  const res = await fetch(`${server}/frame`, {
    method: 'POST',
    headers: { 'X-PV-Shot': shot, 'X-PV-Kind': kind, 'X-PV-Index': String(index) },
    body: dataUrlToBlob(dataUrl),
  });
  if (!res.ok) throw new Error(`frame ${kind}/${index} rejected: ${res.status}`);
}

// レンダラの状態が確実に落ち着くまで待つ。1フレームでは shadowMap の
// 更新が間に合わないことがあるため2フレーム分待つ。
const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

async function captureAt(spec, t, index, kinds) {
  const pose = sampleCameraPath(spec.camera.keys, t);
  window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
  window.__PV_CAPTURE__.renderNow();
  await settle();
  for (const kind of kinds) {
    const dataUrl = await window.__PV_CAPTURE__.captureGuide(kind);
    await postFrame(spec.id, kind, index, dataUrl);
  }
}

async function runDeterminismProbe(spec) {
  log('determinism probe: pose A -> B -> A');
  const times = [0, 1, 2];
  for (let i = 0; i < times.length; i++) {
    const pose = sampleCameraPath(spec.camera.keys, times[i]);
    window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
    window.__PV_CAPTURE__.renderNow();
    await settle();
    const dataUrl = await window.__PV_CAPTURE__.captureGuide('base');
    await postFrame(spec.id, 'probe', i, dataUrl);
  }
  await fetch(`${server}/done`, { method: 'POST', headers: { 'X-PV-Shot': spec.id } });
  log('determinism probe complete');
}

async function runSequence(spec) {
  const times = frameTimes(spec);
  const guideAt = new Set(guideFrameIndices(spec));
  const extraGuides = spec.guides.filter(g => g !== 'base');
  for (let i = 0; i < times.length; i++) {
    const kinds = guideAt.has(i) ? ['base', ...extraGuides] : ['base'];
    await captureAt(spec, times[i], i, kinds);
    if (i % 10 === 0) log(`frame ${i + 1}/${times.length}`);
  }
  await fetch(`${server}/done`, { method: 'POST', headers: { 'X-PV-Shot': spec.id } });
  log(`complete: ${times.length} frames`);
}

async function main() {
  if (!shotName) { log('no pvShot given; idle'); return; }
  const res = await fetch(`/pv/tools/truth-render/specs/${shotName}.json`);
  if (!res.ok) throw new Error(`spec not found: ${shotName}`);
  const spec = validateShotSpec(await res.json());

  await window.__PV_CAPTURE__.ensure3D();
  await settle();

  if (spec.id === 'probe-determinism') await runDeterminismProbe(spec);
  else await runSequence(spec);
}

main().catch(e => { console.error('[pv-capture] failed', e); });
```

- [ ] **Step 3: 依存モジュールが ES module として解決できることを確認する**

Run: `node --input-type=module -e "import('./pv/tools/truth-render/shot-spec.mjs').then(m=>console.log(Object.keys(m).join(',')))"`
Expected: `GUIDE_KINDS,validateShotSpec,frameTimes,guideFrameIndices` が出力される（順不同）

- [ ] **Step 4: 決定性ゲートを実行する（Task 4 Step 5 の実体）**

Run:
```bash
python3 tools/dev_server.py 8931 &
python3 pv/tools/truth-render/capture_server.py pv/renders 8932 &
sleep 1
```
ブラウザで以下を開く:
`http://localhost:8931/index.html?pvCapture=1&pvShot=probe-determinism&pvServer=8932`

コンソールに `determinism probe complete` が出たら:

Run: `python3 pv/tools/truth-render/check_determinism.py pv/renders/probe-determinism`
Expected: `PASS pose A reproducible (...), pose B distinct (...)`

FAIL した場合、原因を潰すまで Task 6 以降へ進まない。よくある原因は3つ。`orbit.enableDamping` が別経路で再有効化されている、`ren.shadowMap.autoUpdate=false` のため影が前フレームのまま残る（`renderNow` を2回呼ぶ）、内観モードの `WALK` が独自にカメラを上書きしている。

- [ ] **Step 5: Commit**

```bash
git add pv/tools/truth-render/capture-runner.mjs pv/tools/truth-render/specs/probe-determinism.json
git commit -m "Add sequence capture runner with determinism probe mode"
```

---

### Task 6: PNG連番から mp4 を作る

**Files:**
- Create: `pv/tools/encode_image_sequence.swift`

**Interfaces:**
- Consumes: `pv/renders/<shot>/base/*.png`
- Produces: CLI `swift pv/tools/encode_image_sequence.swift <png-dir> <output.mp4> <fps>`

ffmpeg が無いため AVAssetWriter を使う。既存の `pv/tools/*.swift` と同じ流儀（引数直渡し、`swift` で直接実行）に合わせる。

- [ ] **Step 1: エンコーダを書く**

`pv/tools/encode_image_sequence.swift`:

```swift
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

guard CommandLine.arguments.count >= 4 else {
    fputs("usage: encode_image_sequence <png-dir> <output.mp4> <fps>\n", stderr)
    exit(2)
}

let inputDir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let fps = Int32(CommandLine.arguments[3]), fps > 0 else {
    fputs("fps must be a positive integer\n", stderr)
    exit(2)
}

let files = try FileManager.default
    .contentsOfDirectory(at: inputDir, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "png" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

guard !files.isEmpty else {
    fputs("no png files in \(inputDir.path)\n", stderr)
    exit(1)
}

func loadImage(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

guard let first = loadImage(files[0]) else {
    fputs("failed to read \(files[0].lastPathComponent)\n", stderr)
    exit(1)
}
let width = first.width
let height = first.height

try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func pixelBuffer(from image: CGImage) -> CVPixelBuffer? {
    guard let pool = adaptor.pixelBufferPool else { return nil }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    guard let buf = buffer else { return nil }
    CVPixelBufferLockBaseAddress(buf, [])
    defer { CVPixelBufferUnlockBaseAddress(buf, []) }
    guard let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(buf),
        width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buf
}

let queue = DispatchQueue(label: "pv.encode")
let done = DispatchSemaphore(value: 0)
var frameIndex = 0
var failure: String?

input.requestMediaDataWhenReady(on: queue) {
    while input.isReadyForMoreMediaData {
        if frameIndex >= files.count {
            input.markAsFinished()
            done.signal()
            return
        }
        let url = files[frameIndex]
        guard let image = loadImage(url), let buf = pixelBuffer(from: image) else {
            failure = "failed to encode \(url.lastPathComponent)"
            input.markAsFinished()
            done.signal()
            return
        }
        let time = CMTime(value: CMTimeValue(frameIndex), timescale: fps)
        if !adaptor.append(buf, withPresentationTime: time) {
            failure = "append failed at frame \(frameIndex)"
            input.markAsFinished()
            done.signal()
            return
        }
        frameIndex += 1
    }
}

done.wait()
if let failure {
    fputs(failure + "\n", stderr)
    exit(1)
}

let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()

if writer.status != .completed {
    fputs("writer failed: \(writer.error?.localizedDescription ?? "unknown")\n", stderr)
    exit(1)
}
print("wrote \(outputURL.path) — \(frameIndex) frames @ \(fps)fps, \(width)x\(height)")
```

- [ ] **Step 2: 合成PNGでラウンドトリップを検証する**

Run:
```bash
python3 - <<'EOF'
from PIL import Image
from pathlib import Path
d = Path('/tmp/pv-enc-test'); d.mkdir(exist_ok=True)
for i in range(12):
    Image.new('RGB', (320, 180), (i * 20, 40, 200 - i * 10)).save(d / f'{i:04d}.png')
print('wrote 12 frames')
EOF
swift pv/tools/encode_image_sequence.swift /tmp/pv-enc-test /tmp/pv-enc-test.mp4 24
swift pv/tools/extract_video_frames.swift /tmp/pv-enc-test.mp4 /tmp/pv-enc-out 0.0 0.25
ls /tmp/pv-enc-out
```
Expected: `wrote /tmp/pv-enc-test.mp4 — 12 frames @ 24fps, 320x180` が出て、`/tmp/pv-enc-out` に2枚の画像が生成される。

- [ ] **Step 3: Commit**

```bash
git add pv/tools/encode_image_sequence.swift
git commit -m "Add PNG sequence to mp4 encoder using AVFoundation"
```

---

### Task 7: 忠実度メトリクス

**Files:**
- Create: `pv/tools/fidelity-qa/metrics.py`
- Test: `pv/tools/fidelity-qa/tests/test_metrics.py`

**Interfaces:**
- Consumes: なし（numpy と PIL のみ）
- Produces:
  - `dilate(mask: np.ndarray[bool], radius: int) -> np.ndarray[bool]`
  - `edge_mask(path_or_image, threshold: int = 32) -> np.ndarray[bool]`
  - `edge_recall(truth: mask, generated: mask, radius: int) -> float`
  - `edge_precision(truth: mask, generated: mask, radius: int) -> float`
  - `instance_boxes(instance_png: Path, legend: dict) -> dict[str, tuple[int,int,int,int]]`
  - `instance_recall(truth: mask, generated: mask, boxes: dict, radius: int) -> dict[str, float]`

`edge_recall` は「設計にある構造が生成側に残っているか」＝**消失の検出**。`edge_precision` は「生成側にあるエッジが設計に存在するか」＝**新規生成の検出**。この2つを分けて持つことが要点で、片方だけでは壁の追加と家具の消失を区別できない。

scipy が無いので dilate は numpy のシフト論理和で実装する（4近傍を radius 回反復＝菱形構造要素）。

- [ ] **Step 1: Write the failing test**

`pv/tools/fidelity-qa/tests/test_metrics.py`:

```python
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import dilate, edge_precision, edge_recall, instance_recall


def blank(h=20, w=20):
    return np.zeros((h, w), dtype=bool)


class DilateTest(unittest.TestCase):
    def test_radius_zero_is_identity(self):
        m = blank(); m[5, 5] = True
        np.testing.assert_array_equal(dilate(m, 0), m)

    def test_radius_one_grows_four_neighbours(self):
        m = blank(); m[5, 5] = True
        out = dilate(m, 1)
        self.assertEqual(out.sum(), 5)
        for y, x in [(5, 5), (4, 5), (6, 5), (5, 4), (5, 6)]:
            self.assertTrue(out[y, x])

    def test_dilation_does_not_wrap_at_border(self):
        m = blank(); m[0, 0] = True
        out = dilate(m, 1)
        self.assertEqual(out.sum(), 3)
        self.assertFalse(out[-1, 0])


class EdgeMetricTest(unittest.TestCase):
    def test_identical_masks_score_one(self):
        m = blank(); m[3:12, 7] = True
        self.assertEqual(edge_recall(m, m, 1), 1.0)
        self.assertEqual(edge_precision(m, m, 1), 1.0)

    def test_one_pixel_shift_is_tolerated_at_radius_one(self):
        t = blank(); t[3:12, 7] = True
        g = blank(); g[3:12, 8] = True
        self.assertEqual(edge_recall(t, g, 1), 1.0)

    def test_missing_structure_drops_recall_but_not_precision(self):
        t = blank(); t[3:12, 7] = True; t[3:12, 15] = True
        g = blank(); g[3:12, 7] = True          # 右の壁が消えた
        self.assertAlmostEqual(edge_recall(t, g, 0), 0.5)
        self.assertEqual(edge_precision(t, g, 0), 1.0)

    def test_invented_structure_drops_precision_but_not_recall(self):
        t = blank(); t[3:12, 7] = True
        g = blank(); g[3:12, 7] = True; g[3:12, 15] = True   # 無い壁が生えた
        self.assertEqual(edge_recall(t, g, 0), 1.0)
        self.assertAlmostEqual(edge_precision(t, g, 0), 0.5)

    def test_empty_generated_scores_zero_recall(self):
        t = blank(); t[3:12, 7] = True
        self.assertEqual(edge_recall(t, blank(), 1), 0.0)

    def test_empty_truth_scores_one_recall(self):
        self.assertEqual(edge_recall(blank(), blank(), 1), 1.0)


class InstanceRecallTest(unittest.TestCase):
    def test_reports_per_instance_and_names_the_missing_one(self):
        t = blank(); t[2:8, 2:8] = True; t[12:18, 12:18] = True
        g = blank(); g[2:8, 2:8] = True                     # sofa は残り table は消えた
        boxes = {"sofa": (2, 2, 8, 8), "table": (12, 12, 18, 18)}
        got = instance_recall(t, g, boxes, radius=0)
        self.assertEqual(got["sofa"], 1.0)
        self.assertEqual(got["table"], 0.0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s pv/tools/fidelity-qa/tests -p 'test_*.py' -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'metrics'`

- [ ] **Step 3: Write minimal implementation**

`pv/tools/fidelity-qa/metrics.py`:

```python
#!/usr/bin/env python3
"""生成フレームが設計の構造を保っているかを測る。

scipy も cv2 も無い環境なので、形態処理は numpy のシフト論理和で行う。
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """4近傍膨張を radius 回反復する（菱形構造要素）。境界で巻き込まない。"""
    out = mask.copy()
    for _ in range(int(radius)):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def edge_mask(source, threshold: int = 32) -> np.ndarray:
    """画像から二値エッジを作る。Path でも PIL.Image でも受ける。"""
    img = Image.open(source) if isinstance(source, (str, Path)) else source
    gray = img.convert("L").filter(ImageFilter.FIND_EDGES)
    return np.asarray(gray) >= threshold


def _ratio(hit: int, total: int) -> float:
    # 対象が存在しないときは減点しない。存在しないものは壊しようがない。
    return 1.0 if total == 0 else hit / total


def edge_recall(truth: np.ndarray, generated: np.ndarray, radius: int) -> float:
    """設計側のエッジのうち、生成側の近傍に対応が見つかった割合。消失の検出。"""
    near = dilate(generated, radius)
    return _ratio(int((truth & near).sum()), int(truth.sum()))


def edge_precision(truth: np.ndarray, generated: np.ndarray, radius: int) -> float:
    """生成側のエッジのうち、設計側の近傍に根拠がある割合。新規生成の検出。"""
    near = dilate(truth, radius)
    return _ratio(int((generated & near).sum()), int(generated.sum()))


def instance_boxes(instance_png, legend: dict) -> dict:
    """instance_guide.png と legend から、部材名 -> (y0,x0,y1,x1) を作る。

    legend は index.html の instance-legend.json 形式:
      {"instances": [{"id": ..., "color": "#rrggbb", "label": "sofa"}, ...]}
    """
    arr = np.asarray(Image.open(instance_png).convert("RGB"))
    boxes = {}
    for entry in legend.get("instances", []):
        color = entry.get("color", "").lstrip("#")
        if len(color) != 6:
            continue
        rgb = tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
        hit = np.all(arr == np.array(rgb, dtype=arr.dtype), axis=-1)
        if not hit.any():
            continue
        ys, xs = np.nonzero(hit)
        name = entry.get("label") or str(entry.get("id"))
        boxes[name] = (int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1)
    return boxes


def instance_recall(truth: np.ndarray, generated: np.ndarray, boxes: dict, radius: int) -> dict:
    """部材ごとに、その bbox 内でのエッジ再現率を出す。どの家具が消えたかを名指しできる。"""
    out = {}
    for name, (y0, x0, y1, x1) in boxes.items():
        out[name] = edge_recall(truth[y0:y1, x0:x1], generated[y0:y1, x0:x1], radius)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s pv/tools/fidelity-qa/tests -p 'test_*.py' -v`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add pv/tools/fidelity-qa/metrics.py pv/tools/fidelity-qa/tests/test_metrics.py
git commit -m "Add fidelity metrics for structural drift detection"
```

---

### Task 8: 忠実度レポート CLI

**Files:**
- Create: `pv/tools/fidelity-qa/report.py`
- Test: `pv/tools/fidelity-qa/tests/test_report.py`

**Interfaces:**
- Consumes: `metrics.py` の全関数
- Produces:
  - `compare_frame(truth_edge_png, generated_png, radius, boxes) -> dict`
  - `evaluate(rows: list[dict], min_recall: float, min_precision: float) -> dict`（`{"verdict": "PASS"|"FAIL", "failures": [...]}`）
  - CLI: `python3 pv/tools/fidelity-qa/report.py --truth <dir> --generated <dir> --fps <n> --min-recall <f> --min-precision <f>`

閾値は引数で受ける。仕様の通り、設計時点で数値を仮置きしない。最初の検証ショットの実測から決める。

- [ ] **Step 1: Write the failing test**

`pv/tools/fidelity-qa/tests/test_report.py`:

```python
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report import evaluate


def row(index, recall, precision, instances=None):
    return {"index": index, "recall": recall, "precision": precision,
            "instances": instances or {}}


class EvaluateTest(unittest.TestCase):
    def test_all_above_threshold_passes(self):
        rows = [row(0, 0.95, 0.93), row(1, 0.97, 0.91)]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["failures"], [])

    def test_low_recall_fails_and_names_the_frame(self):
        rows = [row(0, 0.95, 0.95), row(7, 0.40, 0.95)]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertEqual(len(got["failures"]), 1)
        self.assertEqual(got["failures"][0]["index"], 7)
        self.assertIn("recall", got["failures"][0]["reasons"][0])

    def test_low_precision_fails(self):
        rows = [row(3, 0.99, 0.30)]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("precision", got["failures"][0]["reasons"][0])

    def test_missing_instance_is_named_in_the_failure(self):
        rows = [row(2, 0.99, 0.99, {"sofa": 0.98, "dining_table": 0.10})]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(got["failures"][0]["reasons"])
        self.assertIn("dining_table", joined)
        self.assertNotIn("sofa", joined)

    def test_empty_rows_fail_rather_than_silently_pass(self):
        got = evaluate([], min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")


if __name__ == "__main__":
    unittest.main()
```

`test_empty_rows_fail_rather_than_silently_pass` が重要。比較対象が0件のとき「全部閾値以上だから PASS」と報告するのが、この種のQAで最も危険な誤りである。

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest discover -s pv/tools/fidelity-qa/tests -p 'test_*.py' -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'report'`

- [ ] **Step 3: Write minimal implementation**

`pv/tools/fidelity-qa/report.py`:

```python
#!/usr/bin/env python3
"""Layer 1 の真実フレームと Seedance 出力フレームを比較して PASS/FAIL を出す。

使い方:
  python3 pv/tools/fidelity-qa/report.py \
      --truth pv/renders/<shot> --generated <frames-dir> \
      --min-recall 0.90 --min-precision 0.85 [--radius 2] [--json out.json]
"""
import argparse
import json
from pathlib import Path

from metrics import edge_mask, edge_precision, edge_recall, instance_boxes, instance_recall


def compare_frame(truth_edge_png, generated_png, radius, boxes):
    truth = edge_mask(truth_edge_png)
    generated = edge_mask(generated_png)
    return {
        "index": int(Path(truth_edge_png).stem),
        "recall": edge_recall(truth, generated, radius),
        "precision": edge_precision(truth, generated, radius),
        "instances": instance_recall(truth, generated, boxes, radius) if boxes else {},
    }


def evaluate(rows, min_recall, min_precision):
    if not rows:
        return {"verdict": "FAIL", "failures": [
            {"index": -1, "reasons": ["no frames were compared"]}]}

    failures = []
    for r in rows:
        reasons = []
        if r["recall"] < min_recall:
            reasons.append(f"recall {r['recall']:.3f} < {min_recall:.3f} (design structure went missing)")
        if r["precision"] < min_precision:
            reasons.append(f"precision {r['precision']:.3f} < {min_precision:.3f} (structure was invented)")
        for name, score in sorted(r.get("instances", {}).items()):
            if score < min_recall:
                reasons.append(f"instance '{name}' recall {score:.3f} < {min_recall:.3f}")
        if reasons:
            failures.append({"index": r["index"], "reasons": reasons})

    return {"verdict": "FAIL" if failures else "PASS", "failures": failures}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth", required=True, help="pv/renders/<shot-id>")
    ap.add_argument("--generated", required=True, help="生成動画から抽出したフレームのディレクトリ")
    ap.add_argument("--min-recall", type=float, required=True)
    ap.add_argument("--min-precision", type=float, required=True)
    ap.add_argument("--radius", type=int, default=2)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    truth_dir = Path(args.truth)
    gen_dir = Path(args.generated)

    boxes = {}
    legend_path = truth_dir / "instance-legend.json"
    instance_dir = truth_dir / "instance"
    if legend_path.exists() and instance_dir.exists():
        legend = json.loads(legend_path.read_text())
        first_instance = sorted(instance_dir.glob("*.png"))
        if first_instance:
            boxes = instance_boxes(first_instance[0], legend)

    rows = []
    for truth_png in sorted((truth_dir / "edge").glob("*.png")):
        generated_png = gen_dir / truth_png.name
        if not generated_png.exists():
            continue
        rows.append(compare_frame(truth_png, generated_png, args.radius, boxes))

    result = evaluate(rows, args.min_recall, args.min_precision)
    result["compared"] = len(rows)
    result["rows"] = rows

    print(f"{result['verdict']} — {len(rows)} frames compared")
    for f in result["failures"]:
        print(f"  frame {f['index']:>4}: " + "; ".join(f["reasons"]))

    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2))

    raise SystemExit(0 if result["verdict"] == "PASS" else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest discover -s pv/tools/fidelity-qa/tests -p 'test_*.py' -v`
Expected: PASS — 15 tests（Task 7 の10件と合わせて）

- [ ] **Step 5: Commit**

```bash
git add pv/tools/fidelity-qa/report.py pv/tools/fidelity-qa/tests/test_report.py
git commit -m "Add fidelity QA report CLI with explicit thresholds"
```

---

### Task 9: T91 検証ショット — `@Video1` が構造を守るかの判定

**Files:**
- Create: `pv/tools/truth-render/specs/T91-ldk-push.json`
- Create: `pv/runs/2026-08-03-t91-video-driven-fidelity.md`
- Modify: `.gitignore`（`pv/renders/` を除外）

**Interfaces:**
- Consumes: Task 1〜8 のすべて
- Produces: `@Video1` が構造ロックとして機能するかの数値判定

仕様書 第5節の実験。**これは作品制作ではなく機能検証である。** 成功しても S07/S08 を `approved` に昇格させない。

- [ ] **Step 1: 出力を git から除外する**

```bash
printf 'pv/renders/\n' >> .gitignore
git add .gitignore
git commit -m "Ignore PV render output directory"
```

- [ ] **Step 2: T91 の shot spec を書く**

`pv/tools/truth-render/specs/T91-ldk-push.json` を作る。T63 が失敗したのと同じ2F LDK画角を、実カメラ移動として定義する。カメラ座標は `http://localhost:8931/index.html?pvCapture=1` を開き、内観ウォークスルーで目的の構図に合わせてからコンソールで以下を実行して採取する。

```js
(() => { const c = window.__PV_CAPTURE__ ? getActive3DCamera() : null;
  const t = (typeof orbit!=='undefined' && orbit) ? orbit.target : {x:0,y:0,z:0};
  console.log(JSON.stringify({ pos:[c.position.x,c.position.y,c.position.z],
    target:[t.x,t.y,t.z], fov:c.fov })); })();
```

`t=0` / `t=2` / `t=4` の3ポーズを採取し、以下の形にまとめる。

```json
{
  "id": "T91-ldk-push",
  "plan": "assets/default_plan.json",
  "view": "3d-int",
  "fps": 24,
  "duration": 4,
  "resolution": { "width": 1280, "height": 720 },
  "camera": { "keys": [
    { "t": 0, "pos": [0,0,0], "target": [0,0,-1], "fov": 75 },
    { "t": 2, "pos": [0,0,0], "target": [0,0,-1], "fov": 75 },
    { "t": 4, "pos": [0,0,0], "target": [0,0,-1], "fov": 75 }
  ]},
  "guides": ["base", "edge", "instance", "segmentation", "depth", "normal"],
  "guideStride": 12
}
```

上の座標はプレースホルダではなく**採取値で置き換えてからコミットする**。置き換えずに走らせると3キーが同一になり、カメラが動かない。

- [ ] **Step 3: 真実連番を出力する**

```bash
python3 tools/dev_server.py 8931 &
python3 pv/tools/truth-render/capture_server.py pv/renders 8932 &
sleep 1
```
ブラウザで `http://localhost:8931/index.html?pvCapture=1&pvShot=T91-ldk-push&pvServer=8932` を開く。

Run: `ls pv/renders/T91-ldk-push/base | wc -l && ls pv/renders/T91-ldk-push/edge | wc -l`
Expected: `96` と `9`（stride 12 で 0,12,...,84 の8本＋末尾95）

- [ ] **Step 4: 駆動用 mp4 と参照キーフレームを作る**

```bash
swift pv/tools/encode_image_sequence.swift \
  pv/renders/T91-ldk-push/base pv/renders/T91-ldk-push/base.mp4 24
mkdir -p pv/renders/T91-ldk-push/keyframes
for i in 0000 0012 0024 0036 0048 0060 0072 0084 0095; do
  cp pv/renders/T91-ldk-push/base/$i.png pv/renders/T91-ldk-push/keyframes/$i.png
done
ls pv/renders/T91-ldk-push/keyframes | wc -l
```
Expected: `wrote ... 96 frames @ 24fps` と `9`

- [ ] **Step 5: Topview へ投入する**

Board `house-planner-mobile-PV-2026-07`（`1dcb0110eaf944b2ad5f5f70e3a8a582`）で「オムニリファレンス」タブを選ぶ。

1. `base.mp4` をアップロードする → `@Video1`
2. `keyframes/` の9枚を昇順にアップロードする → `@Image1`〜`@Image9`
3. モデル Seedance 2.0 / アスペクト比 16:9 / 長さ 4s / 解像度 720p / 自動アップスケール OFF
4. 生成ボタン横の `˅` で **クレジットモード**（検証のため即時実行）を選ぶ
5. プロンプト:

> `@Video1` defines the exact camera path, room layout, wall positions, openings and occlusion. `@Image1` through `@Image9` are exact frames sampled from that same path in order — treat every one of them as architectural truth. Keep every wall, opening, window, stair tread, counter and furniture item at the identical position, count, orientation and scale as in `@Video1`. Do not add, remove, move, resize or duplicate any architectural element or any furniture. Do not invent a hob, range hood, worktop, rear wall or any kitchen depth that is not already visible. Only upgrade appearance: physically based materials, global illumination, soft contact shadows, realistic daylight falloff, subtle atmospheric depth, and lived-in surface detail confined to surfaces that already exist. No people, no text, no UI, no logo, no watermark, no flicker, no morphing.

6. 投入後、タスクIDと `生成 ✦4` のクレジット表示を記録する。

- [ ] **Step 6: 出力をフレーム展開して判定する**

生成完了後、mp4 をダウンロードして `/tmp/T91.mp4` に置く。

```bash
mkdir -p /tmp/T91-frames
swift pv/tools/extract_video_frames.swift /tmp/T91.mp4 /tmp/T91-frames \
  0.0 0.5 1.0 1.5 2.0 2.5 3.0 3.5 3.958
```

抽出結果のファイル名を truth の索引（`0000.png`, `0012.png`, …, `0095.png`）に合わせてリネームしたうえで:

```bash
python3 pv/tools/fidelity-qa/report.py \
  --truth pv/renders/T91-ldk-push \
  --generated /tmp/T91-frames \
  --min-recall 0.90 --min-precision 0.85 \
  --json pv/runs/T91-fidelity.json
```

- [ ] **Step 7: 実測から閾値を確定し run note を書く**

`--min-recall 0.90 --min-precision 0.85` は初回の暫定値である。出力された `rows` の実測分布を見て、**目視で明らかに破綻しているフレームと破綻していないフレームを分離できる値**へ調整し、確定値を run note に書く。

`pv/runs/2026-08-03-t91-video-driven-fidelity.md` に記録する項目:
投入日時 / Board / タスクID / モデルと全設定 / クレジット表示 / 使用プロンプト全文 / `report.py` の verdict と compared 件数 / 失敗フレームと理由 / 確定した閾値とその根拠 / 結論（`@Video1` は構造ロックとして機能したか）/ 次の分岐（本設計継続か、密キーフレーム主体へ切替か）。

- [ ] **Step 8: Commit**

```bash
git add pv/tools/truth-render/specs/T91-ldk-push.json \
        pv/runs/2026-08-03-t91-video-driven-fidelity.md \
        pv/runs/T91-fidelity.json
git commit -m "Record T91 video-driven fidelity validation result"
```

---

## Self-Review

**Spec coverage:**

| 仕様の節 | 実装タスク |
|---|---|
| 4.1 データ契約 shot spec | Task 2 |
| 4.2 Layer 1 カメラパス駆動 | Task 1, 5 |
| 4.2 Layer 1 連番バッチ出力 | Task 3, 5 |
| 4.2 Layer 1 本体保護（露出1点・URLガード） | Task 4 |
| 4.2 出力レイアウト（base.mp4 含む） | Task 3, 6 |
| 4.3 Layer 2 入力の組み立て | Task 6, 9 Step 4-5 |
| 4.3 プロンプトテンプレート | Task 9 Step 5 |
| 4.4 Layer 3 エッジ一致・インスタンス存否 | Task 7 |
| 4.4 PASS/FAIL レポートと閾値の後決め | Task 8, 9 Step 7 |
| 5. 検証計画 | Task 9 |
| 6. コスト方針（検証はクレジット） | Task 9 Step 5 |

仕様 4.4 の「部屋segidごとの面積差・重心ずれ」は Task 7 に含めていない。生成側フレームからセグメンテーションを復元する手段が無く（AIは色分けされた領域を返さない）、この指標は truth 同士でしか計算できないため実効性が無い。同じ検出目的は `edge_precision`（無い壁の生成）と `instance_recall`（家具の消失）が担う。この判断は run note に記録する。

**Placeholder scan:** 「TBD」「後で実装」「適切なエラー処理」の類は無い。Task 9 Step 2 の座標のみ実行時採取だが、採取手順のコードと「置き換えずにコミットしない」条件を明記した。閾値の後決めは仕様の意図的な設計であり、決め方の手順を Step 7 に書いた。

**Type consistency:** `edge_recall(truth, generated, radius)` の引数順は Task 7 の定義と Task 8 の `compare_frame` で一致。`instance_recall` は `dict[name -> float]` を返し、`evaluate` は `r["instances"]` として同じ形を読む。`validateShotSpec` / `frameTimes` / `guideFrameIndices` / `GUIDE_KINDS` の名前は Task 2 の定義と Task 5 の import で一致。`window.__PV_CAPTURE__.captureGuide(kind)` は Task 4 で Promise を返すと定義し、Task 5 で `await` している。`capture_server.py` の `KINDS` には Task 5 が使う `probe` を含めてある。
