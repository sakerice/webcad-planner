# 3D品質向上・性能最適化・日本住宅規格準拠 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D間取りシミュレーターの描画を軽量化しつつ見た目品質を向上させ、LIXIL/910モジュール規格プリセットと雨樋等の外部設備自動生成、時刻連動ライティングを追加する。

**Architecture:** 単一 `index.html`(約13,500行、Three.js r128 CDN)への逐次パッチ。レンダリングはdirtyフラグ制御のオンデマンド方式に変更。規格プリセットは既存の `applyOpeningModelToItem` / `ISIZES` / `LIGHT_PRESETS` の仕組みに乗せる。雨樋は `build3DRoofItem` の屋根タイプ別エッジ情報から自動生成。

**Tech Stack:** Three.js r128 / vanilla JS / Python3(GLB処理: @gltf-transform CLI or pygltflib+Pillow)

## Global Constraints

- Three.js は r128 のまま(バージョンアップ禁止)
- 既存プラン(localStorage保存データ)の読込互換を壊さない: 新規プロパティは undefined 時デフォルト扱い
- 既存機能(2D/3D切替・家具配置・ウォークスルー・スクリーンショット・保存/読込)を壊さない
- 性能は現状より悪化させない。見た目品質は落とさない(GLBはテクスチャのみ縮小、ジオメトリ非劣化)
- 3Dモデルの寸法は規格プリセット値(mm)に忠実に追従させる(w/d/h がそのまま3D寸法になる既存構造を維持)
- 単位系: アイテム寸法はmm、3Dは `U=0.001` でm換算
- 各タスク完了ごとに `python3 scripts/check_js.py` で構文チェック → ブラウザ確認 → コミット

## 検証環境

テストフレームワークはない。検証は以下の2段構え:
1. **構文チェック**: `scripts/check_js.py`(Task 0 で作成)— index.html のインラインJSを `node --check` に通す
2. **ブラウザ実機確認**: `python3 -m http.server 8931` でローカル配信し、Chrome automation(claude-in-chrome / playwright MCP)で 2D→3D外観→3D内観 切替、スクリーンショット取得、コンソールエラー確認

## 実行体制(モデル使い分け)

- **メインセッション(Fable)直接実施**: Task 1, 2, 3, 9, 11(レンダリングループ・雨樋・太陽軌道 = 既存コードと密結合、回帰リスク高)
- **Sonnetサブエージェント委譲可**: Task 4(GLB軽量化スクリプト)、Task 5(プリセット表)、Task 6, 7, 8, 10, 12(独立性の高い追加実装)
- 委譲時も統合・検証・コミットはメインセッションがレビューして行う

---

### Task 0: JS構文チェックスクリプト

**Files:**
- Create: `scripts/check_js.py`

**Interfaces:**
- Produces: `python3 scripts/check_js.py` → exit 0 で "JS syntax OK"、構文エラー時は node のエラー出力と exit 1

- [ ] **Step 1: スクリプト作成**

```python
#!/usr/bin/env python3
"""index.html のインライン <script> を連結して node --check に通す"""
import re, subprocess, sys, tempfile, os

html = open(os.path.join(os.path.dirname(__file__), '..', 'index.html'), encoding='utf-8').read()
# src= 付き(CDN)を除くインラインscriptを抽出
blocks = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)
if not blocks:
    print('No inline scripts found'); sys.exit(1)
src = '\n;\n'.join(blocks)
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
    f.write(src); path = f.name
try:
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
finally:
    os.unlink(path)
if r.returncode:
    print(r.stderr); sys.exit(1)
print('JS syntax OK (%d chars, %d blocks)' % (len(src), len(blocks)))
```

- [ ] **Step 2: 動作確認**

Run: `python3 scripts/check_js.py`
Expected: `JS syntax OK (...)` exit 0

- [ ] **Step 3: 故意にエラーを検出できるか確認**

一時的に index.html 末尾の script 内に `var ((;` を足して実行 → exit 1 とエラー行が出ることを確認 → 戻す。

- [ ] **Step 4: Commit**

```bash
git add scripts/check_js.py
git commit -m "Add inline JS syntax checker"
```

---

### Task 1: オンデマンドレンダリング(WS1-1)

**Files:**
- Modify: `index.html` — `loop3D()`(~10903行)、`init3D()`(~6495行)、`build3D()`(~6658行)、テクスチャ/GLBロードコールバック、ライト設定関数、リサイズハンドラ

**Interfaces:**
- Produces: `invalidate3D()` — シーンに変化があった際に次フレームの描画を要求するグローバル関数。`render3DNow()` — 即時同期レンダ(Task 2 が使用)。
- 挙動: カメラ静止・無操作時は composer.render() が呼ばれない(安全網として1.5秒毎に1回のみ)

- [ ] **Step 1: dirtyフラグとレンダ関数を追加**

`loop3D` 定義の直前(`var _last3DFrameAt=0;` の前)に追加:

```js
var _needs3DRender=true;
var _lastSafety3DRenderAt=0;
function invalidate3D(){_needs3DRender=true;}
function anyWasdActive(){
  for(var k in iMov){ if(iMov[k]) return true; }
  return false;
}
function render3DNow(){
  if(!ren||!sc3||!camExt) return;
  if(composer){
    composer.passes[0].camera=camExt;
    for(var i=1;i<composer.passes.length;i++){
      if(composer.passes[i].camera) composer.passes[i].camera=camExt;
    }
    composer.render();
  } else {
    ren.render(sc3,camExt);
  }
}
```

- [ ] **Step 2: loop3D を dirty 制御に変更**

既存 `loop3D` 本体を次に置換(throttle・walkthrough・cutaway 呼び出しは維持):

```js
function loop3D(){
  requestAnimationFrame(loop3D);
  var cam = camExt;  // always use orbit camera (interior = bird's eye of current floor)
  if(!cam || !ren) return;
  if(ST.view==='2d') return;
  var now=performance.now();
  var frameInterval=get3DFrameInterval();
  if(frameInterval && now-_last3DFrameAt<frameInterval) return;

  var walking=ST.view==='3d-ext' && updateWalkthroughCamera(now);
  var orbitMoved=false;
  if(orbit && (ST.view==='3d-ext'||ST.view==='3d-int') && !walking) {
    orbitMoved=orbit.update()===true;
  }
  var animating=walking||orbitMoved||GIZMO_DRAG.active||anyWasdActive();
  if(!animating && !_needs3DRender && now-_lastSafety3DRenderAt<1500) return;
  _last3DFrameAt=now;
  _needs3DRender=false;
  _lastSafety3DRenderAt=now;
  updateInteriorCutawayWalls();
  render3DNow();
}
```

