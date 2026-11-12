# 段1 読み込みの正規化を1つにする Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プランを開く7つの経路が、同じ1つの正規化を通るようにする。どの経路で開いても同じ中身になり、ブラウザでも形の検査（`PlanSchema.validatePlan`）が働く。

**Architecture:** 段1では、正規化の手順を `assets/js/app-state.js` の `normalizeLoadedPlan(options)` 1か所にまとめ、7つの経路をこれに置き換える。中の `ensure*` 群は今はグローバルの `DATA` と `WALL_H` などに依存しているので、この段ではそのまま使う。正規化を引数のプランに対する UMD（`assets/js/plan-core/`）へ移すのは、`ensure*` 群の引数化と合わせて段3で行う（設計書 3.1 の1の最終形はそこで満たす）。順番を先に揃えておけば、段3では中身を差し替えるだけになる。

**Tech Stack:** 素の JS（クラシックスクリプト）、node（`node:test` + `node:vm`、`tools/tests/app-source.cjs`）、Playwright（`tools/run_browser_tests.sh`）。

**Spec:** `docs/superpowers/specs/2026-11-10-one-source-platform-design.md`（3.1 の1、4章の1・2、3.6 の段1）

## Global Constraints

- **既存利用者の保存プランが、今の本番と同じ中身で開くこと。** `tools/tests/plan-compat.browser.mjs` の正解（`fixtures/compat/golden.json`）は、Task 1 で今の本番の動きを記録した後、この段の中で作り直さない。落ちたら実装を直す。
- 正解との差が「今まで足りなかった補完が入った」ためのものでも、勝手に正解にしない。利用者に見た目の違いを画像で見せて判断を仰ぐ（仕様の変更にあたるため）。
- 1度だけ走る移行（`planFixes` の印を書くもの）を、正規化の中で毎回走らせない。
- `PlanSchema.validatePlan` の結果で読み込みを止めない。警告として記録するだけ（設計書 4章の2）。
- 作業ブランチは段0の後の `feat/stage1-load-normalize`。main への push・マージは利用者の確認なしにしない。
- コミットメッセージは日本語、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

- 共有ルームで相手の変更を受けたとき（`applySharedPatch`）に、視点（viewState）が勝手に動く → `restoreView: false` を渡すことを Task 3 のテストで固定する。
- 正規化の途中で例外が出たとき、`loadPlanFromStorage` は今「既定プランに戻す」。まとめた後もこの戻り方が残る → Task 3 で、壊れた保存データ（`walls` が文字列）を入れて既定プランに戻ることを確かめる。
- 既定プラン（プリセット）を開いたときの見た目が変わる。今は `loadPreset` だけが外壁・内壁・屋根の補完を呼んでいない → Task 1 で既定プラン2種の指紋も正解に加え、Task 4 で差が出たら止める。
- 空の新規プラン（`chooseBlankPlan`）に補完が入って、保存が太る → Task 3 で空プランの保存 JSON のキーが今と同じことを確かめる。
- 読み込み直後の undo 履歴が、経路によって残ったり消えたりする → `normalizeLoadedPlan` は履歴に触らず、各経路の今の `clearEditHistory` の呼び方を変えない。

---

### Task 1: 今の本番の開き方を、未記録の経路まで正解に記録する

**Files:**
- Modify: `tools/tests/plan-compat.browser.mjs`（経路 `library`、`preset-2f`、`preset-3f`、`shared-patch` を足す）
- Modify: `tools/tests/fixtures/compat/golden.json`（この Task でだけ作り直す）
- Modify: `tools/tests/fixtures/compat/README.md`（足した経路の説明）

**Interfaces:**
- Produces: `golden.json` に、既存の `idb`・`localStorage`・`json`・`idb-resave` に加えて、上の4経路の指紋。

- [ ] **Step 1: 経路を足す**

`library` は `PlanLibrary` に fixture を保存してから一覧から開く。`preset-2f`・`preset-3f` は起動時の選択で既定プランを開く（中身は fixture でなく出荷物になるので、指紋は「今の main でそう開いた」記録として扱い、README にその旨を書く）。`shared-patch` は空のプランに、fixture 全体を `upserts` にした patch を `applySharedPatch` で当てる。

- [ ] **Step 2: 正解を記録する（変更前の main のコードで）**

