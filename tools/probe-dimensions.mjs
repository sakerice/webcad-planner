// Formatting only: importing this module never reads keys or calls a provider.
import { readDimensionEdge } from '../worker/plan-dimensions.mjs';

export function formatDimensionLines(dims) {
  if (!dims || typeof dims !== 'object') return [];
  const labels = { top: '上辺', bottom: '下辺', left: '左辺', right: '右辺' };
  const lines = [];
  for (const side of Object.keys(labels)) {
    if (!Object.hasOwn(dims, side)) continue;
    const { total, parts, sum } = readDimensionEdge(dims[side]);
    const verdict = total === null ? '（総寸法不明・照合不可）'
      : !parts.length ? '（内訳なし・照合不可）'
      : sum === null ? '（内訳に不明値あり・照合不可）'
      : Math.abs(sum - total) < 1 ? '✓' : `✗ 内訳の合計が ${sum} で合わない`;
    const chain = parts.length ? parts.map((p) => p === null ? '?' : p).join(' + ') : '?';
    lines.push(`  ${labels[side]}  総 ${total === null ? '?' : total}  = ${chain}  ${verdict}`);
  }
  return lines;
}
