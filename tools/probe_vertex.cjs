#!/usr/bin/env node
// 間取り図1枚を Vertex AI (Gemini) に読ませて、結果・使用トークン数・
// **1回あたりの費用**を出す。
//
// なぜ在るのか
// ------------
// 「AIで間取り図を読む」が実用になるかは、実際の図面で試すまで分からない。
// UIを作り込む前に、ここで精度と原価を測る。読めないなら、課金の設計を
// いくら考えても意味がない。
//
// 使い方
//   export VERTEX_KEY_FILE=~/.config/webcad/vertex-key.json
//   node tools/probe_vertex.cjs <画像ファイル> [--hint "1階の図です"] [--model gemini-2.5-flash] [--out plan.json]
//   node tools/probe_vertex.cjs --list-models        使えるモデルを一覧する
//
// PDF は先に画像にしておく（macOS なら sips -s format png in.pdf --out out.png）。
//
// **鍵のファイルは読み込むだけで、内容は一切表示しない。**
const { readFileSync, writeFileSync } = require('node:fs');
const { extname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--hint'
  && args[args.indexOf(a) - 1] !== '--model' && args[args.indexOf(a) - 1] !== '--out');
function opt(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}
const listOnly = args.includes('--list-models');

// 1回あたりの費用を出すための単価（米ドル / 100万トークン）。
// **公式の料金表で確かめた値ではない。** 目安として出すだけなので、
// 請求額が出たらそちらを正とすること。--rate-in / --rate-out で上書きできる。
const RATES = {
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
};
const JPY_PER_USD = Number(opt('jpy') || 150);

function keyFile() {
  const p = process.env.VERTEX_KEY_FILE || opt('key');
  if (!p) return null;
  return p.replace(/^~/, process.env.HOME || '~');
}

