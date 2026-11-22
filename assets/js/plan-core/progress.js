// 家づくりの段階(敷地 → 基礎 → 床 → 壁 → 屋根 → ドア・窓・住設 → 家財)の出来具合を、プランから数える。
// 画面にも Worker にも依存しない。
//
// なぜ在るのか
// ------------
// 利用者は運営者の想定の順で頼むとは限らない(白紙で「ソファを置いて」、壁の無いプランで「窓を付けて」)。
// AI が今どこまで出来ているかを分かったうえで返事できるよう、チャットの要約(<plan_summary>)に段階ごとの数を入れる。
// 外の AI 向けの点検(inspect_plan)にも、ここで分かる「足りない所」を指摘として入れる。
//
// 決めごと: 推測で埋めない。数えられるものだけを数える。
//   - 壁で囲まれていない部屋: 壁の無い所(OPEN_MIN 以上)でつながる部屋を1つの空間とし、空間の外周のうち同じ階の壁
//     (同じ線の上。距離 LINE_TOL 以内)が覆う長さが半分に満たない空間の部屋。LDK とリビングのように壁なしで
//     つながる部屋は、空間として囲まれていれば数えない(壁を作り忘れた部屋だけを拾うため)
//   - 外に出る扉: 1階の部屋の辺のうち、ほかの部屋と接しない(外に面した)所に載っている扉(種類が door- で始まる物)
//   - 窓の無い居室: 名前が居室らしい部屋(LIVING_RE。名前で決めるので、要約にもそう書く)で、外に面した辺に窓(window で始まる物)が無いもの
//   - 屋根: 壁のあるいちばん上の階の上(屋根の物の floor がその階+1)に屋根があるか
//   - 住設・家具: 物の分類(opts.kindOf。画面は CATALOGUE_TAGS、Worker は tags.json)が引けるときだけ数える。引けなければ書かない
//
//   PlanCoreProgress.stageProgress(plan, {kindOf}) → 数えた値(下の形)
//   PlanCoreProgress.progressLines(progress)       → 要約に入れる行の配列
//   PlanCoreProgress.progressIssues(progress)      → 点検(inspect_plan)の指摘の文の配列
//   PlanCoreProgress.nextStage(progress)           → 次に勧める段階の名前(完成に近ければ null)
//   PlanCoreProgress.missingStages(progress)       → まだ無い段階の名前の配列
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanCoreProgress = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  var LINE_TOL = 150;          // 壁の芯・窓・扉の中心が部屋の辺から離れていてよい距離(mm)。壁の厚みの半分より広め
  var WALLED_RATIO = 0.5;      // 外周の半分以上を壁が覆えば「囲まれている」
  // 居室とみなす名前(建築基準法の居室のうち、名前で分かるもの)。収納・廊下などは除く。
  var LIVING_RE = /LDK|ＬＤＫ|リビング|ダイニング|居間|洋室|和室|寝室|子ども|子供|こども|書斎|個室/;
  var NOT_LIVING_RE = /収納|クローゼット|納戸|WIC|ＷＩＣ|廊下|ホール|物入/;
  var FIXTURE_KINDS = {
    toilet: ['toilet'],
    bath: ['bathtub', 'shower'],
    kitchen: ['kitchen-sink', 'cooktop', 'kitchen-unit'],
    vanity: ['vanity']
  };
  var FIXTURE_JA = { toilet: 'トイレ', bath: '浴室（浴槽・シャワー）', kitchen: 'キッチン（流し・コンロ）', vanity: '洗面台' };
  var FURNITURE_KINDS = ['sofa', 'tv', 'chair', 'dining-table', 'low-table', 'desk', 'counter-table', 'table-set', 'bed', 'bedding',
    'closet', 'cabinet', 'chest', 'shelf', 'curtain', 'roller-screen', 'rug', 'mirror', 'wall-decor', 'decor', 'plant', 'kids', 'pet'];

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function floorOf(o) { var f = Number(o && o.floor); return isFinite(f) && f >= 1 ? Math.floor(f) : 1; }
  function nameOf(r) { return String((r && (r.n || r.name)) || ''); }
  function center(o) { return { x: num(o.x) + num(o.w) / 2, y: num(o.y) + num(o.d) / 2 }; }
  function roomEdges(r) {
    var x = num(r.x), y = num(r.y), w = num(r.w), d = num(r.d);
    return [
      { axis: 'h', c: y, a: x, b: x + w }, { axis: 'h', c: y + d, a: x, b: x + w },
      { axis: 'v', c: x, a: y, b: y + d }, { axis: 'v', c: x + w, a: y, b: y + d }
    ];
  }
  // 区間の並びの、[a,b] の中での合計の長さ(重なりは1回だけ数える)。
  function coveredLength(a, b, parts) {
    var list = parts.map(function (p) { return [Math.max(a, p[0]), Math.min(b, p[1])]; })
      .filter(function (p) { return p[1] > p[0]; }).sort(function (p, q) { return p[0] - q[0]; });
    var total = 0, end = -Infinity;
    list.forEach(function (p) {
      if (p[1] <= end) return;
      total += p[1] - Math.max(p[0], end);
      end = p[1];
    });
    return total;
  }
  // 辺 e に沿って、軸に沿う壁が覆う区間。
  function wallParts(walls, floor, e) {
    var out = [];
    walls.forEach(function (w) {
      if (floorOf(w) !== floor) return;
      var x1 = num(w.x1), y1 = num(w.y1), x2 = num(w.x2), y2 = num(w.y2);
      if (e.axis === 'h' && Math.abs(y1 - y2) < 1 && Math.abs(y1 - e.c) <= LINE_TOL) out.push([Math.min(x1, x2), Math.max(x1, x2)]);
      if (e.axis === 'v' && Math.abs(x1 - x2) < 1 && Math.abs(x1 - e.c) <= LINE_TOL) out.push([Math.min(y1, y2), Math.max(y1, y2)]);
    });
    return out;
  }
  // 辺 e のうち、同じ階のほかの部屋の辺と重なる区間。
  function sharedParts(rooms, room, e) {
    var out = [];
    rooms.forEach(function (o) {
      if (o === room || floorOf(o) !== floorOf(room)) return;
      roomEdges(o).forEach(function (f) {
        if (f.axis === e.axis && Math.abs(f.c - e.c) <= 1) out.push([f.a, f.b]);
      });
    });
    return out;
  }
  function inside(v, parts) { return parts.some(function (p) { return v > p[0] && v < p[1]; }); }
  // 物の中心が、部屋の外に面した辺の上にあるか。
  function onOutsideEdge(rooms, room, it) {
    var c = center(it);
    return roomEdges(room).some(function (e) {
      var along = e.axis === 'h' ? c.x : c.y, across = e.axis === 'h' ? c.y : c.x;
      if (Math.abs(across - e.c) > LINE_TOL || along < e.a || along > e.b) return false;
      return !inside(along, sharedParts(rooms, room, e));
    });
  }
  // 壁の無い所(OPEN_MIN 以上)でつながっている部屋をまとめる(LDK・リビング・キッチンのように、名前は違っても1つの空間)。
  var OPEN_MIN = 300;
  function openTo(a, b, walls) {
    if (floorOf(a) !== floorOf(b)) return false;
    return roomEdges(a).some(function (e) {
      return roomEdges(b).some(function (f) {
        if (f.axis !== e.axis || Math.abs(f.c - e.c) > 1) return false;
        var lo = Math.max(e.a, f.a), hi = Math.min(e.b, f.b);
        if (hi - lo <= OPEN_MIN) return false;
        return (hi - lo) - coveredLength(lo, hi, wallParts(walls, floorOf(a), e)) > OPEN_MIN;
      });
    });
  }
  function openGroups(rooms, walls) {
    var group = rooms.map(function (r, i) { return i; });
    var top = function (i) { while (group[i] !== i) i = group[i] = group[group[i]]; return i; };
    for (var i = 0; i < rooms.length; i++) {
      for (var j = i + 1; j < rooms.length; j++) {
        if (top(i) !== top(j) && openTo(rooms[i], rooms[j], walls)) group[top(j)] = top(i);
      }
    }
    return function (r) { var k = top(rooms.indexOf(r)); return rooms.filter(function (o, idx) { return top(idx) === k; }); };
  }
  function isLiving(r) { var n = nameOf(r); return LIVING_RE.test(n) && !NOT_LIVING_RE.test(n); }

  function stageProgress(plan, opts) {
    plan = plan || {};
    opts = opts || {};
    var rooms = (plan.rooms || []).filter(Boolean);
    var walls = (plan.walls || []).filter(Boolean);
    var items = (plan.items || []).filter(Boolean);
    var countType = function (t) { return items.filter(function (it) { return it.type === t; }).length; };
    var perFloor = {};
    rooms.forEach(function (r) { perFloor[floorOf(r)] = (perFloor[floorOf(r)] || 0) + 1; });
    var wallFloors = {};
    walls.forEach(function (w) { wallFloors[floorOf(w)] = true; });
    var topFloor = Object.keys(wallFloors).length ? Math.max.apply(null, Object.keys(wallFloors).map(Number)) : null;

    // 壁で囲まれていない部屋: 壁の無い所でつながる部屋の空間ごとに、空間の外周(空間の中の部屋どうしが接する辺を除く)の
    // 半分以上を壁が覆っていなければ、その空間の部屋をすべて数える。LDK とリビングのように壁なしでつながる部屋は
    // 1つの空間として見る(どちらも単独では外周が開いているが、空間としては囲まれている)。
    var spaceOf = openGroups(rooms, walls);
    var unwalled = [], judged = [];
    rooms.forEach(function (r) {
      var g = spaceOf(r);
      if (judged.indexOf(g[0]) >= 0) return;
      judged.push(g[0]);
      var perimeter = 0, covered = 0;
      g.forEach(function (m) {
        roomEdges(m).forEach(function (e) {
          var inner = [];
          g.forEach(function (o) {
            if (o === m) return;
            roomEdges(o).forEach(function (f) { if (f.axis === e.axis && Math.abs(f.c - e.c) <= 1) inner.push([f.a, f.b]); });
          });
          var walled = wallParts(walls, floorOf(m), e);
          // 空間の外周 = 辺から、空間の中のほかの部屋と接する区間を除いた残り
          var rest = [[e.a, e.b]];
          inner.forEach(function (c) {
            var next = [];
            rest.forEach(function (pp) {
              if (c[1] <= pp[0] || c[0] >= pp[1]) { next.push(pp); return; }
              if (c[0] > pp[0]) next.push([pp[0], c[0]]);
              if (c[1] < pp[1]) next.push([c[1], pp[1]]);
            });
            rest = next;
          });
          rest.forEach(function (pp) { perimeter += pp[1] - pp[0]; covered += coveredLength(pp[0], pp[1], walled); });
        });
      });
      if (perimeter > 0 && covered / perimeter < WALLED_RATIO) {
        g.forEach(function (m) { unwalled.push({ id: m.id, name: nameOf(m), floor: floorOf(m) }); });
      }
    });

    var firstRooms = rooms.filter(function (r) { return floorOf(r) === 1; });
    var doors = items.filter(function (it) { return floorOf(it) === 1 && /^door-/.test(String(it.type)); });
    var exteriorDoors = firstRooms.length
      ? doors.filter(function (it) { return firstRooms.some(function (r) { return onOutsideEdge(rooms, r, it); }); }).length
      : null;

    var windows = items.filter(function (it) { return /^window/.test(String(it.type)); });
    // L字の LDK のように、壁の無い所でつながる部屋は1つの空間として見る(どれかの外に面した辺に窓があればよい)。
    // 同じ空間の居室は1回だけ数える。
    var living = [], seen = [];
    rooms.filter(isLiving).forEach(function (r) {
      var g = spaceOf(r);
      if (seen.indexOf(g[0]) >= 0) return;
      seen.push(g[0]);
      living.push({ room: r, space: g });
    });
    var windowless = living.filter(function (l) {
      return !l.space.some(function (r) { return windows.some(function (it) { return floorOf(it) === floorOf(r) && onOutsideEdge(rooms, r, it); }); });
    }).map(function (l) { return { id: l.room.id, name: nameOf(l.room), floor: floorOf(l.room) }; });

    var roofs = items.filter(function (it) { return it.type === 'roof'; });
    var roofOverTop = topFloor === null ? null : roofs.some(function (it) { return floorOf(it) === topFloor + 1; });

    var fixtures = null, furniture = null;
    if (typeof opts.kindOf === 'function') {
      var kinds = items.map(function (it) { try { return opts.kindOf(it.type) || null; } catch (e) { return null; } });
      fixtures = {};
      Object.keys(FIXTURE_KINDS).forEach(function (k) {
        fixtures[k] = kinds.filter(function (kd) { return kd && FIXTURE_KINDS[k].indexOf(kd) >= 0; }).length;
      });
      furniture = kinds.filter(function (kd) { return kd && FURNITURE_KINDS.indexOf(kd) >= 0; }).length;
    }

    return {
      site: countType('site-rect'), foundation: countType('foundation'),
      rooms: rooms.length, roomsPerFloor: perFloor, walls: walls.length, topFloor: topFloor,
      unwalled: unwalled, roofs: roofs.length, roofOverTop: roofOverTop,
      exteriorDoors: exteriorDoors, windows: windows.length, livingRooms: living.length, windowless: windowless,
      fixtures: fixtures, furniture: furniture
    };
  }

  function roomList(list) {
    return list.slice(0, 8).map(function (r) { return '「' + (r.name || '名前なし') + '」(id=' + r.id + '、' + r.floor + '階)'; }).join('、')
      + (list.length > 8 ? ' ほか ' + (list.length - 8) + ' 部屋' : '');
  }

  // 段階ごとに出来ているか(運営者の想定の順)。null は数えられない(分類が引けない)。
  function stageDone(p) {
    return [
      ['敷地', p.site > 0],
      ['基礎', p.foundation > 0],
      ['床（部屋）', p.rooms > 0],
      ['壁', p.walls > 0 && !p.unwalled.length],
      ['屋根', p.roofOverTop === true],
      ['ドア・窓', p.exteriorDoors > 0 && !p.windowless.length],
      ['住設', p.fixtures ? !!(p.fixtures.toilet && p.fixtures.bath && p.fixtures.kitchen && p.fixtures.vanity) : null],
      ['家財（家具）', p.furniture === null ? null : p.furniture > 0]
    ];
  }
  // まだ無い段階(数えられない段階は入れない)。
  function missingStages(p) {
    return stageDone(p).filter(function (s) { return s[1] === false; }).map(function (s) { return s[0]; });
  }
  // 次に勧める段階: 出来ているいちばん先の段階より後で、まだ無い最初の段階。後に無ければ、前に抜けた最初の段階。
  // (敷地を作らずに壁まで作った人に、敷地へ戻るより屋根を勧める。抜けた段階は missingStages で別に書く)
  // 全部あれば null。
  function nextStage(p) {
    var st = stageDone(p), last = -1;
    st.forEach(function (s, i) { if (s[1] === true) last = i; });
    for (var i = last + 1; i < st.length; i++) if (st[i][1] === false) return st[i][0];
    var miss = missingStages(p);
    return miss.length ? miss[0] : null;
  }

  function progressLines(p) {
    var floors = Object.keys(p.roomsPerFloor).map(Number).sort(function (a, b) { return a - b; });
    var lines = [
      '進み具合（プランから数えた値）:',
      '- 敷地 ' + p.site + '・基礎 ' + p.foundation,
      '- 部屋 ' + p.rooms + (floors.length ? '（' + floors.map(function (f) { return f + '階 ' + p.roomsPerFloor[f]; }).join('・') + '）' : '')
        + '・壁 ' + p.walls + '・壁で囲まれていない部屋 ' + p.unwalled.length + (p.unwalled.length ? '：' + roomList(p.unwalled) : ''),
      '- 屋根 ' + p.roofs + (p.topFloor === null ? '（壁が無いので、屋根が要るかはまだ決まらない）' : (p.roofOverTop ? '（' + p.topFloor + '階の上に屋根あり）' : '（' + p.topFloor + '階の上に屋根なし）')),
      '- 外に出る扉 ' + (p.exteriorDoors === null ? '（1階に部屋が無いので数えない）' : p.exteriorDoors)
        + '・窓 ' + p.windows + '・窓の無い居室（名前で居室と判定）' + p.windowless.length + (p.windowless.length ? '：' + roomList(p.windowless) : '')
    ];
    if (p.fixtures) {
      lines.push('- 住設 ' + Object.keys(FIXTURE_KINDS).map(function (k) { return FIXTURE_JA[k] + ' ' + p.fixtures[k]; }).join('・'));
      lines.push('- 家具 ' + p.furniture);
    }
    var next = nextStage(p);
    var miss = missingStages(p);
    lines.push('- 次の段階の目安: ' + (next || 'なし（家具まである）'));
    if (miss.length) lines.push('- まだ無い段階: ' + miss.join('・'));
    return lines;
  }

  function progressIssues(p) {
    var out = [];
    p.unwalled.forEach(function (r) {
      out.push('部屋「' + (r.name || '名前なし') + '」(id=' + r.id + '、' + r.floor + '階)は、まわりの半分以上に壁がありません（壁で囲まれていません）');
    });
    if (p.exteriorDoors === 0 && p.walls > 0) out.push('1階に外へ出る扉（玄関ドアなど）がありません');
    if (p.roofOverTop === false) out.push(p.topFloor + '階の上に屋根がありません');
    p.windowless.forEach(function (r) {
      out.push('居室「' + (r.name || '名前なし') + '」(id=' + r.id + '、' + r.floor + '階)に、外に面した窓がありません');
    });
    return out;
  }

  return { stageProgress: stageProgress, progressLines: progressLines, progressIssues: progressIssues, nextStage: nextStage, missingStages: missingStages, LIVING_RE: LIVING_RE };
}));
