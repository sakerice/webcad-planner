// 更新前に開いたままのタブ(古い画面)が、新しいサーバーの部屋で共同編集を続けられること。本物のサーバーで通す。
//
// なぜ要るか: 本番に出すと、サーバーは入れ替わるが、利用者が開いたままのタブは読み込み直すまで古い画面のまま。
// PR #130 で部屋は、外部 AI の差分に印(source:"ai")を付け、入室の知らせに aiEditsOff を足し、
// 止める・受け付けるの知らせ(type "ai-edits")を配るようになった。古い画面はどれも知らない。
//
// 古い画面 = PR #130 より前(コミット d6c3fa56)の index.html と、そこから変わった assets のファイル。
// local-worker.mjs がそれを /__old/index.html に置き、同じ Worker・同じ部屋に新しい画面と並べてつなぐ。
//
// 場面: 古い画面と新しい画面で同じ部屋を開き、
//   1. 新しい画面の編集が古い画面に届き、古い画面の編集が新しい画面とサーバーに届く
//   2. /api/mcp の addRoom(印の付いた差分)が古い画面に届き、古い画面が落ちない
//   3. 新しい画面で外部 AI からの変更を止める・受け付ける(type "ai-edits" の知らせ)。古い画面が落ちず、その後の編集も届く
//   4. 止めている部屋に古い画面が入り直す(入室の知らせに aiEditsOff)。開けて、編集が届く
//
// sh tools/run_browser_tests.sh shared-old-screen
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker, callMcp, roomPlan, createRoom } from './local-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const OLD_COMMIT = process.env.OLD_COMMIT || 'd6c3fa56';
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startLocalWorker({ oldUi: OLD_COMMIT });
const browser = await chromium.launch();
const errors = { old: [], new: [] };

async function open(which, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors[which].push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors[which].push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(url);
  await page.waitForFunction(() => window.SHARED && SHARED.roomId && window.DATA && DATA.walls.length > 4 && SHARED.socket && SHARED.socket.readyState === 1, null, T);
  return { context, page };
}
const edit = (page, thick) => page.evaluate((thick) => { DATA.walls[0].thick = thick; sharedMarkIdsDirty([DATA.walls[0].id]); markDirty(); }, thick);
const thickIs = (page, thick) => page.waitForFunction((t) => DATA.walls[0].thick === t, thick, T);
async function waitServer(roomId, test, what) {
  for (let i = 0; i < 60; i++) { if (test((await roomPlan(server.origin, roomId)).plan)) return; await sleep(250); }
  throw new Error(`サーバーの部屋が ${what} にならない`);
}

let passed = 0;
try {
  assert.ok(server.old.used.length > 0, '古い画面に差し替えるファイルが無い');
  const room = await createRoom(server.origin, PLAN);
  const oldA = await open('old', server.oldApp + '#room=' + room.roomId);
  // 本当に古い画面か(PR #130 で足した物が無い)
  assert.equal(await oldA.page.evaluate(() => typeof window.sharedApplyAiPatch), 'undefined', '古い画面になっていない');
  assert.equal(await oldA.page.evaluate(() => !!document.getElementById('ai-edit-bar')), false, '古い画面になっていない');
  const newB = await open('new', server.app + '#room=' + room.roomId);
  const t0 = PLAN.walls[0].thick;

  // 1. 双方向の編集
  await edit(newB.page, t0 + 10);
  await thickIs(oldA.page, t0 + 10);
  await sleep(1200);
  await edit(oldA.page, t0 + 20);
  await thickIs(newB.page, t0 + 20);
  await waitServer(room.roomId, (p) => p.walls[0].thick === t0 + 20, '古い画面の編集の入った状態');
  passed++; console.log('ok 1 古い画面と新しい画面の編集が互いに届く');

  // 2. 外部 AI の差分(印つき)
  const n0 = await oldA.page.evaluate(() => DATA.rooms.length);
  const r = await callMcp(server.origin, 'addRoom', { plan: room.url, x: 20000, y: 0, w: 2000, d: 2000, name: '書斎' });
  assert.equal(r.isError, false, r.text.slice(0, 300));
  await oldA.page.waitForFunction((n) => DATA.rooms.length === n + 1, n0, T);
  await newB.page.waitForFunction((n) => DATA.rooms.length === n + 1 && !document.getElementById('ai-edit-bar').hidden, n0, T);
  passed++; console.log('ok 2 外部 AI の差分が古い画面に届き、落ちない');

  // 3. 止める・受け付けるの知らせ
  await newB.page.evaluate(() => sharedSetAiEdits(true));
  await newB.page.waitForFunction(() => SHARED.aiEditsOff === true, null, T);
  await sleep(500);
  await newB.page.evaluate(() => sharedSetAiEdits(false));
  await newB.page.waitForFunction(() => SHARED.aiEditsOff === false, null, T);
  await sleep(500);
  assert.equal(await oldA.page.evaluate(() => SHARED.socket && SHARED.socket.readyState), 1, '古い画面の接続が切れた');
  await edit(newB.page, t0 + 30);
  await thickIs(oldA.page, t0 + 30);
  passed++; console.log('ok 3 止める・受け付けるの知らせを受けても、古い画面は落ちず、その後の編集も届く');

  // 4. 止めている部屋に古い画面が入り直す
  await newB.page.evaluate(() => sharedSetAiEdits(true));
  await newB.page.waitForFunction(() => SHARED.aiEditsOff === true, null, T);
  await oldA.page.reload();
  await oldA.page.waitForFunction(() => window.SHARED && SHARED.roomId && DATA.walls.length > 4 && SHARED.socket && SHARED.socket.readyState === 1, null, T);
  assert.equal(await oldA.page.evaluate(() => DATA.walls[0].thick), t0 + 30);
  await sleep(1200);
  await edit(oldA.page, t0 + 40);
  await thickIs(newB.page, t0 + 40);
  passed++; console.log('ok 4 止めている部屋に古い画面が入り直せて、編集が届く');

  assert.deepEqual(errors, { old: [], new: [] });
  console.log(`shared-old-screen: ${passed} 件 ok`);
} catch (e) {
  console.error('ページのエラー: ' + JSON.stringify(errors, null, 1));
  throw e;
} finally {
  await browser.close();
  await server.stop();
}
