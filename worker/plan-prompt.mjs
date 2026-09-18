// 間取り図を読ませるときの指示文。
//
// このファイルが持つもの
// ----------------------
// **手順だけ。** 何を、どの順に、どこへ入れるか。
//
// データの仕様(構成・項目・単位・種類)は worker/plan-spec.mjs にあり、
// 仕様書として別に渡す。出力の形そのものは worker/plan-response-schema.mjs の
// responseSchema で通信の設定として縛る。三者は役割が重ならない。
import { ALLOWED_ITEM_TYPES } from "./plan-item-spec.mjs";

export { ALLOWED_ITEM_TYPES };

export const SYSTEM_PROMPT = [
  "あなたは日本の住宅の間取り図を読み取り、住宅設計アプリが読み込めるJSONデータに変換する専門家です。",
  "図に描かれていることを正確にJSON形式に変換します。ありそうだからという理由で間取り図に無い要素を足しません。出力はJSONだけで説明文や前置きは書きません。",
].join("\n");

// 図の説明(利用者が書いた補足)があれば hint として渡す。
export function buildPlanPrompt({ hint } = {}) {
  return `この画像は日本の住宅の間取り図です。仕様に従ってJSONに変換してください。

次の手順で進めます。

**手順1.** 画像の中の平面図を数え、それぞれが何階かを判断する。平面図以外
（俯瞰図・立面図・外構図・表題欄）は読まない。

以下の手順2〜18を、平面図1枚ごとに行う。

**手順2.** 4辺の寸法線を読み、総寸法と内訳を dims に入れる。

**手順3.** 各辺について、内訳の合計が総寸法と一致することを確かめる。
一致しない辺は読み直す。読み直しても一致せず、読めない箇所が1つだけの場合は、
総寸法と読めた値の合計との差を、その箇所の寸法とする。

**手順4.** 総寸法を width と depth に入れる。

**手順5.** 内訳を順に足して、壁が立っている位置の座標を求める。

手順6〜13で、壁で囲まれた場所を1つずつ rooms に入れる。範囲は手順5の座標を
用いた長方形で表す。長方形でない部屋は、複数の長方形に分けて1つの部屋の
parts に並べる。

**手順6.** 室名が書かれている部屋を入れる。name はその文字とし、畳数の表記は除く。

部屋の輪郭が長方形でない場合は、**長方形に分けて parts に複数並べる**。
輪郭に凹みがあるのに parts が1つなら、その部屋は正しく表せていない。

**手順7.** 浴槽が描かれている部屋を入れる。name は「浴室」とする。

**手順8.** 洗面台または洗濯機が描かれている部屋を入れる。name は「洗面所」とする。

**手順9.** 便器が描かれている部屋を入れる。name は「トイレ」とする。

**手順10.** 階段が描かれていて、室名が書かれていない場所を入れる。
name は「階段室」とする。

階段の下が収納やトイレになっている図面は多い。**その場所に室名が書かれて
いれば、その部屋として入れる。** 階段はあとで部屋の上に重ねて置く。

**手順11.** 玄関ドアと土間が描かれている部屋を入れる。name は「玄関」とする。

**手順12.** 流し台が描かれている部屋を入れる。name は「キッチン」とする。

**手順13.** 手順6〜12で入れていない場所のうち、部屋と部屋をつなぐ通路に
なっている場所を入れる。name は「廊下」とする。それ以外の場所は name を
空文字にして入れる。

**手順14.** 階段を items に入れる。

- 直進する部分は stair とし、図の階段の位置に置く。rot は上る向きに合わせる。
- **階段は部屋と重なってよい。** 階段の下がトイレや収納なら、その部屋の上に置く。
- 向きが変わる部分があれば stair-corner を置く。直進部分と**辺を接して
  隣り合わせる**。間を空けない。重ねない。
- w と d は仕様の既定値のまま変えない。図の階段が既定より長く見えても、
  段数ぶんの長さは既定値で表す。

**手順15.** 水まわりの設備（浴槽・便器・洗面台・流し台）を items に入れる。

- 描かれている部屋を手順6〜13で入れた部屋から特定し、x と y をその部屋の
  範囲の中に収める。
- rot を、図に描かれている向きに合わせる。
- **w と d は仕様の既定値のまま変えない。** 図に合わせて大きさを変えると、
  アプリのカタログの品物と食い違う。

**手順16.** 扉を items に入れる。それぞれ、どの部屋とどの部屋の間にあるかを
特定し、x と y をその2つの部屋が接する境界の上に置く。玄関ドアは、玄関と
建物の外が接する境界の上に置く。

w は、図に描かれている開口の幅とする。

**手順17.** 窓を items に入れる。それぞれ、どの部屋にあるかを特定し、x と y を
その部屋と建物の外が接する境界の上に置く。

w は、図に描かれている窓の幅とする。

**手順18.** 入れた部屋を見直す。輪郭が長方形でない部屋の parts が1つだけに
なっていないか、階段の直進部分と廻り部分が離れていないかを確かめ、直す。
${hint ? `\n利用者からの補足: ${hint}\n` : ""}`;
}

