# 段3 操作（applyOperations）と検査（inspectPlan） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 間取りを変える操作を `assets/js/plan-core/operations.js` の1か所にまとめ、画面の `placeItem` / `delSel` / `updateSelectedProp` をそれを呼ぶ薄い包みに変える。利用者から見た動きと保存される中身は変えない。

**Architecture:** 操作は `{op, args}` の列で、`applyOperations(plan, ops, ctx)` が写しに当てて結果を返す（全部か無しか）。画面は1操作だけを `ctx.inPlace` で `DATA` に直接当てる。グローバルに依存する処理（置いたときの高さ決め、開口のプリセットなど）は `ctx` の関数として画面側から渡す。操作の名前・説明・引数の JSON Schema は `operations-catalog.js` に1回だけ書き、段4（チャット）と段5（MCP）の道具の定義はここから作る。

**Tech Stack:** 素の JavaScript（UMD、ビルド無し）、Node の `node:test` 相当の既存テスト（`tools/tests/*.test.cjs`）、Playwright の画面テスト（`tools/tests/*.browser.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-10-one-source-platform-design.md`（3.1 の 4・5、3.2、3.6 の段3）

## Global Constraints

- **既存利用者の保存プランが、今の本番と同じ中身で開くこと。** `tools/tests/plan-compat.browser.mjs` の正解（`fixtures/compat/golden.json`）と `fixtures/factories/golden.json` は、この段では作り直さない。落ちたら実装を直す。
- 画面の `placeItem` / `delSel` / `updateSelectedProp` が作る・変える物は、今と同じ項目・同じ値・同じ項目の順番であること。Task 1 で記録した正解（`fixtures/operations/golden.json`）は、この段の中で作り直さない。
- 既存のプランの id は書き換えない。新しく作る物の id の形も、今の呼び出し元ごとの形のままにする（壁と物は連番の数値、2D で描いた部屋は `'rm_'+Date.now()`）。
- `assets/js/plan-core/` のファイルは、`DATA`・`ST`・`document`・`window` などのグローバルに触らない。必要なものはすべて引数（`plan`、`ctx`）で受ける。例外は `inspect.js` が兄弟モジュール（`PlanSchema`・`PlanCheck`・`PlanStructure`）を UMD の `root` から**呼ばれた時点で**引くことだけ。
- 扉・窓を壁へ寄せる処理は、今は描画時だけで行い、保存される座標は動かしていない。この段でも保存される座標は動かさない。
- 利用者に見える文言・画面の見た目は変えない。
- リポジトリ直下に `package.json` を置かない。ビルドは必ず `SKIP_DEPLOY=1 bash build.sh`。`.dev.vars` は読まない・出さない。`reference-textures/` に触らない。画面のある Chrome を立てない（画面テストは headless）。
- テストから既定プラン（`default_plan*.json`）を読まない（`fixture-only.test.cjs` の決まり）。凍結した間取りは `tools/tests/fixtures/` のものを使う。
- 作業ブランチは `claude/stage3-operations`。main への push・マージは利用者の確認なしにしない。
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`。
- 確認のコマンド: `sh tools/run_tests.sh`（末尾に `exit=0`）、`sh tools/default-plans/check.sh`、`SKIP_DEPLOY=1 bash build.sh`、画面テストは `PLAYWRIGHT_MODULE=/Users/nariiwa/Projects/echoglass/node_modules/playwright-core/index.js sh tools/run_browser_tests.sh <名前…>`。

## Review Focus

1. 共同編集中に操作で変えた物が相手に届くこと。送る候補は `SHARED.dirtyIds` の印で決まる。選択していない物を操作が変えたときも印が付くこと（Task 6 のテスト）。
2. 途中の操作が失敗したとき、プランが1項目も変わっていないこと。`inPlace` でも同じ（Task 3 のテスト）。
3. ロックした物が、操作経由で動かない・消えない・変わらないこと。ただし `locked`・`hidden3D`・`vis3D` の3項目はロック中でも変えられること（今の画面と同じ。Task 3・6）。
4. 知らない種類名・存在しない id・範囲外の数値を AI が渡したとき、例外で落ちず、`errors` に何が悪いかと候補が入ること（Task 3）。
5. 回転した物を中心座標で置く・動かすと、保存形の `x,y`（回転前の矩形の北西角）が `中心 − 幅奥行きの半分` になること（Task 3）。

## File Structure

- 新規 `assets/js/plan-core/snap.js`（`PlanCoreSnap`）: 格子・物の端・階段の吸着の純粋関数。
- 新規 `assets/js/plan-core/operations.js`（`PlanCoreOperations`）: `applyOperations` と各操作、`applyProp`。
- 新規 `assets/js/plan-core/operations-catalog.js`（`PlanCoreOperationsCatalog`）: 操作の名前・説明・引数の Schema、道具の定義の生成。
- 新規 `assets/js/plan-core/inspect.js`（`PlanCoreInspect`）: `inspectPlan`。
- 変更 `index.html`、`assets/js/app-state.js`、`assets/js/plan-data.js`、`assets/js/draw-2d.js`: 包みへの置き換え、`<script>` の追加。
- 変更 `tools/tests/app-source.cjs`: `EXTRACTED` に新しいファイルを足す。
- 新規テスト `tools/tests/operations-golden.browser.mjs`、`plan-core-snap.test.cjs`、`plan-core-operations.test.cjs`、`plan-core-operations-catalog.test.cjs`、`plan-core-inspect.test.cjs`、`operations-shared.browser.mjs`。

---

### Task 1: 画面の3関数の今の動きを記録する

**Files:**
- Create: `tools/tests/operations-golden.browser.mjs`
- Create: `tools/tests/fixtures/operations/golden.json`

**Interfaces:**
- Produces: `fixtures/operations/golden.json`。以後の Task はこれを変えずに通す。

作り方は `tools/tests/factories-golden.browser.mjs` に揃える（ページを開き、`page.evaluate` の中で画面の関数を呼び、結果を正解と比べる。`UPDATE_GOLDEN=1` のときだけ書き直す）。土台のプランは `tools/tests/fixtures/house-2f.json` を、既存の画面テストと同じ読み込み方で入れる。`Date.now` と `nextId` は固定する。各ケースの前にプランと `ST`（`tool`・`floor`・`snap`・`shiftKey`・`placingRot`・`selected`・複数選択）を同じ状態に戻す。

- [ ] **Step 1: 記録するケースを書く**

  1. `placeItem`: 種類は `ISIZES`・`FMP_ITEMS`・`LEGACY_FMP_TYPE_MAP` のキー全部（factories-golden と同じ集め方）。置く点は、1階の部屋の中の1点・1階の屋外の1点・2階の部屋の中の1点の3通り。回転は 0 と 90。記録するのは「増えた物の JSON（1件、無ければ `null`）」。これに加え、種類を 20 個ほどに絞って、`ST.shiftKey=true`（物の端への吸着）と、階段の部材を既存の階段のそばに置く場合を足す。
  2. `delSel`: 物1つ、壁1つ、部屋1つ、物と壁の複数選択、ロックした物を含む複数選択、`ST.selectAll`（1階・2階）。記録するのは「消えた id の並び」と「残った物の数（壁・物・部屋）」と `DATA.exteriorWallSettings` 相当（`syncExteriorWallSettings` が触る欄）。
  3. `updateSelectedProp`: `assets/js/app-state.js` の設定パネルが `updateSelectedProp(` に渡しているキーをソースから全部拾う（`tools/tests/plan-settable.test.cjs` が同じ拾い方をしている）。対象は壁・部屋・窓・扉・階段・照明・普通の家具・外構の物から1つずつ。値は、キーごとに「通常の値」「偽の値（`''`・`0`・`false`・`null` のうちその欄に入り得るもの）」の2通り。`noSave` は false。ロックした物に対する `locked`・`hidden3D`・`vis3D`・それ以外1キーも足す。記録するのは「変更後の対象の JSON」と、対象以外で変わった物の id と JSON（天井を変えたときに動く器具など）。
- [ ] **Step 2: `UPDATE_GOLDEN=1` で1回記録し、続けて通常の実行で通ることを見る**

  Run: `UPDATE_GOLDEN=1 PLAYWRIGHT_MODULE=… sh tools/run_browser_tests.sh operations-golden`、次に `UPDATE_GOLDEN` 無しでもう2回。
  Expected: 3回とも `ok`。2回めと3回めで正解のファイルに差分が出ない（`git diff --stat` が空）。差分が出るなら、固定していない入力（時刻・乱数・非同期の読み込み順）が残っているので直す。
- [ ] **Step 3: 記録が実際に見張っていることを確かめる**

  `placeItem` の中の `snapRectOriginToGrid` の呼び出しを一時的に外して実行し、落ちることを見てから戻す。`updateSelectedProp` の `windowTop` の後始末についても同じことをする。
- [ ] **Step 4: Commit**（`画面の配置・削除・設定変更の今の結果を記録する`）

### Task 2: 吸着を純粋関数にする

**Files:**
- Create: `assets/js/plan-core/snap.js`、`tools/tests/plan-core-snap.test.cjs`
- Modify: `assets/js/app-state.js`（`snapRectOriginToGrid`・`getEdgeCandidates`・`applyEdgeSnap`）、`index.html`（`stairSnapPosition`、`<script>`）、`tools/tests/app-source.cjs`

**Interfaces:**
- Produces（`PlanCoreSnap`）:
  - `snapRectOriginToGrid(x, y, w, d, rot, step) → {x, y}`
  - `edgeSnap(rect{x,y,w,d,rot}, plan, opts{floor, threshold, excludeIds}) → {x, y}`
  - `stairSnap(item, x, y, plan, opts{radius, partEdges(item)→辺の配列}) → {x, y}`

  戻り値の形は、今の画面の関数の戻り値に合わせてよい（今が配列なら配列）。名前と引数の順はこのとおりにする。

- [ ] **Step 1: 失敗するテストを書く** `plan-core-snap.test.cjs`。今の3関数の本文から、代表の入力と出力を5件ずつ（回転 0/90/45、格子 0・50・910、閾値の内と外、対象の階が違う物は候補にならない）書く。期待値は、変更前の画面の関数を `tools/tests/app-source.cjs` の仕組みで呼んで得た値を数値で書く。「グローバルに触らない」検査は `plan-core-factories.test.cjs:123` と同じ書き方で足す。
- [ ] **Step 2: 落ちることを見る**（`PlanCoreSnap` が無い）
- [ ] **Step 3: `snap.js` を実装し、画面の3関数を「グローバルを引数に詰めて呼ぶだけ」に変える。** `<script>` は `factories.js` の直後に足し、`app-source.cjs` の `EXTRACTED` にも足す。
- [ ] **Step 4: 確認** `sh tools/run_tests.sh`、`operations-golden`、`factories-golden`、`e2e-operations` が通る。
- [ ] **Step 5: Commit**（`格子・物の端・階段の吸着を plan-core の純粋関数にする`）

### Task 3: applyOperations と各操作

**Files:**
- Create: `assets/js/plan-core/operations.js`、`tools/tests/plan-core-operations.test.cjs`
- Modify: `index.html`（`<script>`）、`tools/tests/app-source.cjs`

**Interfaces:**
- Consumes: `PlanCoreFactories.makeWall/makeItem/makeRoom`、`PlanCoreSnap`、`PlanSettable.applySettings`（`ctx.settable` として受ける）。
- Produces（`PlanCoreOperations`）:
  - `applyOperations(plan, ops, ctx) → {plan, changedIds, warnings, errors}`
    - 既定では `plan` の深い写しに当て、成功したら写しを `plan` として返す。1つでも失敗したら、残りは当てず、**渡された `plan` そのもの**を返し、`changedIds` は空、`errors` に `{index, op, message, candidates?}` を1件入れる。
    - `ctx.inPlace === true` のときは `plan` に直接当てる。`ops` は1件でなければ `errors`。各操作は、最初の書き込みより前に検査をすべて終える（失敗したとき1項目も変わっていない）。
    - `changedIds` は、足した・変えた・消した物の id（重複なし、起きた順）。`removedIds` も別に返す。
    - 例外は外へ出さない。知らない `op` は `errors`。
  - `applyProp(obj, key, value, plan, ctx) → {changed: [id…]}`（`updateSelectedProp` のキーごとの後始末を移したもの）
  - `OPS`（操作名 → 関数の表。カタログとの突き合わせに使う）
- `ctx` の形:
  - `newId()`、`catalog`、`plan`（factories と同じもの。`plan-data.js` の `planCoreCtx()` が返す）
  - `roomId()`（省略時は `'rm_'+newId()`。画面は `'rm_'+Date.now()` を返す関数を渡す）
  - `snap: {grid: step|0, edges: bool, edgeThreshold, stair: bool, stairRadius, stairPartEdges}`（省略時は吸着なし）
  - `settable`（`PlanSettable`。`setProps` の `set` を使うときだけ要る）
  - `hooks`（どれも省略できる。画面がグローバルに依存する処理を渡す）:
    - `openingPreset(type) → {type, w?, d?, props?} | null`
    - `canPlace(type, floor, cx, cy, plan) → null | 理由の文字列`（地面専用の種類を2階に置けない、など）
    - `afterPlace(item, plan)`（高さ決め、柱の段差処理）
    - `prop: {key: fn(obj, value, plan) }`（`applyProp` のうち、グローバルに依存して移せない後始末）
    - `afterDelete(plan, removedIds)`（`syncExteriorWallSettings` 相当）
    - `isLocked(obj) → bool`（省略時は `!!obj.locked`）
- 操作と引数（AI に渡す座標は中心。mm、+x 東、+y 南、回転は度）:

  | op | args |
  |---|---|
  | `addRoom` | `{name?, floor?, x, y, w, d}`（`x,y` は中心）|
  | `resizeRoom` | `{id, w?, d?, x?, y?}`（省いた値は今のまま。中心を保って寸法を変える）|
  | `renameRoom` | `{id, name}` |
  | `addWall` | `{x1, y1, x2, y2, floor?, thick?}` |
  | `removeWall` | `{id}` |
  | `placeItem` | `{type, x, y, rot?, floor?, w?, d?, set?}`（`x,y` は中心）|
  | `moveObject` | `{id, x, y}`（中心）または `{id, dx, dy}`。壁は `dx,dy` だけ |
  | `rotateObject` | `{id, rot}`（絶対値）または `{id, by}`（今の角度に足す）。中心を保つ |
  | `deleteObjects` | `{ids: [...]}` |
  | `setProps` | `{id, set: {...}}`（`PlanSettable` の語彙。範囲外は端へ寄せ、知らない項目は `errors`）または `{id, props: {key: value}}`（アプリの欄名。画面用。カタログには出さない）|

- 決めごと:
  - `placeItem` の手順は、今の画面の `placeItem`（`index.html` の該当関数）と同じ順にする: 種類の解決 → `openingPreset` → `canPlace` → `makeItem` → 中心から角へ → 格子 → 端 → 階段 → `afterPlace` → `plan.items.push`。種類が解決できなければ `errors` に入れ、`ctx.catalog.suggest` があれば候補を `candidates` に入れる。
  - 寸法を省いたときの角は、`makeItem` が返した物の `w`・`d` から出す（プリセットで寸法が変わる種類でも、角と寸法が食い違わない）。今の画面の結果と食い違う種類が Task 1 の正解に出たら、画面の今の結果に合わせ、その種類を計画書のこの行の下に追記する。
  - ロックした物への `moveObject`・`rotateObject`・`deleteObjects`・`resizeRoom`・`removeWall` は `errors`。`setProps` は `locked`・`hidden3D`・`vis3D` だけ通す。
  - `deleteObjects` は壁・物・部屋のどれでも受ける。無い id は `errors`。
  - 数値でない座標・0 以下の寸法・`NaN` は `errors`。

- [ ] **Step 1: 失敗するテストを書く** `plan-core-operations.test.cjs`。偽の `ctx`（`plan-core-factories.test.cjs` の偽カタログを使い回す）で、次を1件ずつ以上:
  - 各操作の成功例（結果の物の `x,y,w,d,rot,floor` と `changedIds` を数値で確かめる）
  - Review Focus の 2（3件のうち2件めが失敗 → 返った `plan` が渡した物と同一で、`JSON.stringify` が前と同じ。`inPlace` で失敗 → 同じ）
  - Review Focus の 3（ロック）、4（知らない種類・無い id・`NaN`・知らない op・`ops` が配列でない）、5（`rot:90`、`w:1800,d:900` を中心 `(5000,5000)` に置くと `x:4100,y:4550`。`rotateObject` の前後で中心が同じ）
  - `inPlace` で `ops` が2件 → `errors`
  - `setProps` の `set` で範囲外の数が端へ寄る、選択肢に無い値が `errors`
  - 「グローバルに触らない」検査
- [ ] **Step 2: 落ちることを見る**
- [ ] **Step 3: `operations.js` を実装する。** `applyProp` は `assets/js/app-state.js` の `updateSelectedProp` のキーごとの分岐を、順番と条件を変えずに移す。グローバルに依存する後始末は `ctx.hooks.prop[key]` を呼ぶ形にし、移せなかったキーの一覧をファイル先頭のコメントに書く。
- [ ] **Step 4: 確認** `sh tools/run_tests.sh` が `exit=0`。
- [ ] **Step 5: Commit**（`間取りの操作を plan-core の applyOperations にまとめる`）

### Task 4: 操作の定義（カタログ）

**Files:**
- Create: `assets/js/plan-core/operations-catalog.js`、`tools/tests/plan-core-operations-catalog.test.cjs`
- Modify: `index.html`（`<script>`）、`tools/tests/app-source.cjs`

**Interfaces:**
- Consumes: `PlanCoreOperations.OPS`、`PlanSettable`、`ObjectKnowledge`（引数で受ける）。
- Produces（`PlanCoreOperationsCatalog`）:
  - `OPERATIONS`: `[{name, description, inputSchema}]`。`name` は Task 3 の操作名（`setProps` は `set` の形だけを載せる）。
  - `toClaudeTools(deps{settable, knowledge}) → [{name, description, input_schema}]`
  - `toMcpTools(deps) → [{name, description, inputSchema}]`
  - `describeVocabulary(deps) → 文字列`（家財の種類と設定項目の説明文。Schema には入れず、道具の説明かシステムプロンプトに付ける用）

- 決めごと: 説明文の言語と書き方は、読み取りの道具の定義（`worker/plan-free.mjs`）に揃える。家財の種類は `enum` にせず `string`。設定項目（`set`）は `object` で、項目名を `enum` や `anyOf` に展開しない。Schema 全体で `enum`・`anyOf` は合わせて 10 個まで。

- [ ] **Step 1: 失敗するテストを書く**: `OPERATIONS` の名前の集合が `OPS` の鍵の集合と一致する。各 Schema が `type:'object'` で、`required` の鍵がすべて `properties` にある。`toClaudeTools` の結果を `JSON.stringify` して 8,000 文字以内、`enum`+`anyOf` の数が 10 以下。Task 3 のテストで使った成功例の `args` が、対応する Schema の `required` と型を満たす（テストの中に小さな検査関数を書く。外部ライブラリは入れない）。`describeVocabulary` が `PlanSettable.SETTINGS` の全項目の `key` を含む。
- [ ] **Step 2: 落ちることを見る** → **Step 3: 実装** → **Step 4: `sh tools/run_tests.sh`** → **Step 5: Commit**（`操作の名前・説明・引数の定義を1か所に置く`）

### Task 5: inspectPlan

**Files:**
- Create: `assets/js/plan-core/inspect.js`、`tools/tests/plan-core-inspect.test.cjs`
- Modify: `index.html`（`<script>`）、`tools/tests/app-source.cjs`

**Interfaces:**
- Produces（`PlanCoreInspect`）: `inspectPlan(plan, deps?) → {ok, errors: [文字列], warnings: [文字列]}`。`deps` は `{schema, check, structure, knownItemTypes?}`。省いたものは、Node では `require`、ブラウザでは UMD の `root` から、**呼ばれた時点で**引く。
  - `errors` は `validatePlan` の `errors` と、`floorsOverlap` が `ok:false` のときの1件。
  - `warnings` は `validatePlan` の `warnings` と `knowledgeWarnings` の結果。
  - `ok` は `errors` が空のとき `true`。`plan` は書き換えない。

- [ ] **Step 1: 失敗するテストを書く**: `tools/tests/fixtures/house-2f.json` で `ok:true`。壁の `x1` を文字列にすると `errors` が1件以上。2階の壁を1階から離れた所へ全部動かすと `errors` に階の重なりの件が入る。呼ぶ前後で `JSON.stringify(plan)` が同じ。`deps` に偽物を渡すとそれが使われる。
- [ ] **Step 2: 落ちることを見る** → **Step 3: 実装**
- [ ] **Step 4: `knowledgeWarnings` がアプリの種類名（`fmp-…`）のプランで何かを返すかを、`house-2f.json` に浴室の無い部屋へ浴槽を置いたプランで確かめる。** 何も返さないなら直さず、その事実を報告に書く（直すのは仕様の話なのでこの段ではしない）。
- [ ] **Step 5: `sh tools/run_tests.sh`** → **Step 6: Commit**（`検査3つを inspectPlan に束ねる`）

### Task 6: 画面の3関数を包みに変える

**Files:**
- Modify: `index.html`（`placeItem`・`delSel`・共有の印）、`assets/js/app-state.js`（`updateSelectedProp`）、`assets/js/plan-data.js`（`planCoreCtx` に `snap`・`hooks`・`roomId`・`settable` を足した `planOpsCtx()`）
- Modify: 関数の本文を正規表現で切り出している既存テスト（`pick-order`・`skip-floor`・`lock-visibility`・`ceiling-ui`・`ceiling-finish`・`ruler-length`・`wall-placement`・`plan-settable` の各 `.test.cjs`）
- Create: `tools/tests/operations-shared.browser.mjs`

**Interfaces:**
- Consumes: `PlanCoreOperations.applyOperations`、Task 3 の `ctx`。
- Produces: `planOpsCtx(extra?)`（`plan-data.js`）、`sharedMarkIdsDirty(ids)`（`index.html`。id の配列を `SHARED.dirtyIds` に入れる。共同編集中でなければ何もしない）。

- 3関数の形は「前処理（今のまま）→ `saveState()` → `applyOperations(DATA, [op], planOpsCtx({inPlace:true}))` → `errors` があれば何も変えず今と同じ戻り方 → `sharedMarkIdsDirty(changedIds)` → 後処理（選択・ツール・描画。今のまま）」にする。`saveState` を呼ぶ条件（色入力の途中は省く、など）と、描画・選択・`ST` の戻し方は今のまま残す。
- `delSel` はロック分を除いた id を `deleteObjects` に渡す。`handleErase`・`removeObjectRef`・階の一括削除は、この段では変えない（報告に「変えていない」と書く）。
- 既存テストの直し方: 正規表現が通る形にコードを寄せるのではなく、そのテストが確かめたい利用場面（例: ロックした物が消えない、柱を置くと段差を飛ばす）を、包みと `operations.js` を合わせて動かして確かめる形に直す。確かめる中身を弱めない。

- [ ] **Step 1: 失敗するテストを書く** `operations-shared.browser.mjs`（`shared-relay.browser.mjs` の2画面の仕組みを使う）: A が物を置く・設定を変える・消すと B に同じ結果が届く。A が部屋の天井高を変えて器具が動いたとき（選択していない物が変わる）、B の器具も同じ高さになる。
- [ ] **Step 2: 今のコードで走らせ、どれが落ちるかを記録する**（選択していない物の件が今も通るなら、そのまま見張りとして残す）。
- [ ] **Step 3: `placeItem` を包みに変える** → `operations-golden`・`factories-golden`・`e2e-operations` と `sh tools/run_tests.sh` を通す → Commit。
- [ ] **Step 4: `delSel` を包みに変える** → 同じ確認 → Commit。
- [ ] **Step 5: `updateSelectedProp` を包みに変える** → 同じ確認 → Commit。
- [ ] **Step 6: `sharedMarkIdsDirty` を足し、`operations-shared`・`shared-relay`・`shared-fields` を通す** → Commit。

### Task 7: 設計書の更新と全体の確認

**Files:**
- Modify: `docs/superpowers/specs/2026-11-10-one-source-platform-design.md`（3.6 に「段3の結果」を足す）

- [ ] **Step 1: 設計書に段3の結果を書く。** できたこと、設計書と変えた点（扉・窓の壁への吸着は保存形を動かさない、`setProps` の2つの形、グローバルに依存して `hooks` に残した処理の一覧、変えていない削除の経路）、見つけて直していないもの。
- [ ] **Step 2: 全部を走らせる**: `sh tools/run_tests.sh`、`sh tools/default-plans/check.sh`、`SKIP_DEPLOY=1 bash build.sh`、画面テスト全部（引数なし。10分を超えるので背景で）。
- [ ] **Step 3: Commit**（`段3の結果を設計書に書く`）