注意: r128 OrbitControls の `update()` は変化があったとき `true` を返す(damping減衰中も true)。これで慣性スクロール中の描画が継続する。

- [ ] **Step 3: 描画トリガを網羅する**

以下の各箇所に `invalidate3D();` を追加(関数が未定義タイミングで呼ばれる可能性がある箇所は `if(typeof invalidate3D==='function') invalidate3D();` とする):

1. `init3D` 内 orbit 生成直後: `orbit.addEventListener('change',invalidate3D);`
2. `build3D()` の末尾
3. `applyLightingToScene()` の末尾
4. テクスチャロード完了コールバック3箇所(3467行・3480行・6384行付近の `TextureLoader().load` の onLoad 内)
5. HDRロード完了(`RGBELoader` の onLoad、6544行付近 — rebuild3D 呼出があるので build3D 末尾でカバーされるが明示追加)
6. GLBロード完了(`ensureGltfModel` 内のロード成功コールバック — `grep -n "_modelCache\[" index.html` で特定)
7. ウィンドウリサイズハンドラ(`grep -n "setSize" index.html` で 3D リサイズ箇所を特定)
8. `setView()` 内(ビュー切替時)
9. 内観マウスルック(`mousemove` の `_intML` 処理末尾)とWASDキーの keydown
10. `updateLightSetting` / `applyLightPreset` 末尾
11. スカイテクスチャ更新(`refreshSkyTexture` — `grep -n "function refreshSkyTexture"`)

- [ ] **Step 4: 構文チェック**

Run: `python3 scripts/check_js.py`
Expected: `JS syntax OK`

- [ ] **Step 5: ブラウザ検証**

`python3 -m http.server 8931` を起動し Chrome で `http://localhost:8931` を開き:
- 3D外観に切替 → 描画される
- オービット回転・ズーム → 滑らかに追従、慣性減衰も描画継続
- 静止時: DevTools Performance で数秒記録し、GPU/scriptingがアイドル(1.5秒毎の保険レンダのみ)であること
- 家具を配置/削除/色変更 → 即座に3Dへ反映
- 内観切替・ウォークスルー・ギズモドラッグ → 従来通り
- ライトプリセット切替(朝昼夕夜)→ 即反映
- コンソールエラーなし

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Render 3D on demand with dirty-flag loop"
```

---

### Task 2: preserveDrawingBuffer 廃止(WS1-2)

**Files:**
- Modify: `index.html` — 6498行(renderer生成)、12270行・12342行付近(`toDataURL`)、4314行付近は canvas 2D なので対象外

**Interfaces:**
- Consumes: Task 1 の `render3DNow()`

- [ ] **Step 1: renderer 生成を変更**

```js
ren=new THREE.WebGLRenderer({antialias:true});
```

- [ ] **Step 2: toDataURL 直前に同期レンダを挿入**

12270行付近と12342行付近の `ren.domElement.toDataURL(...)` を呼ぶ関数それぞれで、直前に:

```js
render3DNow();
```

(4314行の `c.toDataURL` は 2D canvas のため変更不要。他に `ren.domElement.toDataURL` を使う箇所がないか `grep -n "domElement.toDataURL" index.html` で確認し、あれば同様に処置)

- [ ] **Step 3: 構文チェック**

Run: `python3 scripts/check_js.py` → `JS syntax OK`

- [ ] **Step 4: ブラウザ検証**

3D表示状態でスクリーンショット機能(該当UIボタン)を実行し、真っ黒でない正しい画像が得られること。AIプラン生成用キャプチャ(12342行の呼出元)も同様。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Drop preserveDrawingBuffer; render before capture"
```

---

### Task 3: SAOハーフ解像度化+モバイルポストプロセス調整(WS1-4)

**Files:**
- Modify: `index.html` — `init3D()` の composer 構築部(~6578行)

- [ ] **Step 1: SAO をハーフ解像度化**

SAOPass 生成直後に setSize をオーバーライド:

```js
if(THREE.SAOPass) {
  var sao = new THREE.SAOPass(sc3, camExt, false, true);
  sao.params.saoBias = 0.5; sao.params.saoIntensity = 0.008; sao.params.saoScale = 15;
  var _saoSetSize = sao.setSize.bind(sao);
  sao.setSize = function(w,h){ _saoSetSize(Math.max(1,Math.round(w/2)), Math.max(1,Math.round(h/2))); };
  sao.setSize(wrap.clientWidth, wrap.clientHeight);
  composer.addPass(sao);
}
```

- [ ] **Step 2: ビフォーアフター比較**

変更前後で同一アングルのスクリーンショットを撮り比較。AO の輪郭が破綻(ブロックノイズ・ちらつき)していれば `w/1.5` に緩和、それでも駄目なら本タスクを revert して見送る(見た目品質優先)。

- [ ] **Step 3: 構文チェック + ブラウザ確認**

