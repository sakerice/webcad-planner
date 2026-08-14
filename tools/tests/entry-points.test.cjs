// Task 29-2: 幅によって機能の入口が消えないこと。
//
// これは grep ではない。index.html の <style> を実際にパースして小さな CSS の
// 評価器を作り、マークアップから組み立てた要素ツリーに対して、320〜1400px の
// 各幅で display を計算する。測るのは「その幅で、その機能を呼べるボタンが
// 1つでも生きているか」という性質そのものであって、閾値の数字やクラス名では
// ない。閾値を動かしても、ボタンを消しても、入口がゼロになった瞬間に赤くなる。
//
// 画像AIレンダーのツールバーボタンは CSS で display:none、.show が付いて初めて
// 出る。その .show を付ける updateUnityRenderControls() を node:vm で**実際に
// 走らせて**モデルへ反映するので、初期化時の呼び出しを消せばこのテストは赤に
// なる（実測: 772〜1400px で入口ゼロ）。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ── 1. CSS: <style> を集めてルールへ分解する ──────────────────────────────
function collectCss(src) {
  let css = '';
  let at = 0;
  for (;;) {
    const open = src.indexOf('<style', at);
    if (open === -1) break;
    const bodyAt = src.indexOf('>', open) + 1;
    const close = src.indexOf('</style>', bodyAt);
    css += src.slice(bodyAt, close) + '\n';
    at = close + 8;
  }
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(s, openAt) {
  let depth = 0;
  for (let i = openAt; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// {media, selector, decls:{prop:{value,important}}, order}
function parseRules(css, media, out) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const head = css.slice(i, open).trim();
    const close = matchingBrace(css, open);
    if (close === -1) break;
    const body = css.slice(open + 1, close);
    if (head.startsWith('@media')) {
      parseRules(body, media ? media + ' and ' + head.slice(6).trim() : head.slice(6).trim(), out);
    } else if (head.startsWith('@')) {
      // @keyframes 等。display には効かない。
    } else {
      const decls = {};
      body.split(';').forEach((d) => {
        const c = d.indexOf(':');
        if (c === -1) return;
        const prop = d.slice(0, c).trim().toLowerCase();
        let val = d.slice(c + 1).trim();
        const important = /!important$/i.test(val);
        if (important) val = val.replace(/!important$/i, '').trim();
        if (prop) decls[prop] = { value: val.toLowerCase(), important: important };
      });
      head.split(',').forEach((sel) => {
        out.push({ media: media, selector: sel.trim(), decls: decls, order: out.length });
      });
    }
    i = close + 1;
  }
  return out;
}

const RULES = parseRules(collectCss(html), null, []);

// ── 2. メディアクエリの評価 ───────────────────────────────────────────────
const UNKNOWN_FEATURES = new Set();
function featureTrue(feat, env) {
  const m = feat.match(/^\(?\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)?$/i);
  if (!m) { UNKNOWN_FEATURES.add(feat); return false; }
  const name = m[1].toLowerCase();
  const val = m[2].toLowerCase();
  if (name === 'max-width') return env.width <= parseInt(val, 10);
  if (name === 'min-width') return env.width >= parseInt(val, 10);
  if (name === 'pointer') return val === 'coarse' ? env.coarse : !env.coarse;
  UNKNOWN_FEATURES.add(name);
  return false;
}
function mediaTrue(media, env) {
  if (!media) return true;
  return media.split(',').some((clause) =>
    clause.split(/\s+and\s+/i).every((f) => featureTrue(f.trim(), env)));
}

// ── 3. セレクタの照合（子孫と直子まで。擬似クラスは静止状態として落とす）──
function parseCompound(text) {
  const out = { tag: null, id: null, classes: [] };
  const t = text.replace(/::?[a-z-]+(\([^)]*\))?/gi, '');
  const m = t.match(/^[a-z0-9-]+/i);
  if (m) out.tag = m[0].toLowerCase();
  let re = /[.#][A-Za-z0-9_-]+/g, g;
  while ((g = re.exec(t))) {
    if (g[0][0] === '#') out.id = g[0].slice(1);
    else out.classes.push(g[0].slice(1));
  }
  return out;
}
function compoundMatches(c, el) {
  if (c.tag && c.tag !== el.tag) return false;
  if (c.id && c.id !== el.id) return false;
  return c.classes.every((k) => el.classes.indexOf(k) >= 0);
}
// 静止状態で当たらない擬似クラスを含むルールは無視する。
const DYNAMIC = /:(hover|active|focus|focus-visible|focus-within|disabled|checked|target|visited)\b/i;
function selectorMatches(sel, chain) {
  // 疑似要素（::-webkit-scrollbar 等）は要素そのものではない。落とさないと
  // #toolbar::-webkit-scrollbar{display:none} が #toolbar に効いてしまう。
  if (sel.indexOf('::') >= 0) return false;
  if (DYNAMIC.test(sel) || sel.indexOf('[') >= 0 || /[~+]/.test(sel)) return false;
  const parts = sel.trim().split(/\s+>\s+|\s+/).filter(Boolean);
  const compounds = parts.map(parseCompound);
  let ci = compounds.length - 1;
  if (!compoundMatches(compounds[ci], chain[chain.length - 1])) return false;
  ci--;
  for (let i = chain.length - 2; i >= 0 && ci >= 0; i--) {
    if (compoundMatches(compounds[ci], chain[i])) ci--;
  }
  return ci < 0;
}
function specificity(sel) {
  const ids = (sel.match(/#[A-Za-z0-9_-]+/g) || []).length;
  const cls = (sel.match(/\.[A-Za-z0-9_-]+/g) || []).length;
  const tags = (sel.replace(/[#.][A-Za-z0-9_-]+/g, '').match(/[a-z][a-z0-9-]*/gi) || []).length;
  return ids * 10000 + cls * 100 + tags;
}
function displayOf(chain, env) {
  const el = chain[chain.length - 1];
  let best = null;
  for (const r of RULES) {
    if (!r.decls.display) continue;
    if (!mediaTrue(r.media, env)) continue;
    if (!selectorMatches(r.selector, chain)) continue;
    const cand = { important: r.decls.display.important, spec: specificity(r.selector), order: r.order, value: r.decls.display.value };
    if (!best || cand.important > best.important ||
       (cand.important === best.important && (cand.spec > best.spec ||
       (cand.spec === best.spec && cand.order > best.order)))) best = cand;
  }
  const inline = el.style && el.style.match(/display\s*:\s*([a-z-]+)/i);
  if (inline && (!best || !best.important)) return inline[1].toLowerCase();
  return best ? best.value : 'block';
}
// display と同じ仕組みで transform も引く。スマホのサイドバーは display:none では
// なく translateY(100%) で画面の外に置かれる。display だけ見ていると「いつでも
// 押せる」ことになってしまい、開き口(フッターの「ツール」)を消しても気づけない。
function transformOf(chain, env) {
  const el = chain[chain.length - 1];
  let best = null;
  for (const r of RULES) {
    if (!r.decls.transform) continue;
    if (!mediaTrue(r.media, env)) continue;
    if (!selectorMatches(r.selector, chain)) continue;
    const cand = { important: r.decls.transform.important, spec: specificity(r.selector), order: r.order, value: r.decls.transform.value };
    if (!best || cand.important > best.important ||
       (cand.important === best.important && (cand.spec > best.spec ||
       (cand.spec === best.spec && cand.order > best.order)))) best = cand;
  }
  const inline = el.style && el.style.match(/transform\s*:\s*([^;]+)/i);
  if (inline && (!best || !best.important)) return inline[1].toLowerCase().trim();
  return best ? best.value : 'none';
}
// 画面の外へ丸ごと逃がされている（100% ずらされている）か。
function isOffCanvas(node, env) {
  for (let n = node; n; n = n.parent) {
    const chain = [];
    for (let p = n; p; p = p.parent) chain.unshift(p);
    if (/translate[xy]?\(\s*-?100%/.test(transformOf(chain, env))) return true;
  }
  return false;
}
function isRendered(node, env) {
  let n = node;
  while (n) {
    const chain = [];
    for (let p = n; p; p = p.parent) chain.unshift(p);
    if (displayOf(chain, env) === 'none') return false;
    n = n.parent;
  }
  return true;
}

// ── 4. マークアップから要素ツリーを組む（script/style の中は読まない）─────
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col']);
function buildTree(src) {
  const bodyAt = src.indexOf('<body');
  const start = src.indexOf('>', bodyAt) + 1;
  const root = { tag: 'body', id: null, classes: [], style: '', parent: null, children: [] };
  const stack = [root];
  const all = [];
  let i = start;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue; }
    const gt = src.indexOf('>', lt);
    if (gt === -1) break;
    const raw = src.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      const tag = raw.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
      i = gt + 1;
      continue;
    }
    const tag = (raw.match(/^[a-z0-9-]+/i) || [''])[0].toLowerCase();
    if (!tag) { i = gt + 1; continue; }
    const attrs = {};
    const re = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = m[2];
    const node = {
      tag: tag,
      id: attrs.id || null,
      classes: (attrs.class || '').trim().split(/\s+/).filter(Boolean),
      style: attrs.style || '',
      onclick: attrs.onclick || '',
      parent: stack[stack.length - 1],
      children: []
    };
    node.parent.children.push(node);
    all.push(node);
    if (tag === 'script' || tag === 'style') {
      const end = src.indexOf('</' + tag, gt);
      i = end === -1 ? gt + 1 : end;
      continue;
    }
    if (!VOID.has(tag) && !raw.endsWith('/')) stack.push(node);
    i = gt + 1;
  }
  return { root: root, all: all };
}
const TREE = buildTree(html);

function ancestorIds(node) {
  const ids = [];
  for (let p = node; p; p = p.parent) if (p.id) ids.push(p.id);
  return ids;
}

// ── 5. 画像AIレンダーのツールバーボタンは .show が付いて初めて出る ────────
// index.html から updateUnityRenderControls と isUnityRenderFeatureEnabled を
// 切り出し、要素モデルへ**実際に**適用する。初期化時の呼び出しが消えれば、
// ここでクラスが付かず、下の掃引が入口ゼロで赤くなる。
function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}

function applyLoadTimeClasses() {
  // 初期化時に呼ばれていなければ、当然クラスは付かない。
  const calledAtLoad = /\nupdateUnityRenderControls\(\);/.test(html);
  if (!calledAtLoad) return;
  const byId = {};
  TREE.all.forEach((n) => { if (n.id) byId[n.id] = n; });
  const sandbox = {
    location: { search: '' },
    URLSearchParams: URLSearchParams,
    document: {
      getElementById: function (id) {
        const n = byId[id];
        if (!n) return null;
        return {
          classList: {
            toggle: function (name, on) {
              const at = n.classes.indexOf(name);
              if (on && at < 0) n.classes.push(name);
              if (!on && at >= 0) n.classes.splice(at, 1);
            }
          }
        };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(topLevelFunction('isUnityRenderFeatureEnabled') + '\n' +
    topLevelFunction('updateUnityRenderControls') + '\nupdateUnityRenderControls();', sandbox);
}
applyLoadTimeClasses();

// ── 6. 機能と、その入口 ───────────────────────────────────────────────────
const FEATURES = {
  toggleGrid: 'グリッド表示',
  toggleDim: '寸法表示',
  resetView: '全体表示',
  undoAction: 'Undo',
  redoAction: 'Redo',
  clearFloor: '階クリア',
  savePlanToStorage: '保存',
  exportPlan: 'JSON書き出し',
  'import-file': 'JSON読込',
  generateAiRenderPackage: '画像AIレンダー',
  openVideoRenderDialog: '動画AIレンダー',
  openJisDrawingDialog: 'JIS図面',
  // Task 30 で置き場所が変わった操作。移動先が消えれば、ここで入口ゼロになる。
  "setTool('select')": '選択ツール',
  "setTool('erase')": '削除ツール',
  copySelectedFromButton: 'コピー',
  pasteCopiedFromButton: '貼付'
};
// ダイアログの中のボタンは入口ではない（開いてからでないと押せない）。
const DIALOGS = ['unity-render-modal', 'video-render-modal', 'jis-drawing-overlay', 'share-modal'];

function entryPointsFor(fn) {
  return TREE.all.filter((n) => {
    if (!n.onclick || n.onclick.indexOf(fn) < 0) return false;
    return !ancestorIds(n).some((id) => DIALOGS.indexOf(id) >= 0);
  });
}

const ENTRIES = {};
Object.keys(FEATURES).forEach((fn) => { ENTRIES[fn] = entryPointsFor(fn); });

test('入口の抽出そのものが機能している（対象の機能すべてにボタンが見つかる）', () => {
  Object.keys(FEATURES).forEach((fn) => {
    assert.ok(ENTRIES[fn].length > 0, FEATURES[fn] + ' のボタンが1つも見つからない');
  });
  // 3D画面の浮きボタンとボトムナビを取りこぼしていないことを、数で固定する。
  assert.ok(ENTRIES.generateAiRenderPackage.length >= 3,
    '画像AIレンダーの入口が ' + ENTRIES.generateAiRenderPackage.length + ' 個しか見えていない');
});

// ── 7. 本題: どの幅でも、どの機能も、入口が1つ以上ある ────────────────────
function sweep(coarse) {
  const zero = [];
  for (let w = 320; w <= 1400; w += 4) {
    const env = { width: w, coarse: coarse };
    // #sidebar の中だけが入口の場合、その開き口（ツール）自体が出ていること。
    Object.keys(FEATURES).forEach((fn) => {
      const live = ENTRIES[fn].filter((n) => {
        if (!isRendered(n, env)) return false;
        if (ancestorIds(n).indexOf('sidebar') >= 0) {
          // サイドバーが画面に出ていれば据え置き。スマホのように画面外へ
          // 逃がされているなら、それを引き出す開き口が生きている必要がある。
          const sb = TREE.all.find((x) => x.id === 'sidebar');
          if (sb && isRendered(sb, env) && !isOffCanvas(sb, env)) return true;
          return TREE.all.some((x) =>
            (x.id === 'bnav-tools' || x.id === 'mob-menu-btn') && isRendered(x, env));
        }
        return true;
      });
      if (live.length === 0) zero.push({ w: w, fn: fn });
    });
  }
  return zero;
}

test('320〜1400px のどの幅でも、どの機能も入口がゼロにならない（マウス）', () => {
  const zero = sweep(false);
  const msg = zero.slice(0, 12).map((z) => FEATURES[z.fn] + '@' + z.w + 'px').join(', ');
  assert.equal(zero.length, 0, '入口ゼロの幅がある: ' + msg);
});

test('320〜1400px のどの幅でも、どの機能も入口がゼロにならない（タッチ）', () => {
  const zero = sweep(true);
  const msg = zero.slice(0, 12).map((z) => FEATURES[z.fn] + '@' + z.w + 'px').join(', ');
  assert.equal(zero.length, 0, '入口ゼロの幅がある: ' + msg);
});

test('768px の境目の両側で、画像AIと動画AIの入口が入れ替わる（片側だけにしない）', () => {
  [{ w: 768, want: 'bnav' }, { w: 772, want: 'toolbar' }].forEach((c) => {
    const env = { width: c.w, coarse: false };
    ['generateAiRenderPackage', 'openVideoRenderDialog'].forEach((fn) => {
      const live = ENTRIES[fn].filter((n) => isRendered(n, env));
      assert.ok(live.length > 0, FEATURES[fn] + ' が ' + c.w + 'px で消えている');
      const ids = live.map((n) => ancestorIds(n).join('/'));
      const hit = c.want === 'bnav'
        ? ids.some((s) => s.indexOf('bottom-nav') >= 0)
        : ids.some((s) => s.indexOf('toolbar') >= 0);
      assert.ok(hit, FEATURES[fn] + ' の ' + c.w + 'px での入口が ' + c.want + ' に無い: ' + ids.join(' , '));
    });
  });
});

test('評価器が知らないメディア特性の上に display を載せていない', () => {
  // 上の掃引で当たったルールだけを見る。未知の特性は false 扱いなので、
  // そこに display が乗っていると見落としになる。
  const known = /^\(?\s*(max-width|min-width|pointer)\s*:/;
  const risky = RULES.filter((r) => r.decls.display && r.media &&
    r.media.split(',').some((c) => c.split(/\s+and\s+/i).some((f) => !known.test(f.trim()))));
  const names = risky.map((r) => r.media + ' { ' + r.selector + ' }');
  assert.deepEqual(names.filter((n) => /mob-hide|bottom-nav|mobile-only|mobile-data|unity-render|video-render|bnav|toolbar|sidebar/.test(n)), [],
    '入口に効く display が、評価器の知らないメディアクエリの下にある');
});

// ── 8. Task 30: ヘッダーは「表示の切り替え」、フッターは「操作」 ───────────
// 役割の分担そのものを見る。どこに何を置いたかを文字列で探すのではなく、
// 「その器の中に、その機能を呼ぶ onclick を持つ要素があるか」を要素ツリーから
// 数える。ボタンを別の器へ移せば、対応するテストが必ず動く。
const HEADER = TREE.all.find((n) => n.id === 'toolbar');
const FOOTER = TREE.all.find((n) => n.id === 'bottom-nav');
const SIDEBAR = TREE.all.find((n) => n.id === 'sidebar');

function descendants(root) {
  const out = [];
  (function walk(n) { n.children.forEach((c) => { out.push(c); walk(c); }); })(root);
  return out;
}
function clickersIn(root, fn) {
  return descendants(root).filter((n) => n.onclick && n.onclick.indexOf(fn) >= 0);
}
function hasClass(node, name) {
  for (let p = node; p; p = p.parent) if (p.classes.indexOf(name) >= 0) return true;
  return false;
}
function regionOf(node) {
  const ids = ancestorIds(node);
  if (ids.indexOf('toolbar') >= 0) return 'ヘッダー';
  if (ids.indexOf('bottom-nav') >= 0) return 'フッター';
  if (ids.indexOf('sidebar') >= 0) {
    if (hasClass(node, 'common-tools-grid')) return 'ツールメニュー/共通操作';
    if (hasClass(node, 'mobile-data-tools')) return 'ツールメニュー/データ管理';
    if (hasClass(node, 'cat-body')) return 'ツールメニュー/カテゴリ';
    return 'ツールメニュー';
  }
  if (ids.indexOf('c3d-wrap') >= 0) return '3D画面の浮きボタン';
  return 'その他';
}

// ヘッダーが載せる「表示の切り替え」
const VIEW_SWITCHES = [
  ["setView('2d')", '平面図'],
  ["setViewWithLoading('3d-ext')", '外観3D'],
  ["setViewWithLoading('3d-int')", '内観3D'],
  ["setViewWithLoading('3d-walk')", 'ウォークスルー'],
  ['refresh3DPreviewWithLoading', '3D更新']
];
// フッターが載せる「操作」
const FOOTER_OPS = [
  ['toggleMobileSidebar', 'ツール'],
  ["setTool('select')", '選択'],
  ['undoAction', 'Undo'],
  ['redoAction', 'Redo'],
  ['copySelectedFromButton', 'コピー'],
  ['pasteCopiedFromButton', '貼付'],
  ['savePlanToStorage', '保存']
];

test('ヘッダーから ツール・Undo・Redo が外れている', () => {
  [['toggleMobileSidebar', 'ツール'], ['undoAction', 'Undo'], ['redoAction', 'Redo']].forEach((p) => {
    assert.equal(clickersIn(HEADER, p[0]).length, 0,
      'ヘッダーにまだ ' + p[1] + ' の入口がある');
  });
});

test('ヘッダーは表示の切り替えを全部載せている', () => {
  VIEW_SWITCHES.forEach((p) => {
    assert.ok(clickersIn(HEADER, p[0]).length > 0, 'ヘッダーに ' + p[1] + ' が無い');
  });
});

test('フッターは7つの操作を全部載せている', () => {
  FOOTER_OPS.forEach((p) => {
    assert.ok(clickersIn(FOOTER, p[0]).length > 0, 'フッターに ' + p[1] + ' が無い');
  });
});

test('フッターは表示の切り替えを持たない（そこはヘッダーの担当）', () => {
  VIEW_SWITCHES.forEach((p) => {
    assert.equal(clickersIn(FOOTER, p[0]).length, 0,
      'フッターにまだ ' + p[1] + '（表示の切り替え）がある');
  });
});

test('フッターの各項目はツールメニューの中にもある（重複は意図であって消さない）', () => {
  FOOTER_OPS.forEach((p) => {
    if (p[0] === 'toggleMobileSidebar') return; // ツールメニューを開く口そのもの
    assert.ok(clickersIn(SIDEBAR, p[0]).length > 0,
      'フッターの ' + p[1] + ' に対応する項目がツールメニューに無い（ショートカットになっていない）');
  });
});

test('共通操作のグリッドから 削除 と 寸法 が外れている', () => {
  const grid = TREE.all.filter((n) => n.classes.indexOf('common-tools-grid') >= 0);
  assert.equal(grid.length, 1, '共通操作のグリッドが1つ見つからない');
  [["setTool('erase')", '削除'], ['toggleDim', '寸法']].forEach((p) => {
    assert.equal(clickersIn(grid[0], p[0]).length, 0,
      '共通操作のグリッドにまだ ' + p[1] + ' がある');
  });
});

test('削除と寸法はツールメニューの中に残り、畳まれていない', () => {
  [["setTool('erase')", '削除'], ['toggleDim', '寸法']].forEach((p) => {
    const inMenu = clickersIn(SIDEBAR, p[0]);
    assert.ok(inMenu.length > 0, p[1] + ' がツールメニューから消えている');
    // 畳まれたカテゴリの中だと、開くまで押せない = 「スマホから押せない」の再発。
    const shown = inMenu.filter((n) => {
      const chain = [];
      for (let q = n; q; q = q.parent) chain.unshift(q);
      // サイドバー自身の開閉は別問題なので、サイドバーより内側だけを見る。
      const at = chain.indexOf(SIDEBAR);
      for (let i = at + 1; i < chain.length; i++) {
        const sub = chain.slice(0, i + 1);
        if (displayOf(sub, { width: 375, coarse: true }) === 'none') return false;
      }
      return true;
    });
    assert.ok(shown.length > 0,
      p[1] + ' はツールメニューの中にあるが、畳まれた入れ物の中にしか無い');
  });
});

// 移動した5項目の到達経路。幅ごとに「どの器から押せるか」を並べて数える。
function routesFor(fn, env) {
  return entryPointsFor(fn).filter((n) => {
    if (!isRendered(n, env)) return false;
    if (ancestorIds(n).indexOf('sidebar') >= 0 &&
        (!isRendered(SIDEBAR, env) || isOffCanvas(SIDEBAR, env))) {
      return TREE.all.some((x) => (x.id === 'bnav-tools' || x.id === 'mob-menu-btn') && isRendered(x, env));
    }
    return true;
  }).map(regionOf);
}

test('移動した5項目が、スマホ幅375pxでもデスクトップ幅1280pxでも到達できる', () => {
  const MOVED = [['toggleDim', '寸法'], ["setTool('erase')", '削除'],
                 ['undoAction', 'Undo'], ['redoAction', 'Redo']];
  [{ w: 375, coarse: true }, { w: 1280, coarse: false }].forEach((c) => {
    const env = { width: c.w, coarse: c.coarse };
    MOVED.forEach((p) => {
      const routes = routesFor(p[0], env);
      assert.ok(routes.length > 0,
        p[1] + ' に ' + c.w + 'px で到達できる経路が1つも無い');
    });
    // 「ツール」= ツールメニューそのもの。出ているか、開く口があるか。
    const menuReachable = (isRendered(SIDEBAR, env) && !isOffCanvas(SIDEBAR, env)) ||
      TREE.all.some((x) => x.id === 'bnav-tools' && isRendered(x, env));
    assert.ok(menuReachable, 'ツールメニューを ' + c.w + 'px で開けない');
  });
});
