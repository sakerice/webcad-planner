// 短い指示での読み取り（/api/ai/read-plan、答えを少しずつ受け取る）を、実際のブラウザで通しで動かす。
//
// AIは呼ばない。fetch を差し替えて、Worker がそのまま流す Anthropic の返事（SSE）を少しずつ返す。
// 見たいのは次のこと。
//   - 考えている間は「考えています」と経過・目安・AIのメモが出て、書き出しに入ると何階の何を
//     作っているかに変わる（利用者が待っている間に何も起きていないように見えない）
//   - 届ききった答えから下書きができ、取り込むと扉の向き（flipX/flipY）と家具がそのとおり入る
//   - 最初の答えを組み立てた家の平面図と外観3Dを撮り、見直し（review-plan-3d）に送る。
//     見直した答え（ここでは屋根を足したもの）で下書きができる
//   - read-plan が使えない環境（404）では、これまでの読み取り（import-plan）に戻る
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const SHOT = process.env.PLAN_STREAM_SHOT || '';

const ANSWER = {
  floors: [{
    floor: 1,
    walls: [
      { x1: 0, y1: 0, x2: 3640, y2: 0 }, { x1: 3640, y1: 0, x2: 3640, y2: 2730 },
      { x1: 3640, y1: 2730, x2: 0, y2: 2730 }, { x1: 0, y1: 2730, x2: 0, y2: 0 },
    ],
    rooms: [{ name: '洋室', parts: [{ x0: 0, y0: 0, x1: 3640, y1: 2730 }] }],
    openings: [
      { type: 'door-swing', x: 1000, y: 2730, width: 780, hinge: 'E', opens: 'N' },
      { type: 'window', x: 1820, y: 0, width: 1650, hinge: null, opens: null },
    ],
    stairs: [],
    objects: [{ kind: 'sofa', x: 1820, y: 600, w: 1800, d: 850, face: 'S' }],
  }],
  notes: [],
};

async function openWithPng(page) {
  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.locator('#preset-choice-modal .preset-blank-btn', { hasText: '間取り図の画像から下書きを作る' }).click();
  await page.waitForSelector('#plan-import-modal.show', { timeout: 5000 });
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300);
    g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(40, 40, 200, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#plan-import-file').setInputFiles({ name: 'madori.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForSelector('#plan-import-step2', { state: 'visible', timeout: 5000 });
}

