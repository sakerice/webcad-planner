// 描画の指紋(fingerprint)。切り出し・整理の前後で「絵が変わっていない」ことを見る。
//
// なぜ在るのか
// ------------
// index.html の中の 24,000 行のインライン script を assets/js/ へ切り出していく。
// 切り出しそのものは文字の移動でしかないが、読み込み順を1つ間違えるだけで
// 「エラーは出ないのに絵だけ変わる」種類の壊れ方をする。既存のテストは
// 関数を node:vm で回す単体検査なので、そこは1つも拾えない。
//
// そこで、決め打ちの間取りを決め打ちの視点で実際に描かせ、画素を指紋にして
// 突き合わせる。
//
// 何を測っているか
// ----------------
// 画素をそのまま比べると、GPU のアンチエイリアスや影のディザで毎回わずかに
// ズレて、意味の無い不一致が出る。そこで **24x16 の升目に落として平均し、
// 8段階に量子化** してから比べる。1px のにじみは吸収し、部材の位置・色・
// 有無が変われば必ず動く粒度にしてある。
//
// 使い方
// ------
//   sh tools/run_browser_tests.sh render-fingerprint     # 突き合わせ
//   UPDATE_FINGERPRINT=1 sh tools/run_browser_tests.sh render-fingerprint   # 基準を取り直す
//
// 基準を取り直してよいのは「絵が変わるのが正しい変更」をしたときだけ。
// 落ちたから取り直す、は検査を消すのと同じ。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASELINE = join(HERE, 'fixtures', 'render-fingerprint.json');
const PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const UPDATE = process.env.UPDATE_FINGERPRINT === '1';

// 升目の数。増やすほど細かい違いを拾うが、GPU差で不安定になる。
const COLS = 24, ROWS = 16, LEVELS = 8;

