// Execute the real editor listeners: selecting a PDF page must never edit the live plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const helper = html.match(/function isPlanImportDialogOpen\(\)\{[\s\S]*?\n\}/)[0];
const nativeControl = html.match(/function isNativeKeyboardControl\(e\)\{[\s\S]*?\n\}/)[0];
function listener(start, end) {
  const i = html.indexOf(start), j = html.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'real keyboard listener was not found');
  return html.slice(i, j);
}
const editor = listener("window.addEventListener('keydown', function(e){", "window.addEventListener('keyup'");
const interior = listener("  document.addEventListener('keydown',function(e){", "  document.addEventListener('keyup'");
const marquee = listener("window.addEventListener('keydown',function(e){if(isPlanImportDialogOpen())", '\n');
function setup(open) {
  const handlers = [], history = [], changes = [];
  const item = { id: 'existing', x: 10, y: 20, flipX: false };
  const data = { items: [item], walls: [{ id: 'existing-wall' }], northDeg: 35 };
  const modal = { classList: { contains: name => name === 'show' && open } };
  const c = {
    document: { getElementById: id => id === 'plan-import-modal' ? modal : null,
      addEventListener: (type, handler) => { if (type === 'keydown') handlers.push(handler); } },
    window: { addEventListener: (type, handler) => { if (type === 'keydown') handlers.push(handler); } },
    ST: { selected: item, snap: 100, placingRot: 0, tool: 'select', shiftKey: false },
    DATA: data, HISTORY: history, DRAG: { marquee: { start: 1 } }, ren: null,
    iMov: {}, isInt: true, isWalkView: () => false, isObjectLocked: () => false,
    saveState: () => history.push(JSON.stringify(data)),
    delSel: () => { data.items.length = 0; changes.push('delete'); },
    undoAction: () => { data.walls.length = 0; changes.push('undo'); },
    redoAction: () => changes.push('redo'),
    copySelectedObject: () => { changes.push('copy'); return true; },
    pasteCopiedObject: () => { changes.push('paste'); return true; },
    updateProps: () => changes.push('props'), draw2d: () => changes.push('draw'),
    invalidate3D: () => changes.push('invalidate'), setView: () => changes.push('view'),
    exitWalkMode: () => changes.push('exitWalk'), finishWalkRouteDrawing: () => changes.push('route')
  };
  vm.createContext(c); vm.runInContext(helper + '\n' + nativeControl + '\n' + editor + '\n' + interior + '\n' + marquee, c);
  return { c, changes, snapshot: () => JSON.stringify({ DATA: data, HISTORY: history, ST: c.ST, DRAG: c.DRAG, iMov: c.iMov }),
    key(key, tagName, ctrlKey = false, metaKey = false) {
      let prevented = false;
      const e = { key, target: { tagName }, ctrlKey, metaKey, shiftKey: false, preventDefault() { prevented = true; } };
      handlers.forEach(h => h(e));
      return prevented;
    } };
}
test('all import-dialog controls preserve live DATA, history and selection, while retaining native key defaults', () => {
  for (const tag of ['SELECT', 'BUTTON', 'CANVAS', 'DIV', 'INPUT', 'TEXTAREA', 'BODY']) {
    for (const [key, ctrl, meta] of [['Delete'], ['Backspace'], ['ArrowDown'], ['ArrowUp'], ['ArrowLeft'], ['ArrowRight'],
      ['z', true], ['z', false, true], ['y', true], ['a', true], ['c', true], ['v', true],
      ['r'], ['f'], ['v'], ['Shift'], ['Escape'], ['Enter'], ['w']]) {
      const h = setup(true), before = h.snapshot();
      assert.equal(h.key(key, tag, ctrl, meta), false, `${tag}/${key}: native input/select behavior was suppressed`);
      assert.equal(h.snapshot(), before, `${tag}/${key}: the live editor or history changed`);
      assert.deepEqual(h.changes, [], `${tag}/${key}: an editor action fired`);
    }
  }
});
test('closing the import dialog restores editor arrow, Delete and Undo shortcuts', () => {
  const arrow = setup(false);
  assert.equal(arrow.key('ArrowDown', 'CANVAS'), true);
  assert.equal(arrow.c.ST.selected.y, 120);
  assert.equal(arrow.c.HISTORY.length, 1);
  const del = setup(false); del.key('Delete', 'BUTTON');
  assert.equal(del.c.DATA.items.length, 0);
  const undo = setup(false); undo.key('z', 'CANVAS', true);
  assert.equal(undo.c.DATA.walls.length, 0);
});
