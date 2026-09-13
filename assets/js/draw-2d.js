// 平面図(2Dキャンバス)の描画。
//
// index.html のインライン script から、中身を1文字も変えずに切り出した。
// ───── 2D CANVAS ─────
var canvas=document.getElementById('c2d');
var ctx=canvas.getContext('2d');

function resize2d(){
  var a=document.getElementById('canvas-area');
  canvas.width=a.clientWidth; canvas.height=a.clientHeight;
  draw2d();
}
function w2c(wx,wy){return{cx:ST.panX+wx*ST.zoom*0.05, cy:ST.panY+wy*ST.zoom*0.05};}
function c2w(cx,cy){return{x:(cx-ST.panX)/(ST.zoom*0.05), y:(cy-ST.panY)/(ST.zoom*0.05)};}
function snapV(v){return ST.snap?Math.round(v/ST.snap)*ST.snap:Math.round(v);}
function isShiftLike(e){return !!(ST.mobileShift || (e&&e.shiftKey));}
// 複数選択は物理Shiftキーか、タッチ用の「複数選択」モードのとき。
// 仮想Shift(ST.mobileShift)は **使わない** -- あれは配置・移動スナップ専用で
// モバイルでは既定ONなので、流用すると通常のタップがすべて追加選択になる。
// ST.multiSelectMode は既定OFFの独立した切り替えなので、押したときだけ効く。
function isMultiSelectModifier(e){return !!(ST.multiSelectMode || (e&&e.shiftKey));}
// タッチでの範囲選択。1本指のドラッグは通常「図面のパン」なので、
// 複数選択モードのあいだだけ矩形選択に切り替える(パンは2本指で行える)。
function touchMarqueeActive(){
  return !!(ST.multiSelectMode && DRAG.marquee);
}
function toggleMultiSelectMode(){
  ST.multiSelectMode=!ST.multiSelectMode;
  if(!ST.multiSelectMode) DRAG.shiftClick=null;
  resetPickCycle();
  updateMultiSelectButton();
  updateProps();
  draw2d();
}
function updateMultiSelectButton(){
  var btn=document.getElementById('multi-select-btn');
  if(!btn) return;
  var n=(typeof explicit2DSelection==='function')?explicit2DSelection().length:0;
  btn.textContent=ST.multiSelectMode?('複数選択: ON'+(n>1?' ('+n+'個)':'')):'複数選択: OFF';
  btn.classList.toggle('active',!!ST.multiSelectMode);
}
function isTouchInputDevice(){
  return !!(('ontouchstart' in window) || (navigator.maxTouchPoints&&navigator.maxTouchPoints>0) || (navigator.msMaxTouchPoints&&navigator.msMaxTouchPoints>0));
}
function markAppearanceColorDirty(){
  if(!ST.appearanceColorDirty){
    saveState();
    ST.appearanceColorDirty=true;
  }
}
function commitAppearanceColorEdits(){
  if(!ST.appearanceColorDirty) return;
  ST.appearanceColorDirty=false;
  updateProps();
  if(ren) rebuild3D();
}
function finishAppearanceColorInput(){
  if(isTouchInputDevice() || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches)) return;
  releaseAppearanceColorInput(false);
  commitAppearanceColorEdits();
}
function scheduleAppearancePreviewUpdate(){
  clearTimeout(ST.appearancePreviewTimer);
  ST.appearancePreviewTimer=setTimeout(function(){
    if(ren) rebuild3D();
  },80);
}
function toggleMobileShift(){
  ST.mobileShift=!ST.mobileShift;
  ST.shiftKey=ST.mobileShift;
  updateMobileShiftButton();
  draw2d();
}
function updateMobileShiftButton(){
  var btn=document.getElementById('mobile-shift-btn');
  if(!btn) return;
  btn.textContent=ST.mobileShift?'仮想Shift: ON':'仮想Shift: OFF';
  btn.classList.toggle('active',!!ST.mobileShift);
}

var FOOTPRINTS={1:{w:11830,h:7280},2:{w:11830,h:7280},3:{w:11830,h:7280}};

// ── 平面図キャプチャ ────────────────────────────────────────────────
// 画像生成AIに「この図が家になる」と渡すための平面図は、設計以外を含んではいけない。
// メモ・定規・ウォークルート・選択枠・グリッド・下階ゴーストは、AI側が実在する物として
// 描き起こしてしまうノイズになる。ただし描画関数は分岐(=複製)させない。複製した側は
// いずれ本体と食い違い、どちらかが黙って腐る。代わりにキャプチャ中だけ有効な
// オプションを1つ持ち、既存の描画呼び出しがそれを見て対象を絞る。
// 通常描画では PLAN_CAPTURE は null で、すべての判定が「描く」に倒れる。
var PLAN_CAPTURE=null;
function planCaptureShows(key){
  return !PLAN_CAPTURE || PLAN_CAPTURE[key]!==false;
}
// 天井高ラベルだけは既定が逆。通常の 2D 表示の見た目を変えないため、
// キャプチャ中に明示的に要求されたときのみ描く。
function planCaptureCeilingLabels(){
  return !!(PLAN_CAPTURE && PLAN_CAPTURE.ceilingLabels);
}
function planCaptureDefaults(){
  return {
    annotations:false,   // メモ・定規・ウォークルート・寸法線・ロックバッジ
    selection:false,     // 選択ハイライトとハンドル
    grid:false,
    ghostFloor:false,    // 下階のゴースト
    toolOverlays:false,  // 配置ゴースト・作図プレビュー・スナップ補助線
    ceilingLabels:true
  };
}
var PLAN_CAPTURE_KEYS=['annotations','selection','grid','ghostFloor','toolOverlays','ceilingLabels'];

// ── 構図 ─────────────────────────────────────────────────────────────
// 主題 = その階の設計そのもの（壁・部屋・建具・階段・家具）。敷地・道路・隣家・
// 電柱は文脈であって主題ではない。実測(assets/default_plan.json 1F, 1400x900):
// 文脈込みの箱に合わせて撮ると、家はフレームの **5.1%** しか占めない。
// 主題だけの箱なら 72.2%。文脈を箱に入れることが、家が小さく写る原因そのものである。
function isPlanSubjectObject(o,floor){
  if(!o || o.floor!==floor) return false;
  var t=o.type;
  if(t==='site-rect') return false;                 // 敷地
  if(isPlanAnnotationType(t)) return false;         // メモ・定規・ウォークルート
  if(isContextExteriorItemType(t)) return false;    // 隣家・道路・電柱
  return true;
}
// 主題のバウンディングボックス(mm)。撮る対象が無ければ null。
function planSubjectBoundsMm(floor){
  var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,n=0;
  [].concat(DATA.walls,DATA.rooms,DATA.items).forEach(function(o){
    if(!isPlanSubjectObject(o,floor)) return;
    // DATA の壁は type を持たない（線分としてだけ在る）。getObjBounds の 'wall'
    // 分岐は 3D 側の ref 用なので、ここでは端点を直接読む。
    var pts=(o.x1!==undefined&&o.x2!==undefined)?
      [{x:o.x1,y:o.y1},{x:o.x2,y:o.y2}]:getObjBounds(o);
    pts.forEach(function(p){
      if(!isFiniteCanvasValue(p.x)||!isFiniteCanvasValue(p.y)) return;
      n++;
      minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
      maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
    });
  });
  if(!n||maxX<=minX||maxY<=minY) return null;
  return {minX:minX,minY:minY,maxX:maxX,maxY:maxY};
}
// plan_context.png が収めるべき箱 = 主題 ∪ カメラの立ち位置。
// この図の役目は「どこから撮っているか」を示すことなので、カメラの marker が
// フレームの外にあれば図は役目を果たさない。実測（既定プラン・保存視点）では
// カメラの三角が下へはみ出していた。reference.png（平面図ソース）はこの箱を
// 使わない: あちらは参照画像であり、カメラは描かれない。
function planContextBoundsMm(floor,camera){
  var b=planSubjectBoundsMm(floor);
  if(!b||!camera||!camera.posM) return b;
  // 3Dの世界座標[m] は平面の座標[mm] を U 倍したもの。x→x, z→y
  // （drawPlanCameraOverlay の planX / planY と同じ換算）。
  var cx=camera.posM[0]/U, cy=camera.posM[2]/U;
  if(!isFiniteCanvasValue(cx)||!isFiniteCanvasValue(cy)) return b;
  return {minX:Math.min(b.minX,cx),minY:Math.min(b.minY,cy),
          maxX:Math.max(b.maxX,cx),maxY:Math.max(b.maxY,cy)};
}
// 主題の周りに足す余白。1割。
var PLAN_FIT_MARGIN=0.10;
// 主題を W×H の中央に、余白1割で収めるパン・ズーム。
function planFitViewFor(bounds,W,H){
  if(!bounds||!(W>0)||!(H>0)) return null;
  var bw=bounds.maxX-bounds.minX, bh=bounds.maxY-bounds.minY;
  if(!(bw>0)||!(bh>0)) return null;
  var pxPerMm=Math.min(W/bw,H/bh)/(1+PLAN_FIT_MARGIN);
  var zoom=Math.max(0.05,Math.min(40,pxPerMm/0.05));
  var sc=zoom*0.05;
  return {
    zoom:zoom,
    panX:W/2-(bounds.minX+bounds.maxX)/2*sc,
    panY:H/2-(bounds.minY+bounds.maxY)/2*sc
  };
}
// 主題がフレームの何割を占めるか。**画面外は数えない** — 見切れた分は参照に
// 写っておらず、生成AIには存在しない。
// これは**測るだけ**の関数である。かつてここに下限を設けて ZIP を作らない規則が
// あったが、「主題が小さいと生成AIは空の映像を返す」という根拠は一度も測って
// いなかった。余白が大きければ生成AIの描く余地が増えるだけで、空になるとは
// 限らない。値は package.json (capture.subjectFrameRatio) に**記録する**。
// 拒否ではなく開示にする。
function planSubjectFrameRatio(bounds,view,W,H){
  if(!bounds||!view||!(W>0)||!(H>0)) return 0;
  var sc=view.zoom*0.05;
  var x0=view.panX+bounds.minX*sc, x1=view.panX+bounds.maxX*sc;
  var y0=view.panY+bounds.minY*sc, y1=view.panY+bounds.maxY*sc;
  var w=Math.max(0,Math.min(W,x1)-Math.max(0,x0));
  var h=Math.max(0,Math.min(H,y1)-Math.max(0,y0));
  // 面積比ではなく**長い方の軸の占有率**で見る。面積比は縦横比に引きずられる:
  // 縦長のフレーム(スマホ縦持ち)に横長の家を正しく fit しても、面積では
  // 2〜3割にしかならず、正しく合わせた構図まで落としてしまう。
  // このアプリは house-planner **mobile** であり、縦持ちは主要な使い方なので、
  // そこで必ず失敗する検査は使えない。fit すれば主題はどちらかの軸をほぼ
  // 埋めるので、長い方の軸の占有率で「大きさが足りているか」を判定できる。
  return Math.max(w/W,h/H);
}
// 見切れの拒否はここにあったが撤去した。fit を通したあとは構造上 false であり、
// 守っていたのは「fit が構図を作れなかったとき」だけ。それは見切れではなく
// 空の階の話なので、そう名乗る検査 (planEmptyFloorRefusal) に一本化した。
// 最後に撮った平面図の座標系。撮影中だけ変えたパン・ズーム・倍率を、撮った画像を
// 画素で調べる側（プレースホルダ検出・構図の検査）へ渡すために残す。
var PLAN_CAPTURE_VIEW=null;
// 撮影中の倍率。文字の大きさの**下限**だけがこれを見る。下限（10px 等）は
// 「画面で読める大きさ」のための値で、画素を増やしただけで図の中の文字が
// 相対的に縮むのは倍率の副作用でしかない。通常表示と等倍キャプチャでは 1 で、
// 何も変わらない。
var PLAN_CAPTURE_SCALE=1;
function planCaptureMinFont(px){ return px*PLAN_CAPTURE_SCALE; }
// options = {annotations:false, ceilingLabels:true, selection:false, grid:false, ghostFloor:false}
// floor を渡すと、その階を一時的に描いて撮る。撮り終えたら必ず元の表示へ戻す。
// fit:true は主題に構図を合わせ、scale はその倍率で撮る。どちらも**撮影中だけ**の
// 変更で、finally でパン・ズーム・キャンバス寸法まで戻す（ユーザーの画面は動かない）。
function capturePlan2dDataUrl(options){
  var opt=options||{};
  var cfg=planCaptureDefaults();
  PLAN_CAPTURE_KEYS.forEach(function(k){
    if(opt[k]!==undefined) cfg[k]=!!opt[k];
  });
  var prevCapture=PLAN_CAPTURE;
  var prevFloor=ST.floor;
  var prevPanX=ST.panX, prevPanY=ST.panY, prevZoom=ST.zoom;
  var prevW=canvas.width, prevH=canvas.height;
  var scale=Number(opt.scale)||1;
  if(!(scale>0)||!isFinite(scale)) scale=1;
  try{
    if(opt.floor!==undefined && opt.floor!==null) ST.floor=opt.floor;
    if(opt.fit){
      // 撮る前に構図を作る。ユーザーが眺めていた倍率は、生成AIに渡す絵の
      // 解像度とは何の関係もない。
      // fitBounds を渡せばその箱に合わせる（plan_context.png はカメラ込みの箱）。
      // 省略時は主題そのもの（reference.png はこちら）。
      var fitView=planFitViewFor(opt.fitBounds||planSubjectBoundsMm(ST.floor),prevW,prevH);
      if(fitView){ ST.panX=fitView.panX; ST.panY=fitView.panY; ST.zoom=fitView.zoom; }
    }
    if(scale!==1){
      // 画素だけを増やす。パン・ズームを同じ倍率で引き伸ばすので、フレームに
      // 対する構図は1倍のときと同じままになる。
      canvas.width=Math.round(prevW*scale);
      canvas.height=Math.round(prevH*scale);
      ST.panX*=scale; ST.panY*=scale; ST.zoom*=scale;
      PLAN_CAPTURE_SCALE=scale;
    }
    PLAN_CAPTURE=cfg;
    // 撮った画像を画素で調べる側は、この座標系で読む必要がある。
    PLAN_CAPTURE_VIEW={panX:ST.panX,panY:ST.panY,zoom:ST.zoom,
      width:canvas.width,height:canvas.height,floor:ST.floor,scale:scale};
    draw2d();
    return canvas.toDataURL(opt.mimeType||'image/png');
  }finally{
    // 途中で落ちても、ユーザーが見ている画面を欠けたまま放置しない。
    PLAN_CAPTURE=prevCapture;
    PLAN_CAPTURE_SCALE=1;
    ST.floor=prevFloor;
    ST.panX=prevPanX; ST.panY=prevPanY; ST.zoom=prevZoom;
    if(canvas.width!==prevW) canvas.width=prevW;
    if(canvas.height!==prevH) canvas.height=prevH;
    if(!prevCapture){
      try{ draw2d(); }catch(e){}
    }
  }
}

