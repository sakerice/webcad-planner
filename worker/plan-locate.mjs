// 紙面のどこに平面図があるかを聞く。
//
// なぜ在るのか
// ------------
// 試した図面は、1ページが「見出しの帯 + 平面図（小さい）+ 3Dの俯瞰図（大きい）
// + 余白」という構成で、**平面図はページ面積の約6%**しかなかった。ページ全体を
// 送ると、平面図の部分は幅740画素ほどになり、寸法の文字は縦3〜4画素になる。
//
// AI が読む解像度には頭打ちがある（実測: 3072画素で3,369トークン、6144画素でも
// 同じ）。上限が決まっている以上、**その枠を平面図だけで使う**しかない。
//
// 探し方を画素の解析で書くこともできるが、ハウスメーカーごとに紙面の構成は
// 違うし、写真では成立しない。**大きな領域がどこにあるかを答えるのは、
// 細かい幾何と違ってモデルが得意な作業**なので、そちらに任せる。
//
// 縮めた画像で足りる。位置が分かればよく、寸法の文字は読まない。
// そのぶん安い（実測 ¥0.5 前後）。
export const LOCATE_SYSTEM = [
  "あなたは図面の紙面を見て、平面図が描かれている範囲を答える専門家です。",
  "出力はJSONだけで、説明文や前置きは書きません。",
].join("\n");

export const LOCATE_PROMPT = `この画像は住宅のプレゼン資料の1ページです。

**平面図（間取りを真上から描いた線画）が描かれている範囲**を答えてください。

範囲には、間取りの線画だけでなく、**その周りの寸法線と寸法の数値も含めます。**
寸法線は平面図の外側に引かれているので、そこまで入る大きさにしてください。

含めないもの:
- 3Dの俯瞰図・外観パース（立体的に描かれた絵）
- 見出しの帯、表題欄、日付、縮尺の注記
- 余白

座標は、画像の左上を (0,0)、右下を (1000,1000) とする値で答えます。

平面図が見当たらない場合は found を false にしてください。`;

export const LOCATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN", description: "平面図があるか" },
    x0: { type: "NUMBER", description: "左端" },
    y0: { type: "NUMBER", description: "上端" },
    x1: { type: "NUMBER", description: "右端" },
    y1: { type: "NUMBER", description: "下端" },
  },
  required: ["found", "x0", "y0", "x1", "y1"],
  propertyOrdering: ["found", "x0", "y0", "x1", "y1"],
};

// 返ってきた範囲を、使える形に整える。
//
// 狭すぎる範囲を信じると、寸法線を落として読めなくなる。広すぎる範囲は
// 切り出す意味が無い。どちらも**切り出さない**ほうが安全なので、その判断も返す。
export function normalizeBox(raw, options) {
  options = options || {};
  const margin = options.margin == null ? 0.03 : options.margin;   // 余白を少し足す
  const minArea = options.minArea == null ? 0.02 : options.minArea; // これ未満は狭すぎ
  const maxArea = options.maxArea == null ? 0.85 : options.maxArea; // これ以上は切る意味なし

  if (!raw || typeof raw !== "object" || raw.found === false) {
    return { ok: false, reason: "平面図が見つからなかった" };
  }
  const n = (v) => Number(v) / 1000;
  let x0 = n(raw.x0), y0 = n(raw.y0), x1 = n(raw.x1), y1 = n(raw.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) {
    return { ok: false, reason: "範囲が数値で返ってこなかった" };
  }
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
  x1 = Math.min(1, x1 + margin); y1 = Math.min(1, y1 + margin);

  const area = (x1 - x0) * (y1 - y0);
  if (!(area > 0)) return { ok: false, reason: "範囲の面積がゼロ" };
  if (area < minArea) return { ok: false, reason: `範囲が狭すぎる(紙面の${Math.round(area * 100)}%)` };
  if (area > maxArea) return { ok: false, reason: `範囲が紙面のほとんど(${Math.round(area * 100)}%)なので切り出さない` };

  return { ok: true, x0, y0, x1, y1, area };
}
