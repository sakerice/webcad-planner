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
import { jevAsk, choice } from "./jev.mjs";

// 1回で扱う上限。**この窓口には認証が無い**ので、1回の呼び出しで投げられる
// 判断の数を手前で抑える。
export const MAX_ROOMS = 40;
export const MAX_SLOTS = 24;
export const MAX_CANDIDATES = 8;

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
