// 取り込み後の「おすすめの家具」カードを、実際のブラウザで動かす。
//
// なぜ在るのか
// ------------
// 以前の版は「この間取りに足りないもの（93件）」をサイドバーに直に生やし、
// 札を押すとその場で道具にしていた。実機で見て取り下げた:
//   - 板が無く、図に重なって読めない
//   - 置く導線をカタログの外に作り直していた
//   - 93件は選べない
// ここが落ちると、そのどれかに戻ったことになる。
//
// AIは呼ばない。PlanFinish.mount に、読み取りのあとと同じ形の結果を渡す。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();

// 実物の平屋の読み取りに近い形。取り込みが自分で置く設備(浴槽)と、
// 何か分からないもの(other)と、カタログに欄の無い分類も混ぜる。
const RESULT = {
  reads: [
    { kind: 'bed', room: '子ども室①' }, { kind: 'bed', room: '子ども室②' }, { kind: 'bed', room: '主寝室' },
    { kind: 'chair', room: 'LDK' }, { kind: 'chair', room: 'LDK' }, { kind: 'chair', room: 'LDK' },
    { kind: 'sofa', room: 'LDK' },
    // 室名が長い行。1行に収めると、列ごと広がって × を押し出した(実物の平屋)
    { kind: 'desk', room: 'ファミリークローゼット' }, { kind: 'desk', room: '子ども室①' },
    { kind: 'desk', room: '子ども室②' }, { kind: 'desk', room: 'ウォークインクローゼット' },
    { kind: 'bathtub', room: '浴室' },
    { kind: 'other', room: 'LDK' },
    { kind: 'no-such-kind', room: 'LDK' },
  ],
};

async function open(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.ST && window.DATA && window.PlanFinish, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.evaluate(() => { if (typeof chooseBlankPlan === 'function') chooseBlankPlan(); });
  // カタログの欄が組み上がるまで待つ(マニフェストは後から読まれる)
  await page.waitForFunction(() => document.querySelector('#sidebar .asset-subcat[data-kind="bed"]'), null,
    { polling: 200, timeout: 60000 });
  return { page, errors };
}