(async () => {
  const path = keyFile();
  if (!path) {
    console.error('VERTEX_KEY_FILE に鍵ファイルの場所を入れてください。');
    console.error('  export VERTEX_KEY_FILE=~/.config/webcad/vertex-key.json');
    process.exit(1);
  }
  let credentials;
  try {
    credentials = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`鍵ファイルを読めません (${path}): ${e.message}`);
    process.exit(1);
  }

  const vertex = await import(pathToFileURL(join(ROOT, 'worker', 'vertex.mjs')).href);
  const { getAccessToken } = await import(pathToFileURL(join(ROOT, 'worker', 'google-auth.mjs')).href);
  const { SYSTEM_PROMPT, buildPlanPrompt, decodeCompactPlan } = await import(pathToFileURL(join(ROOT, 'worker', 'plan-prompt.mjs')).href);
  const { PLAN_RESPONSE_SCHEMA } = await import(pathToFileURL(join(ROOT, 'worker', 'plan-response-schema.mjs')).href);
  const { planSpec } = await import(pathToFileURL(join(ROOT, 'worker', 'plan-spec.mjs')).href);
  const { planKnowledge } = await import(pathToFileURL(join(ROOT, 'worker', 'plan-knowledge.mjs')).href);
  const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));
  const PlanRooms = require(join(ROOT, 'assets', 'js', 'plan-rooms.js'));
  const PlanGrid = require(join(ROOT, 'assets', 'js', 'plan-grid.js'));

  const location = opt('location') || vertex.DEFAULT_LOCATION;
  const project = opt('project') || credentials.project_id;
  const model = opt('model') || vertex.DEFAULT_PLAN_MODEL;

  if (!vertex.isJapanLocation(location)) {
    console.error(`${location} は日本国内ではありません。間取り図には個人情報が入りうるので使えません。`);
    process.exit(1);
  }

  // ── 使えるモデルの一覧 ───────────────────────────────────────────
  if (listOnly) {
    const auth = await getAccessToken(credentials);
    if (!auth.ok) { console.error('認証に失敗: ' + auth.message); process.exit(1); }
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models`;
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + auth.token } });
    const body = await res.text();
    if (!res.ok) { console.error(`一覧に失敗 (HTTP ${res.status}): ${body.slice(0, 300)}`); process.exit(1); }
    const names = (JSON.parse(body).publisherModels || []).map((m) => String(m.name).split('/').pop());
    console.log(`${location} で使えるモデル (${names.length}件):`);
    names.filter((n) => /gemini/i.test(n)).sort().forEach((n) => console.log('  ' + n));
    return;
  }

  if (!file) {
    console.error('使い方: node tools/probe_vertex.cjs <画像ファイル> [--hint "..."] [--model ...] [--out plan.json]');
    process.exit(2);
  }
  // PDF もそのまま渡せる。ベクターなので、画像に変換するより Gemini 側で
  // 開いたほうが寸法の文字がはっきり読める。
  const TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.pdf': 'application/pdf',
  };
  const mimeType = TYPES[extname(file).toLowerCase()];
  if (!mimeType) {
    console.error(`${file}: png / jpg / webp / pdf のみ`);
    process.exit(2);
  }

  const base64 = readFileSync(file).toString('base64');
  console.log(`図面   : ${file} (${Math.round(base64.length * 3 / 4 / 1024)} KB, ${mimeType})`);
  console.log(`モデル : ${model} @ ${location}（プロジェクト ${project}）`);
  if (opt('hint')) console.log(`補足   : ${opt('hint')}`);
  console.log('送信中…');

  const started = Date.now();
  const result = await vertex.generate({
    config: { credentials, project, location, model },
    system: SYSTEM_PROMPT,
    docs: [planKnowledge(), planSpec()],
    text: buildPlanPrompt({ hint: opt('hint') || '' }),
    image: { mimeType, base64 },
    responseSchema: PLAN_RESPONSE_SCHEMA,
    maxOutputTokens: Number(opt('max-tokens') || 32768),
    thinkingBudget: Number(opt('thinking') || 8192),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`\n失敗 (HTTP ${result.status}): ${result.message}`);
    process.exit(1);
  }

  console.log(`\n所要   : ${seconds} 秒   停止理由: ${result.stopReason}`);
  if (result.usage) {
    const u = result.usage;
    const rate = RATES[model] || null;
    console.log(`トークン: 入力 ${u.inputTokens} / 出力 ${u.outputTokens}（答え ${u.answerTokens} + 思考 ${u.thoughtTokens}） / 合計 ${u.totalTokens}`);
    if (rate) {
      const usd = u.inputTokens / 1e6 * rate.in + u.outputTokens / 1e6 * rate.out;
      console.log(`費用   : 約 $${usd.toFixed(4)} = 約 ¥${(usd * JPY_PER_USD).toFixed(1)} / 1回`);
      console.log(`         （単価 入力 $${rate.in} / 出力 $${rate.out} per 1M、$1=¥${JPY_PER_USD} と置いた概算。`);
      console.log(`          公式の料金表で確かめた値ではないので、請求額が出たらそちらを正とする）`);
    } else {
      console.log(`費用   : ${model} の単価を持っていないので未計算（--model を変えたときは自分で掛ける）`);
    }
  }

  // 生の返事も残す。形が想定と違ったとき、もう一度お金を払わずに調べられる。
  if (opt('out')) {
    writeFileSync(String(opt('out')).replace(/\.json$/, '') + '.raw.txt', result.text);
  }
  const parsed = vertex.extractJson(result.text);
  if (!parsed) {
    console.error('\nJSON を取り出せませんでした。返事の先頭 500 文字:');
    console.error(result.text.slice(0, 500));
    process.exit(1);
  }

  const plan = decodeCompactPlan(parsed);
  // 壁はAIに出させず、升目の塗り分けの境目から作る。
  // 壁の端点は、その壁が仕切っている部屋から決まるもので、独立した情報ではない。
  if (plan.floors.length) {
    const built = PlanGrid.buildFloors(plan.floors);
    plan.walls = built.walls;
    plan.rooms = built.rooms;
    for (const m of built.problems) plan.notes.push('(取り込み時) ' + m);
  } else if (plan.walls.length) {
    // 古い形で壁が直に返ってきた場合だけ、これまでどおり壁から部屋を計算する。
    const floors = [...new Set(plan.walls.map((w) => w.floor || 1))];
    plan.rooms = floors.flatMap((f) => PlanRooms.roomsFromWalls(plan.walls, plan.labels, { floor: f }));
  }
  const checked = PlanSchema.validatePlan(plan);
  const s = PlanSchema.summarize(plan);
  console.log(`\n読み取り: 壁 ${s.walls} / 部屋 ${s.rooms} / 開口・階段 ${s.items} / 階 ${s.floors.join(',') || '-'}`);

  if (plan.rooms.length) {
    console.log('\n部屋:');
    for (const r of plan.rooms) {
      console.log(`  ${String(r.n || '(名前なし)').padEnd(14)} ${r.w}×${r.d}mm  (${r.x},${r.y})  ${(r.w * r.d / 1656200).toFixed(1)}帖`);
    }
  }
  // 手順1〜2で読んだ寸法線。内訳の合計が総寸法と合っているかを、こちらでも検算する。
  // **AIの自己申告を信じない。** 合っていると言いながら合っていないことがある。
  const edgeJa = { top: '上辺', bottom: '下辺', left: '左辺', right: '右辺' };
  for (const dims of plan.dims) {
    if (!dims || typeof dims !== 'object') continue;
    const floor = dims.floor == null ? '' : `（${dims.floor}階）`;
    const lines = [];
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const d = dims[side];
      if (!d) continue;
      // 本筋は {total, parts}。古い保存は [total, [parts]] の形。
      const total = Number(Array.isArray(d) ? d[0] : d.total);
      const raw = Array.isArray(d) ? d[1] : d.parts;
      const parts = Array.isArray(raw) ? raw.map(Number) : [];
      if (!isFinite(total)) continue;
      const sum = parts.reduce((a, b) => a + b, 0);
      const ok = !parts.length ? '（内訳なし）'
        : Math.abs(sum - total) < 1 ? '✓' : `✗ 内訳の合計が ${sum} で合わない`;
      lines.push(`  ${edgeJa[side]}  総 ${total}  = ${parts.join(' + ')}  ${ok}`);
    }
    if (lines.length) {
      console.log(`\n読んだ寸法線${floor}:`);
      console.log(lines.join('\n'));
    }
  }
  if (plan.notes.length) {
    console.log('\nAIが読めなかったと言っていること:');
    for (const n of plan.notes) console.log('  - ' + n);
  }
  if (checked.warnings.length) {
    console.log('\n警告:');
    for (const w of checked.warnings.slice(0, 10)) console.log('  - ' + w);
  }
  if (!checked.ok) {
    console.log('\n検査に通らなかった点:');
    for (const e of checked.errors.slice(0, 20)) console.log('  - ' + e);
  } else {
    console.log('\n検査: 通過（そのままアプリで開ける形）');
  }

  // 910 の倍数になっているか。日本の住宅なら、ほとんどの寸法が乗るはず。
  const dims = [];
  for (const w of plan.walls) dims.push(Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)));
  for (const r of plan.rooms) dims.push(Math.round(r.w), Math.round(r.d));
  const onGrid = dims.filter((d) => d > 0 && Math.abs(d / 455 - Math.round(d / 455)) < 0.02).length;
  if (dims.length) console.log(`寸法の ${onGrid}/${dims.length} 件が 455mm(半モジュール)の倍数`);

  if (opt('out')) {
    writeFileSync(opt('out'), JSON.stringify(PlanSchema.normalizePlan(plan), null, 1));
    console.log(`\n保存しました: ${opt('out')}  （アプリの「読込」で開けます）`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
