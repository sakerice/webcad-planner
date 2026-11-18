// 共同編集のルームに入れる前に、差分(patch)とプラン全体の形を確かめる。
//
// ルームは、届いた差分をそのまま積み、全員へ流し、あとで元の全体に当てる。形を見ずに受けると、
// 形の壊れた差分を1回送るだけで、そのルームのプランが開けなくなる(GET・書き戻し・/op が毎回例外)か、
// 開いた人の画面が壊れる。ここで断る。
//
// 断る物(どれも、今の画面と外の AI の道が送る形には無い):
//   - 素のオブジェクトでない差分、collections・fields 以外の鍵
//   - collections の鍵が walls・items・rooms 以外、変更の鍵が upserts・removes 以外、配列でない upserts・removes
//   - upserts の物が素のオブジェクトでない・id が無い(文字か有限の数でない)・id が長すぎる
//   - removes の id が文字か有限の数でない・長すぎる
//   - fields の鍵が PlanCorePatch.SHARED_FIELDS に無い、欄の値の型が違う(FIELD_TYPES)
//   - どの深さでも __proto__・constructor・prototype の鍵(JSON.parse は __proto__ を自分の鍵として作るので、自分の鍵をたどって探す)
//   - 深さ・配列の件数・オブジェクトの鍵の数・文字の長さ・鍵の長さの上限を超える
//   - 物の座標(壁の x1・y1・x2・y2、物と部屋の x・y・w・d)が、数・数の文字・null 以外か、絶対値が 1e9 を超える
// プラン全体(ルームを作る・手動保存)には、危ない鍵と上限(深さはプランの根から数える)だけを見る。
//
// 上限の値と根拠は .superpowers/sdd/2026-11-19-injection-hardening/task-2-report.md。
// 手元の正当なプラン(既定プラン・固定プラン・互換の保存データ)の最大は、深さ 5 段・配列 1212 件・鍵 2522 個
// (interiorWallSettings.faces)・文字 1,738,626 字(壁の画像の data URL)・鍵の長さ 82 字・id 16 字・座標 30000。
// 外の AI の /op の引数の上限(collab-room.mjs の argsTooLarge)と同じく、根を1段と数え、超えたら理由の文を返す。
import PlanCorePatch from "../assets/js/plan-core/patch.js";

export const ROOM_LIMITS = Object.freeze({
  maxPlanDepth: 20,          // プランの根を1段。手元の最大は 5 段
  maxPatchDepth: 22,         // 差分の根を1段。物は collections.walls.upserts[] の下で、プランより 2 段深い
  maxArray: 50000,           // 配列の件数
  maxKeys: 50000,            // 1つのオブジェクトの鍵の数
  maxString: 10 * 1024 * 1024, // 文字の長さ(画像の data URL が入る。本文の上限 10MB と同じ)
  maxKeyLength: 1000,        // 鍵の長さ
  maxIdLength: 200,          // 物の id の長さ
  maxCoord: 1e9,             // 座標の絶対値(mm。1000 km)
});

const UNSAFE = new Set(PlanCorePatch.UNSAFE_KEYS);
const COLLECTIONS = new Set(PlanCorePatch.COLLECTIONS);
const SHARED_FIELDS = new Set(PlanCorePatch.SHARED_FIELDS);
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// 共有する欄の値の型。手元のプランと画面の作り方(normalizeLoadedPlan が作る形)に合わせ、null はどれも受ける。
const FIELD_TYPES = {
  exteriorWallSettings: "object",
  interiorWallSettings: "object",
  roofAppearance: "object",
  exteriorDetail: "object",
  floorMetadata: "object",
  heightDefaults: "object",
  floors: "objectOrArray",
  northDeg: "number",        // 数の文字も受ける
  autoRoomLights: "boolean",
};

// 物の座標の欄
const COORD_KEYS = {
  walls: ["x1", "y1", "x2", "y2"],
  items: ["x", "y", "w", "d"],
  rooms: ["x", "y", "w", "d"],
};

function finiteInRange(v, limit) {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
}

// 値をたどり、危ない鍵と上限を見る。収まっていれば null、外れていれば理由の文。
// depth は v の段(根を1段)。オブジェクトと配列だけを段に数える。
export function jsonShapeProblem(v, depth, maxDepth, where) {
  if (typeof v === "string") return v.length > ROOM_LIMITS.maxString ? `${where} の文字が長すぎます` : null;
  if (v === null || typeof v !== "object") return null;
  if (depth > maxDepth) return `${where} の入れ子が深すぎます（${maxDepth} 段まで）`;
  if (Array.isArray(v)) {
    if (v.length > ROOM_LIMITS.maxArray) return `${where} の数が多すぎます（${ROOM_LIMITS.maxArray} 件まで）`;
    for (let i = 0; i < v.length; i++) {
      const m = jsonShapeProblem(v[i], depth + 1, maxDepth, where);
      if (m) return m;
    }
    return null;
  }
  const keys = Object.keys(v);
  if (keys.length > ROOM_LIMITS.maxKeys) return `${where} の項目が多すぎます（${ROOM_LIMITS.maxKeys} 件まで）`;
  for (const k of keys) {
    if (UNSAFE.has(k)) return `${where} に使えない名前の項目があります（${k}）`;
    if (k.length > ROOM_LIMITS.maxKeyLength) return `${where} の項目の名前が長すぎます（${ROOM_LIMITS.maxKeyLength} 字まで）`;
    const m = jsonShapeProblem(v[k], depth + 1, maxDepth, where);
    if (m) return m;
  }
  return null;
}

