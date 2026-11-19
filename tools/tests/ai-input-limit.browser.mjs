// AI に渡す文の入力欄の字数の上限(500 字。文字=コードポイント)と、個人情報の注意を、実物の画面で確かめる。
//
//   1. 「AIに頼む」の入力欄: ふだんは字数を出さない。残り 50 字を切ると「あと N 字」を出す。500 字で止まり、
//      貼り付け・打ち込みで超えた分は入らず「500字までです。超えた分は入りませんでした。」を出す。絵文字は1字と数える。
//      送ったあとは字数の表示を消す。
//   2. 読み取りの補足・画像AI と動画AI の仕上げメモの入力欄も、同じ上限と同じ見せ方。
//   3. 個人情報の注意が、チャットの入力欄のそばと読み取りの画面に見えている。スマホ幅(375px)で送るボタンが画面の中にある。
//
// SHOT_DIR を渡すと、スマホ幅(375×812)とタブレット幅(768×1024)の画面を撮ってそこへ保存する(持ち主に見せる用)。
// sh tools/run_browser_tests.sh ai-input-limit
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const SHOT_DIR = process.env.SHOT_DIR || '';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const T = { timeout: 60000 };
const MAX = 500;

async function open(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  return { page, errors };
}

const count = (page, id) => page.evaluate((i) => {
  const n = document.getElementById(i);
  return { hidden: n.hidden || getComputedStyle(n).display === 'none', text: n.textContent };
}, id);
const valueLen = (page, id) => page.evaluate((i) => Array.from(document.getElementById(i).value).length, id);
// 貼り付け(クリップボードの中身を持つ paste の出来事を送る。ブラウザの既定の貼り付けと同じく、入力欄の側が中身を入れる)
const paste = (page, id, text) => page.evaluate(({ i, t }) => {
  const n = document.getElementById(i);
  n.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  if (n.dispatchEvent(ev)) { n.setRangeText(t, n.selectionStart, n.selectionEnd, 'end'); n.dispatchEvent(new Event('input', { bubbles: true })); }
}, { i: id, t: text });
const setValue = (page, id, text) => page.evaluate(({ i, t }) => {
  const n = document.getElementById(i);
  n.value = t;
  n.dispatchEvent(new Event('input', { bubbles: true }));
}, { i: id, t: text });

async function checkField(page, input, note, label) {
  await setValue(page, input, '');
  assert.equal((await count(page, note)).hidden, true, label + ': 空のときに字数が出ている');
  await setValue(page, input, 'あ'.repeat(440));
  assert.equal((await count(page, note)).hidden, true, label + ': 残り 60 字で字数が出ている');
  await setValue(page, input, 'あ'.repeat(468));
  let c = await count(page, note);
  assert.equal(c.hidden, false, label + ': 残り 32 字で字数が出ていない');
  assert.equal(c.text, 'あと 32 字', label);
  // 絵文字は1字
  await setValue(page, input, '😀'.repeat(MAX));
  c = await count(page, note);
  assert.equal(c.text, 'あと 0 字', label + ': 絵文字を2字と数えている');
  assert.equal(await valueLen(page, input), MAX, label);
  // 打ち込みで超えた分は入らない
  // 見えている欄は実際に打ち込む。閉じた画面の中の欄(画像AI・動画AI)は値を入れて input を送る
  if (await page.isVisible('#' + input)) { await page.focus('#' + input); await page.keyboard.insertText('い'); }
  else await setValue(page, input, '😀'.repeat(MAX) + 'い');
  assert.equal(await valueLen(page, input), MAX, label + ': 打ち込みで上限を超えた');
  assert.match((await count(page, note)).text, /500字までです。超えた分は入りませんでした。/, label);
  // 貼り付けは入る分だけ入れる
  await setValue(page, input, 'あ'.repeat(490));
  await paste(page, input, 'い'.repeat(100));
  assert.equal(await valueLen(page, input), MAX, label + ': 貼り付けで上限を超えた');
  assert.ok((await page.inputValue('#' + input)).endsWith('い'.repeat(10)), label + ': 貼り付けた先頭の 10 字が入っていない');
  assert.match((await count(page, note)).text, /500字までです/, label);
  // 読み上げの欄は、上限に近づいた・超えた分を入れなかったときに書かれる
  const live = await page.evaluate((i) => { const n = document.getElementById(i).nextElementSibling; return n && n.getAttribute('aria-live') + ':' + n.textContent; }, note);
  assert.match(live, /^polite:/, label);
  assert.ok((await page.getAttribute('#' + input, 'aria-describedby') || '').includes(note), label + ': 字数の表示と入力欄を結んでいない');
  await setValue(page, input, '');
}