try {
  // ── 答えを少しずつ受け取る ────────────────────────────────────────
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await openWithPng(page);

  await page.evaluate((answer) => {
    const text = JSON.stringify(answer);
    const ev = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
    const parts = [
      ev({ type: 'message_start', message: { usage: { input_tokens: 6000 } } }),
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '外形の寸法 3,640 × 2,730 を確かめています。' } }),
    ];
    // 答えは細かく刻んで流す（書き出しの途中を画面が数える）。
    for (let i = 0; i < text.length; i += 40) {
      parts.push(ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(i, i + 40) } }));
    }
    parts.push(ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4000 } }));
    parts.push(ev({ type: 'message_stop' }));
    window.__streamGate = { released: 0 };
    // 見直しの答え: 最初の答えに屋根を足したもの。
    const reviewed = JSON.parse(text);
    reviewed.floors[0].roofs = [{ floor: 1, x0: -450, y0: -450, x1: 4090, y1: 3180, shape: 'gable', ridge: 'EW', low: null, pitch: 25 }];
    reviewed.notes = ['屋根を足しました。'];
    const reviewText = JSON.stringify(reviewed);
    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/ai/quota')) return new Response(JSON.stringify({ left: null, counted: false }));
      if (String(url).includes('/api/ai/review-plan-3d')) {
        window.__review = JSON.parse(opts.body);
        let body = ev({ type: 'message_start', message: { usage: { input_tokens: 9000 } } });
        for (let i = 0; i < reviewText.length; i += 200) body += ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: reviewText.slice(i, i + 200) } });
        body += ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3000 } });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (!String(url).includes('/api/ai/read-plan')) return new Response('{}', { status: 404 });
      const enc = new TextEncoder();
      let i = 0;
      return new Response(new ReadableStream({
        async pull(ctrl) {
          // 考えている途中で一度止める（その間の画面を検査する）。
          if (i === 3) { while (!window.__streamGate.released) await new Promise((r) => setTimeout(r, 50)); }
          if (i === 3 + 6) { while (window.__streamGate.released < 2) await new Promise((r) => setTimeout(r, 50)); }
          if (i >= parts.length) { ctrl.close(); return; }
          ctrl.enqueue(enc.encode(parts[i++]));
          await new Promise((r) => setTimeout(r, 15));
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  }, ANSWER);

  await page.locator('#plan-import-run').click();
  await page.waitForSelector('#plan-import-progress:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => /AIのメモ/.test(document.getElementById('plan-import-progress-thought').textContent), null, { timeout: 5000 });
  const thinking = await page.evaluate(() => ({
    phase: document.getElementById('plan-import-progress-phase').textContent,
    time: document.getElementById('plan-import-progress-time').textContent,
    thought: document.getElementById('plan-import-progress-thought').textContent,
  }));
  assert.match(thinking.phase, /考えています/);
  assert.match(thinking.phase, /^1\/2 読み取り/, '何段目かを出す');
  assert.match(thinking.time, /経過 .*目安 2分00秒/, '図面1枚の目安は、読み取り1分＋見直し1分');
  assert.match(thinking.thought, /外形の寸法/);

  await page.evaluate(() => { window.__streamGate.released = 1; });
  await page.waitForFunction(() => /階の/.test(document.getElementById('plan-import-progress-phase').textContent), null, { timeout: 5000 });
  await page.waitForTimeout(700);
  const writing = await page.evaluate(() => ({
    phase: document.getElementById('plan-import-progress-phase').textContent,
    made: document.getElementById('plan-import-progress-made').textContent,
  }));
  assert.match(writing.phase, /1階の(壁|部屋|窓・扉)を置いています/);
  assert.match(writing.made, /作ったもの: 壁 \d+/);
  if (SHOT) await page.locator('#plan-import-modal .unity-render-card').screenshot({ path: SHOT });

  await page.evaluate(() => { window.__streamGate.released = 2; });
  await page.waitForSelector('#plan-import-step3', { state: 'visible', timeout: 10000 });
  assert.equal(await page.isHidden('#plan-import-progress'), true, '終わったら進み具合を閉じる');
  const summary = await page.textContent('#plan-import-summary');
  assert.match(summary, /壁 4 \/ 部屋 1/);
  // 見直しには、元の図面・組み立てた家の平面図と外観3D・最初の答え・機械で分かった事実を送る。
  const review = await page.evaluate(() => ({
    images: window.__review.images.length,
    shots: window.__review.shots.map((s) => s.label),
    shotOk: window.__review.shots.every((s) => /^data:image\/(jpeg|png);base64,/.test(s.image)),
    facts: window.__review.facts,
    first: window.__review.answer.floors[0].walls.length,
  }));
  assert.equal(review.images, 1);
  assert.ok(review.shots.includes('1階 平面図'), review.shots.join(','));
  assert.ok(review.shots.some((l) => /外観3D 南から/.test(l)), '外観3Dを撮っている');
  assert.ok(review.shotOk);
  assert.equal(review.first, 4);
  assert.ok(review.facts.some((f) => /屋根を答えていません/.test(f)), '機械で分かった事実を伝える');
  const notes = await page.textContent('#plan-import-notes');
  assert.match(notes, /立体にして図面と見比べ、整えました/);
  assert.ok(!/屋根を足しました/.test(notes), 'AI の作業メモは利用者に見せない');
  const shown = await page.evaluate(() => document.getElementById('plan-import-modal').innerText);
  assert.ok(!/円|トークン|秒）|\(\d+, \d+\)/.test(shown.replace(/経過 .*）/g, '')), '費用・トークン数・座標を出さない: ' + shown);

  // 取り込みの確認はダイアログの中に出る（ブラウザの確認の窓は、埋め込まれた画面では出ずに
  // 「いいえ」が返り、押しても何も起きないように見えた）。「取り込んでいます」を出してから組み立てる。
  await page.locator('#plan-import-apply').click();
  await page.waitForSelector('#plan-import-confirm:not([hidden])', { timeout: 5000 });
  assert.match(await page.textContent('#plan-import-confirm-text'), /読み取った下書き（1階）/, '確認の文に無い階を出さない');
  await page.evaluate(() => { window.confirm = () => { throw new Error('confirm を使っている'); }; });
  await page.locator('#plan-import-confirm-yes').click();
  assert.match(await page.textContent('#plan-import-status'), /取り込んでいます/, '取り込み中に何が起きているかを出す');
  await page.waitForFunction(() => !document.querySelector('#plan-import-modal.show'), null, { timeout: 10000 });
  const placed = await page.evaluate(() => ({
    door: DATA.items.find((i) => i.type === 'door-swing'),
    sofa: DATA.items.find((i) => i.kind === 'sofa' || /sofa/i.test(i.type)),
    walls: DATA.walls.length,
    roofs: DATA.items.filter((i) => i.type === 'roof').map((i) => i.roofType),
  }));
  assert.deepEqual(placed.roofs, ['gable'], '見直しで足した屋根を使い、壁から作る平らな屋根は重ねない');
  assert.equal(placed.walls, 4);
  assert.ok(placed.door, '開き戸が入っている');
  // 壁 (3640,2730)→(0,2730) は西向き。吊り元が東＝始点側なので flipX=false、北へ開く＝進行方向の
  // 右手（北）なので flipY=false。
  assert.equal(placed.door.flipX, false);
  assert.equal(placed.door.flipY, false);
  assert.equal(placed.door.doorOpenState, 'closed');
  assert.ok(placed.sofa, "ソファが置かれている（家具も再現する）");
  // カタログのソファは rot+180 の側が正面（modelFacingVersion 1）。正面が南 → rot 0。
  assert.equal(placed.sofa.modelFacingVersion, 1);
  assert.equal(((placed.sofa.rot % 360) + 360) % 360, 0, '正面が南');
  assert.equal(placed.sofa.w, 1800, '寸法は図面の読み取りのまま（既定に戻さない）');
  assert.deepEqual(errors, []);
  await page.close();

  // ── read-plan が使えない環境では、これまでの読み取りに戻る ─────────────
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openWithPng(page2);
  const asked = await page2.evaluate(async () => {
    const seen = [];
    window.fetch = async (url) => {
      seen.push(String(url));
      if (String(url).includes('/api/ai/read-plan')) return new Response('{"error":"not_available"}', { status: 404 });
      return new Response(JSON.stringify({ error: 'ai_not_configured', message: 'x' }), { status: 503 });
    };
    window.__seen = seen;
    return true;
  });
  assert.ok(asked);
  await page2.locator('#plan-import-run').click();
  await page2.waitForFunction(() => window.__seen.some((u) => u.includes('/api/ai/import-plan')), null, { timeout: 5000 });
  await page2.close();
  console.log('plan-import-stream: ok');
} finally {
  await browser.close();
}
