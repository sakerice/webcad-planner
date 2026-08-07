// 生成AIが立面・内観のレンダを描き直すとき、どの要素をどれだけ厳格に守るかを1か所に集める。
// ユーザーの言葉での原則: 開口部と建具はハードロック、家具はソフトロック、
// 光・空気・人はAIの裁量に任せる。
//   LOCKED: 変えたら別の家になる。位置・寸法・形状を凍結する。
//   SOFT:   同じ場所に・同じ種類のものが・存在し続ける必要はあるが、
//           実際の質感・経年・生活感を新しく生成してよい。
//   FREE:   計測しない。AIが自由に描いてよい。
//
// 未知の type は LOCKED に倒す。分類漏れで設計要素（新しい建具種別など）が
// 黙って自由化される方が、自由にできるはずのものが固定される事故より重い。
// 2027年に新しい建具 type が追加されてこの表が更新されなければ、
// 起きてほしい失敗は「無駄に凍結された」であって「窓が黙って動いた」ではない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LockTiers = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var LOCKED = 'LOCKED';
  var SOFT = 'SOFT';
  var FREE = 'FREE';

  // 完全一致表。ワイルドカードを持たない type はここに書く。
  var EXACT = {
    // 躯体・開口・外構 -- 変えたら別の家になる
    wall: LOCKED,
    roof: LOCKED,
    balcony: LOCKED,
    foundation: LOCKED,
    room: LOCKED,
    'site-rect': LOCKED,
    fence: LOCKED,
    'wood-fence': LOCKED,
    'lattice-screen': LOCKED,
    ramp: LOCKED,
    'exterior-stair': LOCKED, // stair* の接頭辞に一致しないため個別に列挙

    // 什器・造作 -- 同じ場所に同じ種類のものが要るが、質感はAI任せ
    closet: SOFT,
    shoe_cabinet: SOFT,
    washer: SOFT,
    tv: SOFT,
    desk: SOFT,
    sofa: SOFT,
    bath: SOFT,
    toilet: SOFT,
    sink: SOFT,
    kitchen: SOFT,
    fridge: SOFT,
    car: SOFT,

    // 周辺環境・注記レイヤー -- 計測しない
    memo: FREE,
    ruler: FREE,
    'walk-route': FREE,
    road: FREE,
    'utility-pole': FREE
  };

  // 接頭辞表。順番に前方一致で調べる。EXACT に無い type だけがここに来る。
  var PREFIXES = [
    { prefix: 'window', tier: LOCKED },
    { prefix: 'door', tier: LOCKED },
    { prefix: 'stair', tier: LOCKED },
    { prefix: 'fmp-', tier: SOFT },
    { prefix: 'im0261-', tier: SOFT },
    { prefix: 'light-', tier: SOFT },
    { prefix: 'bed-', tier: SOFT },
    { prefix: 'bicycle', tier: SOFT },
    { prefix: 'neighbor-', tier: FREE }
  ];

  function tierOf(type) {
    if (typeof type !== 'string' || type === '') return LOCKED;
    if (Object.prototype.hasOwnProperty.call(EXACT, type)) return EXACT[type];
    for (var i = 0; i < PREFIXES.length; i++) {
      var rule = PREFIXES[i];
      if (type.indexOf(rule.prefix) === 0) return rule.tier;
    }
    return LOCKED; // 未知の type は LOCKED に倒す
  }

  // instance-legend.json と同じ形の配列から、色→階層の表を作る。
  // 照合側（ガイド画像から色一致でインスタンスを切り出す側）が厳密一致するため、
  // 色は小文字に正規化する。同じ色が2件以上あれば、それは本来ユニークであるべき
  // ガイドの色が壊れている証拠なので、握りつぶさずコンソールに警告して後勝ちにする。
  function tableFor(legend) {
    var table = {};
    var list = legend || [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || typeof entry.color !== 'string') continue;
      var color = entry.color.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(table, color) &&
          typeof console !== 'undefined' && console.warn) {
        console.warn('LockTiers.tableFor: duplicate legend color ' + color +
          ' (instance id ' + entry.id + ') -- guide colors should be unique, last entry wins');
      }
      table[color] = tierOf(entry.type);
    }
    return table;
  }

  // 階層ごとに登場した type 名（重複無し）と、インスタンス単位の件数を返す。
  function summarize(legend) {
    var list = legend || [];
    var result = {
      LOCKED: [],
      SOFT: [],
      FREE: [],
      counts: { LOCKED: 0, SOFT: 0, FREE: 0 }
    };
    var seen = { LOCKED: {}, SOFT: {}, FREE: {} };
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var tier = tierOf(entry.type);
      result.counts[tier] += 1;
      var typeName = entry.type;
      if (!Object.prototype.hasOwnProperty.call(seen[tier], typeName)) {
        seen[tier][typeName] = true;
        result[tier].push(typeName);
      }
    }
    return result;
  }

  return {
    LOCKED: LOCKED,
    SOFT: SOFT,
    FREE: FREE,
    tierOf: tierOf,
    tableFor: tableFor,
    summarize: summarize
  };
}));