Run: `UPDATE_GOLDEN=1 sh tools/run_browser_tests.sh plan-compat`
Expected: `golden.json` に新しい経路が加わり、既存の経路の値は1つも変わらない（`git diff tools/tests/fixtures/compat/golden.json` で、削除行が無いことを確かめる）。

- [ ] **Step 3: 正解どおりに通ることを確かめる** `sh tools/run_browser_tests.sh plan-compat` → PASS

- [ ] **Step 4: コミット** `git commit -m "保存プランの互換テストに、ライブラリ・既定プラン・共有の経路を足す"`

### Task 2: `normalizeLoadedPlan` を作る

**Files:**
- Modify: `assets/js/app-state.js`（`ensureObjectIds` の近くに追加）
- Test: `tools/tests/normalize-loaded-plan.test.cjs`（新規）

**Interfaces:**
- Produces: `function normalizeLoadedPlan(options) -> { warnings: string[] }`
  - 対象はグローバルの `DATA`（段3で引数化する）。
  - `options`（すべて省略可）:
    - `resetHeights: boolean`（既定 `true`）: 先頭で `resetHeightGlobalsForPlanLoad()` を呼ぶ。
    - `syncUi: boolean`（既定 `true`）: `syncHeightDefaultsUI()` を呼ぶ。
    - `restoreView: boolean`（既定 `true`）: 最後に `restoreViewState()` を呼ぶ。
  - 呼ぶ順番（固定）: `resetHeightGlobalsForPlanLoad` → `syncNorthFromPlan` → `ensureObjectIds` → `ensureExteriorWallSettings` → `ensureInteriorWallSettings` → `ensureRoofAppearance` → `ensureFloorMetadata` → `ensureHeightDefaults` → `syncHeightDefaultsUI` → `syncExteriorWallSettings` → `normalizeLegacyFurnitureItems` → `restoreViewState`。これは今いちばん多くの経路（`doImport`、`plan-library.js` の `loadIntoEditor`、`compare-mode.js`）が使っている順番。
  - `warnings`: `PlanSchema.validatePlan(DATA)` が返した問題の文。`PlanSchema` が無い環境では空配列。警告があれば `console.warn('[WebCAD] plan load warnings', warnings)` を1回だけ出す。
  - 履歴（`clearEditHistory`）、描画、保存、`_defaultPlanPending` には触らない。

- [ ] **Step 1: 失敗するテストを書く**

`app-source.cjs` から `normalizeLoadedPlan` を名前で切り出し、`node:vm` で動かす。`ensure*` 群は呼ばれた名前を配列に積むだけの偽物にする。
- `test('既定では決まった順番で全部呼ぶ')`: 呼ばれた順が上の12個と一致。
- `test('restoreView:false では restoreViewState を呼ばない')`
- `test('resetHeights:false では resetHeightGlobalsForPlanLoad を呼ばない')`
- `test('形の検査の問題は warnings に入り、例外にしない')`: `PlanSchema.validatePlan` の偽物が `['walls must be an array']` を返すとき、戻り値の `warnings` がそれを含み、例外が出ない。

- [ ] **Step 2: 失敗を確かめる** `node tools/tests/normalize-loaded-plan.test.cjs` → FAIL（関数が無い）

- [ ] **Step 3: `normalizeLoadedPlan` を実装する**（`validatePlan` の戻り値の形は `assets/js/plan-schema.js` を読んで合わせる）

- [ ] **Step 4: テストを通す** `node tools/tests/normalize-loaded-plan.test.cjs` → PASS

- [ ] **Step 5: コミット** `git commit -m "プランを開いたときの補完を1つの関数にまとめる"`

### Task 3: 7つの経路を `normalizeLoadedPlan` に置き換える

**Files:**
- Modify: `index.html` の `loadPlanFromStorage`（19819行付近）、`doImport`（22516行付近）、`applySharedPatch`（20010行付近）
- Modify: `assets/js/plan-library.js`（71行付近と127行付近の2か所）、`assets/js/compare-mode.js`（57〜66行付近）、`assets/js/plan-import.js`（1316〜1326行付近）、`assets/js/plan-data.js` の `loadPreset`（210〜226行付近）と `chooseBlankPlan`（187〜191行付近）
- Test: `tools/tests/normalize-single-source.test.cjs`（新規）

**Interfaces:**
- Consumes: Task 2 の `normalizeLoadedPlan(options)`。

