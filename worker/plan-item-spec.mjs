// AIに出させる「もの」の仕様。ここが唯一の出どころ。
//
// なぜ在るのか
// ------------
// これまで、JSONの形はプロンプトの本文に日本語で書いてあった。
// 「"walls": [{"x1":0,...}] のように返してください」と**お願いしていた**わけで、
// 守られる保証はどこにも無かった。実際、位置の項目名が box_2d から box へ
// 勝手に変わって返ったことがある。
//
// 形はお願いするものではなく、**通信の設定として強制するもの**にする。
// Vertex AI は generationConfig.responseSchema で出力の形を縛れる。
// ここでその schema を組み立てる。
//
// もうひとつ。種類ごとの既定寸法(浴槽1600×1600など)はアプリ側の ISIZES が
// 正で、ここに書き写すと**黙って食い違う**。食い違えば、AIには正しいつもりの
// 寸法を教えて、アプリは別の大きさで描くことになる。そうならないよう、
// tools/tests/plan-item-spec.test.cjs が両者の一致を検査している。
//
// 何を入れて、何を入れないか
// --------------------------
// 入れるのは **図面に必ず描かれていて、かつ間取りの意味を決めるもの**。
// 壁・建具・階段に加えて、水まわりの設備(浴槽・便器・洗面台・流し台)を入れる。
// 浴室に浴槽が無い3Dは、見ればすぐ間違いと分かる。
//
// 入れないのは **動かせる家具**(ベッド・ソファ・食卓・テレビ)。図面の家具は
// そのメーカーの標準仕様の絵であって、実際に置く物ではない。アプリには
// 家具のカタログがあるので、そちらで選んでもらう。

// 開口(建具)。**アプリ側で、最寄りの壁へ自動的に吸着する。**
// 向きも壁から決まるので、AIに回転を出させる必要がない。
export const OPENING_TYPES = [
  { type: "window",       ja: "窓",       what: "腰窓。床まで届かない窓",              w: 1650, d: 150 },
  { type: "window-door",  ja: "掃き出し窓", what: "床まで届く大きな窓。ベランダや庭へ出られる", w: 1650, d: 180 },
  { type: "door-swing",   ja: "開き戸",    what: "丁番で開く扉。図では1/4円の弧で描かれる",  w: 780,  d: 780 },
  { type: "door-slide-s", ja: "片引き戸",  what: "横に滑らせる扉",                     w: 780,  d: 150 },
  { type: "door-fold",    ja: "折戸",      what: "折りたたんで開く扉。収納の前によくある", w: 780,  d: 420 },
  { type: "door-opening", ja: "開口",      what: "建具の無い壁の抜け",                  w: 780,  d: 160 },
  { type: "door-front",   ja: "玄関ドア",  what: "玄関の扉。1階に1つだけ",              w: 940,  d: 200 },
];

// 階段。**階をつなぐので、上下階で同じ位置に無いと家として成り立たない。**
export const STAIR_TYPES = [
  { type: "stair",        ja: "階段",       what: "直進する階段。段を描いた細長い矩形", w: 910, d: 2730 },
  { type: "stair-corner", ja: "階段の廻り部", what: "向きが変わる隅の部分。扇形の段",    w: 910, d: 910 },
];

// 水まわりの設備。図面に必ず描かれ、部屋の用途をそのまま表す。
export const FIXTURE_TYPES = [
  { type: "bath",    ja: "浴槽",   what: "浴室の中の湯船。角の丸い矩形で描かれる", w: 1600, d: 1600 },
  { type: "toilet",  ja: "便器",   what: "トイレの便器",                        w: 380,  d: 680  },
  { type: "sink",    ja: "洗面台", what: "洗面化粧台。洗面脱衣室にある",          w: 750,  d: 560  },
  { type: "kitchen", ja: "流し台", what: "キッチンの調理台。細長い矩形",          w: 2550, d: 650  },
];

// 屋外。床として張り出すので、壁からは作れない。
export const OUTDOOR_TYPES = [
  { type: "balcony", ja: "バルコニー", what: "2階以上から外へ張り出した床", w: 1820, d: 910 },
];

export const ITEM_SPEC = [...OPENING_TYPES, ...STAIR_TYPES, ...FIXTURE_TYPES, ...OUTDOOR_TYPES];

export const ALLOWED_ITEM_TYPES = ITEM_SPEC.map((s) => s.type);

const BY_TYPE = new Map(ITEM_SPEC.map((s) => [s.type, s]));
export function specFor(type) { return BY_TYPE.get(type) || null; }

// 種類の一覧を、プロンプトに貼れる短い表にする。
// **手で書かない。** 書き写すと、既定寸法がアプリとずれたときに気づけない。
export function itemTypeTable() {
  const rows = (list, head) => [
    `【${head}】`,
    ...list.map((s) => `  ${s.type} = ${s.ja}（${s.what}）既定 ${s.w}×${s.d}mm`),
  ].join("\n");
  return [
    rows(OPENING_TYPES, "建具・開口 — 壁の上に載せる。最寄りの壁へ自動で吸い付くので向きの指定は不要"),
    rows(STAIR_TYPES, "階段 — その階から上の階へ上る。上下階で同じ位置に置き、いちばん上の階には置かない"),
    rows(FIXTURE_TYPES, "水まわりの設備 — 図に描かれているものだけ"),
    rows(OUTDOOR_TYPES, "屋外 — 建物の外の床。部屋ではなく物として置く"),
  ].join("\n");
}
