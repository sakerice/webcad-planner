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
  // 差分の upsert が当たる鍵。id が無い・null の物には upsert を当てない(null を返す)。
  // 当てると、id の無い物が何万個あっても1つの upsert が全部に写り、プランが何十倍にも膨らむため。
  // removes は今までどおり idOf で当てる(画面は、id の無い物に id を振ったあと、元の物を "undefined" で消す)。
  // Worker の大きさの見積もり(worker/room-guard.mjs の maxSameId と collab-room.mjs)も、この関数で数える。
  function upsertKey(item) { return item && item.id !== undefined && item.id !== null ? String(item.id) : null; }

  // 危ない鍵。JSON.parse は "__proto__" を自分の鍵として作るので、値の中に残っていると、
  // あとで Object.assign や代入で写したときにプロトタイプを差し替えてしまう。
  // toString・valueOf などを自分の鍵に持つオブジェクトは、文字や数に直すところで例外になる
  // (部屋の名前を描く・要約に書く、など)。どの深さでも受け付けない。
  // 一覧は prototype と、Object.prototype にある名前(実行環境に依らないよう固定で持つ)。
  var UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'toLocaleString', 'valueOf',
    'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'];
  // 値をたどる深さの上限(プランの物の中は、手元で最も深くても3段)。超えたら危ないとみなす。
  var MAX_SCAN_DEPTH = 64;

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // id が UNSAFE_KEYS の名前か。画面はこの id を鍵に設定表を作るので、そういう物は受け取らない(Worker の検査と同じ決まり)。
  function unsafeId(id) { return typeof id === 'string' && UNSAFE_KEYS.indexOf(id) >= 0; }

  // v のどこかに危ない鍵があるか(深すぎるときも true)。自分の鍵だけを見る。
  function hasUnsafeKey(v, depth) {
    if (!v || typeof v !== 'object') return false;
    depth = depth || 0;
    if (depth > MAX_SCAN_DEPTH) return true;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) if (hasUnsafeKey(v[i], depth + 1)) return true;
      return false;
    }
    var keys = Object.keys(v);
    for (var j = 0; j < keys.length; j++) {
      if (UNSAFE_KEYS.indexOf(keys[j]) >= 0) return true;
      if (hasUnsafeKey(v[keys[j]], depth + 1)) return true;
    }
    return false;
  }

  // plan をその場で直して返す。
  // options.clone(省略可): プランに入れる前に値へ通す関数。画面は _texObj を落とす写しを渡す。
  // fields は COLLECTIONS の名前と viewState を除いて、届いた鍵をすべて書く
  // (SHARED_FIELDS に無い鍵も書く。古い版・新しい版の送り手が混ざっても欄を落とさないため)。
  // 形の合わない部分は黙って飛ばす(例外を出さない)。ルームの Worker が古い版で形を見ずに流してきても、
  // 受け手のプランが壊れないようにするため。飛ばすもの:
  //   - 集まり(walls・items・rooms)以外の名前、素のオブジェクトでない変更、配列でない upserts・removes
  //   - 素のオブジェクトでない物、文字と有限の数以外の removes の id
  //   - id が UNSAFE_KEYS の名前(constructor・toString など)の物と removes の id
  //   - プランの id の無い・null の物には upsert を当てない(upsertKey)。id の無い upsert の物は、今までどおり
  //     新しい物として足す(プランの id の無い物を置き換えないだけ)
  //   - Object.prototype にある名前の欄(__proto__・constructor・toString など。プランの継承元や関数を差し替えるため)
  //   - 値のどこかに __proto__・constructor・prototype の鍵を含む物と欄
  // 差分のうち当てる部分を取り出す。applyPatch と patchGrowthBound が同じものを使う(数え方が当て方とずれないため)。
  function acceptedChange(patch, name) {
    if (!isPlainObject(patch)) return null;
    var collections = own(patch, 'collections') && isPlainObject(patch.collections) ? patch.collections : null;
    var change = collections && own(collections, name) ? collections[name] : null;
    if (!isPlainObject(change)) return null;
    var removed = new Set((Array.isArray(change.removes) ? change.removes : [])
      .filter(function (id) { return (typeof id === 'string' && !unsafeId(id)) || (typeof id === 'number' && isFinite(id)); })
      .map(String));
    // 鍵(idOf)→ 物。同じ鍵が2つあれば後の物が勝つ(id の無い upsert の物どうしも "undefined" で1つにまとまる。今までどおり)。
    // 使えない名前の id の物・危ない鍵を含む物は当てない。
    var upserts = new Map();
    (Array.isArray(change.upserts) ? change.upserts : []).forEach(function (item) {
      if (!isPlainObject(item) || unsafeId(item.id) || hasUnsafeKey(item)) return;
      upserts.set(idOf(item), item);
    });
    return { removed: removed, upserts: upserts };
  }
  function acceptedFields(patch) {
    var fields = isPlainObject(patch) && own(patch, 'fields') && isPlainObject(patch.fields) ? patch.fields : null;
    if (!fields) return [];
    return Object.keys(fields).filter(function (key) {
      if (COLLECTIONS.indexOf(key) >= 0 || key === 'viewState') return false;
      if (key in Object.prototype || UNSAFE_KEYS.indexOf(key) >= 0) return false;
      return !hasUnsafeKey(fields[key]);
    }).map(function (key) { return [key, fields[key]]; });
  }

  function applyPatch(plan, patch, options) {
    var clone = options && typeof options.clone === 'function' ? options.clone : null;
    var put = function (v) { return clone ? clone(v) : v; };
    COLLECTIONS.forEach(function (name) {
      if (!Array.isArray(plan[name])) plan[name] = [];
      var change = acceptedChange(patch, name);
      if (!change) return;
      var removed = change.removed, upserts = change.upserts;
      var next = plan[name]
        .filter(function (item) { return !removed.has(idOf(item)); })
        .map(function (item) { var key = upsertKey(item); return key !== null && upserts.has(key) ? put(upserts.get(key)) : item; });
      var present = new Set();
      next.forEach(function (item) { var key = upsertKey(item); if (key !== null) present.add(key); });
      upserts.forEach(function (item, key) { if (!present.has(key)) next.push(put(item)); });
      plan[name] = next;
    });
    acceptedFields(patch).forEach(function (kv) {
      var key = kv[0], value = kv[1];
      if (value === null && ABSENT_WHEN_NULL.indexOf(key) >= 0) delete plan[key];
      else plan[key] = put(value);
    });
    return plan;
  }

  // 差分を当てたとき、プランの JSON がどれだけ大きくなりうるかの上界(バイト)。プランを作らずに数える。
  //   countOf(name, key) … 当てる前のプランで、集まり name の upsertKey が key の物の数
  //   sizeOf(value)      … 値の JSON の大きさ(バイト)
  // upsert の物は、当たる物の数(無ければ足す1つ)だけ写る。1つ写るごとに、置き換える前より大きくなる量は
  // 物の大きさ + 区切りの1字を超えない。欄は1回置き換えるか足すだけ。消すことでは大きくならない。
  // 差分を何回当てても、ある鍵に当たる物の数は「当てる前の数」と1の大きいほうを超えない(upsert は無い鍵の物を
  // 1つ足すだけ)。なので、最初のプランの countOf で積んだ差分を順に数えた合計も、全部を当てたあとの上界になる。
  function patchGrowthBound(patch, countOf, sizeOf) {
    var total = 0;
    COLLECTIONS.forEach(function (name) {
      var change = acceptedChange(patch, name);
      if (!change) return;
      change.upserts.forEach(function (item, key) {
        total += Math.max(1, countOf(name, key) || 0) * (sizeOf(item) + 1);
      });
    });
    acceptedFields(patch).forEach(function (kv) { total += sizeOf(kv[0]) + sizeOf(kv[1]) + 2; });
    return total;
  }

  return {
    COLLECTIONS: COLLECTIONS, SHARED_FIELDS: SHARED_FIELDS, UNSAFE_KEYS: UNSAFE_KEYS,
    applyPatch: applyPatch, hasUnsafeKey: hasUnsafeKey, upsertKey: upsertKey, patchGrowthBound: patchGrowthBound,
  };
}));