各経路で渡す `options`:

| 経路 | options | 理由 |
|---|---|---|
| `loadPlanFromStorage` | 既定 | 今は `resetHeights` を呼んでいないが、他の経路と揃える（Task 4 の互換テストで差を確かめる） |
| `doImport` | 既定 | 今と同じ |
| `applySharedPatch` | `{ resetHeights:false, restoreView:false }` | 編集中に相手の変更を受けるだけなので、高さの既定と視点を動かさない |
| `plan-library.js` 127行（開く） | 既定 | 今と同じ |
| `plan-library.js` 71行（保存前の整え） | `{ resetHeights:false, syncUi:false, restoreView:false }` | 保存の直前の整えで、画面を動かさない（`captureViewState` は呼ぶ側に残す） |
| `compare-mode.js` | 既定 | 今と同じ。57〜59行の前置きの `resetHeightGlobalsForPlanLoad`・`ensureHeightDefaults` は、正規化に含まれるので消す |
| `plan-import.js` | `{ resetHeights:false }` | 今の DATA に取り込んだ階を足す処理で、既存の階の高さを戻さない |
| `loadPreset` | `{ resetHeights:false }` | 先頭（187行付近）で既に `resetHeightGlobalsForPlanLoad` を呼んでいるため。視点は今と同じく `DATA.viewState` があるときだけ戻したいので、`restoreView: !!DATA.viewState` を渡し、無いときの `resetView()` は呼ぶ側に残す |
| `chooseBlankPlan` | 置き換えない | 空プランの作成で、読み込みではない。今の呼び出しのまま |

- [ ] **Step 1: 失敗するテストを書く**

`normalize-single-source.test.cjs`: `index.html` と `assets/js/*.js` の中で、`ensureExteriorWallSettings();` と `normalizeLegacyFurnitureItems();` を**同じ行かすぐ近く（5行以内）で両方**呼んでいる箇所が、`normalizeLoadedPlan` の本体以外に無いこと。ばらばらの並びがまた書き足されるのを止めるための検査。

- [ ] **Step 2: 失敗を確かめる** → FAIL（7か所が列挙される）

- [ ] **Step 3: 表のとおりに置き換える**

例外時の戻り方（`loadPlanFromStorage` の catch で既定プランに戻す）と、各経路の `clearEditHistory`・描画・`sharedForceFullSync`・`markDirty` の呼び方は変えない。

- [ ] **Step 4: 単体テストを通す** `sh tools/run_tests.sh` → `exit=0`。名前で関数を切り出しているテスト（`app-source.cjs` の `EXTRACTED` 経由）が、置き換えで壊れていないこと。

- [ ] **Step 5: コミット** `git commit -m "プランを開く7つの経路を、同じ補完に通す"`

### Task 4: 本番と同じ開き方であることを確かめる

- [ ] **Step 1:** `sh tools/run_browser_tests.sh plan-compat` → PASS（Task 1 の正解のまま）。

- [ ] **Step 2: 差が出たら原因を分ける**

差が出た経路ごとに、どの補完が新たに効いたかを特定する（Task 3 の表で、今まで呼んでいなかった補完が入った経路が候補。`loadPlanFromStorage` の `resetHeights`、`loadPreset` の外壁・内壁・屋根の補完）。
- 見た目に影響しない差（例: 補完で空の設定欄が足されただけ）なら、その経路の options で補完を外して今と同じにする。
- 見た目に影響する差なら、実装を今と同じに戻した上で、利用者に「今は経路によって見た目が違う。揃えるとこう変わる」を前後の画像で見せて判断を仰ぐ。勝手に正解を作り直さない。

- [ ] **Step 3:** 残りの画面テストを全部走らせる `sh tools/run_browser_tests.sh` → 全部 PASS。

- [ ] **Step 4: 内蔵ブラウザで触って確かめる**

既定プラン（2階建て・3階建て）を開き、保存して再読み込みし、JSON を書き出して「読込」で開き直す。それぞれで 2D と 3D を見て、コンソールに `[WebCAD] plan load warnings` 以外のエラーが無いこと。警告が出た場合は中身を記録して PR に書く（直さない）。スクリーンショットを PR に添える。

- [ ] **Step 5: PR を作る**

PR の説明に、7経路の置き換え表、互換テストの結果、出た警告の中身を書く。main へのマージは利用者に確認する。
