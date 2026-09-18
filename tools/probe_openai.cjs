#!/usr/bin/env node
// 間取り図を OpenAI に読ませて、結果・使用トークン数・費用を出す。
//
// tools/probe_vertex.cjs と対にしてある。**指示文・仕様書・読み取りの例・
// 出力の形は同じものを使う。** 入力を揃えないとモデルを比べられない。
//
// 使い方
//   node tools/probe_openai.cjs <画像> [--hint "1階の平面図です"] [--model gpt-5] [--out plan.json]
//
// **キーは .dev.vars から読み込むだけで、内容は一切表示しない。**
const { readFileSync, writeFileSync } = require('node:fs');
const { extname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..');
const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }
// 画像は複数渡せる。**OpenAI は画像ごとにタイル分割する**ので、1枚を分けて
// 渡すと実効解像度が上がる（1枚だけだと短辺768画素まで縮められる）。
const files = args.filter((a, i) => !a.startsWith('--') && !String(args[i - 1] || '').startsWith('--'));
const file = files[0];

// 1回あたりの費用を出すための単価（米ドル / 100万トークン）。
// **公式の料金表で確かめた値ではない。** 目安として出すだけなので、
// 請求額が出たらそちらを正とすること。--rate-in / --rate-out で上書きできる。
const RATES = {
  'gpt-6-astra': { in: 10, out: 50 },
  'gpt-5.6-sol': { in: 4, out: 20 },
  'gpt-5': { in: 1.25, out: 10 },
  'gpt-5-mini': { in: 0.25, out: 2 },
};
const JPY_PER_USD = Number(opt('jpy') || 150);

function apiKey() {
  const fromEnv = process.env.OPENAI_API_KEY;
  if (fromEnv) return fromEnv;
  let text = '';
  try { text = readFileSync(join(ROOT, '.dev.vars'), 'utf8'); } catch (e) { return null; }
  for (const line of text.split('\n')) {
    const m = /^OPENAI_API_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

(async () => {
  const key = apiKey();
  if (!key) {
    console.error('OPENAI_API_KEY が見つかりません（.dev.vars か環境変数に入れてください）。');
    process.exit(1);
  }
  if (!file) { console.error('読ませる画像を指定してください。'); process.exit(1); }

  const images = [];
  for (const f of files) {
    const mt = MIME[extname(f).toLowerCase()];
    if (!mt) { console.error(`${f}: PNG / JPEG / WebP を指定してください。`); process.exit(1); }
    images.push({ mimeType: mt, base64: readFileSync(f).toString('base64'), path: f });
  }

  const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
  const { SYSTEM_PROMPT, buildPlanPrompt, decodeCompactPlan } = await load('worker/plan-prompt.mjs');
  const { PLAN_RESPONSE_SCHEMA } = await load('worker/plan-response-schema.mjs');
  const { planSpec } = await load('worker/plan-spec.mjs');
  const { planKnowledge } = await load('worker/plan-knowledge.mjs');
  const openai = await load('worker/openai.mjs');
  const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));
  const PlanGrid = require(join(ROOT, 'assets', 'js', 'plan-grid.js'));

  const model = opt('model') || 'gpt-5';
  console.log(`図面   : ${images.map((i) => i.path).join(', ')}`);
  console.log(`モデル : ${model}`);
  if (opt('hint')) console.log(`補足   : ${opt('hint')}`);
  console.log('送信中…');

  const started = Date.now();
  const result = await openai.generate({
    config: { apiKey: key, model, schema: openai.toJsonSchema(PLAN_RESPONSE_SCHEMA) },
    system: SYSTEM_PROMPT,
    docs: [planKnowledge(), planSpec()],
    text: buildPlanPrompt({ hint: opt('hint') || '' }),
    images: images.map((i) => ({ mimeType: i.mimeType, base64: i.base64 })),
    maxOutputTokens: Number(opt('max-tokens') || 32768),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`\n失敗 (${result.status}): ${result.message}`);
    process.exit(1);
  }

  const u = result.usage;
  const rate = RATES[model] || RATES['gpt-5'];
  const usd = u.inputTokens / 1e6 * Number(opt('rate-in') || rate.in)
    + u.outputTokens / 1e6 * Number(opt('rate-out') || rate.out);
  console.log(`\n所要   : ${seconds} 秒   停止理由: ${result.stopReason}`);
  console.log(`トークン: 入力 ${u.inputTokens} / 出力 ${u.outputTokens}（答え ${u.answerTokens} + 思考 ${u.thoughtTokens}） / 合計 ${u.totalTokens}`);
  console.log(`費用   : 約 $${usd.toFixed(4)} = 約 ¥${(usd * JPY_PER_USD).toFixed(1)} / 1回`);
  console.log('         （単価は目安。公式の料金表で確かめた値ではないので、請求額が出たらそちらを正とする）');

  if (opt('out')) writeFileSync(String(opt('out')).replace(/\.json$/, '') + '.raw.txt', result.text);

  let parsed;
  try { parsed = JSON.parse(result.text); } catch (e) {
    console.error('\nJSON を取り出せませんでした。返事の先頭 500 文字:');
    console.error(result.text.slice(0, 500));
    process.exit(1);
  }

  const plan = decodeCompactPlan(parsed);
  if (plan.floors.length) {
    const built = PlanGrid.buildFloors(plan.floors);
    plan.walls = built.walls;
    plan.rooms = built.rooms;
    for (const m of built.problems) plan.notes.push('(取り込み時) ' + m);
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

  const edgeJa = { top: '上辺', bottom: '下辺', left: '左辺', right: '右辺' };
  for (const dims of plan.dims) {
    if (!dims || typeof dims !== 'object') continue;
    const lines = [];
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const d = dims[side];
      if (!d) continue;
      const total = Number(d.total);
      const parts = Array.isArray(d.parts) ? d.parts.map(Number) : [];
      if (!isFinite(total)) continue;
      const sum = parts.reduce((a, b) => a + b, 0);
      const ok = !parts.length ? '（内訳なし）'
        : Math.abs(sum - total) < 1 ? '✓' : `✗ 内訳の合計が ${sum} で合わない`;
      lines.push(`  ${edgeJa[side]}  総 ${total}  = ${parts.join(' + ')}  ${ok}`);
    }
    if (lines.length) {
      console.log(`\n読んだ寸法線（${dims.floor == null ? '' : dims.floor + '階'}）:`);
      console.log(lines.join('\n'));
    }
  }

  if (plan.notes.length) {
    console.log('\nAIが読めなかったと言っていること:');
    for (const n of plan.notes) console.log('  - ' + n);
  }
  console.log(`\n検査: ${checked.ok ? '通過（そのままアプリで開ける形）' : '不合格'}`);
  if (!checked.ok) for (const e of checked.errors.slice(0, 10)) console.log('  - ' + e);

  if (opt('out')) {
    writeFileSync(opt('out'), JSON.stringify(PlanSchema.normalizePlan(plan), null, 1));
    console.log(`\n保存しました: ${opt('out')}`);
  }
})();
