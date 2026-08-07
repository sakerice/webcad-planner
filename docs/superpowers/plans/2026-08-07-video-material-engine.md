# 動画生成AI向け素材生成エンジン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ユーザーが決めた構図から、動画生成AIへ渡す静止画素材・平面図・プロンプトを1パッケージとして書き出せるようにする。

**Architecture:** 純粋ロジックは `assets/js/` の UMD モジュールに切り出し、`node --test` で単体テストする。index.html は既に `assets/models/*/manifest.js` を classic script で読んでおり、この形は既存パターンと同じ。index.html 側にはモジュールの呼び出しと DOM だけを置く。判定器は既存の `pv/tools/fidelity-qa` をそのまま使う。

**Tech Stack:** 素の JavaScript（ES5相当の書き方、index.html に合わせる）、node:test、Python 3 + Pillow（判定器）。**新規の依存は入れない。**

仕様: [動画生成AI向け素材生成エンジン 設計](../specs/2026-08-07-video-material-engine-design.md)

## Global Constraints

- **既存の出荷済み挙動を1ビットも変えない。** 高さフィールドを持たないプランは、変更前と完全に同じ寸法でレンダされなければならない。既存の静止画AIレンダーの出力も、ユーザーが新機能を使わない限り変わってはならない。
  - **開示済みの例外が1つある**（全体レビューで実測）: `instance-legend.json` が 49402 → 49718 バイトに変わる。
    35件の `type` が `Mesh`（three.js のクラス名が意味のある型名の位置に漏れていたもの）から
    `render-object` / `outside-ground` になったため。`ai-render-package.json` は同じ legend を
    埋め込むので同様に変わる。**プロンプトは同一**（hash 1288008290、12718バイト）。
    これは意図した修正だが、「1バイトも変えない」の文言には収まらないので明記する。
    `instance-legend.json` を読む下流があるなら、この変更を知らせること。
- `assets/default_plan.json` を変更しない。
- `git add -A` / `git commit -a` を使わない。必ずパスを明示してステージする。
- 新しい npm/pip 依存を追加しない。
- index.html の JS は ES5 相当の書き方に揃える（`var`、`function`、アロー関数・`const`/`let`・テンプレートリテラルを使わない）。`assets/js/*.js` も同様。理由: 既存コードとの一貫性と、古い iPad Safari での動作。
- 変更のたびに `node tools/check-html-js.cjs` が通ること。
- 既定の階高 2700mm、居室天井高 2400mm、床スラブ 180mm。これらは現行の `WALL_H` / `FLOOR_H` / `FLOOR_SLAB_H` と同一値でなければならない。
- 尺の上限 15 秒、既定 8 秒。
- 暗部持ち上げの閾値は平均輝度 30/255。
- テストは `node --test "tools/tests/*.test.cjs"` で走る。

### 幾何の指紋の取り方（本体の3Dに触るタスクは必ずこれを使う）

素朴な `Box3` とメッシュ数では、高さの変化を**検出できない**。実測で確認済み:
1800m の `_sky` ドームが bbox を ±900 に固定し、メッシュ数は高さに反応しない。
以下を使うこと。

```js
// ?pvCapture=1&nocache=<毎回ちがう値> で開き、家具のロード完了を待ってから
(function(){
  var box=new THREE.Box3(), meshes=0, verts=0, ySum=0, ceilYs=[];
  sc3.traverse(function(o){
    if(!o.isMesh) return;
    if(o===_sky||(o.name&&o.name.indexOf('sky')>=0)) return; // 空は除く。bboxを支配してしまう
    meshes++;
    var g=o.geometry; if(g&&g.attributes&&g.attributes.position) verts+=g.attributes.position.count;
    o.updateWorldMatrix(true,false);
    ySum+=o.matrixWorld.elements[13];
    box.expandByObject(o);
    if(o.userData&&o.userData.isCeiling) ceilYs.push(+o.position.y.toFixed(4));
  });
  return {meshes:meshes, verts:verts, ySum:+ySum.toFixed(4),
          min:box.min.toArray().map(function(v){return +v.toFixed(4);}),
          max:box.max.toArray().map(function(v){return +v.toFixed(4);}),
          ceilYs:ceilYs.sort()};
})()
```

外観(`3d-ext`)・内観(`3d-int`)それぞれ、1階と2階で取る。**`nocache` を毎回変えること** —
index.html もモジュールも強くキャッシュされ、古い実装のまま「一致」して見える事故が
このプロジェクトで既に2回起きている。

**さらに、変えたつもりの経路が本当に生きていることを別途示すこと。** 「変わらなかった」
だけでは、配線が繋がっていない場合と区別できない。Task 2 では対象関数を差し替えて
呼び出し回数を数え、1部屋だけ値を変えてその部屋の天井だけが動くことを確認した。
同じ形の確認を行う。

---

### Task 1: 高さモデル — データと既定値

**Files:**
- Create: `assets/js/height-model.js`
- Test: `tools/tests/height-model.test.cjs`

**Interfaces:**
- Consumes: なし
- Produces:
  - `HeightModel.storyHeightMm(plan, floor)` → number
  - `HeightModel.ceilingHeightMm(plan, room)` → number
  - `HeightModel.ceilingShape(plan, room)` → `{type:'flat', heightMm}` または `{type:'sloped', lowMm, highMm, direction}`
  - `HeightModel.DEFAULTS` → 下表の定数
  - `HeightModel.ceilingLabel(plan, room)` → `'CH 2400'` / `'CH 2200-3600 ↗'`

`plan` は `DATA` と同じ形（`{walls, rooms, items, floors?}`）。すべてのフィールドは省略可。

**既定値（日本の注文住宅の実務値）:**

| キー | 値 | 由来 |
|---|---|---|
| `storyHeightMm` | 2700 | 現行 `FLOOR_H` |
| `ceilingHeightMm` | 2400 | 現行 `WALL_H` |
| `floorSlabMm` | 180 | 現行 `FLOOR_SLAB_H` |
| `wetAreaCeilingMm` | 2200 | 水回り・廊下の通例 |
| `droppedCeilingMm` | 2100 | 建築基準法における居室の下限 |
| `loftMaxMm` | 1400 | 階に算入されない上限 |
| `firstFloorLevelMm` | 400 | GL からの1階床高 |
| `slopedLowMm` / `slopedHighMm` | 2200 / 3600 | 斜線制限のかかる敷地で最も出番が多い形 |

**読み取り順（いずれも無ければ既定へ落ちる）:**
- 階高: `plan.floors[floor].storyHeight` → `DEFAULTS.storyHeightMm`
- 天井高: `room.ceiling.heightMm` → `room.ceilingHeight` → `DEFAULTS.ceilingHeightMm`
- 勾配: `room.ceiling.type === 'sloped'` のときのみ。`lowMm`/`highMm`/`direction` が欠けていれば既定へ

