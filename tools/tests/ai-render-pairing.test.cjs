// Task 29-1 / 29-3: 画像AIレンダーと動画AIレンダーが「対」に見えること。
//
// 見ているのは文字列の有無ではなく、2つのダイアログから**組み立てた節の並び**が
// 同じかどうかと、2つの機能の**呼称とアイコンの組**が対になっているかどうか。
// どちらか片方だけ直せば（節を入れ替えても、アイコンを片方だけ戻しても）赤くなる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ── 小さなパーサ: ある要素の直下の子を、順序どおりに取り出す ───────────────
function elementAt(src, at) {
  const gt = src.indexOf('>', at);
  const raw = src.slice(at + 1, gt);
  const tag = (raw.match(/^[a-z0-9-]+/i) || [''])[0].toLowerCase();
  const attrs = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = m[2];
  const selfClosing = raw.endsWith('/') ||
    ['input', 'img', 'br', 'hr', 'meta', 'link'].indexOf(tag) >= 0;
  if (selfClosing) return { tag: tag, attrs: attrs, inner: '', end: gt + 1 };
  // 同名タグの入れ子を数える
  let depth = 0, i = gt + 1;
  const openRe = new RegExp('<' + tag + '(\\s|>)', 'i');
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue; }
    const seg = src.slice(lt, lt + tag.length + 2);
    if (src.startsWith('</' + tag, lt)) {
      if (depth === 0) return { tag: tag, attrs: attrs, inner: src.slice(gt + 1, lt), end: src.indexOf('>', lt) + 1 };
      depth--;
    } else if (openRe.test(seg)) depth++;
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
function text(s) { return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

function cardOf(modalId) {
  const at = html.indexOf('id="' + modalId + '"');
  assert.notEqual(at, -1, modalId + ' が無い');
  const modal = elementAt(html, html.lastIndexOf('<', at));
  const card = childrenOf(modal.inner).find((c) => (c.attrs.class || '').indexOf('unity-render-card') >= 0);
  assert.ok(card, modalId + ' に .unity-render-card が無い');
  return card;
}

// 直下の子を「役割」の並びに写す。クラス名の綴りではなく、何のための節かを見る。
function roleSequence(card) {
  return childrenOf(card.inner).map((c) => {
    const cls = c.attrs.class || '';
    if (cls.indexOf('unity-render-head') >= 0) return 'head:' + text(c.inner).replace('×', '').trim();
    if (cls.split(/\s+/).indexOf('ph') >= 0) return 'heading:' + text(c.inner);
    if (cls.indexOf('unity-render-status') >= 0) return 'description';
    if (cls.indexOf('unity-render-config') >= 0) return 'settings';
    if (cls.indexOf('unity-render-actions') >= 0) {
      // 実行ボタンの節か、出来たものを取り出すリンクの節か。後者は出力欄の一部。
      return childrenOf(c.inner).some((b) => b.tag === 'button') ? 'run-button' : 'output';
    }
    if (cls.indexOf('ai-instructions-preview') >= 0) return 'output';
    if (cls.indexOf('ai-instruction-actions') >= 0) return 'output';
    if (cls.indexOf('unity-render-img') >= 0) return 'output';
    if (cls.indexOf('ai-package-preview') >= 0) return 'output';
    if (cls.indexOf('unity-render-cmd') >= 0) return 'output';
    return 'other:' + cls;
  });
}

const STILL = cardOf('unity-render-modal');
const VIDEO = cardOf('video-render-modal');

// ── 29-3: 節の順序が同じであること ────────────────────────────────────────
const WANT = ['この機能について', '設定', 'データ作成', 'データ出力'];

test('2つのダイアログの見出しが、同じ言葉で同じ順に並んでいる', () => {
  const heads = (card) => roleSequence(card).filter((r) => r.startsWith('heading:'))
    .map((r) => r.slice('heading:'.length));
  assert.deepEqual(heads(STILL), WANT, '画像AI側の見出しの並び');
  assert.deepEqual(heads(VIDEO), WANT, '動画AI側の見出しの並び');
});

test('見出しの下に来るものの順序が、2つのダイアログで一致している', () => {
  // 見出し → その直後に続く役割、という対応を作って比べる。
  function sections(card) {
    const out = [];
    let cur = null;
    roleSequence(card).forEach((r) => {
      if (r.startsWith('heading:')) { cur = { name: r.slice(8), body: [] }; out.push(cur); }
      else if (cur) cur.body.push(r);
    });
    return out;
  }
  const a = sections(STILL), b = sections(VIDEO);
  assert.deepEqual(a.map((s) => s.name), b.map((s) => s.name));
  a.forEach((s, i) => {
    // 同じ節には、同じ種類のものが同じ順で入っている（数は違ってよい）。
    const uniq = (xs) => xs.filter((x, k) => xs.indexOf(x) === k);
    assert.deepEqual(uniq(s.body), uniq(b[i].body), s.name + ' の中身の種類と順序');
  });
});

test('「データ作成」の実行ボタンは、出力欄より前にある（両方とも）', () => {
  [['画像AI', STILL], ['動画AI', VIDEO]].forEach(([name, card]) => {
    const seq = roleSequence(card);
    const run = seq.indexOf('run-button');
    const firstOut = seq.indexOf('output');
    assert.ok(run >= 0, name + ' に実行ボタンの節が無い');
    assert.ok(firstOut >= 0, name + ' に出力欄が無い');
    assert.ok(run < firstOut, name + ' の実行ボタンが出力欄より後ろにある');
    assert.ok(seq.indexOf('settings') < run, name + ' の設定が実行ボタンより後ろにある');
    assert.ok(seq.indexOf('description') < seq.indexOf('settings'), name + ' の説明が設定より後ろにある');
  });
});

test('実行ボタンの文言が対になっている', () => {
  const label = (card) => {
    const node = childrenOf(card.inner)
      .find((c) => (c.attrs.class || '').indexOf('unity-render-actions') >= 0 &&
        childrenOf(c.inner).some((b) => b.tag === 'button'));
    return text(childrenOf(node.inner).find((b) => b.tag === 'button').inner);
  };
  assert.equal(label(STILL), '画像AI用データを作る');
  assert.equal(label(VIDEO), '動画AI用データを作る');
});

test('ダイアログの題が対になっている', () => {
  const title = (card) => text(childrenOf(childrenOf(card.inner)
    .find((c) => (c.attrs.class || '').indexOf('unity-render-head') >= 0).inner)
    .find((c) => (c.attrs.class || '').indexOf('unity-render-title') >= 0).inner);
  assert.equal(title(STILL), '画像AI用データ');
  assert.equal(title(VIDEO), '動画AI用データ');
});

// ── 29-1: 呼称とアイコン ──────────────────────────────────────────────────
// index.html のボタンを onclick から拾い、そのラベルの先頭の絵文字と本文を見る。
function buttonsCalling(fn) {
  const out = [];
  const re = /<(button|div|a)\b[^>]*onclick="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2].indexOf(fn) < 0) continue;
    const el = elementAt(html, m.index);
    out.push({ attrs: el.attrs, label: text(el.inner) });
  }
  return out;
}
const VIDEO_ICONS = ['🎥', '🎬', '📹', '📽', '🎞'];
const STILL_ENTRIES = buttonsCalling('generateAiRenderPackage')
  .filter((b) => (b.attrs.id || '') !== '' || true);

