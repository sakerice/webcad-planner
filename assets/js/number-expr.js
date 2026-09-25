// 数値の入力欄で四則演算を受け付ける。
//
// 高さの計算は「天井高 2400 + 段差 800 - 床上げ 150」のように足し引きになりやすく、
// 電卓を横に置いて打ち直すことになる。そこで数値欄に 1230+20 のような式を
// 書けるようにし、確定したときに計算した結果へ置き換える。
//
// 仕組みは1か所にまとめてある。各欄は onchange で this.value を読むだけなので、
// 欄ごとには手を入れない:
//   1. type="number" の欄は、式の文字(+ * / 括弧)を受け付けないので text に替える。
//   2. 確定(change)を document の捕獲段で先に受け、式なら計算結果を value に入れてから
//      各欄の onchange に渡す。計算できない式なら元の値に戻し、onchange は呼ばない。
//
// eval は使わない。数字・小数点・+ - * / と括弧だけを読む小さな構文解析器で計算する。
(function (root) {
  'use strict';

  // 全角で打たれても読めるようにする(日本語入力のまま打つことが多い)。
  function normalize(s) {
    return String(s)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．。]/g, '.')
      .replace(/[＋]/g, '+')
      .replace(/[－ー−–—]/g, '-')
      .replace(/[×＊xX]/g, '*')
      .replace(/[÷／]/g, '/')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[,，、\s　]/g, '');
  }

  // 式を計算する。数値でなければ null。
  function evaluate(text) {
    var s = normalize(text);
    if (!s) return null;
    var i = 0;
    function peek() { return s[i]; }
    function number() {
      var m = /^\d+(\.\d*)?|^\.\d+/.exec(s.slice(i));
      if (!m) throw new Error('number');
      i += m[0].length;
      return parseFloat(m[0]);
    }
    function factor() {
      var c = peek();
      if (c === '+') { i++; return factor(); }
      if (c === '-') { i++; return -factor(); }
      if (c === '(') {
        i++;
        var v = expr();
        if (peek() !== ')') throw new Error('paren');
        i++;
        return v;
      }
      return number();
    }
    function term() {
      var v = factor();
      while (peek() === '*' || peek() === '/') {
        var op = s[i++];
        var r = factor();
        v = (op === '*') ? v * r : v / r;
      }
      return v;
    }
    function expr() {
      var v = term();
      while (peek() === '+' || peek() === '-') {
        var op = s[i++];
        var r = term();
        v = (op === '+') ? v + r : v - r;
      }
      return v;
    }
    try {
      var v = expr();
      if (i !== s.length || !isFinite(v)) return null;
      // 0.1+0.2 の類の端数を落とす。寸法は mm なので 6 桁で十分。
      return Math.round(v * 1e6) / 1e6;
    } catch (e) {
      return null;
    }
  }

  // 数字だけ(符号・小数点を含む)なら、計算を通す必要がない。
  function isPlainNumber(text) {
    return /^\s*[-+]?(\d+(\.\d*)?|\.\d+)\s*$/.test(String(text));
  }

  function convert(input) {
    if (!input || input.dataset.numExpr) return;
    input.dataset.numExpr = '1';
    // type を替えると inputmode の既定も変わる。記号を打てるよう、数字専用の
    // キーボードには絞らない。
    input.type = 'text';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    if (!input.title) input.title = '数値か式(例: 1230+20)を入力できます';
  }
  function convertAll(node) {
    if (!node || !node.querySelectorAll) return;
    if (node.matches && node.matches('input[type=number]')) convert(node);
    var list = node.querySelectorAll('input[type=number]');
    for (var k = 0; k < list.length; k++) convert(list[k]);
  }

  function install(doc) {
    if (!doc || doc.__numberExprInstalled) return;
    doc.__numberExprInstalled = true;

    // 確定前の値。計算できない式を打たれたときに戻す先。
    doc.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.numExpr) t.dataset.numExprPrev = t.value;
    }, true);

    doc.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.dataset || !t.dataset.numExpr) return;
      var raw = t.value;
      if (raw === '' || isPlainNumber(raw)) { t.dataset.numExprPrev = raw; return; }
      var v = evaluate(raw);
      if (v === null) {
        // 読めない式を各欄へ渡すと、NaN を黙って捨てる欄と 0 にしてしまう欄がある。
        // どちらにも渡さず、元の値へ戻す。
        e.stopImmediatePropagation();
        e.stopPropagation();
        t.value = t.dataset.numExprPrev || '';
        t.classList.add('num-expr-error');
        setTimeout(function () { t.classList.remove('num-expr-error'); }, 900);
        return;
      }
      t.value = String(v);
      t.dataset.numExprPrev = t.value;
    }, true);

    // 上下キーで step ずつ増減する(type=number のときの操作を残す)。
    doc.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!t || !t.dataset || !t.dataset.numExpr) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      var cur = evaluate(t.value);
      if (cur === null) return;
      e.preventDefault();
      var step = parseFloat(t.getAttribute('step'));
      if (!(step > 0)) step = 1;
      var v = cur + (e.key === 'ArrowUp' ? step : -step);
      var mn = parseFloat(t.getAttribute('min')), mx = parseFloat(t.getAttribute('max'));
      if (isFinite(mn)) v = Math.max(mn, v);
      if (isFinite(mx)) v = Math.min(mx, v);
      t.value = String(Math.round(v * 1e6) / 1e6);
      t.dispatchEvent(new Event('change', { bubbles: true }));
    });

    convertAll(doc.body);
    new MutationObserver(function (records) {
      for (var a = 0; a < records.length; a++) {
        var added = records[a].addedNodes;
        for (var b = 0; b < added.length; b++) if (added[b].nodeType === 1) convertAll(added[b]);
      }
    }).observe(doc.body, { childList: true, subtree: true });
  }

  var api = { evaluate: evaluate, normalize: normalize, isPlainNumber: isPlainNumber, install: install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NumberExpr = api;

  if (typeof document !== 'undefined') {
    if (document.body) install(document);
    else document.addEventListener('DOMContentLoaded', function () { install(document); });
  }
})(typeof window !== 'undefined' ? window : this);
