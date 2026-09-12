#!/usr/bin/env node
// 間取り図1枚を Bedrock に読ませて、結果・使用トークン数・所要時間を出す。
//
// なぜ在るのか
// ------------
// 「AIで間取り図を読む」が実用になるかは、実際の図面で試すまで分からない。
// アプリのUIを作り込む前に、ここで精度と原価を測る。読めないなら、課金の
// 設計をいくら考えても意味がない。
//
// 使い方
//   export AWS_ACCESS_KEY_ID=...
//   export AWS_SECRET_ACCESS_KEY=...
//   node tools/probe_bedrock.cjs <画像ファイル> [--hint "1階の図です"] [--model jp.anthropic.claude-opus-4-8] [--out plan.json]
//
// PDF は先に画像にしておく（macOS なら sips -s format png in.pdf --out out.png）。
//
// 出てくるもの
//   - 読み取れた壁・部屋・開口の数と、AIが「読めなかった」と書いたこと
//   - 入出力のトークン数（原価はこれに単価を掛けるだけ）
//   - 検査に通るかどうか。通らなければ何が駄目か
//   - --out を付ければプランJSONを保存。アプリの「読み込み」で開いて目で見られる
const { readFileSync, writeFileSync } = require('node:fs');
const { extname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
function opt(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
}

if (!file) {
  console.error('使い方: node tools/probe_bedrock.cjs <画像ファイル> [--hint "..."] [--model jp....] [--out plan.json]');
  process.exit(2);
}

const FORMATS = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };
const format = FORMATS[extname(file).toLowerCase()];
if (!format) {
  console.error(`${file}: png / jpg / webp のみ。PDF は先に画像にしてください（macOS なら sips -s format png in.pdf --out out.png）`);
  process.exit(2);
}

(async () => {
  const { bedrockConfig, converse, extractJson, isJapanResident } = await import(pathToFileURL(join(ROOT, 'worker', 'bedrock.mjs')).href);
  const { SYSTEM_PROMPT, buildPlanPrompt } = await import(pathToFileURL(join(ROOT, 'worker', 'plan-prompt.mjs')).href);
  const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));

  const env = { ...process.env };
  if (opt('model')) env.BEDROCK_PLAN_MODEL = opt('model');
  const config = bedrockConfig(env);
  if (!config.configured) {
    console.error('AWS_ACCESS_KEY_ID と AWS_SECRET_ACCESS_KEY を環境変数に入れてください。');
    process.exit(1);
  }
  if (!isJapanResident(config.model)) {
    console.error(`${config.model} は日本国内に閉じない指定です。間取り図には個人情報が入りうるので jp. で始まるモデルを使ってください。`);
    process.exit(1);
  }

  const base64 = readFileSync(file).toString('base64');
  console.log(`図面   : ${file} (${Math.round(base64.length * 3 / 4 / 1024)} KB)`);
  console.log(`モデル : ${config.model} @ ${config.region}`);
  if (opt('hint')) console.log(`補足   : ${opt('hint')}`);
  console.log('送信中…');

  const started = Date.now();
  const result = await converse({
    config,
    system: SYSTEM_PROMPT,
    text: buildPlanPrompt({ hint: opt('hint') || '' }),
    image: { format, base64 },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`\n失敗 (HTTP ${result.status}): ${result.message}`);
    process.exit(1);
  }

  console.log(`\n所要   : ${seconds} 秒   停止理由: ${result.stopReason}`);
  if (result.usage) {
    const u = result.usage;
    console.log(`トークン: 入力 ${u.inputTokens} / 出力 ${u.outputTokens}`);
    console.log('          原価 = 入力×入力単価 + 出力×出力単価（単価は AWS の料金表を参照）');
  }

  const parsed = extractJson(result.text);
  if (!parsed) {
    console.error('\nJSON を取り出せませんでした。返事の先頭 500 文字:');
    console.error(result.text.slice(0, 500));
    process.exit(1);
  }

  const plan = {
    walls: Array.isArray(parsed.walls) ? parsed.walls : [],
    rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
  const checked = PlanSchema.validatePlan(plan);
  const s = PlanSchema.summarize(plan);
  console.log(`\n読み取り: 壁 ${s.walls} / 部屋 ${s.rooms} / 開口・階段 ${s.items} / 階 ${s.floors.join(',') || '-'}`);

  if (plan.rooms.length) {
    console.log('\n部屋:');
    for (const r of plan.rooms) {
      console.log(`  ${String(r.n || '(名前なし)').padEnd(14)} ${r.w}×${r.d}mm  (${r.x},${r.y})  ${(r.w * r.d / 1656200).toFixed(1)}帖`);
    }
  }
  if (Array.isArray(parsed.notes) && parsed.notes.length) {
    console.log('\nAIが読めなかったと言っていること:');
    for (const n of parsed.notes) console.log('  - ' + n);
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

  // 910 の倍数になっているか。日本の住宅なら、ほとんどの寸法が倍数になるはず。
  const dims = [];
  for (const w of plan.walls) dims.push(Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)));
  for (const r of plan.rooms) dims.push(Math.round(r.w), Math.round(r.d));
  const onGrid = dims.filter((d) => d > 0 && Math.abs(d / 455 - Math.round(d / 455)) < 0.02).length;
  if (dims.length) {
    console.log(`寸法の ${onGrid}/${dims.length} 件が 455mm(半モジュール)の倍数`);
  }

  if (opt('out')) {
    writeFileSync(opt('out'), JSON.stringify(PlanSchema.normalizePlan(plan), null, 1));
    console.log(`\n保存しました: ${opt('out')}  （アプリの「読み込み」で開けます）`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
