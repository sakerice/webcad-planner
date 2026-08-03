// shot spec の検証と、そこから導かれるフレーム索引の算出。

export const GUIDE_KINDS = ['base', 'segmentation', 'instance', 'edge', 'depth', 'normal'];

const VIEWS = ['3d-int', '3d-ext'];

function req(spec, field) {
  if (spec[field] === undefined || spec[field] === null || spec[field] === '') {
    throw new Error(`shot spec: required field "${field}" is missing`);
  }
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

export function validateShotSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('shot spec: must be an object');
  ['id', 'plan', 'view', 'fps', 'duration', 'resolution', 'camera', 'guides'].forEach(f => req(spec, f));

  if (!VIEWS.includes(spec.view)) {
    throw new Error(`shot spec: view must be one of ${VIEWS.join(', ')}, got "${spec.view}"`);
  }
  if (!(spec.fps > 0)) throw new Error('shot spec: fps must be positive');
  if (!(spec.duration > 0)) throw new Error('shot spec: duration must be positive');
  if (!(spec.resolution.width > 0) || !(spec.resolution.height > 0)) {
    throw new Error('shot spec: resolution.width and resolution.height must be positive');
  }

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
  if (spec.guideStride !== undefined && !(spec.guideStride >= 1)) {
    throw new Error('shot spec: guideStride must be >= 1');
  }
  return spec;
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