// Playwright は CommonJS なので、名前付きで取れる環境と default 越しの環境がある。
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
const results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  // 起動時の「はじめる間取りを選んでください」はキャンバスを覆う。
  await page.evaluate(() => { const m = document.getElementById('preset-choice-modal'); if (m) m.classList.remove('show'); });

  // ── 決め打ちの間取りを入れる（doImport と同じ手順を、ファイル選択なしで）──
  await page.evaluate((plan) => {
    window._defaultPlanPending = false;
    DATA = JSON.parse(JSON.stringify(plan));
    syncNorthFromPlan(); ensureObjectIds();
    ensureExteriorWallSettings(); ensureInteriorWallSettings();
    ensureRoofAppearance(); ensureFloorMetadata(); syncExteriorWallSettings();
    normalizeLegacyFurnitureItems();
    clearEditHistory();
  }, PLAN);

  // ── 2D: 階ごとに決め打ちの縮尺・位置で描く ──────────────────────────
  async function fingerprint2D(floor) {
    await page.evaluate((fl) => {
      ST.view = '2d'; ST.floor = fl; ST.tool = 'select';
      ST.selected = null; if (typeof clearMultiSelection === 'function') clearMultiSelection();
      // 間取りが画面いっぱいに収まる縮尺と位置を、間取りの外形から毎回同じ式で
      // 決める。決め打ちの数値にすると、凍結した間取りを差し替えた瞬間に
      // 画面外へ飛んで「真っ白の指紋」になる。
      var xs = [], ys = [];
      (DATA.walls || []).forEach(function (w) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); });
      (DATA.rooms || []).forEach(function (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.d); });
      var c = document.getElementById('c2d');
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      var pxPerMm = Math.min(c.width / (maxX - minX + 2000), c.height / (maxY - minY + 2000));
      ST.zoom = pxPerMm / 0.05;                       // w2c は zoom*0.05 を px/mm として使う
      ST.panX = c.width / 2 - (minX + maxX) / 2 * pxPerMm;
      ST.panY = c.height / 2 - (minY + maxY) / 2 * pxPerMm;
      c.style.display = 'block';
      draw2d();
    }, floor);
    return await page.evaluate(({ cols, rows, levels }) => {
      const c = document.getElementById('c2d');
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return window.__grid(px.data, c.width, c.height, cols, rows, levels, false);
    }, { cols: COLS, rows: ROWS, levels: LEVELS });
  }

  // ── 升目に落とす処理をページ側へ置く（2Dも3Dも同じ式で測る）───────────
  await page.evaluate(() => {
    // flipY: WebGL の readPixels は下から上に並ぶので、行を逆に読む。
    window.__grid = function (data, w, h, cols, rows, levels, flipY) {
      const out = [];
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const x0 = Math.floor(gx * w / cols), x1 = Math.floor((gx + 1) * w / cols);
          const y0 = Math.floor(gy * h / rows), y1 = Math.floor((gy + 1) * h / rows);
          let r = 0, g = 0, b = 0, n = 0;
          // 升の中を間引いて読む。全画素舐めると大きな画面で無駄に遅い。
          const step = Math.max(1, Math.floor((x1 - x0) / 8));
          for (let y = y0; y < y1; y += step) {
            const sy = flipY ? (h - 1 - y) : y;
            for (let x = x0; x < x1; x += step) {
              const i = (sy * w + x) * 4;
              r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
            }
          }
          if (!n) { out.push('000'); continue; }
          const q = v => Math.min(levels - 1, Math.floor((v / n) * levels / 256)).toString(levels);
          out.push(q(r) + q(g) + q(b));
        }
      }
      return out;
    };
  });

  results['2d-floor1'] = await fingerprint2D(1);
  results['2d-floor2'] = await fingerprint2D(2);

  // ── 3D: 外観を決め打ちのカメラで描く ────────────────────────────────
  //
  // 家具の GLB は非同期に届き、届くたびに建て直される。「全部届くまで待つ」
  // 作りにすると、数十体ぶんの通信で毎回数分かかるうえ、どこまで届いた時点の
  // 絵かで指紋が揺れる。ここで見たいのは壁・屋根・開口・床・敷地——つまり
  // 切り出す対象そのものなので、**GLBは一律で使わない**ことにして、
  // 内蔵の代替形状で描かせる。ensureGltfModel は全ての呼び出し元が
  // 「真なら GLB、偽なら代替形状」で分岐しているので、偽を返せば足りる。
  await page.evaluate(() => {
    window.ensureGltfModel = function () { return false; };
    setView('3d-ext');
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));

  results['3d-ext'] = await page.evaluate(({ cols, rows, levels }) => {
    // 視点を決め打ちにする。OrbitControls の慣性が残っていると毎回わずかに動く。
    if (orbit) { orbit.target.set(0, 1.2, 0); }
    camExt.position.set(18, 12, 22);
    camExt.lookAt(0, 1.2, 0);
    camExt.updateProjectionMatrix();
    if (orbit) orbit.update();
    render3DNow();
    const gl = ren.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return window.__grid(buf, w, h, cols, rows, levels, true);
  }, { cols: COLS, rows: ROWS, levels: LEVELS });

  assert.deepEqual(errors, [], 'ページで例外が出ている');
} finally {
  await browser.close();
}

// ── 突き合わせ ────────────────────────────────────────────────────────
// 真っ白・真っ黒の指紋は「描けていない」だけなので、基準として保存しない。
for (const [name, grid] of Object.entries(results)) {
  const distinct = new Set(grid).size;
  assert.ok(distinct > 3, `${name}: 升目が${distinct}種類しかない。描けていない疑い`);
}

if (UPDATE || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({ cols: COLS, rows: ROWS, levels: LEVELS, views: results }, null, 1) + '\n');
  console.log(UPDATE ? '基準を取り直した: ' + BASELINE : '基準が無かったので作った: ' + BASELINE);
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  assert.equal(base.cols, COLS); assert.equal(base.rows, ROWS); assert.equal(base.levels, LEVELS);
  let bad = 0;
  for (const [name, grid] of Object.entries(results)) {
    const want = base.views[name];
    assert.ok(want, `基準に ${name} が無い`);
    const diff = grid.map((v, i) => v === want[i] ? null : { cell: [i % COLS, Math.floor(i / COLS)], want: want[i], got: v }).filter(Boolean);
    if (diff.length) {
      bad += diff.length;
      console.error(`${name}: ${diff.length}/${grid.length} 升がずれた`);
      diff.slice(0, 12).forEach(d => console.error(`  (${d.cell[0]},${d.cell[1]}) 基準=${d.want} 今回=${d.got}`));
    }
  }
  assert.equal(bad, 0, '描画が基準から動いている');
  console.log('描画の指紋: ' + Object.keys(results).join(', ') + ' すべて一致');
}
