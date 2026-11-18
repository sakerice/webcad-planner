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
//   - どの深さでも、PlanCorePatch.UNSAFE_KEYS の鍵(__proto__・constructor・prototype と、toString・valueOf など
//     Object.prototype にある名前)。JSON.parse は __proto__ を自分の鍵として作るので、自分の鍵をたどって探す。
//     toString・valueOf を自分の鍵に持つオブジェクトは、文字や数に直すところ(要約・検査・2D の部屋名)で例外になる
//   - 物の id と階が UNSAFE_KEYS の名前(画面はその値を鍵に設定表を作る。作られた表を送ると上の決まりで断られ、
//     その画面の同期が止まるため)
//   - 文字か数のはずの物の欄(SCALAR_KEYS)に、オブジェクトや配列
//   - 共有する欄の中の入れ物(外壁の walls・faces など。FIELD_SHAPES)が素のオブジェクトでない
//   - 深さ・配列の件数・オブジェクトの鍵の数・文字の長さ・鍵の長さの上限を超える
//   - 物の座標(壁の x1・y1・x2・y2、物と部屋の x・y・w・d)が、数・数の文字・null 以外か、絶対値が 1e9 を超える
// プラン全体(ルームを作る・手動保存)には、危ない鍵と上限(深さはプランの根から数える)、walls・items・rooms の要素が
// 素のオブジェクトであること、id(あれば)・階・SCALAR_KEYS、共有する欄の形を見る。id の有無と座標は見ない(古い保存データのため)。
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
  maxSameId: 8,              // 1つの集まりの中で同じ id の物の数(手元の最大は2。raised-floor-plan.json)
});

// 集まりごとに、upsert が当たる鍵(PlanCorePatch.upsertKey。当て方と同じ関数)ごとの物の数を数える。
// 戻り値は {walls: Map(鍵 → 数), items: …, rooms: …}。id の無い・null の物は upsert が当たらないので数えない。
export function upsertKeyCounts(plan) {
  const out = {};
  for (const name of PlanCorePatch.COLLECTIONS) {
    const list = plan && Array.isArray(plan[name]) ? plan[name] : [];
    const count = new Map();
    for (const item of list) {
      const key = item && typeof item === "object" ? PlanCorePatch.upsertKey(item) : null;
      if (key !== null) count.set(key, (count.get(key) || 0) + 1);
    }
    out[name] = count;
  }
  return out;
}

// 1つの集まりの中で、同じ鍵に当たる物の数の最大。差分の当て方は、同じ鍵の物を全部その upsert の物に置き換えるので、
// 差分の大きさはこの数だけ掛かって効く(見積もりの上界に使う)。
export function maxSameId(plan) {
  let most = 0;
  const counts = upsertKeyCounts(plan);
  for (const name of PlanCorePatch.COLLECTIONS) for (const n of counts[name].values()) if (n > most) most = n;
  return most;
}

const UNSAFE = new Set(PlanCorePatch.UNSAFE_KEYS);
// 物の欄のうち、文字・数・真偽値・null だけを受ける欄。Worker の要約(workerSummarize)・検査(workerInspect)・
// 操作(workerApply)と画面の描画が、文字や数として読む欄。手元の全プランでこの型だった
// (オブジェクトや配列を持つ欄は finishColors・finishTextures・kitchenWorkPoint・ceiling・siteZones など)。
const SCALAR_KEYS = ["type", "floor", "n", "name", "label", "rot", "thick", "elev", "h", "locked", "detached", "baseRoom", "stairTo", "color", "texture", "model", "lightKind"];
const COLLECTIONS = new Set(PlanCorePatch.COLLECTIONS);
const SHARED_FIELDS = new Set(PlanCorePatch.SHARED_FIELDS);
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// 共有する欄の中の入れ物の形。値は「無い・null・素のオブジェクト」に限る。map は、さらに中の値も素のオブジェクトか null。
// 画面の ensureExteriorWallSettings などが `if(!s.walls)` で見るので、文字が入っていると作り直さずに残し、
// ownSlot が例外になって 3D と外観の設定欄が壊れるため。
const FIELD_SHAPES = {
  exteriorWallSettings: { whole: "object", floors: "map", walls: "map", faces: "map" },
  interiorWallSettings: { whole: "object", floors: "map", walls: "map", faces: "map" },
  roofAppearance: { whole: "object", floors: "map" },
  floorMetadata: { "*": "object" },
  floors: { "*": "object" },
};

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

