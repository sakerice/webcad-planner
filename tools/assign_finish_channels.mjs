#!/usr/bin/env node
// 外部アセット685点のマテリアルを「色を変えられる部位(チャンネル)」へ割り当てる。
//
//   node tools/assign_finish_channels.mjs --via ~/.claude/jev/jev.mjs
//   node tools/assign_finish_channels.mjs --dry     貼らずに内訳だけ出す
//
// ■ なぜ在るのか
//   色を変えられる仕組みは2つあって、噛み合っていない。
//
//     applySelectableColor()  カタログ全般。**テクスチャ付きは対象外**
//                             (「柄の上に色を乗せると濁る」)。685点中684点が
//                             テクスチャ付きなので、外部アセットはほぼ変えられない
//     applyFinishes()         マテリアルの finishChannel を見る。
//                             neutralizeFinish() が柄を輝度に落として色を掛けるので、
//                             **木目を残したまま色だけ変えられる**。
//                             ところが繋がっているのは手書きの外部2点だけだった
//
//   仕組みは足りている。**全点に配線されていないだけ**なので、ここで貼る。
//
// ■ 決め方（機械で全点）
//   1. マテリアルが1つの品(587点) … 塗り分けようが無いので `body`(本体)1つ
//   2. 複数あり、名前で決まる品(69点) … mat_BedFrame→wood、mat_Blanket→fabric など
//   3. 複数あり、名前が無意味な品(29点/112マテリアル) … Jev に聞く
//      (`512.004` `236.006` のような取り込み元のIDで、手がかりは色・粗さ・
//       金属度・テクスチャの有無・そのマテリアルが占める面積)
//
// ■ 出力
//   assets/models/finishes.json。形はアプリ内の externalFinishes と同じ
//   { モデルのパス: { マテリアル名: チャンネル } } なので、そのまま読める。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "models", "finishes.json");

// チャンネル。**UIに1つずつ操作が並ぶので、増やしすぎない。**
// 自作モデルが既に使っている wood / fabric / accent と揃えてある。
// color は色見本の初期位置。**まだ何も適用されていない状態の表示**で、
// 利用者が選ぶまでモデルの見た目は変わらない。その部位らしい色にしておく。
export const CHANNELS = {
  body: { ja: "本体", color: "#cfc9c1", what: "The whole piece; the model has no separate parts" },
  wood: { ja: "木部", color: "#b08a5e", what: "Wooden frame, panel, leg or door front" },
  fabric: { ja: "張地", color: "#b9b3a8", what: "Upholstery, mattress, blanket, cushion, curtain or rug" },
  leather: { ja: "革", color: "#7a5a44", what: "Leather upholstery" },
  metal: { ja: "金物", color: "#b0b4b8", what: "Metal leg, handle, rail or trim" },
  ceramic: { ja: "陶器", color: "#f2f2f0", what: "Sanitary ware, basin, tile" },
  stone: { ja: "石・タイル", color: "#cfcac2", what: "Stone or tiled surface, worktop" },
  glass: { ja: "ガラス", color: "#cfd9dd", what: "Transparent glass; not recoloured" },
  accent: { ja: "アクセント", color: "#8fa3a8", what: "A small second colour: piping, inlay, a contrasting panel" },
};
// 色を変えない部位。出力には入れるが、UIには操作を出さない。
export const FIXED = new Set(["glass"]);

// **手で確かめた割り当ては、機械の答えより優先する。**
// もとのアプリ(assets/js/model-quality.js)に手書きされていた2点。人が実物を
// 見て決めたもので、Jev はこのうち BOLIA-Ivory を「確信が薄い」として落とした。
// finishReference は、柄を輝度に落とすときの基準値(暗い木目ほど小さい)。
// **機械が貼ったぶんにはこの較正値が無い**(既定1)。効き方は実機で見ること。
const OVERRIDES = {
  "assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb": {
    "BOLIA-Ivory": "wood", "sofa-e5ybetgdh45y.002": "fabric", "sofa-e5ybetgdh45y.003": "accent",
  },
  "assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb": { "43693": "wood" },
};
const REFERENCES = {
  "assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb": { "BOLIA-Ivory": 0.3 },
  "assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb": { "43693": 0.08 },
};

