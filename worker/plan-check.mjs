// 取り込んだ間取りを、物の置かれ方の知識に照らす。
//
// なぜ在るのか
// ------------
// 読み取りは図面から設備を拾うが、**それが置かれた部屋が正しいかは見ていない。**
// 浴槽が「洋室」に、便器が「LDK」に入っていても、そのまま通る。
// 3Dにすれば一目で分かる間違いだが、読み取りの時点では誰も気づかない。
//
// ここは assets/js/object-knowledge.js の知識で、拾ったものを照らす。
// **知識は1か所しか無い**ので、配置の検査や jev への説明と必ず同じ内容になる。
//
// 何を見て、何を見ないか
// ----------------------
// 見るのは「その部屋に在り得るか」と「実寸の範囲に収まるか」の2つだけ。
// どちらも知識表に書いてあるものしか見ない。**書いていないものは黙る。**
// 推測で警告を出すと、正しい図面を直させることになる。
//
// 家具は見ない。読み取りは家具を返さない(worker/plan-item-spec.mjs の判断)。
import ObjectKnowledge from "../assets/js/object-knowledge.js";
import RoomProgram from "../assets/js/room-program.js";

// 読み取りが返す種類 → 知識表の分類。
// **読み取り側の名前は図面の言葉、知識表の名前はカタログの言葉**で、
// 揃っていない。ここが唯一の変換点。
const IMPORT_TO_KIND = {
  bath: "bathtub",
  toilet: "toilet",
  sink: "vanity",
  kitchen: "kitchen-unit",
};

// 画面に出す名前。読み取りの種類名のままでは利用者に伝わらない。
const JA = { bath: "浴槽", toilet: "便器", sink: "洗面台", kitchen: "流し台" };

function centreOf(item) {
  return {
    x: Number(item.x || 0) + Number(item.w || 0) / 2,
    y: Number(item.y || 0) + Number(item.d || 0) / 2,
  };
}

function roomAt(plan, floor, x, y) {
  const rooms = (plan.rooms || []).filter((r) => (r.floor || 1) === (floor || 1)
    && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d);
  // 小さい部屋を優先する（大きな外形と重なっている場合があるため）
  rooms.sort((a, b) => a.w * a.d - b.w * b.d);
  return rooms[0] || null;
}

/**
 * 知識に照らした指摘を、画面へ出す文で返す。
 * 判定できないものは何も返さない（黙る）。
 */
export function knowledgeWarnings(plan) {
  const out = [];
  if (!plan || !Array.isArray(plan.items)) return out;
  for (const item of plan.items) {
    const kind = IMPORT_TO_KIND[item.type];
    if (!kind) continue;
    const name = JA[item.type] || item.type;
    const c = centreOf(item);
    const room = roomAt(plan, item.floor, c.x, c.y);

    // 1. その部屋に在り得るか
    if (room) {
      const type = RoomProgram.typeFromName(room.n || "");
      const allowed = ObjectKnowledge.roomAllows(kind, type);
      if (allowed === false) {
        const where = (RoomProgram.ROOM_TYPES[type] || {}).ja || room.n || "この部屋";
        const k = ObjectKnowledge.knowledgeFor(kind);
        const expect = (k.rooms || []).map((r) =>
          (RoomProgram.ROOM_TYPES[r] || {}).ja || r).join("・");
        out.push(`${name}が「${room.n || where}」にあります。`
          + `${name}は${expect}にあるものです。読み取りの取り違えか、部屋の名前が違います`);
      }
    } else {
      out.push(`${name}がどの部屋にも入っていません。位置か部屋の範囲を確かめてください`);
    }

    // 2. 実寸の範囲に収まるか
    if (ObjectKnowledge.sizeOk(kind, item.w, item.d) === false) {
      const k = ObjectKnowledge.knowledgeFor(kind);
      out.push(`${name}が ${Math.round(item.w)}×${Math.round(item.d)}mm です。`
        + `日本の住宅では ${k.size.what}。寸法の読み違いかもしれません`);
    }
  }
  return out;
}

export const _internals = { IMPORT_TO_KIND, roomAt };
