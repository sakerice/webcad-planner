// Task 33: 画像AIレンダーと動画AIレンダーの「文字の型」と「言葉」が対であること。
//
// オーナーの指摘は「近しい機能なのにフォントサイズが違う・表記が揺れる」。
// ここで見ているのは CSS の綴りではなく、**実際に効く文字の大きさ**である。
// index.html のスタイルシートを読み、セレクタの詳細度と記述順で勝ち負けを決め、
// 2つのダイアログの中の要素それぞれについて px を1つに解決してから比べる。
//
// だから「片方のダイアログにだけ font-size を足す」と、その要素の役割の px が
// もう片方とずれて赤くなる。共通のクラス(.airx-dialog)を片方から外しても赤くなる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ══ 1. HTML を木にする ════════════════════════════════════════════════════
const VOID_TAGS = ['input', 'img', 'br', 'hr', 'meta', 'link', 'source'];
function elementAt(src, at) {
  const gt = src.indexOf('>', at);
  const raw = src.slice(at + 1, gt);
  const tag = (raw.match(/^[a-z0-9-]+/i) || [''])[0].toLowerCase();
  const attrs = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = m[2];
  if (raw.endsWith('/') || VOID_TAGS.indexOf(tag) >= 0) {
    return { tag: tag, attrs: attrs, inner: '', end: gt + 1 };
  }
  let depth = 0, i = gt + 1;
  const openRe = new RegExp('<' + tag + '(\\s|>)', 'i');
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue; }
    if (src.startsWith('</' + tag, lt)) {
      if (depth === 0) {
        return { tag: tag, attrs: attrs, inner: src.slice(gt + 1, lt), end: src.indexOf('>', lt) + 1 };
      }
      depth--;
    } else if (openRe.test(src.slice(lt, lt + tag.length + 2))) depth++;
    i = lt + 1;
  }
  throw new Error('<' + tag + '> が閉じていない');
}
function childrenOf(inner) {
  const out = [];
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt === -1) break;
    if (inner.startsWith('<!--', lt)) { i = inner.indexOf('-->', lt) + 3; continue; }
    if (inner.startsWith('</', lt)) { i = inner.indexOf('>', lt) + 1; continue; }
    const el = elementAt(inner, lt);
    out.push(el);
    i = el.end;
  }
  return out;
}
function nodeOf(el) {
  return {
    tag: el.tag,
    attrs: el.attrs,
    inner: el.inner,
    cls: (el.attrs.class || '').split(/\s+/).filter(Boolean),
    id: el.attrs.id || '',
    kids: []
  };
}
function build(el) {
  const n = nodeOf(el);
  childrenOf(el.inner).forEach((c) => n.kids.push(build(c)));
  return n;
}
function cardOf(modalId) {
  const at = html.indexOf('id="' + modalId + '"');
  assert.notEqual(at, -1, modalId + ' が無い');
  const modal = elementAt(html, html.lastIndexOf('<', at));
  const card = childrenOf(modal.inner)
    .find((c) => (c.attrs.class || '').indexOf('unity-render-card') >= 0);
  assert.ok(card, modalId + ' に .unity-render-card が無い');
  return build(card);
}
function text(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

const STILL = cardOf('unity-render-modal');
const VIDEO = cardOf('video-render-modal');
const DIALOGS = [['画像AI', STILL], ['動画AI', VIDEO]];

// ══ 2. CSS を読む ═════════════════════════════════════════════════════════
// style ブロックを全部つなげ、コメントを外し、@media を条件つきの束にする。
function styleSheets() {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  assert.ok(out.length > 0, '<style> が無い');
  return out.join('\n');
}
const css = styleSheets().replace(/\/\*[\s\S]*?\*\//g, '');

// { selector, decls, media } の平らな並びに崩す。記述順を order として持つ。
function parseRules(src, media, sink) {
  let i = 0;
  while (i < src.length) {
    const brace = src.indexOf('{', i);
    if (brace === -1) break;
    let head = src.slice(i, brace).trim();
    if (head.startsWith('@')) {
      // ブロックをまるごと取り出す
      let depth = 0, j = brace;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) break; }
      }
      const body = src.slice(brace + 1, j);
      if (/^@media/.test(head)) parseRules(body, media.concat([head.slice(6).trim()]), sink);
      i = j + 1;
      continue;
    }
    const close = src.indexOf('}', brace);
    const decls = src.slice(brace + 1, close);
    head.split(',').forEach((sel) => {
      sel = sel.trim();
      if (sel) sink.push({ sel: sel, decls: decls, media: media, order: sink.length });
    });
    i = close + 1;
  }
}
const RULES = [];
parseRules(css, [], RULES);

