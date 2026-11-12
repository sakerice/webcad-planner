# 段2 物を作る関数と差分の適用を plan-core に置く Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 壁・物・部屋を作る処理と、共同編集の差分を当てる処理を、画面にも Worker にも依存しない部品（`assets/js/plan-core/`）に1つずつ置く。画面と Worker は同じ部品を呼ぶ。

**Architecture:** `assets/js/plan-core/` に UMD を2本作る（手本は `assets/js/plan-check.js`）。`factories.js` は `makeWall` / `makeItem` / `makeRoom` を持ち、id の発行とカタログは引数の `ctx` から受け取る。`patch.js` は `applyPatch` と、共有する欄の一覧を持つ。画面側の `mkWall` / `mkItem` / `applySharedPatch` と Worker の `applyPatch` は、これを呼ぶ薄い包みに変える。作られる物の中身は今と1項目も変えない。

**Tech Stack:** 素の JS（UMD とクラシックスクリプト）、node（`node:test`）、Playwright（`tools/run_browser_tests.sh`）、Cloudflare Worker（`worker/*.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-10-one-source-platform-design.md`（3.1 の2・3、4章の3・5、3.6 の段2）

## Global Constraints

- **既存利用者の保存プランが、今の本番と同じ中身で開くこと。** `tools/tests/plan-compat.browser.mjs` の正解（`fixtures/compat/golden.json`）は、この段では作り直さない。落ちたら実装を直す。
- `mkWall` / `mkItem` が返す物は、種類ごとに今と同じ項目・同じ値・同じ項目の順番であること（保存 JSON の並びが変わらないようにする）。Task 1 で記録した正解は、この段の中で作り直さない。
- 既存のプランの id は書き換えない。新しく作る物の id の形も、今の呼び出し元ごとの形のままにする（壁と物は連番の数値、取り込みの部屋は `'rm_'+連番`、2D で描いた部屋は `'rm_'+Date.now()`）。
- plan-core の2本は、`DATA`・`ST`・`document`・`window` などのグローバルに触らない。必要なものはすべて引数で受ける。
- リポジトリ直下に `package.json` を置かない。ビルドは必ず `SKIP_DEPLOY=1 bash build.sh`。
- 作業ブランチは `feat/stage2-factories-patch`（段1の `feat/stage1-load-normalize` から切る。段1の PR #121 が main に入ったら main に付け替える）。main への push・マージは利用者の確認なしにしない。
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`。

## Review Focus

- カタログに無い種類名で物を作る（古いプランの種類、打ち間違い）→ 今と同じく 900×900・色 `#ddd` の物が返り、例外にならない。Task 2 の単体テストで固定する。
- 差分の `fields` に `walls` や `viewState` が混ざって届く（壊れた送り手、古い版）→ 壁の配列と各自の視点は上書きされない。Task 4 の単体テストで固定する。
- 差分の `upserts` に `null` が混ざる、`removes` と `upserts` に同じ id がある → 今と同じ結果（`null` は無視、同じ id は入れ直し）になる。Task 4。
- 古い版のページ（ブラウザに残った前の JS）と新しい版が同じルームにいて、新しく共有する欄（Task 5）が古い版に届く → 古い版は知らない欄もそのままプランに書くだけで、落ちない。逆に古い版はその欄を送らないので、新しい版は欄が無い差分を受けても今の値を保つ。Task 5 のテストで固定する。
- 相手が壁の高さの既定を変えたあと、自分が新しく引く壁 → 相手と同じ高さになる。Task 5。

---

### Task 1: 今の `mkWall` / `mkItem` が作る物を、全種類ぶん正解に記録する

**Files:**
- Create: `tools/tests/factories-golden.browser.mjs`
- Create: `tools/tests/fixtures/factories/golden.json`（この Task でだけ作る）
- Create: `tools/tests/fixtures/factories/README.md`

**Interfaces:**
- Produces: `golden.json` = `{ walls: [...], items: { <type>: {...} }, nextIdDelta: {...} }`。Task 3 がこれと比べる。

- [ ] **Step 1: テストを書く**

