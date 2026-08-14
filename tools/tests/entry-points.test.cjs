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
  // Task 32: 画像AIの入口はダイアログを開くだけ（生成はダイアログの中のボタン）
  openUnityRenderModal: '画像AIレンダー',
  openVideoRenderDialog: '動画AIレンダー',
  openJisDrawingDialog: 'JIS図面'
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

test('入口の抽出そのものが機能している（12機能すべてにボタンが見つかる）', () => {
  Object.keys(FEATURES).forEach((fn) => {
    assert.ok(ENTRIES[fn].length > 0, FEATURES[fn] + ' のボタンが1つも見つからない');
  });
  // 画像AIレンダーはヘッダーと3D画面の浮きボタンの2つ。どちらも取りこぼして
  // いないことを、id で固定する（ボトムナビからは外れた）。
  const stillIds = ENTRIES.openUnityRenderModal.map((n) => n.id).filter(Boolean);
  ['unity-render-toolbar-btn', 'unity-render-fab'].forEach((id) => {
    assert.ok(stillIds.indexOf(id) >= 0, '画像AIレンダーの入口 ' + id + ' が見えていない');
  });
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
          const opener = TREE.all.filter((x) =>
            x.id === 'bnav-tools' || x.id === 'mob-menu-btn' || x.id === 'sidebar');
          // サイドバー自身が出ていれば据え置き、隠れていれば開き口が要る。
          const sb = opener.find((x) => x.id === 'sidebar');
          if (sb && isRendered(sb, env)) return true;
          return opener.some((x) => x.id !== 'sidebar' && isRendered(x, env));
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

// 画像AI/動画AIの入口はヘッダーが持ち、狭い幅でも消えない（mob-hide を外した）。
// ボトムナビ側の入口は外れたので、768px の境目で入れ替わるのではなく、
// 両側で同じヘッダーの入口が生きていることを見る。
test('768px の境目の両側で、画像AIと動画AIの入口がヘッダーに残っている', () => {
  [768, 772].forEach((w) => {
    const env = { width: w, coarse: false };
    ['openUnityRenderModal', 'openVideoRenderDialog'].forEach((fn) => {
      const live = ENTRIES[fn].filter((n) => isRendered(n, env));
      assert.ok(live.length > 0, FEATURES[fn] + ' が ' + w + 'px で消えている');
      const ids = live.map((n) => ancestorIds(n).join('/'));
      assert.ok(ids.some((s) => s.indexOf('toolbar') >= 0),
        FEATURES[fn] + ' の ' + w + 'px での入口がヘッダーに無い: ' + ids.join(' , '));
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

// 3Dビュー内の浮きボタンは position:absolute、スマホのツールバーは position:fixed で
// 画面上部 8〜60px を覆う。top を 18px にしていたため完全に下敷きになり、
// その点をタップしてもツールバーが拾ってボタンには届かなかった（375px で実測）。
// z-index では解決しない（ツールバーは不透明で上に乗る）ので、位置で避ける。
test('3Dの浮きボタンは、固定ツールバーの下端より下から始まる', () => {
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>', html.lastIndexOf('<style')));
  // ツールバーの高さ（スマホ）
  const tb = /#toolbar\{[^}]*min-height:(\d+)px/.exec(css);
  assert.ok(tb, '#toolbar の min-height が読めない');
  const toolbarBottom = Number(tb[1]) + 16; // 上下の余白ぶんを見込む
  // 浮きボタンの top のうち、最後に効くもの
  const tops = [...css.matchAll(/#unity-render-fab\{[^}]*?top:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(tops.length, '#unity-render-fab の top が読めない');
  const effective = tops[tops.length - 1];
  assert.ok(effective >= toolbarBottom,
    'top:' + effective + 'px はツールバー(下端およそ' + toolbarBottom + 'px)に潜る');
});
