// 部屋の種別と、その部屋に要るもの。
//
// なぜ在るのか
// ------------
// 読み取りが返すのは14種類——建具・階段・浴槽・便器・洗面台・流し台だけで、
// **家具は1つも入っていない**。図面の家具はメーカーの標準仕様の絵であって、
// 実際に置く物ではないからである（worker/plan-item-spec.mjs）。
//
// その結果、取り込んだ直後の間取りは家具ゼロの箱になる。画面は
// 「取り込んだあと、手で直して仕上げてください」で終わり、753点のカタログから
// 何をどこに置けばよいかは、使う側が一から考えることになっていた。
//
// ここは「この部屋には何が要るか」を1か所に書く。出どころは
// docs/quality-bar.md の既定プラン クオリティライン。
//
// **種別の見分けは、まず決まった表で行う。** 「浴室」「トイレ」「玄関」は
// 言葉が決まっているので、モデルに聞く必要がない。聞くのは「洋室(1)」の
// ような、広さと階と他の部屋との関係でしか決まらないものだけ。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoomProgram = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // ── 部屋の種別 ──────────────────────────────────────────────────
  //
  // key は assets/models/tags.json の room と揃えてある（置かれる部屋で
  // カタログを絞れるようにするため）。hall / stairs / wic / balcony は
  // 間取り側にしかないので、ここで足している。
  var ROOM_TYPES = {
    ldk: { ja: 'LDK', what: 'リビング・ダイニング・キッチンが一体の部屋' },
    living: { ja: 'リビング', what: 'くつろぐための部屋。食事や調理は別の部屋' },
    dining: { ja: 'ダイニング', what: '食事のための部屋' },
    kitchen: { ja: 'キッチン', what: '調理のための部屋' },
    bedroom: { ja: '主寝室', what: '大人が寝る部屋' },
    kids: { ja: '子供部屋', what: '子供が寝て、勉強する部屋' },
    washitsu: { ja: '和室', what: '畳の部屋' },
    study: { ja: '書斎', what: '仕事や読書のための小さな部屋' },
    entry: { ja: '玄関', what: '家の出入口と靴を脱ぐ土間' },
    hall: { ja: 'ホール・廊下', what: '部屋と部屋をつなぐ通路' },
    stairs: { ja: '階段', what: '階段のための場所' },
    bath: { ja: '浴室', what: '湯船とシャワーのある部屋' },
    washroom: { ja: '洗面脱衣室', what: '洗面台と洗濯機のある部屋' },
    toilet: { ja: 'トイレ', what: '便器のある部屋' },
    wic: { ja: 'ウォークインクローゼット', what: '人が入れる衣類の収納' },
    storage: { ja: '納戸・パントリー', what: '物をしまうための部屋' },
    balcony: { ja: 'バルコニー', what: '屋外に張り出した床' },
    // key は tags.json の room と揃える。以前 exterior と書いていたが、
    // タグ787点側は outdoor で、**同じものに二つの名前があった**。
    outdoor: { ja: '外構', what: '建物の外。門柱・庭・駐車スペース' },
    other: { ja: 'その他', what: '上のどれでもない' },
  };

  // 名前から決まるもの。**ここで決まれば、モデルには聞かない。**
  // 上から順に見て、最初に当たったものを採る（「洗面脱衣室」が
  // 「洗面」で当たるように、狭いものを先に置く）。
  //
  // **実物の図面から足したもの**(2026-09、提供された3プランで確かめた):
  // 室名46件のうち16件が決まらなかった。そのうち名前だけで決まるものを足した。
  //   収納 … 「収納」「床上げ収納」「ハーフ収納」。日本の図面で最も多い室名の
  //          ひとつなのに、納戸・物置・押入しか見ていなかった
  //   FCL / ファミリークローゼット … 人が入る衣類の収納なので wic
  //   SCL … シューズクローク(SIC と同じもの)の別表記
  //   Living Dining Kitchen … LDK を英語で書いた図面がある(綴り違いも実在する)
  // 残る「洋室」「趣味部屋」「スキップ」「ニッチ」「KB置き場」は**名前だけでは
  // 決まらない**ので、ここでは決めない(Jev に聞く)。
  var NAME_RULES = [
    [/ウォークイン|ＷＩＣ|WIC|W\.I\.C|ファミリークローゼット|ファミクロ|ＦＣＬ|FCL(?![A-Za-z])/i, 'wic'],
    [/バルコニー|ベランダ|ルーフテラス/, 'balcony'],
    [/洗面|脱衣|ランドリー|ユーティリティ/, 'washroom'],
    [/浴室|バスルーム|風呂|ユニットバス|ＵＢ|UB(?![A-Za-z])/i, 'bath'],
    [/トイレ|便所|ＷＣ|WC(?![A-Za-z])|化粧室/i, 'toilet'],
    [/玄関|エントランス|ポーチ|土間/, 'entry'],
    [/階段|kaidan/i, 'stairs'],
    [/ホール|廊下|通路|コリドー/, 'hall'],
    [/納戸|物置|パントリー|シューズクローク|ＳＩＣ|SIC(?![A-Za-z])|ＳＣＬ|SCL(?![A-Za-z])|物入|収納/i, 'storage'],
    [/書斎|ワークスペース|スタディ|ＳＲ/, 'study'],
    [/子供|子ども|こども|キッズ|児童/, 'kids'],
    [/主寝室|寝室|ベッドルーム|ＭＢ|MBR?(?![A-Za-z])/i, 'bedroom'],
    [/和室|畳/, 'washitsu'],
    [/ＬＤＫ|LDK|リビングダイニング|居間|living\s*d[iy]n+ing\s*kitchen/i, 'ldk'],
    [/ダイニング|ＤＫ|DK(?![A-Za-z])/i, 'dining'],
    [/キッチン|台所/, 'kitchen'],
    [/リビング/, 'living'],
    [/クローゼット|押入|ＣＬ/, 'storage'],
  ];

  // 「洋室」は広さと階でしか決まらない。ここでは決めない。
  var AMBIGUOUS = /^(洋室|居室|room|部屋)[\s\d（）()：:・-]*$/i;

  /**
   * 室名から種別を決める。決まらなければ null（呼ぶ側が Jev に聞く）。
   * @param {string} name 読み取った室名
   */
  function typeFromName(name) {
    var text = String(name || '').normalize('NFKC').trim();
    if (!text) return null;
    if (AMBIGUOUS.test(text)) return null;
    for (var i = 0; i < NAME_RULES.length; i++) {
      if (NAME_RULES[i][0].test(text)) return NAME_RULES[i][1];
    }
    return null;
  }

  // ── その部屋に要るもの ──────────────────────────────────────────
  //
  // kind は assets/models/tags.json の分類。出どころは docs/quality-bar.md。
  // why は画面にそのまま出す文なので、**理由を書く**。「ソファが無い」では
  // なく「くつろぐ場所が無い」と書けるように。
  // **どの部屋からも要求されない分類は、仕上げの「足りないもの」に一生出て
  // こない。** 在庫83点がその状態だったので、居場所のあるものを足した
  // (寝具・ロールスクリーン・生活家電・カウンターテーブル)。
  //
  // 残り57点は、足さないと決めたもの:
  //   建具（モデル）22  ドアは壁に開口を切る仕組みで置く。家具として置くと
  //                     壁と無関係な位置に浮く
  //   シンク15          システムキッチンに含まれている。単体で置く場面が無い
  //   テーブルセット10  ダイニングテーブル+椅子と二重になる
  //   ペット10          飼うかどうかは家族次第。「足りない」とは言えない
  // 検索からは引けるので、置きたい人は置ける。
  var PROGRAM = {
    ldk: [
      { kind: 'sofa', n: 1, why: 'くつろぐ場所' },
      { kind: 'low-table', n: 1, why: 'ソファの前に置くテーブル' },
      { kind: 'rug', n: 1, why: 'ソファまわりの床' },
      { kind: 'tv', n: 1, why: 'テレビとその台' },
      { kind: 'dining-table', n: 1, why: '食事の場所' },
      { kind: 'chair', n: 4, why: '食卓の椅子' },
      { kind: 'kitchen-unit', n: 1, why: '調理台' },
      { kind: 'refrigerator', n: 1, why: '冷蔵庫' },
      { kind: 'curtain', n: 1, why: '窓まわり' },
      { kind: 'light', n: 1, why: '間接照明' },
      { kind: 'plant', n: 1, why: 'グリーン' },
      { kind: 'decor', n: 2, why: '生活の気配' },
      { kind: 'cabinet', n: 1, why: 'リビングの収納' },
      { kind: 'counter-table', n: 1, why: '対面キッチンのカウンター' },
      { kind: 'wall-decor', n: 1, why: '壁の見せ場' },
      { kind: 'hvac', n: 1, why: 'エアコン' },
      { kind: 'cooktop', n: 1, why: 'コンロ' },
      { kind: 'range-hood', n: 1, why: '換気' },
      { kind: 'cooking-appliance', n: 1, why: 'レンジ・食洗機' },
    ],
    living: [
      { kind: 'sofa', n: 1, why: 'くつろぐ場所' },
      { kind: 'low-table', n: 1, why: 'ソファの前に置くテーブル' },
      { kind: 'rug', n: 1, why: 'ソファまわりの床' },
      { kind: 'tv', n: 1, why: 'テレビとその台' },
      { kind: 'curtain', n: 1, why: '窓まわり' },
      { kind: 'light', n: 1, why: '間接照明' },
    ],
    dining: [
      { kind: 'dining-table', n: 1, why: '食事の場所' },
      { kind: 'chair', n: 4, why: '食卓の椅子' },
      { kind: 'light', n: 1, why: '食卓の上の照明' },
    ],
    kitchen: [
      { kind: 'kitchen-unit', n: 1, why: '調理台' },
      { kind: 'range-hood', n: 1, why: '換気' },
      { kind: 'refrigerator', n: 1, why: '冷蔵庫' },
      { kind: 'kitchen-storage', n: 1, why: '食器と食品の収納' },
      { kind: 'cooktop', n: 1, why: 'コンロ' },
      { kind: 'cooking-appliance', n: 1, why: 'レンジ・食洗機' },
    ],
    bedroom: [
      { kind: 'bed', n: 1, why: '寝る場所' },
      { kind: 'bedding', n: 1, why: '布団と枕' },
      { kind: 'light', n: 1, why: '枕元の明かり' },
      { kind: 'chest', n: 1, why: '衣類の収納' },
      { kind: 'curtain', n: 1, why: '窓まわり' },
      { kind: 'rug', n: 1, why: 'ベッドの足元' },
      { kind: 'hvac', n: 1, why: 'エアコン' },
    ],
    kids: [
      { kind: 'bed', n: 1, why: '寝る場所' },
      { kind: 'bedding', n: 1, why: '布団と枕' },
      { kind: 'desk', n: 1, why: '勉強する場所' },
      { kind: 'chair', n: 1, why: '机の椅子' },
      { kind: 'shelf', n: 1, why: '本と持ち物の収納' },
      { kind: 'curtain', n: 1, why: '窓まわり' },
      { kind: 'light', n: 1, why: '手元の明かり' },
      { kind: 'hvac', n: 1, why: 'エアコン' },
      { kind: 'kids', n: 1, why: '子供の持ち物' },
    ],
    washitsu: [
      { kind: 'low-table', n: 1, why: '座って使う卓' },
      { kind: 'curtain', n: 1, why: '窓まわり' },
      { kind: 'decor', n: 1, why: '床の間まわりの設え' },
      { kind: 'hvac', n: 1, why: 'エアコン' },
    ],
    study: [
      { kind: 'desk', n: 1, why: '作業する場所' },
      { kind: 'chair', n: 1, why: '机の椅子' },
      { kind: 'shelf', n: 1, why: '本の収納' },
      { kind: 'light', n: 1, why: '手元の明かり' },
    ],
    entry: [
      { kind: 'shoe-storage', n: 1, why: '靴の収納' },
      { kind: 'mirror', n: 1, why: '出がけの身支度' },
      { kind: 'decor', n: 1, why: '迎える設え' },
    ],
    bath: [
      { kind: 'bathtub', n: 1, why: '湯船' },
      { kind: 'shower', n: 1, why: 'シャワー' },
    ],
    washroom: [
      { kind: 'vanity', n: 1, why: '洗面台' },
      { kind: 'laundry', n: 1, why: '洗濯機' },
      { kind: 'mirror', n: 1, why: '鏡' },
      { kind: 'roller-screen', n: 1, why: '窓まわり（カーテンは掛けない）' },
      { kind: 'appliance', n: 1, why: '生活家電の置き場' },
    ],
    toilet: [
      { kind: 'toilet', n: 1, why: '便器' },
      { kind: 'roller-screen', n: 1, why: '窓まわり（カーテンは掛けない）' },
    ],
    wic: [
      { kind: 'closet', n: 1, why: '衣類を掛ける' },
      { kind: 'shelf', n: 1, why: '棚' },
    ],
    storage: [
      { kind: 'shelf', n: 1, why: '棚' },
    ],
    hall: [],
    stairs: [],
    balcony: [
      { kind: 'laundry', n: 1, why: '物干し' },
    ],
    // 敷地。部屋ではないが、**外構が無い家は3Dで見ると家に見えない**ので、
    // 仕上げの一覧では1つの区画として扱う。
    outdoor: [
      { kind: 'gate-post', n: 1, why: '門柱とポスト' },
      { kind: 'garden-plant', n: 3, why: 'シンボルツリー・中木・下草' },
      { kind: 'fence', n: 1, why: '隣地との目隠し' },
      { kind: 'deck', n: 1, why: '庭とつながる床' },
      { kind: 'garden-equipment', n: 1, why: '立水栓' },
      { kind: 'utility-equipment', n: 2, why: '室外機・給湯器' },
    ],
    other: [],
  };

  /** その種別に要るものの一覧。知らない種別なら空。 */
  function programFor(type) {
    return PROGRAM[type] || [];
  }

  /**
   * 足りないものを挙げる。
   * @param {string} type    部屋の種別
   * @param {string[]} kinds いまその部屋にある品の分類（重複あり）
   */
  function missingFor(type, kinds) {
    var have = {};
    (kinds || []).forEach(function (k) { have[k] = (have[k] || 0) + 1; });
    return programFor(type).filter(function (need) {
      return (have[need.kind] || 0) < need.n;
    }).map(function (need) {
      return { kind: need.kind, why: need.why, have: have[need.kind] || 0, need: need.n };
    });
  }

  return {
    ROOM_TYPES: ROOM_TYPES,
    PROGRAM: PROGRAM,
    typeFromName: typeFromName,
    programFor: programFor,
    missingFor: missingFor,
  };
}));
