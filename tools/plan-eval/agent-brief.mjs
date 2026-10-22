// API に送るのと同じ指示・仕様書・図面を、Claude Code のエージェントに渡す依頼書にする。
//
// なぜ在るのか
// ------------
// 指示文や手順を直すたびに API で測ると、1回ごとに費用がかかる。同じモデルの
// エージェントに同じ入力で読ませれば、試行錯誤は費用なしで回せる（利用者の提案、
// 2026-10-17）。ただし API と全く同じにはならない（画像の縮め方・出力の形の強制・
// 考える深さの指定が違う）。**API とエージェントの点数を同じ図面で並べて、近いことを
// 確かめてから**試行錯誤に使う。決め手の測定は API で行う。
//
//   node tools/plan-eval/agent-brief.mjs <測定で残した入力のフォルダ> <依頼書の出力先>
//
// 入力のフォルダは run.mjs が API の測定で残す out/<図面>/<名前>-inputs/（切り出した図面）。
// 出力先にページごとの brief-N.md ができる。エージェントには「brief-N.md を読み、
// 指示どおり answer-N.json を書け」とだけ伝える。
import { readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [inDir, outDir] = process.argv.slice(2).map((p) => p && resolve(p));
if (!inDir || !outDir) {
  console.error('使い方: node tools/plan-eval/agent-brief.mjs <入力のフォルダ> <出力先>');
  process.exit(1);
}
const ROOT = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, ROOT).href);
const { SYSTEM_PROMPT, buildPlanPrompt } = await load('worker/plan-prompt.mjs');
const { PLAN_RESPONSE_SCHEMA } = await load('worker/plan-response-schema.mjs');
const { planSpec } = await load('worker/plan-spec.mjs');
const { planKnowledge } = await load('worker/plan-knowledge.mjs');
const { toJsonSchema } = await load('worker/openai.mjs');

const pages = readdirSync(inDir).filter((f) => /^page-\d+\.(png|jpg|webp)$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const { hint = '' } = JSON.parse(readFileSync(join(inDir, 'inputs.json'), 'utf8'));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'schema.json'), JSON.stringify(toJsonSchema(PLAN_RESPONSE_SCHEMA), null, 1));

// routes-ai.mjs の pageHint と同じ文面。何ページ目かを伝えると階の取り違えが減る。
function pageHint(i, total) {
  if (total <= 1) return hint;
  const page = `この画像はPDFの${i + 1}ページ目です（全${total}ページ）。`;
  return hint ? `${page}\n${hint}` : page;
}

pages.forEach((file, i) => {
  const n = i + 1;
  const brief = `# 間取り図の読み取り（API の代わりに答える）

あなたは、住宅設計アプリの Worker が Claude API に送る**1回の依頼**の受け手の代わりをする。
下の「system」「資料」「依頼」を、API に送られたものとしてそのまま受け取り、その答えだけを返す。

- 図面の画像: \`${join(inDir, file)}\`（Read で開く。これが API に添付される画像そのもの）
- 答えの形: \`${join(outDir, 'schema.json')}\` の JSON Schema に**厳密に**従う（全項目必須、余分な項目なし）
- 答えの書き先: \`${join(outDir, `answer-${n}.json`)}\`（Write で、JSON だけを書く。説明文は書かない）

ほかのファイルを読んだり、コードを調べたり、この依頼の外の手がかりを探したりしない。
API の受け手が見られるのは、ここに書かれたものと画像だけである。

## system

${SYSTEM_PROMPT}

## 資料（依頼の前に添付されている文書）

${planKnowledge()}

---

${planSpec()}

## 依頼

${buildPlanPrompt({ hint: pageHint(i, pages.length) })}
`;
  writeFileSync(join(outDir, `brief-${n}.md`), brief);
});
console.log(`${pages.length} ページぶんの依頼書を ${outDir} に書いた`);