// ── メディアクエリ: 幅の条件だけ見る。それ以外の機能(hover 等)を含む束は、
//    どちらの幅でも「効かない」として扱う（この2つのダイアログには無い）。
function mediaApplies(conds, width) {
  return conds.every((c) => {
    const max = c.match(/max-width\s*:\s*(\d+)px/);
    const min = c.match(/min-width\s*:\s*(\d+)px/);
    if (!max && !min) return false;
    if (max && width > Number(max[1])) return false;
    if (min && width < Number(min[1])) return false;
    return true;
  });
}

// ── セレクタ照合（この2つのダイアログに出る形だけを扱う）────────────────
function parseSelector(sel) {
  if (/[\[:~+]/.test(sel)) return null;           // 擬似クラス・属性は対象外
  // '>' は独立したトークンとして書かれている前提（このファイルの CSS はそう書く）
  const toks = sel.split(/\s+/).filter(Boolean);
  const seq = [];
  for (let k = 0; k < toks.length; k++) {
    if (toks[k] === '>') { seq[seq.length - 1].direct = true; continue; }
    seq.push({ compound: toks[k], direct: false });
  }
  return seq.map((s, k) => ({
    compound: s.compound,
    // 直前のトークンが '>' だったかは、次の要素の direct に入っている
    direct: k > 0 ? seq[k - 1].direct : false
  }));
}
function compoundMatches(c, node) {
  const tag = (c.match(/^[a-z0-9-]+/i) || [null])[0];
  if (tag && tag !== node.tag) return false;
  const ids = c.match(/#[A-Za-z0-9_-]+/g) || [];
  for (const id of ids) if (node.id !== id.slice(1)) return false;
  const cls = c.match(/\.[A-Za-z0-9_-]+/g) || [];
  for (const k of cls) if (node.cls.indexOf(k.slice(1)) < 0) return false;
  return true;
}
// path: [祖先..., 自分]
function selectorMatches(seq, path) {
  let pi = path.length - 1;
  let si = seq.length - 1;
  if (!compoundMatches(seq[si].compound, path[pi])) return false;
  si--; pi--;
  while (si >= 0) {
    const direct = seq[si + 1].direct;
    if (direct) {
      if (pi < 0 || !compoundMatches(seq[si].compound, path[pi])) return false;
      si--; pi--;
    } else {
      let hit = -1;
      for (let k = pi; k >= 0; k--) {
        if (compoundMatches(seq[si].compound, path[k])) { hit = k; break; }
      }
      if (hit < 0) return false;
      pi = hit - 1; si--;
    }
  }
  return true;
}
function specificity(sel) {
  const ids = (sel.match(/#[A-Za-z0-9_-]+/g) || []).length;
  const cls = (sel.match(/\.[A-Za-z0-9_-]+/g) || []).length;
  const tags = (sel.match(/(^|[\s>])[a-z][a-z0-9-]*/g) || []).length;
  return ids * 10000 + cls * 100 + tags;
}
function declOf(decls, prop) {
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;}]+)', 'i');
  const m = decls.match(re);
  return m ? m[1].trim() : null;
}

// 共通の型が持つ4段階（.airx-dialog の宣言から読む）
const SCALE_RULE = RULES.find((r) => r.sel === '.airx-dialog' && /--airx-fs-/.test(r.decls));
const TIERS = {};
if (SCALE_RULE) {
  const re = /--airx-fs-([a-z]+)\s*:\s*([0-9.]+)px/g;
  let m;
  while ((m = re.exec(SCALE_RULE.decls))) TIERS[m[1]] = Number(m[2]);
}

function resolveValue(raw) {
  if (!raw) return null;
  const v = raw.replace(/!important/i, '').trim();
  const varm = v.match(/^var\(\s*--airx-fs-([a-z]+)\s*\)$/);
  if (varm) return TIERS[varm[1]] === undefined ? null : TIERS[varm[1]];
  const px = v.match(/^([0-9.]+)px$/);
  return px ? Number(px[1]) : null;
}

// path の末尾の要素に効く font-size を返す（無ければ null＝親から継承）
function ownFontSize(path, width) {
  let best = null;
  RULES.forEach((r) => {
    if (!mediaApplies(r.media, width)) return;
    const raw = declOf(r.decls, 'font-size');
    if (raw === null) return;
    const seq = parseSelector(r.sel);
    if (!seq) return;
    if (!selectorMatches(seq, path)) return;
    const important = /!important/i.test(raw);
    const rank = [important ? 1 : 0, specificity(r.sel), r.order];
    if (!best || rank[0] > best.rank[0] ||
        (rank[0] === best.rank[0] && rank[1] > best.rank[1]) ||
        (rank[0] === best.rank[0] && rank[1] === best.rank[1] && rank[2] > best.rank[2])) {
      best = { rank: rank, value: resolveValue(raw), raw: raw, sel: r.sel };
    }
  });
  return best;
}

// body の font-size（カードはここから継承する）
function bodyFontSize(width) {
  const b = ownFontSize([{ tag: 'body', cls: [], id: '' }], width);
  return b && b.value ? b.value : 16;   // ブラウザ既定
}

// ダイアログの中の全要素に、効いている px を付けて返す
function resolvedElements(card, width) {
  const out = [];
  const base = bodyFontSize(width);
  (function walk(node, path, inherited) {
    const p = path.concat([node]);
    const own = ownFontSize(p, width);
    const size = own && own.value !== null ? own.value : inherited;
    if (own && own.value === null) {
      throw new Error('font-size を px に解決できない: ' + own.sel + ' → ' + own.raw);
    }
    out.push({ node: node, path: p, size: size, own: own });
    node.kids.forEach((k) => walk(k, p, size));
  })(card, [{ tag: 'body', cls: [], id: '' }], base);
  return out;
}

// ══ 3. 役割 ═══════════════════════════════════════════════════════════════
// クラス名の綴りではなく「画面で何をしている文字か」で束ねる。
function roleOf(e) {
  const n = e.node;
  const has = (c) => n.cls.indexOf(c) >= 0;
  const under = (c) => e.path.some((p) => p.cls && p.cls.indexOf(c) >= 0 && p !== n);
  if (has('unity-render-title')) return 'ダイアログの題';
  if (has('ph')) return '節の見出し';
  if (has('unity-render-close')) return '閉じるボタン';
  if (has('unity-render-status')) return '説明・状態表示';
  if (has('airx-source-note')) return '説明・状態表示';
  if (has('unity-render-cmd')) return '使い方・ファイル一覧';
  if (has('airx-check')) return 'チェックの行';
  if (has('pbtn')) return 'ボタン';
  if (n.tag === 'small') return '補助文';
  if (n.tag === 'label') return '設定項目の名前';
  if (n.tag === 'textarea' || n.tag === 'select') return '操作';
  if (n.tag === 'input' && ['text', 'range'].indexOf(n.attrs.type) >= 0) return '操作';
  if (n.tag === 'span' && under('ai-package-shot')) return 'プレビューの見出し';
  return null;
}
function roleSizes(card, width) {
  const map = {};
  resolvedElements(card, width).forEach((e) => {
    const r = roleOf(e);
    if (!r) return;
    (map[r] = map[r] || new Set()).add(e.size);
  });
  return map;
}

const WIDTHS = [['スマホ幅375px', 375], ['デスクトップ幅1280px', 1280]];

// ══ 4. 検査 ═══════════════════════════════════════════════════════════════

test('2つのダイアログが同じ共通クラス .airx-dialog を持っている', () => {
  DIALOGS.forEach(([name, card]) => {
    assert.ok(card.cls.indexOf('airx-dialog') >= 0,
      name + ' のカードに airx-dialog が無い（片方だけ共通の型から外れている）');
  });
});

test('文字サイズの段階は4つだけで、1か所(.airx-dialog)にまとまっている', () => {
  assert.ok(SCALE_RULE, '.airx-dialog に共通の型の宣言が無い');
  assert.deepEqual(Object.keys(TIERS).sort(), ['body', 'heading', 'help', 'label'],
    '4段階(heading/body/label/help)が揃っていない: ' + JSON.stringify(TIERS));
  const vals = Object.keys(TIERS).map((k) => TIERS[k]);
  assert.equal(new Set(vals).size, 4, '4段階の値が重なっている: ' + JSON.stringify(TIERS));
  assert.ok(TIERS.heading > TIERS.body && TIERS.body > TIERS.label && TIERS.label > TIERS.help,
    '見出し > 本文 > ラベル > 補助文 の順になっていない: ' + JSON.stringify(TIERS));
  // .airx-dialog に書かれた変数以外の font-size 宣言が紛れていないこと
  assert.equal(declOf(SCALE_RULE.decls, 'font-size'), null,
    '共通の型のブロックが自分で font-size を持っている');
});

test('ダイアログの中にインラインの font-size が無い', () => {
  [['unity-render-modal'], ['video-render-modal']].forEach(([id]) => {
    const at = html.indexOf('id="' + id + '"');
    const modal = elementAt(html, html.lastIndexOf('<', at));
    assert.equal(/style="[^"]*font-size/i.test(modal.inner), false,
      id + ' の中に style="...font-size..." が残っている');
  });
});

