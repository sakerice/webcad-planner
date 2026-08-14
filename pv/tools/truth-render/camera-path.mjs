// 時刻つきカメラキーの補間。DOM にも three.js にも依存しない純関数。

function reflect(a, b) {
  return a.map((v, i) => 2 * v - b[i]);
}

function lerp(a, b, u) {
  return a.map((v, i) => v + (b[i] - v) * u);
}

function catmullRom(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return p1.map((_, i) =>
    0.5 * (
      2 * p1[i] +
      (-p0[i] + p2[i]) * u +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3
    ));
}

export function sampleCameraPath(keys, t) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('sampleCameraPath: keys must be a non-empty array');
  }
  if (keys.length === 1) {
    return { pos: [...keys[0].pos], target: [...keys[0].target], fov: keys[0].fov };
  }

  const times = keys.map(k => k.t);
  const last = times.length - 1;
  const clamped = Math.min(Math.max(t, times[0]), times[last]);

  let i = 0;
  while (i < last - 1 && clamped >= times[i + 1]) i++;

  const span = times[i + 1] - times[i];
  const u = span === 0 ? 0 : (clamped - times[i]) / span;

  const pick = (field) => {
    const pts = keys.map(k => k[field]);
    if (pts.length < 3) return lerp(pts[0], pts[1], u);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p0 = i > 0 ? pts[i - 1] : reflect(p1, p2);
    const p3 = i + 2 <= last ? pts[i + 2] : reflect(p2, p1);
    return catmullRom(p0, p1, p2, p3, u);
  };

  return {
    pos: pick('pos'),
    target: pick('target'),
    fov: keys[i].fov + (keys[i + 1].fov - keys[i].fov) * u,
  };
}