空のプラン（`chooseBlankPlan`）で起動し、モデルのカタログ（`FMP_ITEMS`）が読み終わるのを待ってから、ページの中で次を集める。
- 種類の一覧: `Object.keys(ISIZES)` と `Object.keys(FMP_ITEMS)` と `Object.keys(LEGACY_FMP_TYPE_MAP)` の和に、`'no-such-type'` を足したもの。名前順に並べる。
- 各種類について `mkItem(type, 100, 200, 90, 2)` と `mkItem(type, 0, 0, 0, 1, 1234, 567)` の結果。`id` は呼ぶ前後の `nextId` の差（1 であること）だけを記録し、物からは除く。項目の順番も比べられるよう、`Object.keys` の並びも記録する。
- `mkWall(0,0,1000,0)`、`mkWall(0,0,0,1000,2,90,'#123456')` の結果（`_texObj` は除く）。
- 基礎（`foundation`）を1つ置いた状態で `mkItem('exterior-stair',...)` と `mkItem('ramp',...)`（`targetHeight` が基礎の高さを引くため）。
- 階ごとの高さを ON にして2階の壁の高さを 2600 にした状態での `mkWall(0,0,1000,0,2)`。

`UPDATE_GOLDEN=1` のときだけ `golden.json` を書き、それ以外は比べて、違う種類名と項目名を出して落とす（`plan-compat.browser.mjs` の `describeDiff` と同じやり方）。

- [ ] **Step 2: 正解を記録する（変更前のコードで）** `UPDATE_GOLDEN=1 PLAYWRIGHT_MODULE=… sh tools/run_browser_tests.sh factories-golden`
- [ ] **Step 3: 続けて2回走らせ、正解どおりに通ることを確かめる** → PASS（読み込みの順番で揺れないこと）
- [ ] **Step 4: コミット** `git commit -m "壁と物を作る関数の今の出力を、全種類ぶん正解に記録する"`

### Task 2: `plan-core/factories.js` を作る

**Files:**
- Create: `assets/js/plan-core/factories.js`（UMD。ブラウザでは `PlanCoreFactories`）
- Test: `tools/tests/plan-core-factories.test.cjs`

**Interfaces:**
- Produces:
  - `makeWall(args, ctx) -> wall`。`args = { x1, y1, x2, y2, floor?, thick?, color? }`。
  - `makeItem(type, args, ctx) -> item`。`args = { x, y, rot?, floor?, w?, d? }`。
  - `makeRoom(args, ctx) -> room`。`args = { x, y, w, d, floor?, n?, id? }`。`id` が無ければ `'rm_' + ctx.newId()`。返す項目は今の2か所（`index.html` の2D描画、`plan-import.js` 1038行付近）に共通の `id, type:'room', x, y, w, d, floor, floorRaiseMm, textureFlipX:false, textureFlipY:false` と、`n` が渡されたときの `n`。項目の順番は呼び出し元ごとに今と同じになるよう、`n` の位置は `plan-import.js` の並び（`floor` の次）に合わせる。
  - `ctx` の形（この段で決め、段3以降もこれを使う）:

```js
ctx = {
  newId: function () {},              // 連番の数値を1つ返す
  catalog: {
    resolveType: function (type) {},  // 古い種類名を今の名前へ（今の bestFmpType）
    defaultSize: function (type) {},  // { w, d }（今の getItemDefaultSize）
    defaultColor: function (type) {}, // 無ければ undefined（今の ICOLORS[type]）
    model: function (type) {},        // モデルのカタログの項目か null（今の getFmpItem）
    is: function (kind, type) {},     // kind: 'light' | 'contextExterior' | 'windowLike' | 'doorLikeOpening' | 'doorPanel'
    canSetElevation: function (item) {},
    applyLightDefaults: function (item) {},      // 今の ensureLightDefaults
    contextExteriorHeight: function (type) {},
    contextFloors: function (type) {},
    constants: { rulerThickness, walkRouteThickness, walkDefaultSpeed }
  },
  plan: {
    wallHeightForFloor: function (floor) {},     // 今の defaultWallHeightMmForFloor
    floorRaiseForFloor: function (floor) {},     // 今の newRoomFloorRaiseMm
    foundationHeight: function () {}             // 今の foundationHeightMm
  }
}
```

