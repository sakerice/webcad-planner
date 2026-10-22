// 読み取った間取りをアプリに入れ、各階の平面図と外観3D（東西南北）を撮って1枚にまとめる。
//
// なぜ在るのか
// ------------
// 平面図の重ね描きだけでは、屋根が無い・バルコニーに柵が無い・物が反転している、といった
// 3Dで見れば一目で分かる異常を見落とす（2026-10-19 利用者の指摘）。読み取りを測るたびに
// 3Dも撮り、目で確かめる。
//
// 取り込み（assets/js/plan-import.js の applyPlanImport）と同じく、基礎と屋根は壁から作る
// （PlanStructure.structureFor）。JSON をそのまま読み込むと屋根の無い家になるため。
//
//   APP_URL=http://localhost:8791/ node tools/plan-eval/render3d.mjs <プラン.json> <出力.png> [--title "..."]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const [planPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !String(args[i - 1] || '').startsWith('--'));
const title = opt('title', planPath);
const raw = JSON.parse(readFileSync(planPath, 'utf8'));
const plan = raw.plan || raw;

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
const shots = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('dialog', (d) => d.accept());
  await page.goto(process.env.APP_URL || 'http://localhost:8791/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.waitForTimeout(800);
  const floors = await page.evaluate(async (p) => {
    const m = document.getElementById('preset-choice-modal');
    if (m) { m.classList.remove('show'); m.style.display = 'none'; }
    const walls = p.walls || [];
    // 取り込みと同じく、基礎と屋根は壁から作る。
    const made = (typeof PlanStructure !== 'undefined' ? PlanStructure.structureFor(walls) : []).map((st) => {
      const it = mkItem(st.type, st.x, st.y, st.rot || 0, st.floor, st.w, st.d);
      for (const k of Object.keys(st)) if (!['type', 'x', 'y', 'w', 'd', 'rot', 'floor'].includes(k)) it[k] = st[k];
      return it;
    });
    // 読み取りが屋根を答えていればそれを使い、壁から作る屋根は答えが無いときだけ（取り込みと同じ）。
    const hasRoof = (p.items || []).some((i) => i.type === 'roof' && !i._structure);
    const own = (p.items || []).filter((i) => i.type !== 'foundation' && (hasRoof || i.type !== 'roof'));
    const data = { walls, rooms: p.rooms || [], items: own.concat(made.filter((m) => !hasRoof || m.type !== 'roof')) };
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(data)], 'plan.json', { type: 'application/json' }));
    const inp = document.getElementById('import-file');
    inp.files = dt.files;
    doImport(inp);
    await new Promise((r) => setTimeout(r, 2500));
    return [...new Set(walls.map((w) => w.floor || 1))].sort();
  }, plan);

  const shot = async (name) => {
    const file = join(tmpdir(), `render3d-${process.pid}-${name}.png`);
    await page.screenshot({ path: file, clip: { x: 230, y: 70, width: 1200, height: 800 } });
    shots.push({ name, file });
  };
  for (const f of floors) {
    await page.evaluate((fl) => { document.getElementById('floor-sel').value = String(fl); onFloorChange(fl); resetView(); draw2d(); }, f);
    await page.waitForTimeout(600);
    await shot(`${f}階 平面図`);
  }
  await page.locator('button', { hasText: '外観3D' }).first().click();
  await page.waitForTimeout(6000);
  for (const [d, ja] of [['s', '南'], ['e', '東'], ['n', '北'], ['w', '西']]) {
    await page.evaluate((dir) => snapCameraToElevation(dir), d);
    await page.waitForTimeout(1800);
    await shot(`外観3D ${ja}から`);
  }
  // 斜め上から（屋根と上の階の載り方を見る）
  await page.evaluate(() => snapCameraToElevation('s'));
  await page.mouse.move(830, 470);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(700, 380, { steps: 10 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(1500);
  await shot('外観3D 南東の上から');
} finally {
  await browser.close();
}

// 1枚にまとめる（PIL）。
mkdirSync(dirname(outPath), { recursive: true });
const py = `
import json,sys
from PIL import Image, ImageDraw, ImageFont
shots=json.loads(sys.argv[1]); out=sys.argv[2]; title=sys.argv[3]
f=ImageFont.truetype("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",26)
W,H=600,400; cols=4; rows=(len(shots)+cols-1)//cols
img=Image.new("RGB",(W*cols,(H+40)*rows+50),"white"); d=ImageDraw.Draw(img)
d.text((10,10),title,fill="black",font=f)
for i,s in enumerate(shots):
    x,y=(i%cols)*W,50+(i//cols)*(H+40)
    d.text((x+8,y+4),s["name"],fill="black",font=f)
    img.paste(Image.open(s["file"]).convert("RGB").resize((W,H)),(x,y+36))
img.save(out)
`;
execFileSync('python3', ['-c', py, JSON.stringify(shots), outPath, title]);
console.log(outPath);
