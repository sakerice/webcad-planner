// ウォークスルーで、階段を上り下りでき、階段から家の外へ抜けられないこと。
//
// なぜ要るか: 階段の上では、階段下の低い壁に引っかからないよう壁の当たり判定を外している。
// その結果、外壁に接した階段の端から外壁を越え、家の外の空中へ歩き出せた（報告された）。
// 直すときに当たり判定を強めると、今度は階段で引っかかって上れなくなりやすい。両方をここで見る。
//
//  1. 上り下り: 階段の部材を、入口 → 出口の順にたどって歩き、上の階まで上がれて、1階まで下りられる
//  2. 抜けない: 階段の上の点から8方向に歩き続けても、外壁の範囲の外へ出ない
//  3. 家の外では地面に立つ: 1階の外へ出るドアから外へ歩くと、足元が描いてある面（ポーチ・外階段・地面）に下り、
//     床の高さのまま浮かない（三人称で浮いて見えて報告された）。外から家の中へ戻れる
//  4. 階段の下は階段の上ではない: 階段の高い所の真下（階段下のトイレ・収納）を床の高さで歩いても、
//     壁にめり込まない（平面で階段の範囲に入っただけで「階段の上」とされ、壁を素通りしていた）
//  5. 上の階の壁に頭がかすっても上れる: 階段の途中の真上に上の階の壁があっても（上下に重ねた階段の、
//     頭上を空けるため床を上げた収納の壁など）、上りきれる（利用者のプランで3階へ上がれなかった）
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
// 画面の無いブラウザで Mac の GPU を使う（画面のあるブラウザは利用者の操作を奪う）
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  for (const preset of (process.env.PRESETS || '2f,3f').split(',')) {
    const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP + '?preset=' + preset);
    await page.waitForFunction(() => window.DATA && DATA.walls.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => setView('3d-walk'));
    await page.waitForFunction(() => window.ren && WALK.active, null, { timeout: 300000 });
    const r = await page.evaluate(() => {
      window.render3DNow = function () {};
      // 部材の局所座標(lx, ly) → 図面の座標(mm)。stairLocalProgress の逆
      function toPlan(it, lx, ly) {
        if (it.flipX) lx = -lx;
        if (it.flipY) ly = -ly;
        const r = (it.rot || 0) * Math.PI / 180, cx = it.x + it.w / 2, cy = it.y + it.d / 2;
        return [cx + lx * Math.cos(r) - ly * Math.sin(r), cy + lx * Math.sin(r) + ly * Math.cos(r)];
      }
      // 階をまたぐ階段の部材を、足元の低い順に並べ、入口と出口を道にする
      const parts = DATA.items.filter((i) => isStairPartType(i.type) && !isFloorLanding(i) && !stairGroupIsLevel(i))
        .map((it) => ({ it, base: stairUpperSpanM(it).baseY + stairRiseInfo(it).base }))
        .sort((a, b) => a.base - b.base);
      const path = [];
      parts.forEach(({ it }) => {
        if (it.type === 'stair-corner') { path.push(toPlan(it, 0, it.d / 2)); path.push(toPlan(it, it.w / 2, 0)); }
        else { path.push(toPlan(it, 0, -it.d / 2)); path.push(toPlan(it, 0, it.d / 2)); }
      });
      // 入口の手前と出口の先へ少し延ばす
      function extend(a, b, mm) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [b[0] + dx / l * mm, b[1] + dy / l * mm]; }
      const start = extend(path[1], path[0], 500), end = extend(path[path.length - 2], path[path.length - 1], 600);
      function walkPath(pts, startFloor) {
        ST.floor = startFloor; WALK.floor = startFloor; WALK.groundOff = 0; _walkCollFloor = null;
        WALK.x = pts[0][0] * U; WALK.z = pts[0][1] * U; walkUpdateGround();
        let tt = performance.now(), floors = [WALK.floor];
        for (let k = 1; k < pts.length; k++) {
          for (let i = 0; i < 120; i++) {
            const dx = pts[k][0] - WALK.x / U, dy = pts[k][1] - WALK.z / U;
            if (Math.hypot(dx, dy) < 120) break;
            WALK.yaw = Math.atan2(-dx, -dy); WALK.keys = { fwd: true };
            tt += 50; updateWalkMode(tt);
            if (floors[floors.length - 1] !== WALK.floor) floors.push(WALK.floor);
          }
        }
        WALK.keys = {};
        return { floors, end: [Math.round(WALK.x / U), Math.round(WALK.z / U)] };
      }
      const firstFloor = parts[0].it.floor;
      // 着いたか: 最後の出口（下りは最初の入口）から 400mm 以内。延ばした目印は壁の向こうになることがあるので見ない
      const near = (r, p) => Math.hypot(p[0] - r.end[0], p[1] - r.end[1]) < 400;
      const up = walkPath([start].concat(path, [end]), firstFloor);
      up.reached = near(up, path[path.length - 1]) || near(up, end);
      const topFloor = up.floors[up.floors.length - 1];
      const down = walkPath([path[path.length - 1]].concat(path.slice().reverse(), [start]), topFloor);
      down.reached = near(down, path[0]) || near(down, start);
      // 抜けない: 階段の上の点から8方向
      const bb = {};
      DATA.walls.forEach((w) => { const b = bb[w.floor] || (bb[w.floor] = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }); b.x0 = Math.min(b.x0, w.x1, w.x2); b.x1 = Math.max(b.x1, w.x1, w.x2); b.y0 = Math.min(b.y0, w.y1, w.y2); b.y1 = Math.max(b.y1, w.y1, w.y2); });
      const escapes = [];
      parts.forEach(({ it }) => {
        for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) for (const fl of [it.floor, it.floor + 1]) for (let k = 0; k < 8; k++) {
          const p = toPlan(it, (fx - 0.5) * it.w, (fy - 0.5) * it.d);
          ST.floor = fl; WALK.floor = fl; WALK.groundOff = 0; _walkCollFloor = null;
          WALK.x = p[0] * U; WALK.z = p[1] * U; walkUpdateGround();
          WALK.yaw = k * Math.PI / 4; WALK.keys = { fwd: true };
          let tt = performance.now();
          for (let i = 0; i < 45; i++) { tt += 50; updateWalkMode(tt); }
          WALK.keys = {};
          const b = bb[WALK.floor], x = WALK.x / U, z = WALK.z / U;
          if (WALK.floor >= 2 && b && (x < b.x0 - 50 || x > b.x1 + 50 || z < b.y0 - 50 || z > b.y1 + 50)) escapes.push({ from: p.map(Math.round), floor: fl, dir: k, to: [Math.round(x), Math.round(z)], endFloor: WALK.floor });
        }
      });
      // 家の外では地面に立つ。外へ出るドアごとに、外へ歩いて足元を見て、家の中へ戻る
      function walkTo(tx, tz) { let tt = performance.now(); for (let i = 0; i < 200; i++) { const dx = tx - WALK.x / U, dz = tz - WALK.z / U; if (Math.hypot(dx, dz) < 100) break; WALK.yaw = Math.atan2(-dx, -dz); WALK.keys = { fwd: true }; tt += 50; updateWalkMode(tt); } WALK.keys = {}; }
      const outdoors = DATA.items.filter((i) => i.floor === 1 && isOpeningItemType(i.type) && !isWindowLikeType(i.type)).map((i) => {
        const pts = openingSidePoints(i), out = pts.find((p) => !roomAtPointOnFloor(1, p[0], p[1])), inn = pts.find((p) => roomAtPointOnFloor(1, p[0], p[1]));
        if (!out || !inn) return null;
        const dx = out[0] - inn[0], dz = out[1] - inn[1], l = Math.hypot(dx, dz);
        const inside = [inn[0] - dx / l * 600, inn[1] - dz / l * 600], outside = [out[0] + dx / l * 2500, out[1] + dz / l * 2500];
        ST.floor = 1; WALK.floor = 1; WALK.groundOff = 0; _walkCollFloor = null;
        WALK.x = inside[0] * U; WALK.z = inside[1] * U; walkUpdateGround(true);
        walkTo(outside[0], outside[1]);
        const feetOut = floorTopY(1) + WALK.groundOff, stillOutside = !roomAtPointOnFloor(1, WALK.x / U, WALK.z / U);
        walkTo(inside[0], inside[1]);
        const backIn = Math.hypot(WALK.x / U - inside[0], WALK.z / U - inside[1]) < 200;
        return { door: i.type, feetOut: +feetOut.toFixed(2), floorTop: +floorTopY(1).toFixed(2), stillOutside, backIn };
      }).filter(Boolean);
      // 4. 階段の下: 階段の踏み面が 1.6m 以上の所の真下に床の高さで立ち、8方向へ歩いて、階段の下に居る間に
      //    壁にめり込まないか（階段の低い所まで来て踏み面に乗ったら、そこからは階段の上の決まりで見る）
      const under = [];
      parts.forEach(({ it }) => {
        for (const fx of [0.3, 0.5, 0.7]) for (const fy of [0.15, 0.5, 0.85]) {
          const p = toPlan(it, (fx - 0.5) * it.w, (fy - 0.5) * it.d), s = walkStairSampleAt(p[0], p[1], it.floor, 0);
          if (!s || s.offM < 1.6) continue;
          ST.floor = it.floor; WALK.floor = it.floor; WALK.groundOff = roomFloorAt(it.floor, p[0], p[1]) - floorTopY(it.floor);
          if (walkWallPenetration(p[0], p[1], it.floor)) continue;   // 階段の端が壁に接していて、置いた点がもう壁にかかっている
          for (let k = 0; k < 8; k++) {
            ST.floor = it.floor; WALK.floor = it.floor; _walkCollFloor = null;
            WALK.x = p[0] * U; WALK.z = p[1] * U; WALK.groundOff = roomFloorAt(it.floor, p[0], p[1]) - floorTopY(it.floor);
            WALK.yaw = k * Math.PI / 4; WALK.keys = { fwd: true };
            let tt = performance.now(), deepest = 0;
            for (let i = 0; i < 30; i++) { tt += 50; updateWalkMode(tt); if (WALK.floor !== it.floor) break; const ss = walkStairSampleAt(WALK.x / U, WALK.z / U, it.floor, 0); if (ss && ss.offM - WALK.groundOff <= 0.45) break; const pen = walkWallPenetration(WALK.x / U, WALK.z / U, WALK.floor); if (pen) deepest = Math.max(deepest, pen.depth); }
            WALK.keys = {};
            if (deepest > 60) under.push({ from: p.map(Math.round), dir: k, depthMm: Math.round(deepest) });
          }
        }
      });
      // 5. 上の階の壁: 最初の直階段の、踏み面が床から 1.45m の所の真上に、上の階の壁を一時的に置いて上る
      //    （頭は 3.1m で上の階の床(約 2.9m)より上に出るが、胸はかからない高さ）
      let headroom = null;
      const flight = parts.find(({ it }) => it.type === 'stair');
      if (flight) {
        const it = flight.it;
        let ly = 0, bestD = 1e9;
        for (let f = -0.5; f <= 0.5; f += 0.02) { const q = toPlan(it, 0, f * it.d), sm = walkStairSampleAt(q[0], q[1], it.floor, 0); if (sm && Math.abs(sm.offM - 1.45) < bestD) { bestD = Math.abs(sm.offM - 1.45); ly = f * it.d; } }
        const a = toPlan(it, -it.w, ly), b = toPlan(it, it.w, ly);
        const w = { x1: a[0], y1: a[1], x2: b[0], y2: b[1], floor: it.floor + 1, thick: 120 };
        DATA.walls.push(w); _walkCollFloor = null;
        const res = walkPath([start].concat(path, [end]), firstFloor);
        DATA.walls.splice(DATA.walls.indexOf(w), 1); _walkCollFloor = null;
        headroom = { floors: res.floors, reached: near(res, path[path.length - 1]) || near(res, end) };
      }
      return { firstFloor, up, down, escapes, outdoors, under, headroom };
    });
    if (process.env.DEBUG) console.log(preset, 'up', r.up.floors.join('→'), 'down', r.down.floors.join('→'));
    assert.ok(r.up.floors.length > 1 && r.up.reached, `${preset}: 階段を上りきれない ${JSON.stringify(r.up)}`);
    assert.equal(r.down.floors[r.down.floors.length - 1], r.firstFloor, `${preset}: 階段を下りきれない ${JSON.stringify(r.down)}`);
    assert.ok(r.down.reached, `${preset}: 階段の下まで戻れない ${JSON.stringify(r.down)}`);
    assert.deepEqual(r.escapes, [], `${preset}: 階段から家の外へ抜けた`);
    assert.ok(r.outdoors.length > 0, `${preset}: 外へ出るドアが見つからない`);
    for (const o of r.outdoors) {
      assert.ok(o.stillOutside && o.feetOut < o.floorTop - 0.3, `${preset}: 家の外で床の高さのまま浮いている ${JSON.stringify(o)}`);
      assert.ok(o.backIn, `${preset}: 外から家の中へ戻れない ${JSON.stringify(o)}`);
    }
    assert.deepEqual(r.under, [], `${preset}: 階段の下を歩くと壁にめり込む`);
    assert.ok(!r.headroom || (r.headroom.floors.length > 1 && r.headroom.reached), `${preset}: 階段の途中の真上に上の階の壁があると上れない ${JSON.stringify(r.headroom)}`);
    assert.deepEqual(errors, [], `${preset}: ページで例外: ${errors.join(' / ')}`);
    console.log(`ok ${preset}: 上り ${r.up.floors.join('→')}階 / 下り ${r.down.floors.join('→')}階 / 外へ抜けた所 0 / 外の足元 ${r.outdoors.map((o) => o.feetOut + 'm').join(',')}（床 ${r.outdoors[0].floorTop}m）・家に戻れる / 階段の下でめり込まない / 真上の壁があっても上れる`);
    await page.context().close();
  }
} finally {
  await browser.close();
}
