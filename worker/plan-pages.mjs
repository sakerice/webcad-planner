// Join extraction pages without turning PDF page order into a floor identity.
// Duplicate identities can be detail views, repeated sheets, or uncertain labels;
// resolving them requires evidence that is absent from independent page readings.
import PlanSchema from '../assets/js/plan-schema.js';

export function mergeReadPages(pages) {
  const list = Array.isArray(pages) ? pages : [];
  // Preserve the legacy one-page wall/label response unchanged.
  if (list.length === 1 && !Array.isArray(list[0]?.floors)) return list[0];
  const floors = [], notes = [], pageProblems = [], used = new Map();
  list.forEach((page, index) => {
    const label = `${index + 1}ページ`;
    for (const note of Array.isArray(page?.notes) ? page.notes : []) {
      if (typeof note === 'string') notes.push(list.length > 1 ? `${label}: ${note}` : note);
    }
    if (!Array.isArray(page?.floors) || !page.floors.length) {
      pageProblems.push(`${label}: 階が特定できる平面図がありません。`);
      return;
    }
    for (const f of page.floors) {
      const floor = f && (typeof f.floor === 'number' || typeof f.floor === 'string') ? Number(f.floor) : NaN;
      if (!Number.isInteger(floor) || floor < PlanSchema.LIMITS.MIN_FLOOR || floor > PlanSchema.LIMITS.MAX_FLOOR) {
        pageProblems.push(`${label}: 階数が未確定、または対応する範囲外です。`);
        continue;
      }
      if (used.has(floor)) {
        pageProblems.push(`${label}: ${floor}階は${used.get(floor)}にもあります。同じ階の別図か階数の読み違いか確認してください。`);
        continue;
      }
      used.set(floor, label);
      floors.push({ ...f, floor });
    }
  });
  // No partial house is returned when even one page has ambiguous identity.
  return { floors: pageProblems.length ? [] : floors, notes, pageProblems };
}
