// 読み取りの答え（短い指示の形）を本物のアプリで組み立て、見直しに渡すのと同じ画像（各階の平面図・
// 外観3D）と、機械で分かる事実を書き出す。エージェントで見直しを試すため（API の費用をかけない）。
//
//   APP_URL=http://localhost:8791/ node tools/plan-eval/snapshot.mjs <答え.json> <出力先>
//   → 出力先に shot-N.jpg と shots.json（[{label, file}]）と facts.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [answerPath, outDirArg] = process.argv.slice(2);
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });
const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(process.env.APP_URL || 'http://localhost:8791/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.waitForTimeout(1500);
  // 画面の流れ（plan-import.js の readPlanStream）と同じ部品で組み立てて撮る。
  const r = await page.evaluate((answer) => {
    const tags = (CATALOGUE_TAGS && CATALOGUE_TAGS.items) || {};
    const draft = PlanFreeApply.toImportPlan(answer, tags, { keepOffWall: true });
    const facts = PlanFreeApply.factsOf(draft, answer);
    const app = PlanImport.toAppObjects(draft);
    let made = PlanStructure.structureFor(app.walls);
    if (app.items.some((i) => i.type === 'roof')) made = made.filter((s) => s.type !== 'roof');
    made = made.map((s) => { const it = mkItem(s.type, s.x, s.y, s.rot || 0, s.floor, s.w, s.d); Object.keys(s).forEach((k) => { if (!['type', 'x', 'y', 'w', 'd', 'rot', 'floor'].includes(k)) it[k] = s[k]; }); return it; });
    const shots = PlanSnapshot.capture({ walls: app.walls, rooms: app.rooms, items: app.items.concat(made) });
    return { facts, shots: shots.plans.map((s) => ({ label: s.floor + '階 平面図', url: s.url })).concat(shots.views.map((s) => ({ label: '外観3D ' + s.name, url: s.url }))) };
  }, answer);
  const list = r.shots.map((s, i) => {
    const file = join(outDir, `shot-${i + 1}.jpg`);
    writeFileSync(file, Buffer.from(s.url.split(',')[1], 'base64'));
    return { label: s.label, file };
  });
  writeFileSync(join(outDir, 'shots.json'), JSON.stringify(list, null, 1));
  writeFileSync(join(outDir, 'facts.json'), JSON.stringify(r.facts, null, 1));
  console.log(`${list.length} 枚・事実 ${r.facts.length} 件 → ${outDir}`);
} finally {
  await browser.close();
}
