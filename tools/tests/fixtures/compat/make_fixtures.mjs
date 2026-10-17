// 互換テストの見本を作る。**普段は流さない。**
//
// 見本は「本番の利用者の手元にある保存データ」の写し。本番(main)の画面で
// 既定間取りを開き、本物の「保存」を通して IndexedDB に入った文字列を
// そのまま書き出す。手で JSON を組むと、保存の時にだけ足される値
// (heightDefaults, viewState など) が抜けて、利用者のデータと別物になる。
//
//   APP_URL=http://localhost:8791/ PLAYWRIGHT_MODULE=... node tools/tests/fixtures/compat/make_fixtures.mjs
//
// 作り直してよいのは README.md に書いた場合だけ。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

async function savedString(browser, preset) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + '?preset=' + preset);
  await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  // 利用者が手を入れた跡を付ける。既定間取りのままだと、保存が開けずに
  // 既定間取りが出ただけの状態と見分けが付かない。
  await page.evaluate(() => {
    const room = DATA.rooms.find((m) => m.floor === 1 && m.n);
    room.n = '互換テストの部屋';
    const item = DATA.items.find((i) => i.floor === 1 && /^fmp-/.test(i.type));
    item.x = (Number(item.x) || 0) + 123;
  });
  await page.evaluate(() => savePlanToStorage());
  const raw = await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('webcad');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const g = r.result.transaction('plans').objectStore('plans').get('webcad-plan-v1');
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    };
  }));
  // 古い利用者の手元にある、旧カタログの扉の ID を本物のカタログから拾う
  const legacyDoor = await page.evaluate(() => {
    const d = Object.values(FMP_ITEMS).find((x) => x && x.category === 'ドア');
    return d ? { id: d.id, w: d.w, d: d.d } : null;
  });
  await context.close();
  if (typeof raw !== 'string' || raw.length < 1000) throw new Error(preset + ' の保存が取れなかった');
  return { raw, legacyDoor };
}

// 長く使われてきた保存に実際に混ざっている古い値を、1つずつ入れる。
function withLegacyQuirks(plan, legacyDoor) {
  const p = JSON.parse(JSON.stringify(plan));
  const w = p.walls.find((x) => x.floor === 1);
  w.thick = String(w.thick);                       // 壁厚が文字列
  const z = { ...w, id: 990001, thick: 120 };
  z.x2 = z.x1; z.y2 = z.y1;                         // 長さ0の壁
  p.walls.push(z);
  p.items.push({ id: 990002, type: 'tv', x: 1000, y: 1000, w: 900, d: 200, floor: 1 });   // 廃止された tv
  if (!legacyDoor) throw new Error('旧カタログの扉が見つからない');
  p.items.push({ id: 990003, type: legacyDoor.id, x: 2000, y: 2000, w: legacyDoor.w || 780, d: legacyDoor.d || 50, rot: 0, floor: 1 });
  const noId = p.items.find((x) => x.type !== 'tv' && x.floor === 1 && x.id !== undefined);
  delete noId.id;                                   // id の無い物
  return p;
}

const browser = await chromium.launch();
try {
  const two = await savedString(browser, '2f');
  const three = await savedString(browser, '3f');
  writeFileSync(join(HERE, 'saved-2f.json'), two.raw);
  writeFileSync(join(HERE, 'saved-3f.json'), three.raw);
  writeFileSync(join(HERE, 'legacy-quirks.json'), JSON.stringify(withLegacyQuirks(JSON.parse(two.raw), two.legacyDoor)));
  console.log('見本を書き出した:', HERE, '旧カタログの扉:', two.legacyDoor && two.legacyDoor.id);
} finally {
  await browser.close();
}