test('画像AI側のアイコンは、動画のアイコンではない', () => {
  const iconOf = (label) => Array.from(label)[0];
  const still = buttonsCalling('generateAiRenderPackage')
    .filter((b) => ['unity-render-toolbar-btn', 'unity-render-fab', 'bnav-ai'].indexOf(b.attrs.id) >= 0);
  assert.equal(still.length, 3, '画像AIの入口が3つ揃っていない: ' + still.map((s) => s.attrs.id));
  const icons = still.map((b) => iconOf(b.label));
  icons.forEach((ic, i) => {
    assert.ok(VIDEO_ICONS.indexOf(ic) < 0,
      still[i].attrs.id + ' のアイコン ' + ic + ' は動画のアイコンである');
  });
  assert.equal(new Set(icons).size, 1, '画像AIの3つの入口でアイコンが揃っていない: ' + icons.join(' '));
});

test('動画AI側のアイコンは動画のまま、画像側と別のものである', () => {
  const iconOf = (label) => Array.from(label)[0];
  const video = buttonsCalling('openVideoRenderDialog')
    .filter((b) => ['video-render-toolbar-btn', 'bnav-video'].indexOf(b.attrs.id) >= 0);
  assert.equal(video.length, 2, '動画AIの入口が2つ揃っていない');
  const vIcons = video.map((b) => iconOf(b.label));
  assert.equal(new Set(vIcons).size, 1, '動画AIの入口でアイコンが揃っていない: ' + vIcons.join(' '));
  assert.ok(VIDEO_ICONS.indexOf(vIcons[0]) >= 0, '動画側が動画のアイコンでない: ' + vIcons[0]);
  const stillIcon = iconOf(buttonsCalling('generateAiRenderPackage')
    .find((b) => b.attrs.id === 'unity-render-toolbar-btn').label);
  assert.notEqual(stillIcon, vIcons[0], '2つの機能が同じアイコンを使っている');
});

test('ツールバーの呼称が「画像AIレンダー」「動画AIレンダー」で対になっている', () => {
  const byId = (id) => [].concat(buttonsCalling('generateAiRenderPackage'),
    buttonsCalling('openVideoRenderDialog')).find((b) => b.attrs.id === id);
  const still = byId('unity-render-toolbar-btn').label;
  const video = byId('video-render-toolbar-btn').label;
  assert.match(still, /画像AIレンダー$/, 'ツールバー(画像): ' + still);
  assert.match(video, /動画AIレンダー$/, 'ツールバー(動画): ' + video);
  // 3D画面の浮きボタンも同じ呼称にする（片方だけ古い名前を残さない）。
  assert.match(byId('unity-render-fab').label, /画像AIレンダー$/);
});

test('旧称「AI高品質化用データ」は画面のどこにも残っていない', () => {
  assert.equal(html.indexOf('AI高品質化用データ'), -1);
});

test('入口の抽出が壊れていない（3つ拾えている）', () => {
  assert.ok(STILL_ENTRIES.length >= 3);
});
