// Pure dimension evidence arithmetic shared by revision facts and CLI probes.
// Unknown entries stay in the chain; a partial sum is never a complete sum.
export function readDimensionEdge(edge) {
  const length = (v) => {
    if (typeof v !== 'number' && !(typeof v === 'string' && v.trim())) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // Legacy probe readings used [total, [parts]].
  const total = length(Array.isArray(edge) ? edge[0] : edge?.total);
  const raw = Array.isArray(edge) ? edge[1] : edge?.parts;
  const parts = Array.isArray(raw) ? raw.map(length) : [];
  const sum = parts.length && parts.every((n) => n !== null)
    ? parts.reduce((a, b) => a + b, 0) : null;
  return { total, parts, sum };
}
