# localStorage ブラウザ保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 💾保存ボタンをlocalStorage保存に変更し、起動時に前回データを復元できるようにする。JSONエクスポートは読込ボタンの隣に移動する。

**Architecture:** すべての変更は `index.html` 一ファイル内で完結する。`StorageAdapter` オブジェクトで保存・読み込みを抽象化し、将来のクラウド同期に備える。`DIRTY` フラグで未保存状態を管理し、保存ボタンにCSSバッジで表示する。

**Tech Stack:** Vanilla JS, localStorage API, HTML/CSS（フレームワーク・ライブラリなし）

---

## File Structure

| ファイル | 変更内容 |
|----------|----------|
| `index.html` | CSS追加・JS関数追加・ボタンHTML変更・起動処理追加 |

---

### Task 1: 保存ボタンにdirtyバッジ用CSSを追加

**Files:**
- Modify: `index.html`（`<style>`ブロック内、既存CSSの末尾付近）

現在のtoolbarのsaveボタン（line 2414）に `id="save-btn"` を付与し、未保存状態のバッジ表示を実装する。

- [ ] **Step 1: 保存ボタンに id を付与する**

line 2414 を以下に変更：

```html
  <button id="save-btn" class="tbtn mob-hide" onclick="exportPlan()">💾 保存</button>
```

※ onclick はまだ `exportPlan()` のまま（後のタスクで変更）

- [ ] **Step 2: CSSにdirtyバッジスタイルを追加する**

`<style>` ブロックの末尾（`.snap-shift-btn.active{...}` の行の近く、既存スタイルの後）に追加：

```css
#save-btn{position:relative}
#save-btn.dirty::after{content:'*';position:absolute;top:2px;right:4px;font-size:10px;color:#e94560;font-weight:bold;line-height:1}
```

- [ ] **Step 3: ブラウザで確認する**

`index.html` をブラウザで開き、DevToolsコンソールで以下を実行してバッジが表示されるか確認：
```js
document.getElementById('save-btn').classList.add('dirty')
```
右上に赤い `*` が表示されれば OK。

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat: add dirty badge CSS to save button"
```

---

### Task 2: StorageAdapter と DIRTY フラグ基盤を追加

**Files:**
- Modify: `index.html`（line 3283付近、`var HISTORY = [];` の直後）

- [ ] **Step 1: StorageAdapter・DIRTY フラグ・markDirty/clearDirty を追加する**

line 3283 (`var HISTORY = [];`) の直後に以下を挿入：

```js
var DIRTY = false;
var StorageAdapter = {
  save: function(data){
    try{ localStorage.setItem('webcad-plan-v1', JSON.stringify(data, function(k,v){return k==='_texObj'?undefined:v;})); }catch(e){ alert('ブラウザ保存に失敗しました: '+e.message); }
  },
  load: function(){
    try{ var s=localStorage.getItem('webcad-plan-v1'); return s?JSON.parse(s):null; }catch(e){ return null; }
  },
  hasData: function(){
    try{ return !!localStorage.getItem('webcad-plan-v1'); }catch(e){ return false; }
  }
};
function markDirty(){
  DIRTY=true;
  var btn=document.getElementById('save-btn');
  if(btn) btn.classList.add('dirty');
}
function clearDirty(){
  DIRTY=false;
  var btn=document.getElementById('save-btn');
  if(btn) btn.classList.remove('dirty');
}
```

- [ ] **Step 2: saveState() を修正して markDirty() を呼ぶ**

既存の `saveState()` (line 3285-3288) を以下に変更：

```js
function saveState(){
  var s=JSON.stringify(DATA,function(k,v){return k==='_texObj'?undefined:v;});
  HISTORY.push(s);if(HISTORY.length>50)HISTORY.shift();
  markDirty();
}
```

- [ ] **Step 3: ブラウザで動作確認する**

`index.html` をブラウザで開き、壁などを描いた後に `DIRTY` が `true` になり、保存ボタンに `*` が表示されることをコンソールで確認：
```js
// 壁を追加操作後
console.log(DIRTY); // true
document.getElementById('save-btn').classList.contains('dirty'); // true
```

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat: add StorageAdapter and DIRTY flag infrastructure"
```

---

### Task 3: savePlanToStorage() と loadPlanFromStorage() を追加

**Files:**
- Modify: `index.html`（`exportPlan()` 関数 line 8503 付近の直後に追加）

- [ ] **Step 1: savePlanToStorage() を追加する**

