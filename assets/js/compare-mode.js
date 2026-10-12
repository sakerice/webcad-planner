// 比較モードの試作（作り直し計画 2-0。本番には出さない。?compare=1 のときだけ入口を出す）。
//
// 今のアプリは、編集中の間取りを全体の変数（DATA・HISTORY・ST の表示位置など）1組で持つ。
// 比較では2組を「作業面」として持ち、触った側の中身を全体の変数へ入れ替える。
// 編集の機能は1組のまま使い回せるので、壁・家具・Undo の処理には手を入れない。
//
// 画面: 図面の欄を左右に分ける。編集中の側には本物の図面（#c2d。イベントが付いている）を置き、
// もう片方には描くだけの図面を置く。描くだけの図面は、一時的に中身と描き先を入れ替えて
// draw2d() で描く（draw-2d.js の書き出しと同じやり方）。もう片方を触ると、中身と置き場所を入れ替える。
var CompareMode = (function(){
  // 作業面ごとに入れ替える全体の変数。ST はこの項目だけ（ツールや吸着の設定は左右で共通）。
  var GLOBALS = ['DATA','HISTORY','REDO_HISTORY','DIRTY','nextId'];
  var VIEW_KEYS = ['floor','zoom','panX','panY','selected','multiSelected','selectAll','drawing','drawPts','_camStash'];
  var on = false, active = 0, panes = [], peer = null, peerCtx = null, frame = [];

  function capture(){
    var ws = {g:{}, v:{}};
    GLOBALS.forEach(function(k){ ws.g[k] = window[k]; });
    VIEW_KEYS.forEach(function(k){ ws.v[k] = ST[k]; });
    return ws;
  }
  function apply(ws){
    GLOBALS.forEach(function(k){ window[k] = ws.g[k]; });
    VIEW_KEYS.forEach(function(k){ ST[k] = ws.v[k]; });
  }
  // プランから写している全体の値（方位・壁の高さ）を、入れ替えた側に揃え直す。
  function syncPlanGlobals(){
    resetHeightGlobalsForPlanLoad();
    syncNorthFromPlan();
    ensureHeightDefaults();
    if(typeof syncHeightDefaultsUI==='function') syncHeightDefaultsUI();
  }
  function syncChrome(){
    var sel = document.getElementById('floor-sel'); if(sel) sel.value = String(ST.floor);
    var stf = document.getElementById('st-floor'); if(stf) stf.textContent = 'フロア:'+ST.floor+'F';
    var props = document.getElementById('props'); if(props) props.classList.remove('show');
    if(DIRTY) markDirtyUiOnlyFor(); else clearDirty();
  }
  function markDirtyUiOnlyFor(){
    var btn = document.getElementById('save-btn'); if(btn) btn.classList.add('dirty');
    renderSaveButtonState();
  }

  function layout(){
    var area = document.getElementById('canvas-area');
    var W = area.clientWidth, H = area.clientHeight, half = Math.floor(W/2);
    var left = active===0;
    canvas.width = half; canvas.height = H;
    canvas.style.left = (left?0:W-half)+'px';
    peer.width = half; peer.height = H;
    peer.style.left = (left?W-half:0)+'px';
    frame[0].style.cssText = frameCss(0, half, W);
    frame[1].style.cssText = frameCss(1, half, W);
  }
  function frameCss(i, half, W){
    var x = i===0 ? 0 : W-half, act = i===active;
    return 'position:absolute;top:0;left:'+x+'px;width:'+half+'px;height:100%;pointer-events:none;box-sizing:border-box;z-index:5;'+
      'border:'+(act?'3px solid #2f6fdf':'1px solid #c9cdd4')+';';
  }
  function label(i){
    return (i===0?'左: 開いていたプラン':'右: 比較するプラン')+(i===active?'（編集中）':'');
  }
  function drawPeer(){
    var mine = capture(), other = panes[1-active];
    var realCanvas = canvas, realCtx = ctx;
    var t0 = performance.now();
    try{
      apply(other);
      canvas = peer; ctx = peerCtx;
      ST.selected = null; ST.multiSelected = []; ST.selectAll = false;
      draw2d();
    }finally{
      canvas = realCanvas; ctx = realCtx;
      apply(mine);
    }
    CompareMode.lastPeerMs = performance.now()-t0;
    frame.forEach(function(f,i){ f.firstChild.textContent = label(i); });
  }
  function redraw(){ layout(); draw2d(); drawPeer(); }

  function activate(i){
    if(!on || i===active) return;
    panes[active] = capture();
    DRAG.active = false;
    active = i;
    apply(panes[active]);
    syncPlanGlobals();
    syncChrome();
    redraw();
  }

  function start(planB){
    if(on) return;
    if(typeof SHARED!=='undefined' && SHARED.roomId){
      alert('共同編集中は比較を使えません。'); return;
    }
    if(ST.view!=='2d'){ alert('比較は平面図で使います。'); return; }
    var area = document.getElementById('canvas-area');
    peer = document.createElement('canvas');
    peer.id = 'c2d-peer';
    peer.style.cssText = 'position:absolute;top:0;touch-action:none;cursor:pointer';
    peerCtx = peer.getContext('2d');
    peer.addEventListener('pointerdown', function(e){ e.preventDefault(); activate(1-active); });
    area.appendChild(peer);
    frame = [0,1].map(function(){
      var f = document.createElement('div');
      var tag = document.createElement('span');
      tag.style.cssText = 'position:absolute;top:6px;left:8px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.9);font:12px sans-serif;color:#223';
      f.appendChild(tag); area.appendChild(f); return f;
    });
    panes[0] = capture();
    // 右の作業面: 渡されたプラン（無ければ今のプランの写し）。Undo の履歴は空から。
    var copy = planB ? planB : JSON.parse(serializeDataSnapshot());
    panes[1] = {g:{DATA:copy, HISTORY:[], REDO_HISTORY:[], DIRTY:false, nextId:nextId}, v:Object.assign({}, panes[0].v, {selected:null, multiSelected:[], selectAll:false, drawing:false, drawPts:[]})};
    on = true; active = 0;
    // 右の nextId はプランから数え直す（写しなら左と同じ番号から始まり、左右で衝突しても別の DATA なので構わない）
    var mine = capture(); apply(panes[1]); ensureObjectIds(); panes[1] = capture(); apply(mine);
    window.addEventListener('resize', onResize);
    redraw();
  }
  function stop(){
    if(!on) return;
    if(active!==0) activate(0);
    on = false;
    window.removeEventListener('resize', onResize);
    if(peer) peer.remove(); frame.forEach(function(f){ f.remove(); });
    peer = null; frame = []; panes = [];
    canvas.style.left = '0px';
    resize2d();
  }
  function onResize(){ if(on) redraw(); }

  // 編集中の側の draw2d のたびに、左右の倍率と位置を揃えるなら描くだけの側も描き直す。
  function afterDraw(){
    if(!on || !CompareMode.syncView || !peer) return;
    var o = panes[1-active];
    if(o.v.zoom===ST.zoom && o.v.panX===ST.panX && o.v.panY===ST.panY && o.v.floor===ST.floor) return;
    o.v.zoom = ST.zoom; o.v.panX = ST.panX; o.v.panY = ST.panY; o.v.floor = ST.floor;
    drawPeer();
  }

  function installEntry(){
    if(!/[?&]compare=1\b/.test(location.search)) return;
    var bar = document.getElementById('save-btn'); if(!bar) return;
    var b = document.createElement('button');
    b.className = 'tbtn'; b.id = 'compare-btn'; b.textContent = '比較（試作）';
    b.onclick = function(){ on ? stop() : start(); b.textContent = on ? '比較をやめる' : '比較（試作）'; };
    bar.parentNode.insertBefore(b, bar);
    // resize2d と draw2d の後ろに、比較中だけの処理を足す
    var baseResize = resize2d;
    resize2d = function(){ if(on) redraw(); else baseResize(); };
    var baseDraw = draw2d;
    draw2d = function(){ var r = baseDraw.apply(this, arguments); if(on && canvas.id==='c2d') afterDraw(); return r; };
  }
  window.addEventListener('load', installEntry);

  return { start:start, stop:stop, activate:activate, isOn:function(){ return on; }, activeSide:function(){ return active; },
    syncView:true, lastPeerMs:0 };
})();
