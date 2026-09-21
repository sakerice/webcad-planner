#!/usr/bin/env node
// カタログ753点に、分類(kind)・置き方(mount)・置かれる部屋(room)を貼る。
//
// 使い方:
//   node tools/tag_catalogue.mjs --via ~/.claude/jev/jev.mjs        全点
//   node tools/tag_catalogue.mjs --via ... --limit 12               先頭12点で試す
//   node tools/tag_catalogue.mjs --via ... --only fmp-Table34,...   名指し
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/tag_catalogue.mjs
//
// 出力は assets/models/tags.json。**既存の manifest は書き換えない。**
// 保存済みのプランはモデルを名前で持っているので、分類を差し替えるのではなく
// 別のファイルに足す。
//
// なぜ Jev なのか
// --------------
// 753点のうち、名前が分類を語っているのは furniture_mega の445点だけ
// (Sofa01, BathTub03, …)。interior_model_0_26_1 の240点は
// `basket-304967-Gray` のような取り込み元のIDで、手がかりはフォルダ名と寸法
// しかない。決め打ちの規則で書くと、取り込み元が増えるたびに規則が増える。
//
// **Jev は文章を書かない。** 返すのはこちらが並べた kind のどれか1つだけなので、
// 語彙の外の分類が入ってくることがない。1点あたり入力300トークン前後、
// 出力は無料。753点で $0.01 に満たない。
//
// **画像は渡せない。** Jev 1.13.0 の入力はテキストのみ。previews-v2 に全点の
// サムネイルがあるが見せられないので、名前・フォルダ・寸法で決める。確信の
// 薄いものは review に落として、そこだけ人か画像を見られるモデルで見る。
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { KINDS, KIND_KEYS, MOUNTS, ROOMS, kindCriteria, heightProblem } from "./catalogue-vocab.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = ["custom", "furniture_mega", "interior_model_0_26_1"];
const OUT = join(ROOT, "assets", "models", "tags.json");

// 既存の category から見て、だいたいここに来るはずという見当。
// **判定には使わない。** 食い違ったものを目で見るために印を付けるだけ。
// 食い違いは、たいてい既存の category のほうが間違っている。
const EXPECTED = {
  "キッチン": ["kitchen-unit", "kitchen-storage", "cooktop", "range-hood", "cooking-appliance", "kitchen-sink"],
  "キッチン/コンロ": ["cooktop"],
  "キッチン/シンク": ["kitchen-sink", "kitchen-unit"],
  "キッチン収納": ["kitchen-storage", "range-hood", "cooking-appliance", "cooktop", "kitchen-sink"],
  "シャワー": ["shower"],
  "トイレ": ["toilet"],
  "バスルーム": ["bathtub", "shower", "vanity", "kitchen-storage", "cabinet", "shelf"],
  "下駄箱": ["shoe-storage"],
  "冷蔵庫": ["refrigerator"],
  "洗面台": ["vanity"],
  "空調": ["hvac"],
  "玄関・庭": ["gate-post", "garden-equipment"],
  "設備": ["utility-equipment"],
  "カーテン": ["curtain", "roller-screen"],
  "窓まわり": ["curtain", "roller-screen"],
  "カーペット": ["rug"],
  "キッズ": ["kids"],
  "キャビネット": ["cabinet", "shelf", "chest"],
  "シェルフ": ["shelf", "cabinet"],
  "ソファ": ["sofa"],
  "チェア": ["chair"],
  "テレビ": ["tv"],
  "テーブル": ["dining-table", "low-table", "desk", "counter-table"],
  "テーブルセット": ["table-set"],
  "ドア": ["joinery-prop"],
  "ベッド": ["bed"],
  "ペット": ["pet"],
  "マットレス": ["bedding", "bed"],
  "ミラー": ["mirror"],
  "収納": ["closet", "chest", "cabinet", "shelf", "laundry"],
  "壁装飾": ["wall-decor"],
  "外構": ["deck", "gate-post"],
  "家電": ["appliance", "tv"],
  "引き出し": ["chest"],
  "植物": ["plant", "garden-plant"],
  "照明": ["light"],
  "窓": ["joinery-prop"],
  "絵画": ["wall-decor"],
  "装飾": ["decor", "wall-decor"],
};

const QUESTIONS = {
  kind: {
    type: "choice",
    instructions: "A 3D model for a Japanese house planning app. From its name, its source folder, and its width x depth x height in millimetres, which single category does this model belong to?",
    criteria: kindCriteria(),
  },
  mount: {
    type: "choice",
    instructions: "How is this model placed in the house?",
    criteria: MOUNTS,
  },
  room: {
    type: "choice",
    instructions: "Which room of a Japanese detached house is this model most likely placed in?",
    criteria: ROOMS,
  },
};

