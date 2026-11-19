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
      description: '物・壁・部屋の設定を変える。set に書ける項目は物の種類で決まり、カタログの家具・照明など set を受け付けない種類もある。'
        + '範囲の外の数は端に寄せて warnings に書く。',
      inputSchema: obj({ id: ID, set: SET }, ['id', 'set'])
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
  var SKIP_KINDS = { fence: true, other: true };
  var STAIRS = [
    { type: 'stair', ja: '階段の直進部', what: 'w は幅、d は上る方向の長さ' },
    { type: 'stair-corner', ja: '階段の曲がる部分', what: 'w・d は一辺' }
  ];

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
  var PART_JA = { wall: '壁', room: '部屋', opening: '窓・扉', stair: '階段（stair・stair-corner）', object: '外構・敷地' };

  function settingLine(part, s, settable) {
    var range = s.num ? s.num[0] + '〜' + s.num[1] : s.text ? '文字' : s.choices.map(function (c) { return c[0] + '=' + c[1]; }).join(' / ');
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
      '- 窓・扉（中心を壁の芯の上に置く。吊元と開く向きは指定できない）:'
    ];
    (settable.OPENINGS || []).forEach(function (o) { rows.push('  ' + o.type + ' = ' + o.ja + '（' + o.what + '）'); });
    rows.push('- 階段:');
    STAIRS.forEach(function (s) { rows.push('  ' + s.type + ' = ' + s.ja + '（' + s.what + '）'); });
    rows.push('- 外構・敷地:');
    exteriorTypes(settable).forEach(function (e) {
      var what = stripFace(e.what);
      rows.push('  ' + e.type + ' = ' + e.ja + (what ? '（' + what + '）' : ''));
    });
    rows.push('- 家具・設備（分類名）:');
    rows.push('  ' + knowledgeKinds(deps.knowledge).map(function (k) {
      var size = K[k] && K[k].size && K[k].size.what ? '（例 ' + K[k].size.what + '）' : '';
      return k + size;
    }).join(', '));
    rows.push('');
    rows.push('## set に書ける項目（setProps と placeItem の set。{項目: 値} の形）');
    rows.push('ここに無い種類（カタログの家具・設備、照明など）は set を受け付けない。');
    Object.keys(settable.SETTINGS || {}).forEach(function (part) {
      rows.push('- ' + (PART_JA[part] || part) + ':');
      settable.SETTINGS[part].forEach(function (s) { rows.push(settingLine(part, s, settable)); });
    });
    return rows.join('\n');
  }

  // 道具の説明に付ける短い一覧(名前だけ)。範囲・選択肢・寸法の例は describeVocabulary に書き、
  // システムプロンプト(MCP では get_plan などの返事)で渡す。
  function shortVocabulary(name, deps) {
    var settable = deps && deps.settable;
    if (!settable) return '';
    if (name === 'placeItem') {
      var types = (settable.OPENINGS || []).map(function (o) { return o.type; })
        .concat(STAIRS.map(function (s) { return s.type; }))
        .concat(exteriorTypes(settable).map(function (e) { return e.type; }));
      var kinds = knowledgeKinds(deps.knowledge);
      return '\n種類: ' + types.join(', ') + (kinds.length ? '\n家具・設備の分類: ' + kinds.join(', ') : '');
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
    describeVocabulary: describeVocabulary
  };
}));
