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
    slopedHighMm: 3600
  };

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

  function storyHeightMm(plan, floor) {
    var floors = plan && plan.floors;
    var entry = floors ? floors[floor] : undefined;
    var raw = entry ? entry.storyHeight : undefined;
    return num(raw, DEFAULTS.storyHeightMm);
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

  return {
    DEFAULTS: DEFAULTS,
    storyHeightMm: storyHeightMm,
    ceilingHeightMm: ceilingHeightMm,
    ceilingShape: ceilingShape,
    ceilingLabel: ceilingLabel
  };
}));