function loadItems() {
  const out = [];
  for (const source of SOURCES) {
    const file = join(ROOT, "assets", "models", source, "manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const item of manifest.items || []) out.push({ ...item, source });
  }
  return out;
}

// 判断の材料。**画像は渡せないので、名前まわりを全部渡す。**
// 取り込み元のフォルダ名(Bath / MEGA_PACK_BED など)は、名前がIDだけの
// 240点にとって唯一の手がかりになる。
function stateFor(item) {
  return {
    name: item.name,
    current_group: item.group,
    current_category: item.category,
    source_folder: item.sourceFolder || null,
    source_file: (item.sourceBlend || item.prefabPath || item.model || "").split("/").slice(-3).join("/"),
    width_mm: Math.round(Number(item.w) || 0),
    depth_mm: Math.round(Number(item.d) || 0),
    height_mm: Math.round(Number(item.h) || 0),
  };
}

// ── Jev を呼ぶ ───────────────────────────────────────────────────────
//
// 経路は2つ。既定は REST（環境変数に鍵がある場合）。--via を渡すと、
// そのファイル（jev の薄い層）を子プロセスとして呼ぶ。**こちらは鍵を
// 持たない**ので、鍵をキーチェーンに預けてある環境ではこちらを使う。
function askViaCli(viaPath, state, questions) {
  const dir = mkdtempSync(join(tmpdir(), "tagcat-"));
  const stateFile = join(dir, "state.json");
  const questionsFile = join(dir, "questions.json");
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync(questionsFile, JSON.stringify(questions));
  return new Promise((resolve, reject) => {
    execFile("node", [viaPath, "ask", stateFile, questionsFile], { maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim().split("\n")[0]));
      try { resolve(JSON.parse(stdout).answers); } catch (e) { reject(new Error("答えを読めなかった")); }
    });
  });
}

async function askViaRest(state, questions) {
  const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が要る（または --via を使う）");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "typesafe/jev", input: { state, questions } }),
  });
  const body = await res.json();
  let node = body;
  for (let i = 0; i < 4 && node && !node.answers; i++) node = node.result;
  if (!node || !node.answers) throw new Error(`Jev が答えを返さなかった (HTTP ${res.status})`);
  return node.answers;
}

// **提示していない答えは使わない。** 語彙の外が返ったら、その項目は落とす。
function take(answers, name, allowed) {
  const a = answers && answers[name];
  if (!a || !allowed.includes(a.choice)) return null;
  return { value: a.choice, confidence: typeof a.confidence === "number" ? Number(a.confidence.toFixed(2)) : null };
}

async function tagOne(item, ask) {
  const answers = await ask(stateFor(item), QUESTIONS);
  const kind = take(answers, "kind", KIND_KEYS);
  const mount = take(answers, "mount", Object.keys(MOUNTS));
  const room = take(answers, "room", Object.keys(ROOMS));
  if (!kind) throw new Error("kind が語彙の外だった");

  const review = [];
  const expected = EXPECTED[item.category];
  if (expected && !expected.includes(kind.value)) {
    review.push(`いまの分類「${item.category}」から外れた → ${KINDS[kind.value].ja}`);
  }
  const height = heightProblem(kind.value, item.h);
  if (height) review.push(height);
  if (kind.confidence !== null && kind.confidence < 0.35) review.push(`確信が薄い (${kind.confidence})`);
  if (kind.value === "other") review.push("どれにも当てはまらないと答えた");

  return {
    kind: kind.value,
    mount: mount ? mount.value : null,
    room: room ? room.value : null,
    confidence: { kind: kind.confidence, mount: mount ? mount.confidence : null, room: room ? room.confidence : null },
    ...(review.length ? { review } : {}),
  };
}

// 少しずつ並べて投げる。**全部いっぺんに投げない。**
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const via = arg("--via", "");
  const only = arg("--only", "");
  const limit = Number(arg("--limit", "0"));
  const concurrency = Number(arg("--concurrency", "8"));
  const out = arg("--out", OUT);
  const resume = argv.includes("--resume");

  const ask = via
    ? (state, questions) => askViaCli(via.replace(/^~/, process.env.HOME), state, questions)
    : askViaRest;

  let items = loadItems();
  if (only) {
    const want = new Set(only.split(","));
    items = items.filter((i) => want.has(i.id));
  }
  if (limit > 0) items = items.slice(0, limit);

  const previous = resume && existsSync(out) ? JSON.parse(readFileSync(out, "utf8")).items || {} : {};
  const todo = items.filter((i) => !previous[i.id]);
  process.stderr.write(`${items.length} 点中 ${todo.length} 点を貼る（並列 ${concurrency}）\n`);

  let done = 0, failed = 0;
  const tagged = { ...previous };
  const errors = [];
  await mapLimit(todo, concurrency, async (item) => {
    try {
      tagged[item.id] = await tagOne(item, ask);
    } catch (e) {
      failed++;
      errors.push(`${item.id}: ${e.message}`);
    }
    if (++done % 25 === 0 || done === todo.length) process.stderr.write(`  ${done}/${todo.length}\n`);
  });

  const body = {
    // 語彙を変えたら上げる。アプリ側はこの数字で古いタグを捨てられる。
    version: 1,
    model: "typesafe/jev",
    generated: new Date().toISOString().slice(0, 10),
    kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { group: v.group, ja: v.ja, search: v.search }])),
    items: Object.fromEntries(Object.keys(tagged).sort().map((k) => [k, tagged[k]])),
  };
  writeFileSync(out, JSON.stringify(body, null, 1) + "\n");

  const reviews = Object.entries(body.items).filter(([, t]) => t.review);
  process.stderr.write(`\n書き出し: ${out}\n  貼れた ${Object.keys(body.items).length} 点 / 失敗 ${failed} 点 / 要確認 ${reviews.length} 点\n`);
  for (const line of errors.slice(0, 10)) process.stderr.write(`  ! ${line}\n`);
}

main().catch((e) => { process.stderr.write(String(e.message || e) + "\n"); process.exit(1); });