Run: `python3 scripts/check_js.py` → OK。オービット操作中のフレームレートが改善または同等であること。

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Run SAO at half resolution"
```

**補足(仕様WS1-5 静的ジオメトリ統合について):** Task 1〜4 でアイドル負荷・ロード量の主因は解消される見込みのため、ドローコール統合は Task 13 の性能計測で操作時フレームレートが不足した場合にのみ着手する(対象は選択不可能な装飾ジオメトリに限定)。計測で十分なら実施しない(YAGNI)。

---

### Task 4: 家具GLBテクスチャ軽量化(WS1-3)【Sonnet委譲可】

**Files:**
- Create: `tools/slim_glb.sh`
- Modify: `assets/models/unity_exported/*.glb`(再生成)
- Create: `assets/models/unity_exported_orig/`(オリジナル退避、gitignore対象)

**Interfaces:**
- Produces: テクスチャ最大1024pxに縮小されたGLB群(ジオメトリ・マテリアル構造は不変)。合計74MB→20MB以下目標。

- [ ] **Step 1: オリジナル退避**

```bash
mkdir -p assets/models/unity_exported_orig
cp assets/models/unity_exported/*.glb assets/models/unity_exported_orig/
echo "assets/models/unity_exported_orig/" >> .gitignore
```

- [ ] **Step 2: 変換スクリプト作成**

`tools/slim_glb.sh`:

```bash
#!/bin/bash
# unity_exported GLB のテクスチャを1024px上限に縮小(ジオメトリ非変更)
set -e
cd "$(dirname "$0")/.."
for f in assets/models/unity_exported/*.glb; do
  echo "== $f"
  npx --yes @gltf-transform/cli resize --width 1024 --height 1024 "$f" "$f.tmp.glb"
  npx --yes @gltf-transform/cli prune "$f.tmp.glb" "$f.tmp2.glb"
  mv "$f.tmp2.glb" "$f"
  rm -f "$f.tmp.glb"
done
ls -la assets/models/unity_exported/
```

注意: `@gltf-transform/cli` が使えない環境なら pygltflib+Pillow でPNG/JPEGバッファを直接リサイズする代替実装に切替(実装者判断)。WebP変換・Draco/meshopt圧縮は **禁止**(r128 GLTFLoader が対応しないため)。

- [ ] **Step 3: 実行してサイズ確認**

Run: `bash tools/slim_glb.sh && du -sh assets/models/unity_exported`
Expected: 合計が概ね 20MB 以下。各GLBが破損なく出力される。

- [ ] **Step 4: 視覚検証**

ブラウザでソファ・ベッド・冷蔵庫・洗濯機・トイレを配置して3D確認。変換前(orig)と見比べ、テクスチャ劣化が知覚されないこと(1024pxで家具は十分)。GLBロード失敗のコンソールエラーがないこと。

- [ ] **Step 5: Commit**

```bash
git add tools/slim_glb.sh .gitignore assets/models/unity_exported/*.glb
git commit -m "Slim furniture GLB textures to 1024px"
```

---

### Task 5: LIXIL窓規格プリセット(WS2-1)【Sonnet委譲可・統合はメイン】

**Files:**
- Modify: `index.html` — ISIZES付近(~3085行)にプリセット表追加、窓プロパティパネル(~4006行付近)、`updateSelectedProp` 系(~4201行付近)

**Interfaces:**
- Produces: `WINDOW_STD_PRESETS`(配列)、`applyWindowStdPreset(id)`(選択中の窓に規格寸法を適用)
- 3D反映: 既存の `buildWinFrames` が `it.w` / `it.windowHeight` / `it.windowSill` を読むため、値を設定するだけで3D寸法が規格に一致する

- [ ] **Step 1: プリセット表を追加**

`ISIZES` 定義の直後に追加。LIXILサッシ呼称(幅3桁=W/10、高さ2桁)準拠。窓台高さは「まぐさ高2000mm基準」(sill = 2000 - H、掃き出しは0):

```js
// LIXIL系サッシ呼称寸法プリセット(W×H mm)。sill はまぐさ高2000基準。
var WINDOW_STD_PRESETS=[
  {id:'02607', label:'02607 縦すべり出し W260×H770',   w:260,  h:770,  kind:'window'},
  {id:'03613', label:'03613 縦すべり出し W405×H1370',  w:405,  h:1370, kind:'window'},
  {id:'06905', label:'06905 引違い W690×H570',        w:690,  h:570,  kind:'window'},
  {id:'07409', label:'07409 引違い W780×H970',        w:780,  h:970,  kind:'window'},
  {id:'11909', label:'11909 引違い W1235×H970',       w:1235, h:970,  kind:'window'},
  {id:'16509', label:'16509 引違い W1690×H970',       w:1690, h:970,  kind:'window'},
  {id:'16511', label:'16511 引違い W1690×H1170',      w:1690, h:1170, kind:'window'},
  {id:'16513', label:'16513 引違い W1690×H1370',      w:1690, h:1370, kind:'window'},
  {id:'16520', label:'16520 掃き出し W1690×H2030',    w:1690, h:2030, kind:'window-door'},
  {id:'25620', label:'25620 掃き出し W2600×H2030',    w:2600, h:2030, kind:'window-door'}
];
function windowStdSill(p){ return p.kind==='window-door' ? 0 : Math.max(0, 2000 - p.h); }
function applyWindowStdPreset(id){
  var it=ST.selected;
  if(!it || !isWindowLikeType(it.type)) return;
  if(isObjectLocked(it)){ updateProps(); return; }
  var p=null;
  for(var i=0;i<WINDOW_STD_PRESETS.length;i++){ if(WINDOW_STD_PRESETS[i].id===id){p=WINDOW_STD_PRESETS[i];break;} }
  if(!p) return;
  saveState();
  var oldCx=(it.x||0)+(it.w||0)/2, oldCy=(it.y||0)+(it.d||0)/2;
  it.w=p.w;
  it.x=oldCx-it.w/2; it.y=oldCy-(it.d||150)/2;
  it.windowSill=windowStdSill(p);
  it.windowHeight=p.h;
  it.windowStd=p.id;
  normalizeWindowVerticalProps(it,'windowHeight');
  draw2d();
  if(ren) rebuild3D();
  updateProps();
}
```

- [ ] **Step 2: プロパティパネルにセレクタ追加**

4006行付近(「窓の縦高さ」入力の直前)の窓プロパティ生成部に追加:

```js
var stdOpts='<option value="">規格サイズを選択...</option>';
WINDOW_STD_PRESETS.forEach(function(p){
  stdOpts+='<option value="'+p.id+'"'+(it.windowStd===p.id?' selected':'')+'>'+p.label+'</option>';
});
html += '<div class="pr"><div class="pl">サッシ規格 (LIXIL呼称)</div><select class="pi" onchange="applyWindowStdPreset(this.value)">'+stdOpts+'</select></div>';
```

注意: 幅・高さ・取付高を手動変更したとき `it.windowStd` が実寸と乖離する。`updateSelectedProp` で `p==='w'||p==='windowHeight'||p==='windowSill'` の場合に `delete ST.selected.windowStd;` を追加すること。

- [ ] **Step 3: 構文チェック**

Run: `python3 scripts/check_js.py` → `JS syntax OK`

- [ ] **Step 4: ブラウザ検証**

- 窓を配置 → プロパティに「サッシ規格」セレクタが出る
- `16520 掃き出し` 選択 → 2D幅が1690mmに、3Dで床から H2030 のガラス面になる(取付高0)
- `16509` 選択 → 取付高(窓台)が1030mm、H970(サッシ上端2000mm)で3D反映
- 手動で幅を変えるとセレクタが未選択に戻る
- 既存保存プランを読込んでも窓が従来通り表示される

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add LIXIL standard sash size presets"
```

---

### Task 6: 建具・階段の規格整合(WS2-2)【Sonnet委譲可】

**Files:**
- Modify: `index.html` — ドアプロパティパネル、`ISIZES`(door-front)、階段3D生成(`build3DOpenStraightStair` ~10137行と呼出元)

- [ ] **Step 1: 室内ドア幅の系列プリセット**

室内開きドア(`door-swing` / `door-swing-s`)のプロパティに幅セレクタを追加(該当パネル生成部を `grep -n "doorHeight" index.html` で特定):

```js
var DOOR_STD_WIDTHS=[
  {w:650, label:'W650 (トイレ・洗面)'},
  {w:750, label:'W750 (標準)'},
  {w:780, label:'W780 (標準・広め)'}
];
```

セレクタ選択で `updateSelectedProp('w', 値)` 相当の中心維持リサイズを行う(Task 5 の `applyWindowStdPreset` と同じ中心維持ロジック)。

- [ ] **Step 2: 玄関ドアの規格化**

`ISIZES` の `'door-front':{w:900,d:200}` を `{w:940,d:200}` に変更(LIXILジエスタ2 W940)。玄関ドアの `doorHeight` デフォルトを 2330 にする(`doorHeightMm` のデフォルト分岐を `grep -n "function doorHeightMm" index.html` で確認し、door-front のみ 2330 を返すよう変更)。既存プランは it.w / it.doorHeight を保持しているため影響なし。

- [ ] **Step 3: 階段寸法の基準法整合**

階段3D生成の段数決定ロジックを特定(`grep -n "build3DOpenStraightStair\|stairOrder\|steps" index.html` で呼出元を確認)。段数を「総rise ÷ 蹴上げ目標200mm、蹴上げ上限230mm(建築基準法)」で算出するよう変更:

```js
function stairStepCount(totalRiseMm){
  // 蹴上げ230mm以下(建築基準法)・目標200mm
  var n=Math.round(totalRiseMm/200);
  while(n>1 && totalRiseMm/n>230) n++;
  return Math.max(3,n);
}
```

既存の呼出箇所で固定段数やベタ書きの割り算があれば置換し、2D表示の段割り(踏み板線)が変わらないか確認(2D側が独自計算なら触らない)。

- [ ] **Step 4: 構文チェック + ブラウザ検証**

Run: `python3 scripts/check_js.py` → OK
- 開きドアに幅プリセットが出て選択で2D/3D反映
- 玄関ドア新規配置で W940、3D高さ2330mm
- 階段(1F→2F: rise=FLOOR_H 2700mm)の3D段数が 14段(2700/14≒193mm)前後になり、破綻なく表示される

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Align doors and stairs with JP standards"
```

---

### Task 7: プロシージャル家具の品質向上(WS2-3)【Sonnet委譲可】

**Files:**
- Modify: `index.html` — `build3DSofa`(~10644行)、`build3DKitchen`(~10652行)、`build3DBed`(~10661行)、`build3DDining`(~10667行)、`build3DBath`(~10684行)、`build3DToilet`(~10690行)

**Interfaces:**
- Consumes: 各関数のシグネチャは現状維持(`grp, w, d` 等)。呼出元は変更しない。
- 制約: GLBロード失敗時のフォールバックなのでポリゴン数は控えめに(各家具500tri以下目安)。寸法は引数 `w,d` と `getItemH` の高さに正確に収める。

- [ ] **Step 1: build3DSofa を改良**

現行実装を読み、単一ボックスなら以下の構成に置換(寸法比率は w,d 引数に対する比):

```js
function build3DSofa(grp,w,d){
  var mat=new THREE.MeshStandardMaterial({color:0xb99a72,roughness:0.85,metalness:0.0});
  var darker=new THREE.MeshStandardMaterial({color:0x9a7d58,roughness:0.9,metalness:0.0});
  var legMat=new THREE.MeshStandardMaterial({color:0x4a3826,roughness:0.6,metalness:0.1});
  var seatH=0.36, backH=0.75, armW=Math.min(0.16,w*0.1);
  function box(bw,bh,bd,x,y,z,m){
    var mm=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),m||mat);
    mm.position.set(x,y,z); mm.castShadow=true; mm.receiveShadow=true; grp.add(mm);
  }
  // 座面ベース
  box(w-armW*2, seatH-0.12, d*0.9, 0, 0.12+(seatH-0.12)/2, 0, darker);
  // クッション(2〜3分割)
  var nCush=w>1.8?3:2, cw=(w-armW*2)/nCush-0.02;
  for(var i=0;i<nCush;i++){
    var cx=-(w-armW*2)/2+cw/2+i*((w-armW*2)/nCush)+0.01;
    box(cw, 0.12, d*0.8, cx, seatH+0.02, d*0.03);
  }
  // 背もたれ
  box(w-armW*2, backH-seatH, 0.18, 0, seatH+(backH-seatH)/2, -d/2+0.11);
  // アームレスト
  box(armW, backH*0.72, d*0.92, -(w-armW)/2, backH*0.36, 0, darker);
  box(armW, backH*0.72, d*0.92,  (w-armW)/2, backH*0.36, 0, darker);
  // 脚4本
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.02,0.12,8),legMat);
    leg.position.set(p[0]*(w/2-0.1),0.06,p[1]*(d/2-0.1));
    leg.castShadow=true; grp.add(leg);
  });
}
```

- [ ] **Step 2: GLTF_MAP の未登録アイテムを補完**

`assets/models/` 直下と `unity_exported/` にGLBが存在するのに `GLTF_MAP` に未登録のアイテム型がないか照合し(例: `desk.glb`, `bathtub.glb` 等は登録済みか確認)、あれば追加する。対応GLBがない型のみプロシージャル改良の対象とする。

- [ ] **Step 3: build3DBed / build3DDining / build3DKitchen / build3DBath / build3DToilet を同方針で改良**

各関数の現行実装を読み、以下の要素を持つ形状に改良(既存の色・引数・高さ整合を維持):
- ベッド: フレーム(木質)+マットレス(白系、フレームより一回り小)+枕1〜2個+ヘッドボード
- ダイニング: 天板+テーパー脚4本(Cylinder)+椅子は既存があれば維持
- キッチン: カウンター天板(ステンレス風 metalness 0.6)+キャビネット本体+シンク凹み(暗色ボックス)+水栓(細Cylinder L字)+コンロ面(黒スラブ+円3つ)
- バス: 浴槽外形+内側凹み(上面に暗色の内箱)+縁の丸み(上縁に細いボックス)
- トイレ: タンク+便座(横倒しCylinder半分をスケール)+ボウル

各関数500tri以下。寸法は `w,d` と `getItemH(type)` に収める。

- [ ] **Step 4: 構文チェック + ブラウザ検証**

Run: `python3 scripts/check_js.py` → OK
GLBが読める環境ではフォールバックが出ないため、検証はDevToolsで一時的に `GLTF_MAP={}` を実行してから配置し、各家具のプロシージャル形状を確認。破綻(浮き・めり込み・寸法超過)がないこと。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Improve procedural furniture fallback models"
```

---

### Task 8: サッシ見た目のLIXIL風改良(WS2-3)【Sonnet委譲可】

**Files:**
- Modify: `index.html` — `buildWinFrames`(~8986行)

- [ ] **Step 1: 現行実装を読む**

`buildWinFrames` 全体(8986〜9272行)を読み、フレームのマテリアル・寸法生成箇所を特定。

- [ ] **Step 2: サッシ色プリセットと中桟を追加**

- フレーム色をアイテムプロパティ `it.sashColor` で選択可能に: シャイングレー `#9a9da1`(デフォルト)/ ブラック `#22252a` / ホワイト `#f2f2f0`。undefined 時は現行色のままにして既存プラン互換を維持。
- 引違い窓(`window` / `window-door`)に縦の中桟(召合せ框)を1本追加: 幅30mm相当のボックスをガラス中央に。マテリアルはフレームと共通。
- フレーム見付は現行値を確認し、過剰に太い場合は 70mm 相当(LIXILサーモス系の細框)に調整。
- 窓プロパティパネルに「サッシ色」セレクタを追加(Task 5 のセレクタの下)。

- [ ] **Step 3: 構文チェック + ブラウザ検証**

Run: `python3 scripts/check_js.py` → OK
窓・掃き出し窓を3D外観/内観で確認: 中桟が入り引違いに見える。色切替が反映される。既存プランの窓が崩れない。

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add sash colors and center mullion to windows"
```

---

### Task 9: 雨樋・竪樋・雨水枡の自動生成(WS3-1)

**Files:**
- Modify: `index.html` — `build3DRoofItem`(~9272行)、`buildItem3D` の roof 分岐(~9542行)、外観設定パネル(`renderExteriorWallPanel` を `grep -n` で特定)

**Interfaces:**
- Produces: `build3DRoofGutters(grp,it,W,D,groundLocalY)` — 屋根タイプ別に軒樋・竪樋・雨水枡を grp に追加。`exteriorDetailEnabled('gutters')` — トグル状態(デフォルトtrue)。
- データ: `DATA.exteriorDetail={gutters:true}`(未定義時 true 扱い、保存データ互換)

- [ ] **Step 1: トグル基盤を追加**

`DATA` を触るヘルパ群の近く(`ensureExteriorWallSettings` 付近)に:

```js
function exteriorDetailEnabled(key){
  if(!DATA.exteriorDetail) return true;
  return DATA.exteriorDetail[key]!==false;
}
function setExteriorDetail(key,on){
  if(!DATA.exteriorDetail) DATA.exteriorDetail={};
  DATA.exteriorDetail[key]=!!on;
  if(ren) rebuild3D();
}
```

外観設定パネル(外壁色パネルの下)にチェックボックスを追加:

```js
html+='<div class="pr"><div class="pl">雨樋・排水を表示</div><input type="checkbox" '+(exteriorDetailEnabled('gutters')?'checked':'')+' onchange="setExteriorDetail(\'gutters\',this.checked)"></div>';
```

(パネルHTML生成の書式は周辺コードに合わせること)

- [ ] **Step 2: 雨樋生成関数を追加**

`build3DRoofItem` の直後に追加。屋根タイプごとの軒エッジ(雨が落ちる辺)を列挙し、半丸軒樋+竪樋+雨水枡を生成:

```js
var GUTTER_MAT_CACHE=null;
function gutterMaterials(){
  if(!GUTTER_MAT_CACHE){
    GUTTER_MAT_CACHE={
      gutter:new THREE.MeshStandardMaterial({color:0x6b6e73,roughness:0.55,metalness:0.35,side:THREE.DoubleSide}),
      pit:new THREE.MeshStandardMaterial({color:0x7c7f83,roughness:0.8,metalness:0.1})
    };
  }
  return GUTTER_MAT_CACHE;
}
// 軒エッジ定義: {x1,z1,x2,z2,y} 軒先の両端(グループローカル座標)と軒高
function roofEaveEdges(it,W,D){
  var type=it.roofType||'gable';
  var edges=[];
  var y=0; // 軒先は屋根アイテムのローカル基準面
  if(type==='flat'||type==='hip'||type==='hip-ridge'||type==='hip-ridge-long'){
    edges.push({x1:-W/2,z1:-D/2,x2:W/2,z2:-D/2,y:y});
    edges.push({x1:W/2,z1:D/2,x2:-W/2,z2:D/2,y:y});
    edges.push({x1:-W/2,z1:D/2,x2:-W/2,z2:-D/2,y:y});
    edges.push({x1:W/2,z1:-D/2,x2:W/2,z2:D/2,y:y});
  } else if(type==='mono'){
    edges.push({x1:-W/2,z1:-D/2,x2:W/2,z2:-D/2,y:y}); // 低い側のみ
  } else if(type==='gable-y'){
    edges.push({x1:-W/2,z1:D/2,x2:-W/2,z2:-D/2,y:y});
    edges.push({x1:W/2,z1:-D/2,x2:W/2,z2:D/2,y:y});
  } else { // gable
    edges.push({x1:-W/2,z1:-D/2,x2:W/2,z2:-D/2,y:y});
    edges.push({x1:W/2,z1:D/2,x2:-W/2,z2:D/2,y:y});
  }
  return edges;
}
function build3DRoofGutters(grp,it,W,D,groundLocalY){
  var mats=gutterMaterials();
  var rG=0.055; // 軒樋半径(半丸105)
  var rP=0.03;  // 竪樋φ60
  var edges=roofEaveEdges(it,W,D);
  var downspoutAt=[]; // 竪樋位置(エッジ始端に1本)
  edges.forEach(function(e){
    var len=Math.hypot(e.x2-e.x1,e.z2-e.z1);
    if(len<0.3) return;
    var geo=new THREE.CylinderGeometry(rG,rG,len,8,1,true,Math.PI,Math.PI); // 下半分の半丸
    var m=new THREE.Mesh(geo,mats.gutter);
    m.position.set((e.x1+e.x2)/2, e.y-0.03, (e.z1+e.z2)/2);
    m.rotation.z=Math.PI/2;
    m.rotation.y=Math.atan2(e.z2-e.z1,e.x2-e.x1)*-1;
    m.castShadow=false; m.receiveShadow=false;
    grp.add(m);
    // エッジ始端から100mm内側に竪樋
    var t=0.1/len;
    downspoutAt.push({x:e.x1+(e.x2-e.x1)*t, z:e.z1+(e.z2-e.z1)*t, y:e.y});
  });
  downspoutAt.forEach(function(p){
    var h=p.y-groundLocalY;
    if(h<0.5) return;
    var pipe=new THREE.Mesh(new THREE.CylinderGeometry(rP,rP,h,8),mats.gutter);
    pipe.position.set(p.x, p.y-h/2, p.z);
    pipe.castShadow=false; pipe.receiveShadow=false;
    grp.add(pipe);
    // 雨水枡(150角)
    var pit=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.04,0.15),mats.pit);
    pit.position.set(p.x, groundLocalY+0.02, p.z);
    grp.add(pit);
  });
}
```

注意(実装時に要調整):
- 竪樋は本来壁面沿いに立つ。屋根は軒の出(overhang)分だけ壁より外に広いため、竪樋XZを 150mm 程度内側にオフセットして壁際に寄せると自然(`roofSkirt` や軒の出設定があれば利用)。
- `CylinderGeometry` の半丸パラメータ(thetaStart/thetaLength)は r128 では第7,8引数。開口が上を向くよう rotation を視覚確認して調整すること。

- [ ] **Step 3: buildItem3D から呼び出す**

roof 分岐(9542行)を:

```js
if(it.type==='roof'){
  build3DRoofItem(grp,it,it.w*U,it.d*U);
  if(!isInt && exteriorDetailEnabled('gutters')){
    build3DRoofGutters(grp,it,it.w*U,it.d*U,-grp.position.y);
  }
  mark3DSelectable(grp,it,'item'); sc3.add(grp);
  return;
}
```

- [ ] **Step 4: 構文チェック**

Run: `python3 scripts/check_js.py` → `JS syntax OK`

- [ ] **Step 5: ブラウザ検証**

- 切妻屋根を配置 → 両軒先に半丸樋、両端に竪樋2本が地面まで、足元に雨水枡
- 寄棟 → 四周に樋
- 片流れ → 低い側のみ
- 2F屋根でも竪樋が地面まで届く(floorBaseY 分の高さ)
- トグルOFF → 全て消える。保存→リロードでトグル状態維持
- 屋根の回転・移動・フリップに樋が追従(グループ内生成なので自動)
- 内観ビューでは生成されない
- フレームレート悪化なし(低ポリ・影なし)

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Auto-generate rain gutters, downspouts and pits from roofs"
```

---

### Task 10: 基礎水切り+外部設備アイテム(WS3-2)【Sonnet委譲可】

**Files:**
- Modify: `index.html` — `build3DFoundation`(~10548行)、`ISIZES` / `ICOLORS` / ラベル表(~3492行)/ アイコン表(~3859行)/ `getItemH`(10106行)/ `getItemCol`(10107行)/ `buildItem3D` 分岐 / 外構カテゴリのツールリスト(`grep -n "'utility-pole'" index.html` でカタログ定義箇所を特定)

**Interfaces:**
- Produces: 新アイテム型 `ac-outdoor`(エアコン室外機)/ `water-heater`(給湯器エコキュート)/ `meter-box`(電気メーター)/ `sewer-pit`(汚水枡)。各 `build3DAcOutdoor` / `build3DWaterHeater` / `build3DMeterBox` / `build3DSewerPit` 関数。

- [ ] **Step 1: 基礎水切りを自動生成**

`build3DFoundation` 内、基礎立ち上がり天端に周回の細い見切り(水切り)を追加:

```js
// 基礎水切り(周回、見付40mm・出15mm)
var mizuMat=new THREE.MeshStandardMaterial({color:0x4a4d52,roughness:0.5,metalness:0.4});
var fh=(Number(it.foundationHeight)||450)*U; // build3DFoundation 内に既存の高さ変数があればそれを使う
[[0,-d/2-0.0075,w+0.03,0.015],[0,d/2+0.0075,w+0.03,0.015],[-w/2-0.0075,0,0.015,d],[w/2+0.0075,0,0.015,d]].forEach(function(s){
  var mz=new THREE.Mesh(new THREE.BoxGeometry(s[2],0.04,s[3]),mizuMat);
  mz.position.set(s[0],fh-0.02,s[1]);
  grp.add(mz);
});
```

(既存の基礎メッシュ寸法変数名に合わせて調整。トグルは Task 9 の `exteriorDetailEnabled('gutters')` を共用)

- [ ] **Step 2: 新アイテム型の登録**

規格寸法(実勢値):

```js
// ISIZES に追加
'ac-outdoor':{w:800,d:300}, 'water-heater':{w:630,d:760}, 'meter-box':{w:180,d:120}, 'sewer-pit':{w:300,d:300},
// getItemH のマップに追加
'ac-outdoor':630, 'water-heater':1850, 'meter-box':250, 'sewer-pit':20,
// ラベル表(3492行付近)
'ac-outdoor':'エアコン室外機', 'water-heater':'給湯器(エコキュート)', 'meter-box':'電気メーター', 'sewer-pit':'汚水枡',
// ICOLORS / getItemCol
'ac-outdoor':'#d8dadc', 'water-heater':'#e8e9eb', 'meter-box':'#c8cacc', 'sewer-pit':'#6f7275',
```

外構カテゴリのツールリスト(fence / utility-pole 等が並ぶ配列)に4種を追加。`meter-box` は `elev` デフォルト1600(壁面設置想定)にする(アイテム生成時の初期値設定箇所 4522行付近を参照)。

- [ ] **Step 3: 3D生成関数**

`build3DUtilityPole` の後に追加し、`buildItem3D` に分岐を足す:

```js
function build3DAcOutdoor(grp,w,d,h){
  var body=new THREE.MeshStandardMaterial({color:0xd8dadc,roughness:0.6,metalness:0.25});
  var dark=new THREE.MeshStandardMaterial({color:0x8b8e92,roughness:0.7,metalness:0.2});
  var b=new THREE.Mesh(new THREE.BoxGeometry(w,h*0.92,d),body);
  b.position.y=h*0.54; b.castShadow=true; grp.add(b);
  // ファンガード(正面円)
  var fan=new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w,h)*0.32,Math.min(w,h)*0.32,0.02,20),dark);
  fan.rotation.x=Math.PI/2;
  fan.position.set(-w*0.22,h*0.55,d/2+0.005);
  grp.add(fan);
  // 架台2本
  [[-1],[1]].forEach(function(p){
    var foot=new THREE.Mesh(new THREE.BoxGeometry(0.06,h*0.08,d*0.9),dark);
    foot.position.set(p[0]*(w/2-0.08),h*0.04,0);
    grp.add(foot);
  });
}
function build3DWaterHeater(grp,w,d,h){
  var body=new THREE.MeshStandardMaterial({color:0xe8e9eb,roughness:0.4,metalness:0.3});
  // 貯湯タンク(角丸風: box + 前面にわずかな面取り)
  var tank=new THREE.Mesh(new THREE.BoxGeometry(w,h,d*0.75),body);
  tank.position.set(0,h/2,-d*0.1); tank.castShadow=true; grp.add(tank);
  // ヒートポンプユニット(横に置く想定で前面に小箱)
  var hp=new THREE.Mesh(new THREE.BoxGeometry(w*0.9,h*0.38,d*0.28),body);
  hp.position.set(0,h*0.19,d*0.33); hp.castShadow=true; grp.add(hp);
}
function build3DMeterBox(grp,w,d,h){
  var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),
    new THREE.MeshStandardMaterial({color:0xc8cacc,roughness:0.5,metalness:0.2}));
  m.position.y=h/2; grp.add(m);
}
function build3DSewerPit(grp,w,d){
  var disc=new THREE.Mesh(new THREE.CylinderGeometry(w/2,w/2,0.02,16),
    new THREE.MeshStandardMaterial({color:0x6f7275,roughness:0.85,metalness:0.15}));
  disc.position.y=0.01; grp.add(disc);
}
```

`buildItem3D` の分岐(exterior-stair 等と同じ並び)に:

```js
if(it.type==='ac-outdoor'){ build3DAcOutdoor(grp,it.w*U,it.d*U,getItemHeightValue(it)*U); mark3DSelectable(grp,it,'item'); sc3.add(grp); return; }
if(it.type==='water-heater'){ build3DWaterHeater(grp,it.w*U,it.d*U,getItemHeightValue(it)*U); mark3DSelectable(grp,it,'item'); sc3.add(grp); return; }
if(it.type==='meter-box'){ build3DMeterBox(grp,it.w*U,it.d*U,getItemHeightValue(it)*U); mark3DSelectable(grp,it,'item'); sc3.add(grp); return; }
if(it.type==='sewer-pit'){ build3DSewerPit(grp,it.w*U,it.d*U); mark3DSelectable(grp,it,'item'); sc3.add(grp); return; }
```

注意: `ac-outdoor` 等は外構(接地)アイテムなので `item3DBaseY` が床上基準を返す。1F外周に置く場合は基礎高が足されないよう、`item3DBaseY` の接地判定リスト(3058行)に4種を追加して y=0 接地にする。ただし `meter-box` は elev で壁面高さに置くため接地リストに入れて elev 加算に任せる。

- [ ] **Step 4: 2D表示の確認**

新アイテムが2Dで汎用矩形+ラベル表示されることを確認(専用スプライト不要)。表示されない場合は2D描画の型分岐(汎用フォールバック)を確認。

- [ ] **Step 5: 構文チェック + ブラウザ検証**

Run: `python3 scripts/check_js.py` → OK
- カタログ外構カテゴリに4種が出る
- 各配置で2D/3D表示、回転・移動・削除が正常
- 室外機のファン・給湯器のタンク形状が判別できる
- 保存→リロードで復元される

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add foundation flashing and exterior utility items"
```

---

### Task 11: 太陽軌道シミュレーション(WS4)

**Files:**
- Modify: `index.html` — `LIGHT_SETTINGS` / `LIGHT_PRESETS`(2991行〜)、`applyLightingToScene`(7327行)、`makeSkyTexture`(6425行)、ライトパネルUI(`syncLightPanelUi` 周辺)

**Interfaces:**
- Produces: `computeSunPosition(hour,season,northDeg)` → `{x,y,z,altitude,azimuth}`(半径220の太陽位置)。`LIGHT_SETTINGS.sunSim`(bool)、`LIGHT_SETTINGS.hour`(5..19)、`LIGHT_SETTINGS.season`('summer'|'equinox'|'winter')、`LIGHT_SETTINGS.northDeg`(0-359、0=画面奥が北)
- 既存プリセット(朝昼夕夜)は従来通り動作(sunSim=false 時は現行 sunPos を使用)

- [ ] **Step 1: 太陽位置計算を追加**

`LIGHT_PRESETS` 定義の直後に:

```js
// 東京近郊(緯度35.7度)の簡易太陽軌道
function computeSunPosition(hour,season,northDeg){
  var lat=35.7*Math.PI/180;
  var decl=(season==='summer'?23.4:season==='winter'?-23.4:0)*Math.PI/180;
  var H=(hour-12)*15*Math.PI/180; // 時角
  var alt=Math.asin(Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.cos(H));
  var az=Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat)-Math.tan(decl)*Math.cos(lat)); // 0=南, +西
  var azWorld=az+Math.PI+(northDeg||0)*Math.PI/180; // ワールド方位(0=北=-Z方向)
  var R=220;
  var y=Math.max(8,Math.sin(alt)*R);
  var horiz=Math.cos(alt)*R;
  return {
    x:Math.sin(azWorld)*horiz,
    y:y,
    z:-Math.cos(azWorld)*horiz,
    altitude:alt, azimuth:azWorld
  };
}
// 高度に応じた太陽光の色(低高度=暖色)
function sunColorForAltitude(alt){
  var t=Math.max(0,Math.min(1,alt/(Math.PI/3))); // 0=地平線,1=60度以上
  var warm={r:255,g:158,b:88}, cool={r:255,g:250,b:244};
  var r=Math.round(warm.r+(cool.r-warm.r)*t);
  var g=Math.round(warm.g+(cool.g-warm.g)*t);
  var b=Math.round(warm.b+(cool.b-warm.b)*t);
  return 'rgb('+r+','+g+','+b+')';
}
```

`LIGHT_SETTINGS` に初期値を追加:

```js
var LIGHT_SETTINGS = {timeOfDay:'day',hemi:0.38, sun:0.78, ambient:0.16, room:0.25, exposure:0.93, env:0.42,
  sunSim:false, hour:13, season:'equinox', northDeg:0};
```

- [ ] **Step 2: applyLightingToScene に組み込む**

SunLight 分岐(7340行付近)を変更:

```js
var p=preset.sunPos||LIGHT_PRESETS.day.sunPos;
if(LIGHT_SETTINGS.sunSim){
  var sp=computeSunPosition(LIGHT_SETTINGS.hour,LIGHT_SETTINGS.season,LIGHT_SETTINGS.northDeg);
  o.position.set(sp.x,sp.y,sp.z);
  o.color.set(sunColorForAltitude(sp.altitude));
  // 高度が低いほど光量を落とす(日没近似)
  var dim=Math.max(0.12,Math.min(1,Math.sin(sp.altitude)*1.6));
  o.intensity=interiorMode?0:LIGHT_SETTINGS.sun*dim;
} else {
  o.position.set(p.x,p.y,p.z);
}
```

`fitShadowCamera` が太陽位置に依存する場合(6699行)、sunSim時にも正しく追従するか確認。

- [ ] **Step 3: 空の太陽位置連動**

`makeSkyTexture` の太陽描画位置(6452行)を sunSim 時は方位から算出:

```js
var sunX=c.width*(sky.sunX==null?0.78:sky.sunX), sunY=c.height*(sky.sunY==null?0.2:sky.sunY);
if(LIGHT_SETTINGS.sunSim){
  var sp=computeSunPosition(LIGHT_SETTINGS.hour,LIGHT_SETTINGS.season,LIGHT_SETTINGS.northDeg);
  sunX=c.width*((sp.azimuth%(Math.PI*2))/(Math.PI*2));
  sunY=c.height*Math.max(0.06,0.5-Math.sin(sp.altitude)*0.44);
}
```

さらに低高度(altitude<15度)のとき horizon 色を夕焼け寄りに補間(evening プリセットの sky.horizon と lerp)。

- [ ] **Step 4: UI追加**

ライトパネル(朝昼夕夜ボタンのある場所)に追加:
- トグル「太陽シミュレーション」→ `LIGHT_SETTINGS.sunSim`
- スライダー「時刻」5〜19(step 0.5、表示 "13:00" 形式)
- セレクト「季節」夏至/春秋分/冬至
- 数値「北の方角」0-359度
- 変更時: `applyLightingToScene(true)` を呼ぶ(空も再生成)。sunSim ON時は朝昼夕ボタンが hour を 7/13/17 にセットするよう `applyLightPreset` を拡張(night は sunSim を解除して従来夜景)

UIの書式・イベント接続は既存のライトパネル生成コード(`syncLightPanelUi` / パネルHTML)に合わせる。

- [ ] **Step 5: 構文チェック + ブラウザ検証**

Run: `python3 scripts/check_js.py` → OK
- sunSim ON、時刻スライダーを 6→18 に動かす → 影が東→西へ回り、朝夕は暖色・長影、正午は高く短影
- 冬至は正午でも影が長い(南中高度約31度)、夏至は短い(約78度)
- 北方角を90度回すと影の向きが90度回る
- 空の太陽・色が時刻に追従
- sunSim OFF → 従来の朝昼夕夜プリセットが完全に従来通り
- 内観ビュー・2Dに影響なし

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add solar path simulation with time/season/orientation"
```

---

### Task 12: 室内照明の色温度プリセット(WS4)【Sonnet委譲可】

**Files:**
- Modify: `index.html` — ライトアイテムのプロパティパネル(4077行付近「ライトカラー」の隣)

- [ ] **Step 1: 色温度ボタンを追加**

```js
var LIGHT_KELVIN_PRESETS=[
  {label:'電球色', color:'#ffd9a6'},
  {label:'温白色', color:'#ffe9cc'},
  {label:'昼白色', color:'#fff8f0'},
  {label:'昼光色', color:'#eef3ff'}
];
```

「ライトカラー」入力の直後にボタン列を生成:

```js
html += '<div class="pr"><div class="pl">色温度プリセット</div><div>';
LIGHT_KELVIN_PRESETS.forEach(function(k){
  html += '<button class="pbtn" style="background:'+k.color+';color:#333" onclick="updateSelectedProp(\'lightColor\',\''+k.color+'\')">'+k.label+'</button>';
});
html += '</div></div>';
```

(ボタンclassは既存の `pbtn` 等パネル内の書式に合わせる)

- [ ] **Step 2: 構文チェック + ブラウザ検証**

Run: `python3 scripts/check_js.py` → OK
照明アイテム選択 → 4ボタン表示 → 押すと lightColor が変わり内観3Dの光色が変化。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add color-temperature presets for interior lights"
```

---

### Task 13: 総合検証・性能計測・ビルド確認

**Files:**
- Modify: なし(検証のみ。問題があれば該当タスクに戻る)

- [ ] **Step 1: 全機能スモークテスト(ブラウザ)**

`python3 -m http.server 8931` + Chrome automation で:
1. 新規プラン作成 → 部屋・壁・窓(規格プリセット)・ドア・階段・家具・屋根・基礎・外構(新4種)を配置
2. 2D→3D外観→3D内観→ウォークスルー→2D の往復
3. スクリーンショット取得(黒画像でない)
4. 保存 → リロード → 全アイテム復元(雨樋トグル・sunSim設定含む)
5. AI間取り生成(該当機能)が動く(12461行のプロンプト機能)
6. コンソールにエラーなし

- [ ] **Step 2: 性能計測(前後比較)**

DevTools Performance で30秒記録(操作10秒+静止20秒):
- 静止時のscripting+renderingがほぼゼロ(保険レンダのみ)
- 操作時フレームレートが従来以上
- メモリ: GLB複数配置時のGPUメモリが軽量化前より減少
結果を数値でユーザーに報告する。

- [ ] **Step 3: モバイルレイアウト確認**

DevToolsのiPadエミュレーション(タッチ)で 3D操作・パネルUI(新セレクタ・スライダー)が操作可能なこと。

- [ ] **Step 4: ビルド確認**

Run: `SKIP_DEPLOY=1 bash build.sh`
Expected: `Build complete: dist/`、25MB超過アセット警告なし(unity_exported 軽量化後)。デプロイはユーザーに確認してから。

- [ ] **Step 5: 最終コミット**

未コミット差分があれば整理してコミット。実装サマリをユーザーに報告。
