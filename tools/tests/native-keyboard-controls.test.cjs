// Execute the real editor/interior listeners and history functions, without a browser.
// DOM doubles expose inherited isContentEditable/closest; native defaults are not simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const state = fs.readFileSync(path.join(root, 'assets/js/app-state.js'), 'utf8');

function actualFunction(name, source = html) {
  const found = source.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
  assert.ok(found, `real ${name} function was not found`);
  return found[0];
}
function listener(start, end) {
  const i = html.indexOf(start), j = html.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'real keyboard listener was not found');
  return html.slice(i, j);
}
const listeners = [
  listener("  document.addEventListener('keydown',function(e){", "  document.addEventListener('keyup'"),
  listener("  document.addEventListener('keyup',function(e){", '\n'),
  listener("window.addEventListener('keydown', function(e){", "window.addEventListener('keyup'"),
  listener("window.addEventListener('keyup', function(e){", "window.addEventListener('resize'")
].join('\n');
const helpers = ['isPlanImportDialogOpen', 'isNativeKeyboardControl', 'undoAction', 'redoAction', 'restoreHistorySnapshot']
  .map(name => actualFunction(name)).concat(['serializeDataSnapshot', 'pushHistorySnapshot', 'saveState']
    .map(name => actualFunction(name, state))).join('\n');

function element(tagName, attributes = {}, parentElement = null) {
  return {
    tagName, parentElement, ...attributes,
    get isContentEditable() {
      for (let node = this; node; node = node.parentElement) {
        if (node.contenteditable === 'false') return false;
        if (['', 'true', 'plaintext-only'].includes(node.contenteditable)) return true;
      }
      return false;
    },
    closest(selector) {
      const tags = selector.toUpperCase().split(',');
      for (let node = this; node; node = node.parentElement) if (tags.includes(node.tagName)) return node;
      return null;
    }
  };
}
function setup(context = 'normal', x = 10) {
  const handlers = { keydown: [], keyup: [] }, calls = [];
  const item = { id: context + '-item', floor: 1, x, y: 20, flipX: false, flipY: false };
  let dialogOpen = false;
  const c = {
    EDITOR_PANE: context === 'comparison' ? 'pane-a' : '',
    NATIVE_PLAN_EDITOR: context === 'normal',
    document: {
      getElementById(id) {
        if (id === 'plan-import-modal') return { classList: { contains: name => name === 'show' && dialogOpen } };
        if (id === 'props') return { classList: { remove: () => calls.push('hideProps') } };
        return null;
      },
      addEventListener: (type, handler) => handlers[type].push(handler)
    },
    window: { addEventListener: (type, handler) => handlers[type].push(handler) },
    ST: { selected: item, floor: 1, snap: 100, placingRot: 0, tool: 'select', drawing: false,
      shiftKey: false, ctrlKey: false, selectAll: false, multiSelected: [], view: '2d' },
    DATA: { items: [item], walls: [{ id: 'wall', floor: 1, x1: 0, y1: 0, x2: 4000, y2: 0 }], rooms: [], northDeg: 35 },
    HISTORY: [], REDO_HISTORY: [], HISTORY_LIMIT: 100, DIRTY: false,
    DRAG: { active: false }, ren: null, iMov: {}, isInt: false,
    isWalkView: () => c.ST.view === '3d-walk', isObjectLocked: () => false,
    sharedRememberEditTargets: () => calls.push('rememberTargets'),
    markDirty: () => { c.DIRTY = true; calls.push('dirty'); },
    syncNorthFromPlan: () => calls.push('north'), ensureFloorMetadata: () => calls.push('floors'),
    clearMultiSelection: () => { c.ST.multiSelected = []; }, sharedForceFullSync: () => calls.push('sync'),
    delSel: () => { c.DATA.items = []; calls.push('delete'); },
    copySelectedObject: () => { calls.push('copy'); return true; },
    pasteCopiedObject: () => { calls.push('paste'); return true; },
    updateProps: () => calls.push('props'), draw2d: () => calls.push('draw'),
    invalidate3D: () => calls.push('invalidate'), setView: () => calls.push('view'),
    exitWalkMode: () => calls.push('exitWalk'), finishWalkRouteDrawing: () => calls.push('route')
  };
  vm.createContext(c);
  vm.runInContext(helpers + '\n' + listeners, c);
  return {
    c, calls, dialog(open) { dialogOpen = open; },
    snapshot: () => JSON.stringify({ DATA: c.DATA, HISTORY: c.HISTORY, REDO_HISTORY: c.REDO_HISTORY,
      ST: c.ST, DIRTY: c.DIRTY, DRAG: c.DRAG, iMov: c.iMov }),
    dispatch(type, key, target = element('CANVAS'), modifiers = {}) {
      const event = { key, target, ctrlKey: false, metaKey: false, shiftKey: false,
        defaultPrevented: false, ...modifiers, preventDefault() { this.defaultPrevented = true; } };
      handlers[type].forEach(handler => handler(event));
      return event;
    },
    key(key, target, modifiers) { return this.dispatch('keydown', key, target, modifiers); }
  };
}
const controls = [
  ['plan', { dataset: { libraryCurrent: '' } }], ['floor', { id: 'floor-sel' }],
  ['preset', { id: 'ai-render-preset' }], ['video preset', { id: 'video-render-preset' }]
];
const editingKeys = [
  ['ArrowUp'], ['ArrowDown'], ['ArrowLeft'], ['ArrowRight'], ['w'], ['a'], ['s'], ['d'],
  ['Delete'], ['Backspace'], ['r'], ['f'], ['v'], ['Shift'], ['Enter'], [' '],
  ['z', { ctrlKey: true }], ['z', { metaKey: true }], ['z', { ctrlKey: true, shiftKey: true }],
  ['y', { ctrlKey: true }], ['a', { ctrlKey: true }], ['c', { ctrlKey: true }], ['v', { ctrlKey: true }]
];
function assertNativeOnly(h, target, keys = editingKeys) {
  const before = h.snapshot();
  for (const [key, modifiers] of keys) {
    assert.equal(h.key(key, target, modifiers).defaultPrevented, false, `${target.tagName}/${key}: native default blocked`);
    assert.equal(h.snapshot(), before, `${target.tagName}/${key}: editor geometry, selection, history or movement changed`);
  }
  assert.deepEqual(h.calls, [], 'an editor or WALK action fired');
}