- [ ] **Step 1: 失敗するテストを書く**（`ctx` は偽物。`newId` は 1 から数える）
  - `test('makeWall は既定の厚み120・色#888888・階1で作る')`: 項目の並びが `id,x1,y1,x2,y2,floor,thick,color,texture,textureFlipX,textureFlipY,texScale,_texObj,wallBand,wallStyle,wallHeight,wallTopShape,wallTopSide`、`wallHeight` は `ctx.plan.wallHeightForFloor(1)` の値。
  - `test('makeItem は newId を1回だけ呼ぶ')`
  - `test('カタログに無い種類は 900×900・#ddd で作り、例外にしない')`: `defaultSize` が `{w:900,d:900}`、`defaultColor` が `undefined` を返す偽物で確かめる。
  - `test('窓は腰高900・高さ1200、掃き出し窓は腰高0・高さ2100')`
  - `test('makeRoom は id を渡せばそれを使い、無ければ rm_連番')`
  - `test('plan-core はグローバルに触らない')`: ソースに `DATA`・`ST.`・`document`・`window.`・`nextId` の語が無いこと。
- [ ] **Step 2: 失敗を確かめる** `node tools/tests/plan-core-factories.test.cjs` → FAIL
- [ ] **Step 3: 実装する。** 種類ごとの分岐は、今の `mkWall` / `mkItem`（`assets/js/plan-data.js` 31〜129行）を、分岐の順番を変えずに移す。グローバルの参照を上の `ctx` の呼び出しに置き換えるだけにする。
- [ ] **Step 4: テストを通す** → PASS
- [ ] **Step 5: コミット** `git commit -m "壁・物・部屋を作る関数を plan-core に置く"`

### Task 3: 画面側を `plan-core/factories.js` の包みに変える

**Files:**
- Modify: `index.html`（`<script src="assets/js/plan-core/factories.js">` を `assets/js/app-constants.js` の前に足す。2D で部屋を描く 18846行付近を `makeRoom` に）
- Modify: `assets/js/plan-data.js`（`mkWall` / `mkItem` を包みに。`planCoreCtx()` を足す）
- Modify: `assets/js/plan-import.js`（1038行付近の部屋を `makeRoom` に）
- Modify: `tools/tests/app-source.cjs` を使うテストのうち、`mkItem` / `mkWall` の本体を名前で切り出しているもの（あれば）

**Interfaces:**
- Consumes: Task 2 の `PlanCoreFactories`。
- Produces: `function planCoreCtx() -> ctx`（`assets/js/plan-data.js`）。Task 2 の `ctx` を今のグローバルから組み立てる。`newId` は `nextId++`。呼ぶたびに作ってよい（状態を持たない）。段3の操作もこれを使う。
- `mkWall(x1,y1,x2,y2,floor,thick,color)` と `mkItem(type,x,y,rot,floor,w,d)` の引数と戻り値は変えない。

- [ ] **Step 1: 置き換える。** 2D で描く部屋は `makeRoom({..., id:'rm_'+Date.now()}, planCoreCtx())`、取り込みの部屋は `id` を渡さず `'rm_'+連番` のままにする。取り込みが部屋に後から足している欄（スキップフロアなど）は呼ぶ側に残す。
- [ ] **Step 2: Task 1 の正解どおりに通ること** `sh tools/run_browser_tests.sh factories-golden` → PASS（正解は作り直さない）
- [ ] **Step 3:** `sh tools/run_tests.sh` → `exit=0`、`sh tools/run_browser_tests.sh plan-compat` → PASS、`sh tools/run_browser_tests.sh plan-import` → PASS
- [ ] **Step 4:** `SKIP_DEPLOY=1 bash build.sh` が通り、`dist/assets/js/plan-core/factories.js` があること
- [ ] **Step 5: コミット** `git commit -m "画面の mkWall・mkItem・部屋の作成を、plan-core の関数に通す"`

### Task 4: 差分の適用を `plan-core/patch.js` の1つにする

