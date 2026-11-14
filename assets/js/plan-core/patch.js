// 共同編集で、相手の変更(差分)を間取りに当てる関数。画面にも Worker にも依存しない。
//
// 今まで index.html の applySharedPatch と worker/shared.mjs の applyPatch に
// 別々に書いてあったものを、1か所に集める。画面もルームの Worker もこれを使う。
//
// 差分の形(画面の buildSharedPatch が作る):
//   { collections: { walls: { upserts: [物...], removes: [id...] }, items: ..., rooms: ... },
//     fields: { 欄の名前: 値, ... } }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanCorePatch = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // id で1つずつ差分を取る配列
  var COLLECTIONS = ['walls', 'items', 'rooms'];

  // 丸ごと送り合う欄。送り手(画面の buildSharedPatch)はこの一覧を見る。
  // northDeg(敷地の方位)もここに入れる。入れないと、共同編集の相手が方位を回しても
  // 手元には届かず、同じプランを見ているのに斜線制限の向きと立面図の呼称だけが食い違う。
  // heightDefaults(壁の高さの既定)・floors(階ごとの高さ)・autoRoomLights(部屋の自動照明を切る設定)も
  // 入れる。入れないと、相手が変えても手元に届かず、ルームに入り直すまで古い高さ・照明のまま見続ける。
  // viewState(各自の視点)・planFixes(各自の読み込みで付く移行の済み印)・camStash は入れない。
  var SHARED_FIELDS = ['exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail', 'floorMetadata', 'northDeg',
    'heightDefaults', 'floors', 'autoRoomLights'];

  // 送り手は、プランに無い欄を null として送る。この欄は「無い」ことに意味があるので、
  // null が届いたら欄を消す(autoRoomLights は、入に戻すと欄を消す作り。null を書くと
  // 保存データに余計な欄が残る)。前からある6つの欄は、今までどおり null を書く。
  var ABSENT_WHEN_NULL = ['heightDefaults', 'floors', 'autoRoomLights'];

  function idOf(item) { return String(item && item.id); }

  // plan をその場で直して返す。
  // options.clone(省略可): プランに入れる前に値へ通す関数。画面は _texObj を落とす写しを渡す。
  // fields は COLLECTIONS の名前と viewState を除いて、届いた鍵をすべて書く
  // (SHARED_FIELDS に無い鍵も書く。古い版・新しい版の送り手が混ざっても欄を落とさないため)。
  function applyPatch(plan, patch, options) {
    var clone = options && typeof options.clone === 'function' ? options.clone : null;
    var put = function (v) { return clone ? clone(v) : v; };
    patch = patch || {};
    COLLECTIONS.forEach(function (name) {
      if (!Array.isArray(plan[name])) plan[name] = [];
      var change = patch.collections && patch.collections[name];
      if (!change) return;
      var removed = new Set((change.removes || []).map(String));
      var upserts = new Map();
      (change.upserts || []).forEach(function (item) { if (item) upserts.set(String(item.id), item); });
      var next = plan[name]
        .filter(function (item) { return !removed.has(idOf(item)); })
        .map(function (item) { var id = idOf(item); return upserts.has(id) ? put(upserts.get(id)) : item; });
      var present = new Set(next.map(idOf));
      upserts.forEach(function (item, id) { if (!present.has(id)) next.push(put(item)); });
      plan[name] = next;
    });
    if (patch.fields && typeof patch.fields === 'object') {
      Object.keys(patch.fields).forEach(function (key) {
        if (COLLECTIONS.indexOf(key) >= 0 || key === 'viewState') return;
        var value = patch.fields[key];
        if (value === null && ABSENT_WHEN_NULL.indexOf(key) >= 0) delete plan[key];
        else plan[key] = put(value);
      });
    }
    return plan;
  }

  return { COLLECTIONS: COLLECTIONS, SHARED_FIELDS: SHARED_FIELDS, applyPatch: applyPatch };
}));
