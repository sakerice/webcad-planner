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
    // 任意ブロック。ユーザーが設計として置いた体積であって、質感を作り直してよい
    // 家具ではない。実データ (instance-legend) に現れるが表に無かったため明示する。
    'custom-block': LOCKED,
    // 部屋の天井面。3D構築コードが部屋ごとに1枚作る面で、設計要素を指す ref を
    // 持たないため legend では長らく未分類 ('render-object') に落ちていた。
    // 高さと広がりは設計そのもの（平面図の CH ラベルが約束する数字である）。
    ceiling: LOCKED,

    // 屋外設備。設計として置かれた実在の物なので、消えても増えても困る。
    // ただし建具ではないので、質感や経年はAIに作らせてよい -> SOFT。
    // いずれも実データに現れるが表に無かったため明示する。
    'ac-outdoor': SOFT,
    'gas-heater': SOFT,
    'meter-box': SOFT,

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

    // 道路。「その方向にそれがある」ことは保つ必要がある（家の向きと接道は
    // 設計の前提である）が、舗装の質感も幅も長さも生成AIが作り直してよい。
    // ユーザーの判断で FREE から SOFT へ。
    road: SOFT,

    // 周辺環境・注記レイヤー -- 計測しない
    memo: FREE,
    ruler: FREE,
    'walk-route': FREE,
    'utility-pole': FREE,
    // 敷地外の地面。ここを本物の路面・街路にしてほしい場所であって、
    // LOCKED は「やってほしいことを禁じる」ことになる。
    'outside-ground': FREE,
    // 部屋に照明が1つも置かれていないときにレンダが自動で足す天井器具。
    // ユーザーが設計として置いたものではなく、光はAIの裁量という原則の側にある。
    'auto-light-fixture': FREE
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

  // 「明示的に分類されているか」と「未知の既定で LOCKED になったか」を区別する。
  // 両者は tierOf の戻り値では見分けられないが、意味はまるで違う。分類漏れを
  // 探すとき、実データの type をこれに通せば漏れだけが残る。
  function isKnownType(type) {
    if (typeof type !== 'string' || type === '') return false;
    if (Object.prototype.hasOwnProperty.call(EXACT, type)) return true;
    for (var i = 0; i < PREFIXES.length; i++) {
      if (type.indexOf(PREFIXES[i].prefix) === 0) return true;
    }
    return false;
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
    isKnownType: isKnownType,
    tableFor: tableFor,
    summarize: summarize
  };
}));