- [ ] **Step 1: 失敗するテストを書く**

```js
// tools/tests/height-model.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const HeightModel = require('../../assets/js/height-model.js');

// ── 後方互換。ここが崩れたら既存プランのレンダが変わる ──
test('高さフィールドを持たないプランは現行の定数と完全に一致する', () => {
  const plan = { walls: [], rooms: [{ id: 'r1', floor: 1 }], items: [] };
  assert.equal(HeightModel.storyHeightMm(plan, 1), 2700);
  assert.equal(HeightModel.storyHeightMm(plan, 3), 2700);
  assert.equal(HeightModel.ceilingHeightMm(plan, plan.rooms[0]), 2400);
  assert.equal(HeightModel.DEFAULTS.floorSlabMm, 180);
});

test('plan が空でも room が undefined でも既定へ落ちる', () => {
  assert.equal(HeightModel.ceilingHeightMm(null, null), 2400);
  assert.equal(HeightModel.storyHeightMm(undefined, 2), 2700);
});

// ── 明示された値は尊重する ──
test('room.ceilingHeight は読まれる', () => {
  const room = { id: 'r1', floor: 1, ceilingHeight: 2200 };
  assert.equal(HeightModel.ceilingHeightMm({}, room), 2200);
});

test('room.ceiling.heightMm は room.ceilingHeight より優先される', () => {
  const room = { ceilingHeight: 2200, ceiling: { type: 'flat', heightMm: 2500 } };
  assert.equal(HeightModel.ceilingHeightMm({}, room), 2500);
});

test('floors[n].storyHeight は階ごとに読まれる', () => {
  const plan = { floors: { 1: { storyHeight: 3000 }, 2: {} } };
  assert.equal(HeightModel.storyHeightMm(plan, 1), 3000);
  assert.equal(HeightModel.storyHeightMm(plan, 2), 2700);
});

// ── 不正値は既定へ落とす。壊れたプランでレンダを壊さない ──
test('数値でない・0以下・NaN の天井高は既定へ落ちる', () => {
  for (const bad of ['2400', 0, -100, NaN, Infinity, null]) {
    assert.equal(HeightModel.ceilingHeightMm({}, { ceilingHeight: bad }), 2400,
      'ceilingHeight=' + JSON.stringify(bad) + ' should fall back');
  }
});

// ── 勾配天井 ──
test('flat な部屋の形状は単一の高さを返す', () => {
  assert.deepEqual(HeightModel.ceilingShape({}, { ceilingHeight: 2400 }),
    { type: 'flat', heightMm: 2400 });
});

test('sloped な部屋は低い側・高い側・向きを返す', () => {
  const room = { ceiling: { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 180 } };
  assert.deepEqual(HeightModel.ceilingShape({}, room),
    { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 180 });
});

test('sloped で low > high なら入れ替えて返す（描画側で符号を気にせず済むように）', () => {
  const room = { ceiling: { type: 'sloped', lowMm: 3600, highMm: 2200, direction: 0 } };
  const shape = HeightModel.ceilingShape({}, room);
  assert.equal(shape.lowMm, 2200);
  assert.equal(shape.highMm, 3600);
});

test('sloped だが寸法が欠けていれば既定の 2200-3600 になる', () => {
  const shape = HeightModel.ceilingShape({}, { ceiling: { type: 'sloped' } });
  assert.equal(shape.lowMm, 2200);
  assert.equal(shape.highMm, 3600);
  assert.equal(shape.direction, 0);
});

// ── 平面図に載せるラベル ──
test('flat のラベルは CH と高さ', () => {
  assert.equal(HeightModel.ceilingLabel({}, { ceilingHeight: 2400 }), 'CH 2400');
});

test('sloped のラベルは範囲と向きの矢印', () => {
  const room = { ceiling: { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 } };
  assert.equal(HeightModel.ceilingLabel({}, room), 'CH 2200-3600 ↑');
});
```

`direction` は方位角（度、0=北、時計回り）。矢印は 45 度刻みで
`↑ ↗ → ↘ ↓ ↙ ← ↖` に丸める。

- [ ] **Step 2: テストが落ちることを確認する**

Run: `node --test "tools/tests/height-model.test.cjs"`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: 最小の実装を書く**

`assets/js/height-model.js` を UMD で書く。ブラウザでは `window.HeightModel`、node では
`module.exports` になる形。**package.json が無いので node は `.js` を CommonJS として読む。**

```js
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
  // 壊れたプランでレンダを壊さない。数値でない・非有限・0以下はすべて既定へ。
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
  }
  function storyHeightMm(plan, floor) { /* ... */ }
  function ceilingHeightMm(plan, room) { /* ... */ }
  function ceilingShape(plan, room) { /* ... */ }
  function ceilingLabel(plan, room) { /* ... */ }
  return { DEFAULTS: DEFAULTS, storyHeightMm: storyHeightMm,
           ceilingHeightMm: ceilingHeightMm, ceilingShape: ceilingShape,
           ceilingLabel: ceilingLabel };
}));
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test "tools/tests/height-model.test.cjs"`
Expected: PASS（13件）

- [ ] **Step 5: コミット**

```bash
git add assets/js/height-model.js tools/tests/height-model.test.cjs
git commit -m "Add the height model, defaulting to today's constants exactly"
```

---

### Task 2: 高さモデルを本体へ配線する

**Files:**
- Modify: `index.html`（`<script src="assets/js/height-model.js"></script>` の追加、および `WALL_H` / `FLOOR_H` を読んでいる箇所のうち **部屋ごとに変わるべき箇所** の置き換え）
- Test: `tools/tests/height-wiring.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `HeightModel`
- Produces: なし（本体の内部配線）

**先に読むこと:** `index.html` の `var WALL_H = 2400;`（3442行付近）、`floorBaseY()`（3529行付近）、
`floorSlabHeightMForFloor()`、`contextStoryHeightMm()`（4212行付近）、
および `WALL_H` / `FLOOR_H` の全出現箇所（`grep -n "WALL_H\|FLOOR_H" index.html`）。

**このタスクの肝は「置き換えない箇所を決めること」である。**

- 置き換える: **部屋の天井・壁の高さを決めている箇所**。ここが部屋ごとの天井高を反映すべき場所。
- 置き換えない: 隣家の階高（`contextStoryHeightMm`）、UIの既定値、
  高さと無関係に `FLOOR_H` を単位として使っている箇所。

判断がつかない箇所は**置き換えず、コメントで理由を残す**。誤って置き換えると既存の家の形が変わる。

- [ ] **Step 1: 失敗するテストを書く**

index.html の中身に対する構造テスト。ブラウザを立てずに「配線が入ったか」だけを見る。

```js
// tools/tests/height-wiring.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