for (const context of ['normal', 'comparison']) {
  test(`${context}: native plan/floor/preset SELECT keys never edit geometry/history or turn WALK`, () => {
    for (const [name, attributes] of controls) for (const view of ['2d', '3d-walk']) {
      const h = setup(context); h.c.ST.view = view;
      const select = element('SELECT', { name, ...attributes });
      assertNativeOnly(h, select);
      assertNativeOnly(h, element('OPTION', {}, select));
    }
  });
  test(`${context}: inherited editable descendants retain Undo/Delete/caret keys`, () => {
    for (const value of ['', 'true', 'plaintext-only']) {
      const h = setup(context), host = element('DIV', { contenteditable: value });
      const target = element('SPAN', {}, element('STRONG', {}, host));
      assert.equal(target.contenteditable, undefined, 'test target must inherit editability');
      assertNativeOnly(h, target);
    }
  });
  test(`${context}: INPUT range/number/text and TEXTAREA retain their native keys`, () => {
    for (const target of [element('INPUT', { type: 'range' }), element('INPUT', { type: 'number' }),
      element('INPUT', { type: 'text' }), element('TEXTAREA')]) assertNativeOnly(setup(context), target);
  });
  test(`${context}: BUTTON Space/Enter activation is not intercepted by route drawing`, () => {
    for (const target of [element('BUTTON'), element('SPAN', {}, element('BUTTON'))]) {
      const h = setup(context); h.c.ST.tool = 'walk-route'; h.c.ST.drawing = true;
      assertNativeOnly(h, target, [[' '], ['Spacebar'], ['Enter']]);
    }
  });
}

test('canvas arrow movement uses real snapshots, and real Undo/Redo restore geometry in its pane only', () => {
  for (const context of ['normal', 'comparison']) {
    const h = setup(context), other = setup('comparison', 800), otherBefore = other.snapshot();
    assert.equal(h.key('ArrowRight').defaultPrevented, true);
    assert.equal(h.c.DATA.items[0].x, 110);
    assert.equal(h.c.HISTORY.length, 1); assert.equal(h.c.REDO_HISTORY.length, 0);
    assert.equal(h.key('z', undefined, { ctrlKey: true }).defaultPrevented, true);
    assert.equal(h.c.DATA.items[0].x, 10);
    assert.equal(h.c.HISTORY.length, 0); assert.equal(h.c.REDO_HISTORY.length, 1);
    assert.equal(h.key('z', undefined, { metaKey: true, shiftKey: true }).defaultPrevented, true);
    assert.equal(h.c.DATA.items[0].x, 110);
    assert.equal(h.c.HISTORY.length, 1); assert.equal(h.c.REDO_HISTORY.length, 0);
    assert.equal(other.snapshot(), otherBefore, 'another comparison context changed');
  }
});
test('canvas WALK movement still starts and keyup releases movement after focus moves to a control', () => {
  const h = setup('comparison'); h.c.ST.view = '3d-walk';
  assert.equal(h.key('ArrowLeft').defaultPrevented, false);
  assert.equal(h.c.iMov.arrowleft, true); assert.equal(h.c.DATA.items[0].x, 10);
  h.dispatch('keyup', 'ArrowLeft', element('SELECT'));
  assert.equal(h.c.iMov.arrowleft, false);
});
test('keyup always clears WALK and modifier state, even with the import dialog open', () => {
  const h = setup('comparison'); h.c.ST.view = '3d-walk';
  h.key('w'); h.key('Shift'); h.c.ST.ctrlKey = true; h.dialog(true);
  h.dispatch('keyup', 'w', element('SELECT'));
  h.dispatch('keyup', 'Shift', element('INPUT'));
  assert.equal(h.c.iMov.w, false); assert.equal(h.c.ST.shiftKey, false); assert.equal(h.c.ST.ctrlKey, false);
  h.c.ST.ctrlKey = true; h.dispatch('keyup', 'Control', element('TEXTAREA'));
  assert.equal(h.c.ST.ctrlKey, false);
});
test('contenteditable=false descendants return canvas shortcuts, and existing non-activation button shortcuts remain', () => {
  const h = setup(), host = element('DIV', { contenteditable: 'true' });
  const target = element('SPAN', {}, element('DIV', { contenteditable: 'false' }, host));
  assert.equal(h.key('ArrowDown', target).defaultPrevented, true);
  assert.equal(h.c.DATA.items[0].y, 120);
  assert.equal(h.key('Delete', element('BUTTON')).defaultPrevented, true);
  assert.equal(h.c.DATA.items.length, 0);
});