// forUpsert のときは、id の文字 "undefined"・"null"・空白だけ(空の文字は除く)も断る。画面は送る前に
// ensureObjectIds で id の無い物に数を振るので、正当な画面の upsert にこの id は無い(id の無い物を指す名前に見えるため)。
// removes では受ける(画面は、id を振る前の物を "undefined" の鍵で消す)。空の文字の id は、画面が振り直さない古いデータに
// あり得るので受け、同じ鍵の物の数として見積もりに数える。
function idProblem(id, where, forUpsert) {
  if (typeof id === "string") {
    if (id.length > ROOM_LIMITS.maxIdLength) return `${where} の id が長すぎます（${ROOM_LIMITS.maxIdLength} 字まで）`;
    if (UNSAFE.has(id)) return `${where} の id に使えない名前です（${id}）`;
    if (forUpsert && (id === "undefined" || id === "null" || (id !== "" && id.trim() === ""))) return `${where} の id に使えない値です`;
    return null;
  }
  if (typeof id === "number" && Number.isFinite(id)) return null;
  return `${where} の id は文字か数で送ってください`;
}

// 座標は、数・数の文字(古い保存データを弾かないため)・空の文字・null を受ける。
function coordProblem(item, name, where) {
  for (const k of COORD_KEYS[name]) {
    if (!own(item, k) || item[k] === null || item[k] === "") continue;
    const v = item[k];
    if (typeof v === "number" && finiteInRange(v, ROOM_LIMITS.maxCoord)) continue;
    if (typeof v === "string" && v.trim() !== "" && finiteInRange(Number(v), ROOM_LIMITS.maxCoord)) continue;
    return `${where} の ${k} が座標の数ではありません`;
  }
  return null;
}

// 物1つの欄の型。where は場所の名前。
function scalarProblem(item, where) {
  for (const k of SCALAR_KEYS) {
    if (!own(item, k)) continue;
    const v = item[k];
    if (v !== null && typeof v === "object") return `${where} の ${k} は文字か数で送ってください`;
  }
  if (typeof item.floor === "string" && UNSAFE.has(item.floor)) return `${where} の floor に使えない名前です（${item.floor}）`;
  return null;
}

// 物1つを確かめる。差分では id が必ず要り、座標も見る。プラン全体では id の有無と座標を見ない。
function objectProblem(item, name, where, strict) {
  if (!isPlainObject(item)) return `${where} の物はオブジェクトで送ってください`;
  if (own(item, "id")) {
    if (!strict && (item.id === null || item.id === undefined || item.id === "")) { /* 古いデータの id の無い物は画面が振る */ }
    else { const m = idProblem(item.id, where, strict); if (m) return m; }
  } else if (strict) return `${where} の物に id がありません`;
  return scalarProblem(item, where) || (strict ? coordProblem(item, name, where) : null);
}

function shapeProblem(key, value) {
  const shape = FIELD_SHAPES[key];
  if (!shape || !value || typeof value !== "object") return null;
  for (const part of Object.keys(shape)) {
    const kind = shape[part];
    const entries = part === "*" ? Object.keys(value).map((k) => [k, value[k]]) : (own(value, part) ? [[part, value[part]]] : []);
    for (const [k, v] of entries) {
      if (v === null || v === undefined) continue;
      if (!isPlainObject(v)) return `fields.${key}.${k} の形が違います`;
      if (kind === "map") {
        for (const inner of Object.keys(v)) {
          if (v[inner] !== null && !isPlainObject(v[inner])) return `fields.${key}.${k}.${inner.slice(0, 40)} の形が違います`;
        }
      }
    }
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
  return ok ? shapeProblem(key, value) : `fields.${key} の値の形が違います`;
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
          const m = objectProblem(item, name, `collections.${name}.upserts`, true);
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
  const deep = jsonShapeProblem(plan, 1, ROOM_LIMITS.maxPlanDepth, "プラン");
  if (deep) return deep;
  if (!isPlainObject(plan)) return "プランはオブジェクトで送ってください";
  for (const name of PlanCorePatch.COLLECTIONS) {
    if (!Array.isArray(plan[name])) return `プランの ${name} は配列で送ってください`;
    for (const item of plan[name]) {
      const m = objectProblem(item, name, `プランの ${name}`, false);
      if (m) return m;
    }
  }
  if (maxSameId(plan) > ROOM_LIMITS.maxSameId) return `プランに同じ id の物が多すぎます（${ROOM_LIMITS.maxSameId} 個まで）`;
  for (const key of PlanCorePatch.SHARED_FIELDS) {
    if (!own(plan, key)) continue;
    const m = fieldTypeProblem(key, plan[key]);
    if (m) return m.replace(/^fields\./, "プランの ");
  }
  return null;
}