// モデルの出力を、アプリが使う形にそろえる。
//
// 本筋は **階ごとの入れ子**で、各階が通り芯(gridX/gridY)と升目の塗り分け
// (cells/legend)を持つ。壁も部屋もここでは作らない——assets/js/plan-grid.js が
// 塗り分けの境目から計算する。
// 読み取りの経路(worker / 画面 / 計測)で同じ組み立てを二度書かないため、
// ここは**返ってきたものを階ごとにほどくだけ**にしてある。
//
// 古い形(walls が最上位にある、ページごとの配列)も受ける。読み取りを
// やり直させるより、受けられる形は受けるほうが安い。
export function decodeCompactPlan(parsed) {
  const out = { floors: [], walls: [], rooms: [], items: [], labels: [], notes: [], dims: [] };
  if (!parsed || typeof parsed !== "object") return out;

  const merge = (one) => {
    out.floors.push(...one.floors);
    out.walls.push(...one.walls);
    out.rooms.push(...one.rooms);
    out.items.push(...one.items);
    out.labels.push(...one.labels);
    out.notes.push(...one.notes);
    out.dims.push(...one.dims);
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((page) => merge(decodeCompactPlan(page)));
    return out;
  }

  const num = (v) => (typeof v === "number" ? v : Number(v));

  // 本筋の形: { floors: [ {floor, dims, gridX, gridY, cells, legend, items}, ... ], notes }
  if (Array.isArray(parsed.floors)) {
    for (const f of parsed.floors) {
      if (!f || typeof f !== "object") continue;
      const floor = Number(f.floor) || 1;
      const gridX = (Array.isArray(f.gridX) ? f.gridX : []).map(num).filter(Number.isFinite);
      const gridY = (Array.isArray(f.gridY) ? f.gridY : []).map(num).filter(Number.isFinite);
      const width = num(f.width), depth = num(f.depth);
      const rooms = (Array.isArray(f.rooms) ? f.rooms : []).filter((r) => r && typeof r === "object");
      const items = (Array.isArray(f.items) ? f.items : [])
        .filter((it) => it && typeof it === "object")
        .map((it) => ({ ...it, floor: it.floor == null ? floor : Number(it.floor) }));
      out.floors.push({ floor, width, depth, rooms, dims: f.dims || null });
      out.items.push(...items);
      if (f.dims && typeof f.dims === "object") out.dims.push({ ...f.dims, floor });
      // 古い形で walls / labels も混ざってきたら拾っておく
      for (const w of Array.isArray(f.walls) ? f.walls : []) {
        if (w && typeof w === "object") out.walls.push({ ...w, floor: w.floor == null ? floor : Number(w.floor) });
      }
      for (const l of Array.isArray(f.labels) ? f.labels : []) {
        if (l && typeof l === "object") out.labels.push({ ...l, floor: l.floor == null ? floor : Number(l.floor) });
      }
    }
    for (const n of Array.isArray(parsed.notes) ? parsed.notes : []) out.notes.push(String(n));
    return out;
  }

  // 以下は古い平らな形。
  for (const w of Array.isArray(parsed.walls) ? parsed.walls : []) {
    if (Array.isArray(w)) out.walls.push({ x1: num(w[0]), y1: num(w[1]), x2: num(w[2]), y2: num(w[3]), thick: num(w[4]), floor: num(w[5]) || 1 });
    else if (w && typeof w === "object") out.walls.push(w);
  }
  for (const r of Array.isArray(parsed.rooms) ? parsed.rooms : []) {
    if (Array.isArray(r)) out.rooms.push({ x: num(r[0]), y: num(r[1]), w: num(r[2]), d: num(r[3]), floor: num(r[4]) || 1, n: r[5] == null ? "" : String(r[5]) });
    else if (r && typeof r === "object") out.rooms.push(r);
  }
  for (const l of Array.isArray(parsed.labels) ? parsed.labels : []) {
    if (l && typeof l === "object") out.labels.push(l);
    else if (Array.isArray(l)) out.labels.push({ text: String(l[0]), x: num(l[1]), y: num(l[2]), floor: num(l[3]) || 1 });
  }
  for (const n of Array.isArray(parsed.notes) ? parsed.notes : []) out.notes.push(String(n));
  for (const it of Array.isArray(parsed.items) ? parsed.items : []) {
    if (Array.isArray(it)) out.items.push({ type: String(it[0]), x: num(it[1]), y: num(it[2]), w: num(it[3]), d: num(it[4]), rot: num(it[5]) || 0, floor: num(it[6]) || 1 });
    else if (it && typeof it === "object") out.items.push(it);
  }
  if (parsed.dims && typeof parsed.dims === "object") out.dims.push(parsed.dims);
  return out;
}