// 名前から決まるもの。**上から順に当てる**（狭いものを先に）。
const NAME_RULES = [
  [/glass|窓|ガラス/i, "glass"],
  [/leather/i, "leather"],
  [/fabric|blanket|mattress|cushion|pillow|curtain|carpet|rug|textile|sofa.*fabric/i, "fabric"],
  [/marble|granite|stone|tile|worktop|countertop/i, "stone"],
  [/ceramic|porcelain|bathroom|toilet|basin|sanitary/i, "ceramic"],
  [/metal|steel|chrome|alu|brass|iron|handle|rail/i, "metal"],
  [/wood|frame|drawer|closet|cabinet|shelf|desk|table|plank|oak|walnut|teak|maple|board/i, "wood"],
];

function gltfOf(path) {
  const b = readFileSync(path);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
}

// マテリアルごとの、判断に要る事実。**名前だけでは決まらないので色と面積も見る。**
function materialFacts(doc) {
  const tris = new Array((doc.materials || []).length).fill(0);
  for (const mesh of doc.meshes || []) {
    for (const p of mesh.primitives || []) {
      if (p.material == null) continue;
      const acc = (doc.accessors || [])[p.indices];
      tris[p.material] += acc ? Math.round(acc.count / 3) : 0;
    }
  }
  const total = tris.reduce((a, b) => a + b, 0) || 1;
  return (doc.materials || []).map((m, i) => {
    const pm = m.pbrMetallicRoughness || {};
    const c = pm.baseColorFactor || [1, 1, 1, 1];
    const hex = "#" + c.slice(0, 3).map((v) => {
      const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, s)) * 255).toString(16).padStart(2, "0");
    }).join("");
    return {
      name: m.name || `(無名${i})`,
      base_color: hex,
      metallic: pm.metallicFactor == null ? 1 : Number(pm.metallicFactor.toFixed(2)),
      roughness: pm.roughnessFactor == null ? 1 : Number(pm.roughnessFactor.toFixed(2)),
      has_texture: Boolean(pm.baseColorTexture),
      share_of_surface: Number((tris[i] / total).toFixed(2)),
    };
  });
}

function byName(name) {
  for (const [re, channel] of NAME_RULES) if (re.test(name)) return channel;
  return null;
}

// Jev へ聞く。**選択肢はここに並べたものだけ。**
function questionFor(facts, context) {
  const criteria = {};
  for (const [key, v] of Object.entries(CHANNELS)) {
    if (key === "body") continue;     // 複数あるときに「本体」は選ばせない
    criteria[key] = `${v.ja}: ${v.what}`;
  }
  criteria.other = "None of these; leave it out of the colour controls";
  return {
    part: {
      type: "choice",
      instructions: `A ${context} in a Japanese home. Which part of it is this material?`
        + " Judge from its base colour, roughness, metallic value and how much of the surface it covers."
        + " The material name is an import id and carries no meaning.",
      criteria,
    },
  };
}

function askViaCli(viaPath, state, questions) {
  const dir = mkdtempSync(join(tmpdir(), "finish-"));
  writeFileSync(join(dir, "s.json"), JSON.stringify(state));
  writeFileSync(join(dir, "q.json"), JSON.stringify(questions));
  return new Promise((resolve, reject) => {
    execFile("node", [viaPath, "ask", join(dir, "s.json"), join(dir, "q.json")],
      { maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
        if (error) return reject(new Error((stderr || error.message).trim().split("\n")[0]));
        try { resolve(JSON.parse(stdout).answers); } catch (e) { reject(new Error("答えを読めなかった")); }
      });
  });
}

