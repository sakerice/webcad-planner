// 比較モード（作り直し計画 2-1〜2-3）: 2つの間取りを平面図の左右に並べ、どちらも編集できる。
//
// 今のアプリは、編集中の間取りを全体の変数（DATA・HISTORY・ST の表示位置など）1組で持つ。
// 比較では2組を「作業面」として持ち、触った側の中身を全体の変数へ入れ替える。
// 壁・家具・Undo の処理は1組のまま使い回すので、編集の機能には手を入れない。
//
// 画面: 図面の欄を左右に分ける。編集中の側には本物の図面（#c2d。操作のイベントが付いている）を置き、
// もう片方には描くだけの図面を置く。描くだけの図面は、一時的に中身と描き先を入れ替えて
// draw2d() で描く（draw-2d.js の書き出しと同じやり方）。もう片方を触ると、中身と置き場所を入れ替える。
//
// 保存: 左（もともと開いていたプラン）は今までどおりブラウザに保存する。右はブラウザの保存枠を
// 使わず（使うと左が上書きされる）、JSON ファイルに書き出す。共同編集中は使えない（右が相手に送られる）。
// 3D: 編集中の側だけを全面に出す（左右の 3D は計画の 2-4）。
var CompareMode = (function(){
  // 作業面ごとに入れ替える全体の変数。ST はこの項目だけ（ツールや吸着の設定は左右で共通）
  // PLAN_LIBRARY_ID / PLAN_SAVE_INFO は「ブラウザのどこに保存した物か」（plan-library.js）
  var GLOBALS = ['DATA','HISTORY','REDO_HISTORY','DIRTY','nextId','PLAN_LIBRARY_ID','PLAN_SAVE_INFO'];
  var VIEW_KEYS = ['floor','zoom','panX','panY','selected','multiSelected','selectAll','drawing','drawPts','_camStash'];
  var SIDE_NAMES = ['左','右'];
  var on = false, active = 0, panes = [], peer = null, peerCtx = null, frames = [], bar = null;
  var api = { syncView:true, lastPeerMs:0 };

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
  // 中身を一時的に入れ替えて fn を呼ぶ。終わったら（失敗しても）必ず元へ戻す
  function withPane(i, fn){
    if(i===active) return fn();
    var mine = capture();
    try{ apply(panes[i]); var r = fn(); panes[i] = capture(); return r; }
    finally{ apply(mine); }
  }
  // プランから写している全体の値（方位・壁の高さ）を、入れ替えた側に揃え直す
  function syncPlanGlobals(){
    resetHeightGlobalsForPlanLoad();
    syncNorthFromPlan();
    ensureHeightDefaults();
    if(typeof syncHeightDefaultsUI==='function') syncHeightDefaultsUI();
  }
  // 読み込んだプランを、ファイルの読込と同じ手順で整える（いま入れ替えてある側に対して呼ぶ）
  function normalizeLoadedPlan(){
    resetHeightGlobalsForPlanLoad(); syncNorthFromPlan(); ensureObjectIds(); ensureExteriorWallSettings();
    ensureInteriorWallSettings(); ensureRoofAppearance(); ensureFloorMetadata(); ensureHeightDefaults();
    syncExteriorWallSettings(); normalizeLegacyFurnitureItems(); restoreViewState();
  }
  function syncChrome(){
    var sel = document.getElementById('floor-sel'); if(sel) sel.value = String(ST.floor);
    var stf = document.getElementById('st-floor'); if(stf) stf.textContent = 'フロア:'+ST.floor+'F';
    var props = document.getElementById('props'); if(props) props.classList.remove('show');
    var btn = document.getElementById('save-btn'); if(btn) btn.classList.toggle('dirty', !!DIRTY);
    renderSaveButtonState();
  }

  // ───── 画面 ─────
  function planName(i){
    var d = i===active ? DATA : panes[i].g.DATA;
    return (d && d.planName) ? String(d.planName) : '';
  }
  function setPlanName(i, v){
    v = String(v||'').trim().slice(0,60);
    withPane(i, function(){
      if((DATA.planName||'')===v) return;
      saveState();                       // 名前の変更も Undo で戻せる
      if(v) DATA.planName = v; else delete DATA.planName;
    });
  }
  function isDirty(i){ return i===active ? !!DIRTY : !!panes[i].g.DIRTY; }
  function saveInfo(i){ return i===active ? PLAN_SAVE_INFO : panes[i].g.PLAN_SAVE_INFO; }
  // 札の下に出す「ブラウザに保存されているか」
  function saveLine(i){
    var info = saveInfo(i);
    if(!info) return 'ブラウザ: まだ保存していません';
    var where = info.where==='list' ? '一覧「'+(info.name||'名前なし')+'」' : '前回のプラン';
    if(isDirty(i)) return 'ブラウザ: '+where+'に保存後、変更あり';
    return 'ブラウザ: '+where+'に保存済み'+(info.at ? '（'+PlanLibrary.nowLabel(info.at)+'）' : '');
  }

  function buildFrames(area){
    frames = [0,1].map(function(i){
      var f = document.createElement('div');
      f.className = 'compare-frame';
      var tag = document.createElement('div');
      tag.className = 'compare-tag';
      var side = document.createElement('span'); side.className = 'compare-side'; side.textContent = SIDE_NAMES[i];
      var name = document.createElement('input');
      name.className = 'compare-name'; name.type = 'text'; name.maxLength = 60;
      name.placeholder = '名前なし'; name.setAttribute('aria-label', SIDE_NAMES[i]+'のプランの名前');
      name.addEventListener('change', function(){ setPlanName(i, name.value); syncChrome(); render(); });
      name.addEventListener('keydown', function(e){ e.stopPropagation(); if(e.key==='Enter') name.blur(); });
      var state = document.createElement('span'); state.className = 'compare-state';
      var row = document.createElement('div'); row.className = 'compare-tag-row';
      row.append(side, name, state);
      var saved = document.createElement('div'); saved.className = 'compare-saved';
      tag.append(row, saved);
      f.append(tag);
      area.appendChild(f);
      return f;
    });
  }
  function buildBar(area){
    bar = document.createElement('div');
    bar.className = 'compare-bar';
    bar.innerHTML = '<label class="compare-sync"><input type="checkbox" checked> 倍率と位置を揃える</label>'+
      '<span class="compare-3d-note">3D は編集中の側だけを表示しています</span>'+
      '<span class="compare-msg" role="status"></span>'+
      '<button type="button" class="compare-stop">比較をやめる</button>';
    bar.querySelector('input').addEventListener('change', function(e){
      api.syncView = e.target.checked;
      if(api.syncView){ copyViewTo(1-active); drawPeer(); }
    });
    bar.querySelector('.compare-stop').addEventListener('click', function(){ requestStop(); });
    area.appendChild(bar);
  }
  function copyViewTo(i){
    var o = panes[i];
    o.v.zoom = ST.zoom; o.v.panX = ST.panX; o.v.panY = ST.panY; o.v.floor = ST.floor;
  }

  // 図面の欄のうち、浮いているパネルに隠れていない所。左右はここを半分ずつ使う
  // （広い画面では左のパネルが図面の上に浮いているので、欄全体で割ると左の図面がほとんど隠れる）
  function visibleRect(){
    var a = area().getBoundingClientRect(), left = 0, top = 8;
    var sb = document.getElementById('sidebar');
    if(sb && getComputedStyle(sb).display!=='none' && getComputedStyle(sb).visibility!=='hidden'){
      var r = sb.getBoundingClientRect();
      if(r.width < a.width*0.5 && r.height > a.height*0.5 && r.right > a.left) left = Math.round(r.right - a.left + 8);
    }
    var tb = document.getElementById('toolbar');
    if(tb){ var t = tb.getBoundingClientRect(); if(t.bottom > a.top && t.top < a.top + 80) top = Math.round(t.bottom - a.top + 8); }
    return {left:left, top:top, width:a.width, height:a.height};
  }
  function layout(){
    var v = visibleRect(), W = v.width - v.left, H = v.height, half = Math.floor(W/2);
    var x = [v.left, v.left + W - half];
    canvas.width = half; canvas.height = H;
    canvas.style.left = x[active]+'px';
    peer.width = half; peer.height = H;
    peer.style.left = x[1-active]+'px';
    frames.forEach(function(f,i){
      f.style.left = x[i]+'px'; f.style.width = half+'px';
    });
    if(bar) bar.style.left = (v.left + W/2)+'px';
  }
  function render(){
    var two = ST.view==='2d';
    area().classList.toggle('compare-3d', !two);
    frames.forEach(function(f,i){
      f.classList.toggle('is-active', i===active);
      f.hidden = !two && i!==active;
      var input = f.querySelector('.compare-name');
      if(document.activeElement!==input) input.value = planName(i);
      f.querySelector('.compare-state').textContent = i===active ? '編集中' : 'タップで編集';
      var sl = f.querySelector('.compare-saved');
      sl.textContent = saveLine(i);
      sl.classList.toggle('is-unsaved', !saveInfo(i) || isDirty(i));
    });
    if(peer) peer.hidden = !two;
  }
  function area(){ return document.getElementById('canvas-area'); }
  function drawPeer(){
    if(!peer || ST.view!=='2d') return;
    var realCanvas = canvas, realCtx = ctx, t0 = performance.now();
    withPane(1-active, function(){
      canvas = peer; ctx = peerCtx;
      var sel = [ST.selected, ST.multiSelected, ST.selectAll];
      ST.selected = null; ST.multiSelected = []; ST.selectAll = false;
      try{ draw2d(); }
      finally{ canvas = realCanvas; ctx = realCtx; ST.selected = sel[0]; ST.multiSelected = sel[1]; ST.selectAll = sel[2]; }
    });
    api.lastPeerMs = performance.now()-t0;
  }
  function redraw(){
    if(ST.view==='2d'){ layout(); draw2d(); drawPeer(); }
    render();
  }

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

  // ───── 始める ─────
  function canStart(){
    if(typeof SHARED!=='undefined' && SHARED.roomId){ alert('共同編集中は比較を使えません。共同編集を終えてから使ってください。'); return false; }
    return true;
  }
  function start(planB, from){
    from = from || {};
    if(on || !canStart()) return;
    if(ST.view!=='2d') setView('2d');
    var a = area();
    peer = document.createElement('canvas');
    peer.id = 'c2d-peer'; peer.className = 'compare-peer';
    peerCtx = peer.getContext('2d');
    peer.addEventListener('pointerdown', function(e){ e.preventDefault(); activate(1-active); });
    a.appendChild(peer);
    buildFrames(a);
    buildBar(a);
    a.classList.add('compare-on');
    panes[0] = capture();
    // 右の作業面: Undo の履歴は空から。中身は読み込みと同じ手順で整える
    panes[1] = {g:{DATA:planB, HISTORY:[], REDO_HISTORY:[], DIRTY:false, nextId:1,
        PLAN_LIBRARY_ID:from.libId||null, PLAN_SAVE_INFO:from.libId ? {where:'list', name:from.name, at:null} : null},
      v:Object.assign({}, panes[0].v, {selected:null, multiSelected:[], selectAll:false, drawing:false, drawPts:[]})};
    on = true; active = 0;
    withPane(1, function(){ normalizeLoadedPlan(); if(api.syncView){ ST.zoom = panes[0].v.zoom; ST.panX = panes[0].v.panX; ST.panY = panes[0].v.panY; ST.floor = panes[0].v.floor; } });
    syncPlanGlobals();
    window.addEventListener('resize', onResize);
    window.addEventListener('beforeunload', onBeforeUnload);
    layout();
    resetView();
    if(!api.syncView) withPane(1, function(){ resetView(); });
    redraw();
    status('触った側が編集中になります');
    // 左がブラウザの「前回のプラン」と同じ中身なら、保存済みと出す
    if(!PLAN_SAVE_INFO && !DIRTY) StorageAdapter.load().then(function(d){
      var strip = function(o){ o = JSON.parse(JSON.stringify(o, function(k, v){ return k==='_texObj' ? undefined : v; })); delete o.viewState; return JSON.stringify(o); };
      if(on && d && strip(d)===strip(panes[0].g.DATA)){
        panes[0].g.PLAN_SAVE_INFO = {where:'last', at:null};
        if(active===0) PLAN_SAVE_INFO = panes[0].g.PLAN_SAVE_INFO;
        render();
      }
    });
  }
  function stop(){
    if(!on) return;
    if(active!==0) activate(0);
    on = false;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('beforeunload', onBeforeUnload);
    if(peer) peer.remove(); frames.forEach(function(f){ f.remove(); }); if(bar) bar.remove();
    peer = null; frames = []; bar = null; panes = [];
    var a = area(); a.classList.remove('compare-on','compare-3d');
    canvas.style.left = '0px';
    resize2d();
  }
  // 右に書き出していない変更があれば、書き出すか捨てるかをたずねる
  function requestStop(){
    if(!on) return;
    if(!isDirty(1)){ stop(); return; }
    dialog('右のプランに、保存していない変更があります',
      '比較をやめると、右のプランは閉じます。ブラウザの一覧に保存してから閉じますか。',
      [['保存してやめる','primary',function(){ saveRight().then(function(meta){ if(meta) stop(); }); }],
       ['保存せずにやめる','',function(){ stop(); }],
       ['比較を続ける','',function(){}]]);
  }
  // 右はブラウザの一覧へ保存する（前回のプランの枠は左の物なので使わない）
  function saveRight(){
    activate(1);
    return PlanLibrary.saveCurrent({title:'右のプランを名前を付けて保存', defaultName:'比較のプラン'}).then(function(meta){
      if(meta) status('右のプランを、ブラウザの一覧「'+meta.name+'」に保存しました');
      render(); return meta;
    });
  }
  function onResize(){ if(on) redraw(); }
  function onBeforeUnload(e){ if(on && isDirty(1)){ e.preventDefault(); e.returnValue=''; } }

  // ───── 比較相手を選ぶ ─────
  function openPicker(){
    if(on){ requestStop(); return; }
    if(!canStart()) return;
    var opts = [
      ['今のプランを複製','いま開いているプランの写しを右に開きます。片方だけ変えて見比べるときに',function(){
        start(JSON.parse(serializeDataSnapshot()));
      }],
      ['JSON ファイルを開く','書き出しておいたプランを右に開きます',function(){ pickFile(); }],
      ['ブラウザに保存したプラン','「保存」や「名前を付けて保存」で残したプランから選んで、右に開きます',function(){
        PlanLibrary.openList({mode:'pick', onPick:function(plan, id, name){ start(plan, {libId:id, name:name}); }});
      }]
    ];
    dialog('比較するプランを選ぶ','いま開いているプランを左に、選んだプランを右に並べます。どちらも編集できます。',
      opts.map(function(o){ return [o[0],'choice',o[2],o[1]]; }).concat([['やめる','',function(){}]]));
  }
  function pickFile(){
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', function(){
      var f = input.files && input.files[0]; if(!f) return;
      var r = new FileReader();
      r.onload = function(e){
        var d;
        try{ d = JSON.parse(e.target.result); }catch(err){ alert('JSON ファイルとして読めませんでした。'); return; }
        if(!d || typeof d!=='object' || !Array.isArray(d.walls)){ alert('間取りのファイルではないようです。'); return; }
        start(d);
      };
      r.readAsText(f);
    });
    input.click();
  }

  // 確認の画面（一括差し替えと同じ浮いたカード）
  function dialog(title, sub, buttons){
    var old = document.getElementById('compare-modal'); if(old) old.remove();
    var m = document.createElement('div'); m.id = 'compare-modal';
    var card = document.createElement('div'); card.className = 'asset-swap-card compare-card';
    card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true');
    var h = document.createElement('div'); h.className = 'asset-swap-title'; h.textContent = title;
    var p = document.createElement('div'); p.className = 'asset-swap-sub'; p.textContent = sub;
    card.append(h, p);
    var choices = document.createElement('div'); choices.className = 'compare-choices';
    var actions = document.createElement('div'); actions.className = 'asset-swap-actions';
    var close = function(){ m.remove(); };
    buttons.forEach(function(b){
      var el = document.createElement('button'); el.type = 'button';
      if(b[1]==='choice'){
        el.className = 'compare-choice';
        el.innerHTML = '<strong></strong><small></small>';
        el.firstChild.textContent = b[0]; el.lastChild.textContent = b[3]||'';
        choices.append(el);
      }else{
        el.className = b[1]==='primary' ? 'asset-swap-apply' : 'asset-swap-cancel';
        el.textContent = b[0];
        actions.append(el);
      }
      el.addEventListener('click', function(){ close(); b[2](); });
    });
    if(choices.childNodes.length) card.append(choices);
    card.append(actions);
    m.append(card);
    m.addEventListener('click', function(e){ if(e.target===m) close(); });
    document.body.append(m);
  }
  var msgTimer = null;
  function status(msg){
    var el = bar && bar.querySelector('.compare-msg'); if(!el) return;
    el.textContent = msg; clearTimeout(msgTimer);
    msgTimer = setTimeout(function(){ el.textContent = ''; }, 6000);
  }

  // ───── 既存の処理へのつなぎ ─────
  function install(){
    var baseResize = resize2d;
    resize2d = function(){ if(on) redraw(); else baseResize(); };
    var baseDraw = draw2d;
    // 編集中の側を描いたあと、揃えるなら描くだけの側も同じ倍率・位置・階で描き直す
    draw2d = function(){
      var r = baseDraw.apply(this, arguments);
      if(on && canvas.id==='c2d'){
        var o = panes[1-active];
        if(api.syncView && (o.v.zoom!==ST.zoom || o.v.panX!==ST.panX || o.v.panY!==ST.panY || o.v.floor!==ST.floor)){
          copyViewTo(1-active); drawPeer();
        }
        render();
      }
      return r;
    };
    var baseSetView = setView;
    setView = function(v){ var r = baseSetView.apply(this, arguments); if(on){ redraw(); } return r; };
    // 右を編集中の「保存」は、ブラウザの保存枠（左の物）を上書きせず JSON に書き出す
    var baseSave = savePlanToStorage;
    savePlanToStorage = function(){
      if(on && active===1) return saveRight();
      return baseSave.apply(this, arguments);
    };
    // 「全体表示」は半分の図面に収める（元の処理は左のパネルの幅を避ける分を引くので、ずれる）
    var baseReset = resetView;
    resetView = function(){
      if(!on) return baseReset.apply(this, arguments);
      var b = planSubjectBoundsMm(ST.floor), v = visibleRect(), side = 16, top = v.top + 16, bottom = 150;
      var fit = b && planFitViewFor(b, Math.max(48, canvas.width - side*2), Math.max(48, canvas.height - top - bottom));
      if(fit){ ST.zoom = fit.zoom; ST.panX = side + fit.panX; ST.panY = top + fit.panY; }
      draw2d();
    };
    var baseShare = openShareDialog;
    openShareDialog = function(){
      if(on){ alert('比較中は共同編集を始められません。比較をやめてから使ってください。'); return; }
      return baseShare.apply(this, arguments);
    };
  }
  window.addEventListener('load', install);

  api.start = start; api.stop = stop; api.requestStop = requestStop; api.openPicker = openPicker;
  api.activate = activate; api.isOn = function(){ return on; }; api.activeSide = function(){ return active; };
  api.isDirty = isDirty; api.setPlanName = setPlanName;
  return api;
})();