function idProblem(id, where) {
  if (typeof id === "string") return id.length > ROOM_LIMITS.maxIdLength ? `${where} の id が長すぎます（${ROOM_LIMITS.maxIdLength} 字まで）` : null;
  if (typeof id === "number" && Number.isFinite(id)) return null;
  return `${where} の id は文字か数で送ってください`;
}

// 座標は、数・数の文字(古い保存データを弾かないため)・null を受ける。
function coordProblem(item, name, where) {
  for (const k of COORD_KEYS[name]) {
    if (!own(item, k) || item[k] === null) continue;
    const v = item[k];
    if (typeof v === "number" && finiteInRange(v, ROOM_LIMITS.maxCoord)) continue;
    if (typeof v === "string" && v.trim() !== "" && finiteInRange(Number(v), ROOM_LIMITS.maxCoord)) continue;
    return `${where} の ${k} が座標の数ではありません`;
  }
  return null;
}

function fieldTypeProblem(key, value) {
  if (value === null) return null;
  const type = FIELD_TYPES[key];
  const ok = type === "object" ? isPlainObject(value)
    : type === "objectOrArray" ? (!!value && typeof value === "object")
    : type === "number" ? (finiteInRange(value, ROOM_LIMITS.maxCoord)
      || (typeof value === "string" && value.trim() !== "" && finiteInRange(Number(value), ROOM_LIMITS.maxCoord)))
    : type === "boolean" ? typeof value === "boolean"
    : true;
  return ok ? null : `fields.${key} の値の形が違います`;
}

// /update の差分を確かめる。収まっていれば null、断るときは理由の文。
export function roomPatchProblem(patch) {
  if (!isPlainObject(patch)) return "差分はオブジェクトで送ってください";
  for (const k of Object.keys(patch)) {
    if (k !== "collections" && k !== "fields") return `差分に知らない項目があります（${k.slice(0, 40)}）`;
  }
  const deep = jsonShapeProblem(patch, 1, ROOM_LIMITS.maxPatchDepth, "差分");
  if (deep) return deep;
  if (own(patch, "collections")) {
    const collections = patch.collections;
    if (!isPlainObject(collections)) return "collections はオブジェクトで送ってください";
    for (const name of Object.keys(collections)) {
      if (!COLLECTIONS.has(name)) return `collections に知らない集まりがあります（${name.slice(0, 40)}）`;
      const change = collections[name];
      if (!isPlainObject(change)) return `collections.${name} はオブジェクトで送ってください`;
      for (const k of Object.keys(change)) {
        if (k !== "upserts" && k !== "removes") return `collections.${name} に知らない項目があります（${k.slice(0, 40)}）`;
      }
      if (own(change, "upserts")) {
        if (!Array.isArray(change.upserts)) return `collections.${name}.upserts は配列で送ってください`;
        for (const item of change.upserts) {
          const where = `collections.${name}.upserts`;
          if (!isPlainObject(item)) return `${where} の物はオブジェクトで送ってください`;
          if (!own(item, "id")) return `${where} の物に id がありません`;
          const m = idProblem(item.id, where) || coordProblem(item, name, where);
          if (m) return m;
        }
      }
      if (own(change, "removes")) {
        if (!Array.isArray(change.removes)) return `collections.${name}.removes は配列で送ってください`;
        for (const id of change.removes) {
          const m = idProblem(id, `collections.${name}.removes`);
          if (m) return m;
        }
      }
    }
  }
  if (own(patch, "fields")) {
    const fields = patch.fields;
    if (!isPlainObject(fields)) return "fields はオブジェクトで送ってください";
    for (const key of Object.keys(fields)) {
      if (!SHARED_FIELDS.has(key)) return `fields に共有しない欄があります（${key.slice(0, 40)}）`;
      const m = fieldTypeProblem(key, fields[key]);
      if (m) return m;
    }
  }
  return null;
}

// ルームを作る・手動保存で置くプラン全体を確かめる(validPlan を通ったあとに呼ぶ)。収まっていれば null、断るときは理由の文。
// 物の中身の形は見ない(今ある共有の門番 validPlan と同じく、手元にある古いプランを弾かないため)。
export function roomPlanProblem(plan) {
  return jsonShapeProblem(plan, 1, ROOM_LIMITS.maxPlanDepth, "プラン");
}
