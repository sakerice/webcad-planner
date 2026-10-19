// 読み取った下書きを、いま開いている間取りに触れずに組み立てて、平面図（各階）と外観3D（東西南北と
// 斜め上）を画像にする。
//
// なぜ在るのか
// ------------
// 平面図だけでは気づけない異常（屋根が無い・バルコニーが箱になる・物が逆を向く）が、3Dで見ると
// 一目で分かる。読み取りのたびに AI 自身にそれを見せて直させるため（2026-10-19 利用者と合意。
// 決まりで答えを上書きせず、判断は AI に任せる）。
//
// やり方は比較モード（compare-mode.js）と同じ: 全体の変数（DATA・3Dの場面など）を一時的に
// 入れ替えて組み立て・描画し、**同じ一度の流れの中で**必ず元へ戻す。途中で待たないので、
// 共有の同期や自動保存のタイマーが一時的な間取りを読むことはない。共同編集中は使わない
// （相手に送られうるため）。家具の3Dモデルは読み込みが非同期なので、初めて使うモデルは
// 箱や欠けとして写ることがある。
var PlanSnapshot = (function () {
  var GLOBALS = ['DATA', 'HISTORY', 'REDO_HISTORY', 'DIRTY', 'nextId', 'PLAN_LIBRARY_ID', 'PLAN_SAVE_INFO',
    'sc3', '_skyMesh', '_gndMesh', '_doorAnims', '_fmpInstancePools', '_downspoutRegistry',
    '_activeInteriorShadowLightCount', '_lightBudget', '_cutawayViewKey', '_walkCollWalls', '_walkCollFloor',
    '_walkCullApplied', '_walkCullAt', '_setbackRoofCache', '_setbackRoomRoofsCache', '_roofCeilingExtentCache',
    '_wallOutsideGridCache', '_stairLinkCache', '_roofPolygonModelCache', '_roofPolygonModelCacheN', '_setbackBuildingBox'];
  var VIEW_KEYS = ['floor', 'zoom', 'panX', 'panY', 'selected', 'multiSelected', 'selectAll', 'view'];
  var SHOT_W = 960, SHOT_H = 640;

  function fresh() {
    return { DATA: null, HISTORY: [], REDO_HISTORY: [], DIRTY: false, nextId: window.nextId, PLAN_LIBRARY_ID: null, PLAN_SAVE_INFO: null,
      sc3: null, _skyMesh: null, _gndMesh: null, _doorAnims: [], _fmpInstancePools: {}, _downspoutRegistry: [],
      _activeInteriorShadowLightCount: 0,
      _lightBudget: { list: null, x: NaN, y: NaN, z: NaN, at: 0, culled: false, dummies: null, sig: '', precompiled: false },
      _cutawayViewKey: '', _walkCollWalls: null, _walkCollFloor: null, _walkCullApplied: false, _walkCullAt: 0,
      _setbackRoofCache: null, _setbackRoomRoofsCache: {}, _roofCeilingExtentCache: {}, _wallOutsideGridCache: {},
      _stairLinkCache: {}, _roofPolygonModelCache: {}, _roofPolygonModelCacheN: 0, _setbackBuildingBox: null };
  }

  function syncPlanGlobals() {
    resetHeightGlobalsForPlanLoad();
    syncNorthFromPlan();
    ensureHeightDefaults();
  }

  function available() {
    return typeof DATA !== 'undefined' && typeof capturePlan2dDataUrl === 'function'
      && !(typeof SHARED !== 'undefined' && SHARED && SHARED.roomId);
  }

  function disposeScene(sc) {
    if (!sc) return;
    sc.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    });
    sc.clear();
  }

  // plan: アプリの形の間取り {walls, rooms, items}（取り込みで DATA に入るのと同じもの）。
  // 返り値: { plans: [{floor, url}], views: [{name, url}] }。撮れなければ null。
  function capture(plan) {
    if (!available() || !plan) return null;
    // 3Dをまだ一度も開いていなければ、いまの間取りの3Dの場面をここで用意してから入れ替える。
    // 入れ替えたあとで用意すると、元へ戻すときに「場面が無い」状態まで戻してしまい、描画の準備は
    // 済んだ扱いのまま場面が二度と作られず、外観3D・内観3Dが何も映らなくなる（2026-10-20 利用者の報告）。
    // 平面図を見ている間は3Dの枠が隠れていて大きさが0になるため、見えない形で一時的に広げて作る。
    if (typeof THREE !== 'undefined' && typeof ren !== 'undefined' && !ren) {
      var wrap = document.getElementById('c3d-wrap');
      var was = wrap ? { display: wrap.style.display, visibility: wrap.style.visibility } : null;
      if (wrap) { wrap.style.visibility = 'hidden'; wrap.style.display = 'block'; }
      try { init3D(); } finally { if (wrap) { wrap.style.display = was.display; wrap.style.visibility = was.visibility; } }
    }
    var keep = {}, view = {};
    GLOBALS.forEach(function (k) { keep[k] = window[k]; });
    VIEW_KEYS.forEach(function (k) { view[k] = ST[k]; });
    var keepInt = window.isInt;
    var cam = (typeof camExt !== 'undefined' && camExt) ? { pos: camExt.position.clone(), aspect: camExt.aspect } : null;
    var target = (typeof orbit !== 'undefined' && orbit) ? orbit.target.clone() : null;
    var renSize = null, renRatio = 1;
    var out = { plans: [], views: [] };
    var tempScene = null;
    try {
      var f = fresh();
      Object.keys(f).forEach(function (k) { window[k] = f[k]; });
      DATA = JSON.parse(JSON.stringify(plan));
      ST.selected = null; ST.multiSelected = []; ST.selectAll = false;
      syncPlanGlobals(); ensureObjectIds(); ensureExteriorWallSettings(); ensureInteriorWallSettings();
      ensureRoofAppearance(); ensureFloorMetadata(); syncExteriorWallSettings();

      var floors = [];
      (DATA.walls || []).forEach(function (w) { var fl = w.floor || 1; if (floors.indexOf(fl) < 0) floors.push(fl); });
      floors.sort(function (a, b) { return a - b; });
      floors.forEach(function (fl) {
        out.plans.push({ floor: fl, url: capturePlan2dDataUrl({ floor: fl, fit: true, mimeType: 'image/jpeg' }) });
      });

      if (typeof THREE !== 'undefined') {
        if (typeof ren !== 'undefined' && ren && camExt) {
          createScene3DBase({});
          tempScene = sc3;
          ST.view = 'ext'; window.isInt = false;
          build3D();
          renSize = new THREE.Vector2(); ren.getSize(renSize); renRatio = ren.getPixelRatio();
          ren.setPixelRatio(1); ren.setSize(SHOT_W, SHOT_H, false);
          camExt.aspect = SHOT_W / SHOT_H; camExt.updateProjectionMatrix();
          var shot = function (name) {
            if (ren.shadowMap) ren.shadowMap.needsUpdate = true;
            ren.render(sc3, camExt);
            out.views.push({ name: name, url: ren.domElement.toDataURL('image/jpeg', 0.85) });
          };
          // 立面の向きに合わせたあと、少し引く（奥行きの浅い家を横から見ると、高さが切れるため）。
          var back = function (k) {
            var c = orbit.target, p = camExt.position;
            camExt.position.set(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k, c.z + (p.z - c.z) * k);
            camExt.lookAt(c);
          };
          [['s', '南から'], ['e', '東から'], ['n', '北から'], ['w', '西から']].forEach(function (d) {
            snapCameraToElevation(d[0]); back(1.6); shot(d[1]);
          });
          // 南東の斜め上から（屋根と、上の階の載り方を見る）
          snapCameraToElevation('s');
          var c = orbit.target, p = camExt.position, dist = p.distanceTo(c);
          camExt.position.set(c.x + dist * 0.6, c.y + dist * 0.55, c.z + dist * 0.6);
          camExt.lookAt(c);
          shot('南東の斜め上から');
        }
      }
    } catch (e) {
      out.error = String(e && e.message || e);
    } finally {
      GLOBALS.forEach(function (k) { window[k] = keep[k]; });
      VIEW_KEYS.forEach(function (k) { ST[k] = view[k]; });
      window.isInt = keepInt;
      syncPlanGlobals();
      if (renSize && typeof ren !== 'undefined' && ren) { ren.setPixelRatio(renRatio); ren.setSize(renSize.x, renSize.y, false); }
      if (cam && camExt) { camExt.position.copy(cam.pos); camExt.aspect = cam.aspect; camExt.updateProjectionMatrix(); }
      if (target && orbit) { orbit.target.copy(target); orbit.update(); }
      disposeScene(tempScene);
      if (typeof invalidate3D === 'function') invalidate3D();
      if (typeof draw2d === 'function') draw2d();
    }
    return out;
  }

  return { capture: capture, available: available };
})();