**Files:**
- Create: `assets/js/plan-core/patch.js`（UMD。ブラウザでは `PlanCorePatch`）
- Modify: `worker/shared.mjs`（`applyPatch` と `COLLECTIONS` を plan-core から取って、同じ名前で export し直す）
- Modify: `index.html`（`<script>` を足す。`applySharedPatch` の中の当て方、`SHARED_FIELDS`、`sharedBaselineFrom`・`buildSharedPatch` の `['walls','items','rooms']`）
- Test: `tools/tests/plan-core-patch.test.cjs`（新規）、`tools/tests/worker-routes.test.cjs` の既存の「差分の当て方は元のまま」はそのまま通す

**Interfaces:**
- Produces:
  - `PlanCorePatch.COLLECTIONS = ['walls','items','rooms']`
  - `PlanCorePatch.SHARED_FIELDS`（この Task では今の6つ: `exteriorWallSettings, interiorWallSettings, roofAppearance, exteriorDetail, floorMetadata, northDeg`）
  - `PlanCorePatch.applyPatch(plan, patch, options) -> plan`。`plan` をその場で直す。`options.clone`（省略可）は、プランに入れる前に値へ通す関数（画面は `_texObj` を落とす `sharedClone` を渡し、Worker は渡さない）。
  - `fields` の扱いは Worker の今の決まりに揃える: `COLLECTIONS` の名前と `viewState` は書かない。それ以外の鍵は書く（`SHARED_FIELDS` に無い鍵も書く。古い版・新しい版が混ざっても欄を落とさないため）。

どちらに揃えるかの判断（PR の説明に書く）: 今の画面側は `fields.walls` が届くと壁の配列を丸ごと上書きする。正しい送り手は `fields` に配列を入れないので、Worker の決まり（配列の名前は書かない）に揃えても、今の利用者の動きは変わらない。

- [ ] **Step 1: 失敗するテストを書く**
  - `test('追加・更新・削除')`: `worker-routes.test.cjs` 272行の例と同じ入力で同じ結果。
  - `test('fields の walls と viewState は書かない')`
  - `test('SHARED_FIELDS に無い鍵も書く')`: `fields: { somethingNew: 1 }` → `plan.somethingNew === 1`。
  - `test('upserts の null は無視する')`、`test('removes と upserts に同じ id があれば入れ直す')`
  - `test('clone を渡すと、入れた物は差分の物と別の実体になる')`
  - `test('plan に配列が無ければ空の配列を作る')`
  - `test('画面と Worker が同じ関数を使っている')`: `worker/shared.mjs` と `index.html` のどちらにも、`removes` を回して配列を作り直す自前の実装が残っていないこと（`applyPatch` の本体が plan-core にしか無い）。
- [ ] **Step 2: 失敗を確かめる** → FAIL
- [ ] **Step 3: 実装して、画面と Worker を置き換える。** `applySharedPatch` の選択の復元・`normalizeLoadedPlan({resetHeights:false,restoreView:false})`・履歴・描画・`SHARED.baseline` の更新は今のまま残し、配列と欄を当てる2文だけを `PlanCorePatch.applyPatch(DATA, patch, {clone: sharedClone})` に変える。
- [ ] **Step 4:** `sh tools/run_tests.sh` → `exit=0`、`sh tools/run_browser_tests.sh plan-compat`（`shared-patch`・`shared-patch-fields` の経路を含む）→ PASS。Worker が plan-core を読み込めることは、`worker-routes.test.cjs`（`worker/shared.mjs` と `worker/router.mjs` を実際に import している）が通ることで確かめる
- [ ] **Step 5: コミット** `git commit -m "共同編集の差分の当て方を、画面と Worker で同じ1つの関数にする"`

### Task 5: 共有する欄に、高さの既定と自動照明の設定を足す

今は、相手が「壁の高さの既定」「階ごとの高さ」「部屋の自動照明を切る」を変えても、同じルームの他の人には届かない（ルームに入り直すと届く）。設計書 3.6 の段2「共同編集の欄の食い違いがなくなる」をここで満たす。

**Files:**
- Modify: `assets/js/plan-core/patch.js`（`SHARED_FIELDS` に `heightDefaults`、`floors`、`autoRoomLights` を足す）
- Test: `tools/tests/shared-fields.browser.mjs`（新規）、`tools/tests/plan-core-patch.test.cjs`

