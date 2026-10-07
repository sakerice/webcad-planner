# 段階0-1: 既存プランの互換テスト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 本番の利用者が持っている保存データ（ブラウザ保存・JSON）が、今の本番と同じ中身で開けることを、本番に出す前に機械で確かめる。

**Architecture:**
- 本番（main）で実際に作った保存データを、凍結した見本としてリポジトリに置く。
- その見本を、本番の3つの入口から開く。
  - IndexedDB の保存
  - 古い localStorage の保存
  - 「読込」での JSON
- 開いた結果の「間取りの指紋」（壁・部屋・物の位置と寸法の一覧）を、本番で記録した正解と突き合わせる。
- 正解は本番の挙動そのものなので、本番と違う結果になった時点で失敗する。

**Tech Stack:** Playwright（`tools/run_browser_tests.sh` の作法）、node:test を使わない素の ESM。

**Spec:** `docs/superpowers/plans/2026-10-07-rebuild-from-main-roadmap.md` の 0-1。

## Global Constraints
- 見本と正解は本番（main d41e98db）で作る。以後は「仕様を意図して変えたとき」以外に更新しない（`tools/tests/fixtures/README.md` と同じ規律）
- 起動時の確認は「前回保存したプランがあります」を含む1回だけで、OK で開けること
- ページで例外が出ないこと

## Review Focus
- 古い localStorage にだけ保存がある利用者（IndexedDB 導入前の保存）。IndexedDB 側だけ見ていると見落とす
- 古い形式の値: 壁厚が文字列、ゼロ長の壁、廃止された `tv`、旧カタログのドア（`fmp-` の扉）
- 保存し直しても中身が変わらないこと（読んで保存して読む）
- 3階建て（`floorMetadata` が3階分ある）

### Task 1: 見本を作る

**Files:**
- Create: `tools/tests/fixtures/compat/make_fixtures.mjs`（見本の作り方を残す。普段は流さない）
- Create: `tools/tests/fixtures/compat/saved-2f.json`, `saved-3f.json`, `legacy-quirks.json`
- Create: `tools/tests/fixtures/compat/README.md`

- [x] `?preset=2f` / `?preset=3f` で開き、`savePlanToStorage()` を呼ぶ。IndexedDB `webcad/plans/webcad-plan-v1` に入った文字列を、そのまま見本として書き出す
- [x] `legacy-quirks.json` は `saved-2f.json` を元に、次の古い値を入れて作る
  - 壁1本の `thick` を文字列 `"120"` にする
  - 長さ0の壁を1本足す
  - `tv` を1点足す
  - 旧カタログの扉（`FMP_ITEMS` で category が「ドア」の物）を1点足す
  - 物1点の `id` を消す

### Task 2: 正解の記録と、互換テスト

**Files:**
- Create: `tools/tests/plan-compat.browser.mjs`
- Create: `tools/tests/fixtures/compat/golden.json`

- [x] 見本ごと・入口ごとに、新しいブラウザ環境で次を行う
  - 保存を仕込む
  - 開き直す（確認窓は OK を押し、文言を記録する）
  - 開いた間取りの指紋を取る
- [x] JSON は `#import-file` にファイルを渡して開く
- [x] 読み直しの確認: IndexedDB から開いたあと `savePlanToStorage()` を呼び、もう一度開き直して指紋を取る
- [x] `UPDATE_GOLDEN=1` のときだけ golden.json を書く。普段は突き合わせて、違えば「どの見本・どの入口で・何が違うか」を出して失敗する
- [x] main で `UPDATE_GOLDEN=1` を流して正解を作り、続けて普通に流して通ることを確かめる
- [x] PR #76 の控えに向けて流し、失敗すること（旧保存が開けない問題を検出できること）を確かめる

### Task 3: 本番に出す前の手順に組み込む
- [x] `tools/run_browser_tests.sh plan-compat` で単独に流せることを確かめる
- [x] 計画書の「本番に出す前に確かめること」に、この1行を書く
