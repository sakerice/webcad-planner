// 高さの読み取りを1か所に集める。既存プランは高さフィールドを持たないので、
// 省略時の値は現行の定数 (WALL_H / FLOOR_H / FLOOR_SLAB_H) と完全に一致させる。
// ここがずれると、既に保存されている家の寸法が黙って変わる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeightModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var DEFAULTS = {
    storyHeightMm: 2700,      // 現行 FLOOR_H
    ceilingHeightMm: 2400,    // 現行 WALL_H
    floorSlabMm: 180,         // 現行 FLOOR_SLAB_H
    wetAreaCeilingMm: 2200,
    droppedCeilingMm: 2100,   // 建築基準法における居室の下限
    loftMaxMm: 1400,
    firstFloorLevelMm: 400,
    slopedLowMm: 2200,
    slopedHighMm: 3600,
    skipLevelMaxMm: 2400
  };

  var WALL_HEIGHT_CONTRACT=Object.freeze({version:1,field:'wallHeight',unit:'mm',minMm:300,maxMm:6000,origin:'explicit-display-assumption'});
  function isExplicitWallHeightMm(v){return typeof v==='number'&&Number.isFinite(v)&&v>=WALL_HEIGHT_CONTRACT.minMm&&v<=WALL_HEIGHT_CONTRACT.maxMm;}

  var ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  // ↑ ↗ → ↘ ↓ ↙ ← ↖

  // 壊れたプランでレンダを壊さない。数値でない・非有限・0以下はすべて既定へ。
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
  }

  // direction は 0 (北) を正当な値として扱う必要があるため、正数制約を課さない。
  function numAny(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  // 階高には下限がある。天井高を明示していない部屋は階高をそのまま天井とするが、
  // 外壁は「階高」を下限として立つ。階高が (既定天井高 + 床スラブ) を下回ると、
  // 天井が外壁の下限より下に来て、内側から隙間が開く -- Task 2b で外壁に開いた
  // スリットの、内外を裏返した形。まだこの値を書き込む経路は無いが、
  // 書けるようになってから気づくのでは遅い。
  var MIN_STORY_HEIGHT_MM = DEFAULTS.ceilingHeightMm + DEFAULTS.floorSlabMm; // 2580
  function storyHeightMm(plan, floor) {
    var floors = plan && plan.floors;
    var entry = floors ? floors[floor] : undefined;
    var raw = entry ? entry.storyHeight : undefined;
    var v = num(raw, DEFAULTS.storyHeightMm);
    return v < MIN_STORY_HEIGHT_MM ? MIN_STORY_HEIGHT_MM : v;
  }

  // スキップフロアの段差 (mm)。**同じ階の中で床ごと持ち上がる高さ**で、
  // room.floorRaiseMm (仕上げの段差・天井は動かない) とは別物である。
  // 省略時は 0 -- 既存プランはこのフィールドを持たないので、床も天井も1mmも動かない。
  //
  // 上限を 2400 にしてあるのは、これを超えると「同じ階の中の段差」ではなく
  // もう1つの階になるからである (階高の既定が 2700)。
  function skipLevelMm(plan, room) {
    var raw = room ? room.skipLevelMm : undefined;
    if (typeof raw !== 'number' || !isFinite(raw) || raw <= 0) return 0;
    return Math.min(Math.round(raw), DEFAULTS.skipLevelMaxMm);
  }

  function ceilingHeightMm(plan, room) {
    var raw;
    if (room && room.ceiling && room.ceiling.heightMm !== undefined) {
      raw = room.ceiling.heightMm;
    } else if (room) {
      raw = room.ceilingHeight;
    }
    return num(raw, DEFAULTS.ceilingHeightMm);
  }

  function ceilingArrow(direction) {
    var d = numAny(direction, 0);
    var idx = Math.round(d / 45) % 8;
    if (idx < 0) idx += 8;
    return ARROWS[idx];
  }

  function ceilingShape(plan, room) {
    if (room && room.ceiling && room.ceiling.type === 'sloped') {
      var low = num(room.ceiling.lowMm, DEFAULTS.slopedLowMm);
      var high = num(room.ceiling.highMm, DEFAULTS.slopedHighMm);
      var direction = numAny(room.ceiling.direction, 0);
      if (low > high) {
        var tmp = low;
        low = high;
        high = tmp;
      }
      return { type: 'sloped', lowMm: low, highMm: high, direction: direction };
    }
    return { type: 'flat', heightMm: ceilingHeightMm(plan, room) };
  }

  function ceilingLabel(plan, room) {
    var shape = ceilingShape(plan, room);
    if (shape.type === 'sloped') {
      return 'CH ' + shape.lowMm + '-' + shape.highMm + ' ' + ceilingArrow(shape.direction);
    }
    return 'CH ' + shape.heightMm;
  }

  // Existing editor window normalization, shared by native properties and
  // snapshot Scene IR compilation. It mutates only the supplied item copy.
  function normalizeWindowVerticalProps(it,maxTop) {
    var sill=Number(it.windowSill),height=Number(it.windowHeight);
    if(!isFinite(sill))sill=it.type==='window-door'?0:900;
    if(!isFinite(height))height=it.type==='window-door'?2100:1200;
    sill=Math.max(0,Math.min(maxTop-200,sill));
    height=Math.max(200,Math.min(maxTop,height));
    if(sill+height>maxTop)height=Math.max(200,maxTop-sill);
    it.windowSill=Math.round(sill);it.windowHeight=Math.round(height);
    if(it.windowTop!==undefined)delete it.windowTop;
    return it;
  }
  function editorWallHeightMm(plan,floor,fallback) {
    var hd=plan&&plan.heightDefaults||{},entry=plan&&plan.floors&&plan.floors[String(floor)],v=Number(entry&&entry.wallHeight);
    if(hd.perFloor&&isFinite(v)&&v>0)return Math.max(300,Math.min(6000,Math.round(v)));
    if(fallback!==undefined){v=Number(fallback);return isFinite(v)&&v>0?v:2400;}
    // The native plan loader rounds/clamps the stored global height. Do the
    // same read here without calling ensureHeightDefaults or touching globals.
    v=Number(hd.wallHeight);return isFinite(v)&&v>0?Math.max(1800,Math.min(4000,Math.round(v))):2400;
  }
  function newRoomFloorRaiseMm(plan,floor) {
    var f=floor||1,hd=plan&&plan.heightDefaults||{},entry=plan&&plan.floors&&plan.floors[String(f)],v;
    if(hd.perFloor&&entry&&isFinite(Number(entry.floorRaise)))v=Number(entry.floorRaise);
    else if(!hd.perFloor&&hd.floorRaiseSet){v=Number(hd.floorRaise);if(!isFinite(v))v=0;}
    return v===undefined?(f===1?150:0):Math.max(0,Math.min(600,Math.round(v)));
  }
  function wallHeightMm(plan,wall,fallback) {
    var v=Number(wall&&wall.wallHeight);
    return isFinite(v)?Math.max(WALL_HEIGHT_CONTRACT.minMm,Math.min(WALL_HEIGHT_CONTRACT.maxMm,v)):editorWallHeightMm(plan,wall&&wall.floor,fallback);
  }
  function windowMaxTopMm(plan,item) {
    var wall=item&&item._wallRef;
    if(item&&(item.sceneImportVersion===2||item.sceneImportVersion===3||item.openingHostWallId!==undefined)){
      if(!wall){var matches=(plan.walls||[]).filter(function(w){return w&&w.id===item.openingHostWallId;});if(matches.length===1)wall=matches[0];}
      if(!wall)wall={floor:item.floor};
    }
    return Math.max(200,wallHeightMm(plan,wall)-50);
  }
  function sceneRuntime(snapshot) {
    var target=JSON.parse(JSON.stringify(snapshot||{}));
    return {targetPlan:target,defaultWallHeightMmForFloor:function(floor){return editorWallHeightMm(target,floor);},defaultFloorOffset:function(floor){return newRoomFloorRaiseMm(target,floor);},
      windowVerticalLimitMm:function(floor,adjacentRooms,host){
        var raise=Math.max.apply(null,[0].concat(adjacentRooms.map(function(room){var finish=typeof room.floorRaiseMm==='number'?room.floorRaiseMm:newRoomFloorRaiseMm(target,floor);return Math.max(0,finish)+Math.max(0,room.skipLevelMm||0);})));
        return wallHeightMm(target,host||{floor:floor})-50-raise;
      },normalizeWindow:function(item,host){
        if(host)item._wallRef=host;
        normalizeWindowVerticalProps(item,windowMaxTopMm(target,item));delete item._wallRef;return item;
      }};
  }

  return {
    WALL_HEIGHT_CONTRACT: WALL_HEIGHT_CONTRACT,
    isExplicitWallHeightMm: isExplicitWallHeightMm,
    wallHeightMm: wallHeightMm,
    sceneRuntime: sceneRuntime,
    editorWallHeightMm: editorWallHeightMm,
    normalizeWindowVerticalProps: normalizeWindowVerticalProps,
    DEFAULTS: DEFAULTS,
    MIN_STORY_HEIGHT_MM: MIN_STORY_HEIGHT_MM,
    storyHeightMm: storyHeightMm,
    skipLevelMm: skipLevelMm,
    ceilingHeightMm: ceilingHeightMm,
    ceilingShape: ceilingShape,
    ceilingLabel: ceilingLabel
  };
}));