const browser = await chromium.launch();
try {
  // ── タブレットより広い幅で、4つの入力欄 ──
  const { page, errors } = await open(browser, { width: 1280, height: 800 });
  await page.evaluate(() => openChat());
  await page.waitForSelector('#chat-panel:not([hidden])', T);
  assert.equal(await page.isVisible('#chat-privacy-note'), true, 'チャットの個人情報の注意が見えない');
  assert.match(await page.textContent('#chat-privacy-note'), /個人情報は入力しないでください/);
  await checkField(page, 'chat-input', 'chat-input-count', 'チャット');
  await page.evaluate(() => closeChat());
  await page.evaluate(() => openPlanImport());
  await page.waitForSelector('#plan-import-privacy-note', { state: 'visible', ...T });
  assert.match(await page.textContent('#plan-import-privacy-note'), /氏名や住所が写っている場合は、隠してから選んでください/);
  await checkField(page, 'plan-import-hint', 'plan-import-hint-count', '読み取りの補足');
  await checkField(page, 'ai-render-style-input', 'ai-render-style-count', '画像AIの仕上げメモ');
  await checkField(page, 'video-render-note', 'video-render-note-count', '動画AIの仕上げメモ');
  assert.deepEqual(errors, []);
  await page.close();

  // ── スマホ幅・タブレット幅: 注意が入力欄や送るボタンを押し出さない。画面を撮る ──
  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
  for (const [name, vp] of [['phone-375', { width: 375, height: 812 }], ['tablet-768', { width: 768, height: 1024 }]]) {
    const { page: p, errors: errs } = await open(browser, vp);
    await p.evaluate(() => openChat());
    await p.waitForSelector('#chat-panel:not([hidden])', T);
    for (const id of ['chat-input', 'chat-send', 'chat-privacy-note']) {
      const box = await p.locator('#' + id).boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height + 1 && box.x >= 0 && box.x + box.width <= vp.width + 1, `${name}: #${id} が画面の外にある ${JSON.stringify(box)}`);
    }
    if (SHOT_DIR) await p.screenshot({ path: join(SHOT_DIR, `${name}-chat.png`) });
    await setValue(p, 'chat-input', '寝室にベッドを置いて。'.repeat(43) + 'あ'.repeat(4));
    assert.equal((await count(p, 'chat-input-count')).text, 'あと 23 字', name);
    const sendBox = await p.locator('#chat-send').boundingBox();
    assert.ok(sendBox && sendBox.y + sendBox.height <= vp.height + 1, `${name}: 字数を出すと送るボタンが押し出される`);
    if (SHOT_DIR) await p.screenshot({ path: join(SHOT_DIR, `${name}-chat-near-limit.png`) });
    await p.evaluate(() => closeChat());
    await p.evaluate(() => openPlanImport());
    await p.waitForSelector('#plan-import-privacy-note', { state: 'visible', ...T });
    if (SHOT_DIR) await p.screenshot({ path: join(SHOT_DIR, `${name}-plan-import.png`) });
    assert.deepEqual(errs, [], name);
    await p.close();
  }
  console.log('ai-input-limit: ok');
} finally {
  await browser.close();
}