**Interfaces:**
- Consumes: Task 4 の `PlanCorePatch.SHARED_FIELDS`。
- 足さない欄: `viewState`（各自の視点）、`planFixes`（1度だけ走る移行の済み印。各自の読み込みで付く）、`camStash`。

- [ ] **Step 1: 失敗するテストを書く**（サーバーは使わず、ページを2枚開いて差分を手で運ぶ）
  - 2枚とも同じ fixture（`tools/tests/fixtures/compat/` のプラン）を開き、`SHARED.baseline=sharedBaselineFrom(DATA)` を取る。
  - 1枚めで `setDefaultWallHeight(null, 2600)` を呼び、`buildSharedPatch(DATA, SHARED.baseline)` の結果を2枚めの `applySharedPatch(patch, false)` に渡す。
  - `test('相手が変えた壁の高さの既定が届く')`: 2枚めの `WALL_H === 2600`、`mkWall(0,0,1000,0).wallHeight === 2600`、既存の壁の高さが1枚めと同じ。
  - `test('階ごとの高さが届く')`: 1枚めで `setPerFloorHeights(true)` と2階の高さの変更 → 2枚めの `DATA.floors` と `perFloorHeightsEnabled()` が同じ。
  - `test('自動照明を切った設定が届く')`
  - `test('欄の無い差分を受けても今の値を保つ')`: `fields:{}` の差分を当てても `DATA.heightDefaults` が変わらない（古い版の送り手を想定）。
  - `test('視点は届かない')`: 2枚めの `DATA.viewState` と表示位置が変わらない。
- [ ] **Step 2: 失敗を確かめる** → 最初の3つが FAIL
- [ ] **Step 3: 欄を足す。** 受けた側で 3D・2D・設定パネルが新しい高さで描き直されることを確かめ、足りなければ `applySharedPatch` の今の描画の呼び出しの範囲で直す（`heightDefaultsChanged()` は `markDirty` を呼んで送り返してしまうので使わない）。
- [ ] **Step 4:** `sh tools/run_browser_tests.sh shared-fields` → PASS、`sh tools/run_browser_tests.sh plan-compat` → PASS（正解のまま）
- [ ] **Step 5: コミット** `git commit -m "共同編集で、壁の高さの既定・階ごとの高さ・自動照明の設定も相手に届くようにする"`

### Task 6: 全体を確かめて PR を作る

- [ ] **Step 1:** `sh tools/run_tests.sh` → `exit=0`、`sh tools/default-plans/check.sh` → 通る、`sh tools/run_browser_tests.sh`（全部）→ 全部 PASS、`SKIP_DEPLOY=1 bash build.sh` → 通る
- [ ] **Step 2: 内蔵ブラウザで触って確かめる。** 既定プランを開き、壁を1本引く・家具を1つ置く・部屋を1つ描く・取り消す。保存して開き直す。2D と 3D を見て、コンソールにエラーが無いこと。スクリーンショットを PR に添える。
- [ ] **Step 3: 設計書に結果を書き足す。** 3.6 の表の下に「段2の結果」として、揃えた決まり（Task 4）と足した欄（Task 5）、id の形を変えなかったこと、見つけて直さなかったことを書く。
- [ ] **Step 4: PR を作る。** 説明に、Task 4 の判断、Task 5 で利用者から見て変わること、互換テストの結果を書く。main へのマージは利用者に確認する。

## この段でやらないこと（見つけてあるが直さない）

- 壁と物の id は各自の連番なので、共同編集で2人が同時に物を足すと同じ id になり得る。id の発行は `ctx.newId` の1か所になったので、直すならそこを変える。直し方（ルームから番号の範囲をもらう、乱数の id にする）は保存の形に関わるので、別に相談する。
- Worker 用の `ctx.catalog`（カタログを Worker で読める形にすること）は段5で作る。この段の Worker は差分の適用だけを使う。
- 段1で持ち越した、古い保存の壁の高さを 2400 と 2688 のどちらにそろえるかの判断。
