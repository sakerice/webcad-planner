// 読み取った間取りを「仕上げる」ための判断。
//
// 何をするのか
// ------------
// 読み取りが返すのは14種類だけで、家具は1つも入っていない。返ってくるのは
// 家具ゼロの箱で、そこから先は使う側が753点のカタログを掘ることになっていた。
//
// ここでは2つを決める:
//
//   1. **部屋の種別** 「洋室(1)」が子供部屋なのか主寝室なのか
//   2. **設備のモデル** この浴室にはどの浴槽か、この洗面室にはどの洗面台か
//
// 足りないもの（この部屋に要るのに無いもの）は、種別が決まれば
// assets/js/room-program.js の表から**計算で出る**ので、ここでは聞かない。
//
// 聞かないもの
// ------------
// **置く場所は決めない。** 「ソファをこのあたりに」を自動で決めると、
// 通路を塞ぐ・掃き出し窓の前に立つ・背面が入口を向く、といった納まりの
// 失敗がそのまま出荷される。半端に置くくらいなら置かないほうがよい。
// 画面は「足りないもの」をカタログの道具として渡すところまでを行い、
// どこに置くかは指でやってもらう。
//
// 部屋の種別も、**言葉で決まるものは聞かない。** 「浴室」「トイレ」「玄関」は
// 決まった表(room-program.js)で当たる。聞くのは「洋室(1)」のように、
// 広さと階と他の部屋との関係でしか決まらないものだけ。
import RoomProgram from "../assets/js/room-program.js";
import ObjectKnowledge from "../assets/js/object-knowledge.js";
// 分類の呼び名はカタログの語彙が持っている。印ごとに画面から送らせない。
import tags from "../assets/models/tags.json" with { type: "json" };
import { jevAsk, choice } from "./jev.mjs";

// 1回で扱う上限。**この窓口には認証が無い**ので、1回の呼び出しで投げられる
// 判断の数を手前で抑える。
export const MAX_ROOMS = 40;
export const MAX_SLOTS = 24;
export const MAX_CANDIDATES = 8;
// 読み取りが返す印の上限(worker/routes-ai.mjs の marks.slice)と揃える。
// 40 にしていたら、実物の平屋1枚で45件あり、1回で送れなかった。
export const MAX_MARKS = 80;
export const MAX_MARK_CHOICES = 30;

const ROOM_KEYS = Object.keys(RoomProgram.ROOM_TYPES);

// 種別を選ばせる質問。**選択肢は room-program.js が持っている表そのもの。**
function roomQuestion(room) {
  const criteria = {};
  for (const key of ROOM_KEYS) criteria[key] = `${RoomProgram.ROOM_TYPES[key].ja}: ${RoomProgram.ROOM_TYPES[key].what}`;
  return {
    room_type: {
      type: "choice",
      instructions: `In a Japanese detached house, which room is this? The plan calls it "${room.name || "(no name)"}".`
        + " Use its area, which floor it is on, and what the other rooms on that floor are.",
      criteria,
    },
  };
}

function roomState(room, context) {
  return {
    name: room.name || "",
    floor: room.floor || null,
    area_m2: Number(room.area_m2) || null,
    tatami: Number(room.tatami) || null,
    width_mm: Math.round(Number(room.w) || 0),
    depth_mm: Math.round(Number(room.d) || 0),
    openings: room.openings || {},
    other_rooms_on_this_floor: context.byFloor[room.floor] || [],
    floors_in_this_house: context.floors,
  };
}

/**
 * 部屋の種別を決める。名前で決まるものは決まった表で、
 * 決まらないものだけ Jev に聞く。
 */
export async function nameRooms(rooms, env, deps = {}) {
  const list = (Array.isArray(rooms) ? rooms : []).slice(0, MAX_ROOMS);
  const context = {
    floors: [...new Set(list.map((r) => r.floor).filter(Boolean))].sort(),
    byFloor: list.reduce((acc, r) => {
      (acc[r.floor] || (acc[r.floor] = [])).push(r.name || "(名前なし)");
      return acc;
    }, {}),
  };

  return Promise.all(list.map(async (room) => {
    const byName = RoomProgram.typeFromName(room.name);
    if (byName) return { id: room.id, type: byName, from: "name" };
    // **図面を見ている側の判断を先に採る。** jev が受け取るのは名前と広さだけで、
    // 実物の図面3枚の「趣味部屋」「KB置き場」「スキップ」などを名前と広さで
    // 当てさせると 9件中4件しか当たらず、外したものは全部「和室」だった。
    // 図面を見れば床がフローリングか畳かは一目で分かる。
    if (room.use && RoomProgram.ROOM_TYPES[room.use]) return { id: room.id, type: room.use, from: "reader" };
    const answers = await jevAsk(env, { state: roomState(room, context), questions: roomQuestion(room) }, deps);
    const picked = choice(answers, "room_type");
    if (!picked || !RoomProgram.ROOM_TYPES[picked]) return { id: room.id, type: "other", from: "unknown" };
    const a = answers.room_type;
    return {
      id: room.id,
      type: picked,
      from: "jev",
      confidence: typeof a.confidence === "number" ? Number(a.confidence.toFixed(2)) : null,
    };
  }));
}