test('ダイアログ向けの CSS が font-size を直書きしていない（共通の型の変数だけ）', () => {
  const DIALOG_CLASSES = [
    'airx-dialog', 'airx-check', 'unity-render-card', 'unity-render-head', 'unity-render-title',
    'unity-render-close', 'unity-render-status', 'unity-render-cmd', 'unity-render-config',
    'unity-render-actions', 'unity-render-img', 'ai-style-field',
    'ai-instructions-preview', 'ai-instruction-actions', 'ai-package-preview', 'ai-package-shot',
    'airx-field', 'airx-source-note', 'video-render-files'
  ];
  const bad = [];
  RULES.forEach((r) => {
    const raw = declOf(r.decls, 'font-size');
    if (raw === null) return;
    if (!DIALOG_CLASSES.some((c) => r.sel.indexOf('.' + c) >= 0)) return;
    if (!/^var\(\s*--airx-fs-/.test(raw.replace(/!important/i, '').trim())) {
      bad.push(r.sel + ' { font-size:' + raw + ' }');
    }
  });
  assert.deepEqual(bad, [],
    'ダイアログのクラスに直接 font-size が書かれている（共通の型の外で決めている）');
});

test('ダイアログの文字は、どれも4段階のどれかに乗っている', () => {
  const allowed = new Set(Object.keys(TIERS).map((k) => TIERS[k]));
  WIDTHS.forEach(([wname, w]) => {
    DIALOGS.forEach(([name, card]) => {
      resolvedElements(card, w).forEach((e) => {
        if (!roleOf(e)) return;
        assert.ok(allowed.has(e.size),
          wname + ' / ' + name + ': <' + e.node.tag + ' class="' + e.node.cls.join(' ') +
          '"> が ' + e.size + 'px（4段階の外）');
      });
    });
  });
});

// これが「片方だけ直すと赤くなる」本体。
test('同じ役割の文字は、2つのダイアログで同じ大きさである', () => {
  WIDTHS.forEach(([wname, w]) => {
    const a = roleSizes(STILL, w);
    const b = roleSizes(VIDEO, w);
    const shared = Object.keys(a).filter((k) => b[k]);
    assert.ok(shared.length >= 8,
      wname + ': 見比べられる役割が少なすぎる（抽出が壊れている）: ' + shared.join(','));
    shared.forEach((role) => {
      const av = Array.from(a[role]).sort();
      const bv = Array.from(b[role]).sort();
      assert.deepEqual(av, bv,
        wname + ' の「' + role + '」: 画像AI ' + av.join('/') + 'px と ' +
        '動画AI ' + bv.join('/') + 'px が違う');
    });
  });
});

test('ひとつの役割の中で大きさがばらけていない（同じ役割は1つの大きさ）', () => {
  WIDTHS.forEach(([wname, w]) => {
    DIALOGS.forEach(([name, card]) => {
      const map = roleSizes(card, w);
      Object.keys(map).forEach((role) => {
        assert.equal(map[role].size, 1,
          wname + ' / ' + name + ' の「' + role + '」が ' +
          Array.from(map[role]).join('/') + 'px に割れている');
      });
    });
  });
});

test('スマホ幅とデスクトップ幅で、2つのダイアログの型が同じようにふるまう', () => {
  // 片方のダイアログにだけスマホ用の上書きを足すと、ここで差が出る。
  const sig = (card, w) => {
    const map = roleSizes(card, w);
    return Object.keys(map).sort().map((k) => k + '=' + Array.from(map[k]).join('/')).join(' ');
  };
  const stillPhone = sig(STILL, 375), stillDesk = sig(STILL, 1280);
  const videoPhone = sig(VIDEO, 375), videoDesk = sig(VIDEO, 1280);
  const roles = (s) => s.split(' ').map((x) => x.split('=')[0]);
  // 幅が変わっても、役割ごとの大きさは2つのダイアログで揃ったまま
  roles(stillPhone).filter((r) => roles(videoPhone).indexOf(r) >= 0).forEach((r) => {
    const pick = (s) => s.split(' ').find((x) => x.startsWith(r + '='));
    assert.equal(pick(stillPhone), pick(videoPhone), 'スマホ幅で ' + r + ' がずれている');
    assert.equal(pick(stillDesk), pick(videoDesk), 'デスクトップ幅で ' + r + ' がずれている');
  });
});

// ══ 5. 言葉 ═══════════════════════════════════════════════════════════════
// 「同じものを同じ語で呼ぶ」。片方のダイアログだけ古い語に戻すと赤くなる。
const DIALOG_TEXT = {
  '画像AI': text(STILL.inner) + ' ' + (STILL.inner.match(/placeholder="([^"]*)"/g) || []).join(' '),
  '動画AI': text(VIDEO.inner) + ' ' + (VIDEO.inner.match(/placeholder="([^"]*)"/g) || []).join(' ')
};

// 語彙表: 何を指す語か → 決めた1語 / 使ってはいけない揺れ
const GLOSSARY = [
  { what: '書き出す一式',       keep: 'データ',       ban: ['一式', '制御パッケージ'] },
  { what: 'ZIPの保存',          keep: 'ZIP',          ban: ['一括DL', '一括ＤＬ'] },
  { what: '制御用の画像',       keep: 'ガイド画像',   ban: ['制御画像', '詳細ガイド'] },
  { what: 'セグメント画像',     keep: 'セグメント',   ban: ['カテゴリ画像', 'カテゴリと部材ID'] },
  { what: '部材ID画像',         keep: '部材ID',       ban: ['インスタンス画像', 'インスタンスID画像'] },
  { what: 'いま映っている画面', keep: 'いま見ている', ban: ['現在見ている'] },
  { what: '同梱',               keep: '含める',       ban: ['同梱'] },
  { what: '設計を保つ',         keep: '形を変えない', ban: ['間取りを保つ', '間取りを変えず', '建物の形'] }
];

test('2つのダイアログが、同じものを同じ語で呼んでいる', () => {
  const found = [];
  Object.keys(DIALOG_TEXT).forEach((name) => {
    GLOSSARY.forEach((g) => {
      g.ban.forEach((b) => {
        if (b && DIALOG_TEXT[name].indexOf(b) >= 0) {
          found.push(name + ': 「' + b + '」（' + g.what + ' は「' + g.keep + '」に決めた）');
        }
      });
    });
  });
  assert.deepEqual(found, [], '揺れた語がダイアログに残っている');
});

test('決めた語のほうは、ちゃんと画面に出ている', () => {
  // 片方から語ごと消して逃げられないようにする。
  assert.ok(DIALOG_TEXT['画像AI'].indexOf('ガイド画像') >= 0, '画像AI に「ガイド画像」が無い');
  assert.ok(DIALOG_TEXT['動画AI'].indexOf('ガイド画像') >= 0, '動画AI に「ガイド画像」が無い');
  assert.ok(DIALOG_TEXT['画像AI'].indexOf('AIへの指示文') >= 0, '画像AI に「AIへの指示文」が無い');
  assert.ok(DIALOG_TEXT['動画AI'].indexOf('AIへの指示文') >= 0, '動画AI に「AIへの指示文」が無い');
  assert.ok(DIALOG_TEXT['画像AI'].indexOf('いま見ている') >= 0, '画像AI に「いま見ている」が無い');
  assert.ok(DIALOG_TEXT['動画AI'].indexOf('いま見ている') >= 0, '動画AI に「いま見ている」が無い');
});

test('出力欄の言い出しが2つのダイアログで揃っている', () => {
  // どちらも先頭は「AIへの指示文」の欄で、同じ文言で待っている。
  const still = (STILL.inner.match(/id="ai-instructions-preview"[^>]*placeholder="([^"]*)"/) || [])[1] || '';
  const video = (VIDEO.inner.match(/id="video-instructions-preview"[^>]*placeholder="([^"]*)"/) || [])[1] || '';
  assert.match(still, /^作ると、.*がここに出ます。$/, '画像AI の出力欄: ' + still);
  assert.equal(video, still, '2つのダイアログで待ち受けの文が違う');
});

test('画面に出る言葉から、旧称・略語が消えている（index.html 全体）', () => {
  ['一括DL', '詳細ガイド', '制御パッケージ', '制御画像', 'インスタンスID画像']
    .forEach((w) => {
      assert.equal(html.indexOf(w), -1, '「' + w + '」が index.html に残っている');
    });
});

test('作る／作成する／生成する が混ざっていない（2つのダイアログの状態表示）', () => {
  // setUnityRenderStatus / setVideoRenderStatus に渡している文字列のうち、
  // この2機能のものだけを見る（Unity レンダーサーバーの旧機能は対象外）。
  function statusStringsIn(fnName) {
    const at = html.indexOf('function ' + fnName + '(');
    assert.notEqual(at, -1, fnName + ' が無い');
    let depth = 0, i = html.indexOf('{', at), end = i;
    for (; end < html.length; end++) {
      if (html[end] === '{') depth++;
      else if (html[end] === '}') { depth--; if (depth === 0) break; }
    }
    const body = html.slice(at, end);
    const out = [];
    const re = /set(?:Unity|Video)RenderStatus\(([\s\S]*?)\);/g;
    let m;
    while ((m = re.exec(body))) out.push(m[1]);
    return out.join('\n');
  }
  const bodies = ['generateAiRenderPackage', 'downloadAiRenderBundle', 'runVideoRenderPackage',
    'handleAiDownloadLinkClick', 'copyAiRenderPrompt', 'downloadAiRenderPrompt']
    .map(statusStringsIn).join('\n');
  ['作成しています', '作成しました', '生成しました', '生成しています', '生成に失敗']
    .forEach((w) => {
      assert.equal(bodies.indexOf(w), -1,
        '状態表示に「' + w + '」が残っている（動詞は「作る」に決めた）');
    });
  assert.ok(bodies.indexOf('作っています') >= 0, '「作っています」が使われていない');
});

// ══ 7. 並び順 ═════════════════════════════════════════════════════════════
// 「レイアウト順が違う」というオーナーの指摘に対する固定。文字サイズを揃えても
// 並びが違えば同じ画面には見えない。ここでは2つのダイアログを同じ言葉に
// 潰してから、順序そのものを比べる。
//
// 動画にしか無いもの（尺・ガイド画像の同梱）は片側に足されるが、それ以外は
// 1つも増えず、順序も入れ替わらないこと。
function shapeOf(card) {
  const out = [];
  const re = /<(div|label|select|input|textarea|button|a|img)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(card.inner))) {
    const tag = m[1], attrs = m[2];
    const id = (attrs.match(/id="([^"]*)"/) || [])[1] || '';
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    if (/\bph\b/.test(cls)) {
      const at = card.inner.indexOf('>', m.index) + 1;
      out.push('見出し:' + card.inner.slice(at, card.inner.indexOf('<', at)).trim());
    } else if (/airx-source-note/.test(cls)) out.push('参照の説明');
    else if (/unity-render-status/.test(cls)) out.push('説明・状態');
    else if (/unity-render-title/.test(cls)) out.push('題');
    else if (/unity-render-close/.test(cls)) out.push('閉じる');
    else if (/ai-instructions-preview/.test(cls)) out.push('指示文の欄');
    else if (/unity-render-img/.test(cls)) out.push('参照画像');
    else if (/ai-package-preview/.test(cls)) out.push('プレビュー一覧');
    else if (/unity-render-cmd/.test(cls)) out.push('使い方');
    else if (/airx-check/.test(cls)) out.push('チェックの行');
    else if (tag === 'label') out.push('設定の名前');
    else if (tag === 'select') out.push('選択');
    else if (tag === 'input' && /type="text"/.test(attrs)) out.push('入力');
    else if (tag === 'input' && /type="range"/.test(attrs)) out.push('スライダ');
    else if (tag === 'button' && /pbtn/.test(cls)) out.push('ボタン:' + (/copy|Copy/.test(attrs) ? 'コピー' : '作る'));
    else if (tag === 'a' && /pbtn/.test(cls)) out.push('保存:' + id.replace(/^(ai|video)-dl-/, ''));
  }
  return out;
}

