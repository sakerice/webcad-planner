// 広告(PR)の枠。Web 版だけに出す。
//
// 出す場所は2つ。
//   - 画面の上端の帯(PR_ADS.top)。2D でも 3D でも同じ位置。高さの低い画面(スマートフォンの横向き)では出さない。
//   - 保存一覧・共同編集(共有)・JIS 図面出力(書き出し)のダイアログの末尾(PR_ADS.library / share / export)。
// Web の全面広告(インタースティシャル)は作らない。アプリ版(Capacitor)は別に AdMob を使うので、ここでは出さない。
//
// ■ 素材の足し方
// 広告主との提携が承認されたら、下の PR_ADS の該当する枠に1件ずつ足す。コードは触らなくてよい。
// A8.net の「広告リンク」の HTML から、次の値を写す。
//   { href: '<a href="..."> の値(https://px.a8.net/...)',
//     img:  '<img src="..."> の値(https://wwwNN.a8.net/...)', w: 画像の幅, h: 画像の高さ,
//     px:   '1×1 の計測用 <img src="..."> の値(https://wwwNN.a8.net/0.gif?a8mat=...)',
//     name: '広告主名(画像の代わりの文字として読み上げに使う)' }
// 素材の画像は縮めずにそのままの大きさで出す。枠に入る幅の物だけから選ぶので、
// 上端には 728×90(パソコン・iPad)・468×60(高さ 800px 未満の画面)・320×50(iPhone の縦)を入れておくとよい。
// href は https://px.a8.net/ 、img と px は https://*.a8.net/ 以外を受け付けない(外れた物は出さない)。
//
// ■ 素材が0件のとき
// 枠の要素を作らず、--ad-h も 0 のまま。has-pr-top も付けないので、画面は広告を入れる前と1px も変わらない。
//
// ■ 上端の帯の高さ
// 帯の高さ(画像の高さ + 上下の余白)を <html> の CSS 変数 --ad-h に入れ、has-pr-top を付ける。
// index.html の CSS が、そのとき --safe-top(上の操作の段・サイドバー・右の欄などの上端の基準)に --ad-h を足し、
// body の上に --ad-h の余白を取る。図の領域(#canvas-area。3D の画面もこの中)もその分だけ下がる。
// 姉妹サービス「かさねて」のアプリ版(app-ads.js)と同じ変数名にしてある。
//
// ■ 検査から素材を差し込む
// window.__HP_PR_ADS__ に PR_ADS と同じ形の物が置かれていれば、そちらを使う(検査が page.addInitScript で置く)。
// 利用者の画面には出てこない。差し込んだ物も同じ検査(a8.net 以外を受け付けない)を通る。
(function(root){
  'use strict';

  // 2026-11-23: A8.net の「複数の工務店へ間取り作成・見積りを一括依頼【ハウジングバザール】」(プログラム s00000011766004、
  // 掲載サイト 003 house-planner mobile)の素材。A8.net の「広告リンク作成」の HTML から写した。
  var PR_ADS = {
    top: [       // 画面の上端
      { href: 'https://px.a8.net/svt/ejp?a8mat=4BGS10+3NKV0I+2ISC+NX735', img: 'https://www28.a8.net/svt/bgt?aid=261123300221&wid=003&eno=01&mid=s00000011766004018000&mc=1', w: 728, h: 90, px: 'https://www16.a8.net/0.gif?a8mat=4BGS10+3NKV0I+2ISC+NX735', name: '自然派住宅をつくる工務店紹介サイト ハウジングバザール' },
      { href: 'https://px.a8.net/svt/ejp?a8mat=4BGS10+3NKV0I+2ISC+NXESX', img: 'https://www29.a8.net/svt/bgt?aid=261123300221&wid=003&eno=01&mid=s00000011766004019000&mc=1', w: 468, h: 60, px: 'https://www14.a8.net/0.gif?a8mat=4BGS10+3NKV0I+2ISC+NXESX', name: '自然派住宅をつくる工務店紹介サイト ハウジングバザール' },
      { href: 'https://px.a8.net/svt/ejp?a8mat=4BGS10+3NKV0I+2ISC+NW4I9', img: 'https://www27.a8.net/svt/bgt?aid=261123300221&wid=003&eno=01&mid=s00000011766004013000&mc=1', w: 320, h: 50, px: 'https://www11.a8.net/0.gif?a8mat=4BGS10+3NKV0I+2ISC+NW4I9', name: '自然派住宅をつくる工務店紹介サイト ハウジングバザール' }
    ],
    library: [   // 保存一覧のダイアログ
      { href: 'https://px.a8.net/svt/ejp?a8mat=4BGS10+3NKV0I+2ISC+NXMIP', img: 'https://www24.a8.net/svt/bgt?aid=261123300221&wid=003&eno=01&mid=s00000011766004020000&mc=1', w: 300, h: 250, px: 'https://www16.a8.net/0.gif?a8mat=4BGS10+3NKV0I+2ISC+NXMIP', name: '自然派住宅をつくる工務店紹介サイト ハウジングバザール' }
    ],
    share: [     // 共同編集(共有)のダイアログ
      { href: 'https://px.a8.net/svt/ejp?a8mat=4BGS10+3NKV0I+2ISC+NXMIP', img: 'https://www24.a8.net/svt/bgt?aid=261123300221&wid=003&eno=01&mid=s00000011766004020000&mc=1', w: 300, h: 250, px: 'https://www16.a8.net/0.gif?a8mat=4BGS10+3NKV0I+2ISC+NXMIP', name: '自然派住宅をつくる工務店紹介サイト ハウジングバザール' }
    ],
    'export': [  // JIS 図面出力(書き出し)のダイアログ
      { href: 'https://px.a8.net/svt/ejp?a8mat=4BGS10+3NKV0I+2ISC+NW4I9', img: 'https://www27.a8.net/svt/bgt?aid=261123300221&wid=003&eno=01&mid=s00000011766004013000&mc=1', w: 320, h: 50, px: 'https://www11.a8.net/0.gif?a8mat=4BGS10+3NKV0I+2ISC+NW4I9', name: '自然派住宅をつくる工務店紹介サイト ハウジングバザール' }
    ]
  };
  var SLOTS = ['top', 'library', 'share', 'export'];

  // 上端の帯の余白。画像の下に 18px 空け、上の操作の段(帯の下 8〜10px に置かれる)との間を 24px 以上にする
  var TOP_PAD_T = 6, TOP_PAD_B = 18;
  // 高さの低い画面(スマートフォンの横向き)では上端の帯を出さない。見本(電話の横 844×390)と同じ線
  var LOW_SCREEN = '(max-height:500px)';
  // 高さが SHORT_SCREEN_H 未満の画面(小さいパソコン 1024×700 など)では、上端に高さ SHORT_AD_MAX_H 以下の素材だけを使う。
  // 728×90 だと図の領域が 16% 減るため。468×60 があればそれ、無ければ 320×50。どちらも無ければ帯を出さない(728×90 には戻さない)
  var SHORT_SCREEN_H = 800, SHORT_AD_MAX_H = 60;

  // 'web': ブラウザ。A8.net の枠を出す。
  // 'app': Capacitor の中(アプリ版)。AdMob を使うので、ここの枠は出さない。
  // 'off': そのほか(ファイルを直に開いた・ほかの画面に埋め込まれた など)。出さない。
  function adsMode(){
    try{
      var proto = (root.location && root.location.protocol) || '';
      if(root.Capacitor || proto === 'capacitor:' || proto === 'ionic:') return 'app';
      if(proto !== 'https:' && proto !== 'http:') return 'off';
      if(root.top && root.top !== root) return 'off';
    }catch(e){ return 'off'; }
    return 'web';
  }

  // host を渡せばその名前だけ、渡さなければ *.a8.net を受け付ける
  function okUrl(s, host){
    if(typeof s !== 'string') return false;
    var u;
    try{ u = new URL(s); }catch(e){ return false; }
    if(u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    var h = u.hostname.toLowerCase();
    return host ? h === host : /^[a-z0-9-]+\.a8\.net$/.test(h);
  }
  function okSize(n){ return typeof n === 'number' && isFinite(n) && n === Math.floor(n) && n >= 1 && n <= 1200; }
  function validCreative(c){
    return !!c && typeof c === 'object'
      && okUrl(c.href, 'px.a8.net') && okUrl(c.img)
      && (c.px == null || c.px === '' || okUrl(c.px))
      && okSize(c.w) && okSize(c.h)
      && (c.name == null || typeof c.name === 'string');
  }
  function source(){
    var o = root.__HP_PR_ADS__;
    if(o && typeof o === 'object') return o;
    // 自動で動かしているブラウザ(検査・撮影)では、本物の素材を出さない。広告主の表示回数に、人が見ていない表示を数えさせないため
    try { if(root.navigator && root.navigator.webdriver) return {}; } catch(_e){}
    return PR_ADS;
  }
  function creatives(slot){
    var list = source()[slot];
    if(!Array.isArray(list)) return [];
    return list.filter(validCreative);
  }
  // 幅 maxW に収まる物のうち、いちばん幅の広い物から1つ選ぶ(パソコンで 320×50 を出さない)。
  // 同じ幅が複数あれば、開くたびに替わるよう無作為に選ぶ。skip は読めなかった物
  // maxH を渡すと、高さがそれ以下の物だけから選ぶ。cur を渡すと、cur が選べる物の中でいちばん広い幅なら cur を返す(出し直さない)
  function pick(slot, maxW, skip, maxH, cur){
    var ok = creatives(slot).filter(function(c){
      return c.w <= maxW && (!maxH || c.h <= maxH) && !(skip && skip.indexOf(c) !== -1);
    });
    if(!ok.length) return null;
    var widest = Math.max.apply(null, ok.map(function(c){ return c.w; }));
    ok = ok.filter(function(c){ return c.w === widest; });
    if(cur && ok.indexOf(cur) !== -1) return cur;
    return ok[Math.floor(Math.random() * ok.length)];
  }

  // 枠の中身(PR の表記・広告の画像・計測用の画像)を作る。onFail は広告の画像が読めなかったとき
  function build(c, onFail){
    var doc = root.document;
    var box = doc.createElement('div');
    box.className = 'pr-box';
    box.style.width = c.w + 'px';
    var a = doc.createElement('a');
    a.className = 'pr-link';
    a.href = c.href;
    a.target = '_blank';
    a.rel = 'nofollow sponsored noopener';
    var im = doc.createElement('img');
    im.className = 'pr-img';
    im.width = c.w; im.height = c.h;
    im.alt = c.name || '';
    im.decoding = 'async';
    im.referrerPolicy = 'no-referrer-when-downgrade';
    im.addEventListener('error', onFail);
    im.src = c.img;
    a.appendChild(im);
    var badge = doc.createElement('span');
    badge.className = 'pr-badge';
    badge.textContent = 'PR';
    box.appendChild(a);
    box.appendChild(badge);
    if(c.px){
      var px = doc.createElement('img');
      px.className = 'pr-px';
      px.width = 1; px.height = 1; px.alt = '';
      px.src = c.px;
      box.appendChild(px);
    }
    return box;
  }

  // ───── 上端の帯 ─────
  var top = { cur: null, el: null, failed: [], h: 0 };
  function setAdH(h){
    var html = root.document.documentElement;
    if(h === top.h) return;
    top.h = h;
    if(h > 0){
      html.style.setProperty('--ad-h', h + 'px');
      html.classList.add('has-pr-top');
    }else{
      html.style.removeProperty('--ad-h');
      html.classList.remove('has-pr-top');
    }
    // 図の領域の大きさが変わるので、平面図・3D の描き直しを頼む(窓の大きさは変わらないので resize は自然には来ない)
    if(root.document.readyState !== 'loading'){
      try{ root.dispatchEvent(new Event('resize')); }catch(e){}
    }
  }
  function topWanted(){
    if(adsMode() !== 'web') return false;
    try{ if(root.matchMedia && root.matchMedia(LOW_SCREEN).matches) return false; }catch(e){}
    return true;
  }
  function removeTop(){
    if(top.el && top.el.parentNode) top.el.parentNode.removeChild(top.el);
    top.el = null;
    top.cur = null;
  }
  function syncTop(){
    var wanted = topWanted();
    var maxW = (root.innerWidth || 0) - 16;
    var maxH = (root.innerHeight || 0) < SHORT_SCREEN_H ? SHORT_AD_MAX_H : 0;
    // 回転・窓の大きさ変更のたびに選び直す。今の素材がまだいちばん合っていれば、そのまま出し続ける
    var c = wanted ? pick('top', maxW, top.failed, maxH, top.cur) : null;
    if(!c){ removeTop(); setAdH(0); return; }
    // 帯の高さは画像を読む前に空けておく(読めてから押し下げると、押そうとしたボタンの場所に広告が来る)
    setAdH(TOP_PAD_T + c.h + TOP_PAD_B);
    if(c === top.cur && top.el) return;
    var body = root.document.body;
    if(!body) { top.cur = null; return; }   // body ができてから(DOMContentLoaded)作る
    removeTop();
    var el = root.document.createElement('aside');
    el.id = 'pr-top';
    el.className = 'pr-top';
    el.setAttribute('aria-label', 'PR');
    var cur = c;
    el.appendChild(build(c, function(){
      if(top.cur !== cur) return;
      top.failed.push(cur);
      removeTop();
      syncTop();
    }));
    body.insertBefore(el, body.firstChild);
    top.el = el;
    top.cur = c;
  }

  // ───── ダイアログの中の枠 ─────
  // container を見える状態にしてから呼ぶ(収まる幅を測るため)。素材が無い・読めないときは container を隠す。
  function fill(container, slot){
    if(!container) return;
    while(container.firstChild) container.removeChild(container.firstChild);
    container.hidden = true;
    if(adsMode() !== 'web' || SLOTS.indexOf(slot) === -1 || slot === 'top') return;
    if(!creatives(slot).length) return;
    container.hidden = false;
    var maxW = container.clientWidth || 0;
    var failed = [];
    function put(){
      while(container.firstChild) container.removeChild(container.firstChild);
      var c = pick(slot, maxW, failed);
      if(!c){ container.hidden = true; return; }
      container.appendChild(build(c, function(){ failed.push(c); put(); }));
    }
    put();
  }

  var api = { adsMode: adsMode, fill: fill, syncTop: syncTop, validCreative: validCreative, creatives: creatives, SLOTS: SLOTS };
  root.PrAds = api;
  root.adsMode = adsMode;

  if(typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  if(!root.document) return;

  // head で読むので、最初の絵が出る前に帯の高さを空けておく。帯そのものは body ができてから作る
  syncTop();
  if(root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', syncTop);
  var queued = false;
  root.addEventListener('resize', function(){
    if(queued) return;
    queued = true;
    (root.requestAnimationFrame || setTimeout)(function(){ queued = false; syncTop(); });
  });
})(typeof window !== 'undefined' ? window : globalThis);
