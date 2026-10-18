// 短い指示（worker/plan-free.mjs）で図面を読ませ、アプリの形に直して採点する。
//
//   依頼書を作る（エージェントに読ませる）:
//     node tools/plan-eval/free-run.mjs brief <入力のフォルダ> <出力先>
//   API で読ませる（Claude。費用がかかる）:
//     node tools/plan-eval/free-run.mjs api <入力のフォルダ> <出力先> [--model claude-opus-5-5] [--effort high]
//   答えを採点する:
//     node tools/plan-eval/free-run.mjs score <answer.json>
//
// 入力のフォルダは run.mjs が API の測定で残した切り出し画像（page-N.png）。
// API の鍵は本体の .dev.vars から読むだけで、表示も保存もしない。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { FREE_SYSTEM, FREE_SCHEMA, buildFreePrompt } = await import(join(ROOT, 'worker', 'plan-free.mjs'));
const { toPlan } = await import(join(HERE, 'free-answer.mjs'));
const { scorePlan, formatReport } = require('./score.cjs');

const [mode, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : dflt; };
const pos = rest.filter((a, i) => !a.startsWith('--') && !String(rest[i - 1] || '').startsWith('--'));

function pagesIn(dir) {
  return readdirSync(dir).filter((f) => /^page-\d+\.(png|jpg|webp)$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map((f) => join(dir, f));
}

function score(answerPath) {
  const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
  const plan = toPlan(answer);
  writeFileSync(answerPath.replace(/\.json$/, '-plan.json'), JSON.stringify(plan));
  const truth = JSON.parse(readFileSync(join(HERE, 'truth', 'madori-3f.json'), 'utf8'));
  const r = scorePlan(truth, plan);
  writeFileSync(answerPath.replace(/\.json$/, '-score.txt'), formatReport(r) + '\n');
  return r;
}

if (mode === 'brief') {
  const [inDir, outDir] = pos.map((p) => resolve(p));
  mkdirSync(outDir, { recursive: true });
  const pages = pagesIn(inDir);
  const brief = `# 間取り図の読み取り（API の代わりに答える）

あなたは、住宅設計アプリが Claude API に送る1回の依頼の受け手の代わりをする。
下の「system」と「依頼」を API に送られたものとしてそのまま受け取り、その答えだけを返す。

- 添付画像（Read で開く。API に添付される画像そのもの）:
${pages.map((p, i) => `  ${i + 1}枚目: \`${p}\``).join('\n')}
- 答えの形: \`${join(outDir, 'schema.json')}\` の JSON Schema に厳密に従う
- 答えの書き先: \`${join(outDir, 'answer.json')}\`（Write で JSON だけを書く）

画像は Read で見るだけにする。ほかのツールは使わず、ほかのファイルも読まない（API の受け手が見られるのは、ここに書かれたものと画像だけ）。

## system

${FREE_SYSTEM}

## 依頼

${buildFreePrompt({ pages: pages.length })}
`;
  writeFileSync(join(outDir, 'brief.md'), brief);
  writeFileSync(join(outDir, 'schema.json'), JSON.stringify(FREE_SCHEMA, null, 1));
  console.log(join(outDir, 'brief.md'));
} else if (mode === 'api') {
  const [inDir, outDir] = pos.map((p) => resolve(p));
  mkdirSync(outDir, { recursive: true });
  const keyLine = readFileSync(join(ROOT, '..', '..', '..', '.dev.vars'), 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  if (!keyLine) { console.error('.dev.vars に ANTHROPIC_API_KEY が無い'); process.exit(1); }
  const { generate } = await import(join(ROOT, 'worker', 'anthropic.mjs'));
  const model = opt('model', 'claude-opus-5-5');
  const config = { apiKey: keyLine.slice('ANTHROPIC_API_KEY='.length).trim(), model, effort: opt('effort', 'high'), schema: FREE_SCHEMA };
  const pages = pagesIn(inDir);
  const images = pages.map((p) => ({ mimeType: 'image/' + (p.endsWith('.png') ? 'png' : 'jpeg'), base64: readFileSync(p).toString('base64') }));
  const t0 = Date.now();
  const res = await generate({ config, system: FREE_SYSTEM, text: buildFreePrompt({ pages: pages.length }), images, maxOutputTokens: 64000 });
  const seconds = Math.round((Date.now() - t0) / 1000);
  if (!res.ok) { console.error('失敗:', res.status, res.message); process.exit(1); }
  const RATES = { 'claude-opus-5-5': { in: 4, out: 20 }, 'claude-sonnet-5-5': { in: 2, out: 10 } };
  const r = RATES[model] || { in: 0, out: 0 };
  const u = res.usage;
  const yen = Math.round(((u.inputTokens - u.cacheWriteTokens - u.cacheReadTokens) * r.in + u.cacheWriteTokens * r.in * 1.25
    + u.cacheReadTokens * 0.2 + u.outputTokens * r.out) / 1e6 * 150 * 10) / 10;
  writeFileSync(join(outDir, 'answer.json'), res.text);
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ model, effort: config.effort, seconds, usage: u, costJpy: yen, stopReason: res.stopReason, servedBy: res.model }, null, 1));
  const s = score(join(outDir, 'answer.json'));
  console.log(`${model} effort=${config.effort}  ${seconds}秒  費用の目安 ¥${yen}  入力 ${u.inputTokens} / 出力 ${u.outputTokens} トークン  終わり方 ${res.stopReason}`);
  console.log(formatReport(s).split('\n')[0]);
} else if (mode === 'score') {
  const r = score(resolve(pos[0]));
  console.log(formatReport(r).split('\n')[0]);
} else {
  console.error('使い方: free-run.mjs brief|api|score ...');
  process.exit(1);
}