test('2つのダイアログの並びが同じ（動画だけの設定を除いて）', () => {
  const still = shapeOf(STILL);
  // 動画にしか無いのは「尺」と「ガイド画像を含める」の2項目。ここだけ取り除く。
  const video = shapeOf(VIDEO);
  const durAt = video.indexOf('スライダ');
  assert.notEqual(durAt, -1, '尺のスライダが動画側に無い');
  video.splice(durAt - 1, 2);                       // 設定の名前 + スライダ
  const checkAt = video.indexOf('チェックの行');
  assert.notEqual(checkAt, -1, 'ガイド画像のチェックが動画側に無い');
  video.splice(checkAt, 1);

  // 保存ボタンの顔ぶれは生成物の都合で違う（画像はガイド6枚、動画は参照1枚）。
  // ここで比べるのは「どの位置に保存ボタンの塊が来るか」なので、塊に潰す。
  const fold = (a) => a.reduce((acc, v) => {
    if (v.indexOf('保存:') === 0) { if (acc[acc.length - 1] !== '保存ボタン群') acc.push('保存ボタン群'); }
    else acc.push(v);
    return acc;
  }, []);

  assert.deepEqual(fold(video), fold(still));
});

test('どちらのダイアログも 設定 → データ作成 → データ出力 の順に見出しが並ぶ', () => {
  [['画像AI', STILL], ['動画AI', VIDEO]].forEach(([name, card]) => {
    const heads = shapeOf(card).filter((s) => s.indexOf('見出し:') === 0);
    assert.deepEqual(heads,
      ['見出し:この機能について', '見出し:設定', '見出し:データ作成', '見出し:データ出力'], name);
  });
});

// データ作成のボタンより後ろにしか、保存ボタンと指示文の欄は出てこないこと。
// 「押す前に出力欄が埋まっている」形に戻ると、押す意味が読めなくなる。
test('指示文の欄と保存ボタンは、作るボタンより後ろにある', () => {
  [['画像AI', STILL], ['動画AI', VIDEO]].forEach(([name, card]) => {
    const shape = shapeOf(card);
    const run = shape.indexOf('ボタン:作る');
    assert.notEqual(run, -1, name + ': 作るボタンが無い');
    assert.ok(shape.indexOf('指示文の欄') > run, name + ': 指示文の欄が作るボタンより前にある');
    assert.ok(shape.findIndex((s) => s.indexOf('保存:') === 0) > run, name + ': 保存ボタンが作るボタンより前にある');
  });
});
