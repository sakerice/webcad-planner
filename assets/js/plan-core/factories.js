// 壁・物・部屋を作る関数。画面にも Worker にも依存しない。
//
// 今まで assets/js/plan-data.js の mkWall / mkItem と、index.html・plan-import.js の
// 部屋の作り方に別々に書いてあったものを、1か所に集める。
// 外の世界(連番、カタログ、階ごとの高さ)は、すべて引数 ctx から呼ぶ。
// ctx の形は docs/superpowers/plans/2026-11-13-stage2-factories-patch.md の Task 2 に書いてある。
// 画面用の実物は assets/js/plan-data.js の planCoreCtx()。
// 項目を足す順番は保存 JSON の並びになるので、変えてはいけない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanCoreFactories = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function makeWall(args, ctx) {
    var floor = args.floor || 1;
    return {
      id: ctx.newId(), x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, floor: floor,
      thick: args.thick || 120, color: args.color || '#888888', texture: null,
      textureFlipX: false, textureFlipY: false, texScale: 1, _texObj: null,
      wallBand: 'full', wallStyle: 'solid', wallHeight: ctx.plan.wallHeightForFloor(floor),
      wallTopShape: 'flat', wallTopSide: 'both'
    };
  }

  function makeItem(type, args, ctx) {
    var cat = ctx.catalog;
    type = cat.resolveType(type);
    var sz = cat.defaultSize(type);
    var item = {
      id: ctx.newId(), type: type, x: args.x, y: args.y, rot: args.rot || 0, floor: args.floor || 1,
      modelFacingVersion: 1,
      w: args.w || sz.w, d: args.d || sz.d, color: cat.defaultColor(type) || '#ddd',
      flipX: false, flipY: false, textureFlipX: false, textureFlipY: false, sScale: 1, sX: 0, sY: 0
    };
    if (type === 'neighbor-house') item.neighborFacingVersion = 1;
    if (type === 'wood-fence') {
      item.fenceHeight = 1600;
      item.fencePattern = 'horizontal';
      item.fenceTopStyle = 'even';
    }
    if (type === 'lattice-screen') {
      item.latticeHeight = 1600;
      item.fencePattern = 'vertical';
      item.fenceTopStyle = 'even';
    }
    if (type === 'foundation') {
      item.foundationHeight = 450;
    }
    if (type === 'stair-landing') {
      // 踊り場は段を持たない。並び順は自動判定に任せる。
      item.w = 1820; item.d = 910;
    }
    if (type === 'column' || type === 'column-round') {
      item.columnHeight = 2400;
    }
    if (type === 'shelf-built-in') {
      item.shelfCount = 3;
      item.shelfHeight = 900;
    }
    if (type === 'exterior-stair') {
      item.targetHeight = ctx.plan.foundationHeight() || 450;
      item.accessSteps = 3;
    }
    if (type === 'ramp') {
      item.targetHeight = ctx.plan.foundationHeight() || 450;
    }
    if (type === 'site-rect') {
      item.siteSurface = 'grass';
    }
    if (type === 'custom-block') {
      item.customHeight = 900;
      item.name = '任意ブロック';
      item.colorCustom = true;
    }
    if (cat.is('light', type)) {
      cat.applyLightDefaults(item);
      item.colorCustom = true;
    }
    if (type === 'memo') {
      item.noteText = 'メモ';
      item.color = '#fff3a6';
      item.colorCustom = true;
    }
    if (type === 'ruler') {
      item.d = cat.constants.rulerThickness;
      item.color = '#2f80ed';
      item.colorCustom = true;
    }
    if (type === 'walk-route') {
      item.d = cat.constants.walkRouteThickness;
      item.walkSpeed = cat.constants.walkDefaultSpeed;
      item.color = '#10b981';
      item.colorCustom = true;
    }
    if (cat.is('contextExterior', type)) {
      item.contextHeight = cat.contextExteriorHeight(type);
      if (type === 'neighbor-building' || type === 'neighbor-house') item.contextFloors = cat.contextFloors(type);
    }
    if (cat.is('windowLike', type)) {
      item.windowSill = type === 'window-door' ? 0 : 900;
      item.windowHeight = type === 'window-door' ? 2100 : 1200;
    }
    if (cat.is('doorLikeOpening', type)) {
      item.doorHeight = type === 'door-front' ? 2330 : 2000;
      if (cat.is('doorPanel', type)) item.doorOpenState = 'open';
    }
    if (cat.canSetElevation(item)) item.elev = (type === 'meter-box') ? 1600 : (type === 'fmp-AirConditionerWall01' ? 2000 : 0);
    var model = cat.model(type);
    if (model) {
      item.fmpId = type;
      if (model.defaultElevation) item.elev = model.defaultElevation;
      item.color = null;
      item.colorCustom = false;
    }
    if (type === 'roof') {
      item.roofType = 'gable';
      item.pitch = 30;
      item.color = '#2a2a30';
      item.roofThickness = 180;
      item.roofSkirt = 0;
      item.roofEdgeColor = '#3a2f2a';
    }
    return item;
  }

  // 並びは plan-import.js の部屋に合わせる(n は floor の次)。n が無いときは 2D 描画の並びと同じ。
  function makeRoom(args, ctx) {
    var floor = args.floor || 1;
    var room = {
      id: args.id !== undefined && args.id !== null ? args.id : 'rm_' + ctx.newId(),
      type: 'room', x: args.x, y: args.y, w: args.w, d: args.d, floor: floor
    };
    if (args.n !== undefined) room.n = args.n;
    room.floorRaiseMm = ctx.plan.floorRaiseForFloor(floor);
    room.textureFlipX = false;
    room.textureFlipY = false;
    return room;
  }

  return { makeWall: makeWall, makeItem: makeItem, makeRoom: makeRoom };
}));