function loadCatalogue() {
  const tags = JSON.parse(readFileSync(join(ROOT, "assets", "models", "tags.json"), "utf8"));
  const items = [];
  for (const source of ["furniture_mega", "interior_model_0_26_1"]) {
    const manifest = JSON.parse(readFileSync(join(ROOT, "assets", "models", source, "manifest.json"), "utf8"));
    for (const item of manifest.items || []) {
      const tag = tags.items[item.id];
      items.push({ ...item, kind: tag && tag.kind, kindJa: tag && (tags.kinds[tag.kind] || {}).ja });
    }
  }
  return items;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const via = (arg("--via", "") || "").replace(/^~/, process.env.HOME);
  const dry = argv.includes("--dry");

  const items = loadCatalogue();
  const models = {};
  const stats = { single: 0, byName: 0, asked: 0, failed: 0 };
  const review = [];
  const pending = [];

  for (const item of items) {
    let doc;
    try { doc = gltfOf(join(ROOT, item.model)); } catch (e) { continue; }
    const facts = materialFacts(doc);
    if (!facts.length) continue;
    const url = item.model;

    if (facts.length === 1) {
      // 塗り分けようが無い。**本体1つ。** ガラスだけは色を変えない。
      const channel = byName(facts[0].name) === "glass" ? "glass" : "body";
      models[url] = { [facts[0].name]: channel };
      stats.single++;
      continue;
    }
    const assigned = {};
    const unknown = [];
    for (const f of facts) {
      const channel = byName(f.name);
      if (channel) { assigned[f.name] = channel; stats.byName++; } else unknown.push(f);
    }
    models[url] = assigned;
    if (unknown.length) pending.push({ url, item, unknown });
  }

  if (pending.length && !dry) {
    if (!via) throw new Error("名前から決まらないものがある。--via <jev.mjs> を渡すこと");
    const allowed = new Set([...Object.keys(CHANNELS).filter((k) => k !== "body"), "other"]);
    for (const job of pending) {
      const context = job.item.kindJa || job.item.category || "furniture";
      const answers = await Promise.all(job.unknown.map(async (f) => {
        try {
          const a = await askViaCli(via, {
            model: job.item.name, what_it_is: context,
            all_materials: job.unknown.length, material: f,
          }, questionFor(f, context));
          const pick = a && a.part && a.part.choice;
          const confidence = a && a.part && typeof a.part.confidence === "number" ? a.part.confidence : null;
          if (!allowed.has(pick)) return null;
          if (confidence !== null && confidence < 0.3) {
            review.push(`${job.item.id} / ${f.name}: 確信が薄い (${confidence.toFixed(2)})`);
            return null;
          }
          return pick === "other" ? null : { name: f.name, channel: pick };
        } catch (e) { stats.failed++; return null; }
      }));
      for (const a of answers) if (a) { models[job.url][a.name] = a.channel; stats.asked++; }
    }
  }

  // 手で確かめたものを最後にかぶせる
  for (const [url, map] of Object.entries(OVERRIDES)) {
    models[url] = Object.assign(models[url] || {}, map);
  }

  const body = {
    version: 1,
    channels: CHANNELS,
    fixed: [...FIXED],
    references: REFERENCES,
    generated: new Date().toISOString().slice(0, 10),
    models: Object.fromEntries(Object.keys(models).sort().map((k) => [k, models[k]])),
  };
  if (!dry) writeFileSync(OUT, JSON.stringify(body, null, 1) + "\n");

  const counts = {};
  for (const m of Object.values(models)) for (const c of Object.values(m)) counts[c] = (counts[c] || 0) + 1;
  process.stderr.write(
    `モデル ${Object.keys(models).length} 点 / マテリアル ${Object.values(counts).reduce((a, b) => a + b, 0)}\n`
    + `  本体1つで済んだ ${stats.single} 点 / 名前で決まった ${stats.byName} / Jev に聞いた ${stats.asked}`
    + ` / 失敗 ${stats.failed}\n  内訳: `
    + Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${CHANNELS[c].ja}${n}`).join(" / ") + "\n");
  for (const line of review.slice(0, 10)) process.stderr.write(`  ! ${line}\n`);
  if (!dry) process.stderr.write(`書き出し: ${relative(ROOT, OUT)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("assign_finish_channels.mjs")) {
  main().catch((e) => { process.stderr.write(String(e.message || e) + "\n"); process.exit(1); });
}