// 設備のモデルを選ばせる質問。**候補は画面側が寸法で絞ってから送ってくる。**
// カタログの中身(753点)を持っているのは画面側なので、ここで絞らない。
function slotQuestion(slot) {
  const criteria = {};
  for (const c of slot.candidates) {
    criteria[c.id] = `${c.name}: ${Math.round(c.w)} × ${Math.round(c.d)} × 高さ ${Math.round(c.h)} mm`;
  }
  criteria.none = "None of these suits this room; keep the plain default";
  return {
    pick: {
      type: "choice",
      instructions: `Which of these models best suits this ${slot.roomJa || "room"}?`
        + " Prefer one that fits the room with working clearance around it, and whose size is normal for a Japanese house."
        + " A model that only just fits, or that is far smaller than the space allows, is a worse answer.",
      criteria,
    },
  };
}

/**
 * 設備のモデルを1つずつ選ぶ。選べなければ、そのスロットは返さない
 * （画面は既定のままにする）。
 */
export async function pickModels(slots, env, deps = {}) {
  const list = (Array.isArray(slots) ? slots : []).slice(0, MAX_SLOTS)
    .map((slot) => ({ ...slot, candidates: (slot.candidates || []).slice(0, MAX_CANDIDATES) }))
    .filter((slot) => slot.candidates.length >= 2);

  const picked = await Promise.all(list.map(async (slot) => {
    const answers = await jevAsk(env, {
      state: {
        room: slot.roomJa || slot.room || "",
        room_width_mm: Math.round(Number(slot.roomW) || 0),
        room_depth_mm: Math.round(Number(slot.roomD) || 0),
        what_is_there_now: slot.current || null,
        current_width_mm: Math.round(Number(slot.w) || 0),
        current_depth_mm: Math.round(Number(slot.d) || 0),
      },
      questions: slotQuestion(slot),
    }, deps);
    const answer = choice(answers, "pick");
    if (!answer || answer === "none") return null;
    if (!slot.candidates.some((c) => c.id === answer)) return null;
    const a = answers.pick;
    const confidence = typeof a.confidence === "number" ? a.confidence : null;
    // 迷って選んだものに入れ替えると、既定のままのほうが良かった、が起きる。
    if (confidence !== null && confidence < 0.3) return null;
    return { slot: slot.id, model: answer, confidence: confidence === null ? null : Number(confidence.toFixed(2)) };
  }));
  return picked.filter(Boolean);
}

// 図面の印が何であるかを選ばせる質問。
//
// **候補は画面側が知識で絞ってから送ってくる**(その部屋に在らないものを外すだけ)。
// 何であるかの判断材料は2つで、どちらも jev が読む:
//   - 図面の見た目(looks) … 読み取りが描写した形。「二重線の縦長矩形。上端に
//     小さな横長矩形」なら枕の付いたベッド
//   - 置かれ方の知識(describe) … 「カーテンは窓の室内側、幅は窓より左右
//     100〜200mm大きい」。見た目だけでは薄い箱がテレビかカーテンか決まらない
function markQuestion(mark) {
  const criteria = {};
  for (const kind of mark.candidates) {
    const text = ObjectKnowledge.describe(kind).replace(/\n/g, " / ");
    const ja = (tags.kinds[kind] && tags.kinds[kind].ja) || kind;
    criteria[kind] = `${ja}: ${text}`;
  }
  criteria.none = "None of these: the symbol is something else, or cannot be told";
  const size = `${Math.round(Number(mark.w) || 0)} x ${Math.round(Number(mark.d) || 0)} mm`;
  return {
    kind: {
      type: "choice",
      instructions: `A Japanese floor plan shows a symbol in a ${mark.roomJa || "room"}. `
        + `The symbol is drawn like this: "${mark.looks || "(not described)"}". `
        + (mark.label ? `It is labelled "${mark.label}". ` : "It has no label. ")
        + `The drawn outline measures ${size}; a symbol often draws a group `
        + "(a bed with bedside tables, a table with its chairs), so the outline can be larger than the item itself. "
        + "Which of these is it?",
      criteria,
    },
  };
}

/**
 * 図面の印を1つずつ jev に選ばせる。迷ったもの(confidence 0.3 未満)は返さない。
 * @param {Array} marks [{id, looks, label, w, d, roomJa, candidates:[分類...], names}]
 */
export async function judgeMarks(marks, env, deps = {}) {
  const list = (Array.isArray(marks) ? marks : []).slice(0, MAX_MARKS)
    .map((m) => ({ ...m, candidates: (m.candidates || []).slice(0, MAX_MARK_CHOICES) }))
    .filter((m) => m.candidates.length >= 1);
  const judged = await Promise.all(list.map(async (mark) => {
    const answers = await jevAsk(env, { state: { room: mark.roomJa || "" }, questions: markQuestion(mark) }, deps);
    const answer = choice(answers, "kind");
    if (!answer || answer === "none" || !mark.candidates.includes(answer)) return null;
    const a = answers.kind;
    const confidence = typeof a.confidence === "number" ? a.confidence : null;
    if (confidence !== null && confidence < 0.3) return null;
    return { id: mark.id, kind: answer, confidence: confidence === null ? null : Number(confidence.toFixed(2)) };
  }));
  return judged.filter(Boolean);
}

/**
 * 足りないものを数える。**Jev は呼ばない。** 種別が決まれば表で出る。
 * @param {Array} rooms  [{id, type, kinds:[分類...]}]
 */
export function missingByRoom(rooms) {
  return (Array.isArray(rooms) ? rooms : []).map((room) => ({
    id: room.id,
    type: room.type,
    missing: RoomProgram.missingFor(room.type, room.kinds || []),
  })).filter((r) => r.missing.length);
}
