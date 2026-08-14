// shot spec の検証と、そこから導かれるフレーム索引の算出。

export const GUIDE_KINDS = ['base', 'segmentation', 'instance', 'edge', 'depth', 'normal'];

const VIEWS = ['3d-int', '3d-ext'];

// キャプチャの走らせ方。id から推測せず spec に明示させる。
// 'sequence'          通常の連番キャプチャ。
// 'determinism-probe' 同一姿勢 -> 別姿勢 -> 同一姿勢 を撮り、1枚目と3枚目が
//                     バイト一致するかを見る再現性ゲート。
export const MODES = ['sequence', 'determinism-probe'];

function req(spec, field) {
  if (spec[field] === undefined || spec[field] === null || spec[field] === '') {
    throw new Error(`shot spec: required field "${field}" is missing`);
  }
}

// JSON は "24" と 24 を区別せず、JS は比較で黙って数値へ変換する。
// ("24" > 0) は true なので、型を見ずに範囲だけ検査すると文字列がそのまま
// 通り、Math.round(duration * fps) や wrap.style.width の計算で初めて
// おかしくなる。値の意味ごとに型そのものを検査する。
function reqNumber(spec, field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`shot spec: ${field} must be a number, got ${JSON.stringify(value)}`);
  }
  if (!(value > 0)) throw new Error(`shot spec: ${field} must be positive, got ${value}`);
}

function reqPositiveInteger(spec, field, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `shot spec: ${field} must be a positive integer, got ${JSON.stringify(value)}`);
  }
}

function reqString(spec, field, value) {
  if (typeof value !== 'string') {
    throw new Error(`shot spec: ${field} must be a string, got ${JSON.stringify(value)}`);
  }
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

// 内観採光。省略時は従来どおり内観3Dの太陽は消灯のままで、キャプチャは
// これまでと1バイトも変わらない。明示的に interiorSun:true と書いたショット
// だけが、天井のシャドウオクルーダーと実光源の太陽を得る。
function validateDaylight(spec) {
  const d = spec.daylight;
  if (d === undefined) return;
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new Error(`shot spec: daylight must be an object, got ${JSON.stringify(d)}`);
  }
  if (typeof d.interiorSun !== 'boolean') {
    throw new Error(
      `shot spec: daylight.interiorSun must be a boolean, got ${JSON.stringify(d.interiorSun)}`);
  }
  if (d.sunScale !== undefined &&
      (typeof d.sunScale !== 'number' || !Number.isFinite(d.sunScale) || d.sunScale <= 0)) {
    throw new Error(
      `shot spec: daylight.sunScale must be a positive number, got ${JSON.stringify(d.sunScale)}`);
  }
  // 外観3Dの太陽は元から点いている。そこへ内観用のスイッチを書いても何も
  // 起きないので、spec が嘘をつく前に落とす。
  if (d.interiorSun && spec.view !== '3d-int') {
    throw new Error(
      `shot spec: daylight.interiorSun applies to the interior view only, but view is "${spec.view}"`);
  }
}

// spec が要求する内観採光。要求が無ければ null。
export function daylightRequest(spec) {
  const d = spec && spec.daylight;
  if (!d || d.interiorSun !== true) return null;
  return { sunScale: d.sunScale === undefined ? 1 : d.sunScale };
}

// 俯瞰ショットの「ロール反転」を spec の段階で止める。
//
// three の lookAt は up=(0,1,0) を使って姿勢を決めるので、視線が真下
// (0,-1,0) に一致すると up と平行になり、ロールが決まらなくなる。実測:
// T96 の中間キーが pos と target で x/z が完全一致していたため、frame 60→61
// で絵が180度回転した(フレーム間差分 2.97 が 174.7 に跳ねる)。
//
// 単に「真下ちょうどを禁止」では足りない。キーが真下を挟んで反対側へ抜けると、
// 補間の途中で必ず真下を通る。そのため水平オフセットの向きが経路上で反転して
// いないことまで見る。閾値の 0.05m は、床から 5m 上のカメラなら約0.6度に相当し、
// 意図した俯瞰の構図を制約しない一方で、真下ちょうどは確実に弾く。
const MIN_HORIZONTAL_OFFSET_M = 0.05;
function validateNoRollFlip(keys) {
  const h = keys.map(k => ({ x: k.pos[0] - k.target[0], z: k.pos[2] - k.target[2] }));
  h.forEach((v, i) => {
    const len = Math.hypot(v.x, v.z);
    if (len < MIN_HORIZONTAL_OFFSET_M) {
      throw new Error(
        `shot spec: camera.keys[${i}] looks straight down (horizontal offset ${len.toFixed(3)}m ` +
        `< ${MIN_HORIZONTAL_OFFSET_M}m). three's lookAt has no defined roll there and the image ` +
        `flips. Offset pos from target horizontally.`);
    }
  });
  for (let i = 1; i < h.length; i++) {
    const dot = h[i - 1].x * h[i].x + h[i - 1].z * h[i].z;
    if (dot <= 0) {
      throw new Error(
        `shot spec: camera.keys[${i - 1}] and camera.keys[${i}] sit on opposite sides of the ` +
        `target horizontally, so the path passes through straight-down and the image rolls 180°. ` +
        `Keep every key on the same side of the target.`);
    }
  }
}

