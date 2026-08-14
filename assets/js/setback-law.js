// 斜線制限（建築基準法 第56条）の数値を、ここ1か所だけに置く。
// 1.25 / 1.5 / 5000 / 10000 をコードのあちこちに散らさないこと。
//
//   道路斜線 …… 法56条1項1号 + 別表第三
//     高さの限度 = 前面道路の「反対側の境界線」からの水平距離 × 勾配
//     勾配は住居系の用途地域で 1.25、それ以外の用途地域で 1.5。
//
//   北側斜線 …… 法56条1項3号
//     高さの限度 = 基準高さ + 真北方向の隣地境界線からの水平距離 × 1.25
//     基準高さは 第一種・第二種低層住居専用地域 = 5m、
//                第一種・第二種中高層住居専用地域 = 10m。
//     この4つ以外の用途地域に北側斜線は存在しない。
//     「有るのに効かない設定」を出さないため、northBaseMm が null の用途地域では
//     UI 側に北側斜線のスイッチそのものを出さない。
//
// ここでは「緩和」（セットバックによる道路斜線の緩和、天空率、高低差の緩和など）は
// 一切扱わない。素の条文どおりの平面だけを返す。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SetbackLaw = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var ROAD_SLOPE_RESIDENTIAL = 1.25;   // 住居系
  var ROAD_SLOPE_OTHER = 1.5;          // 住居系以外
  var NORTH_SLOPE = 1.25;              // 北側斜線の勾配は用途地域によらず 1.25
  var NORTH_BASE_LOW_MM = 5000;        // 低層住居専用地域
  var NORTH_BASE_MID_MM = 10000;       // 中高層住居専用地域

  var ZONES = [
    { id: 'low1', label: '第一種低層住居専用地域', roadSlope: ROAD_SLOPE_RESIDENTIAL, northBaseMm: NORTH_BASE_LOW_MM },
    { id: 'low2', label: '第二種低層住居専用地域', roadSlope: ROAD_SLOPE_RESIDENTIAL, northBaseMm: NORTH_BASE_LOW_MM },
    { id: 'mid1', label: '第一種中高層住居専用地域', roadSlope: ROAD_SLOPE_RESIDENTIAL, northBaseMm: NORTH_BASE_MID_MM },
    { id: 'mid2', label: '第二種中高層住居専用地域', roadSlope: ROAD_SLOPE_RESIDENTIAL, northBaseMm: NORTH_BASE_MID_MM },
    { id: 'res-other', label: 'その他（住居系）', roadSlope: ROAD_SLOPE_RESIDENTIAL, northBaseMm: null },
    { id: 'non-res', label: 'その他（非住居系）', roadSlope: ROAD_SLOPE_OTHER, northBaseMm: null }
  ];

  function zone(id) {
    for (var i = 0; i < ZONES.length; i++) if (ZONES[i].id === id) return ZONES[i];
    return null;
  }
  function zoneIds() {
    return ZONES.map(function (z) { return z.id; });
  }
  function zoneLabel(id) {
    var z = zone(id);
    return z ? z.label : '';
  }
  // 北側斜線が「存在する」用途地域か。存在しないなら設定を出さない。
  function hasNorthLimit(id) {
    var z = zone(id);
    return !!(z && z.northBaseMm !== null);
  }
  function roadSlope(id) {
    var z = zone(id);
    return z ? z.roadSlope : null;
  }
  function northBaseMm(id) {
    var z = zone(id);
    return (z && z.northBaseMm !== null) ? z.northBaseMm : null;
  }
  function finiteNum(v) {
    return (typeof v === 'number' && isFinite(v));
  }
  // 道路の反対側の境界線から水平距離 distanceMm のところでの高さの限度(mm)。
  // 用途地域が未設定・不正なら null（= 面を出さない）。
  function roadLimitHeightMm(id, distanceMm) {
    var s = roadSlope(id);
    if (s === null || !finiteNum(distanceMm)) return null;
    return s * distanceMm;
  }
  // 真北方向の隣地境界線から水平距離 distanceMm のところでの高さの限度(mm)。
  // 北側斜線の無い用途地域では null。
  function northLimitHeightMm(id, distanceMm) {
    var b = northBaseMm(id);
    if (b === null || !finiteNum(distanceMm)) return null;
    return b + NORTH_SLOPE * distanceMm;
  }

  return {
    ZONES: ZONES,
    ROAD_SLOPE_RESIDENTIAL: ROAD_SLOPE_RESIDENTIAL,
    ROAD_SLOPE_OTHER: ROAD_SLOPE_OTHER,
    NORTH_SLOPE: NORTH_SLOPE,
    NORTH_BASE_LOW_MM: NORTH_BASE_LOW_MM,
    NORTH_BASE_MID_MM: NORTH_BASE_MID_MM,
    zone: zone,
    zoneIds: zoneIds,
    zoneLabel: zoneLabel,
    hasNorthLimit: hasNorthLimit,
    roadSlope: roadSlope,
    northBaseMm: northBaseMm,
    roadLimitHeightMm: roadLimitHeightMm,
    northLimitHeightMm: northLimitHeightMm
  };
}));