`exportPlan()` 関数（line 8503-8514）の直後に追加：

```js
function savePlanToStorage(){
  normalizeLegacyFurnitureItems();
  ensureObjectIds();
  ensureExteriorWallSettings();
  ensureInteriorWallSettings();
  ensureRoofAppearance();
  syncExteriorWallSettings();
  StorageAdapter.save(DATA);
  clearDirty();
}
```

- [ ] **Step 2: loadPlanFromStorage() を追加する**

`savePlanToStorage()` の直後に追加：

```js
function loadPlanFromStorage(){
  var d=StorageAdapter.load();
  if(!d) return false;
  DATA=d;
  ensureObjectIds();
  ensureExteriorWallSettings();
  ensureInteriorWallSettings();
  ensureRoofAppearance();
  syncExteriorWallSettings();
  normalizeLegacyFurnitureItems();
  return true;
}
```

- [ ] **Step 3: checkStorageOnInit() を追加する**

`loadPlanFromStorage()` の直後に追加：

```js
function checkStorageOnInit(){
  if(!StorageAdapter.hasData()) return;
  if(confirm('前回保存したプランがあります。読み込みますか？')){
    if(loadPlanFromStorage()){
      draw2d();
      if(ren) rebuild3D();
    }
  }
}
```

- [ ] **Step 4: コンソールで動作確認する**

ブラウザで開き、コンソールで以下を順に実行して確認：
```js
// 保存テスト
savePlanToStorage();
console.log(StorageAdapter.hasData()); // true
console.log(DIRTY); // false

// 読み込みテスト（DATAを一時的に空にして）
DATA.walls = [];
loadPlanFromStorage();
console.log(DATA.walls.length); // 元の壁の数が復元されていること
```

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat: add savePlanToStorage and loadPlanFromStorage"
```

---

### Task 4: ボタンのHTML変更・起動処理追加

**Files:**
- Modify: `index.html`（line 2414〜2417 のボタン群、および末尾の起動処理）

- [ ] **Step 1: 保存ボタンの onclick を savePlanToStorage に変更する**

line 2414 を以下に変更：

```html
  <button id="save-btn" class="tbtn mob-hide" onclick="savePlanToStorage()">💾 保存</button>
```

- [ ] **Step 2: 読込ボタンの隣にJSONエクスポートボタンを追加する**

line 2416-2417（読込ボタンとfile input）を以下に変更：

```html
  <button class="tbtn mob-hide" onclick="exportPlan()">↓JSON</button>
  <button class="tbtn mob-hide" onclick="document.getElementById('import-file').click()">📂 読込</button>
  <input type="file" id="import-file" style="display:none" accept=".json" onchange="doImport(this)">
```

- [ ] **Step 3: 起動処理の末尾に checkStorageOnInit() を追加する**

line 9837-9838（`initTouchPressFeedback(); applyMobileUI();` の直前）に追加：

```js
// ─── Init storage ─────────────────────────────────
checkStorageOnInit();
```

最終的に末尾は以下の順になる：
```js
checkStorageOnInit();
initTouchPressFeedback();
applyMobileUI();
```

- [ ] **Step 4: ブラウザで E2E 確認する**

1. `index.html` を開く → デフォルトプランが表示される（localStorageが空の場合はダイアログなし）
2. 壁を追加する → 保存ボタンに `*` が表示される
3. 💾 保存 をクリック → `*` が消える
4. ページをリロード → 「前回保存したプランがあります。読み込みますか？」ダイアログが表示される
5. 「はい」→ 前回の状態が復元される
6. 再度リロード → 「いいえ」→ デフォルトプランのまま起動される
7. ↓JSON ボタン → `plan.json` がダウンロードされる
8. 📂 読込 ボタン → ファイル選択ダイアログが開く

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat: wire localStorage save button, add JSON export, restore on init"
```

---

## 完了条件チェックリスト

- [ ] 編集後に保存ボタンに `*` バッジが表示される
- [ ] 💾 保存でlocalStorageに保存され、`*` が消える
- [ ] リロード後に確認ダイアログが表示され「はい」で復元できる
- [ ] 「いいえ」でデフォルトプランのまま起動する
- [ ] localStorageが空の場合はダイアログが出ない
- [ ] ↓JSON ボタンで `plan.json` がダウンロードされる
- [ ] 📂 読込 ボタンでJSONインポートが動く
- [ ] アンドゥ（Ctrl+Z）が引き続き動作する
