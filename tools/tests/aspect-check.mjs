// 画面の比率を変えて知らせ・ボタン・スイッチの収まりを機械で確かめる部品(ブラウザの検査から使う)。
//
// 実機の代わりに、次の大きさで同じ表示を出す。電話の縦・横、タブレットの縦・横、大きいタブレット。
// 見る点: 画面の外に出ていない・文字が切れていない(横にはみ出していない)・ボタンが押せる大きさ(高さと幅 40px 以上)・
// 画面の上の操作の段(#toolbar)・下の操作の段(#bottom-nav)・「AIに頼む」(#chat-fab)と重ならない・
// 同時に出る知らせどうしが重ならない。
export const SIZES = [
  [375, 667], [390, 844], [844, 390], [768, 1024], [1024, 768], [1024, 1366],
];
export const MIN_TARGET = 40;

// selectors: 確かめる表示(見えていなければ「出ていない」と返す)。
// 戻り値: { problems: [文], boxes }。problems が空なら問題なし。
export async function checkLayout(page, selectors, { avoid = ['#toolbar', '#sidebar', '#bottom-nav', '#chat-fab', '#statusbar'], minTarget = MIN_TARGET } = {}) {
  return page.evaluate(({ selectors, avoid, minTarget }) => {
    const vw = innerWidth, vh = innerHeight;
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const over = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    const problems = [];
    const boxes = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!shown(el)) { problems.push(`${sel} が出ていない`); continue; }
      const b = box(el);
      boxes[sel] = b;
      if (b.left < 0 || b.top < 0 || b.right > vw || b.bottom > vh) problems.push(`${sel} が画面の外に出ている ${JSON.stringify(b)} (画面 ${vw}x${vh})`);
      // 文字が切れていない: 中の要素が横にはみ出していない(省略記号で切っていない)
      for (const t of [el, ...el.querySelectorAll('*')]) {
        if (!shown(t)) continue;
        if (t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflowX !== 'visible') problems.push(`${sel} の中の文字が切れている: ${(t.id ? '#' + t.id : t.tagName)} 「${t.textContent.trim().slice(0, 20)}」`);
        const tb = box(t);
        if (tb.w > 0 && (tb.left < b.left - 1 || tb.right > b.right + 1)) problems.push(`${sel} の中の ${(t.id ? '#' + t.id : t.tagName)} が枠の外にはみ出している`);
      }
      // 押せる物の大きさ
      for (const btn of el.querySelectorAll('button, label, input[type=checkbox]')) {
        if (!shown(btn)) continue;
        const bb = box(btn);
        const name = btn.id ? '#' + btn.id : (btn.getAttribute('aria-label') || btn.textContent.trim() || btn.tagName);
        if (btn.tagName === 'INPUT') continue; // チェックボックスは囲みの label で押す(label の大きさを見る)
        if (bb.h < minTarget || bb.w < minTarget) problems.push(`${sel} の「${name}」が小さい (${bb.w}x${bb.h}px。目安 ${minTarget}px)`);
        if (bb.left < 0 || bb.right > vw || bb.top < 0 || bb.bottom > vh) problems.push(`${sel} の「${name}」が画面の外`);
      }
      // 閉じる(×)だけが1つの行に落ちていない(ほかの部品と同じ行に並ぶ)
      const close = el.querySelector('.plan-notice-close');
      if (shown(close)) {
        const cb = box(close);
        const mid = (cb.top + cb.bottom) / 2;
        const siblings = [...el.querySelectorAll('*')].filter((t) => t !== close && shown(t) && !t.contains(close) && !close.contains(t) && box(t).w > 0);
        if (!siblings.some((t) => { const tb = box(t); return tb.top <= mid && tb.bottom >= mid; })) problems.push(`${sel} の×だけが別の行に落ちている`);
      }
      for (const a of avoid) {
        const other = document.querySelector(a);
        if (!shown(other) || other.contains(el) || el.contains(other)) continue;
        if (over(b, box(other))) problems.push(`${sel} が ${a} に重なっている ${JSON.stringify(b)} / ${JSON.stringify(box(other))}`);
      }
    }
    const keys = Object.keys(boxes);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = document.querySelector(keys[i]), c = document.querySelector(keys[j]);
      if (a.contains(c) || c.contains(a)) continue;
      if (over(boxes[keys[i]], boxes[keys[j]])) problems.push(`${keys[i]} と ${keys[j]} が重なっている`);
    }
    return { problems, boxes, vw, vh };
  }, { selectors, avoid, minTarget });
}