export function validateShotSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('shot spec: must be an object');
  ['id', 'plan', 'view', 'fps', 'duration', 'resolution', 'camera', 'guides', 'floor'].forEach(f => req(spec, f));

  reqString(spec, 'id', spec.id);
  reqString(spec, 'plan', spec.plan);
  if (!VIEWS.includes(spec.view)) {
    throw new Error(`shot spec: view must be one of ${VIEWS.join(', ')}, got "${spec.view}"`);
  }
  if (spec.mode !== undefined && !MODES.includes(spec.mode)) {
    throw new Error(
      `shot spec: mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(spec.mode)}`);
  }
  if (!Number.isInteger(spec.floor) || spec.floor <= 0) {
    throw new Error(`shot spec: floor must be a positive integer, got ${JSON.stringify(spec.floor)}`);
  }
  reqNumber(spec, 'fps', spec.fps);
  reqNumber(spec, 'duration', spec.duration);
  if (!spec.resolution || typeof spec.resolution !== 'object') {
    throw new Error('shot spec: resolution must be an object');
  }
  reqPositiveInteger(spec, 'resolution.width', spec.resolution.width);
  reqPositiveInteger(spec, 'resolution.height', spec.resolution.height);

  if (!Array.isArray(spec.guides)) throw new Error('shot spec: guides must be an array');
  spec.guides.forEach(g => {
    if (!GUIDE_KINDS.includes(g)) throw new Error(`shot spec: unknown guide kind "${g}"`);
  });

  const keys = spec.camera && spec.camera.keys;
  if (!Array.isArray(keys) || keys.length < 2) {
    throw new Error('shot spec: camera.keys must have at least 2 entries');
  }
  keys.forEach((k, i) => {
    if (typeof k.t !== 'number' || !Number.isFinite(k.t)) throw new Error(`shot spec: camera.keys[${i}].t must be a number`);
    if (!isVec3(k.pos)) throw new Error(`shot spec: camera.keys[${i}].pos must be 3 numbers`);
    if (!isVec3(k.target)) throw new Error(`shot spec: camera.keys[${i}].target must be 3 numbers`);
    if (!(k.fov > 0)) throw new Error(`shot spec: camera.keys[${i}].fov must be positive`);
    if (i > 0 && !(k.t > keys[i - 1].t)) throw new Error('shot spec: camera.keys times must be strictly ascending');
  });
  if (keys[0].t !== 0) throw new Error('shot spec: camera.keys must start at t=0');
  if (Math.abs(keys[keys.length - 1].t - spec.duration) > 1e-9) {
    throw new Error('shot spec: last camera key time must equal duration');
  }
  validateNoRollFlip(keys);
  if (spec.guideStride !== undefined && (!Number.isInteger(spec.guideStride) || spec.guideStride < 1)) {
    throw new Error(
      `shot spec: guideStride must be an integer >= 1, got ${JSON.stringify(spec.guideStride)}`);
  }
  validateDaylight(spec);
  return spec;
}

export function shotMode(spec) {
  return spec.mode || 'sequence';
}

export function frameTimes(spec) {
  const n = Math.round(spec.duration * spec.fps);
  return Array.from({ length: n }, (_, i) => i / spec.fps);
}

export function guideFrameIndices(spec) {
  const n = Math.round(spec.duration * spec.fps);
  const stride = spec.guideStride || 1;
  const out = [];
  for (let i = 0; i < n; i += stride) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}
