#!/usr/bin/env node
// カタログ753点で、3LDK を1軒ぶん仕上げられるかを数える。
//
//   node tools/catalogue_gap.mjs            表を出す
//   node tools/catalogue_gap.mjs --json     機械で読む形
//
// なぜ在るのか
// ------------
// 「753点ある」は点数であって、品揃えではない。ソファが62点あっても、
// デスクが1点しか無ければ、子供部屋2室と書斎に同じ机が3つ並ぶ。
//
// docs/quality-bar.md が求める家具構成（assets/js/room-program.js）と、
// 実際にカタログにある点数（assets/models/tags.json）を突き合わせて、
// **どの品が何点足りないか**を出す。作るべきモデルの一覧になる。
//
// 「足りる」の線
// --------------
// 1軒に n 個要る品は、**2n 点**あって足りているとする。同じ部屋に同じ
// モデルが並ぶのは、点数が足りていても品揃えが足りていない状態なので、
// 選べる幅を見込んで倍にしている。
import { readFileSync } from "node:fs";
import { REAL_SIZE, realSizeOk } from "./catalogue-vocab.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const RoomProgram = require(join(ROOT, "assets", "js", "room-program.js"));
const TAGS = JSON.parse(readFileSync(join(ROOT, "assets", "models", "tags.json"), "utf8"));

// 標準的な2階建て3LDK。docs/quality-bar.md の想定に合わせた部屋割り。
// **この構成を1軒ぶん仕上げられるか**を物差しにする。
export const HOUSE_3LDK = [
  "ldk", "kitchen", "entry", "hall", "stairs", "bath", "washroom", "toilet",
  "washitsu", "bedroom", "wic", "kids", "kids", "toilet", "hall", "balcony", "exterior",
];

export function gapReport(house = HOUSE_3LDK) {
  const need = new Map();
  for (const room of house) {
    for (const item of RoomProgram.programFor(room)) {
      const at = need.get(item.kind) || { kind: item.kind, count: 0, rooms: [] };
      at.count += item.n;
      if (!at.rooms.includes(room)) at.rooms.push(room);
      need.set(item.kind, at);
    }
  }
  const have = {};
  for (const tag of Object.values(TAGS.items)) have[tag.kind] = (have[tag.kind] || 0) + 1;

  const rows = [...need.values()].map((row) => {
    const stock = have[row.kind] || 0;
    const want = row.count * 2;   // 選べる幅を見込む
    return {
      kind: row.kind,
      ja: (TAGS.kinds[row.kind] || {}).ja || row.kind,
      needed: row.count,
      stock,
      short: Math.max(0, want - stock),
      rooms: row.rooms.map((r) => RoomProgram.ROOM_TYPES[r].ja),
    };
  });
  rows.sort((a, b) => b.short - a.short || a.stock - b.stock);
  return rows;
}

// 点数ではなく、**寸法が日本の住宅に合っているか**を見る。
//
// 「浴槽が12点ある」と「1坪ユニットバスに入る湯船がある」は別の話である。
// 実際、12点でいちばん大きいのが 1307×681 で、1600×750 は1点も無かった。
export function realSizeReport() {
  const manifests = ["custom", "furniture_mega", "interior_model_0_26_1"]
    .flatMap((s) => JSON.parse(readFileSync(join(ROOT, "assets", "models", s, "manifest.json"), "utf8")).items);
  const out = [];
  for (const [kind, spec] of Object.entries(REAL_SIZE)) {
    const stock = manifests.filter((m) => (TAGS.items[m.id] || {}).kind === kind);
    const ok = stock.filter((m) => realSizeOk(kind, m.w, m.d));
    out.push({
      kind, ja: (TAGS.kinds[kind] || {}).ja || kind, what: spec.what,
      stock: stock.length, fits: ok.length,
      biggest: stock.length
        ? stock.slice().sort((a, b) => b.w * b.d - a.w * a.d)[0]
        : null,
    });
  }
  return out.sort((a, b) => a.fits - b.fits || b.stock - a.stock);
}

// 出番の無い在庫。**要るものが足りない一方で、使い道のない品が何点あるか。**
export function unusedStock(house = HOUSE_3LDK) {
  const used = new Set();
  for (const room of house) for (const item of RoomProgram.programFor(room)) used.add(item.kind);
  const out = [];
  const have = {};
  for (const tag of Object.values(TAGS.items)) have[tag.kind] = (have[tag.kind] || 0) + 1;
  for (const [kind, n] of Object.entries(have)) {
    if (!used.has(kind)) out.push({ kind, ja: (TAGS.kinds[kind] || {}).ja || kind, stock: n });
  }
  return out.sort((a, b) => b.stock - a.stock);
}

if (process.argv[1] && process.argv[1].endsWith("catalogue_gap.mjs")) {
  const rows = gapReport();
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ rows, unused: unusedStock(), sizes: realSizeReport() }, null, 1) + "\n");
  } else {
    const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0xff ? 2 : 1), 0)));
    process.stdout.write("3LDK を1軒仕上げるのに要る品と、カタログの在庫\n\n");
    process.stdout.write(`  ${pad("品", 20)}${pad("1軒に要る", 12)}${pad("在庫", 8)}${pad("不足", 8)}置かれる部屋\n`);
    for (const r of rows) {
      const mark = r.short > 0 ? "!" : " ";
      process.stdout.write(`${mark} ${pad(r.ja, 20)}${pad(r.needed, 12)}${pad(r.stock, 8)}${pad(r.short || "-", 8)}${r.rooms.join("・")}\n`);
    }
    process.stdout.write("\n\n寸法が日本の住宅に合っているか\n\n");
    for (const r of realSizeReport()) {
      const mark = r.fits === 0 ? "!" : " ";
      const big = r.biggest ? `最大 ${Math.round(r.biggest.w)}×${Math.round(r.biggest.d)}` : "在庫なし";
      process.stdout.write(`${mark} ${pad(r.ja, 20)}${pad(`${r.fits}/${r.stock} 点`, 12)}${pad(big, 18)}${r.what}\n`);
    }
    const unused = unusedStock();
    process.stdout.write(`\n出番の無い在庫 ${unused.reduce((n, u) => n + u.stock, 0)} 点: `
      + unused.map((u) => `${u.ja}${u.stock}`).join(" / ") + "\n");
  }
}