function draw2d(){
  ensureObjectIds();
  var W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#f2f4f7'; ctx.fillRect(0,0,W,H);
  if(ST.showGrid && planCaptureShows('grid')) drawGrid();
  var sc=ST.zoom*0.05;
  var fw=DATA.walls.filter(function(w){return w.floor===ST.floor;});
  var fi=DATA.items.filter(function(i){return i.floor===ST.floor;});

  // 0. Floor below ghost – 1つ下のフロアをうっすら表示（2F編集時に1Fが見える）
  var ghostFloor = ST.floor - 1;
  if(ghostFloor >= 1 && planCaptureShows('ghostFloor')) {
    ctx.save(); ctx.globalAlpha = 0.22;
    DATA.rooms.filter(function(r){return r.floor===ghostFloor;}).forEach(function(r){
      var px=ST.panX+r.x*sc, py=ST.panY+r.y*sc, w=r.w*sc, d=r.d*sc;
      ctx.fillStyle='rgba(160,160,210,0.4)'; ctx.fillRect(px,py,w,d);
      ctx.strokeStyle='#6070a0'; ctx.lineWidth=1; ctx.strokeRect(px,py,w,d);
    });
    DATA.walls.filter(function(w){return w.floor===ghostFloor;}).forEach(drawWall2d);
    ctx.restore();
  }

  // 1. Sites (1F-only Base Layer)
  if(ST.floor===1) DATA.items.filter(function(i){return i.type==='site-rect';}).forEach(function(i){
    drawItem2d(i);
    if(ST.selected===i && ST.tool==='select'){
      var ccx=ST.panX+(i.x+i.w/2)*sc, ccy=ST.panY+(i.y+i.d/2)*sc;
      drawHandles(i, ccx, ccy, i.w*sc/2, i.d*sc/2, sc);
    }
  });
  // 2. Foundation (above site, below building plan)
  if(ST.floor===1) DATA.items.filter(function(i){return i.type==='foundation';}).forEach(drawItem2d);
  // 3. Rooms
  DATA.rooms.filter(function(r){return r.floor===ST.floor;}).forEach(function(r){
    var px=ST.panX+r.x*sc, py=ST.panY+r.y*sc, w=r.w*sc, d=r.d*sc;
    var sel=planCaptureShows('selection') && (ST.selected===r || (ST.selectAll && r.floor===ST.floor));
    ctx.save();
    ctx.shadowBlur=12; ctx.shadowColor='rgba(0,0,0,0.06)';
    ctx.fillStyle='rgba(252,251,248,0.95)';
    ctx.fillRect(px,py,w,d);
    ctx.restore();
    ctx.strokeStyle=sel?'#e94560':'rgba(0,0,0,0.1)';
    ctx.lineWidth=sel?3.5:1.2;
    ctx.strokeRect(px,py,w,d);
    if(ST.selected===r&&ST.tool==='select') drawHandles(r,px+w/2,py+d/2,w/2,d/2,sc);
  });
  // 4. Walls
  fw.forEach(drawWall2d);
  if(ST.selected && ST.selected.x1!==undefined && ST.selected.x2!==undefined) drawWallHandles(ST.selected);
  // 5. Other Items
  fi.filter(function(i){return i.type!=='site-rect' && i.type!=='foundation';}).forEach(drawItem2d);
  // Finish labels stay legible above decks and paving, without extra parcel lines.
  if(ST.floor===1) DATA.items.filter(function(i){return i.type==='site-rect'&&i.siteBoundary;}).forEach(function(it){
    ctx.save();ctx.font='11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    siteFinishZones(it).forEach(function(z){
      var x=ST.panX+(it.x+z.x+z.w/2)*sc,y=ST.panY+(it.y+z.y+z.d/2)*sc;
      var tw=ctx.measureText(z.name).width+12;
      ctx.fillStyle='rgba(255,255,255,0.92)';ctx.fillRect(x-tw/2,y-10,tw,20);
      ctx.fillStyle='#334b45';ctx.fillText(z.name,x,y);
    });
    ctx.restore();
  });

  // Ghost Previews
  if(ST.drawing && planCaptureShows('toolOverlays') && (ST.tool==='room-rect' || (ST.tool==='site-rect'&&ST.floor===1))) {
    var p1=ST.drawPts[0], p2=ST.mouseW;
    var x1=Math.min(p1.x,p2.x), y1=Math.min(p1.y,p2.y), rw=Math.abs(p1.x-p2.x), rd=Math.abs(p1.y-p2.y);
    ctx.strokeStyle='rgba(48,128,232,0.5)'; ctx.setLineDash([5,5]);
    ctx.strokeRect(ST.panX+x1*sc, ST.panY+y1*sc, rw*sc, rd*sc);
    ctx.setLineDash([]);
  }
  // ── Ghost preview + placement dimensions ──
  var openingGhostPreset=getOpeningModelToolPreset(ST.tool);
  var ghostToolType=openingGhostPreset?openingGhostPreset.baseType:ST.tool;
  if(!ST.drawing && planCaptureShows('toolOverlays') && (ISIZES[ghostToolType]||isFmpItemType(ghostToolType)||openingGhostPreset) && ghostToolType!=='site-rect' && !(ST.floor!==1 && (ghostToolType==='foundation'||ghostToolType==='exterior-stair'||ghostToolType==='ramp')) && ST.view === '2d') {
    var mx = snapV(ST.mouseW.x), my = snapV(ST.mouseW.y);
    var sz = getItemDefaultSize(ghostToolType);
    var ghost = {type:ghostToolType, x:mx - sz.w/2, y:my - sz.d/2, w:sz.w, d:sz.d, rot:ST.placingRot||0, floor:ST.floor, flipX:false, flipY:false, sScale:1, sX:0, sY:0};
    if(openingGhostPreset){
      if(isWindowLikeType(ghost.type)){ghost.windowSill=ghost.type==='window-door'?0:900;ghost.windowHeight=ghost.type==='window-door'?2100:1200;}
      if(isDoorLikeOpeningType(ghost.type)){ghost.doorHeight=2000;if(isDoorPanelType(ghost.type)) ghost.doorOpenState='open';}
      applyOpeningModelToItem(ghost,openingGhostPreset.openingModel);
      sz={w:ghost.w,d:ghost.d};
    }
    var ghostGrid=snapRectOriginToGrid(ghost.x,ghost.y,ghost.w,ghost.d,ghost.rot||0);
    ghost.x=ghostGrid.x; ghost.y=ghostGrid.y;
    if(ST.shiftKey){
      var ghostObjectSnap=applyEdgeSnap(ghost.x,ghost.y,ghost.w,ghost.d,null,ghost.rot||0);
      ghost.x=ghostObjectSnap.x; ghost.y=ghostObjectSnap.y;
      ST._snapState=ghostObjectSnap;
    }else ST._snapState=null;
    mx=ghost.x+ghost.w/2; my=ghost.y+ghost.d/2;
    ctx.save(); ctx.globalAlpha=0.5; drawItem2d(ghost); ctx.restore();
    // Dimension label near ghost
    drawPlacementDim(mx, my, sz.w, sz.d, ST.placingRot||0);
  }
  // ── Room-rect preview dimensions ──
  if(ST.drawing && planCaptureShows('toolOverlays') && (ST.tool==='room-rect'||(ST.tool==='site-rect'&&ST.floor===1)) && ST.drawPts.length>0) {
    var p1=ST.drawPts[0], p2=ST.mouseW;
    var rw=Math.abs(snapV(p2.x)-p1.x), rd=Math.abs(snapV(p2.y)-p1.y);
    if(rw>50&&rd>50) drawRectDim(Math.min(p1.x,snapV(p2.x)), Math.min(p1.y,snapV(p2.y)), rw, rd);
  }

  drawRoomLbls();
  if(ST.drawing&&ST.drawPts.length>0&&planCaptureShows('toolOverlays')) drawPreview();
  // 寸法線は設計そのものではなく図面上の注記なので、キャプチャでは注記側に含める
  if(ST.showDim && planCaptureShows('annotations')) drawDim();
  drawMultiSelectionOverlays();
  if(DRAG.marquee){var m=DRAG.marquee,a=w2c(m.start.x,m.start.y),b=w2c(m.end.x,m.end.y);ctx.save();ctx.fillStyle='rgba(233,69,96,.08)';ctx.strokeStyle='#e94560';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.fillRect(a.cx,a.cy,b.cx-a.cx,b.cy-a.cy);ctx.strokeRect(a.cx,a.cy,b.cx-a.cx,b.cy-a.cy);ctx.restore();}
  drawLockOverlays(fw,fi);
  drawBaseSelectionOverlay();
  document.getElementById('st-walls').textContent='壁:'+fw.length;
  syncLockBatchUi();
  // ── Snap guide lines ──
  if(ST._snapState&&planCaptureShows('toolOverlays')&&(DRAG.active||ST.tool!=='select')){
    var sc3=ST.zoom*0.05;
    ctx.save(); ctx.setLineDash([4,3]); ctx.lineWidth=1.5;
    if(ST._snapState.snapX&&ST._snapState.snapXVal!==null){
      var sx=ST.panX+ST._snapState.snapXVal*sc3;
      ctx.strokeStyle='rgba(255,120,0,0.75)';
      ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,canvas.height);ctx.stroke();
    }
    if(ST._snapState.snapY&&ST._snapState.snapYVal!==null){
      var sy=ST.panY+ST._snapState.snapYVal*sc3;
      ctx.strokeStyle='rgba(255,120,0,0.75)';
      ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(canvas.width,sy);ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
}

function drawMultiSelectionOverlays(){
  if(!planCaptureShows('selection')) return;
  var selected=(ST.multiSelected||[]).filter(function(obj){return obj && (obj.floor||1)===ST.floor;});
  if(!selected.length || ST.tool!=='select') return;
  var sc=ST.zoom*0.05;
  ctx.save();
  ctx.strokeStyle='rgba(233,69,96,0.95)';
  ctx.fillStyle='rgba(233,69,96,0.08)';
  ctx.lineWidth=2;
  ctx.setLineDash([6,4]);
  selected.forEach(function(obj){
    if(obj.x1!==undefined && obj.x2!==undefined){
      var a=w2c(obj.x1,obj.y1), b=w2c(obj.x2,obj.y2);
      ctx.beginPath(); ctx.moveTo(a.cx,a.cy); ctx.lineTo(b.cx,b.cy); ctx.stroke();
      return;
    }
    if(obj.type==='room'){
      ctx.fillRect(ST.panX+obj.x*sc,ST.panY+obj.y*sc,obj.w*sc,obj.d*sc);
      ctx.strokeRect(ST.panX+obj.x*sc,ST.panY+obj.y*sc,obj.w*sc,obj.d*sc);
      return;
    }
    var pose=getItemDisplayPose(obj);
    var half=getItemSelectionHalfExtentsPx(obj,sc);
    ctx.save();
    ctx.translate(ST.panX+pose.x*sc,ST.panY+pose.y*sc);
    ctx.rotate((pose.rot||0)*Math.PI/180);
    ctx.fillRect(-half.hw,-half.hd,half.hw*2,half.hd*2);
    ctx.strokeRect(-half.hw,-half.hd,half.hw*2,half.hd*2);
    ctx.restore();
  });
  ctx.restore();
}

