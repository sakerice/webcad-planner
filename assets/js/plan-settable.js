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
  //   editChoices: [[値, 説明], ...]（編集＝チャット・MCP の setProps だけで受ける選択肢。読み取りの説明 describe には
  //     出さず、applySettings も ctx.edit === true のときだけ受ける。読み取りの挙動を変えずに、編集でだけ戻す手段を足すため）
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
  // ── 色・仕上げの選択肢(設定パネルと AI の編集が、この一覧を共に使う。パネルはここを読んで選択欄を作る)──
  // サッシの色(窓の「サッシ色」の欄。値は保存される色。'' は標準のダークグレー)
  var SASH_COLORS = [
    { hex: '#9a9da1', label: 'シャイングレー' },
    { hex: '#22252a', label: 'ブラック' },
    { hex: '#f2f2f0', label: 'ホワイト' }
  ];
  // 扉の「パネル仕上げ」の欄(開き戸・折戸)。'' は標準
  var DOOR_FINISHES = [['', '標準'], ['bath-clear', '浴室・透明パネル']];
  var DOOR_FINISH_TYPES = ['door-swing', 'door-swing-s', 'door-fold', 'door-fold-w'];
  // カタログのモデルの部位に貼れる素材。**壁・床と同じ資産**(index.html の ASSET_TEX_MAP)から、
  // 家具に載せて意味のあるものだけを並べる。地面(砂利・芝)や屋根瓦は出さない(家具に貼る理由が無い)。
  var MODEL_FINISH_TEXTURES = [
    ['', '元の柄のまま'],
    ['wood_oak', 'オーク'],
    ['wood_floor', '木目（複合）'],
    ['wood_cedar', '杉板'],
    ['plaster', '塗り壁'],
    ['plaster_white', '塗り壁（白）'],
    ['tile_floor', 'タイル'],
    ['concrete', 'コンクリート'],
    ['galvalume_dark', 'ガルバ（黒）'],
    ['stone', '石']
  ];
  // 屋根の部品(スレート切妻・マンサードなど)の「屋根面」(部位 roof)は、屋根の設定欄と同じ屋根材から選ばせる。
  var MODEL_ROOF_FINISH_TEXTURES = [
    ['', '元の柄のまま'],
    ['roof_tile', '瓦'],
    ['roof_kawara_ibushi', '日本瓦（いぶし銀）'],
    ['roof_s_tile_terracotta', '洋瓦（S形・素焼き）'],
    ['roof_flat_tile_charcoal', '平板瓦（黒灰）'],
    ['roof_colonial_gray', '化粧スレート（コロニアル）'],
    ['roof_standing_seam_silver', 'ガルバ立平（銀）'],
    ['roof_copper_patina', '銅板一文字（緑青）'],
    ['roof_asphalt_shingle_brown', 'アスファルトシングル（茶）'],
    ['galvalume_dark', 'ガルバ（黒）'],
    ['mansion_slate_roof', 'スレート（洋館）'],
    ['kominka_kayabuki', '茅葺き（古民家）']
  ];
  // 部位の艶。値は保存される粗さ(数)の文字。'' は既定の仕上げ。布(fabric)と差し色(accent)の部位には艶の欄が無い。
  var FINISH_ROUGHNESS = [['', '既定の仕上げ'], ['0.85', 'マット'], ['0.48', 'サテン'], ['0.22', '艶あり']];
  var NO_ROUGHNESS_CHANNELS = ['fabric', 'accent'];
  function modelFinishTextureOptions(channel) { return channel === 'roof' ? MODEL_ROOF_FINISH_TEXTURES : MODEL_FINISH_TEXTURES; }
  function channelHasRoughness(channel) { return NO_ROUGHNESS_CHANNELS.indexOf(channel) < 0; }
  // 設定パネルの部位ごとの書き込み(app-state.js の updateSelectedModelFinish・updateSelectedModelTexture・
  // updateSelectedModelRoughness)と AI の編集が共に使う、次の値の作り方。今の表 current に部位 channel の値を足した写しを返す。
  // 色は書き足すだけ、素材と艶は '' で部位を外し、空になったら null(欄ごと既定)にする。
  function nextFinishColors(current, channel, value) {
    var colors = Object.assign({}, current || {}); colors[channel] = value;
    return colors;
  }
  function nextFinishTextures(current, channel, value) {
    var textures = Object.assign({}, current || {});
    if (value === '') delete textures[channel]; else textures[channel] = value;
    return Object.keys(textures).length ? textures : null;
  }
  function nextFinishRoughness(current, channel, value) {
    var settings = Object.assign({}, current || {});
    if (value === '') delete settings[channel]; else settings[channel] = Number(value);
    return Object.keys(settings).length ? settings : null;
  }
  // 画面の色の入力欄(input type=color)が書く形。大文字は小文字に直して受ける(入力欄は小文字で書くため)。
  var HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  var SETTINGS = {
    wall: [
      { key: 'wallHeight', ja: '壁の高さ（mm）。天井まで届かない壁だけ', num: [300, 6000], panel: 'wallHeight' },
      { key: 'thick', ja: '壁の厚さ（mm）。既定 120', num: [60, 400], panel: 'thick' },
    ],
    room: [
      { key: 'floorMaterial', ja: '床材。書かなければフローリング（標準）', choices: FLOOR_MATERIALS, panel: 'updateSelectedRoomFloorMaterial' },
      { key: 'ceilingHeight', ja: '天井高（mm）。CH=2400 のように書かれていれば', num: [1800, 6000], panel: 'updateSelectedFlatCeilingMm' },
      { key: 'void', ja: '吹抜け（上の階の床が無く、天井が上の階まで抜ける）', choices: [['yes', '吹抜け']], panel: 'updateSelectedCeilingType' },
      // 床の上下は設定パネルでは mm で入れるが、土間の深さは床の厚みで決まる（app-constants.js の
      // domaFloorRaiseMm）。mm で答えさせると階の床厚を知らない AI が数字を当てることになるので、
      // パネルのプリセット「玄関土間」と同じものを選ばせる。
      // normal は、土間にした部屋を AI で元に戻すための選択肢（パネルのプリセット「床の構造面 ±0mm」と同じ）。
      // 読み取りでは部屋は ±0 から作るので要らず、指示文に足すと読み取りの答えが変わりうるので、編集だけにする。
      { key: 'floorLevel', ja: '床の高さ', choices: [['doma', '土間（床を一段下げ、玄関ドアの外とほぼ同じ高さにする）']],
        editChoices: [['normal', '通常の高さ（土間をやめ、床を ±0 に戻す）']], panel: 'updateSelectedRoomFloor' },
      // ここから下の editOnly の項目は、編集(チャット・MCP の setProps)だけで受ける。色・仕上げは図面から読めないので、
      // 読み取りの説明(describe)には出さず、applySettings も ctx.edit === true のときだけ受ける(NOT_PASSED にも理由を残す)。
      { key: 'floorColor', ja: '床の色（床材・画像に重ねて掛ける。白で元の色のまま）', color: true, clearable: true, editOnly: true, panel: 'floorColor' },
      { key: 'ceilingColor', ja: '天井の色', color: true, clearable: true, editOnly: true, panel: 'ceilingColor' },
    ],
    opening: [
      { key: 'windowKind', ja: '窓の種類', choices: [['sliding', '引違い'], ['casement', 'すべり出し'], ['fix', 'FIX（はめ殺し）']], for: ['window'], panel: 'windowKind' },
      { key: 'windowSill', ja: '窓の下端の高さ（床から mm）', num: [0, 3000], for: ['window', 'window-door'], panel: 'windowSill' },
      { key: 'windowHeight', ja: '窓の高さ（mm）', num: [200, 3000], for: ['window', 'window-door'], panel: 'windowHeight' },
      { key: 'doorHeight', ja: '扉・開口の高さ（mm）', num: [300, 3200], for: OPENINGS.map(function (o) { return o.type; }).filter(function (t) { return t.indexOf('door-') === 0; }), panel: 'doorHeight' },
      { key: 'sashColor', ja: 'サッシの色', choices: [['', '標準（ダークグレー）']].concat(SASH_COLORS.map(function (c) { return [c.hex, c.label]; })),
        for: ['window', 'window-door'], editOnly: true, panel: 'sashColor' },
      { key: 'doorFinish', ja: '扉のパネルの仕上げ', choices: DOOR_FINISHES, for: DOOR_FINISH_TYPES, editOnly: true, panel: 'doorFinish' },
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
    // カタログの家具・設備(色を変えられる部位 finishChannels を持つモデル)。編集だけ。
    // 値は {部位: 値}。部位はモデルごとに違う(wood・metal・fabric など。applySettings の ctx.channels で受ける)。
    // 設定パネルと同じく、渡した部位だけを今の値に重ねる(ctx.current が今の物)。
    furniture: [
      { key: 'finishColors', ja: '部位ごとの色 {部位: "#rrggbb"}', channelMap: 'color', editOnly: true, panel: 'updateSelectedModelFinish' },
      { key: 'finishTextures', ja: '部位ごとの素材 {部位: 値}（屋根の部品の部位 roof は屋根材の一覧から）', channelMap: 'texture', editOnly: true, panel: 'updateSelectedModelTexture' },
      { key: 'finishRoughness', ja: '部位ごとの艶 {部位: 値}（布 fabric・差し色 accent の部位には無い）', channelMap: 'roughness', editOnly: true, panel: 'updateSelectedModelRoughness' },
    ],
  };

  // 部屋の種類ごとの「玄関なら土間・タイル」のような表は置かない。項目の意味と既定を正しく渡し、
  // どう設定するかは AI に判断させる（worker/plan-free.mjs の set の説明）。表を外しても3つの間取りで
  // 玄関の土間・タイル、浴室のタイルを AI が自分で設定した（2026-11-01）。土間が板張りのまま下がったのは、
  // 床材の既定を「部屋の名前から決まる」と事実と違う説明をしていたためだった。

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

  // 項目の選択肢。edit が真なら編集だけの選択肢（editChoices）も後ろに足す。
  function choicesFor(def, edit) {
    var base = (def && def.choices) || [];
    return edit && def.editChoices ? base.concat(def.editChoices) : base;
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
  // ctx.edit === true（チャット・MCP の setProps。plan-core/operations.js の resolveSet）のときだけ、編集の選択肢
  // （editChoices）も受ける。読み取り（plan-free-apply.js）は印を付けないので、今までどおり断る。
  // 部屋の天井（ceilingHeight / void）は、アプリの形 ceiling:{type, …} に直す。
  function applySettings(part, type, set, out, ctx) {
    var edit = !!(ctx && ctx.edit === true);
    var defs = settingsFor(part, type);
    parseSet(set).forEach(function (kv) {
      var def = null;
      for (var i = 0; i < defs.length; i++) if (defs[i].key === String(kv && kv.key)) def = defs[i];
      var shown = kv && kv.value !== null && typeof kv.value === 'object' ? JSON.stringify(kv.value) : String(kv && kv.value);
      // why・candidates は、断った理由と候補(編集の setProps が errors に書く。読み取りは見ない)。
      var reject = function (why, candidates) {
        if (ctx && ctx.rejected) ctx.rejected.push(String(kv && kv.key) + '=' + shown);
        if (ctx && why) { ctx.why = why; ctx.candidates = candidates; }
      };
      // 編集だけの項目は、読み取り(印 edit の無い呼び出し)では知らない項目と同じに断る。
      if (!def || (def.editOnly && !edit)) { reject(); return; }
      var value;
      if (def.channelMap) {
        value = channelMapValue(def, kv.value, ctx, reject);
        if (value === undefined) return;
      } else if (def.color) {
        // '' と null は「解除」(設定パネルの「床カラー解除」などと同じく null を書く)。
        if (def.clearable && (kv.value === '' || kv.value === null)) value = null;
        else if (typeof kv.value === 'string' && HEX_COLOR_RE.test(kv.value)) value = kv.value.toLowerCase();
        else { reject('"#rrggbb" の形の色で渡してください（解除は ""）'); return; }
      } else if (def.num) {
        var n = num(kv.value);
        if (n == null) { reject(); return; }
        value = Math.max(def.num[0], Math.min(def.num[1], Math.round(n)));
      } else if (def.text) {
        value = tidyText(kv.value, def.text);
        if (!value) { reject(); return; }
      } else {
        value = String(kv.value);
        if (!choicesFor(def, edit).some(function (c) { return c[0] === value; })) { reject(); return; }
      }
      if (part === 'room' && def.key === 'ceilingHeight') { if (!out.ceiling) out.ceiling = { type: 'flat', heightMm: value }; return; }
      if (part === 'room' && def.key === 'void') { out.ceiling = { type: 'void', toFloor: ((ctx && ctx.floor) || 1) + 1 }; return; }
      out[def.key] = value;
    });
    return out;
  }

  // 部位ごとの値 {部位: 値} を確かめて、今の物(ctx.current)の値に重ねた次の値を返す。だめなら reject して undefined。
  // ctx.channels はそのモデルの部位の名前の並び(画面は getItemFinishModel(type).finishChannels、Worker は表の fc)。
  function channelMapValue(def, raw, ctx, reject) {
    var channels = (ctx && ctx.channels) || [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { reject('{部位: 値} の形で渡してください', channels); return undefined; }
    var keys = Object.keys(raw);
    if (!keys.length) { reject('部位を1つ以上渡してください', channels); return undefined; }
    var current = ctx && ctx.current ? ctx.current[def.key] : null;
    for (var i = 0; i < keys.length; i++) {
      var ch = keys[i], v = raw[ch];
      var ok = channels.indexOf(ch) >= 0 && (def.channelMap !== 'roughness' || channelHasRoughness(ch));
      if (!ok) {
        var usable = def.channelMap === 'roughness' ? channels.filter(channelHasRoughness) : channels;
        reject('部位「' + ch + '」はこの物には' + (def.channelMap === 'roughness' && channels.indexOf(ch) >= 0 ? '艶の設定がありません' : 'ありません'), usable);
        return undefined;
      }
      if (def.channelMap === 'color') {
        if (typeof v !== 'string' || !HEX_COLOR_RE.test(v)) { reject('部位「' + ch + '」の色は "#rrggbb" の形で渡してください'); return undefined; }
        current = nextFinishColors(current, ch, v.toLowerCase());
      } else {
        var list = def.channelMap === 'texture' ? modelFinishTextureOptions(ch) : FINISH_ROUGHNESS;
        var s = v === null ? '' : String(v);
        if (typeof v === 'number' && def.channelMap === 'roughness') s = String(v);
        if (!list.some(function (c) { return c[0] === s; })) { reject('部位「' + ch + '」の値「' + s + '」は使えません', list.map(function (c) { return c[0]; })); return undefined; }
        current = def.channelMap === 'texture' ? nextFinishTextures(current, ch, s) : nextFinishRoughness(current, ch, s);
      }
    }
    return current;
  }

  function exteriorByKind(kind) {
    var all = EXTERIOR.concat(SITE);
    for (var i = 0; i < all.length; i++) if (all[i].kind === kind) return all[i];
    return null;
  }

  // AI への説明（worker/plan-free.mjs の freeSpec が使う。読み取り用なので、編集だけの選択肢 editChoices と
  // 編集だけの項目 editOnly は出さない）。
  function describe(part, label) {
    var rows = [];
    (SETTINGS[part] || []).forEach(function (s) {
      if (s.editOnly) return;
      var range = s.num ? s.num[0] + '〜' + s.num[1] : s.text ? '文字' : s.choices.map(function (c) { return c[0] + '=' + c[1]; }).join(' / ');
      rows.push('      ' + s.key + '（' + s.ja + '）: ' + range + (s.for ? '　対象: ' + s.for.join(', ') : ''));
    });
    var out = rows.length ? ['    ' + label + ' の set に書ける項目:'].concat(rows) : [];
    return out;
  }

  // 名前などの文字を書き込むときの掃除。見えない文字(書式文字 \p{Cf}・片割れのサロゲート)を落とし、制御文字と
  // 行の区切りを空白にして、空白をまとめる(assets/js/plan-core/operations.js の tidyName と同じ決まり)。
  // max があれば文字(コードポイント)単位で max 字に切る(読み取りの答えは失敗にできないので切る。… は付けない)。
  var INVISIBLE_RE = new RegExp('[\\p{Cf}\\p{Cs}]', 'gu');
  var CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
  // 絵文字のつなぎ(ZWJ、U+200D)は、絵文字と絵文字の間にあるときだけ残す(plan-summary.js の stripInvisible と同じ)。
  var ZWJ = String.fromCharCode(0x200d);
  var ZWJ_PREV_RE = new RegExp('\\p{Extended_Pictographic}[\\u{1F3FB}-\\u{1F3FF}\\uFE0F]*$', 'u');
  var ZWJ_NEXT_RE = new RegExp('^\\p{Extended_Pictographic}', 'u');
  function dropInvisible(ch, at, all) {
    if (ch === ZWJ && ZWJ_PREV_RE.test(all.slice(Math.max(0, at - 8), at)) && ZWJ_NEXT_RE.test(all.slice(at + 1, at + 3))) return ch;
    return '';
  }
  function tidyText(s, max) {
    var t = String(s === undefined || s === null ? '' : s).replace(INVISIBLE_RE, dropInvisible).replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
    if (max >= 0 && t.length > max) {
      var chars = Array.from(t);
      if (chars.length > max) t = chars.slice(0, max).join('').trim();
    }
    return t;
  }

  return {
    tidyText: tidyText,
    OPENINGS: OPENINGS, SWING_TYPES: SWING_TYPES, EXTERIOR: EXTERIOR, SITE: SITE, SETTINGS: SETTINGS,
    FLOOR_MATERIALS: FLOOR_MATERIALS, SITE_SURFACES: SITE_SURFACES,
    SASH_COLORS: SASH_COLORS, DOOR_FINISHES: DOOR_FINISHES, DOOR_FINISH_TYPES: DOOR_FINISH_TYPES,
    MODEL_FINISH_TEXTURES: MODEL_FINISH_TEXTURES, MODEL_ROOF_FINISH_TEXTURES: MODEL_ROOF_FINISH_TEXTURES,
    FINISH_ROUGHNESS: FINISH_ROUGHNESS, modelFinishTextureOptions: modelFinishTextureOptions, channelHasRoughness: channelHasRoughness,
    nextFinishColors: nextFinishColors, nextFinishTextures: nextFinishTextures, nextFinishRoughness: nextFinishRoughness,
    NOT_PASSED: NOT_PASSED, TYPES_NOT_PLACED: TYPES_NOT_PLACED,
    settingsFor: settingsFor, choicesFor: choicesFor, applySettings: applySettings, parseSet: parseSet, exteriorByKind: exteriorByKind, describe: describe,
  };
}));
