# ブラウザ保存（IndexedDB）設計

## 概要

現在の「保存」機能（JSONダウンロード）を、ブラウザ内ストレージへの保存に変更する。
JSONダウンロードはバックアップ用として、インポートボタンの隣に残す。

> **2026-06-27 更新**: 当初 localStorage で実装したが、プランに埋め込まれた
> base64 テクスチャ（デフォルトでも約4.4MB）がモバイル Safari の localStorage
> 容量（約5MB、UTF-16 換算で実質さらに半分）を超過し、`setItem` が
> `QuotaExceededError` を投げて保存できなかった。容量が桁違いに大きい
> **IndexedDB** に移行した。`StorageAdapter` 抽象のおかげで保存先のみ差し替え。

## データ

- **DB名**: `webcad` / **オブジェクトストア**: `plans` / **キー**: `webcad-plan-v1`
- **保存内容**: `exportPlan()` と同じ正規化済みJSON文字列（IndexedDB に文字列として put）
  - `normalizeLegacyFurnitureItems()`, `ensureObjectIds()`, `ensureExteriorWallSettings()`, `ensureInteriorWallSettings()`, `ensureRoofAppearance()`, `syncExteriorWallSettings()` を適用したもの
- **旧 localStorage からの移行**: IndexedDB が空で、旧 `webcad-plan-v1` キーが
  localStorage に残っている場合はそれを読み込む。次回保存時に localStorage 側は削除。
- **非同期**: IndexedDB は Promise ベース。`StorageAdapter.save/load/hasData` と
  それを呼ぶ `savePlanToStorage/loadPlanFromStorage/checkStorageOnInit` は `async`。

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

## 拡張性：クラウド同期への備え

将来のクラウド同期を見越して、保存・読み込み処理をストレージアダプター経由に抽象化する。

### ストレージアダプター（シンプルなオブジェクト）

```js
var StorageAdapter = {
  save: function(data) {
    // localStorage実装
    localStorage.setItem('webcad-plan-v1', JSON.stringify(data));
  },
  load: function() {
    // localStorage実装
    var s = localStorage.getItem('webcad-plan-v1');
    return s ? JSON.parse(s) : null;
  },
  hasData: function() {
    return !!localStorage.getItem('webcad-plan-v1');
  }
};
```

- `savePlanToStorage()` / `loadPlanFromStorage()` は `StorageAdapter` 経由で呼ぶ
- クラウド同期を追加する際は `StorageAdapter.save` / `.load` を差し替えるだけでよい
- アダプター自体はシンプルなオブジェクトで十分（クラスやDIは不要）

## スコープ外（今回）

- 複数プランの管理
- クラウド同期（アダプター設計で将来対応できるようにする）
- 自動保存（オートセーブ）