try {
  // ── デスクトップ ───────────────────────────────────────────────
  {
    const { page, errors } = await open({ width: 1280, height: 900 });
    const itemsBefore = await page.evaluate(() => DATA.items.length);
    await page.evaluate((r) => PlanFinish.mount(r), RESULT);

    const card = page.locator('#plan-recommend');
    assert.equal(await card.count(), 1, 'カードが出ていない');

    // 板に載っている(検索の欄と同じ)
    const look = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
    });
    assert.equal(look.bg, 'rgb(255, 255, 255)', '板(白い面)が無い');
    assert.equal(look.radius, '20px', '検索の欄と角の丸みが違う');

    // 置き場所: 検索の欄の下、カタログの前
    const order = await page.evaluate(() => {
      const card = document.getElementById('plan-recommend');
      const search = document.getElementById('object-search');
      const firstCat = document.querySelector('#sidebar > .cat-hdr');
      return {
        afterSearch: !!(search.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
        beforeCatalogue: !!(card.compareDocumentPosition(firstCat) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    assert.ok(order.afterSearch && order.beforeCatalogue, 'カードが検索とカタログの間に無い');

    // 並び: 図面にあったものだけ。部屋を形づくる家具から(ソファ・椅子・ベッドの順)。
    // 設備・分からないもの・欄の無いものは出さない
    const kinds = await page.$$eval('#plan-recommend .plan-recommend-item', (els) => els.map((e) => e.dataset.kind));
    assert.deepEqual(kinds, ['sofa', 'chair', 'desk', 'bed'], '並びが知識の表の順になっていない');
    for (const k of ['bathtub', 'other', 'no-such-kind']) assert.ok(!kinds.includes(k), `${k} を出している`);
    const where = await page.locator('#plan-recommend [data-kind="bed"] .plan-recommend-where').textContent();
    assert.match(where, /3点/);
    assert.match(where, /主寝室/);
    // 室名は1行に収める(語の途中で折り返さない)。全部は title で分かる
    const line = await page.evaluate(() => {
      const el = document.querySelector('#plan-recommend [data-kind="bed"] .plan-recommend-where');
      const cs = getComputedStyle(el);
      return { h: el.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight), ws: cs.whiteSpace,
               title: el.closest('.plan-recommend-open').title };
    });
    assert.equal(line.ws, 'nowrap', '室名が折り返す');
    assert.ok(line.h <= line.lh * 1.2, '室名が2行以上になっている');
    assert.match(line.title, /子ども室①.*主寝室/, '省いた室名を確かめる手段が無い');

    // 押せる大きさ(DESIGN.md: 40px 以上)と、横長のボタンは capsule
    const sizes = await page.evaluate(() => {
      const row = document.querySelector('#plan-recommend .plan-recommend-item');
      const x = row.querySelector('.plan-recommend-dismiss');
      return { rowH: row.getBoundingClientRect().height, xW: x.getBoundingClientRect().width,
               xH: x.getBoundingClientRect().height, radius: getComputedStyle(row).borderTopLeftRadius };
    });
    assert.ok(sizes.rowH >= 44, '行が低すぎて押しにくい');
    // どの行も × がカードの内側にある(はみ出すとサイドバーに切られて見えない)
    const clipped = await page.evaluate(() => {
      const card = document.getElementById('plan-recommend').getBoundingClientRect();
      return [...document.querySelectorAll('#plan-recommend .plan-recommend-item')].filter((li) => {
        const x = li.querySelector('.plan-recommend-dismiss').getBoundingClientRect();
        const r = li.getBoundingClientRect();
        return x.right > card.right + 0.5 || r.right > card.right + 0.5;
      }).map((li) => li.dataset.kind);
    });
    assert.deepEqual(clipped, [], 'カードからはみ出して×が見えない行がある');
    assert.ok(sizes.xW >= 40 && sizes.xH >= 40, '×が小さすぎる');
    assert.ok(parseFloat(sizes.radius) >= 20, '横長の行が capsule になっていない');

    // ── 押すと、カタログのその欄が開いてそこまで送られる ──
    await page.locator('#plan-recommend [data-kind="bed"] .plan-recommend-open').click();
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
      const sec = document.querySelector('#sidebar .asset-subcat[data-kind="bed"]');
      const body = sec.closest('.cat-body');
      const head = sec.querySelector('.asset-subhdr');
      const sb = document.getElementById('sidebar').getBoundingClientRect();
      const common = document.querySelector('#sidebar .common-tools').getBoundingClientRect();
      const h = head.getBoundingClientRect();
      return {
        belowCommon: h.top >= common.bottom - 1,
        bodyOpen: body.classList.contains('open'),
        mark: body.previousElementSibling.querySelector('span').textContent,
        secOpen: sec.classList.contains('open'),
        arrow: head.querySelector('.asset-arrow').textContent,
        inView: h.top >= sb.top && h.bottom <= sb.bottom,
        ring: getComputedStyle(head).outlineStyle + ' ' + getComputedStyle(head).outlineWidth,
        elevation: getComputedStyle(head).boxShadow,
        focusIsTile: document.activeElement && document.activeElement.classList.contains('asset-tile'),
        focusInSection: sec.contains(document.activeElement),
      };
    });
    assert.ok(opened.bodyOpen, '大分類(家具)が開いていない');
    assert.equal(opened.mark, '-', '大分類の＋／－が揃っていない');
    assert.ok(opened.secOpen, 'ベッドの欄が開いていない');
    assert.equal(opened.arrow, '-', '欄の＋／－が揃っていない');
    assert.ok(opened.inView, 'ベッドの欄まで送られていない');
    assert.ok(opened.belowCommon, '見出しが共通操作(上に貼り付いている)の下に隠れている');
    // 開いた欄を一瞬オレンジの輪で示す。見出しの浮きの影(別の規則)は残る
    assert.match(opened.ring, /solid 2px/, '開いた欄が示されていない');
    assert.notEqual(opened.elevation, 'none', '見出しの浮きの影を消している');
    assert.ok(opened.focusIsTile && opened.focusInSection, 'キーボードの位置がベッドの欄に移っていない');

    // **ここからは置かない。**
    assert.equal(await page.evaluate(() => DATA.items.length), itemsBefore, 'おすすめから物を置いている');
    assert.equal(await page.evaluate(() => ST.tool), 'select', 'おすすめから道具を選んでいる');

    // ── 検索中でも、押せば検索を解いて開く ──
    await page.fill('#object-search-input', 'ソファ');
    assert.equal(await page.locator('#plan-recommend').isVisible(), false, '検索中もカードが検索結果の間に居座る');
    await page.fill('#object-search-input', '');
    await page.fill('#object-search-input', 'x');
    await page.evaluate(() => PlanFinish.openInCatalogue('sofa'));
    assert.equal(await page.inputValue('#object-search-input'), '', '検索が解かれていない');
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').classList.contains('catalogue-searching')), false);

    // ── ×で1つずつ消え、全部消えたらカードごと消える ──
    const n = await page.locator('#plan-recommend .plan-recommend-item').count();
    await page.locator('#plan-recommend [data-kind="bed"] .plan-recommend-dismiss').click();
    assert.equal(await page.locator('#plan-recommend .plan-recommend-item').count(), n - 1);
    assert.equal(await page.locator('#plan-recommend [data-kind="bed"]').count(), 0, '×で消えていない');
    const focusAfter = await page.evaluate(() => document.activeElement && document.activeElement.className);
    assert.equal(focusAfter, 'plan-recommend-dismiss', '消したあとキーボードの位置が失われる');
    while (await page.locator('#plan-recommend .plan-recommend-dismiss').count()) {
      await page.locator('#plan-recommend .plan-recommend-dismiss').first().click();
    }
    assert.equal(await page.locator('#plan-recommend').count(), 0, '全部消してもカードが残る');

    // 取り込み直せば出し直す
    await page.evaluate((r) => PlanFinish.mount(r), RESULT);
    assert.equal(await page.locator('#plan-recommend .plan-recommend-item').count(), n);

    // ── 右上の×で、欄ごと一度に閉じる ──
    const corner = await page.evaluate(() => {
      const card = document.getElementById('plan-recommend').getBoundingClientRect();
      const x = document.querySelector('#plan-recommend .plan-recommend-close');
      const r = x.getBoundingClientRect();
      const firstRow = document.querySelector('#plan-recommend .plan-recommend-item').getBoundingClientRect();
      return { w: r.width, h: r.height, label: x.getAttribute('aria-label'),
               inside: r.left >= card.left && r.right <= card.right + 0.5 && r.top >= card.top,
               topRight: r.right > card.right - 60 && r.bottom < firstRow.top };
    });
    assert.ok(corner.w >= 40 && corner.h >= 40, '欄ごと閉じる×が小さすぎる');
    assert.ok(corner.inside, '欄ごと閉じる×がカードの外にはみ出している');
    assert.ok(corner.topRight, '欄ごと閉じる×が右上に無い');
    assert.match(corner.label, /閉じる/);
    await page.locator('#plan-recommend .plan-recommend-close').click();
    assert.equal(await page.locator('#plan-recommend').count(), 0, '右上の×で欄が閉じない');
    assert.equal(await page.evaluate(() => DATA.items.length), itemsBefore, '閉じただけで間取りが変わった');
    // 閉じても、取り込み直せば出し直す
    await page.evaluate((r) => PlanFinish.mount(r), RESULT);
    assert.equal(await page.locator('#plan-recommend .plan-recommend-item').count(), n);

    // 何も無ければカードを出さない
    await page.evaluate(() => PlanFinish.mount({ reads: [{ kind: 'bathtub', room: '浴室' }] }));
    assert.equal(await page.locator('#plan-recommend').count(), 0, '出すものが無いのに空のカードを出す');

    assert.deepEqual(errors, [], 'ページでエラーが出た: ' + errors.join(' / '));
    await page.close();
  }

  // ── スマホ幅 ───────────────────────────────────────────────────
  {
    const { page, errors } = await open({ width: 375, height: 812 });
    await page.evaluate((r) => PlanFinish.mount(r), RESULT);
    await page.evaluate(() => { if (typeof toggleMobileSidebar === 'function') toggleMobileSidebar(); });
    await page.waitForTimeout(400);
    const card = page.locator('#plan-recommend');
    assert.equal(await card.count(), 1);
    const fit = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const row = el.querySelector('.plan-recommend-item').getBoundingClientRect();
      return { left: r.left, right: r.right, rowW: row.width, vw: innerWidth,
               overflow: el.scrollWidth > el.clientWidth + 1 };
    });
    assert.ok(fit.left >= 0 && fit.right <= fit.vw, 'スマホ幅でカードが画面からはみ出す');
    assert.ok(!fit.overflow, 'スマホ幅でカードの中身が横にはみ出す');
    const clippedMobile = await page.evaluate(() => {
      const card = document.getElementById('plan-recommend').getBoundingClientRect();
      return [...document.querySelectorAll('#plan-recommend .plan-recommend-dismiss')]
        .filter((x) => x.getBoundingClientRect().right > card.right + 0.5).length;
    });
    assert.equal(clippedMobile, 0, 'スマホ幅で×がカードの外に出る');
    await page.locator('#plan-recommend .plan-recommend-close').click();
    assert.equal(await page.locator('#plan-recommend').count(), 0, 'スマホ幅で右上の×が効かない');
    await page.evaluate((r) => PlanFinish.mount(r), RESULT);
    await page.locator('#plan-recommend [data-kind="chair"] .plan-recommend-open').click();
    await page.waitForTimeout(700);
    const ok = await page.evaluate(() => {
      const sec = document.querySelector('#sidebar .asset-subcat[data-kind="chair"]');
      const sb = document.getElementById('sidebar').getBoundingClientRect();
      const common = document.querySelector('#sidebar .common-tools').getBoundingClientRect();
      const h = sec.querySelector('.asset-subhdr').getBoundingClientRect();
      return { open: sec.classList.contains('open'), inView: h.bottom <= sb.bottom,
               belowCommon: h.top >= common.bottom - 1 };
    });
    assert.ok(ok.open && ok.inView, 'スマホ幅で欄が開かない・送られない');
    // スマホでは共通操作が高い(330px)。固定の余白では見出しがその下に隠れた
    assert.ok(ok.belowCommon, 'スマホ幅で見出しが共通操作の下に隠れている');
    assert.deepEqual(errors, [], 'ページでエラーが出た: ' + errors.join(' / '));
    await page.close();
  }
  console.log('ok おすすめの家具');
} finally {
  await browser.close();
}
