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
  if (spec.guideStride !== undefined && (!Number.isInteger(spec.guideStride) || spec.guideStride < 1)) {
    throw new Error(
      `shot spec: guideStride must be an integer >= 1, got ${JSON.stringify(spec.guideStride)}`);
  }
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
