// 撮ったレンダと instance-legend から、生成AIに渡す1本のプロンプト文を組み立てる。
//
// 構成比が仕様である。実測で得た事実だけを実装しているので、好みで並べ替えないこと。
//   1. 表現の指定（プリセット本文＋任意の仕上げメモ）          60〜70%
//   2. この家に何があるか（LOCKED の名指し）                  20〜30%
//   3. してはならないこと（2〜3文）                           末尾のみ
//
// 実測の失敗:
//   * 本文の8割が禁止だった T91/T95 は、渡した映像のほぼコピーを返した。
//     すべての制約を「何も変えない」ことで同時に満たせてしまうため、モデルは
//     間違っていない。表現を先に置き、制約を末尾1か所に畳むと変換が始まった。
//   * 個々の仕上げを「そのままにしろ」（ルーバーは黒のまま/塗り直すな）と書くと
//     効かないうえ生成そのものが止まった。二度起きた。仕上げの保持は Task 6 の
//     素材側（影を潰さない）で担保する。ここには絶対に書かない。
//   * 3Dレンダに「フラットな未着色CAD状態から始めて」と書くと、モデルは渡した
//     映像を捨てて線画を描き直した。同じ文は素材が本当に図面のときだけ正しい。
//     ゆえにプリセットは撮影元 (source) でゲートする。
//   * 「線画・図面・フラットな未着色レンダに戻すな」だけは実測で効く唯一の禁止で、
//     常に入れる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lock-tiers.js'));
  else root.VideoPrompt = factory(root.LockTiers);
}(typeof self !== 'undefined' ? self : this, function (LockTiers) {
  var MAX_DURATION_SEC = 15;
  var DEFAULT_DURATION_SEC = 8;

  // 名指しする種類の上限。実データの legend は 230 インスタンス・LOCKED だけで
  // 22 type あり、素直に並べると第2節が本文を食いつぶして構成比が壊れる。
  // 5種で ~110 文字に収まり、legend が 7 件でも 230 件でも長さが変わらない。
  var MAX_NAMED_KINDS = 5;

  // ── 表現プリセット。source が素材の種類を決める ──────────────────────
  var PRESETS = [
    {
      id: 'plan-to-life',
      label: 'CAD図面 → 生活',
      source: 'plan',
      body: 'Open on the flat, untextured floor plan exactly as supplied. Over the first second the drawing lifts into three dimensions: the walls gain thickness and height, the floor gains real oak with visible grain, and the outlines of the furniture fill out into solid objects with weight and soft contact shadows. Warm afternoon daylight arrives through the openings, pools on the floor and falls away into soft shadow. The materials resolve into oiled timber, brushed stone on the counter, linen with the creases of use, a plant catching the light. By the final second it is an unmistakably real, lived-in home, filmed as a warm, photoreal architectural film.'
    },
    {
      id: 'plan-to-life-watercolor',
      label: 'CAD図面 → 生活（水彩風）',
      source: 'plan',
      body: 'Open on the flat, untextured floor plan exactly as supplied. Over the first second watercolour washes bloom outward from the room edges, with soft pigment boundaries, paper grain and colour bleeding into the wall planes, and the drawing lifts into three dimensions. As the wash settles it resolves into photography: real oak grain in the floorboards, woven rattan on the cabinet fronts, linen in the seating, warm afternoon sun raking through the openings and pooling on the floor, soft contact shadows under every leg. By the final second it is an unmistakably real, lived-in room, a magazine interior photograph.'
    },
    {
      id: 'render-to-life',
      label: '3D画面 → 生活',
      source: '3d',
      body: 'Carry this footage into a warm, photoreal architectural film. The surfaces resolve into real material: oiled oak underfoot with visible grain, brushed stone on the counter, plaster that reads as plaster, cabinet fronts with a real finish and faint reflections, linen with the creases of use. Daylight pours in through the windows, bounces off the pale walls and fills the space with soft indirect light, while the fittings add small warm pools. Dust turns slowly in the sunbeam. Cinematic colour, shallow depth of field and a gentle handheld breath, with the feeling of a real afternoon in a real home.'
    },
    {
      id: 'render-to-life-watercolor',
      label: '3D画面 → 生活（水彩風）',
      source: '3d',
      body: 'Carry this footage into life through watercolour. For the first second soft washes bloom across the surfaces, with pigment edges, paper grain and colour bleeding gently past the boundaries, and then the wash resolves into photography: real oak grain underfoot, brushed stone on the counter, woven rattan on the cabinet fronts, linen with the creases of use. Daylight floods in through the windows and fills the space with soft indirect light, pooling warm on the floor and falling away into soft shadow. By the final second it is an unmistakably real, lived-in home, filmed with cinematic colour and shallow depth of field.'
    },
    {
      id: 'life',
      label: '生活映像',
      source: '3d',
      body: 'A warm, photoreal architectural film of a house that is being lived in. Daylight floods in through the windows, bounces off the pale walls and fills the space with soft indirect light, and the fittings add small warm pools. Every surface reads as real material with age and use in it: grain in the timber, weave in the fabric, a sheen on the stone. Add the quiet evidence of living, a book left open on the table, a mug beside it, a folded throw over the arm of the seating, a plant catching the light, a chair pulled out from the table. Someone moves unhurriedly through the space. Cinematic colour, shallow depth of field, a gentle handheld breath.'
    },
    {
      id: 'life-watercolor',
      label: '生活映像（水彩風）',
      source: '3d',
      body: 'A warm watercolour film of a house that is being lived in, painted and then breathed into life. Soft washes carry the colour, with pigment edges, paper grain and light blooming through the windows, and they settle into real material with age and use in it. Warm daylight pools on the floor and falls away into soft shadow. Add the quiet evidence of living, a book left open, a mug beside it, a folded throw, a plant catching the light, a chair pulled out from the table. Someone moves unhurriedly through the space. The finish reads painterly throughout while the room reads as a real, inhabited home.'
    }
  ];

  // ── LOCKED の名指し ─────────────────────────────────────────────────
  // 個体を全部並べるのではなく、種類と個数を言う。「三つの窓と引き戸が一枚」であって
  // 70件の色つき id の羅列ではない。
  //
  // 宣言順が salience の順。上限に達したら以降は落とし、落ちた分は
  // 「残りの構造も参照のとおり」の一句で受ける（＝黙って自由化はされない）。
  // ここに名前を持たない type（wall / room / foundation / site-rect / custom-block /
  // 未知の Mesh など）は数えても文にならないので、同じ一句が受け持つ。
  var NOUNS = [
    { prefix: 'window', one: 'a window', many: 'windows', countable: true },
    { prefix: 'door-slide', one: 'a sliding door', many: 'sliding doors', countable: true },
    { exact: 'door-front', one: 'a front door', many: 'front doors', countable: true },
    // 階段は run と踊り場が別インスタンスになる。「六つの階段」は嘘なので数えない。
    { prefix: 'stair', one: 'a staircase', many: 'a staircase', countable: false },
    { exact: 'balcony', one: 'a balcony', many: 'balconies', countable: true },
    { prefix: 'door-swing', one: 'a hinged door', many: 'hinged doors', countable: true },
    { prefix: 'door-fold', one: 'a folding door', many: 'folding doors', countable: true },
    { prefix: 'door', one: 'a door', many: 'doors', countable: true },
    // 屋根も面ごとに分かれる。枚数を言う意味がない。
    { exact: 'roof', one: 'a roof', many: 'a roof', countable: false },
    { exact: 'lattice-screen', one: 'a lattice screen', many: 'lattice screens', countable: true },
    { exact: 'wood-fence', one: 'a wooden fence', many: 'wooden fences', countable: true },
    { exact: 'fence', one: 'a fence', many: 'fences', countable: true },
    { exact: 'ramp', one: 'a ramp', many: 'ramps', countable: true },
    { exact: 'exterior-stair', one: 'an outdoor stair', many: 'an outdoor stair', countable: false }
  ];

  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen', 'twenty'];

  function numberWord(n) {
    return (n >= 0 && n < WORDS.length) ? WORDS[n] : String(n);
  }

  function nounFor(type) {
    if (typeof type !== 'string' || type === '') return null;
    for (var i = 0; i < NOUNS.length; i++) {
      var rule = NOUNS[i];
      if (rule.exact !== undefined) {
        if (type === rule.exact) return rule;
      } else if (type.indexOf(rule.prefix) === 0) {
        return rule;
      }
    }
    return null;
  }

  function joinList(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    return items.slice(0, items.length - 1).join(', ') + ' and ' + items[items.length - 1];
  }

  // legend から LOCKED のインスタンスだけを拾い、名前を持つ種類ごとに数える。
  // 階層の判定は LockTiers.summarize に委ねる（分類は1か所にしかない）。
  function namedKinds(legend) {
    var list = legend || [];
    var summary = LockTiers.summarize(list);
    var locked = {};
    var i;
    for (i = 0; i < summary.LOCKED.length; i++) locked[summary.LOCKED[i]] = true;

    var counts = {};
    for (i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      if (!Object.prototype.hasOwnProperty.call(locked, entry.type)) continue;
      var rule = nounFor(entry.type);
      if (!rule) continue;
      var key = rule.exact !== undefined ? rule.exact : rule.prefix;
      if (!Object.prototype.hasOwnProperty.call(counts, key)) {
        counts[key] = { rule: rule, n: 0 };
      }
      counts[key].n += 1;
    }

    var phrases = [];
    for (i = 0; i < NOUNS.length && phrases.length < MAX_NAMED_KINDS; i++) {
      var r = NOUNS[i];
      var k = r.exact !== undefined ? r.exact : r.prefix;
      if (!Object.prototype.hasOwnProperty.call(counts, k)) continue;
      var n = counts[k].n;
      if (!r.countable || n === 1) phrases.push(r.one);
      else phrases.push(numberWord(n) + ' ' + r.many);
    }
    return phrases;
  }

  function houseSentence(legend) {
    var kinds = namedKinds(legend);
    if (kinds.length === 0) {
      return 'The house is the one the reference draws, and every wall, opening and stair sits exactly where the reference puts it.';
    }
    return 'The house in the reference has ' + joinList(kinds) +
      ', and the walls, the rooms and the rest of the structure sit exactly where the reference puts them.';
  }

  // ── 撮影の状況 ───────────────────────────────────────────────────────
  // posM / targetM は three.js と同じ Y-up の並び [x, 高さ, z] である。実データ
  // (pv/renders/*/shot.json) で確かめた: T92-ldk-overhead は pos[1]=11 / target[1]=3.4
  // で見下ろし、T93-ldk-eye は 4.2 / 4.05 で水平、T94-exterior は 3.2 / 2.8。
  // 添字を 2 と取り違えると T94 で「床から -3.6 m」という文をユーザーに渡す。
  var HEIGHT_AXIS = 1;

  // 「目線の高さ」は床からの高さであって、posM の世界座標ではない。2階の目線は
  // 世界座標では 4.2 m になるので、posM からは決して導けない。明示された
  // eyeHeightM だけを使い、人が構える範囲を外れた値は読めなかったものとして扱う。
  function eyeHeightOf(camera) {
    if (!camera) return null;
    var h = camera.eyeHeightM;
    if (typeof h !== 'number' || !isFinite(h)) return null;
    return (h >= 0.2 && h <= 2.5) ? h : null;
  }

  function axisOf(vec) {
    if (!vec || typeof vec[HEIGHT_AXIS] !== 'number' || !isFinite(vec[HEIGHT_AXIS])) return null;
    return vec[HEIGHT_AXIS];
  }

  function metres(v) {
    var r = Math.round(v * 100) / 100;
    return String(r);
  }

  function shotSentence(camera) {
    var eye = eyeHeightOf(camera);
    if (eye !== null) {
      return 'The shot stays at eye level, about ' + metres(eye) +
        ' m above the floor, and holds the framing the reference gives it.';
    }
    var from = camera ? axisOf(camera.posM) : null;
    var at = camera ? axisOf(camera.targetM) : null;
    if (from !== null && at !== null && from - at > 1.5) {
      return 'The shot looks down over the space from above and holds the framing the reference gives it.';
    }
    return 'The shot holds the framing the reference gives it.';
  }

  // ── 光 ───────────────────────────────────────────────────────────────
  // shot.json の daylight は {interiorSun, sunScale, applied:{enabled, timeOfDay,...}}。
  // 文字列でも受ける。読めなければ黙って省く（無い光を捏造しない）。
  var LIGHT = {
    morning: 'The light is clear morning daylight.',
    day: 'The light is full afternoon daylight.',
    noon: 'The light is high midday sun.',
    afternoon: 'The light is low afternoon sun.',
    evening: 'The light is low evening sun turning towards dusk.',
    dusk: 'The light is low evening sun turning towards dusk.',
    night: 'It is night outside, and the interior lights carry the room.'
  };

  function lightSentence(daylight) {
    if (!daylight) return '';
    var key = null;
    if (typeof daylight === 'string') key = daylight;
    else if (typeof daylight.timeOfDay === 'string') key = daylight.timeOfDay;
    else if (daylight.applied && typeof daylight.applied.timeOfDay === 'string') key = daylight.applied.timeOfDay;
    if (key === null) return '';
    key = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(LIGHT, key) ? LIGHT[key] : '';
  }

  // ── 末尾の制約 ───────────────────────────────────────────────────────
  // 3文。1文目が幾何、2文目が「見え方だけを変える」、3文目が唯一効く禁止。
  // 個々の仕上げの色には触れない。
  var CLOSING = 'Keep every wall, opening, window, stair, counter and furniture item exactly where the reference places it, and do not add or remove any of them. ' +
    'Change only how it looks, never what is there. ' +
    'Never let the image become a line drawing, a diagram or a flat untextured render at any point.';

  function presetsFor(source) {
    // 未知の source には何も出さない。素材の種類を取り違えたプリセットは
    // 参照そのものを壊す（3Dレンダに図面用の文を当てると線画に描き直される）。
    if (source !== 'plan' && source !== '3d') return [];
    var out = [];
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].source === source) out.push(PRESETS[i]);
    }
    return out;
  }

  // note は「仕上げメモ」。プリセット本文の**後ろに足す**のであって、置き換えない。
  //
  // 以前は userText がプリセット本文をまるごと置き換えていた。短い一言
  // （「明るい昼」など）を書いた瞬間、表現の指定がその一言だけになり、残りは
  // 末尾の禁止文だけのプロンプトになる。それは実測で素通し（渡した映像のほぼ
  // コピー）を生んだ形そのものなので、置き換えは許さない。
  function compose(opts) {
    var o = opts || {};
    var appearance = '';
    if (o.preset && typeof o.preset.body === 'string') {
      appearance = o.preset.body;
      var light = lightSentence(o.daylight);
      if (light) appearance += ' ' + light;
    }
    // 表現の指定が無いまま組み立てると、禁止だけのプロンプトになる。
    // それは実測で素通しを生んだ形そのものなので、何も返さない。
    if (appearance === '') return '';
    if (typeof o.note === 'string' && o.note.replace(/^\s+|\s+$/g, '') !== '') {
      appearance += ' ' + o.note.replace(/^\s+|\s+$/g, '');
    }

    return [appearance, houseSentence(o.legend), shotSentence(o.camera), CLOSING].join(' ');
  }

  return {
    MAX_DURATION_SEC: MAX_DURATION_SEC,
    DEFAULT_DURATION_SEC: DEFAULT_DURATION_SEC,
    MAX_NAMED_KINDS: MAX_NAMED_KINDS,
    PRESETS: PRESETS,
    presetsFor: presetsFor,
    compose: compose
  };
}));
