# ブラウザ保存（localStorage）設計

## 概要

現在の「保存」機能（JSONダウンロード）を、ブラウザのlocalStorageへの保存に変更する。
JSONダウンロードはバックアップ用として、インポートボタンの隣に残す。

## データ

- **localStorageキー**: `webcad-plan-v1`
- **保存内容**: `exportPlan()` と同じ正規化済みJSON文字列
  - `normalizeLegacyFurnitureItems()`, `ensureObjectIds()`, `ensureExteriorWallSettings()`, `ensureInteriorWallSettings()`, `ensureRoofAppearance()`, `syncExteriorWallSettings()` を適用したもの

## 起動時の挙動

1. `checkStorageOnInit()` を初期化処理の末尾で呼ぶ
2. `localStorage.getItem('webcad-plan-v1')` がある場合、確認ダイアログを表示:
   - メッセージ: `「前回保存したプランがあります。読み込みますか？」`
   - [はい] → `loadPlanFromStorage()` でデータ復元 → `draw2d(); rebuild3D();`
   - [いいえ] → デフォルトプランのまま起動
3. localStorageにデータがなければダイアログ不要、そのまま起動

## 💾 保存ボタン

### 変更前
- `onclick="exportPlan()"` → `plan.json` をダウンロード

### 変更後
- `onclick="savePlanToStorage()"` → localStorageに保存
- 未保存の変更がある時: ボタン右上に `*` バッジを表示（CSSで実装）
- 保存後: バッジを消す

### dirty フラグの仕組み

```
var DIRTY = false;

function markDirty() {
  DIRTY = true;
  // 保存ボタンにバッジCSSクラスを付与
}

function clearDirty() {
  DIRTY = false;
  // 保存ボタンのバッジCSSクラスを除去
}
```

- `saveState()` の末尾で `markDirty()` を呼ぶ
- `savePlanToStorage()` の末尾で `clearDirty()` を呼ぶ
- 起動時に `loadPlanFromStorage()` で復元した場合は dirty にしない

## JSONエクスポート / インポートボタンの配置変更

### 現在
- ツールバー: `💾 保存`（exportPlan）
- インポートは別の場所にある `doImport()` ボタン

### 変更後
- ツールバー: `💾 保存`（savePlanToStorage）— dirty バッジ付き
- インポートボタンの隣に `↓JSON書き出し` ボタン（exportPlan）を追加

インポートボタンの現在位置を確認して、その隣に配置する。

## 新規追加する関数

| 関数 | 役割 |
|------|------|
| `savePlanToStorage()` | データ正規化 → localStorage保存 → clearDirty() |
| `loadPlanFromStorage()` | localStorageからDATA復元 → 各種normalize処理 |
| `checkStorageOnInit()` | 起動時: localStorageデータの有無チェック → 確認ダイアログ |
| `markDirty()` | DIRTY=true + 保存ボタンにバッジ付与 |
| `clearDirty()` | DIRTY=false + 保存ボタンのバッジ除去 |

## 変更しない点

- `saveState()` / `undoAction()` の内部ロジック（アンドゥ機能は既存のまま）
- `doImport()` の処理内容（ファイル読み込みロジックはそのまま）
- AIレンダー関連の保存ボタン群（別機能）

## スコープ外

- 複数プランの管理
- クラウド同期
- 自動保存（オートセーブ）