test('height-model.js が読み込まれている', () => {
  assert.match(html, /<script src="assets\/js\/height-model\.js"><\/script>/);
});

test('既定値の定数は現行値のまま残っている（他の参照が壊れないように）', () => {
  assert.match(html, /var WALL_H = 2400;/);
  assert.match(html, /var FLOOR_H = 2700;/);
  assert.match(html, /var FLOOR_SLAB_H = 180;/);
});

test('部屋の天井高は HeightModel 経由で読まれる', () => {
  assert.match(html, /HeightModel\.ceilingHeightMm\(/);
});

test('隣家の階高は HeightModel を経由しない（設計対象外の別概念）', () => {
  const fn = html.slice(html.indexOf('function contextStoryHeightMm'),
                        html.indexOf('function contextStoryHeightM('));
  assert.doesNotMatch(fn, /HeightModel/);
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `node --test "tools/tests/height-wiring.test.cjs"`
Expected: FAIL — script タグが無い

- [ ] **Step 3: 配線する**

1. `assets/models/custom/manifest.js` の script タグの直後に
   `<script src="assets/js/height-model.js"></script>` を足す。
2. 部屋の壁・天井の高さを決めている箇所を `HeightModel.ceilingHeightMm(DATA, room)` に置き換える。
3. 置き換えなかった `WALL_H` / `FLOOR_H` の参照それぞれに、**なぜ置き換えないのか**を1行コメントで残す。

- [ ] **Step 4: 既存プランで寸法が変わらないことを実測する**

デフォルトプランを開き、置き換え前後で**3Dの頂点数と建物のバウンディングボックスが
一致すること**を確認する。ブラウザで:

**この指紋は下の「幾何の指紋の取り方」に従うこと。素朴な Box3 + メッシュ数では
検出できない**（Task 2 実測: 1800m の `_sky` ドームが bbox を ±900 に固定してしまい、
メッシュ数は高さの変化に反応しない。置き換えすぎた編集でも「一致」してしまう）。

Expected: 変更前後で完全に一致。一致しなければ置き換えすぎている。

- [ ] **Step 5: テストとリンタを通す**

Run: `node --test "tools/tests/*.test.cjs"` と `node tools/check-html-js.cjs`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add index.html tools/tests/height-wiring.test.cjs
git commit -m "Read room ceiling height through the height model"
```

---

### Task 2b: 天井面を階高から切り離す

**Files:**
- Modify: `index.html`（`roomCeilingHeightM()` のクランプ、壁の高さ、`floorTopY` 系）
- Test: `tools/tests/height-wiring.test.cjs`（追記）

**Interfaces:**
- Consumes: Task 1 の `HeightModel.ceilingHeightMm` / `storyHeightMm`
- Produces: なし（本体の幾何）

**なぜ必要か（Task 2 の実測）:** 現在の `roomCeilingHeightM()` は
`Math.max(天井高 + 床スラブ, 階高)` で終わる。床スラブ 180mm・階高 2700mm のため、
**2520mm 以下の天井高は 2700mm にクランプされて効かない。** 仕様の
「水回り 2200」「下がり天井 2100」は現状まったく実現できず、2701mm 以上だけが効く。

このクランプ自体は既存の挙動であり、Task 2 が寸法を1ビットも変えずに済んだ理由でもある。
ここで初めて、意図して外す。

**この改修は勾配天井が必要とする幾何とまったく同じもの**である。天井面が壁の頂部に
縛られている限り、下げることも傾けることもできない。ここで切り離しておけば、
勾配天井（Task 2c）は同じ土台の上に載る。

**やること:**
1. 天井面の高さを「床レベル + その部屋の天井高」で決める。階高でクランプしない。
2. 天井高が階高より低い部屋では、**壁が天井面まで届いていること**を保証する
   （現状は天井面だけが動き、壁は階高のままなので隙間が開く）。
   壁は2つの部屋の境界にあるので、**壁の高さはその壁が接する部屋の天井高の最大値**を採る。
   これは「低い方に合わせて壁を切ると、高い側の部屋に穴が開く」ことを避ける唯一の選び方。
3. 階高そのものを `HeightModel.storyHeightMm(DATA, floor)` から読む。
4. 天井高が階高を超える場合は、**階高の側を上げるのではなく天井高を階高に丸める**。
   上げると上階の床が持ち上がり、家全体が変わる。丸めたことを警告として残す。

**やらないこと:** 勾配天井そのもの（Task 2c）。ここは flat のみ。

- [ ] **Step 1: 失敗するテストを書く**

構造テストに加え、**幾何そのものを見るブラウザ実測**をこのタスクの検証の中心に置く。

```js
// tools/tests/height-wiring.test.cjs に追記
test('天井面は階高でクランプされない', () => {
  const src = html.slice(html.indexOf('function roomCeilingHeightM'));
  const body = src.slice(0, src.indexOf('\n}') + 2);
  assert.doesNotMatch(body, /Math\.max\([^)]*FLOOR_H/,
    'the storey clamp is what makes ceilings below 2520mm unreachable');
});

test('階高は HeightModel から読まれる', () => {
  assert.match(html, /HeightModel\.storyHeightMm\(/);
});

test('壁の高さは接する部屋の天井高の最大値を採る', () => {
  assert.match(html, /wallCeilingHeightM|maxAdjacentCeiling/);
});
```

- [ ] **Step 2: テストが落ちることを確認する**

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 幾何を実測する（このタスクの本体）**

「Global Constraints / 幾何の指紋の取り方」の手順で、次の4つを測る:

| 条件 | 期待 |
|---|---|
| 高さフィールドなしのデフォルトプラン | **変更前と完全一致**（既存ユーザーの家が変わらないこと） |
| 1部屋だけ `ceilingHeight: 2200` | **その部屋の天井だけ**が下がる。他室の `ceilYs` は不変 |
| 1部屋だけ `ceilingHeight: 3000` | その部屋の天井だけが上がり、**壁との隙間が開かない** |
| 1部屋だけ `ceilingHeight: 9000`（階高超え） | 階高に丸められ、上階の床が動かない |

3番目の「隙間が開かない」は指紋では見えない。**内観3Dで実際にレンダして目視すること。**
壁と天井のあいだに背景が透けていれば失敗。

- [ ] **Step 5: 全テストとリンタを通してコミット**

```bash
git add index.html tools/tests/height-wiring.test.cjs
git commit -m "Let a room's ceiling sit below the storey height"
```

---

### Task 3: 注記抜きの2D平面図キャプチャ

**Files:**
- Modify: `index.html`（`draw2d()` にキャプチャモードを足し、`capturePlan2dDataUrl()` を追加）
- Test: `tools/tests/plan-capture.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `HeightModel.ceilingLabel`
- Produces: `capturePlan2dDataUrl(options)` → PNG の data URL。
  `options = { annotations:false, ceilingLabels:true, selection:false, grid:false, ghostFloor:false }`

**先に読むこと:** `index.html` の `draw2d()`（5634行付近）、`isPlanAnnotationType()`（4175行付近）、
`drawItem2d()`、`drawHandles()`。

**方針（設計 §11 より）:** 描画関数を分岐させず、**描画対象のフィルタで実現する。**
`draw2d()` の先頭で読む `ST` の代わりに、キャプチャ中だけ有効な描画オプションを1つ持たせ、
既存の各描画呼び出しはそのオプションを見て対象を絞る。`isPlanAnnotationType()` が既にあるので、
メモ・定規・ウォークルートの除外はそれで足りる。

除外するもの: メモ、定規、ウォークルート、選択ハイライトとハンドル、グリッド、下階ゴースト
残すもの: 壁、建具、部屋、階段、家具、什器、方位、**天井高ラベル**

- [ ] **Step 1: 失敗するテストを書く**

```js
// tools/tests/plan-capture.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

test('capturePlan2dDataUrl が存在する', () => {
  assert.match(html, /function capturePlan2dDataUrl\(/);
});

test('注記の除外は既存の isPlanAnnotationType を使う（判定を二重に持たない）', () => {
  const fn = html.slice(html.indexOf('function capturePlan2dDataUrl'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /isPlanAnnotationType|planCaptureOptions/);
});

test('天井高ラベルは HeightModel から取る', () => {
  assert.match(html, /HeightModel\.ceilingLabel\(/);
});

test('キャプチャオプションは必ず後始末される（finally で戻す）', () => {
  const i = html.indexOf('function capturePlan2dDataUrl');
  const body = html.slice(i, i + 2500);
  assert.match(body, /finally/);
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `node --test "tools/tests/plan-capture.test.cjs"`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 実機で確認する**

ブラウザで `capturePlan2dDataUrl({annotations:false})` を呼び、返った PNG を目視する。
メモ・定規・選択枠が消えており、壁・建具・部屋名・天井高が残っていること。
**呼び出し後に通常の `draw2d()` が元通り描かれること**（オプションが残留していない）。

- [ ] **Step 5: 既存の静止画AIレンダーにも平面図を出せるようにする**

`generateAiRenderPackage()` に平面図を追加する。**既定では追加しない** — 既存ユーザーの
出力を変えないため。ダイアログのチェックボックス（既定オフ）で有効化する。

- [ ] **Step 6: テストとリンタを通してコミット**

```bash
git add index.html tools/tests/plan-capture.test.cjs
git commit -m "Capture the plan without memos, rulers or selection overlays"
```

---

### Task 4: 固定階層（LOCKED / SOFT / FREE）

**Files:**
- Create: `assets/js/lock-tiers.js`
- Test: `tools/tests/lock-tiers.test.cjs`

**Interfaces:**
- Consumes: `instance-legend.json` と同じ形の配列（`[{id, color, type, floor, source, ...}]`）
- Produces:
  - `LockTiers.tierOf(type)` → `'LOCKED'` / `'SOFT'` / `'FREE'`
  - `LockTiers.tableFor(legend)` → `{ '<color>': 'LOCKED', ... }`
  - `LockTiers.summarize(legend)` → `{ LOCKED: [...types], SOFT: [...], counts: {...} }`

**分類（設計 §6 より）:**

| 階層 | type の並び |
|---|---|
| LOCKED | `wall`, `window*`, `door*`, `stair*`, `roof`, `balcony`, `foundation`, `room`, `site-rect`, `fence`, `wood-fence`, `lattice-screen`, `ramp`, `exterior-stair` |
| SOFT | `fmp-*`, `im0261-*`, `light-*`, `closet`, `shoe_cabinet`, `washer`, `tv`, `desk`, `sofa`, `bed-*`, `bath`, `toilet`, `sink`, `kitchen`, `fridge`, `car`, `bicycle*` |
| FREE | `memo`, `ruler`, `walk-route`, `neighbor-*`, `road`, `utility-pole` |

**未知の type は LOCKED に倒す。** 分類漏れで設計要素が自由化されるより、
自由にできるはずのものが固定される方が安全。

- [ ] **Step 1: 失敗するテストを書く**

```js
// tools/tests/lock-tiers.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const LockTiers = require('../../assets/js/lock-tiers.js');

test('建具と躯体は LOCKED', () => {
  for (const t of ['wall', 'window', 'door-swing', 'door-slide', 'stair',
                   'stair-corner', 'roof', 'balcony', 'room', 'foundation']) {
    assert.equal(LockTiers.tierOf(t), 'LOCKED', t);
  }
});

test('GLB家具と什器は SOFT', () => {
  for (const t of ['fmp-Sofa39', 'fmp-Chair37', 'im0261-Tv-MEGA_PACK_tv-electronic-123142',
                   'light-down', 'closet', 'washer']) {
    assert.equal(LockTiers.tierOf(t), 'SOFT', t);
  }
});

test('周辺環境と注記は FREE', () => {
  for (const t of ['neighbor-house', 'neighbor-building', 'road', 'utility-pole',
                   'memo', 'ruler', 'walk-route']) {
    assert.equal(LockTiers.tierOf(t), 'FREE', t);
  }
});

// 分類漏れの倒し方。ここが逆だと、新しい建具種別が黙って自由化される。
test('未知の type は LOCKED に倒れる', () => {
  assert.equal(LockTiers.tierOf('door-something-new-2027'), 'LOCKED');
  assert.equal(LockTiers.tierOf(''), 'LOCKED');
  assert.equal(LockTiers.tierOf(undefined), 'LOCKED');
});

test('legend から色→階層の表が引ける', () => {
  const legend = [
    { id: 1, color: '#aabbcc', type: 'wall' },
    { id: 2, color: '#ddeeff', type: 'fmp-Sofa39' },
    { id: 3, color: '#112233', type: 'road' }
  ];
  assert.deepEqual(LockTiers.tableFor(legend), {
    '#aabbcc': 'LOCKED', '#ddeeff': 'SOFT', '#112233': 'FREE'
  });
});

test('色は小文字に正規化される（照合側が厳密一致で切り出すため）', () => {
  const table = LockTiers.tableFor([{ id: 1, color: '#AABBCC', type: 'wall' }]);
  assert.deepEqual(Object.keys(table), ['#aabbcc']);
});

test('summarize は階層ごとの種別と個数を返す', () => {
  const legend = [
    { id: 1, color: '#a', type: 'window' }, { id: 2, color: '#b', type: 'window' },
    { id: 3, color: '#c', type: 'fmp-Sofa39' }
  ];
  const s = LockTiers.summarize(legend);
  assert.equal(s.counts.LOCKED, 2);
  assert.equal(s.counts.SOFT, 1);
  assert.deepEqual(s.LOCKED, ['window']);
});
```

- [ ] **Step 2〜5:** 落ちることを確認 → 実装 → 通ることを確認 → コミット

```bash
git add assets/js/lock-tiers.js tools/tests/lock-tiers.test.cjs
git commit -m "Classify design elements into locked, soft and free tiers"
```

---

### Task 5: 表現プリセットとプロンプト組み立て

**Files:**
- Create: `assets/js/video-prompt.js`
- Test: `tools/tests/video-prompt.test.cjs`

**Interfaces:**
- Consumes: Task 4 の `LockTiers.summarize`
- Produces:
  - `VideoPrompt.PRESETS` → 6件の配列。各要素 `{id, label, source:'plan'|'3d', body}`
  - `VideoPrompt.presetsFor(source)` → その素材で選べるプリセットだけ
  - `VideoPrompt.compose({preset, legend, camera, daylight, userText})` → プロンプト文字列
  - `VideoPrompt.MAX_DURATION_SEC` = 15、`VideoPrompt.DEFAULT_DURATION_SEC` = 8

**プリセット（設計 §8）:**

| id | label | source |
|---|---|---|
| `plan-to-life` | CAD図面 → 生活 | `plan` |
| `plan-to-life-watercolor` | CAD図面 → 生活（水彩風） | `plan` |
| `render-to-life` | 3D画面 → 生活 | `3d` |
| `render-to-life-watercolor` | 3D画面 → 生活（水彩風） | `3d` |
| `life` | 生活映像 | `3d` |
| `life-watercolor` | 生活映像（水彩風） | `3d` |

**組み立ての規則（設計 §7）— これが仕様の中心である:**

```
1. 表現の指定（プリセット本文、またはユーザーが書き換えた文）  60〜70%
2. この家に何があるか（LOCKED の名指し）                      20〜30%
3. してはならないこと（2〜3文）                               末尾のみ
```

3 に入れてよいのは2つだけ:
- 壁・開口・階段・家具を足すな、消すな、動かすな
- 線画・図面・フラットな未着色レンダに戻すな

**個々の仕上げの色を「そのままにしろ」と書いてはならない。** 実測で、これは効かないうえ
生成そのものを止める。仕上げの保持は Task 6 の素材側で担保する。

- [ ] **Step 1: 失敗するテストを書く**

```js
// tools/tests/video-prompt.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const VideoPrompt = require('../../assets/js/video-prompt.js');

const legend = [
  { id: 1, color: '#a1', type: 'window', floor: 2 },
  { id: 2, color: '#a2', type: 'window', floor: 2 },
  { id: 3, color: '#a3', type: 'window', floor: 2 },
  { id: 4, color: '#b1', type: 'door-slide', floor: 2 },
  { id: 5, color: '#b2', type: 'stair', floor: 2 },
  { id: 6, color: '#c1', type: 'fmp-Sofa39', floor: 2 },
  { id: 7, color: '#c2', type: 'fmp-Table35', floor: 2 }
];
const camera = { posM: [6.3, 4.2, 1.15], targetM: [3.0, 4.05, 1.15], fov: 60, eyeHeightM: 1.15 };
const compose = (id, extra) => VideoPrompt.compose(Object.assign(
  { preset: VideoPrompt.PRESETS.find(p => p.id === id), legend: legend, camera: camera }, extra || {}));

test('プリセットは6件で、id が重複しない', () => {
  assert.equal(VideoPrompt.PRESETS.length, 6);
  assert.equal(new Set(VideoPrompt.PRESETS.map(p => p.id)).size, 6);
});

// 実測の失敗: 3Dレンダに「フラットな未着色CAD状態から始めて」と書いたところ、
// 生成AIは渡した映像を捨てて線画を描き直した。素材の種類で出し分ける。
test('3Dビューを撮ったとき「CAD図面 → 生活」は選べない', () => {
  const ids = VideoPrompt.presetsFor('3d').map(p => p.id);
  assert.ok(!ids.includes('plan-to-life'));
  assert.ok(!ids.includes('plan-to-life-watercolor'));
  assert.ok(ids.includes('render-to-life'));
});

test('平面図を撮ったときは図面系のプリセットだけが出る', () => {
  const ids = VideoPrompt.presetsFor('plan').map(p => p.id);
  assert.deepEqual(ids.sort(), ['plan-to-life', 'plan-to-life-watercolor']);
});

// ── 構成比。これを崩すと生成が素通しになる ──
test('禁止条項は本文の末尾3文以内に収まる', () => {
  const text = compose('render-to-life');
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const negIdx = sentences.findIndex(s => /\bdo not\b|\bnever\b/i.test(s));
  assert.ok(negIdx >= sentences.length - 3,
    'first prohibition at sentence ' + negIdx + ' of ' + sentences.length + '; must be in the last 3');
});

test('禁止条項は本文の3割を超えない', () => {
  const text = compose('render-to-life');
  const neg = text.split(/(?<=[.!?])\s+/).filter(s => /\bdo not\b|\bnever\b/i.test(s)).join(' ');
  assert.ok(neg.length / text.length < 0.3,
    'prohibitions are ' + Math.round(neg.length / text.length * 100) + '% of the body');
});

// ── LOCKED は名指しする ──
test('LOCKED の開口は個数を名指しされる', () => {
  const text = compose('render-to-life');
  assert.match(text, /three windows/i);
});

test('LOCKED に階段があれば触れられる', () => {
  assert.match(compose('render-to-life'), /stair/i);
});

// ── 書いてはならないこと ──
// 実測: 仕上げの色を固定する指示は効かず、生成そのものを止めた。
test('個々の仕上げの色を固定する文言は入らない', () => {
  const text = compose('render-to-life');
  assert.doesNotMatch(text, /stays (black|grey|gray|white)/i);
  assert.doesNotMatch(text, /do not re-?colou?r/i);
});

test('線画に戻すなという禁止は必ず入る（実測で効くことが確認されている唯一の禁止）', () => {
  assert.match(compose('render-to-life'), /line drawing/i);
});

// ── ユーザーの書き換えが本文になる ──
test('userText が与えられればそれが表現の本文になる', () => {
  const text = compose('render-to-life', { userText: 'A quiet snowy morning.' });
  assert.match(text, /A quiet snowy morning\./);
  assert.match(text, /line drawing/i, 'the closing constraint still gets appended');
});

test('尺の上限は15秒、既定は8秒', () => {
  assert.equal(VideoPrompt.MAX_DURATION_SEC, 15);
  assert.equal(VideoPrompt.DEFAULT_DURATION_SEC, 8);
});
```

- [ ] **Step 2〜5:** 落ちることを確認 → 実装 → 通ることを確認 → コミット

```bash
git add assets/js/video-prompt.js tools/tests/video-prompt.test.cjs
git commit -m "Compose prompts appearance-first, with prohibitions confined to the tail"
```

---

### Task 6: 暗部の持ち上げ

**Files:**
- Create: `assets/js/shadow-lift.js`
- Test: `tools/tests/shadow-lift.test.cjs`

**Interfaces:**
- Consumes: base の ImageData、instance guide の ImageData、Task 4 の色→階層表
- Produces:
  - `ShadowLift.measure(baseData, instanceData, tierTable)` → `[{color, tier, meanLuminance, pixels}]`
  - `ShadowLift.curveFor(measurements)` → `{applied:false}` または `{applied:true, liftedFrom, gamma, floorLuminance}`
  - `ShadowLift.apply(baseData, curve)` → 新しい ImageData（元は変更しない）

**根拠（設計 §8.3）:** 生成AIが仕上げをドリフトさせるかどうかを最も強く予測するのは
その部材の暗さ（Pearson −0.81）。輝度30以下に潰れた部材は中央値43.7ドリフトし、
それ以外は7.4。真値 `#010302` の部材に「保て」と言っても保てない。

**規則:**
- LOCKED / SOFT の部材のうち、平均輝度が 30/255 未満のものが1つでもあれば持ち上げる
- 最も暗い部材の平均輝度が 30 以上になるガンマを選ぶ
- **ハイライトをクリップさせない**（255 が 255 のままであること）
- 適用したカーブを返し、`package.json` に記録する（判定器が同じ絵と比較するため）

- [ ] **Step 1: 失敗するテストを書く**

```js
// tools/tests/shadow-lift.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowLift = require('../../assets/js/shadow-lift.js');

// w*h の ImageData 相当。ブラウザの ImageData と同じ形 {data, width, height}。
function img(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    const px = fill(Math.floor(i / 4) % w, Math.floor(i / 4 / w));
    d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = 255;
  }
  return { data: d, width: w, height: h };
}
const TIERS = { '#ff0000': 'LOCKED', '#00ff00': 'SOFT', '#0000ff': 'FREE' };
// 左1/3が真っ暗な LOCKED、中1/3が明るい SOFT、右1/3が FREE
const instance = img(30, 10, x => x < 10 ? [255, 0, 0] : x < 20 ? [0, 255, 0] : [0, 0, 255]);
const base = img(30, 10, x => x < 10 ? [2, 3, 2] : x < 20 ? [180, 175, 170] : [90, 90, 90]);

test('部材ごとの平均輝度が測れる', () => {
  const m = ShadowLift.measure(base, instance, TIERS);
  const dark = m.find(e => e.color === '#ff0000');
  assert.equal(dark.tier, 'LOCKED');
  assert.ok(dark.meanLuminance < 5, 'measured ' + dark.meanLuminance);
  assert.equal(dark.pixels, 100);
});

test('潰れた部材があればカーブが適用される', () => {
  const curve = ShadowLift.curveFor(ShadowLift.measure(base, instance, TIERS));
  assert.equal(curve.applied, true);
  assert.ok(curve.gamma < 1, 'a lift needs gamma < 1, got ' + curve.gamma);
});

test('持ち上げ後、最も暗い LOCKED/SOFT 部材は輝度30以上になる', () => {
  const curve = ShadowLift.curveFor(ShadowLift.measure(base, instance, TIERS));
  const lifted = ShadowLift.apply(base, curve);
  const m = ShadowLift.measure(lifted, instance, TIERS);
  const dark = m.find(e => e.color === '#ff0000');
  assert.ok(dark.meanLuminance >= 30, 'still ' + dark.meanLuminance);
});

test('ハイライトはクリップしない', () => {
  const white = img(4, 4, () => [255, 255, 255]);
  const curve = { applied: true, gamma: 0.4, floorLuminance: 30 };
  const out = ShadowLift.apply(white, curve);
  assert.equal(out.data[0], 255);
});

test('元の ImageData は変更されない', () => {
  const before = base.data[0];
  ShadowLift.apply(base, { applied: true, gamma: 0.4, floorLuminance: 30 });
  assert.equal(base.data[0], before);
});

// FREE は生成AIに任せる領域なので、暗いままでも持ち上げの理由にならない。
test('FREE の部材だけが暗くてもカーブは適用されない', () => {
  const b = img(30, 10, x => x < 20 ? [180, 175, 170] : [1, 1, 1]);
  const curve = ShadowLift.curveFor(ShadowLift.measure(b, instance, TIERS));
  assert.equal(curve.applied, false);
});

test('十分明るければ何もしない（applied:false）', () => {
  const b = img(30, 10, () => [180, 175, 170]);
  const curve = ShadowLift.curveFor(ShadowLift.measure(b, instance, TIERS));
  assert.equal(curve.applied, false);
});

test('applied:false のカーブを適用しても絵は1バイトも変わらない', () => {
  const out = ShadowLift.apply(base, { applied: false });
  assert.deepEqual(Array.from(out.data), Array.from(base.data));
});
```

- [ ] **Step 2〜5:** 落ちることを確認 → 実装 → 通ることを確認 → コミット

```bash
git add assets/js/shadow-lift.js tools/tests/shadow-lift.test.cjs
git commit -m "Lift crushed shadows at export so finishes are visible to the model"
```

---

### Task 7: パッケージの組み立てとダウンロード

**Files:**
- Modify: `index.html`（`generateVideoRenderPackage()` の追加）
- Test: `tools/tests/video-package.test.cjs`

**Interfaces:**
- Consumes: Task 1〜6 のすべて、既存の `captureCurrent3DDataUrl` / `captureSegmentation3DDataUrl`
  / `captureInstance3DData` / `captureAiOverrideGuideDataUrl` / `makeEdgeDataUrlFromSegmentation`
- Produces: ZIP のダウンロード

**先に読むこと:** `generateAiRenderPackage()`（17563行付近）と、その下の
`aiRenderPackageJsonText()` / `makeAiDownloadObjectUrl()` / ダウンロードリンク生成。

**ガイド生成経路は共有する。** 動画版のために別のキャプチャ経路を作らない（設計 §11）。
既存の関数をそのまま呼ぶ。

**ZIP の中身（設計 §12.3）:**

| 既定 | ファイル |
|---|---|
| ○ | `reference.png`（暗部持ち上げ後）、`plan_context.png`、`prompt.txt`、`package.json` |
| 任意 | `edge_guide.png`、`depth_guide.png`、`normal_guide.png`、`segmentation_guide.png`、`instance_guide.png`、`instance-legend.json`、`segmentation-legend.json` |

`package.json` に入れるもの: カメラ（位置・注視点・fov・視点高さ）、時刻/季節プリセット、
フロア、**Task 4 の色→階層表**、**Task 6 の適用カーブ**、尺、プリセットid、
`heightModel`（この撮影で使われた階高・各室の天井高）。

- [ ] **Step 1: 失敗するテストを書く**

```js
// tools/tests/video-package.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
const pkg = html.slice(html.indexOf('function generateVideoRenderPackage'),
                      html.indexOf('function generateVideoRenderPackage') + 8000);

test('generateVideoRenderPackage が存在する', () => {
  assert.match(html, /function generateVideoRenderPackage\(/);
});

// 二重化は必ず片方が腐る。動画版のために別のキャプチャ経路を作らない。
test('ガイドは既存のキャプチャ関数を使う', () => {
  assert.match(pkg, /captureInstance3DData\(/);
  assert.match(pkg, /captureCurrent3DDataUrl\(/);
});

test('参照画像は暗部持ち上げを通ってから書き出される', () => {
  assert.match(pkg, /ShadowLift\.(curveFor|apply)/);
});

test('適用したカーブは package.json に記録される', () => {
  assert.match(pkg, /shadowLift/);
});

test('色→階層の表が package.json に入る', () => {
  assert.match(pkg, /LockTiers\.tableFor\(/);
});

test('詳細ガイドは既定で入らない', () => {
  assert.match(pkg, /includeGuides/);
});

// 既存ユーザーの出力を変えない。
test('既存の generateAiRenderPackage は動画側の処理を通らない', () => {
  const still = html.slice(html.indexOf('async function generateAiRenderPackage'),
                           html.indexOf('async function generateAiRenderPackage') + 6000);
  assert.doesNotMatch(still, /ShadowLift\.apply/);
});
```

- [ ] **Step 2〜4:** 落ちることを確認 → 実装 → 通ることを確認

- [ ] **Step 5: 実機で ZIP を1つ書き出し、中身を確認する**

デフォルトプランの2F LDK を目線高さで捉え、`render-to-life` プリセットで生成。
確認: 既定で4ファイル、`reference.png` が暗部の潰れていない絵、
`plan_context.png` にカメラの三角形と天井高、`prompt.txt` の禁止が末尾のみ。

- [ ] **Step 6: コミット**

```bash
git add index.html tools/tests/video-package.test.cjs
git commit -m "Build the video material package from the shared guide path"
```

---

### Task 7b: 平面図を参照そのものにする経路

**Files:**
- Modify: `index.html`（`generateVideoRenderPackage` に平面図ソースを足す）
- Test: `tools/tests/video-package.test.cjs`（追記）

**なぜ必要か:** 設計 §4.1 と §8.1 は「平面図を参照として渡し、それが家に変わっていく」
表現を柱の一つに置いている。Task 7 が作ったのは**3Dビューを参照にする経路だけ**で、
平面図は `plan_context.png`（構図を人間が把握するための添え物）として入るだけ。

このままだと Task 8 で `plan-to-life` プリセットを出した瞬間、
**参照は3Dレンダなのにプロンプトは「図面から始めよ」と言う**組み合わせが作れてしまう。
実測では、その組み合わせは生成AIに渡した映像を捨てさせ、線画を描き直させる。
Task 8 の前にここを塞ぐ。

**やること:**
1. `generateVideoRenderPackage({source:'plan'})` で、`reference.png` を**平面図**にする
   （Task 3 の `capturePlan2dDataUrl` を使う。注記抜き・天井高ラベルあり）
2. そのとき `VideoPrompt.presetsFor('plan')` を使う（`'3d'` ではなく）
3. 平面図が参照のときガイド類（depth/normal/segmentation/instance）は3Dのものと
   **構図が一致しない**。既定オフのままとし、**opt-in してもこの経路では入れない**。
   構図の合わないガイドは生成AIを誤らせるだけで、無い方が良い。
4. `package.json` の `source` に `'plan'` / `'3d'` を記録する

**やらないこと:** 平面図に対する暗部の持ち上げ。平面図は元から明るく、
`ShadowLift` は3Dレンダの潰れた影のためのもの。この経路では適用しない
（適用しないことを `shadowLift: {applied:false, reason:'plan source'}` として記録する）。

- [ ] **Step 1: 失敗するテストを書き、赤を確認する**

```js
test('平面図ソースでは reference.png が平面図で、プリセットは図面系になる', () => {
  const fn = html.slice(html.indexOf('function generateVideoRenderPackage'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /capturePlan2dDataUrl/);
  assert.match(body, /presetsFor\(\s*['"]plan['"]/);
});

test('平面図ソースでは構図の合わないガイドを同梱しない', () => {
  const fn = html.slice(html.indexOf('function generateVideoRenderPackage'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  // opt-in していても plan ソースではガイドを入れない
  assert.match(body, /source\s*===\s*['"]plan['"]/);
});

test('package.json は参照の出どころを記録する', () => {
  assert.match(html, /source:\s*(source|state\.source)/);
});
```

- [ ] **Step 2〜4: 実装 → 実際にパッケージを1つ書き出して中身を見る → コミット**

平面図ソースで生成し、`reference.png` が注記抜きの平面図（天井高ラベルあり）で、
`prompt.txt` が図面系プリセットの本文になっていること、ガイドが入っていないことを
実物で確認する。

```bash
git add index.html tools/tests/video-package.test.cjs
git commit -m "Let the plan drawing itself be the reference"
```

---

### Task 7c: 平面図経路を成果物として成立させる

**Files:**
- Modify: `index.html`（`capturePlan2dDataUrl`、`generateVideoRenderPackage`、新規の部材一覧関数）
- Test: `tools/tests/plan-capture.test.cjs`、`tools/tests/video-package.test.cjs`（追記）

**なぜ必要か:** Task 7b で平面図が参照になったが、実測で3つの欠落が出た。
どれも「動くが成果物にならない」種類のもので、UI (Task 8) を載せる前に潰す。

#### 7c-1 構図を検査する

平面図はユーザーの現在のパン・ズームのまま撮られる。実測では**家がフレームの15%**
しか占めていなかった。主題が15%の参照画像は生成の材料にならない。

- `capturePlan2dDataUrl` に `fit:true` を足す。設計対象（壁・部屋・建具・家具、
  敷地と隣家は除く）のバウンディングボックスを求め、余白を1割足して収める。
  **パン・ズームは撮影中だけ変え、`finally` で必ず戻す**（Task 3 と同じ形）。
- パッケージ生成は、主題のバウンディングボックスがフレーム面積の
  **一定割合を下回ったら例外**を投げる。閾値は実測して決め、根拠をコメントに残す。
  検出できない不良を出荷しないことが目的で、静かに小さい絵を通す方が悪い。

#### 7c-2 平面図経路にも部材の名指しを戻す

現状、平面図経路のプロンプトは第2節（LOCKED の名指し）を丸ごと欠く。
これは仕様が固定した構成比の 20〜30% にあたり、**仕様を満たさないプロンプトを
出荷している**状態。

原因はインスタンスレジェンドが3Dレンダの副産物であること。ただし
**`DATA` こそが真実源で、レジェンドの方が派生物**である。

- `planInstanceList(floor)` を1つ作る。`DATA.walls` / `DATA.rooms` / `DATA.items`
  から、レジェンドと同じ形（`{id, type, floor, tier}`）の配列を作る。
  階層は `LockTiers.tierOf` を通す — **分類規則をここに書き写さない**。
- 平面図経路はこれを `VideoPrompt.compose` に渡す。色は無い（ガイド画像が無いので
  色で切り出す相手がいない）ので `color` は省略し、composer が色を必要としない
  ことを確かめる。必要としていたなら、それは composer 側の直すべき結合。
- `package.json` の `instances` も、この一覧で埋める（現在は `null`）。

#### 7c-3 解像度を揃える

平面図 1400×900 に対し3Dは 2800×1800。`capturePlan2dDataUrl` に `scale` を足し、
パッケージ生成は3D経路と同じ画素数で撮る。

- [ ] **Step 1: 失敗するテストを書き、赤を1つずつ確認する**

**この計画では grep のアサーションが4回、未修正のコードに対して通っている。**
テストは grep ではなく**出力の性質**を見ること。例:

```js
// 構図: 主題がフレームの一定割合を占めること。実画像から測る。
test('fit:true の平面図は主題がフレームの相当割合を占める', () => { /* 実画像を測る */ });
test('主題が小さすぎる参照は例外になり、出荷されない', () => { /* ... */ });
// 名指し: 平面図経路のプロンプトが第2節を持つこと
test('平面図経路のプロンプトも LOCKED を名指しする', () => { /* compose の出力を見る */ });
test('平面図経路の package.json の instances が null でない', () => { /* ... */ });
```

- [ ] **Step 2〜4: 実装 → 実画像で確認 → コミット**

実際にパッケージを平面図経路で1つ書き出し、`reference.png` を**見て**、
家がフレームを十分に占めていること、`prompt.txt` が窓や階段を名指ししていること、
画素数が3D経路と揃っていることを確認する。

```bash
git add index.html tools/tests/plan-capture.test.cjs tools/tests/video-package.test.cjs
git commit -m "Make the plan path ship something usable"
```

---

### Task 8: UI — 動画AIレンダーのボタンとダイアログ

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 5 の `VideoPrompt.presetsFor`、Task 7 の `generateVideoRenderPackage`

**先に読むこと:** 既存の AIレンダー のツールバーボタン（3078行付近）、
FAB（3235行付近）、モーダル（3332行付近）。**同じ導線・同じ構成に寄せる。**

要素:
- ツールバーと FAB に `🎬 動画AIレンダー`
- ダイアログ: 表現プリセットのセレクタ（**選ぶとプロンプト入力欄に自動で入り、書き換えられる**）、
  尺のスライダ（4〜15秒、既定8）、「詳細ガイドを含める」チェックボックス（既定オフ）
- 平面図を撮っているときは図面系プリセットだけ、3Dのときは3D系だけ（Task 5 の `presetsFor`）

- [ ] **Step 1: 実装する**
- [ ] **Step 2: 実機で操作して確認する**

プリセットを切り替えると入力欄が入れ替わること。手で書き換えた後にプリセットを
選び直すと上書きされること（ユーザーが意図して選び直した以上、それが期待）。
2Dビューに切り替えるとプリセットの一覧が入れ替わること。

- [ ] **Step 3: 既存の AIレンダー が変わっていないことを確認する**

同じプランで静止画AIレンダーを実行し、変更前の出力と `prompt.txt` を diff する。
**差分ゼロであること。**

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "Add the video AI render entry point beside the still one"
```

---

### Task 9: 判定器を階層表に対応させる

**Files:**
- Modify: `pv/tools/fidelity-qa/categories.py`、`pv/tools/fidelity-qa/report.py`
- Test: `pv/tools/fidelity-qa/tests/test_categories.py`、`tests/test_report.py`

**Interfaces:**
- Consumes: Task 7 が書き出す `package.json` の色→階層表
- Produces: 階層ごとに閾値を変えた判定

**先に読むこと:** `pv/tools/fidelity-qa/categories.py` の現在の分類と、
`report.py` の必須閾値（`--min-locked-recall` 等）。

**方針:** `package.json` に階層表があればそれを使い、無ければ現在の分類にそのまま落ちる。
**既存の PV 用の実行を壊さない。**

| 指標 | LOCKED | SOFT | FREE |
|---|---|---|---|
| 輪郭の再現 | 厳格 | 緩い | 対象外 |
| 輪郭の発明 | 厳格 | 緩い | 対象外 |
| 部材ごとの仕上げ変化 | 厳格 | 緩い | 対象外 |
| 個数 | 完全一致 | 完全一致 | 対象外 |

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_tier_table_from_package_overrides_the_builtin_classification(self):
    # package.json が階層を宣言していれば、それが優先される。
    table = {'#aabbcc': 'SOFT'}
    self.assertEqual(tier_for('#aabbcc', 'wall', table), 'SOFT')

def test_without_a_tier_table_the_builtin_classification_is_used(self):
    # 既存の PV 実行は package.json を持たない。壊さない。
    self.assertEqual(tier_for('#aabbcc', 'wall', None), 'LOCKED')

def test_free_tier_instances_are_not_measured_at_all(self):
    # 周辺環境や人は生成AIの領分。ここを測ると必ず落ちる。
    ...
```

- [ ] **Step 2〜5:** 落ちることを確認 → 実装 → 全テスト通過 → コミット

```bash
git add pv/tools/fidelity-qa/categories.py pv/tools/fidelity-qa/report.py \
        pv/tools/fidelity-qa/tests/test_categories.py pv/tools/fidelity-qa/tests/test_report.py
git commit -m "Let the package's tier table drive the fidelity thresholds"
```

---

## 完了時の確認

- [ ] `node --test "tools/tests/*.test.cjs"` が全通過
- [ ] `node --test "pv/tools/truth-render/tests/*.test.mjs"` が全通過（115件）
- [ ] `python3 -m unittest` で fidelity-qa と truth-render の Python テストが全通過
- [ ] `node tools/check-html-js.cjs` が通る
- [ ] **既存プランの3Dバウンディングボックスとメッシュ数が、この計画の実施前と一致する**
- [ ] **既存の静止画AIレンダーの出力が、この計画の実施前と diff ゼロ**
- [ ] `assets/default_plan.json` が変更されていない
