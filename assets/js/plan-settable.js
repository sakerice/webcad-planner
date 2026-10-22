// 間取りの読み取りで、AI が house-planner に設定できる項目の表。ここが唯一の出どころ。
//
// なぜ在るのか
// ------------
// 読み取りは「アプリで何が設定できるかを正確に渡し、作り方は任せる」方針で作っている
// （worker/plan-free.mjs）。ところが渡す項目を指示文と取り込み処理にそれぞれ手で書いていたため、
// 設定パネルで変えられる項目（天井高・吹抜け・床材・窓の種類など）の多くが渡っておらず、
// 車・駐車場・庭木などの外構は置く手段が無く、フェンスは答えても黙って捨てられていた
// （2026-10-20 利用者の指摘）。
//
// この表から次の3つを作る:
//   AI への説明   worker/plan-free.mjs の freeSpec()
//   答えの適用    assets/js/plan-free-apply.js（値の範囲・選択肢の確認もここ）
//   検査         tools/tests/plan-settable.test.cjs
//
// 保守の決まり
// ------------
// 設定パネル（assets/js/app-state.js の updateProps ほか）に項目を足すと、検査が
// 「AI に渡すか（SETTINGS）、渡さないか（NOT_PASSED と理由）」を決めるまで落ちる。
// 選択肢・範囲・既定寸法はアプリ側の定義と突き合わせるので、アプリ側を変えれば検査が知らせる。
// 黙って渡し損ねる・黙って捨てる、を作りの上で起こさないための表である。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanSettable = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 窓・扉 ─────────────────────────────────────────────────────────
  // type はアプリの組み込みの種類。d は既定の奥行き（app-constants.js の ISIZES と同じ。検査で突き合わせる）。
  // 開き戸の d は扉の幅と同じになるので持たない（取り込みで幅を使う）。
  var OPENINGS = [
    { type: 'window', ja: '窓', what: '腰窓。床まで届かない窓', d: 150 },
    { type: 'window-door', ja: '掃き出し窓', what: '床まで届く大きな窓。ベランダや庭へ出られる', d: 180 },
    { type: 'door-front', ja: '玄関ドア', what: '玄関の扉', d: 200 },
    { type: 'door-swing', ja: '開き戸', what: '丁番で開く扉。図では1/4円の弧で描かれる', d: null },
    { type: 'door-swing-s', ja: '開き戸（小）', what: 'トイレ・収納などの幅の狭い開き戸', d: null },
    { type: 'door-slide', ja: '引違い戸', what: '2枚の戸を左右に引き違える', d: 150 },
    { type: 'door-slide-s', ja: '片引き戸', what: '1枚の戸を壁に沿って横に滑らせる', d: 150 },
    { type: 'door-pocket', ja: '引込み戸', what: '壁の中へ引き込む戸', d: 150 },
    { type: 'door-fold', ja: '折戸', what: '折りたたんで開く扉。収納の前によくある', d: 420 },
    { type: 'door-fold-w', ja: '折戸（両開き）', what: '左右に折りたたむ幅の広い折戸', d: 420 },
    { type: 'door-opening', ja: '開口', what: '建具の無い壁の抜け', d: 160 },
    { type: 'door-opening-arch', ja: 'アーチ開口', what: '上が円弧の、建具の無い抜け', d: 160 },
  ];
  // 吊り元（hinge）と開く側（opens）を答える種類。
  var SWING_TYPES = ['door-swing', 'door-swing-s', 'door-front', 'door-fold', 'door-fold-w'];

  // ── 家具・設備の外にある、組み込みの種類で置く外構 ─────────────────────
  // kind は答えの種類、type はアプリの種類。カタログの外構（門柱・デッキ・庭木など）は
  // object-knowledge.js の KNOWLEDGE から来るので、ここには組み込みの種類だけを書く。
  // face の意味は種類ごとに違うので、ここで説明する。
  var EXTERIOR = [
    // 車は rot=0 で前が南（rot+180 の側が前。カタログの家具と同じ。2026-10-20 に2Dと3Dで確かめた）。
    // 自転車は rot=0 で前が北。front180 はその違いを取り込みに伝える。
    { kind: 'car', type: 'car', front180: true, ja: '車', what: '駐車スペースに描かれた車。w は車幅、d は全長、face は車の前が向く方角' },
    { kind: 'bicycle', type: 'bicycle', ja: '自転車', what: 'w は幅、d は全長、face は前が向く方角' },
    { kind: 'fence', type: 'wood-fence', ja: 'フェンス', what: '敷地の境のフェンス。w は長さ、d は厚さ（100前後）、face は外（道路や隣地）側の方角' },
    { kind: 'block-wall', type: 'fence', ja: '塀', what: 'ブロック塀など。w は長さ、d は厚さ、face は外側の方角' },
    { kind: 'lattice-screen', type: 'lattice-screen', ja: '格子柵', what: '目隠しの縦格子。w は長さ、face は外側の方角' },
    { kind: 'ramp', type: 'ramp', ja: 'スロープ', what: 'face は上っていく方角' },
    { kind: 'exterior-stair', type: 'exterior-stair', ja: '外の段', what: 'ポーチの段・ステップ。face は上っていく方角' },
    { kind: 'balcony', type: 'balcony', ja: 'バルコニーの床', what: '上の階で外へ張り出した床' },
  ];
  // 敷地と、その中の区画（駐車スペース・アプローチ・庭）。アプリでは敷地（site-rect）1つと、
  // その siteZones になる。答えの形を大きくしないよう、物（objects）の種類として受ける
  // （欄を足すと、Claude に「答えの形が大きすぎる」と断られる。2026-10-20 実測）。
  var SITE = [
    { kind: 'site', type: 'site-rect', ja: '敷地', what: '敷地境界の長方形。1階に1つだけ。w は東西、d は南北の長さ。face は道路側の方角' },
    { kind: 'site-zone', type: 'site-rect', ja: '外構の区画', what: '駐車スペース・アプローチ・庭など、地面の仕上げが違う範囲。1階に置く。w は東西、d は南北の長さ' },
  ];

  // ── 設定できる項目 ───────────────────────────────────────────────────
  // 部位ごと。key は答えの set に書く名前（アプリの項目名と同じにしてある）。
  //   num: [最小, 最大]（mm など。範囲外は端に寄せる）
  //   choices: [[値, 説明], ...]（それ以外の値は捨てる）
  //   panel: 設定パネルでこの項目を変える入口（検査がパネルの中に在ることを確かめる）
  //   for: 対象の種類（無ければその部位すべて）
  var FLOOR_MATERIALS = [
    ['wood_floor', 'フローリング（標準）'], ['wood_oak', 'フローリング（オーク）'], ['tile_floor', 'タイル'],
    ['mansion_herringbone_oak', 'ヘリンボーン（洋館）'], ['mansion_marble_checker', '白黒の大理石（洋館）'],
    ['kominka_tatami', '畳（古民家）'], ['kominka_old_pine_floor', '古い松の板の間（古民家）'], ['kominka_doma', '三和土（古民家）'],
  ];
  var SITE_SURFACES = [
    ['sand', '砂地'], ['grass', '芝生（自然草地）'], ['gravel', '砂利'], ['concrete', 'コンクリート（経年）'],
    ['concrete_new', 'コンクリート（金ゴテ）'], ['concrete_brush', 'コンクリート（刷毛引き）'], ['lawn', '芝生（手入れされた）'],
    ['interlocking', 'インターロッキング'], ['tile_gray', 'タイル（グレー）'], ['gravel_white', '化粧砂利（白）'],
  ];
  var SETTINGS = {
    wall: [
      { key: 'wallHeight', ja: '壁の高さ（mm）。天井まで届かない壁だけ', num: [300, 6000], panel: 'wallHeight' },
      { key: 'thick', ja: '壁の厚さ（mm）。既定 120', num: [60, 400], panel: 'thick' },
    ],
    room: [
      { key: 'floorMaterial', ja: '床材。書かなければ部屋の名前から決まる', choices: FLOOR_MATERIALS, panel: 'updateSelectedRoomFloorMaterial' },
      { key: 'ceilingHeight', ja: '天井高（mm）。CH=2400 のように書かれていれば', num: [1800, 6000], panel: 'updateSelectedFlatCeilingMm' },
      { key: 'void', ja: '吹抜け（上の階の床が無く、天井が上の階まで抜ける）', choices: [['yes', '吹抜け']], panel: 'updateSelectedCeilingType' },
      // 床の上下は設定パネルでは mm で入れるが、土間の深さは床の厚みで決まる（app-constants.js の
      // domaFloorRaiseMm）。mm で答えさせると階の床厚を知らない AI が数字を当てることになるので、
      // パネルのプリセット「玄関土間」と同じものを選ばせる。
      { key: 'floorLevel', ja: '床の高さ', choices: [['doma', '土間（床を一段下げ、玄関ドアの外とほぼ同じ高さにする）']], panel: 'updateSelectedRoomFloor' },
    ],
    opening: [
      { key: 'windowKind', ja: '窓の種類', choices: [['sliding', '引違い'], ['casement', 'すべり出し'], ['fix', 'FIX（はめ殺し）']], for: ['window'], panel: 'windowKind' },
      { key: 'windowSill', ja: '窓の下端の高さ（床から mm）', num: [0, 3000], for: ['window', 'window-door'], panel: 'windowSill' },
      { key: 'windowHeight', ja: '窓の高さ（mm）', num: [200, 3000], for: ['window', 'window-door'], panel: 'windowHeight' },
      { key: 'doorHeight', ja: '扉・開口の高さ（mm）', num: [300, 3200], for: OPENINGS.map(function (o) { return o.type; }).filter(function (t) { return t.indexOf('door-') === 0; }), panel: 'doorHeight' },
    ],
    stair: [
      { key: 'stairRail', ja: '手すり', choices: [['none', 'なし'], ['left', '左'], ['right', '右'], ['both', '両側']], panel: 'stairRail' },
      { key: 'stairStyle', ja: '階段の形', choices: [['open', 'ひな壇'], ['box', '箱型'], ['skeleton', 'スケルトン（蹴込み板なし）']], panel: 'stairStyle' },
    ],
    object: [
      { key: 'fenceHeight', ja: 'フェンスの高さ（mm）', num: [300, 3000], for: ['fence'], panel: 'fenceHeight' },
      { key: 'fencePattern', ja: '板の向き', choices: [['vertical', '縦張り'], ['horizontal', '横張り']], for: ['fence'], panel: 'fencePattern' },
      { key: 'latticeHeight', ja: '格子柵の高さ（mm）', num: [300, 3000], for: ['lattice-screen'], panel: 'latticeHeight' },
      { key: 'targetHeight', ja: '上りきった高さ（mm）', num: [0, 2000], for: ['ramp', 'exterior-stair'], panel: 'targetHeight' },
      { key: 'accessSteps', ja: '段数', num: [1, 12], for: ['exterior-stair'], panel: 'accessSteps' },
      { key: 'surface', ja: '地面の仕上げ', choices: SITE_SURFACES, for: ['site', 'site-zone'], panel: 'siteSurface' },
      { key: 'name', ja: '区画の名前（駐車スペース・玄関アプローチなど）', text: 40, for: ['site-zone'], panel: 'updateSiteZone' },
    ],
  };

  // 部屋の種類ごとに、日本の住宅で一般にどう設定するか（AI への知識。決まりではない）。
  // 項目を渡しただけでは、玄関の土間に床材も床の高さも設定されなかった（2026-10-23 利用者の指摘）。
  // 図面にそう描かれていないとき（玄関の床が板張りの図など）は図面に従わせる。
  // [部屋, 一般的な設定]。値は SETTINGS の項目と選択肢で書く（検査が突き合わせる）。
  var ROOM_COMMON = [
    ['玄関', '靴を脱ぐ土間と、上がり框から先の床（玄関ホール）は別の部屋に分ける。土間は floorLevel=doma; floorMaterial=tile_floor（古民家の三和土なら kominka_doma）', { floorLevel: 'doma', floorMaterial: 'tile_floor' }],
    ['土間収納・シューズクローク', '玄関の土間から靴のまま入る収納なら、土間と同じ floorLevel=doma; floorMaterial=tile_floor', { floorLevel: 'doma', floorMaterial: 'tile_floor' }],
    ['浴室', 'floorMaterial=tile_floor', { floorMaterial: 'tile_floor' }],
    ['和室', 'floorMaterial=kominka_tatami（畳）', { floorMaterial: 'kominka_tatami' }],
  ];

  // 設定パネルの項目のうち、AI に渡さないものと理由。パネルに項目を足したら、SETTINGS か
  // ここのどちらかに入れる（検査が求める）。理由は「図面から読めない」「位置・形として別に渡している」など。
  var NOT_PASSED = {
    // 位置・形・向きとして別の欄で渡している
    x: '位置として渡している', y: '位置として渡している', w: '大きさとして渡している', d: '大きさとして渡している',
    rot: '向き（face など）から決める', x1: '壁の線分として渡している', y1: '壁の線分として渡している',
    x2: '壁の線分として渡している', y2: '壁の線分として渡している', flipX: '吊り元・抜ける向きから決める',
    flipY: '開く側から決める', n: '部屋の名前として渡している', wallStyle: '壁の style として渡している',
    roofType: '屋根の shape として渡している', pitch: '屋根の pitch として渡している',
    // 図面から読めない見た目・仕上げ（読み取りでは既定のまま。利用者が選ぶ）
    color: '色は図面から読めない', texture: '仕上げの画像は図面から読めない', textureFlipX: '仕上げの画像', textureFlipY: '仕上げの画像',
    floorColor: '色は図面から読めない', ceilingColor: '色は図面から読めない', ceilingTexture: '仕上げの画像',
    ceilingTextureFlipX: '仕上げの画像', ceilingTextureFlipY: '仕上げの画像', sashColor: '色は図面から読めない',
    roofEdgeColor: '色は図面から読めない', gapInfillColor: '色は図面から読めない', gapInfillTexture: '仕上げの画像',
    updateRoofGapInfillMode: '屋根の段差の塞ぎ方は見た目の調整', updateSelectedModelFinish: '家具の素材は図面から読めない',
    updateSelectedModelTexture: '家具の素材は図面から読めない', updateSelectedModelRoughness: '家具の艶は図面から読めない',
    updateSelectedTextureCrop: '仕上げの画像の切り抜き', doorFinish: '扉の仕上げは図面から読めない',
    showDoorHandle: '3Dの見せ方', showDoorSlit: '3Dの見せ方', showMirror: '3Dの見せ方', fenceTopStyle: '見た目の調整',
    latticePitch: '格子の細部は図面から読めない', latticeSlat: '格子の細部は図面から読めない',
    roofThickness: '屋根の厚みは図面から読めない', roofSkirt: '見た目の調整', gutterMode: '雨樋は自動',
    foundationHeight: '基礎は壁から自動で作る', foundationFlashing: '基礎は壁から自動で作る',
    stairFloorMaterial: '踏板の仕上げは図面から読めない', stairRailMount: '手すりの付け方は自動', stairOrder: '段の高さの順は自動',
    applyWindowStdPreset: '規格名ではなく幅・高さで渡している', applyDoorWidthPreset: '規格名ではなく幅で渡している',
    // 画面の操作のためのもの
    locked: '編集のロック', hidden3D: '3Dでの一時的な非表示', vis3D: '3Dでの表示の切り替え', elev: '高さの微調整',
    doorOpenState: '取り込みでは閉じた状態に決めている', updateSelectedBaseFloor: '床の段差は自動で載る',
    // 図面にふつう描かれない・別の仕組みで決まる
    wallBand: '壁の設置高さの調整', wallTopShape: '壁の上部の形の調整', wallTopSide: '壁の上部の形の調整',
    footOffsetMm: '壁の足元の調整',
    updateSelectedRoomSkipLevel: 'スキップフロアの段差は図面から読み取りにくい',
    updateSelectedSlopedCeiling: '勾配天井は屋根が載れば屋根から決まる', updateSelectedVoidToFloor: '吹抜けは一つ上の階まで',
    updateSelectedRoofHeight: '屋根の高さは勾配から決まる', setSelectedStairTarget: '階段の行き先は上の階',
    setSelectedLandingMode: '踊り場の使い方は自動', landingLevelMm: '踊り場の高さは自動',
    setDefaultWallHeight: '階の高さは図面から読み取りにくい', setDefaultFloorThickness: '床厚は図面から読み取りにくい',
    updateSelectedSetback: '斜線制限は法規の設定', updateSelectedContextFloors: '周辺の建物は図面の外', contextGhost: '周辺の建物は図面の外',
    contextHeight: '道路・電柱は図面の外', downspoutTop: '雨樋は自動', gasHeaterMount: '設備の取付高さは既定',
    // 照明・注記・道具
    updateSelectedLightKind: '照明は図面に描かれない', lightShape: '照明', lightAim: '照明', lightColor: '照明', lightIntensity: '照明',
    lightRange: '照明', lightAngle: '照明', lightCastShadow: '照明', cove: '間接照明', coveColor: '間接照明', coveGap: '間接照明',
    coveIntensity: '間接照明', updateSelectedNoteText: 'メモ', updateSelectedRulerLength: '定規', extLen: '定規',
    updateWalkRouteSpeed: '歩く道筋', name: '任意ブロックの名前（区画の名前は SETTINGS.object の name で渡している）', customHeight: '任意ブロック', columnHeight: '柱は図面から読み取りにくい',
    shelfHeight: '造作棚の細部', shelfCount: '造作棚の細部', shelfSides: '造作棚の細部',
    updateSelectedKitchenVariant: 'キッチンの構成はモデル選び', updateSelectedKitchenDishwasher: 'キッチンの構成はモデル選び',
  };

  // アプリの組み込みの種類のうち、読み取りで置かないものと理由（置くものは OPENINGS・EXTERIOR・
  // 階段・屋根・水まわりとカタログ）。アプリに種類を足すと、検査がここか置く側への追加を求める。
  var TYPES_NOT_PLACED = {
    bath: 'カタログの浴槽で置く', toilet: 'カタログの便器で置く', sink: 'カタログの洗面台で置く', kitchen: 'カタログのキッチンで置く',
    fridge: 'カタログで置く', washer: 'カタログで置く', sofa: 'カタログで置く', loveseat_2p: 'カタログで置く', low_table: 'カタログで置く',
    'dining-table': 'カタログで置く', dining_6: 'カタログで置く', round_table_4: 'カタログで置く', 'bed-d': 'カタログで置く',
    'bed-s': 'カタログで置く', semi_double_bed: 'カタログで置く', futon_set: 'カタログで置く', desk: 'カタログで置く', tv: 'カタログで置く',
    closet: 'カタログで置く', shoe_cabinet: 'カタログで置く', tree: 'カタログの庭木（garden-plant）で置く',
    'custom-block': '利用者が作る任意の箱', column: '柱は図面から読み取りにくい', 'column-round': '柱は図面から読み取りにくい',
    'light-ceiling': '照明は図面に描かれない', 'light-down': '照明は図面に描かれない', 'light-spot': '照明は図面に描かれない',
    memo: 'メモ', 'walk-route': '歩く道筋', 'shelf-built-in': '造作棚の細部', 'stair-landing': '踊り場は直進部と廻り部で表す',
    'bicycle-fold': '自転車（bicycle）で置く', 'neighbor-building': '周辺の建物は図面の外', 'neighbor-house': '周辺の建物は図面の外',
    road: '道路は図面の外', 'utility-pole': '電柱は図面の外', 'ac-outdoor': '室外機は図面に描かれないことが多い',
    'water-heater': '給湯器は図面に描かれないことが多い', 'gas-heater': '給湯器は図面に描かれないことが多い',
    'meter-box': 'メーターは図面に描かれない', 'sewer-pit': '桝は図面に描かれない', downspout: '雨樋は自動',
    foundation: '基礎は壁から自動で作る', roof: '屋根は roofs として渡している',
    stair: '階段は stairs として渡している', 'stair-corner': '階段は stairs として渡している',
  };

  // 「2400mm」のように単位が付いていても先頭の数を読む。
  function num(v) { var n = parseFloat(String(v).replace(/[，,]/g, '')); return isFinite(n) ? n : null; }

  function settingsFor(part, type) {
    return (SETTINGS[part] || []).filter(function (s) { return !s.for || s.for.indexOf(type) >= 0; });
  }

  // 答えの set は「key=value; key=value」の文字列（答えの形を小さく保つため。配列でも受ける）。
  function parseSet(set) {
    if (Array.isArray(set)) return set;
    return String(set || '').split(/[;；\n]/).map(function (part) {
      var i = part.search(/[=＝]/);
      return i < 0 ? null : { key: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
    }).filter(function (kv) { return kv && kv.key; });
  }

  // 答えの set を、範囲・選択肢を確かめてから out に書く。知らない項目と
  // 範囲外の選択肢は入れない（変な値を入れない）。数は範囲の端に寄せる。
  // 入れなかった項目は ctx.rejected に「項目=値」で残す（黙って捨てない。見直しで AI に伝える）。
  // 部屋の天井（ceilingHeight / void）は、アプリの形 ceiling:{type, …} に直す。
  function applySettings(part, type, set, out, ctx) {
    var defs = settingsFor(part, type);
    parseSet(set).forEach(function (kv) {
      var def = null;
      for (var i = 0; i < defs.length; i++) if (defs[i].key === String(kv && kv.key)) def = defs[i];
      var reject = function () { if (ctx && ctx.rejected) ctx.rejected.push(String(kv && kv.key) + '=' + String(kv && kv.value)); };
      if (!def) { reject(); return; }
      var value;
      if (def.num) {
        var n = num(kv.value);
        if (n == null) { reject(); return; }
        value = Math.max(def.num[0], Math.min(def.num[1], Math.round(n)));
      } else if (def.text) {
        value = String(kv.value).slice(0, def.text);
        if (!value) { reject(); return; }
      } else {
        value = String(kv.value);
        if (!def.choices.some(function (c) { return c[0] === value; })) { reject(); return; }
      }
      if (part === 'room' && def.key === 'ceilingHeight') { if (!out.ceiling) out.ceiling = { type: 'flat', heightMm: value }; return; }
      if (part === 'room' && def.key === 'void') { out.ceiling = { type: 'void', toFloor: ((ctx && ctx.floor) || 1) + 1 }; return; }
      out[def.key] = value;
    });
    return out;
  }

  function exteriorByKind(kind) {
    var all = EXTERIOR.concat(SITE);
    for (var i = 0; i < all.length; i++) if (all[i].kind === kind) return all[i];
    return null;
  }

  // AI への説明（worker/plan-free.mjs の freeSpec が使う）。
  function describe(part, label) {
    var rows = [];
    (SETTINGS[part] || []).forEach(function (s) {
      var range = s.num ? s.num[0] + '〜' + s.num[1] : s.text ? '文字' : s.choices.map(function (c) { return c[0] + '=' + c[1]; }).join(' / ');
      rows.push('      ' + s.key + '（' + s.ja + '）: ' + range + (s.for ? '　対象: ' + s.for.join(', ') : ''));
    });
    var out = rows.length ? ['    ' + label + ' の set に書ける項目:'].concat(rows) : [];
    if (part === 'room') {
      out.push('    日本の住宅で一般的な部屋の設定（図面が違えば図面に従う）:');
      ROOM_COMMON.forEach(function (c) { out.push('      ' + c[0] + ': ' + c[1]); });
    }
    return out;
  }

  return {
    OPENINGS: OPENINGS, SWING_TYPES: SWING_TYPES, EXTERIOR: EXTERIOR, SITE: SITE, SETTINGS: SETTINGS,
    FLOOR_MATERIALS: FLOOR_MATERIALS, SITE_SURFACES: SITE_SURFACES, ROOM_COMMON: ROOM_COMMON,
    NOT_PASSED: NOT_PASSED, TYPES_NOT_PLACED: TYPES_NOT_PLACED,
    settingsFor: settingsFor, applySettings: applySettings, parseSet: parseSet, exteriorByKind: exteriorByKind, describe: describe,
  };
}));