function drawGrid(){
  var sc=ST.zoom*0.05, mg=910*sc;
  if(mg<3) return;
  var ox=((ST.panX%mg)+mg)%mg, oy=((ST.panY%mg)+mg)%mg;
  ctx.save();
  // 910mmモジュール線は建築製図の通り芯の慣例に倣い一点鎖線(細線)で表現する
  ctx.strokeStyle='rgba(40,60,90,0.16)'; ctx.lineWidth=1; ctx.setLineDash([9,3,1.5,3]);
  for(var x=ox;x<canvas.width;x+=mg){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(var y=oy;y<canvas.height;y+=mg){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  ctx.setLineDash([]);
  if(sc*455>10){
    var sg=455*sc,ox2=((ST.panX%sg)+sg)%sg,oy2=((ST.panY%sg)+sg)%sg;
    ctx.strokeStyle='rgba(0,0,0,0.05)'; ctx.setLineDash([1.5,3]);
    for(var x=ox2;x<canvas.width;x+=sg){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
    for(var y=oy2;y<canvas.height;y+=sg){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawAreaTag(cx,cy,w,d,name,isSelected){
  if(!isFiniteCanvasValue(cx) || !isFiniteCanvasValue(cy) || !isFiniteCanvasValue(w) || !isFiniteCanvasValue(d)) return;
  var p=w2c(cx,cy);
  var sqm = (w * d) / 1000000;
  var tatami = sqm / 1.62;
  var areaStr = tatami.toFixed(1) + '畳 / ' + sqm.toFixed(2) + '㎡';
  var showArea = ST.zoom >= 0.4;
  var szN=Math.max(planCaptureMinFont(10),ST.zoom*0.8), szA=Math.max(planCaptureMinFont(8),ST.zoom*0.55);
  ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
  var tw=Math.max(ctx.measureText(name).width, showArea?ctx.measureText(areaStr).width:0)+18;
  var th=showArea?szN+szA+14:szN+12;
  ctx.save();
  ctx.translate(p.cx,p.cy);
  if(isSelected) {
    ctx.shadowBlur=10; ctx.shadowColor='rgba(0,120,255,0.5)';
    ctx.strokeStyle='#0078ff'; ctx.lineWidth=2;
  }
  ctx.fillStyle='rgba(255,255,255,0.88)';
  ctx.beginPath(); ctx.roundRect(-tw/2,-th/2,tw,th,6); ctx.fill();
  if(isSelected) ctx.stroke();
  ctx.restore();
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
  ctx.fillStyle='#222';
  ctx.fillText(name, p.cx, showArea ? p.cy-szA/2-2 : p.cy);
  if(showArea){
    ctx.font=szA+'px "Noto Sans JP",sans-serif';
    ctx.fillStyle='#666';
    ctx.fillText(areaStr, p.cx, p.cy+szN/2+3);
  }
}

// 段差のある部屋の輪郭。平面図では段差が見えないので、線を引かないと
// 「なぜこの部屋だけ天井が高いのか」が図面から読めない。
// JIS の段差表現に倣い、低いレベルに面した辺だけを太い実線で引く
// (外壁側・同じレベルの側は段差ではないので引かない)。
function drawSkipLevelEdges2d(room){
  if(roomSkipLevelMm(room)<=0) return;
  var open=roomSkipOpenSides(room);
  if(!open.n&&!open.s&&!open.w&&!open.e) return;
  var a=w2c(room.x,room.y), b=w2c(room.x+room.w,room.y+room.d);
  ctx.save();
  ctx.strokeStyle='rgba(40,60,90,0.75)';
  ctx.lineWidth=Math.max(1.6,ST.zoom*0.09);
  ctx.setLineDash([]);
  function line(x1,y1,x2,y2){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
  if(open.n) line(a.cx,a.cy,b.cx,a.cy);
  if(open.s) line(a.cx,b.cy,b.cx,b.cy);
  if(open.w) line(a.cx,a.cy,a.cx,b.cy);
  if(open.e) line(b.cx,a.cy,b.cx,b.cy);
  ctx.restore();
}
function drawRoomLbls(){
  var fr=DATA.rooms.filter(function(r){return r.floor===ST.floor;});
  fr.forEach(function(l){
    drawSkipLevelEdges2d(l);
    drawAreaTag(l.x+l.w/2,l.y+l.d/2,l.w,l.d,l.n||'部屋',planCaptureShows('selection')&&ST.selected===l);
    drawCeilingLabel2d(l);
  });
  DATA.items.filter(function(i){return i.floor===ST.floor && i.type==='balcony';}).forEach(function(it){
    drawAreaTag(it.x+it.w/2,it.y+it.d/2,it.w,it.d,it.n||ILABELS[it.type]||'バルコニー',planCaptureShows('selection')&&ST.selected===it);
  });
}
// 天井高は、生成AIが「その空間がどれだけ高いか」を知る唯一の手がかりなので、
// 注記を落としたキャプチャでも残す。部屋名タグの真下に小さく置いて重ねない。
// 明示の天井高が無い部屋にも出す -- AIが必要とするのは入力の有無ではなく、
// レンダが実際に置いた高さだから。数値は roomRenderedCeilingLabel が
// roomCeilingHeightM(=レンダの経路)から解決する。HeightModel.ceilingLabel を
// 直接呼ぶと、明示の無い部屋に既定 2400 と書いて絵と食い違う。
function drawCeilingLabel2d(room){
  // 天井高は「キャプチャのときだけ」だが、**床の段差は編集中も出す**。
  // 段差は平面図では見えないので、編集画面で分からないと、どの部屋を
  // 持ち上げたのかが自分の記憶にしか残らない。
  var lvl=roomLevelLabel(room);
  if(!planCaptureCeilingLabels()&&!lvl) return;
  if(!isFiniteCanvasValue(room.x)||!isFiniteCanvasValue(room.y)||!isFiniteCanvasValue(room.w)||!isFiniteCanvasValue(room.d)) return;
  var text=planCaptureCeilingLabels()?roomHeightLabel(room):lvl;
  var p=w2c(room.x+room.w/2,room.y+room.d/2);
  var szN=Math.max(planCaptureMinFont(10),ST.zoom*0.8), szA=Math.max(planCaptureMinFont(8),ST.zoom*0.55);
  var tagH=(ST.zoom>=0.4)?(szN+szA+14):(szN+12);
  var sz=Math.max(planCaptureMinFont(9),ST.zoom*0.5);
  var cy=p.cy+tagH/2+sz*0.85;
  // 部屋からはみ出すなら部屋の内側に収める
  var bottom=w2c(room.x,room.y+room.d).cy-sz*0.7;
  if(cy>bottom) cy=Math.max(p.cy+tagH/2+2,bottom);
  ctx.save();
  ctx.font=sz+'px "Noto Sans JP",sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  var tw=ctx.measureText(text).width+10;
  ctx.fillStyle='rgba(255,255,255,0.82)';
  ctx.beginPath(); ctx.roundRect(p.cx-tw/2,cy-sz*0.75,tw,sz*1.5,4); ctx.fill();
  ctx.fillStyle='#555';
  ctx.fillText(text,p.cx,cy);
  ctx.restore();
}

function drawWall2d(w){
  var a=w2c(w.x1,w.y1),b=w2c(w.x2,w.y2);
  var dx=b.cx-a.cx,dy=b.cy-a.cy,len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return;
  var nx=-dy/len,ny=dx/len,t=w.thick*ST.zoom*0.05/2;
  // 出隅では相手の厚みの半分ぶん端を伸ばす。芯線の端を同じ点に置いただけだと
  // 「厚/2 × 厚/2」の四角が両方の矩形から外れ、角が階段状に欠ける(3Dと同じ理由)
  var px=ST.zoom*0.05, ux=dx/len, uy=dy/len;
  var e1=wallEndCornerExtensionMm(w,false)*px, e2=wallEndCornerExtensionMm(w,true)*px;
  a={cx:a.cx-ux*e1, cy:a.cy-uy*e1};
  b={cx:b.cx+ux*e2, cy:b.cy+uy*e2};
  var sel=ST.selected===w;
  ctx.save();
  // JIS A0150(建築製図通則)/公共建築工事標準仕様書に準拠した壁の断面表現:
  // 壁体断面は塗りつぶし(黒に近い濃色)+ 最も太い外形線とし、図面上で最優先の線種として扱う。
  // ドロップシャドウ等の装飾効果は製図表現に存在しないため付与しない。
  ctx.beginPath();
  ctx.moveTo(a.cx+nx*t,a.cy+ny*t); ctx.lineTo(b.cx+nx*t,b.cy+ny*t);
  ctx.lineTo(b.cx-nx*t,b.cy-ny*t); ctx.lineTo(a.cx-nx*t,a.cy-ny*t);
  ctx.closePath();
  if(planCaptureShows('selection') && (sel||(ST.selectAll && w.floor===ST.floor))){
    ctx.fillStyle='rgba(233,69,96,0.95)'; ctx.fill();
    ctx.strokeStyle='#e94560'; ctx.lineWidth=2.6; ctx.stroke();
  } else {
    ctx.fillStyle='#2b2b2b'; ctx.fill();
    ctx.strokeStyle='#000'; ctx.lineWidth=2.4; ctx.stroke();
  }
  ctx.restore();
}

function drawLockBadgePx(cx,cy){
  ctx.save();
  ctx.translate(cx,cy);
  // Small monochrome lock: stays legible without covering room names with emoji.
  ctx.fillStyle='rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#65736c'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(0,-2,2,Math.PI,0); ctx.stroke();
  ctx.strokeRect(-3,-2,6,5);
  ctx.restore();
}

function drawLockOverlays(fw,fi){
  // 施錠バッジは編集用の目印であって設計要素ではない
  if(!planCaptureShows('annotations')) return;
  DATA.rooms.filter(function(r){return r.floor===ST.floor && isObjectLocked(r);}).forEach(function(r){
    var p=w2c(r.x+r.w/2,r.y+r.d/2);
    drawLockBadgePx(p.cx,p.cy);
  });
  fw.filter(isObjectLocked).forEach(function(w){
    var p=w2c((w.x1+w.x2)/2,(w.y1+w.y2)/2);
    drawLockBadgePx(p.cx,p.cy);
  });
  fi.filter(isObjectLocked).forEach(function(it){
    var p=w2c((it.x||0)+(it.w||0)/2,(it.y||0)+(it.d||0)/2);
    drawLockBadgePx(p.cx,p.cy);
  });
}
function drawBaseSelectionOverlay(){
  if(!planCaptureShows('selection')) return;
  if(ST.tool!=='select' || ST.floor!==1 || !ST.selected || ST.selected.type!=='foundation') return;
  var it=ST.selected;
  var sc=ST.zoom*0.05;
  var pose=getItemDisplayPose(it);
  var p=w2c(pose.x,pose.y);
  var selHalf=getItemSelectionHalfExtentsPx(it,sc);
  drawHandles(it,p.cx,p.cy,selHalf.hw,selHalf.hd,sc,pose.rot||0);
}

function isOpeningItemType(type){
  return isWindowLikeType(type) || isDoorLikeOpeningType(type);
}
function getOpeningWallInfo(it){
  if(!isOpeningItemType(it.type)) return null;
  var centers=getOpeningCenterCandidates(it);
  function findBestForCenter(cen){
    var best=null, bestD=999999, bestT=0;
    var cx=cen.x, cy=cen.y;
    DATA.walls.filter(function(w){return w.floor===it.floor;}).forEach(function(w){
      var dx=w.x2-w.x1, dy=w.y2-w.y1;
      var len2=dx*dx+dy*dy;
      if(len2<1) return;
      var t=((cx-w.x1)*dx+(cy-w.y1)*dy)/len2;
      var tc=Math.max(0,Math.min(1,t));
      var px=w.x1+tc*dx, py=w.y1+tc*dy;
      var d=Math.hypot(cx-px,cy-py);
      if(d<bestD){bestD=d;best=w;bestT=tc;}
    });
    return {wall:best,dist:bestD,t:bestT,center:cen};
  }
  var primary=findBestForCenter(centers[0]);
  var chosen=primary;
  if(primary.dist>400 && centers.length>1){
    for(var ci=1; ci<centers.length; ci++){
      var cand=findBestForCenter(centers[ci]);
      if(cand.dist<chosen.dist) chosen=cand;
    }
  }
  var best=chosen.wall, bestD=chosen.dist, bestT=chosen.t, bestCenter=chosen.center;
  if(!best || bestD>400) return null;
  var wdx=best.x2-best.x1, wdy=best.y2-best.y1;
  var wlen=Math.sqrt(wdx*wdx+wdy*wdy);
  var openingHalf=Math.min(wlen/2, Math.max(0,(it.w||0)/2));
  var edgeT=wlen>1 ? openingHalf/wlen : 0;
  var snappedT=Math.max(edgeT,Math.min(1-edgeT,bestT));
  return {
    wall:best,
    dist:bestD,
    t:snappedT,
    rawT:bestT,
    center:bestCenter,
    x:best.x1+wdx*snappedT,
    y:best.y1+wdy*snappedT,
    rot:Math.atan2(wdy,wdx)*180/Math.PI
  };
}
function getOpeningCenterCandidates(it){
  var a={x:it.x+it.w/2,y:it.y+it.d/2};
  var b={x:it.x+it.d/2,y:it.y+it.w/2};
  if(Math.abs(a.x-b.x)<0.001 && Math.abs(a.y-b.y)<0.001) return [a];
  return [a,b];
}
function getOpeningCenter(it){
  var info=getOpeningWallInfo(it);
  return info&&info.center ? info.center : getOpeningCenterCandidates(it)[0];
}
function getItemDisplayPose(it){
  if(it && isOpeningItemType(it.type)){
    var info=getOpeningWallInfo(it);
    if(info) return {x:info.x,y:info.y,rot:info.rot,wallInfo:info};
  }
  return {x:it.x+it.w/2,y:it.y+it.d/2,rot:it.rot||0,wallInfo:null};
}
function getItem2dFillColor(it){
  if(it && it.colorCustom && it.color) return it.color;
  return (it && ICOLORS[it.type]) || '#dddddd';
}

function memoTextValue(it){
  var text=it&&it.noteText!==undefined?String(it.noteText):'';
  return text.trim()?text:'メモ';
}
function wrapMemoLines(text,maxWidth,maxLines){
  var lines=[];
  var truncated=false;
  var paragraphs=String(text||'').replace(/\r\n/g,'\n').split('\n');
  function pushLine(line){
    if(lines.length>=maxLines){truncated=true; return false;}
    lines.push(line);
    return true;
  }
  for(var pi=0; pi<paragraphs.length; pi++){
    var para=paragraphs[pi];
    if(!para){
      if(!pushLine('')) break;
    } else {
      var cur='';
      Array.from(para).forEach(function(ch){
        if(truncated) return;
        var next=cur+ch;
        if(cur && ctx.measureText(next).width>maxWidth){
          if(!pushLine(cur)) return;
          cur=ch;
        } else {
          cur=next;
        }
      });
      if(truncated || !pushLine(cur)) break;
    }
    if(pi<paragraphs.length-1 && lines.length>=maxLines){truncated=true; break;}
  }
  if(truncated && lines.length){
    var last=lines[maxLines-1]||'';
    while(last.length>1 && ctx.measureText(last+'...').width>maxWidth) last=last.slice(0,-1);
    lines[maxLines-1]=last+'...';
  }
  return lines;
}
function drawMemo2d(it,sc){
  var w=Math.max(1,(it.w||1400)*sc), h=Math.max(1,(it.d||850)*sc);
  var hw=w/2, hd=h/2;
  var bg=it.color||'#fff3a6';
  var border=ST.selected===it?'#e94560':'rgba(136,110,32,0.62)';
  ctx.save();
  ctx.shadowBlur=ST.selected===it?12:8;
  ctx.shadowColor=ST.selected===it?'rgba(233,69,96,0.28)':'rgba(0,0,0,0.16)';
  ctx.fillStyle=bg;
  ctx.strokeStyle=border;
  ctx.lineWidth=ST.selected===it?2:1.2;
  ctx.beginPath();
  ctx.roundRect(-hw,-hd,w,h,Math.min(10,Math.max(3,Math.min(w,h)*0.08)));
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur=0;
  var fold=Math.min(18,Math.max(8,Math.min(w,h)*0.15));
  ctx.fillStyle='rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.moveTo(hw-fold,-hd);
  ctx.lineTo(hw,-hd);
  ctx.lineTo(hw,-hd+fold);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle='rgba(136,110,32,0.28)';
  ctx.beginPath();
  ctx.moveTo(hw-fold,-hd);
  ctx.lineTo(hw-fold,-hd+fold);
  ctx.lineTo(hw,-hd+fold);
  ctx.stroke();
  var pad=Math.max(8,Math.min(16,Math.min(w,h)*0.12));
  var textW=Math.max(1,w-pad*2);
  var textH=Math.max(1,h-pad*2);
  var fs=Math.max(9,Math.min(15,Math.min(textW/8,textH/3)));
  var lh=fs*1.42;
  var maxLines=Math.max(1,Math.floor(textH/lh));
  ctx.beginPath();
  ctx.rect(-hw+pad,-hd+pad,textW,textH);
  ctx.clip();
  ctx.font='600 '+fs+'px "Noto Sans JP",sans-serif';
  ctx.textAlign='left';
  ctx.textBaseline='top';
  ctx.fillStyle='rgba(47,43,30,0.92)';
  var lines=wrapMemoLines(memoTextValue(it),textW,maxLines);
  lines.forEach(function(line,idx){
    ctx.fillText(line,-hw+pad,-hd+pad+idx*lh);
  });
  ctx.restore();
}

function rulerLengthMm(it){
  return Math.max(0,Number(it&&it.w)||0);
}
function copyWalkRoutePoint(p){
  return {x:Number(p&&p.x)||0,y:Number(p&&p.y)||0};
}
function getWalkRouteLocalPoints(it){
  if(it && Array.isArray(it.pathPoints) && it.pathPoints.length>=2){
    return it.pathPoints.map(copyWalkRoutePoint);
  }
  var len=Math.max(0,Number(it&&it.w)||0);
  if(len<1) return [];
  return [{x:-len/2,y:0},{x:len/2,y:0}];
}
function getWalkRouteWorldPoints(it){
  var pts=getWalkRouteLocalPoints(it);
  if(!pts.length) return [];
  var pose=getItemDisplayPose(it);
  var rad=(pose.rot||0)*Math.PI/180;
  var cos=Math.cos(rad), sin=Math.sin(rad);
  return pts.map(function(p){
    return {
      x:pose.x+p.x*cos-p.y*sin,
      y:pose.y+p.x*sin+p.y*cos
    };
  });
}
function walkRoutePathLengthMmFromPoints(points){
  if(!points || points.length<2) return 0;
  var len=0;
  for(var i=1;i<points.length;i++){
    len+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
  }
  return len;
}
function walkRouteLengthMm(it){
  return walkRoutePathLengthMmFromPoints(getWalkRouteLocalPoints(it));
}
function walkRouteSegmentCount(it){
  return Math.max(0,getWalkRouteLocalPoints(it).length-1);
}
function walkRouteSpeedMps(it){
  var v=Number(it&&it.walkSpeed);
  if(!isFinite(v)) v=WALK_DEFAULT_SPEED_MPS;
  return Math.max(0.1,Math.min(3,v));
}
function walkRouteDurationSec(it){
  var lenM=walkRouteLengthMm(it)/1000;
  return lenM/Math.max(0.1,walkRouteSpeedMps(it));
}
function formatWalkRouteDistance(lenMm){
  lenMm=Math.max(0,Number(lenMm)||0);
  if(lenMm>=1000){
    var m=lenMm/1000;
    var fixed=m>=10?m.toFixed(1):m.toFixed(2);
    return fixed.replace(/\.0+$/,'').replace(/(\.\d)0$/,'$1')+'m';
  }
  return Math.round(lenMm)+'mm';
}
function makeWalkRouteShapeFromWorldPoints(points, floor, color, speed){
  var clean=(points||[]).filter(function(p){
    return p && isFiniteCanvasValue(p.x) && isFiniteCanvasValue(p.y);
  }).map(copyWalkRoutePoint);
  if(clean.length<2) return null;
  var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  clean.forEach(function(p){
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
  });
  var w=Math.max(WALK_ROUTE_THICKNESS_MM,maxX-minX+WALK_ROUTE_THICKNESS_MM);
  var d=Math.max(WALK_ROUTE_THICKNESS_MM,maxY-minY+WALK_ROUTE_THICKNESS_MM);
  var cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  return {
    type:'walk-route',
    x:cx-w/2,y:cy-d/2,w:w,d:d,rot:0,floor:floor||ST.floor,
    color:color||'#10b981',
    walkSpeed:speed||WALK_DEFAULT_SPEED_MPS,
    pathPoints:clean.map(function(p){return {x:p.x-cx,y:p.y-cy};})
  };
}
function applyWalkRoutePathFromWorldPoints(it,points){
  var shape=makeWalkRouteShapeFromWorldPoints(points,it.floor,it.color,walkRouteSpeedMps(it));
  if(!shape) return false;
  it.x=shape.x; it.y=shape.y; it.w=shape.w; it.d=shape.d; it.rot=shape.rot;
  it.pathPoints=shape.pathPoints;
  return true;
}
function sampleWalkRoutePath(points,distanceMm){
  if(!points || !points.length) return {point:{x:0,y:0},angle:0};
  if(points.length===1) return {point:copyWalkRoutePoint(points[0]),angle:0};
  var remaining=Math.max(0,Number(distanceMm)||0);
  for(var i=1;i<points.length;i++){
    var a=points[i-1], b=points[i];
    var segLen=Math.hypot(b.x-a.x,b.y-a.y);
    if(segLen<0.001) continue;
    if(remaining<=segLen){
      var t=remaining/segLen;
      return {
        point:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},
        angle:Math.atan2(b.y-a.y,b.x-a.x)
      };
    }
    remaining-=segLen;
  }
  var last=points[points.length-1], prev=points[points.length-2];
  return {point:copyWalkRoutePoint(last),angle:Math.atan2(last.y-prev.y,last.x-prev.x)};
}
function rulerTickStepMm(sc){
  var steps=[100,250,500,910,1000,2000,5000];
  for(var i=0;i<steps.length;i++){
    if(steps[i]*sc>=7) return steps[i];
  }
  return 10000;
}
function drawRuler2d(it,sc,preview){
  // 寸法線(JIS製図の標準表記): 目盛りを刻んだ物差し風の見た目をやめ、
  // 他の寸法表示(drawRectDim等)と同じ「本体線+端部の45度斜線+中央の寸法値」に揃える
  var len=rulerLengthMm(it);
  if(len<1) return;
  var half=len*sc/2;
  var selected=ST.selected===it && !preview;
  var col=it.color||'#2f80ed';
  var lineW=preview?1.5:(selected?2.4:1.7);
  var tickHalf=Math.max(5,Math.min(9,70*sc)); // 端部記号(45度の短い斜線)の半径
  ctx.save();
  ctx.globalAlpha=preview?0.72:1;
  ctx.strokeStyle=selected?'#e94560':col;
  ctx.fillStyle=selected?'#e94560':col;
  ctx.lineWidth=lineW;
  // 寸法線本体
  ctx.beginPath();
  ctx.moveTo(-half,0);
  ctx.lineTo(half,0);
  ctx.stroke();
  // 端部記号(45度の短い斜線)を両端に配置する
  ctx.beginPath();
  ctx.moveTo(-half-tickHalf,tickHalf); ctx.lineTo(-half+tickHalf,-tickHalf);
  ctx.moveTo(half-tickHalf,tickHalf); ctx.lineTo(half+tickHalf,-tickHalf);
  ctx.stroke();
  // 寸法補助線(ひげ線): 測定対象へ向けて両端から垂直に伸ばす。
  // extLen(mm)の符号で伸ばす側を切り替える(JIS製図: 補助線は寸法線を僅かに超えて描く)
  var extLen=Number(it.extLen)||0;
  if(Math.abs(extLen)>=1){
    var e=extLen*sc;
    var overhang=Math.sign(e)*-5; // 寸法線の反対側へ僅かに突き出す
    ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(-half,overhang); ctx.lineTo(-half,e);
    ctx.moveTo(half,overhang); ctx.lineTo(half,e);
    ctx.stroke();
  }
  var labelOffset=Math.max(18,Math.min(28,180*sc));
  // 角丸四角で囲まない（デザインルールに無い表記・Task 21-5）。読めるようにするのは
  // 囲みではなく縁取りで、線と同じ色の文字をそのまま寸法線の外側へ置く。
  drawPlainDimLabel(0,-labelOffset,Math.round(len)+'mm',
    preview?'rgba(47,128,237,0.85)':(selected?'#e94560':'#2f80ed'));
  ctx.restore();
}
function drawWalkRoute2d(it,sc,preview){
  var pts=getWalkRouteLocalPoints(it);
  var len=walkRoutePathLengthMmFromPoints(pts);
  if(len<1 || pts.length<2) return;
  var selected=ST.selected===it && !preview;
  var col=it.color||'#10b981';
  var lineW=preview?2:(selected?3:2.2);
  var markerR=Math.max(4,Math.min(8,70*sc));
  var tickStep=1000;
  var tickCount=Math.floor(len/tickStep);
  ctx.save();
  ctx.globalAlpha=preview?0.72:1;
  ctx.strokeStyle=selected?'#e94560':col;
  ctx.fillStyle=selected?'#e94560':col;
  ctx.lineWidth=lineW;
  ctx.lineCap='round';
  ctx.lineJoin='round';
  ctx.setLineDash(preview?[8,5]:[12,7]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x*sc,pts[0].y*sc);
  for(var pi=1;pi<pts.length;pi++){
    ctx.lineTo(pts[pi].x*sc,pts[pi].y*sc);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for(var vi=1;vi<pts.length-1;vi++){
    ctx.beginPath();
    ctx.arc(pts[vi].x*sc,pts[vi].y*sc,markerR*0.72,0,Math.PI*2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(pts[0].x*sc,pts[0].y*sc,markerR,0,Math.PI*2);
  ctx.fill();
  var end=pts[pts.length-1], prev=pts[pts.length-2];
  var endAng=Math.atan2(end.y-prev.y,end.x-prev.x);
  var arrowLen=Math.max(12,110*sc);
  var arrowWid=Math.max(6,56*sc);
  ctx.save();
  ctx.translate(end.x*sc,end.y*sc);
  ctx.rotate(endAng);
  ctx.beginPath();
  ctx.moveTo(markerR*0.6,0);
  ctx.lineTo(-arrowLen,-arrowWid);
  ctx.lineTo(-arrowLen,arrowWid);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if(tickCount>0){
    ctx.strokeStyle=selected?'rgba(233,69,96,0.75)':'rgba(16,185,129,0.75)';
    ctx.lineWidth=Math.max(1,1.2*lineW/2);
    ctx.beginPath();
    for(var i=1;i<=tickCount;i++){
      var sample=sampleWalkRoutePath(pts,i*tickStep);
      var posX=sample.point.x*sc, posY=sample.point.y*sc;
      var tl=Math.max(5,Math.min(11,95*sc));
      var nx=-Math.sin(sample.angle), ny=Math.cos(sample.angle);
      ctx.moveTo(posX-nx*tl,posY-ny*tl);
      ctx.lineTo(posX+nx*tl,posY+ny*tl);
    }
    ctx.stroke();
  }
  if(preview && pts.length>1){
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.strokeStyle=col;
    ctx.lineWidth=1.4;
    pts.forEach(function(p){
      ctx.beginPath();
      ctx.arc(p.x*sc,p.y*sc,Math.max(3,markerR*0.55),0,Math.PI*2);
      ctx.fill(); ctx.stroke();
    });
  }
  var labelOffset=Math.max(20,Math.min(32,200*sc));
  var mid=sampleWalkRoutePath(pts,len/2);
  var label=formatWalkRouteDistance(len)+' / '+walkRouteDurationSec(it).toFixed(1)+'秒';
  drawDimLabel(mid.point.x*sc,mid.point.y*sc-labelOffset,label,preview?'rgba(16,185,129,0.72)':(selected?'rgba(233,69,96,0.9)':'rgba(16,132,94,0.86)'),'#fff');
  ctx.restore();
}
function drawWalkRoutePathPreview(points,preview){
  var shape=makeWalkRouteShapeFromWorldPoints(points,ST.floor,'#10b981',WALK_DEFAULT_SPEED_MPS);
  if(!shape) return;
  var sc=ST.zoom*0.05;
  var pose=getItemDisplayPose(shape);
  var p=w2c(pose.x,pose.y);
  ctx.save();
  ctx.translate(p.cx,p.cy);
  ctx.rotate((pose.rot||0)*Math.PI/180);
  drawWalkRoute2d(shape,sc,!!preview);
  ctx.restore();
}
function drawRulerBetweenPoints(x1,y1,x2,y2,preview){
  var dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
  if(len<1) return;
  var sc=ST.zoom*0.05;
  var midX=(x1+x2)/2, midY=(y1+y2)/2;
  var p=w2c(midX,midY);
  ctx.save();
  ctx.translate(p.cx,p.cy);
  ctx.rotate(Math.atan2(dy,dx));
  drawRuler2d({type:'ruler',w:len,d:RULER_THICKNESS_MM,color:'#2f80ed'},sc,!!preview);
  ctx.restore();
}
function drawWalkRouteBetweenPoints(x1,y1,x2,y2,preview){
  var dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
  if(len<1) return;
  var sc=ST.zoom*0.05;
  var midX=(x1+x2)/2, midY=(y1+y2)/2;
  var p=w2c(midX,midY);
  ctx.save();
  ctx.translate(p.cx,p.cy);
  ctx.rotate(Math.atan2(dy,dx));
  drawWalkRoute2d({type:'walk-route',w:len,d:WALK_ROUTE_THICKNESS_MM,color:'#10b981',walkSpeed:WALK_DEFAULT_SPEED_MPS},sc,!!preview);
  ctx.restore();
}
function getWallOutlinePoints(w){
  if(!w || !isFiniteCanvasValue(w.x1) || !isFiniteCanvasValue(w.y1) || !isFiniteCanvasValue(w.x2) || !isFiniteCanvasValue(w.y2)) return [];
  var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.hypot(dx,dy);
  if(len<1) return [];
  var half=wallThicknessMm(w)/2;
  var nx=-dy/len*half, ny=dx/len*half;
  return [
    {x:w.x1+nx,y:w.y1+ny},
    {x:w.x2+nx,y:w.y2+ny},
    {x:w.x2-nx,y:w.y2-ny},
    {x:w.x1-nx,y:w.y1-ny}
  ];
}
function getObjectOutlinePoints(o){
  if(!o || !isFiniteCanvasValue(o.x) || !isFiniteCanvasValue(o.y) || !isFiniteCanvasValue(o.w) || !isFiniteCanvasValue(o.d)) return [];
  var pose=getItemDisplayPose(o);
  var cx=pose.x, cy=pose.y;
  var rad=(pose.rot||0)*Math.PI/180;
  if(o.type==='room' || o.type==='site-rect') rad=0;
  var hw=o.w/2, hd=o.d/2;
  return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(function(p){
    return {
      x:cx+p[0]*Math.cos(rad)-p[1]*Math.sin(rad),
      y:cy+p[0]*Math.sin(rad)+p[1]*Math.cos(rad)
    };
  });
}
function addRulerSnapPoint(refs,x,y){
  if(isFiniteCanvasValue(x) && isFiniteCanvasValue(y)) refs.points.push({x:x,y:y});
}
function addRulerSnapSegment(refs,a,b){
  if(!a || !b) return;
  if(isFiniteCanvasValue(a.x) && isFiniteCanvasValue(a.y) && isFiniteCanvasValue(b.x) && isFiniteCanvasValue(b.y)){
    refs.segments.push({a:a,b:b});
  }
}
function addOutlineRulerSnapRefs(refs,pts){
  if(!pts || pts.length<2) return;
  var cx=0, cy=0;
  pts.forEach(function(p){
    addRulerSnapPoint(refs,p.x,p.y);
    cx+=p.x; cy+=p.y;
  });
  addRulerSnapPoint(refs,cx/pts.length,cy/pts.length);
  for(var i=0;i<pts.length;i++){
    var a=pts[i], b=pts[(i+1)%pts.length];
    addRulerSnapPoint(refs,(a.x+b.x)/2,(a.y+b.y)/2);
    addRulerSnapSegment(refs,a,b);
  }
}
function collectRulerSnapRefs(floor,excludeId){
  var refs={points:[],segments:[]};
  DATA.rooms.filter(function(r){return r.floor===floor;}).forEach(function(r){
    addOutlineRulerSnapRefs(refs,getObjectOutlinePoints(r));
  });
  DATA.items.filter(function(it){
    return it && it.floor===floor && it.id!==excludeId && !isPlanAnnotationType(it.type);
  }).forEach(function(it){
    addOutlineRulerSnapRefs(refs,getObjectOutlinePoints(it));
  });
  DATA.walls.filter(function(w){return w.floor===floor;}).forEach(function(w){
    addOutlineRulerSnapRefs(refs,getWallOutlinePoints(w));
    addRulerSnapPoint(refs,w.x1,w.y1);
    addRulerSnapPoint(refs,w.x2,w.y2);
    addRulerSnapPoint(refs,(w.x1+w.x2)/2,(w.y1+w.y2)/2);
    addRulerSnapSegment(refs,{x:w.x1,y:w.y1},{x:w.x2,y:w.y2});
  });
  return refs;
}
function projectPointToSegment2d(px,py,ax,ay,bx,by){
  var dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  if(len2<0.001) return {x:ax,y:ay,t:0,dist:Math.hypot(px-ax,py-ay)};
  var t=((px-ax)*dx+(py-ay)*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  var x=ax+dx*t, y=ay+dy*t;
  return {x:x,y:y,t:t,dist:Math.hypot(px-x,py-y)};
}
function snapRulerPoint(x,y,excludeId){
  var gx=snapV(x), gy=snapV(y);
  var thresh=Math.max(60,Math.min(180,planHitToleranceMm(10)));
  var best={x:gx,y:gy,dist:thresh,snapped:false,kind:'grid'};
  var refs=collectRulerSnapRefs(ST.floor,excludeId);
  refs.points.forEach(function(p){
    var d=Math.hypot(x-p.x,y-p.y);
    if(d<best.dist){best={x:p.x,y:p.y,dist:d,snapped:true,kind:'point'};}
  });
  refs.segments.forEach(function(seg){
    var p=projectPointToSegment2d(x,y,seg.a.x,seg.a.y,seg.b.x,seg.b.y);
    if(p.dist<best.dist){best={x:p.x,y:p.y,dist:p.dist,snapped:true,kind:'edge'};}
  });
  return best;
}
function makeRulerItemFromPoints(x1,y1,x2,y2){
  var dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
  var midX=(x1+x2)/2, midY=(y1+y2)/2;
  var rot=Math.atan2(dy,dx)*180/Math.PI;
  return mkItem('ruler',midX-len/2,midY-RULER_THICKNESS_MM/2,rot,ST.floor,len,RULER_THICKNESS_MM);
}
// 定規の両端(平面 mm)。置くときの1点目が a、2点目が b。
// makeRulerItemFromPoints の逆で、中心 ± 向き×長さ/2 である。
function rulerEndPointsMm(it){
  var len=rulerLengthMm(it);
  var a=(it.rot||0)*Math.PI/180;
  var ux=Math.cos(a), uy=Math.sin(a);
  var cx=it.x+len/2, cy=it.y+(Number(it.d)||RULER_THICKNESS_MM)/2;
  return {a:{x:cx-ux*len/2,y:cy-uy*len/2}, b:{x:cx+ux*len/2,y:cy+uy*len/2}, ux:ux, uy:uy};
}
var RULER_MIN_LEN_MM=1;
var RULER_MAX_LEN_MM=200000;
// 置いたあとで測定長さを入れ直す (Task 21-4)。**1点目を動かさず**、2点目だけを
// 同じ向きに伸び縮みさせる(定規は「ここから何mm」を測る道具なので、掴んだ端は動かない)。
function updateSelectedRulerLength(v){
  var it=ST.selected;
  if(!it || it.type!=='ruler') return;
  if(isObjectLocked(it)){ updateProps(); return; }
  var len=Number(v);
  if(!isFinite(len)){ updateProps(); return; }
  len=Math.max(RULER_MIN_LEN_MM,Math.min(RULER_MAX_LEN_MM,Math.round(len)));
  var ends=rulerEndPointsMm(it);
  saveState();
  it.w=len;
  it.x=ends.a.x+ends.ux*len/2-len/2;
  it.y=ends.a.y+ends.uy*len/2-(Number(it.d)||RULER_THICKNESS_MM)/2;
  draw2d();
  updateProps();
}
function makeWalkRouteItemFromPathPoints(points){
  var shape=makeWalkRouteShapeFromWorldPoints(points,ST.floor,'#10b981',WALK_DEFAULT_SPEED_MPS);
  if(!shape) return null;
  var it=mkItem('walk-route',shape.x,shape.y,shape.rot,shape.floor,shape.w,shape.d);
  it.pathPoints=shape.pathPoints;
  it.walkSpeed=shape.walkSpeed;
  it.color=shape.color;
  it.colorCustom=true;
  return it;
}
function makeWalkRouteItemFromPoints(x1,y1,x2,y2){
  return makeWalkRouteItemFromPathPoints([{x:x1,y:y1},{x:x2,y:y2}]);
}
function drawRulerSnapMarker(p,color){
  if(!p || !p.snapped) return;
  var c=w2c(p.x,p.y);
  ctx.save();
  ctx.strokeStyle=color||'rgba(47,128,237,0.9)';
  ctx.fillStyle='rgba(255,255,255,0.92)';
  ctx.lineWidth=1.8;
  ctx.beginPath();
  ctx.arc(c.cx,c.cy,6,0,Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.cx-10,c.cy);
  ctx.lineTo(c.cx+10,c.cy);
  ctx.moveTo(c.cx,c.cy-10);
  ctx.lineTo(c.cx,c.cy+10);
  ctx.stroke();
  ctx.restore();
}

function drawLight2d(it,sc){
  ensureLightDefaults(it);
  var hw=(it.w||200)*sc/2, hd=(it.d||200)*sc/2;
  var color=it.lightColor||'#fff6dd';
  var kind=it.lightKind||lightKindFromType(it.type);
  var shape=it.lightShape||'point';
  ctx.save();
  ctx.fillStyle='rgba(255,246,210,0.28)';
  ctx.strokeStyle='rgba(78,70,48,0.62)';
  ctx.lineWidth=Math.max(1,1.4*sc);
  if(shape==='line'){
    var barH=Math.max(8*sc,Math.min(hd*0.7,18*sc));
    ctx.fillRect(-hw,-barH/2,hw*2,barH);
    ctx.strokeRect(-hw,-barH/2,hw*2,barH);
    ctx.fillStyle=color;
    ctx.fillRect(-hw*0.82,-barH*0.22,hw*1.64,barH*0.44);
  } else {
    var r=Math.max(7*sc,Math.min(hw,hd,18*sc));
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.arc(0,0,r*0.52,0,Math.PI*2); ctx.fill();
  }
  if(kind!=='ceiling'){
    var beam=kind==='spot'?0.42:0.74;
    var reach=Math.max(hd,Math.min(60*sc,Math.max(hw,hd)*1.2));
    ctx.fillStyle=kind==='spot'?'rgba(255,226,140,0.16)':'rgba(255,236,180,0.13)';
    ctx.strokeStyle=kind==='spot'?'rgba(180,125,32,0.55)':'rgba(160,128,70,0.42)';
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(Math.sin(beam)*reach,Math.cos(beam)*reach);
    ctx.arc(0,0,reach,Math.PI/2-beam,Math.PI/2+beam,false);
    ctx.lineTo(0,0);
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle='rgba(60,52,38,0.72)';
  ctx.lineWidth=Math.max(1,1.1*sc);
  ctx.beginPath();
  ctx.moveTo(-Math.min(hw,10*sc),0); ctx.lineTo(Math.min(hw,10*sc),0);
  ctx.moveTo(0,-Math.min(hd,10*sc)); ctx.lineTo(0,Math.min(hd,10*sc));
  ctx.stroke();
  ctx.restore();
}

function drawStairUpText(it,sc,x,y,align){
  ctx.font='bold '+Math.max(9,10*sc)+'px sans-serif'; ctx.textAlign=align||'left'; ctx.textBaseline='middle';
  // flip時もラベルが鏡文字にならないよう、文字だけ逆スケールで戻す
  ctx.save(); ctx.translate(x,y); ctx.scale(it.flipX?-1:1, it.flipY?-1:1); ctx.fillText('上',0,0); ctx.restore();
}

function drawItem2d(it){
  // メモ・定規・ウォークルートは注記。判定は isPlanAnnotationType に一本化する
  if(isPlanAnnotationType(it.type) && !planCaptureShows('annotations')) return;
  var sc=ST.zoom*0.05;
  var pose=getItemDisplayPose(it);
  var drawX=pose.x;
  var drawY=pose.y;
  var drawRot=pose.rot;
  var ccx=ST.panX+drawX*sc, ccy=ST.panY+drawY*sc; 
  ctx.save();
  ctx.translate(ccx,ccy); ctx.rotate(drawRot*Math.PI/180);
  var manualFlipSymbol=(it.type === 'door-swing' || it.type === 'door-swing-s' || it.type === 'door-front' || it.type === 'door-slide' || it.type === 'door-fold' || it.type === 'door-fold-w' || it.type === 'door-slide-s' || it.type === 'door-pocket' || it.type === 'window-door' || it.type === 'memo' || it.type === 'ruler' || it.type === 'walk-route');
  if(!manualFlipSymbol) ctx.scale(it.flipX?-1:1, it.flipY?-1:1);
  if(it.type==='memo'){
    drawMemo2d(it,sc);
    ctx.restore();
    if(ST.selected===it&&ST.tool==='select'){
      var memoHalf=getItemSelectionHalfExtentsPx(it,sc);
      drawHandles(it,ccx,ccy,memoHalf.hw,memoHalf.hd,sc,drawRot);
    }
    return;
  }
  if(it.type==='ruler'){
    drawRuler2d(it,sc,false);
    ctx.restore();
    if(ST.selected===it&&ST.tool==='select'){
      var rulerHalf=getItemSelectionHalfExtentsPx(it,sc);
      drawHandles(it,ccx,ccy,rulerHalf.hw,rulerHalf.hd,sc,drawRot);
    }
    return;
  }
  if(it.type==='walk-route'){
    drawWalkRoute2d(it,sc,false);
    ctx.restore();
    if(ST.selected===it&&ST.tool==='select'){
      var walkHalf=getItemSelectionHalfExtentsPx(it,sc);
      drawHandles(it,ccx,ccy,walkHalf.hw,walkHalf.hd,sc,drawRot);
    }
    return;
  }
  if(isLightItemType(it.type)){
    drawLight2d(it,sc);
    ctx.restore();
    if(ST.selected===it&&ST.tool==='select'){
      var lightHalf=getItemSelectionHalfExtentsPx(it,sc);
      drawHandles(it,ccx,ccy,lightHalf.hw,lightHalf.hd,sc,drawRot);
    }
    return;
  }
  var spriteKey=SPRITE_MAP[it.type];
  var s = spriteKey ? SPRITE_JSON.sprites[spriteKey] : null;
  var fmp=getItemFinishModel(it.type)||(it.type==='car'?{id:'context-car',top:'assets/models/previews-v2/context-car-top.png',previewVersion:2}:null);
  if(fmp){
    var topImg=getFmpTopImage(fmp);
    var hwF=it.w*sc/2, hdF=it.d*sc/2;
    if(topImg && topImg.complete && topImg.naturalWidth>0){
      drawFmpTopImageOriented(topImg,fmp,it.w*sc,it.d*sc);
    } else {
      // 色は PLAN_PLACEHOLDER_* に置いてある。findPlanPlaceholderInstances が
      // 「この画素はプレースホルダでありうるか」を逆算するのに同じ値を要るため。
      ctx.fillStyle=PLAN_PLACEHOLDER_FILL;
      ctx.fillRect(-hwF,-hdF,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(0,0,0,0.35)';
      ctx.strokeRect(-hwF,-hdF,it.w*sc,it.d*sc);
    }
  } else if(s){
    var img = s.img === 1 ? SPRITE_IMG1 : SPRITE_IMG2;
    if (img.complete) {
      var tw = it.w * sc, td = it.d * sc;
      // Use tight crop coords to remove whitespace
      var scx=s.cx||0, scy=s.cy||0, scw=s.cw||512, sch=s.ch||512;
      var aspect = scw/sch;
      var dw = tw, dd = td;
      if (tw / td > aspect) { dw = td * aspect; } else { dd = tw / aspect; }
      ctx.save();
      ctx.translate((it.sX||0)*sc, (it.sY||0)*sc);
      var ss = it.sScale||1;
      ctx.scale(ss, ss);
      ctx.drawImage(img, s.x+scx, s.y+scy, scw, sch, -dw/2, -dd/2, dw, dd);
      ctx.restore();
    }
  } else {
    var hw = it.w*sc/2, hd = it.d*sc/2;
    var isPlanSymbol=(it.type==='stair' || it.type==='stair-corner' || it.type==='stair-landing' || it.type==='door-slide' || it.type==='window' || it.type==='window-door');
    var doorSymbolOnly=(it.type === 'door-swing' || it.type === 'door-swing-s' || it.type === 'door-front' || isNoDoorOpeningType(it.type) || isPlanSymbol);
    if(!doorSymbolOnly){
      ctx.fillStyle=getItem2dFillColor(it);
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=1;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
    }
    
    if(it.type === 'custom-block') {
      var blockFill=getItem2dFillColor(it);
      ctx.fillStyle=blockFill;
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(25,45,75,0.78)';
      ctx.lineWidth=Math.max(1.2,Math.min(2.4,sc*18));
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(255,255,255,0.45)';
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(-hw+5,-hd+5); ctx.lineTo(hw-5,hd-5);
      ctx.moveTo(hw-5,-hd+5); ctx.lineTo(-hw+5,hd-5);
      ctx.stroke();
      var label=(it.name||ILABELS[it.type]||'任意ブロック').trim();
      var heightLabel='H '+Math.round(getCustomBlockHeight(it))+'mm';
      var maxTextW=Math.max(0,it.w*sc-10);
      if(maxTextW>24 && it.d*sc>18){
        ctx.save();
        ctx.beginPath(); ctx.rect(-hw+4,-hd+4,it.w*sc-8,it.d*sc-8); ctx.clip();
        var fs=Math.max(8,Math.min(12,Math.min(it.w*sc/6,it.d*sc/3)));
        ctx.font='bold '+fs+'px "Noto Sans JP",sans-serif';
        while(label.length>1 && ctx.measureText(label).width>maxTextW) label=label.slice(0,-1);
        if(ctx.measureText(label).width>maxTextW) label='';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='rgba(21,32,50,0.86)';
        if(label) ctx.fillText(label,0,it.d*sc>34?-fs*0.35:0);
        if(it.d*sc>42){
          ctx.font=Math.max(7,fs-2)+'px "Noto Sans JP",sans-serif';
          ctx.fillStyle='rgba(21,32,50,0.62)';
          ctx.fillText(heightLabel,0,fs*0.85);
        }
        ctx.restore();
      }
    } else if(it.type === 'roof') {
      // 屋根: 建物フットプリントに合わせた破線 + 🏠ラベル。
      // 結合した屋根(L字・コの字)は外接矩形ではなく結合後の外周を描く。
      var roofOutline=(typeof hasRoofParts==='function'&&hasRoofParts(it))?roofPolygonOutlineMm(it):null;
      ctx.setLineDash([8,4]);
      ctx.strokeStyle='#334'; ctx.lineWidth=1.5;
      if(roofOutline){
        ctx.beginPath();
        roofOutline.forEach(function(e){
          ctx.moveTo(e.ax*sc,e.az*sc); ctx.lineTo(e.bx*sc,e.bz*sc);
        });
        ctx.stroke();
      }else{
        ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      }
      ctx.setLineDash([]);
      // 対角線
      ctx.beginPath(); ctx.strokeStyle='rgba(50,50,80,0.3)'; ctx.lineWidth=1;
      if(!roofOutline){
        ctx.moveTo(-hw,-hd); ctx.lineTo(hw,hd);
        ctx.moveTo(hw,-hd); ctx.lineTo(-hw,hd);
      }
      ctx.stroke();
      ctx.font='bold '+Math.max(10,it.w*sc*0.12)+'px sans-serif';
      ctx.fillStyle='#334'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🏠屋根',0,0);
    } else if(it.type === 'stair') {
      // 階段は床面を淡く残し、段鼻線と昇り矢印を壁外形より細い中細線で描く。
      ctx.save();
      ctx.globalAlpha=0.30;
      ctx.fillStyle=getItem2dFillColor(it);
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.restore();
      ctx.strokeStyle='rgba(35,35,35,0.82)'; ctx.lineWidth=1.2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.beginPath();
      var steps = getStairStepCount(it);
      for(var si=1; si<steps; si++) {
        var sy = -hd + (it.d*sc/steps)*si;
        ctx.moveTo(-hw, sy); ctx.lineTo(hw, sy);
      }
      ctx.stroke();
      // 昇り方向矢印(矢先=昇り先)。3Dモデルの昇り向き(+d側)に合わせる
      ctx.strokeStyle='rgba(20,20,20,0.90)'; ctx.fillStyle='rgba(20,20,20,0.90)'; ctx.lineWidth=1.6;
      ctx.beginPath();
      ctx.moveTo(0,-hd*0.72); ctx.lineTo(0,hd*0.72);
      ctx.stroke();
      var sAw=Math.max(5*sc,4), sAl=Math.min(hd*0.17,Math.max(10*sc,9));
      ctx.beginPath();
      ctx.moveTo(0,hd*0.72); ctx.lineTo(-sAw,hd*0.72-sAl); ctx.lineTo(sAw,hd*0.72-sAl); ctx.closePath(); ctx.fill();
      drawStairUpText(it,sc,Math.max(6*sc,5),hd*0.68);
    } else if(it.type === 'stair-landing') {
      // 踊り場は段を持たないので段鼻線を引かない。外形と昇り方向だけ。
      ctx.save();
      ctx.globalAlpha=0.30;
      ctx.fillStyle=getItem2dFillColor(it);
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.restore();
      ctx.strokeStyle='rgba(35,35,35,0.82)'; ctx.lineWidth=1.2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(20,20,20,0.90)'; ctx.fillStyle='rgba(20,20,20,0.90)'; ctx.lineWidth=1.6;
      ctx.beginPath();
      ctx.moveTo(0,-hd*0.72); ctx.lineTo(0,hd*0.72);
      ctx.stroke();
      var lAw=Math.max(5*sc,4), lAl=Math.min(hd*0.17,Math.max(10*sc,9));
      ctx.beginPath();
      ctx.moveTo(0,hd*0.72); ctx.lineTo(-lAw,hd*0.72-lAl); ctx.lineTo(lAw,hd*0.72-lAl); ctx.closePath(); ctx.fill();
    } else if(it.type === 'stair-corner') {
      // 廻り3段コーナーのJIS流平面記号: 外形+内側隅から放射する段鼻線+昇り歩行線(1/4弧の矢印)。
      // 3Dモデル(build3DWinderCorner)と同じ割付で、下辺から入り右下の内側隅を廻って右辺へ抜ける。
      ctx.save();
      ctx.globalAlpha=0.30;
      ctx.fillStyle=getItem2dFillColor(it);
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.restore();
      ctx.strokeStyle='rgba(35,35,35,0.82)'; ctx.lineWidth=1.2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      // 段鼻線: 内側隅(右下)→左辺中点、内側隅→上辺中点(3Dの蹴上げ位置と同じ)
      ctx.beginPath();
      ctx.moveTo(hw,hd); ctx.lineTo(-hw,0);
      ctx.moveTo(hw,hd); ctx.lineTo(0,-hd);
      ctx.stroke();
      // 昇り歩行線: 直線の折れ線(下辺中央→中心→右辺中央)。JIS流の表現
      ctx.strokeStyle='rgba(20,20,20,0.90)'; ctx.fillStyle='rgba(20,20,20,0.90)'; ctx.lineWidth=1.6;
      var aHeadLen=Math.min(Math.min(hw,hd)*0.28,Math.max(10*sc,9));
      var wTipX=hw*0.96, wAw=Math.max(5*sc,4);
      ctx.beginPath();
      ctx.moveTo(0,hd*0.96);
      ctx.lineTo(0,0);
      ctx.lineTo(wTipX-aHeadLen,0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wTipX,0);
      ctx.lineTo(wTipX-aHeadLen,-wAw);
      ctx.lineTo(wTipX-aHeadLen,wAw);
      ctx.closePath(); ctx.fill();
      drawStairUpText(it,sc,wTipX-Math.max(3*sc,3),-Math.max(9*sc,8),'right');
    } else if(it.type === 'bicycle' || it.type === 'bicycle-fold') {
      // 自転車の平面記号: 前後輪+フレーム線+ハンドル+前カゴ+サドル
      var bkln=Math.max(1,1.2*sc*10);
      ctx.strokeStyle='rgba(40,48,60,0.85)'; ctx.fillStyle='rgba(40,48,60,0.85)';
      ctx.lineWidth=Math.max(1,hw*0.14);
      // 車輪(縦長の細い角丸): 前輪は上(-y)、後輪は下
      [-1,1].forEach(function(sgn){
        var wy=sgn*hd*0.55, wl=hd*0.62, wwd=Math.max(2,hw*0.16);
        ctx.beginPath();
        ctx.moveTo(0,wy-wl/2); ctx.lineTo(0,wy+wl/2);
        ctx.lineWidth=wwd; ctx.stroke();
      });
      // フレーム中心線
      ctx.lineWidth=Math.max(1,hw*0.10);
      ctx.beginPath(); ctx.moveTo(0,-hd*0.30); ctx.lineTo(0,hd*0.35); ctx.stroke();
      // ハンドル(前輪軸上の横棒)
      ctx.lineWidth=Math.max(1,hw*0.12);
      ctx.beginPath(); ctx.moveTo(-hw*0.85,-hd*0.32); ctx.lineTo(hw*0.85,-hd*0.32); ctx.stroke();
      // 前カゴ(ママチャリのみ)
      if(it.type==='bicycle'){
        ctx.lineWidth=1;
        ctx.strokeRect(-hw*0.52,-hd*0.62,hw*1.04,hd*0.20);
      }
      // サドル
      ctx.beginPath();
      ctx.ellipse(0,hd*0.30,hw*0.34,hd*0.10,0,0,Math.PI*2);
      ctx.fill();
    } else if(it.type === 'foundation') {
      ctx.fillStyle='rgba(184,178,168,0.32)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(90,86,78,0.72)';
      ctx.lineWidth=1.4;
      ctx.setLineDash([7,4]);
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.setLineDash([]);
      ctx.font='bold '+Math.max(10,12*sc)+'px sans-serif';
      ctx.fillStyle='rgba(65,62,56,0.86)';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('基礎 '+Math.round(isFinite(Number(it.foundationHeight))?Number(it.foundationHeight):450)+'mm',0,0);
    } else if(it.type === 'exterior-stair') {
      ctx.fillStyle='rgba(184,178,168,0.6)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(80,78,72,0.8)';
      ctx.lineWidth=1.2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      var n=Math.max(1,Math.min(12,Math.round(it.accessSteps||3)));
      ctx.beginPath();
      for(var ei=1; ei<n; ei++){
        var ey=-hd+(it.d*sc/n)*ei;
        ctx.moveTo(-hw,ey); ctx.lineTo(hw,ey);
      }
      ctx.stroke();
      // 上り方向(3Dで高くなる側=ローカル+y)へ矢印を向ける
      ctx.fillStyle='rgba(45,45,45,0.75)';
      ctx.beginPath();
      ctx.moveTo(0,-hd+5*sc); ctx.lineTo(0,hd-8*sc);
      ctx.lineTo(-5*sc,hd-18*sc); ctx.moveTo(0,hd-8*sc); ctx.lineTo(5*sc,hd-18*sc);
      ctx.stroke();
    } else if(it.type === 'ramp') {
      ctx.fillStyle='rgba(184,178,168,0.48)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(80,78,72,0.78)';
      ctx.lineWidth=1.2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      // 上り方向(3Dで高くなる側=ローカル+y)へ矢印を向ける
      ctx.beginPath();
      ctx.moveTo(0,-hd*0.72); ctx.lineTo(0,hd*0.72);
      ctx.moveTo(0,hd*0.72); ctx.lineTo(-6*sc,hd*0.56);
      ctx.moveTo(0,hd*0.72); ctx.lineTo(6*sc,hd*0.56);
      ctx.stroke();
      ctx.font='bold '+Math.max(9,10*sc)+'px sans-serif';
      ctx.fillStyle='rgba(65,62,56,0.8)';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('スロープ',0,0);
    } else if(it.type === 'closet') {
      ctx.beginPath();
      ctx.moveTo(-hw, -hd+5*sc); ctx.lineTo(hw, hd-5*sc);
      ctx.moveTo(hw, -hd+5*sc); ctx.lineTo(-hw, hd-5*sc);
      ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.stroke();
    } else if(it.type === 'balcony') {
      ctx.beginPath();
      for(var bi=1; bi<10; bi++) {
        var bx = -hw + (it.w*sc/10)*bi;
        ctx.moveTo(bx, -hd); ctx.lineTo(bx, hd);
      }
      ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.stroke();
    } else if(it.type === 'wood-fence') {
      ctx.fillStyle='rgba(154,122,58,0.32)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(90,62,28,0.75)';
      ctx.lineWidth=Math.max(1,sc*18);
      ctx.beginPath();
      if((it.fencePattern||'horizontal')==='horizontal'){
        for(var hi=0; hi<4; hi++){
          var yy=-hd+(it.d*sc)*(hi+0.5)/4;
          ctx.moveTo(-hw,yy); ctx.lineTo(hw,yy);
        }
      } else {
        var count=Math.max(4,Math.min(28,Math.round(it.w/140)));
        for(var vi=0; vi<count; vi++){
          var xx=-hw+(it.w*sc)*(vi+0.5)/count;
          ctx.moveTo(xx,-hd); ctx.lineTo(xx,hd);
        }
      }
      ctx.stroke();
    } else if(it.type === 'lattice-screen') {
      ctx.fillStyle='rgba(176,148,104,0.30)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(107,86,54,0.8)';
      ctx.lineWidth=Math.max(1,sc*14);
      ctx.beginPath();
      if((it.fencePattern||'vertical')==='horizontal'){
        for(var lh=0; lh<3; lh++){
          var ly=-hd+(it.d*sc)*(lh+0.5)/3;
          ctx.moveTo(-hw,ly); ctx.lineTo(hw,ly);
        }
      } else {
        var lsCount=Math.max(4,Math.min(28,Math.round(it.w/95)));
        for(var li=0; li<lsCount; li++){
          var lx=-hw+(it.w*sc)*(li+0.5)/lsCount;
          ctx.moveTo(lx,-hd); ctx.lineTo(lx,hd);
        }
      }
      ctx.stroke();
    } else if(it.type === 'road') {
      ctx.fillStyle='rgba(72,76,82,0.86)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(255,255,255,0.78)';
      ctx.lineWidth=Math.max(1,2*sc);
      ctx.beginPath();
      ctx.moveTo(-hw,-hd*0.72); ctx.lineTo(hw,-hd*0.72);
      ctx.moveTo(-hw, hd*0.72); ctx.lineTo(hw, hd*0.72);
      ctx.stroke();
      ctx.setLineDash([Math.max(6,14*sc),Math.max(4,10*sc)]);
      ctx.strokeStyle='rgba(255,222,90,0.9)';
      ctx.beginPath();
      ctx.moveTo(-hw,0); ctx.lineTo(hw,0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font='bold '+Math.max(9,Math.min(14,it.d*sc*0.18))+'px sans-serif';
      ctx.fillStyle='rgba(255,255,255,0.72)';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('道路',0,0);
    } else if(it.type === 'neighbor-building') {
      ctx.fillStyle='rgba(143,152,163,0.72)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(62,72,84,0.82)';
      ctx.lineWidth=1.3;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      var cols=Math.max(2,Math.min(8,Math.floor(it.w/700)));
      var rows=Math.max(2,Math.min(5,Math.floor(it.d/620)));
      ctx.fillStyle='rgba(226,238,246,0.58)';
      for(var bc=0;bc<cols;bc++){
        for(var br=0;br<rows;br++){
          var bwid=it.w*sc/(cols*2.8), bhgt=it.d*sc/(rows*3.2);
          var bx=-hw+(bc+0.5)*it.w*sc/cols-bwid/2;
          var by=-hd+(br+0.5)*it.d*sc/rows-bhgt/2;
          ctx.fillRect(bx,by,bwid,bhgt);
        }
      }
      ctx.font='bold '+Math.max(9,Math.min(14,Math.min(it.w,it.d)*sc*0.18))+'px sans-serif';
      ctx.fillStyle='rgba(28,39,52,0.86)';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('ビル',0,0);
    } else if(it.type === 'neighbor-house') {
      ctx.save();ctx.rotate(Math.PI);
      // 3Dモデル(隣家キット)と同じ共有レイアウトから2D記号を描く。
      // 910mmグリッドのベイ割り・開口位置・軒の出が3Dと必ず一致する。
      var nhFloors=getContextFloors(it);
      var nhL=neighborHouseLayout(it,it.w*U,it.d*U,nhFloors,contextStoryHeightM());
      var m2p=function(v){ return v/U*sc; };           // メートル → 画面px
      var eave=m2p(NH_EAVE);
      var roofX0=-hw-eave, roofY0=-hd-eave, roofX1=hw+eave, roofY1=hd+eave;
      var roofW=roofX1-roofX0, roofD=roofY1-roofY0;
      // 屋根伏せ(寄棟)。軒の出は実寸455mmなので建物を大きくしても太らない
      ctx.fillStyle='rgba(120,126,134,0.14)';
      ctx.fillRect(roofX0,roofY0,roofW,roofD);
      ctx.strokeStyle='rgba(88,94,101,0.72)';
      ctx.lineWidth=1.1;
      ctx.strokeRect(roofX0,roofY0,roofW,roofD);
      ctx.beginPath();
      if(roofW>roofD+4){
        var nhRidge=(roofW-roofD)/2;
        ctx.moveTo(-nhRidge,0); ctx.lineTo(nhRidge,0);
        ctx.moveTo(roofX0,roofY0); ctx.lineTo(-nhRidge,0);
        ctx.moveTo(roofX0,roofY1); ctx.lineTo(-nhRidge,0);
        ctx.moveTo(roofX1,roofY0); ctx.lineTo(nhRidge,0);
        ctx.moveTo(roofX1,roofY1); ctx.lineTo(nhRidge,0);
      } else if(roofD>roofW+4){
        var nhRidgeV=(roofD-roofW)/2;
        ctx.moveTo(0,-nhRidgeV); ctx.lineTo(0,nhRidgeV);
        ctx.moveTo(roofX0,roofY0); ctx.lineTo(0,-nhRidgeV);
        ctx.moveTo(roofX1,roofY0); ctx.lineTo(0,-nhRidgeV);
        ctx.moveTo(roofX0,roofY1); ctx.lineTo(0,nhRidgeV);
        ctx.moveTo(roofX1,roofY1); ctx.lineTo(0,nhRidgeV);
      } else {
        ctx.moveTo(roofX0,roofY0); ctx.lineTo(0,0);
        ctx.moveTo(roofX1,roofY0); ctx.lineTo(0,0);
        ctx.moveTo(roofX0,roofY1); ctx.lineTo(0,0);
        ctx.moveTo(roofX1,roofY1); ctx.lineTo(0,0);
      }
      ctx.strokeStyle='rgba(80,86,94,0.74)';
      ctx.lineWidth=1.2;
      ctx.stroke();
      // 躯体
      ctx.fillStyle='rgba(185,188,194,0.68)';
      ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.strokeStyle='rgba(96,103,110,0.78)';
      ctx.lineWidth=1.2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      // 1階の開口を各面に描く(面に沿ってt、面から内側へdepth)
      var nhWallT=Math.max(1.5,m2p(NH_WALL_T));
      var nhGround=(nhL.floorsData&&nhL.floorsData[0])||{};
      ['front','back','left','right'].forEach(function(face){
        (nhGround[face]||[]).forEach(function(p){
          var half=m2p(p.width)/2, cen=m2p(p.center);
          var isEntry=(p.part==='entry'), isGarage=(p.part==='garage');
          var ox,oy,ow,od;
          if(face==='front'){ ox=cen-half; oy=-hd; ow=half*2; od=nhWallT; }
          else if(face==='back'){ ox=cen-half; oy=hd-nhWallT; ow=half*2; od=nhWallT; }
          else if(face==='left'){ ox=-hw; oy=cen-half; ow=nhWallT; od=half*2; }
          else { ox=hw-nhWallT; oy=cen-half; ow=nhWallT; od=half*2; }
          if(isGarage){
            // インナーガレージ: 土間を建物内側へ2.1m伸ばす(貫通しない)
            var gd=m2p(2.10);
            ctx.fillStyle='rgba(34,38,42,0.22)';
            if(face==='front') ctx.fillRect(ox,-hd,ow,Math.min(gd,it.d*sc));
            ctx.fillStyle='rgba(34,38,42,0.62)';
            ctx.fillRect(ox,oy,ow,Math.max(2,nhWallT*1.6));
          } else if(isEntry){
            // 玄関: ポーチ土間を建物外側へ910mm
            var pd=m2p(0.91);
            ctx.fillStyle='rgba(226,228,231,0.85)';
            if(face==='front') ctx.fillRect(ox,-hd-pd,ow,pd);
            ctx.strokeStyle='rgba(120,126,134,0.7)';
            ctx.lineWidth=1;
            if(face==='front') ctx.strokeRect(ox,-hd-pd,ow,pd);
            ctx.fillStyle='rgba(120,90,58,0.75)';
            ctx.fillRect(ox,oy,ow,Math.max(2,nhWallT));
          } else {
            // 窓: 開口部を白抜きし、ガラス線を1本引く
            ctx.fillStyle='rgba(244,247,250,0.92)';
            ctx.fillRect(ox,oy,ow,od);
            ctx.strokeStyle='rgba(96,103,110,0.7)';
            ctx.lineWidth=0.9;
            ctx.strokeRect(ox,oy,ow,od);
          }
        });
      });
      // バルコニー(上階)を破線で示す
      if(nhL.balcony){
        var bw2=m2p(1.82)/2, bd2=m2p(0.91), bx2=m2p(nhL.balcony.x);
        ctx.save();
        ctx.setLineDash([Math.max(3,4*sc),Math.max(2,3*sc)]);
        ctx.strokeStyle='rgba(88,94,101,0.7)';
        ctx.lineWidth=1;
        ctx.strokeRect(bx2-bw2,-hd-bd2,bw2*2,bd2);
        ctx.restore();
      }
      ctx.font='bold '+Math.max(9,Math.min(14,Math.min(it.w,it.d)*sc*0.18))+'px sans-serif';
      ctx.fillStyle='rgba(62,68,74,0.86)';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.restore();ctx.fillText('隣家',0,0);
    } else if(it.type === 'utility-pole') {
      var rr=Math.max(5,Math.min(hw,hd)*0.72);
      ctx.fillStyle='rgba(140,146,151,0.86)';
      ctx.beginPath(); ctx.arc(0,0,rr,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='rgba(72,78,84,0.9)';
      ctx.lineWidth=Math.max(1.2,2*sc);
      ctx.beginPath();
      ctx.moveTo(-rr*2.4,0); ctx.lineTo(rr*2.4,0);
      ctx.moveTo(0,-rr*2.4); ctx.lineTo(0,rr*2.4);
      ctx.stroke();
      ctx.font='bold '+Math.max(8,Math.min(12,rr*0.9))+'px sans-serif';
      ctx.fillStyle='rgba(48,54,60,0.86)';
      ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText('電柱',0,rr+3);
    } else if(it.type === 'door-swing' || it.type === 'door-swing-s' || it.type === 'door-front') {
      var hingeX=(it.flipX?hw:-hw), leafX=(it.flipX?-hw:hw);
      var openDir=it.flipY?-1:1;
      var span=leafX-hingeX;
      var isClosed=doorOpenState(it)==='closed';
      var openAng=isClosed?0:openDir*Math.PI/3;
      var openX=hingeX+span*Math.cos(openAng);
      var openY=span*Math.sin(openAng);
      var arcStart=span>0?0:Math.PI;
      var arcEnd=arcStart+openAng;
      var baseThickness=it.type==='door-front'
        ? Math.max(7, Math.min(14, it.d*sc*0.55))
        : Math.max(4, Math.min(9, it.d*sc*0.2));
      var baseColor=it.type==='door-front'?'#d1945c':'#e8c47a';
      var baseX=Math.min(hingeX, leafX);
      var baseW=Math.abs(span);
      ctx.fillStyle=baseColor;
      ctx.fillRect(baseX, -baseThickness/2, baseW, baseThickness);
      ctx.strokeStyle='rgba(70,54,36,0.75)'; ctx.lineWidth=1;
      ctx.strokeRect(baseX, -baseThickness/2, baseW, baseThickness);
      ctx.strokeStyle='#333'; ctx.fillStyle='#333';
      ctx.beginPath(); ctx.arc(hingeX, 0, Math.max(2.5,3*sc), 0, Math.PI*2); ctx.fill();
      // 建具線(扉)は壁外形線より細くし、線の太さの優先順位(壁>建具>寸法/軌跡線)を明確にする
      ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.moveTo(hingeX, 0); ctx.lineTo(leafX, 0); ctx.stroke();
      ctx.lineWidth=1.8;
      ctx.beginPath(); ctx.moveTo(hingeX, 0); ctx.lineTo(openX, openY); ctx.stroke();
      if(!isClosed){
        ctx.lineWidth=0.9; ctx.setLineDash([3,3]);
        ctx.beginPath();
        ctx.arc(hingeX, 0, it.w*sc, arcStart, arcEnd, openDir<0);
        ctx.strokeStyle='#555'; ctx.stroke();
        ctx.setLineDash([]);
        var arrowT=0.64;
        var arrowAng=arcStart+(arcEnd-arcStart)*arrowT;
        var ax=hingeX+Math.cos(arrowAng)*it.w*sc, ay=Math.sin(arrowAng)*it.w*sc;
        var tangent=arrowAng+(openDir>0?Math.PI/2:-Math.PI/2);
        ctx.fillStyle='#333';
        ctx.beginPath();
        ctx.moveTo(ax,ay);
        ctx.lineTo(ax-Math.cos(tangent-0.55)*8*sc,ay-Math.sin(tangent-0.55)*8*sc);
        ctx.lineTo(ax-Math.cos(tangent+0.55)*8*sc,ay-Math.sin(tangent+0.55)*8*sc);
        ctx.closePath(); ctx.fill();
      }
    } else if(it.type === 'door-opening' || it.type === 'door-opening-arch') {
      // 建具なし開口: 開口端を中細線、開口範囲を細い破線で示す。
      ctx.strokeStyle='#444'; ctx.lineWidth=1.4;
      ctx.beginPath();
      ctx.moveTo(-hw,-hd); ctx.lineTo(-hw,hd);
      ctx.moveTo(hw,-hd); ctx.lineTo(hw,hd);
      if(it.type==='door-opening-arch'){
        ctx.moveTo(-hw,0);
        ctx.quadraticCurveTo(0,-Math.max(hd,hw*0.35),hw,0);
      } else {
        ctx.moveTo(-hw,-hd); ctx.lineTo(hw,-hd);
      }
      ctx.stroke();
      ctx.setLineDash([4,3]); ctx.lineWidth=0.8;
      ctx.strokeStyle='rgba(70,70,70,0.58)';
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);
      ctx.setLineDash([]);
    } else if(it.type === 'door-slide') {
      // 引き違い戸: 壁厚内の二本のレールと、互い違いの二枚の建具線に簡略化する。
      ctx.save(); ctx.globalAlpha=0.22; ctx.fillStyle=getItem2dFillColor(it); ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc); ctx.restore();
      ctx.strokeStyle='#444'; ctx.lineWidth=0.9;
      ctx.beginPath();
      ctx.moveTo(-hw,-hd*0.62); ctx.lineTo(hw,-hd*0.62);
      ctx.moveTo(-hw, hd*0.62); ctx.lineTo(hw, hd*0.62);
      ctx.stroke();
      var slideOpen=doorOpenState(it)!=='closed';
      var leftOpen=!!it.flipX;
      var panelW=it.w*sc*0.56;
      var fixedX=leftOpen?(-hw+it.w*sc*0.40):(-hw+it.w*sc*0.04);
      var movingClosedX=leftOpen?(-hw+it.w*sc*0.04):(-hw+it.w*sc*0.40);
      var movingX=slideOpen?fixedX:movingClosedX;
      ctx.strokeStyle='#222'; ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(fixedX,-hd*0.28); ctx.lineTo(fixedX+panelW,-hd*0.28);
      ctx.moveTo(movingX,hd*0.28); ctx.lineTo(movingX+panelW,hd*0.28);
      ctx.stroke();
      if(slideOpen){
        ctx.fillStyle='#333'; var ax=leftOpen?-hw+it.w*sc*0.18:hw-it.w*sc*0.18;
        var dir=leftOpen?-1:1;
        ctx.beginPath();
        ctx.moveTo(ax,0);
        ctx.lineTo(ax-dir*8*sc,-5*sc);
        ctx.lineTo(ax-dir*8*sc,5*sc);
        ctx.closePath(); ctx.fill();
      }
    } else if(it.type === 'door-slide-s' || it.type === 'door-pocket') {
      // 片引き戸: 戸を壁面片側の線で示し引き代側へ伸ばす / 引込み戸: 開口内実線+ポケット側破線
      ctx.save(); ctx.globalAlpha=0.22; ctx.fillStyle=getItem2dFillColor(it); ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc); ctx.restore();
      ctx.strokeStyle='#444'; ctx.lineWidth=0.9;
      ctx.beginPath();
      ctx.moveTo(-hw,-hd*0.62); ctx.lineTo(hw,-hd*0.62);
      ctx.moveTo(-hw, hd*0.62); ctx.lineTo(hw, hd*0.62);
      ctx.stroke();
      var sDir=it.flipX?-1:1;
      var sOpen=doorOpenState(it)!=='closed';
      ctx.strokeStyle='#222'; ctx.lineWidth=1.5;
      if(it.type==='door-slide-s'){
        var pz=(it.flipY?1:-1)*hd*1.05;
        var px0=sOpen?sDir*it.w*sc:0;
        ctx.beginPath();
        ctx.moveTo(px0-hw,pz); ctx.lineTo(px0+hw,pz);
        ctx.stroke();
        // 引き代(戸が重なる壁範囲)の細線
        ctx.strokeStyle='rgba(34,34,34,0.35)'; ctx.lineWidth=1;
        ctx.beginPath();
        ctx.moveTo(sDir*hw,pz); ctx.lineTo(sDir*hw*3,pz);
        ctx.stroke();
      } else {
        ctx.beginPath();
        if(sOpen){
          ctx.setLineDash([5*sc,3*sc]);
          ctx.moveTo(sDir*hw,0); ctx.lineTo(sDir*hw*3,0);
        } else {
          ctx.moveTo(-hw,0); ctx.lineTo(hw,0);
        }
        ctx.stroke(); ctx.setLineDash([]);
        // ポケット(戸袋)側の案内破線
        ctx.strokeStyle='rgba(34,34,34,0.35)'; ctx.lineWidth=1;
        ctx.setLineDash([4*sc,3*sc]);
        ctx.beginPath();
        ctx.moveTo(sDir*hw,0); ctx.lineTo(sDir*hw*3,0);
        ctx.stroke(); ctx.setLineDash([]);
      }
    } else if(it.type === 'door-fold' || it.type === 'door-fold-w') {
      // 折れ戸: 開口線+山形(折り)のJIS流平面記号。flipYで突出方向、片開きはflipXで吊元
      ctx.save(); ctx.globalAlpha=0.22; ctx.fillStyle=getItem2dFillColor(it); ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc); ctx.restore();
      ctx.strokeStyle='#444'; ctx.lineWidth=0.9;
      ctx.beginPath();
      ctx.moveTo(-hw,-hd*0.62); ctx.lineTo(hw,-hd*0.62);
      ctx.moveTo(-hw, hd*0.62); ctx.lineTo(hw, hd*0.62);
      ctx.stroke();
      var foldPeak=(it.flipY?1:-1)*Math.max(hd*1.6,10*sc);
      ctx.strokeStyle='#222'; ctx.lineWidth=1.5;
      ctx.beginPath();
      if(it.type==='door-fold'){
        var f0=it.flipX?hw:-hw, f1=it.flipX?-hw:hw;
        ctx.moveTo(f0,0); ctx.lineTo((f0+f1)/2,foldPeak); ctx.lineTo(f1,0);
      } else {
        ctx.moveTo(-hw,0); ctx.lineTo(-hw/2,foldPeak); ctx.lineTo(0,0);
        ctx.lineTo(hw/2,foldPeak); ctx.lineTo(hw,0);
      }
      ctx.stroke();
    } else if(it.type === 'window' || it.type === 'window-door') {
      // 窓は壁厚内の三本の平行細線（枠＋ガラス芯）で統一する。
      ctx.save(); ctx.globalAlpha=0.20; ctx.fillStyle=getItem2dFillColor(it); ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc); ctx.restore();
      ctx.strokeStyle='#3f5261'; ctx.lineWidth=0.9;
      ctx.beginPath();
      ctx.moveTo(-hw,-hd*0.68); ctx.lineTo(hw,-hd*0.68);
      ctx.moveTo(-hw,0); ctx.lineTo(hw,0);
      ctx.moveTo(-hw,hd*0.68); ctx.lineTo(hw,hd*0.68);
      ctx.stroke();
      if(it.type==='window-door'){
        var winSlideOpen=doorOpenState(it)!=='closed';
        var winLeftOpen=!!it.flipX;
        var winPanelW=it.w*sc*0.54;
        var winFixedX=winLeftOpen?(-hw+it.w*sc*0.40):(-hw+it.w*sc*0.06);
        var winMovingClosedX=winLeftOpen?(-hw+it.w*sc*0.06):(-hw+it.w*sc*0.40);
        var winMovingX=winSlideOpen?winFixedX:winMovingClosedX;
        ctx.strokeStyle='#243b4a'; ctx.lineWidth=1.4;
        ctx.beginPath();
        ctx.moveTo(winFixedX,-hd*0.24); ctx.lineTo(winFixedX+winPanelW,-hd*0.24);
        ctx.moveTo(winMovingX,hd*0.24); ctx.lineTo(winMovingX+winPanelW,hd*0.24);
        ctx.stroke();
        if(winSlideOpen){
          var wax=winLeftOpen?-hw+it.w*sc*0.18:hw-it.w*sc*0.18;
          var wdir=winLeftOpen?-1:1;
          ctx.fillStyle='#243b4a'; ctx.beginPath(); ctx.moveTo(wax,0);
          ctx.lineTo(wax-wdir*8*sc,-5*sc); ctx.lineTo(wax-wdir*8*sc,5*sc); ctx.closePath(); ctx.fill();
        }
      }
    } else if(it.type === 'site-rect') {
      var surface=siteSurfaceType(it);
      var fillMap={sand:'rgba(205,185,140,0.18)',grass:'rgba(100,160,100,0.08)',gravel:'rgba(150,140,120,0.12)',concrete:'rgba(140,145,150,0.12)'};
      var strokeMap={sand:'rgba(150,125,80,0.45)',grass:'rgba(60,100,60,0.4)',gravel:'rgba(120,105,85,0.45)',concrete:'rgba(90,95,100,0.45)'};
      ctx.setLineDash([10,5]);
      ctx.strokeStyle=strokeMap[surface]||strokeMap.grass; ctx.lineWidth=2;
      ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc); ctx.setLineDash([]);
      ctx.fillStyle=fillMap[surface]||fillMap.grass; ctx.fillRect(-hw,-hd,it.w*sc,it.d*sc);
      siteFinishZones(it).forEach(function(z){
        var zx=-hw+z.x*sc,zy=-hd+z.y*sc;
        ctx.fillStyle=fillMap[z.surface]||fillMap.grass;ctx.fillRect(zx,zy,z.w*sc,z.d*sc);
        ctx.strokeStyle=strokeMap[z.surface];ctx.lineWidth=1;ctx.strokeRect(zx,zy,z.w*sc,z.d*sc);
      });
      if(it.siteBoundary){
        ctx.strokeStyle='#334b45';ctx.lineWidth=2;ctx.setLineDash([12,4,2,4]);
        ctx.strokeRect(-hw,-hd,it.w*sc,it.d*sc);ctx.setLineDash([]);
        ctx.fillStyle='#334b45';ctx.font='bold 12px sans-serif';ctx.textAlign='center';
        ctx.fillText('敷地境界（土地全体） '+(it.w*it.d/1e6).toFixed(1)+'㎡',0,-hd-8);
      }
    }
  }
  ctx.restore();
  if(ST.selected===it&&ST.tool==='select'){
    var selHalf=getItemSelectionHalfExtentsPx(it,sc);
    drawHandles(it,ccx,ccy,selHalf.hw,selHalf.hd,sc,drawRot);
  }
}

function getItemSelectionHalfExtentsPx(it,sc){
  var hw=(it.w||0)*sc/2, hd=(it.d||0)*sc/2;
  if(it && isSwingDoorType(it.type)){
    hd=Math.max(12,Math.min(hd,Math.max(12,110*sc)));
  }
  if(it && (it.type==='ruler' || it.type==='walk-route')){
    hd=Math.max(12,hd);
  }
  return {hw:hw,hd:hd};
}

function drawHandles(o,ccx,ccy,hw,hd,sc,rotOverride){
  // 呼び出し側が多数あるので、選択表示の抑止はここ1か所で行う
  if(!planCaptureShows('selection')) return;
  ctx.save();
  ctx.translate(ccx,ccy); ctx.rotate((rotOverride!==undefined?rotOverride:(o.rot||0))*Math.PI/180);
  ctx.strokeStyle='#3080e8'; ctx.lineWidth=1.5; ctx.setLineDash([4,2]);
  ctx.strokeRect(-hw,-hd,hw*2,hd*2); ctx.setLineDash([]);
  if(isObjectLocked(o)){ ctx.restore(); return; }
  // corners: square (aspect-ratio locked resize), edges: circle (single-axis resize)
  var corners=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  var edges=[[0,-hd],[hw,0],[0,hd],[-hw,0]];
  ctx.fillStyle='#fff';
  corners.forEach(function(p){
    ctx.beginPath(); ctx.rect(p[0]-5,p[1]-5,10,10); ctx.fill(); ctx.stroke();
  });
  edges.forEach(function(p){
    ctx.beginPath(); ctx.arc(p[0],p[1],5,0,Math.PI*2); ctx.fill(); ctx.stroke();
  });
  if(o.type !== 'room'){
    ctx.beginPath(); ctx.moveTo(0,-hd); ctx.lineTo(0,-hd-30); ctx.stroke();
    ctx.fillStyle='#3080e8'; ctx.beginPath(); ctx.arc(0,-hd-30,7,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  }
  ctx.restore();
}

function drawWallHandles(w){
  if(!planCaptureShows('selection')) return;
  if(isObjectLocked(w)) return;
  var a=w2c(w.x1,w.y1), b=w2c(w.x2,w.y2);
  ctx.save();
  ctx.strokeStyle='#3080e8'; ctx.fillStyle='#fff'; ctx.lineWidth=1.8;
  ctx.beginPath(); ctx.arc(a.cx,a.cy,7,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(b.cx,b.cy,7,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// 端点を掴んでいれば端点だけ、線上を掴んでいれば壁1本の平行移動。
// 端点の判定を先に見るので、端の近くでは今までどおり端点が勝つ。
function hitWallHandle(w,cx,cy){
  var a=w2c(w.x1,w.y1), b=w2c(w.x2,w.y2);
  if(Math.hypot(cx-a.cx,cy-a.cy)<12) return 'wall-a';
  if(Math.hypot(cx-b.cx,cy-b.cy)<12) return 'wall-b';
  var dx=b.cx-a.cx, dy=b.cy-a.cy;
  var l2=dx*dx+dy*dy;
  if(l2<1) return null;
  var t=((cx-a.cx)*dx+(cy-a.cy)*dy)/l2;
  if(t<0) t=0; else if(t>1) t=1;
  var px=a.cx+dx*t, py=a.cy+dy*t;
  // しきい値は「線の見た目の太さ」に合わせる。壁厚は画面上で ST.zoom*0.05 px/mm。
  var halfPx=wallThicknessMm(w)/2*(ST.zoom*0.05);
  if(Math.hypot(cx-px,cy-py)<=Math.max(10,halfPx+4)) return 'wall-move';
  return null;
}

// 壁を置ける角度の刻み[度]。直角(0/90/180/270)はこの刻みの倍数なので、
// 直角だけを使ってきたプランの操作感は変わらない。
var WALL_ANGLE_STEP_DEG=15;
function getWallAxisSnapThreshold(){
  return Math.max(EDGE_SNAP_THRESH||80, ST.snap ? ST.snap*3 : 30);
}

function wallThicknessMm(w){
  var t=Number(w&&w.thick);
  return isFinite(t)&&t>0?t:120;
}

function addWallSnapCandidate(list,v){
  if(isFinite(v)) list.push(v);
}

function collectWallSnapAxes(floor, excludeWall, movingThick){
  var cands={x:[],y:[],endpointX:[],endpointY:[]};
  var movingHalf=wallThicknessMm({thick:movingThick})/2;
  DATA.walls.forEach(function(w){
    if(!w || w===excludeWall || w.floor!==floor) return;
    var dx=(w.x2||0)-(w.x1||0), dy=(w.y2||0)-(w.y1||0);
    if(Math.hypot(dx,dy)<50) return;
    [w.x1,w.x2].forEach(function(v){addWallSnapCandidate(cands.x,v);addWallSnapCandidate(cands.endpointX,v);});
    [w.y1,w.y2].forEach(function(v){addWallSnapCandidate(cands.y,v);addWallSnapCandidate(cands.endpointY,v);});
    var half=wallThicknessMm(w)/2;
    if(Math.abs(dx)<1){
      var x=(w.x1+w.x2)/2;
      [x,x-half,x+half].forEach(function(v){addWallSnapCandidate(cands.x,v);addWallSnapCandidate(cands.endpointX,v);});
      [x-half-movingHalf,x+half+movingHalf].forEach(function(v){addWallSnapCandidate(cands.x,v);});
    } else if(Math.abs(dy)<1){
      var y=(w.y1+w.y2)/2;
      [y,y-half,y+half].forEach(function(v){addWallSnapCandidate(cands.y,v);addWallSnapCandidate(cands.endpointY,v);});
      [y-half-movingHalf,y+half+movingHalf].forEach(function(v){addWallSnapCandidate(cands.y,v);});
    }
  });
  return cands;
}

function snapNumberToWallCandidates(value,cands,thresh){
  var best=null, min=thresh;
  cands.forEach(function(c){
    var d=Math.abs(value-c);
    if(d<min){min=d;best=c;}
  });
  return best===null?{value:value,snapped:false}:{value:best,snapped:true};
}

function snapWallPointToAxes(point, floor, excludeWall, thickness){
  var cands=collectWallSnapAxes(floor,excludeWall,thickness||120);
  var thresh=getWallAxisSnapThreshold();
  var sx=snapNumberToWallCandidates(point.x,cands.x,thresh);
  var sy=snapNumberToWallCandidates(point.y,cands.y,thresh);
  return {x:sx.value,y:sy.value};
}

function snapWallAnglePoint(anchor, point, e, opts){
  opts=opts||{};
  var floor=opts.floor||ST.floor;
  var thickness=opts.thickness||120;
  var cands=collectWallSnapAxes(floor,opts.excludeWall||null,thickness);
  var thresh=getWallAxisSnapThreshold();
  var sx=snapNumberToWallCandidates(point.x,cands.x,thresh);
  var sy=snapNumberToWallCandidates(point.y,cands.y,thresh);
  var p={x:sx.snapped?sx.value:point.x,y:sy.snapped?sy.value:point.y};
  var dx=p.x-anchor.x, dy=p.y-anchor.y;
  if(Math.abs(dx)<1 && Math.abs(dy)<1) return p;
  // 角度は WALL_ANGLE_STEP_DEG 刻み。直角(0/90/180/270)はその刻みに含まれるので、
  // 直角に置きたいときの操作感は変わらない。直角のときだけは従来どおり
  // 「相手の壁の端点へ吸い付く」処理を通す -- 通し柱の芯を合わせるための機能で、
  // 斜めの壁には対応する候補が無い。
  var deg=Math.atan2(dy,dx)*180/Math.PI;
  var stepped=Math.round(deg/WALL_ANGLE_STEP_DEG)*WALL_ANGLE_STEP_DEG;
  var norm=((stepped%360)+360)%360;
  if(norm===0||norm===180){
    var ex=snapNumberToWallCandidates(point.x,cands.endpointX,thresh);
    p.x=ex.snapped?ex.value:snapV(point.x);
    p.y=anchor.y;
    return p;
  }
  if(norm===90||norm===270){
    p.x=anchor.x;
    var ey=snapNumberToWallCandidates(point.y,cands.endpointY,thresh);
    p.y=ey.snapped?ey.value:snapV(point.y);
    return p;
  }
  // 斜め: 長さだけをグリッドに乗せ、角度は刻みちょうどに保つ。
  // 座標を丸めてから角度を作ると刻みからずれるので、丸めるのは長さの側。
  var rad=norm*Math.PI/180;
  var len=Math.max(0,snapV(Math.sqrt(dx*dx+dy*dy)));
  return {x:anchor.x+len*Math.cos(rad),y:anchor.y+len*Math.sin(rad)};
}
// 壁1本を平行移動する。端点ではなく線上を掴んでいるときのドラッグ。
function applyWallTranslate(w,orig,dxMm,dyMm){
  var sx=snapV(dxMm), sy=snapV(dyMm);
  w.x1=orig.x1+sx; w.y1=orig.y1+sy;
  w.x2=orig.x2+sx; w.y2=orig.y2+sy;
}

function applyWallDrag(cx,cy,e){
  var w=ST.selected;
  if(!w||!DRAG.origItem) return;
  if(isObjectLocked(w)){ DRAG.active=false; return; }
  if(!DRAG.saved){saveState();DRAG.saved=true;}
  if(DRAG.handle==='wall-move'){
    var scale=ST.zoom*0.05;
    applyWallTranslate(w,DRAG.origItem,(cx-DRAG.startCX)/scale,(cy-DRAG.startCY)/scale);
    ST._snapState=null;
    updateProps();
    return;
  }
  var p=c2w(cx,cy), sx=snapV(p.x), sy=snapV(p.y);
  var fixed=DRAG.handle==='wall-a'?{x:DRAG.origItem.x2,y:DRAG.origItem.y2}:{x:DRAG.origItem.x1,y:DRAG.origItem.y1};
  var snapped=snapWallAnglePoint(fixed,{x:sx,y:sy},e,{floor:w.floor,excludeWall:w,thickness:wallThicknessMm(w)});
  sx=snapped.x; sy=snapped.y;
  if(DRAG.handle==='wall-a'){w.x1=sx;w.y1=sy;}
  if(DRAG.handle==='wall-b'){w.x2=sx;w.y2=sy;}
  ST._snapState=null;
  updateProps();
}

function isStairPartType(type){
  return type==='stair'||type==='stair-corner'||type==='stair-landing';
}
// 踊り場。階段の部材だが段を持たない -- かね折れ(L字)・折り返し(U字)の
// 曲がりを、廻り段ではなく平らな板で作るためのものである。
function isStairLandingType(type){
  return type==='stair-landing';
}
function isCustomBlockType(type){
  return type==='custom-block';
}
function getCustomBlockHeight(it){
  var v=Number(it&&it.customHeight);
  return isFinite(v)?Math.max(10,Math.min(6000,v)):900;
}

// ─── Resize edge snap helper ──────────────────────
// Snaps moving edge(s) to nearest object edge (axis-aligned items only)
function applyResizeEdgeSnap(h, o, nx, ny, nw, nd, excludeId){
  var thresh=EDGE_SNAP_THRESH;
  var cands=getEdgeCandidates(excludeId);
  var ss={snapX:false,snapXVal:null,snapY:false,snapYVal:null};
  // East: right edge snaps to candidate X
  if(h.indexOf('e')>=0){
    var re=nx+nw, bx=null, md=thresh;
    cands.x.forEach(function(c){var d=Math.abs(re-c);if(d<md){md=d;bx=c;}});
    if(bx!==null){nw=Math.max(100,bx-nx);ss.snapX=true;ss.snapXVal=bx;}
  }
  // West: left edge snaps to candidate X (right edge stays fixed)
  if(h.indexOf('w')>=0){
    var le=nx, bx=null, md=thresh;
    cands.x.forEach(function(c){var d=Math.abs(le-c);if(d<md){md=d;bx=c;}});
    if(bx!==null){var re2=o.x+o.w;nx=bx;nw=Math.max(100,re2-nx);ss.snapX=true;ss.snapXVal=bx;}
  }
  // South: bottom edge snaps to candidate Y
  if(h.indexOf('s')>=0){
    var be=ny+nd, by=null, md=thresh;
    cands.y.forEach(function(c){var d=Math.abs(be-c);if(d<md){md=d;by=c;}});
    if(by!==null){nd=Math.max(100,by-ny);ss.snapY=true;ss.snapYVal=by;}
  }
  // North: top edge snaps to candidate Y (bottom edge stays fixed)
  if(h.indexOf('n')>=0){
    var te=ny, by=null, md=thresh;
    cands.y.forEach(function(c){var d=Math.abs(te-c);if(d<md){md=d;by=c;}});
    if(by!==null){var be2=o.y+o.d;ny=by;nd=Math.max(100,be2-ny);ss.snapY=true;ss.snapYVal=by;}
  }
  return {nx:nx,ny:ny,nw:nw,nd:nd,snapState:ss};
}

function applyHandleDrag(cx,cy,e){
  var h=DRAG.handle, o=DRAG.origItem, it=ST.selected;
  if(!it||!o) return;
  if(isObjectLocked(it)){ DRAG.active=false; return; }
  if(DRAG.group&&DRAG.group.length>1&&(h==='move'||h==='wall-move')){
    if(Math.hypot(cx-DRAG.startCX,cy-DRAG.startCY)<3&&!DRAG.saved)return;
    if(!DRAG.saved){saveState();DRAG.saved=true;}
    var gx=snapV((cx-DRAG.startCX)/(ST.zoom*.05)),gy=snapV((cy-DRAG.startCY)/(ST.zoom*.05));
    DRAG.group.forEach(function(entry){var target=entry.obj,base=entry.orig;
      if(isObjectLocked(target))return;
      if(base.x1!==undefined){target.x1=base.x1+gx;target.y1=base.y1+gy;target.x2=base.x2+gx;target.y2=base.y2+gy;}
      else{target.x=base.x+gx;target.y=base.y+gy;}
    });ST._snapState=null;return;
  }
  if(h==='wall-a'||h==='wall-b'||h==='wall-move'){applyWallDrag(cx,cy,e);return;}
  if(!DRAG.saved){saveState(); DRAG.saved=true;}
  var dx=(cx-DRAG.startCX)/(ST.zoom*0.05), dy=(cy-DRAG.startCY)/(ST.zoom*0.05);
  var onMobile=isMobileLayout();

  if(h==='move'){
    var nx=o.x+dx, ny=o.y+dy;
    var gridSnapped=snapRectOriginToGrid(nx,ny,it.w||0,it.d||0,it.rot||0);
    nx=gridSnapped.x; ny=gridSnapped.y;
    var useEdgeSnap=isShiftLike(e);
    if(useEdgeSnap&&it.type!=='wall'){
      var snapped=applyEdgeSnap(nx,ny,it.w||0,it.d||0,it.id,it.rot||0);
      nx=snapped.x; ny=snapped.y; ST._snapState=snapped;
    } else { ST._snapState=null; }
    it.x=nx; it.y=ny;

  }else if(h==='rot'){
    var ocx=o.x+o.w/2, ocy=o.y+o.d/2;
    var sc2=ST.zoom*0.05;
    var oAng=Math.atan2(cy-ST.panY-ocy*sc2, cx-ST.panX-ocx*sc2);
    var sAng=Math.atan2(DRAG.startCY-ST.panY-ocy*sc2, DRAG.startCX-ST.panX-ocx*sc2);
    var nRot=o.rot+(oAng-sAng)*180/Math.PI;
    // Snap: 15° on mobile always; 15° on desktop with Shift; 45° on double-Shift (ctrl)
    if(onMobile||isShiftLike(e)){
      var step=(e&&e.ctrlKey)?45:15;
      nRot=Math.round(nRot/step)*step;
    }
    ST._snapState=null;
    it.rot=nRot;

  }else{
    // Resize
    var nw=o.w, nd=o.d, nx=o.x, ny=o.y;
    var rad=-(o.rot||0)*Math.PI/180;
    var ldx=dx*Math.cos(rad)-dy*Math.sin(rad);
    var ldy=dx*Math.sin(rad)+dy*Math.cos(rad);

    var isCorner=h.length===2; // 'nw','ne','se','sw' are 2 chars; 'n','s','e','w' are 1 char
    var freeCornerResize = isStairPartType(it.type) || isCustomBlockType(it.type);
    if(isCorner && !freeCornerResize && o.w>0 && o.d>0){
      // Corner drag: maintain aspect ratio via diagonal projection
      var hw=o.w/2, hd=o.d/2;
      var dirX=(h.indexOf('e')>=0)?hw:-hw;
      var dirY=(h.indexOf('s')>=0)?hd:-hd;
      var scale=1+(ldx*dirX+ldy*dirY)/(hw*hw+hd*hd);
      scale=Math.max(scale,0.1);
      nw=o.w*scale; nd=o.d*scale;
    } else {
      // Edge drag: one dimension only
      if(h.indexOf('e')>=0) nw=o.w+ldx;
      if(h.indexOf('w')>=0) nw=o.w-ldx;
      if(h.indexOf('s')>=0) nd=o.d+ldy;
      if(h.indexOf('n')>=0) nd=o.d-ldy;
    }

    // Grid snap is the default; Shift enables object-edge snap after grid rounding.
    var snapG=ST.snap||0;
    var minSz=snapG||100;
    if(isCorner && !freeCornerResize && o.w>0 && o.d>0){
      // Corner: snap width, derive height from ratio, enforce minimums while keeping ratio
      if(snapG) nw=Math.round(nw/snapG)*snapG;
      nw=Math.max(minSz,nw);
      nd=nw*(o.d/o.w);
      if(nd<minSz){ nd=minSz; nw=Math.max(minSz,nd*(o.w/o.d)); }
    } else {
      if(snapG){ nw=Math.round(nw/snapG)*snapG; nd=Math.round(nd/snapG)*snapG; }
      nw=Math.max(minSz,nw); nd=Math.max(minSz,nd);
      // Restore the dimension not being resized (snap may have drifted it)
      if(!isCorner && (h==='e'||h==='w')) nd=o.d;
      if(!isCorner && (h==='s'||h==='n')) nw=o.w;
    }

    // Position: move the stored center along the item's local axes.
    var oldCx=o.x+o.w/2, oldCy=o.y+o.d/2;
    var dW=nw-o.w, dD=nd-o.d;
    var shiftX=0, shiftY=0;
    if(h.indexOf('e')>=0) shiftX+=dW/2;
    if(h.indexOf('w')>=0) shiftX-=dW/2;
    if(h.indexOf('s')>=0) shiftY+=dD/2;
    if(h.indexOf('n')>=0) shiftY-=dD/2;
    var wrad=(o.rot||0)*Math.PI/180;
    var newCx=oldCx + shiftX*Math.cos(wrad) - shiftY*Math.sin(wrad);
    var newCy=oldCy + shiftX*Math.sin(wrad) + shiftY*Math.cos(wrad);
    nx=newCx-nw/2; ny=newCy-nd/2;

    // Edge snap for resize — axis-aligned items only (rot near 0/90/180/270); skip for corners (would break ratio)
    var isAxisAligned=Math.abs((o.rot||0)%90)<4;
    if(isShiftLike(e)&&!isCorner&&isAxisAligned&&it.type!=='wall'&&it.type!=='room'&&!isStairPartType(it.type)){
      var res=applyResizeEdgeSnap(h,o,nx,ny,nw,nd,it.id);
      nx=res.nx; ny=res.ny; nw=res.nw; nd=res.nd;
      ST._snapState=res.snapState;
    } else { ST._snapState=null; }

    if(it.type==='walk-route' && Array.isArray(o.pathPoints)){
      var sx=o.w?nw/o.w:1, sy=o.d?nd/o.d:1;
      it.pathPoints=o.pathPoints.map(function(p){return {x:(Number(p.x)||0)*sx,y:(Number(p.y)||0)*sy};});
    }
    if(it.windowStd && nw!==o.w) delete it.windowStd; // 手動リサイズで規格プリセット表示を解除
    it.w=nw; it.d=nd; it.x=nx; it.y=ny;
  }
  if(!DRAG.active) updateProps();
}

function hitHandle(it,mx,my){
  var sc=ST.zoom*0.05;
  var pose=getItemDisplayPose(it);
  var ccx=ST.panX+pose.x*sc, ccy=ST.panY+pose.y*sc;
  var selHalf=getItemSelectionHalfExtentsPx(it,sc);
  var hw=selHalf.hw, hd=selHalf.hd;
  var dx=mx-ccx, dy=my-ccy;
  var rad=-(pose.rot||0)*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad);
  var lx=dx*cos-dy*sin, ly=dx*sin+dy*cos;
  var handles=[
    {lx:-hw,ly:-hd,t:'nw'},{lx:0,ly:-hd,t:'n'},{lx:hw,ly:-hd,t:'ne'},
    {lx:hw,ly:0,t:'e'},{lx:hw,ly:hd,t:'se'},{lx:0,ly:hd,t:'s'},
    {lx:-hw,ly:hd,t:'sw'},{lx:-hw,ly:0,t:'w'}
  ];
  if(it.type !== 'room') handles.push({lx:0,ly:-hd-30,t:'rot'});
  for(var i=0;i<handles.length;i++){
    if(Math.abs(lx-handles[i].lx)<10&&Math.abs(ly-handles[i].ly)<10) return handles[i].t;
  }
  if(isSwingDoorType(it.type)){
    return isInsideSwingDoor2dLocal(it,lx/sc,ly/sc)?'move':null;
  }
  var hitPad=getItemHitPadding(it);
  return (Math.abs(lx)<=hw+hitPad.x*sc&&Math.abs(ly)<=hd+hitPad.y*sc)?'move':null;
}
