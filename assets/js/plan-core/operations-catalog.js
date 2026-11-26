// 間取りの操作の名前・説明・引数の JSON Schema。ここが唯一の出どころ。
//
// なぜ在るのか
// ------------
// チャットの AI(Claude、Worker から1往復ずつ呼ぶ)と ChatGPT(MCP)が、同じ操作を
// assets/js/plan-core/operations.js の applyOperations で呼ぶ。道具の定義を呼び出し元ごとに
// 手で書くと、操作の引数を変えたときに片方だけ古くなるので、ここに1回だけ書いて
// toClaudeTools / toMcpTools で作る。
//
// 使う側の決まり
// --------------
// 段4(チャット)・段5(MCP)では、AI から来た道具の呼び出しを applyOperations に渡す前に、
// 必ず checkArgs(name, args) を通す。Claude も ChatGPT も、道具の Schema を守るとは限らない
// (知らない鍵・欠けた鍵・型違いをそのまま送ってくる)。operations.js は props のような画面用の
// 引数も受ける作りなので、AI に見せていない引数をここで止める。
//
// 決めごと
// --------
// - 名前は operations.js の OPS の鍵と同じ(検査が突き合わせる)。
// - setProps は set(PlanSettable の語彙)の形だけを載せる。props は画面用で AI には見せない。
// - enum・anyOf は使わない。読み取りで、選択肢の多い enum や anyOf が重なると Claude に
//   「文法が大きすぎる」で断られた(worker/plan-free.mjs の FREE_SCHEMA の説明、2026-10-19・20 実測)。
//   家財の種類は文字列で受け、操作の中で照合して、合わなければ候補を errors に入れて返す。
//   設定項目(set)は object で受け、項目名と値は操作の中で PlanSettable が確かめる。
// - id は Schema では文字。壁と物の id は数だが、operations.js は 12 と "12" を同じ物として引くので、
//   AI には文字で渡させる。数で来ても checkArgs は通す(落とすと AI が同じ呼び出しを繰り返すだけになる)。
// - 家財の種類・設定項目の一覧は手で書かず、PlanSettable(plan-settable.js)と
//   ObjectKnowledge(object-knowledge.js)から作る。どちらも引数 deps で受ける
//   (このファイルはグローバルにも兄弟のモジュールにも触らない)。
// - 説明文は日本語で、読み取りの道具の定義(worker/plan-free.mjs)と同じ書き方にする。
//   説明は operations.js の今の動き(写しに当てるとき)と合わせる。operations.js を変えたら、ここも見直す。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanCoreOperationsCatalog = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  var n = function (description) { return { type: 'number', description: description }; };
  var int = function (description) { return { type: 'integer', description: description }; };
  var str = function (description) { return { type: 'string', description: description }; };
  // 部屋の名前の長さの上限(文字。operations.js の ROOM_NAME_MAX と同じ)。checkArgs は maxLength を文字(コードポイント)で数える。
  var ROOM_NAME_MAX = 40;
  var NAME = function (description) {
    return { type: 'string', maxLength: ROOM_NAME_MAX, description: description + '。' + ROOM_NAME_MAX + ' 字まで。部屋の名前だけを書く' };
  };
  // checkArgs はこの ID を指す欄だけ、数も受ける(上の決めごと)。
  var ID = { type: 'string', description: '物・壁・部屋の id。数の id は "12" のように文字で渡す' };
  // 階の上限は operations.js の ctx.maxFloor(省けば 4)。AI に渡す範囲は、画面で階を選べる 1〜4。
  // 画面の包み(planOpsCtx)は保存プランが持てる上限(PlanSchema の MAX_FLOOR=5)まで受けるが、それは画面の範囲で、AI には広げない。
  var FLOOR = int('階（1〜4）。省くと 1');
  var SET = {
    type: 'object',
    description: '{項目: 値}。使える項目は物の種類で決まる（set に書ける項目の一覧を見る）'
  };
  function obj(properties, required) {
    return { type: 'object', properties: properties, required: required || [], additionalProperties: false };
  }
  // 桁の警告は operations.js の checkScale(写しに当てるとき、寸法 50mm 未満・100,000mm 超、座標 100,000mm 超)。
  var SCALE = '桁（mm）を間違えたらしい値は、通したうえで warnings で知らせる。';

  var OPERATIONS = [
    {
      name: 'addRoom',
      description: '部屋を1つ足す。部屋は床の範囲を表す長方形で、壁は作らない（壁は addWall で足す）。' + SCALE,
      inputSchema: obj({
        name: NAME('部屋の名前（洋室・LDK など）'),
        floor: FLOOR,
        x: n('部屋の中心の x（mm）'), y: n('部屋の中心の y（mm）'),
        w: n('東西の幅（mm）'), d: n('南北の奥行き（mm）')
      }, ['x', 'y', 'w', 'd'])
    },
    {
      name: 'resizeRoom',
      description: '部屋の大きさと位置を変える。渡した欄だけが変わる（x,y を省くと中心は今のまま）。'
        + '部屋の中の物と、まわりの壁は動かない。' + SCALE,
      inputSchema: obj({
        id: ID,
        x: n('新しい中心の x（mm）'), y: n('新しい中心の y（mm）'),
        w: n('新しい東西の幅（mm）'), d: n('新しい南北の奥行き（mm）')
      }, ['id'])
    },
    {
      name: 'renameRoom',
      description: '部屋の名前を変える。',
      inputSchema: obj({ id: ID, name: NAME('新しい名前') }, ['id', 'name'])
    },
    {
      name: 'addWall',
      description: '壁を1本足す。x1,y1 から x2,y2 までの壁の芯の線分（mm）。' + SCALE,
      inputSchema: obj({
        x1: n('始点の x（mm）'), y1: n('始点の y（mm）'), x2: n('終点の x（mm）'), y2: n('終点の y（mm）'),
        floor: FLOOR,
        thick: n('壁の厚さ（mm）。省くと 120')
      }, ['x1', 'y1', 'x2', 'y2'])
    },
    {
      name: 'removeWall',
      description: '壁を1本消す。壁の上の窓・扉は残る（壁以外は deleteObjects で消す）。',
      inputSchema: obj({ id: ID }, ['id'])
    },
    {
      name: 'placeItem',
      description: '家具・設備・窓・扉・階段・外構を1つ置く。x,y は物の中心（mm）。'
        + 'rot は度で、図の上を北として時計回り。カタログの家具は rot=0 で正面が南を向き、階段（stair）は rot=0 で南（+y）へ上る。'
        + '窓・扉の吊元と開く向きは指定できない。種類が合わなければ errors に候補が返る。' + SCALE,
      inputSchema: obj({
        type: str('置く物の種類（置ける物の種類の一覧を見る）'),
        x: n('物の中心の x（mm）'), y: n('物の中心の y（mm）'),
        rot: n('回転（度）。省くと 0'),
        floor: FLOOR,
        w: n('正面から見た幅（mm）。省くと種類の既定'),
        d: n('奥行き（mm）。省くと種類の既定'),
        set: SET
      }, ['type', 'x', 'y'])
    },
    {
      name: 'moveObject',
      description: '物・部屋・壁を動かす。x と y の両方（新しい中心）か、dx と dy の両方（動かす量）のどちらかを渡す。壁は dx,dy だけ。'
        + '部屋を動かしても、中の物と壁は動かない。' + SCALE,
      inputSchema: obj({
        id: ID,
        x: n('新しい中心の x（mm）'), y: n('新しい中心の y（mm）'),
        dx: n('東へ動かす量（mm。西はマイナス）'), dy: n('南へ動かす量（mm。北はマイナス）')
      }, ['id'])
    },
    {
      name: 'rotateObject',
      description: '物の向きを変える（壁と部屋は回せない）。rot（新しい角度）か by（今の角度に足す角度）のどちらか一方を渡す。'
        + '度で、図の上を北として時計回り。中心は動かない。',
      inputSchema: obj({ id: ID, rot: n('新しい角度（度）'), by: n('足す角度（度）') }, ['id'])
    },
    {
      name: 'deleteObjects',
      description: '物・壁・部屋を消す。1つでも見つからないかロックされていれば、どれも消さない。',
      inputSchema: obj({ ids: { type: 'array', items: ID, description: '消す物の id の配列' } }, ['ids'])
    },
    {
      name: 'setProps',
      description: '物・壁・部屋の設定を変える。set に書ける項目は物の種類で決まり、照明など set を受け付けない種類もある。'
        + '床・天井・サッシの色、扉の仕上げ、家具の部位ごとの色・素材・艶も変えられる。'
        + '範囲の外の数は端に寄せて warnings に書く。',
      inputSchema: obj({ id: ID, set: SET }, ['id', 'set'])
    },
    {
      name: 'addRoomWalls',
      description: '部屋（ids）か多角形（points と floor）の外周に壁を作る。既にある壁と重なる区間と、隣の部屋と共有する辺の二重の壁は作らない。'
        + '他の部屋と接する辺は thick、外に面する辺は outerThick（省くと thick。どちらも省くと 120）。',
      inputSchema: obj({
        ids: { type: 'array', items: ID, description: '部屋の id の配列' },
        points: { type: 'array', items: obj({ x: n('x'), y: n('y') }, ['x', 'y']), description: '多角形の頂点（mm）' },
        floor: FLOOR,
        thick: n('間仕切りの厚さ（mm）'), outerThick: n('外周の厚さ（mm）')
      })
    },
    {
      name: 'placeOpening',
      description: '窓・扉を、部屋 room と部屋 to の共有する壁の上、または room の side（N/E/S/W）の外壁の上に置く（to は省くか "outside"）。'
        + '壁が無ければ失敗する。既定は壁の中央。offset は北か西の端から開口の端までの距離（mm）。'
        + 'hinge は吊元の側（壁に沿う向き）、opens は開く側（壁と直角の向き）。どちらも N/E/S/W で、開き戸・玄関ドア・折戸だけ。',
      inputSchema: obj({
        type: str('窓・扉の種類（置ける物の種類の一覧の窓・扉）'),
        room: ID, to: str('隣の部屋の id か "outside"'), side: str('N/E/S/W'),
        width: n('開口の幅（mm）。省くと種類の既定'), offset: n('端からの距離（mm）'),
        hinge: str('N/E/S/W'), opens: str('N/E/S/W')
      }, ['type', 'room'])
    },
    {
      name: 'addRoof',
      description: '屋根をかける（画面の屋根の道具と同じ物）。floor は屋根が載る階。範囲 x,y,w,d（中心と大きさ）を省くと、その階の壁の外周'
        + '（長方形でなければ失敗するので、部分ごとに範囲を渡す）。overhang（軒の出 mm、省くと 450）を四方に足す。'
        + 'shape: gable（切妻。ridge=EW/NS、省くと長い辺に沿う）/ hip（寄棟・方形）/ hip-ridge / hip-ridge-long（大棟あり）/ flat（陸屋根）/ mono（片流れ。low=低い側 N/E/S/W）。'
        + 'pitch は勾配（度、5〜60。省くと 30）。同じ範囲に屋根があれば失敗する。',
      inputSchema: obj({
        floor: FLOOR, shape: str('屋根の形'), ridge: str('EW か NS'), low: str('N/E/S/W'),
        pitch: n('勾配（度）'), overhang: n('軒の出（mm）'),
        x: n('中心の x（mm）'), y: n('中心の y（mm）'), w: n('東西の幅（mm）'), d: n('南北の奥行き（mm）')
      }, ['floor', 'shape'])
    },
    {
      name: 'swapAssetSet',
      description: '置いてある家具を別のセット（洋館・古民家など）の物へまとめて差し替える（画面の「一括差し替え」と同じ）。'
        + '同じ分類で大きさの近い物は、中心・向き・階・幅と奥行きを保って替える（決め打ちの替え先は実物より大きい軸だけ縮める）。'
        + '代役（テレビ → 額絵）は実物の大きさで少し高く掛け、テーブルセット・キッチンは食卓と椅子・流しと戸棚に分けて置き直す。'
        + '台に含まれる上の物（洗面ボウルなど）は台と一緒に外す。色・素材の上書きは外れる。合う物が無い物は残し warnings に理由を書く。'
        + 'ids でその物だけ、except でその物を除いて替える。',
      inputSchema: obj({
        set: str('差し替え先のセットの id か名前（使えるセットの一覧を見る）'),
        ids: { type: 'array', items: ID, description: '替える物の id の配列。省くと置いてある家具の全部' },
        except: { type: 'array', items: ID, description: '替えない物の id の配列' }
      }, ['set'])
    },
    {
      name: 'setAppearance',
      description: '内観（壁紙）・外観（外壁）・屋根の色と素材を、家全体か階ごとに変える（画面の「内観／外観／屋根カラー設定」と同じ）。'
        + 'floor を省くと家全体の設定を書き、家全体の設定が効く（階ごとの設定より優先される）。'
        + 'floor を渡すと家全体の設定が切れ、各階はそれぞれの階の設定（無ければ既定）になる。壁ごと・面ごとには変えられない。',
      inputSchema: obj({
        part: str('interior（壁紙）/ exterior（外壁）/ roof（屋根）'),
        floor: int('階（1〜4）。省くと家全体'),
        color: str('"#rrggbb"'),
        texture: str('素材（素材の一覧を見る）。"" で外して色だけにする'),
        sheen: str('屋根の質感（屋根だけ）')
      }, ['part'])
    },
    {
      name: 'applyBuildingStyle',
      description: '外壁・屋根・内壁・床・扉・窓を、セットの様式（洋館・古民家など）にまとめて切り替える（画面の「建物の仕上げを替える」と同じ）。'
        + '部屋の名前で水まわりの床・壁を替え、開き戸・玄関ドア・窓をその様式の物にする。開口の大きさは変えない。面や壁ごとの色・素材は外れる。',
      inputSchema: obj({
        set: str('様式のセットの id か名前'),
        parts: { type: 'array', items: str('exterior / roof / interior / floor / doors / windows'), description: '切り替える部位。省くと全部' }
      }, ['set'])
    }
  ];

  // どの道具にも付ける約束。1回の applyOperations は全部か無し。
  var COMMON = 'ロックされた物は変えられない。無い id は使えない。失敗すると、同じ呼び出しの操作は全部取り消され、プランは変わらない。';

  // ── 引数の検査 ─────────────────────────────────────────────────────
  // Schema から機械的に判定する(操作ごとの手書きはしない)。使っている形は
  // type・properties・required・items・additionalProperties・maxLength だけなので、それだけを見る。
  // maxLength は文字(コードポイント)の数で比べる(絵文字1つを1字と数える)。
  function typeName(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return '配列';
    return typeof v;
  }
  function typeOk(type, v, schema) {
    if (Array.isArray(type)) return type.some(function (t) { return typeOk(t, v, schema); });
    switch (type) {
      case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
      case 'array': return Array.isArray(v);
      case 'string': return typeof v === 'string' || (schema === ID && typeof v === 'number' && isFinite(v));
      case 'number': return typeof v === 'number' && isFinite(v);
      case 'integer': return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
      case 'boolean': return typeof v === 'boolean';
      default: return true;
    }
  }
  var TYPE_JA = { object: '{…} の形', array: '配列', string: '文字', number: '数', integer: '整数', boolean: 'true か false' };
  function checkValue(schema, v, at, errors) {
    if (!typeOk(schema.type, v, schema)) {
      var want = [].concat(schema.type).map(function (t) { return TYPE_JA[t] || t; }).join('か');
      errors.push(at + ' は' + want + 'で渡してください（' + typeName(v) + ' が来ました）');
      return;
    }
    if (schema.type === 'object' && schema.properties) {
      (schema.required || []).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) errors.push(at + '.' + k + ' がありません');
      });
      Object.keys(v).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, k)) {
          if (schema.additionalProperties === false) {
            errors.push(at + '.' + k + ' は使えない引数です（使える引数: ' + Object.keys(schema.properties).join(', ') + '）');
          }
          return;
        }
        checkValue(schema.properties[k], v[k], at + '.' + k, errors);
      });
    }
    if (schema.type === 'array' && schema.items) {
      v.forEach(function (x, i) { checkValue(schema.items, x, at + '[' + i + ']', errors); });
    }
    if (typeof v === 'string' && typeof schema.maxLength === 'number') {
      var len = Array.from(v).length;
      if (len > schema.maxLength) errors.push(at + ' は ' + schema.maxLength + ' 字までにしてください（' + len + ' 字が来ました）');
    }
  }
  function checkArgs(name, args) {
    var op = null;
    for (var i = 0; i < OPERATIONS.length; i++) if (OPERATIONS[i].name === name) op = OPERATIONS[i];
    if (!op) {
      return { ok: false, errors: ['知らない操作です: ' + String(name) + '（使える操作: ' + OPERATIONS.map(function (o) { return o.name; }).join(', ') + '）'] };
    }
    var errors = [];
    checkValue(op.inputSchema, args === undefined ? {} : args, 'args', errors);
    return { ok: errors.length === 0, errors: errors };
  }

  // ── 語彙(deps から作る)─────────────────────────────────────────────
  // 家具・設備の分類のうち、placeItem の type に出さないもの。
  //   fence: アプリの種類名 fence(ブロック塀)と同じ綴りで取り違えるため。フェンスは wood-fence で置く。
  //   other: 何にも当たらない受け皿。
  //   kitchen-unit: 調理台は部品の台を並べて作る物で、1つの物としては置けない(画面のチャットの ctx も Worker の ctx も断る)。
  //     一覧には載せず、作り方の文(KITCHEN_UNIT_LINE)だけを書く。2026-11-20 まで載っていて、置こうとすると断られていた。
  var SKIP_KINDS = { fence: true, other: true, 'kitchen-unit': true };
  var KITCHEN_UNIT_LINE = '  調理台（kitchen-unit）は1つの物としては置けない。流し（kitchen-sink）・コンロ（cooktop）・'
    + '引出しの台（original-kitchen-box-drawer600 など。幅は 450・600・750・900）を横に並べて作る。';
  var STAIRS = [
    { type: 'stair', ja: '階段の直進部', what: 'w は幅、d は上る方向の長さ' },
    { type: 'stair-corner', ja: '階段の曲がる部分', what: 'w・d は一辺' },
    { type: 'stair-landing', ja: '階段の踊り場', what: '平らな床の段。w・d は一辺' }
  ];
  // 組み込みの種類のうち、PlanSettable の表(窓・扉・外構・敷地)と家具・設備の分類のどちらにも無い物。
  // 画面の道具で人が置ける物は、AI にも置けるよう一覧に載せる(載せない物は下の UNLISTED に理由を書く)。
  // tools/tests/plan-vocabulary-match.test.cjs が、画面の道具と突き合わせる。
  var BUILTINS = [
    { group: '構造', type: 'foundation', ja: '基礎', what: '建物の下の基礎。1階の外壁の外周に合わせた長方形で置く。w は東西、d は南北の長さ' },
    { group: '構造', type: 'column', ja: '柱（角）', what: 'w・d は断面' },
    { group: '構造', type: 'column-round', ja: '柱（丸）', what: 'w は直径' },
    { group: '外まわりの設備', type: 'sewer-pit', ja: '桝', what: '汚水・雨水の点検口。地面に置く' },
    { group: '外まわりの設備', type: 'downspout', ja: '縦樋', what: '雨樋の縦の管。外壁の角の外側に置く' },
    { group: '敷地のまわり', type: 'road', ja: '道路', what: '敷地の外の道路。w は長さ、d は幅' },
    { group: '敷地のまわり', type: 'utility-pole', ja: '電柱', what: '' },
    { group: '敷地のまわり', type: 'neighbor-house', ja: '隣の家', what: '敷地の外の建物' },
    { group: '敷地のまわり', type: 'neighbor-building', ja: '隣のビル', what: '敷地の外の建物' }
  ];
  // 画面の道具で人が置けて、AI の ctx も受け付けるが、一覧に載せない種類と、その理由。
  var UNLISTED = {
    roof: '屋根は addRoof でかける(形・勾配・向きを渡せる)',
    'custom-block': '利用者が形と寸法を決める任意の箱で、形を渡す欄が無い',
    memo: '図面への書き込みで、建物の物ではない',
    washer: '古い種類名。洗濯機は分類 laundry で置く',
    'futon_set': '古い種類名。布団は分類 bedding で置く',
    tree: '古い種類名。庭木は分類 garden-plant で置く',
    'bicycle-fold': '自転車は bicycle で置く',
    'shelf-built-in': '造作棚は分類 shelf で置く',
    'light-ceiling': '照明は分類 light で置く',
    'light-down': '照明は分類 light で置く',
    'light-spot': '照明は分類 light で置く',
    'ac-outdoor': '室外機は分類 utility-equipment で置く',
    'water-heater': '給湯器は分類 utility-equipment で置く',
    'gas-heater': '給湯器は分類 utility-equipment で置く',
    'meter-box': 'メーターは分類 utility-equipment で置く'
  };

  function knowledgeKinds(knowledge) {
    var K = (knowledge && knowledge.KNOWLEDGE) || {};
    return Object.keys(K).filter(function (k) { return !SKIP_KINDS[k]; });
  }
  // 外構・敷地(placeItem の type はアプリの種類名)。区画(site-zone)は物ではないので置けない。
  function exteriorTypes(settable) {
    var seen = {};
    return (settable.EXTERIOR || []).concat(settable.SITE || []).filter(function (e) {
      if (e.kind === 'site-zone' || seen[e.type]) return false;
      seen[e.type] = true;
      return true;
    });
  }
  // 読み取りの説明(what)の face は読み取りの答えの欄で、操作には無い。その節を外す。
  function stripFace(what) {
    return String(what || '').split(/[、。]/).filter(function (s) { return s && s.indexOf('face') < 0; }).join('、');
  }
  // set の対象(PlanSettable の for は読み取りの kind)を、placeItem の type(アプリの種類名)に直す。
  function forToTypes(part, list, settable) {
    if (!list) return null;
    if (part !== 'object') return list;
    var all = (settable.EXTERIOR || []).concat(settable.SITE || []);
    var out = [];
    list.forEach(function (kind) {
      if (kind === 'site-zone') return;
      for (var i = 0; i < all.length; i++) {
        if (all[i].kind === kind) { if (out.indexOf(all[i].type) < 0) out.push(all[i].type); return; }
      }
    });
    return out;
  }
  var PART_JA = { wall: '壁', room: '部屋', opening: '窓・扉', stair: '階段（stair・stair-corner）', object: '外構・敷地',
    furniture: '家具（部位のある物）' };
  // 部位ごとの項目の説明(describeVocabulary の家具の見出しの次の行)。
  var FURNITURE_NOTE = '  部位（wood・metal・fabric など）は物ごとに違う。合わない部位を渡すと、使える部位が errors の候補に返る。';

  // 編集(チャット・MCP)への説明なので、選択肢は編集だけの選択肢(editChoices。土間をやめる normal など)も書く。
  // 読み取りの説明(PlanSettable.describe)には editChoices を出さない。
  function choiceText(c) { return (c[0] === '' ? '""' : c[0]) + '=' + c[1]; }
  function channelRange(s, settable) {
    if (s.channelMap === 'color') return '{部位: "#rrggbb"}（"" で既定の色）';
    if (s.channelMap === 'texture') {
      return '{部位: 値}。値は ' + (settable.MODEL_FINISH_TEXTURES || []).map(choiceText).join(' / ')
        + '。部位 roof は ' + (settable.MODEL_ROOF_FINISH_TEXTURES || []).map(choiceText).join(' / ');
    }
    return '{部位: 値}。値は ' + (settable.FINISH_ROUGHNESS || []).map(choiceText).join(' / ');
  }
  function settingLine(part, s, settable) {
    var range = s.num ? s.num[0] + '〜' + s.num[1] : s.text ? '文字' : s.color ? '"#rrggbb"' + (s.clearable ? '（"" で既定に戻す）' : '')
      : s.channelMap ? channelRange(s, settable)
      : s.choices.concat(s.editChoices || []).map(choiceText).join(' / ');
    var targets = forToTypes(part, s.for, settable);
    var to = targets === null ? '' : targets.length ? '　対象: ' + targets.join(', ') : '　対象なし（今は set では変えられない）';
    return '  ' + s.key + '（' + s.ja + '）: ' + range + to;
  }

  function describeVocabulary(deps) {
    deps = deps || {};
    var settable = deps.settable || {};
    var K = (deps.knowledge && deps.knowledge.KNOWLEDGE) || {};
    var rows = [
      '## house-planner の操作の約束',
      '',
      '座標は mm。x は東（右）へ、y は南（下）へ増える。図の上が北。すべての階で同じ原点を使う。',
      '物と部屋の位置 x,y は中心で渡す。壁は芯の線分 x1,y1,x2,y2 で渡す。',
      '回転 rot は度で、図の上を北として時計回り。カタログの家具は rot=0 で正面が南を向き、階段（stair）は rot=0 で南（+y）へ上る。',
      '操作が1つでも失敗すると、同じ呼び出しの操作は全部取り消され、プランは変わらない。errors に理由と、分かれば候補（candidates）が返る。',
      '階は 1〜4。桁（mm）を間違えたらしい値（寸法 50mm 未満・100,000mm 超、座標 100,000mm 超）は、通したうえで warnings で知らせる。',
      'id はプランの要約にある id をそのまま使う。数の id は "12" のように文字で渡す。消した物の id は使えない。',
      '部屋は床の範囲の長方形で、部屋を動かしても大きさを変えても、中の物と壁は動かない。',
      'ロックされた物は変えられない。',
      '',
      '## 置ける物の種類（placeItem の type）',
      '- 窓・扉（中心を壁の芯の上に置く。placeItem では吊元と開く向きは指定できないので、部屋の壁に付けるときは placeOpening を使う）:'
    ];
    (settable.OPENINGS || []).forEach(function (o) { rows.push('  ' + o.type + ' = ' + o.ja + '（' + o.what + '）'); });
    rows.push('- 階段:');
    STAIRS.forEach(function (s) { rows.push('  ' + s.type + ' = ' + s.ja + '（' + s.what + '）'); });
    rows.push('- 外構・敷地:');
    exteriorTypes(settable).forEach(function (e) {
      var what = stripFace(e.what);
      rows.push('  ' + e.type + ' = ' + e.ja + (what ? '（' + what + '）' : ''));
    });
    var group = null;
    BUILTINS.forEach(function (b) {
      if (b.group !== group) { group = b.group; rows.push('- ' + group + ':'); }
      rows.push('  ' + b.type + ' = ' + b.ja + (b.what ? '（' + b.what + '）' : ''));
    });
    rows.push('- 家具・設備（分類名）:');
    rows.push('  ' + knowledgeKinds(deps.knowledge).map(function (k) {
      var size = K[k] && K[k].size && K[k].size.what ? '（例 ' + K[k].size.what + '）' : '';
      return k + size;
    }).join(', '));
    rows.push(KITCHEN_UNIT_LINE);
    rows.push('');
    rows.push('## set に書ける項目（setProps と placeItem の set。{項目: 値} の形）');
    rows.push('ここに無い種類（照明・部位の無い家具など）は set を受け付けない。');
    Object.keys(settable.SETTINGS || {}).forEach(function (part) {
      rows.push('- ' + (PART_JA[part] || part) + ':');
      if (part === 'furniture') rows.push(FURNITURE_NOTE);
      settable.SETTINGS[part].forEach(function (s) { rows.push(settingLine(part, s, settable)); });
    });
    var sets = assetSetsOf(deps, 'swap');
    if (sets.length) {
      rows.push('');
      rows.push('## 家具を差し替えられるセット（swapAssetSet の set）');
      sets.forEach(function (s) { rows.push('  ' + s.id + ' = ' + s.name); });
    }
    var styles = assetSetsOf(deps, 'style');
    if (styles.length) {
      rows.push('');
      rows.push('## 建物の様式（applyBuildingStyle の set）');
      styles.forEach(function (s) { rows.push('  ' + s.id + ' = ' + s.name); });
    }
    var tex = settable.APPEARANCE_TEXTURES;
    if (tex) {
      rows.push('');
      rows.push('## 内観・外観・屋根の素材（setAppearance の texture。"" で素材を外す）');
      ['interior', 'exterior', 'roof'].forEach(function (part) {
        rows.push('- ' + part + ': ' + (tex[part] || []).map(function (c) { return c[0] + '=' + c[1]; }).join(' / '));
      });
      if (settable.ROOF_SHEEN_OPTIONS) rows.push('- 屋根の質感（sheen）: ' + settable.ROOF_SHEEN_OPTIONS.map(choiceText).join(' / '));
    }
    return rows.join('\n');
  }
  // 差し替えの設定を持つセット [{id, name}](deps.assetSets。worker/chat.mjs・mcp.mjs が worker-furniture.json の sets を渡す)。
  // field を渡すと、その設定(swap=一括差し替え、style=建物の様式)を持つセットだけ。
  function assetSetsOf(deps, field) {
    return ((deps && deps.assetSets) || []).filter(function (s) { return s && s.id && (!field || s[field]); }).map(function (s) { return { id: s.id, name: s.name }; });
  }

  // 道具の説明に付ける短い一覧(名前だけ)。範囲・選択肢・寸法の例は describeVocabulary に書き、
  // システムプロンプト(MCP では get_plan などの返事)で渡す。
  function shortVocabulary(name, deps) {
    var settable = deps && deps.settable;
    if (!settable) return '';
    if (name === 'placeItem') {
      var types = builtinTypes(settable);
      var kinds = knowledgeKinds(deps.knowledge);
      return '\n種類: ' + types.join(', ') + (kinds.length ? '\n家具・設備の分類: ' + kinds.join(', ') : '');
    }
    if (name === 'swapAssetSet' || name === 'applyBuildingStyle') {
      var sets = assetSetsOf(deps, name === 'swapAssetSet' ? 'swap' : 'style');
      return sets.length ? '\nセット: ' + sets.map(function (s) { return s.id + '（' + s.name + '）'; }).join(', ') : '';
    }
    if (name === 'setProps') {
      return '\n項目: ' + Object.keys(settable.SETTINGS || {}).map(function (part) {
        // 対象が残らない項目（区画の name）は、ここでは挙げない。
        var keys = settable.SETTINGS[part].filter(function (s) {
          var t = forToTypes(part, s.for, settable);
          return t === null || t.length > 0;
        }).map(function (s) { return s.key; });
        return (PART_JA[part] || part) + ' ' + keys.join(', ');
      }).join(' / ');
    }
    return '';
  }

  // 一覧に載せる組み込みの種類(窓・扉 → 階段 → 外構・敷地 → BUILTINS の順)。
  function builtinTypes(settable) {
    return (settable.OPENINGS || []).map(function (o) { return o.type; })
      .concat(STAIRS.map(function (s) { return s.type; }))
      .concat(exteriorTypes(settable).map(function (e) { return e.type; }))
      .concat(BUILTINS.map(function (b) { return b.type; }));
  }
  // AI に見せる「置ける物の種類」の全部(組み込みの種類と、家具・設備の分類名)。検査が受け付ける側と突き合わせる。
  function listedTypes(deps) {
    deps = deps || {};
    return builtinTypes(deps.settable || {}).concat(knowledgeKinds(deps.knowledge));
  }

  function toolDescription(op, deps) {
    return op.description + COMMON + shortVocabulary(op.name, deps);
  }

  function toClaudeTools(deps) {
    return OPERATIONS.map(function (op) {
      return { name: op.name, description: toolDescription(op, deps), input_schema: op.inputSchema };
    });
  }

  function toMcpTools(deps) {
    return OPERATIONS.map(function (op) {
      return { name: op.name, description: toolDescription(op, deps), inputSchema: op.inputSchema };
    });
  }

  return {
    OPERATIONS: OPERATIONS,
    checkArgs: checkArgs,
    toClaudeTools: toClaudeTools,
    toMcpTools: toMcpTools,
    describeVocabulary: describeVocabulary,
    listedTypes: listedTypes,
    UNLISTED: UNLISTED
  };
}));
