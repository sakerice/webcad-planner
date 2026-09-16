// 間取り図を読ませるときの指示文。
//
// ここだけ独立させてある理由
// --------------------------
// 読み取りの精度は、ほぼこの文章で決まる。モデルや通信の都合とは別の速さで
// 何度も書き直すことになるので、呼び出し側 (worker/routes-ai.mjs) と
// 分けてある。検査もこのファイルだけを読む。
//
// 何を読ませて、何を読ませないか
// ------------------------------
// 読ませるのは **壁・部屋・開口・階段** まで。家具は読ませない。
// 図面の家具記号は「そのメーカーの標準仕様の絵」であって、実際に置く物とは
// 別物だし、アプリには家具のカタログがある。無理に読ませると、量が増えて
// 高くなるうえ、肝心の壁の精度が落ちる。
//
// 座標の約束はアプリと同じ。単位はミリメートル、xは右、yは下が正。
// 壁は芯線(中心線)の線分で、部屋は軸に沿った長方形。

// アプリが受けられる開口・階段の種類。ここに無い名前を返されても描けない。
export const ALLOWED_ITEM_TYPES = [
  "window",        // 窓 (腰窓)
  "window-door",   // 掃き出し窓
  "door-swing",    // 開き戸
  "door-slide-s",  // 引戸
  "door-fold",     // 折戸
  "door-opening",  // 建具無しの開口
  "door-front",    // 玄関ドア
  "stair",         // 直進階段
  "stair-corner",  // 廻り階段の隅
  "balcony",       // バルコニー
];

export const SYSTEM_PROMPT = [
  "あなたは日本の住宅の間取り図を読み取って、CADアプリが読み込めるJSONにする専門家です。",
  "図に描かれていることだけを答えます。描かれていないものを推測で足しません。",
  "JSONだけを出力します。説明文や前置きは書きません。",
].join("\n");

// 図の説明(利用者が書いた補足)があれば hint として渡す。
export function buildPlanPrompt({ hint } = {}) {
  return `この画像は日本の住宅の間取り図です。壁・部屋・開口・階段を読み取って、次の形のJSONだけを出力してください。

# 座標の約束
- 単位はミリメートル。整数。
- x は右が正、y は下が正。図面の左上を原点(0,0)に近い位置とし、負の値は使わない。
- 建物の外周の**壁の芯(中心線)**を基準にする。外形の寸法線(例 7,280)は芯々の寸法。

# 日本の住宅の寸法の決まり
- ほとんどの寸法は **910mm の倍数**（半分の455、4分の1の227.5も使う）。
  読み取った寸法が 910 の倍数から 50mm 以内なら、910 の倍数に丸めること。
- 図面に書かれた寸法線の数値が最優先。数値と目測が食い違う場合は数値に従う。
- 1帖 = 910×1820。「洋室(4.5帖)」のような表記は面積の裏取りに使える。

# 出力するJSON
{
  "walls":  [{"x1":0,"y1":0,"x2":7280,"y2":0,"thick":120,"floor":1}, ...],
  "rooms":  [{"x":0,"y":0,"w":2730,"d":1820,"n":"洋室","floor":1}, ...],
  "items":  [{"type":"window","x":1365,"y":0,"w":1690,"d":150,"rot":0,"floor":1}, ...],
  "notes":  ["読み取れなかったこと、迷ったことを日本語で短く"]
}

## walls（壁）
- 芯線の線分。始点(x1,y1)と終点(x2,y2)。
- thick は壁の厚み。図に書かれていなければ外周も間仕切りも 120。
- 外周は閉じた輪になるように。角では端点の座標を完全に一致させる。
- 間仕切り壁も、図に線が引かれていれば入れる。

## rooms（部屋）
- **軸に沿った長方形のみ**。L字の部屋は長方形2つに分ける。
- x,y は左上の角。w は横幅、d は奥行き。
- n は図に書かれた部屋名をそのまま（「洋室」「ファミリークローゼット」「洗面」など）。
  畳数の表記（(4.5帖)）は名前に含めない。
- 廊下・ホール・階段室も、図で区切られていれば部屋として入れる。

## items（開口・階段）
使える type は次のものだけ。ここに無いものは出力しない（家具・設備・電気記号は**一切出力しない**）。
${ALLOWED_ITEM_TYPES.map((t) => "- " + t).join("\n")}

- x,y は**開口の中心**の座標。壁の芯線の上に載せる。
- w は開口の幅。d は 150（引戸・窓）または 200（玄関ドア）程度でよい。
- rot は度。0 なら開口が横向き（東西に伸びる壁）、90 なら縦向き（南北に伸びる壁）。
- 窓は "window"、床まで届く大きな窓は "window-door"。
- 階段は "stair" を段の進む向きに置く。廻り部分があれば "stair-corner" を足す。

## 階
- 1枚の図に1つの階しか写っていない場合、すべて floor:1 にする。
  図の見出しに「2階平面図」とあれば floor:2、3階なら floor:3。

# 迷ったときの扱い
- 読めない部分は**省く**。当てずっぽうで足さない。省いたことを notes に書く。
- 表題欄・俯瞰図・立面図・外構図が写っていても無視する。読むのは平面図だけ。
${hint ? `\n# 利用者からの補足\n${hint}\n` : ""}
JSONだけを出力してください。`;
}

// モデルの出力を、アプリが使う形にそろえる。
//
// 項目名つきのオブジェクトで返る前提だが、**詰めた配列で返ってくることも
// ある**ので両方受ける。1件=1配列を試した結果は plan-import の計測記録の
// とおりで、思考ぶんが増えて逆に高くついたため採用していない。
export function decodeCompactPlan(parsed) {
  const out = { walls: [], rooms: [], items: [] };
  if (!parsed || typeof parsed !== "object") return out;
  const num = (v) => (typeof v === "number" ? v : Number(v));
  for (const w of Array.isArray(parsed.walls) ? parsed.walls : []) {
    if (Array.isArray(w)) out.walls.push({ x1: num(w[0]), y1: num(w[1]), x2: num(w[2]), y2: num(w[3]), thick: num(w[4]), floor: num(w[5]) || 1 });
    else if (w && typeof w === "object") out.walls.push(w);
  }
  for (const r of Array.isArray(parsed.rooms) ? parsed.rooms : []) {
    if (Array.isArray(r)) out.rooms.push({ x: num(r[0]), y: num(r[1]), w: num(r[2]), d: num(r[3]), floor: num(r[4]) || 1, n: r[5] == null ? "" : String(r[5]) });
    else if (r && typeof r === "object") out.rooms.push(r);
  }
  for (const it of Array.isArray(parsed.items) ? parsed.items : []) {
    if (Array.isArray(it)) out.items.push({ type: String(it[0]), x: num(it[1]), y: num(it[2]), w: num(it[3]), d: num(it[4]), rot: num(it[5]) || 0, floor: num(it[6]) || 1 });
    else if (it && typeof it === "object") out.items.push(it);
  }
  return out;
}
