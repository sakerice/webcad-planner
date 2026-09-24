// 書き出しが、本当にファイルとして保存されること。
//
// 報告:「書き出したのに、読み込むと古い間取りが出てくる」。実測で、同じ
// 8月14日のファイルが5回続けて渡されていた（md5 まで一致）。
//
// 原因は data: の URL。**iOS Safari は data: に対して download 属性を尊重せず、
// ファイルを作らない。** 大きさの問題もあり、実測したプラン(JSON 3.6MB)は
// data: の URL にすると 4.5MB の文字列になる。
//
// Blob と createObjectURL なら保存される。ここでは「保存が始まり、落ちた中身が
// いまの間取りと一致する」ことを見る。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto((process.env.APP_URL || 'http://localhost:8932/') + '?preset=2f');
  await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });

  // 見分けのつく値を入れておく（落ちたファイルが「いまの間取り」かを見るため）
  await page.evaluate(() => {
    const f = DATA.items.find((i) => i.type === 'foundation');
    if (f) { f.color = '#d6d6d6'; f.colorCustom = true; }
    setDefaultWallHeight(null, 2686);
  });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(() => exportPlan()),
  ]);
  assert.equal(download.suggestedFilename(), 'plan.json', 'ファイル名が違う');

  const path = await download.path();
  assert.ok(path, 'ファイルが保存されていない');
  const { readFileSync } = await import('node:fs');
  const saved = JSON.parse(readFileSync(path, 'utf8'));

  const want = await page.evaluate(() => ({
    walls: DATA.walls.length, rooms: DATA.rooms.length, items: DATA.items.length,
    基礎: (DATA.items.find((i) => i.type === 'foundation') || {}).color,
    既定値: DATA.heightDefaults.wallHeight,
  }));
  assert.equal(saved.walls.length, want.walls, '壁の数が合わない');
  assert.equal(saved.rooms.length, want.rooms, '部屋の数が合わない');
  assert.equal(saved.items.length, want.items, '物の数が合わない');
  assert.equal((saved.items.find((i) => i.type === 'foundation') || {}).color, want.基礎,
    '基礎の色が落ちたファイルに入っていない');
  assert.equal(saved.heightDefaults && saved.heightDefaults.wallHeight, want.既定値,
    '壁・床の既定値が落ちたファイルに入っていない');

  // data: の URL へ戻っていないこと。戻ると iPad で保存できなくなる。
  const src = await page.evaluate(() => document.documentElement.outerHTML.length);
  assert.ok(src > 0);
  assert.ok(!(await page.evaluate(() => String(downloadJsonFile).includes("a.href='data:"))),
    '書き出しが data: の URL に戻っている（iPadで保存できない）');

  assert.deepEqual(errors, [], 'ページで例外が出ている: ' + errors.join(' / '));
  console.log('書き出し: Blobで保存され、中身はいまの間取りと一致した');
} finally {
  await browser.close();
}
