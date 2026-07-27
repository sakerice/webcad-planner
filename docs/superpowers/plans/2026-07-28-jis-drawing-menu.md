# JIS図面出力メニュー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JIS準拠の白黒平面図+東西南北立面図をSVGで生成・表示・印刷/PDF・PNG保存できるメニューと、外観3Dの立面方向カメラスナップボタンを追加する。

**Architecture:** `index.html` 内に読み取り専用の `JISDRAW` IIFEモジュールを追加し、`DATA`(walls/items/rooms)からSVG文字列を純粋関数で生成する。UIは全画面モーダル1枚。印刷はhidden iframe+`@page` CSS。既存コードへの変更はツールバーボタン1個・モーダルHTML・外観3Dオーバーレイボタンのみ。

**Tech Stack:** Vanilla JS (ES5スタイル、`var`使用)、インラインSVG、three.js(カメラスナップのみ)。外部ライブラリ追加なし。

**Spec:** `docs/superpowers/specs/2026-07-28-jis-drawing-menu-design.md`

## Global Constraints

- すべて `index.html` 単一ファイル内に実装(このコードベースの既存パターン)
- 既存関数・`DATA` 構造は読み取りのみ。変更禁止
- コードスタイル: `var` ベースのES5風、コメントは日本語で「制約を書く」(既存流儀)
- iPad Safari で動くこと(`navigator.maxTouchPoints` 分岐の既存配慮を壊さない)
- 構文チェック: `node tools/check-html-js.cjs` — **script 2(importmap JSON)のSyntaxErrorは既知の誤検知**。それ以外のエラーが出ないこと
- ブランチ: `feature/jis-drawing-menu`(作成済み)
- コミットメッセージ末尾に定型のCo-Authored-By/Claude-Sessionを付ける

## 既存コードの前提知識(全タスク共通)

- 座標系: ワールド座標はmm。`x`=東(+)、`y`=画面下=南(+)。**北=2D画面の上**。3Dは `x→x[m], y→高さ[m], 2Dのy→z[m]`、変換係数 `U=0.001`(mm→m)
- `DATA.walls[]`: `{x1,y1,x2,y2,thick,floor,wallHeight?,...}`(mm)。`DATA.items[]`: `{type,x,y,w,d,rot,floor,...}`。`DATA.rooms[]`: `{x,y,w,d,floor,n(名前)}`
- 高さ関数(すべてm返し): `foundationHeightM()`, `floorBaseY(floor)`(その階の床レベル), `wallFullHeightM(floor)`, `wallHeightMm(w)`(mm), `floorSlabHeightMForFloor(floor)`
- 開口(窓/ドア)はitems。`isOpeningItemType(it.type)`、壁との対応は `getOpeningWallInfo(it)`(`index.html:5730`付近)。窓の高さ `windowHeightMm(it)`、敷居高 `openingSillMm(it)`。窓種 `it.windowKind`('sliding'/'fix'等)
- 既存2D描画のJIS表現(移植元): 壁断面 `drawWall2d`(`:5664`)、建具記号 `:6795-6850` 付近(開き戸1/4円・引違い・開口破線)
- 屋根: `type:'roof'` のitem。`it.roofType`(gable/gable-y/hip/hip-ridge/hip-ridge-long/flat/mono)、`it.pitch`(度、デフォルト30)。3D生成コードは `:11179` 付近から
- 階段: `it.type==='stair'||'stair-corner'`。部屋の畳数計算の既存例: `:5627`(`1.62㎡=1帖`換算)
- ツールバーのAIレンダーボタン: `:3010`。外観3Dカメラ: `camExt`/`orbit`、`fitCameraToScene()`(`:7734`)
- 検証方法: `python3 tools/dev_server.py` などでローカルサーバーを立て、Playwright MCPブラウザで操作・スクリーンショット確認(テストフレームワークは無いので、構文チェック+ブラウザ目視が本プロジェクトの検証手段)

---

### Task 1: JISDRAWモジュール骨格+ツールバーボタン+モーダルUI

**Files:**
- Modify: `index.html:3010` 付近(ツールバー)、`</body>`前のモーダルHTML群、スクリプト末尾(JISDRAWモジュール)

**Interfaces:**
- Produces: `JISDRAW.buildFloorPlanSvg(floor, opts)` / `JISDRAW.buildElevationSvg(dir, opts)`(この段階ではプレースホルダSVGを返す)、`openJisDrawingDialog()`, `closeJisDrawingDialog()`, `jisSelectSheet(kind, key)`。`opts = {scale:'auto'|50|100|200, paper:'a3'|'a4'}`
- 図面リストの決定ロジック: `JISDRAW.availableSheets()` → `[{kind:'plan',key:1,label:'平面図 1F'},...,{kind:'elev',key:'e',label:'東立面図'},...]`(壁が1枚以上ある階のみplanを含める。壁が全階ゼロなら空配列)

- [ ] **Step 1: ツールバーにボタン追加**

`index.html:3010` のAIレンダーボタンの直後に:

```html
<button class="tbtn mob-hide" id="jis-drawing-toolbar-btn" onclick="openJisDrawingDialog()">📄 JIS図面</button>
```

- [ ] **Step 2: モーダルHTML+CSSを追加**

既存モーダル(`unity-render` 系のダイアログ)のCSSパターンを踏襲し、`<body>`末尾側に:

```html
<div id="jis-drawing-overlay" class="jis-overlay" style="display:none">
  <div class="jis-dialog">
    <div class="jis-toolbar">
      <span class="jis-title">JIS図面出力</span>
      <select id="jis-scale" onchange="jisRerender()">
        <option value="auto">縮尺: 自動</option>
        <option value="50">1:50</option>
        <option value="100">1:100</option>
        <option value="200">1:200</option>
      </select>
      <select id="jis-paper" onchange="jisRerender()">
        <option value="a3">A3 横</option>
        <option value="a4">A4 横</option>
      </select>
      <button class="pbtn" onclick="jisPrint()">🖨 印刷/PDF</button>
      <button class="pbtn sec" onclick="jisDownloadSvg()">⬇ SVG</button>
      <button class="pbtn sec" onclick="jisDownloadPng()">⬇ PNG</button>
      <button class="jis-close" onclick="closeJisDrawingDialog()">✕</button>
    </div>
    <div class="jis-body">
      <div id="jis-sheet-list"></div>
      <div id="jis-preview"></div>
    </div>
  </div>
</div>
```

CSS(要点): `.jis-overlay{position:fixed;inset:0;z-index:...;background:rgba(0,0,0,.55)}`、`.jis-dialog` は白背景・ほぼ全画面、`.jis-body` は左リスト(160px)+右プレビューのflex、`#jis-preview` は `overflow:auto;background:#888` で図面SVGを紙(白い影付きdiv)として中央表示。プレビューSVGは `width:100%` で紙divにフィット。

- [ ] **Step 3: JISDRAWモジュール骨格+ダイアログ制御JSを追加**

スクリプト末尾(AIレンダー関連関数の後)に:

```js
// ── JIS図面出力(JIS A 0150準拠の白黒図面SVG生成) ──
var JISDRAW=(function(){
  // 紙上の線幅mm × 縮尺 = 実寸mmのstroke-width。SVGのuser unit=実寸mm
  function lineWidths(scale){
    return {thick:0.5*scale, mid:0.25*scale, thin:0.13*scale, text:3.0*scale};
  }
  function availableSheets(){
    var sheets=[];
    [1,2,3,4].forEach(function(f){
      if(DATA.walls.some(function(w){return (w.floor||1)===f;}))
        sheets.push({kind:'plan',key:f,label:'平面図 '+f+'F'});
    });
    if(sheets.length){
      [['e','東立面図'],['w','西立面図'],['s','南立面図'],['n','北立面図']].forEach(function(d){
        sheets.push({kind:'elev',key:d[0],label:d[1]});
      });
    }
    return sheets;
  }
  function buildFloorPlanSvg(floor,opts){ return placeholderSvg('平面図 '+floor+'F(実装中)'); }
  function buildElevationSvg(dir,opts){ return placeholderSvg('立面図(実装中)'); }
  function placeholderSvg(label){
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297">'
      +'<rect width="420" height="297" fill="#fff"/>'
      +'<text x="210" y="148" text-anchor="middle" font-size="12" fill="#000">'+label+'</text></svg>';
  }
  return {availableSheets:availableSheets, buildFloorPlanSvg:buildFloorPlanSvg, buildElevationSvg:buildElevationSvg, lineWidths:lineWidths};
})();

var JIS_UI={sheet:null};
function openJisDrawingDialog(){
  var sheets=JISDRAW.availableSheets();
  var ov=document.getElementById('jis-drawing-overlay');
  ov.style.display='flex';
  if(!sheets.length){
    document.getElementById('jis-preview').innerHTML='<div class="jis-empty">壁が配置されていないため図面を生成できません。2D画面で間取りを作成してください。</div>';
    document.getElementById('jis-sheet-list').innerHTML='';
    return;
  }
  if(!JIS_UI.sheet) JIS_UI.sheet=sheets[0];
  renderJisSheetList(sheets);
  jisRerender();
}
function closeJisDrawingDialog(){ document.getElementById('jis-drawing-overlay').style.display='none'; }
function jisSelectSheet(kind,key){
  JIS_UI.sheet={kind:kind,key:key};
  renderJisSheetList(JISDRAW.availableSheets());
  jisRerender();
}
function renderJisSheetList(sheets){ /* リストのHTMLを組み立て、選択中に .active を付ける */ }
function jisCurrentOpts(){
  return {scale:document.getElementById('jis-scale').value, paper:document.getElementById('jis-paper').value};
}
function jisCurrentSvg(){
  var s=JIS_UI.sheet;
  return s.kind==='plan' ? JISDRAW.buildFloorPlanSvg(s.key,jisCurrentOpts())
                         : JISDRAW.buildElevationSvg(s.key,jisCurrentOpts());
}
function jisRerender(){
  var host=document.getElementById('jis-preview');
  host.innerHTML='<div class="jis-paper-sheet">'+jisCurrentSvg()+'</div>';
}
function jisPrint(){ /* Task 7 */ }
function jisDownloadSvg(){ /* Task 7 */ }
function jisDownloadPng(){ /* Task 7 */ }
```

`renderJisSheetList` は平面図/立面図の見出し付きボタンリストを `#jis-sheet-list` に描画する(タップでjisSelectSheet)。

- [ ] **Step 4: 構文チェック**

Run: `node tools/check-html-js.cjs`
Expected: importmap誤検知のみ。他のエラーなし

- [ ] **Step 5: ブラウザ確認**

ローカルサーバー(`python3 tools/dev_server.py` 等)+Playwrightで: JIS図面ボタン→モーダルが開く→図面リストに階と4立面が並ぶ→プレースホルダ表示→✕で閉じる。スクリーンショット保存

- [ ] **Step 6: Commit**

```bash
git add index.html && git commit -m "Add JIS drawing dialog skeleton and toolbar button"
```

---

### Task 2: 平面図SVG — 壁と開口記号

**Files:**
- Modify: `index.html` JISDRAWモジュール内

**Interfaces:**
- Consumes: `DATA.walls`, `getOpeningWallInfo(it)`, `isOpeningItemType(type)`, 既存建具描画ロジック(`:6795-6850`)
- Produces: `buildFloorPlanSvg(floor,opts)` が実データの壁+開口を描くSVGを返す。内部ヘルパー `planBounds(floor)` → `{minX,minY,maxX,maxY}`(mm、余白含む)、`svgOpen(bounds,opts)`/`svgClose(titleInfo)`、`wallsToSvg(floor,LW)`、`openingsToSvg(floor,LW)`

- [ ] **Step 1: 図枠・座標系ヘルパーを実装**

SVGは `viewBox="minX minY width height"`(実寸mm)。用紙(A3横=420×297mm/A4横=297×210mm)と縮尺から `paperW*scale × paperH*scale` の窓を建物中心に取る。`scale:'auto'` は建物範囲+寸法余白(四周1800mm)が収まる最小の縮尺(50→100→200の順で判定、200でも収まらなければ200のまま)。

- [ ] **Step 2: 壁描画を実装**

`drawWall2d`(`:5664`)と同じ4点ポリゴン計算(壁芯±thick/2)で `<polygon fill="#000" stroke="#000" stroke-width="LW.thin">`。壁は黒塗り断面(JIS)。同一階のみ。

- [ ] **Step 3: 開口記号を実装**

各開口itemについて `getOpeningWallInfo(it)` で壁・壁上の位置・幅を取得し、壁方向の単位ベクトルでローカル座標を組んで描く。まず壁の黒塗りを開口幅ぶん白抜き(`<rect fill="#fff">` を壁と同角度で重ねる)し、その上に記号(すべて `stroke="#000"`):
- 引違い窓(`windowKind` 未指定 or 'sliding'): 壁厚内に平行2本線+中央で互い違いにオフセットした2枚の建具線(既存 `:6835` の簡略化を踏襲)
- FIX窓('fix'): 平行2本線+中央1本線
- 掃き出し窓(`window-door`): 引違いと同じ記号(床までなので平面表現は同一)
- 開き戸(`door-swing`系): 吊元から開口幅の1/4円弧(`<path A>`)+扉線1本、線幅 `LW.mid`
- 引戸・折戸・開口(`door-slide`/`door-fold`/`door-opening`): 既存2D表現(`:6795-6850`)を読み、レール線・破線開口をSVGへ移植
- 玄関ドア(`door-front`): 開き戸と同記号

- [ ] **Step 4: 構文チェック+ブラウザ確認**

保存済みプラン(なければ壁・窓・ドアを配置して作成)で平面図を表示し、壁黒塗り・窓の白抜き+記号・ドア円弧を目視確認。スクリーンショット保存

- [ ] **Step 5: Commit**

```bash
git add index.html && git commit -m "Render walls and JIS opening symbols in floor plan SVG"
```

---

### Task 3: 平面図SVG — 階段・設備記号・部屋名/畳数

**Files:**
- Modify: `index.html` JISDRAWモジュール内

**Interfaces:**
- Consumes: `DATA.items`(type: stair/stair-corner/kitchen/bath/toilet/sink)、`DATA.rooms`(`r.n`)、畳数換算の既存例 `:5627`
- Produces: `stairsToSvg(floor,LW)`, `fixturesToSvg(floor,LW)`, `roomLabelsToSvg(floor,LW)`

- [ ] **Step 1: 階段記号**

`stair`: 外形矩形+段板線(`stairStepCount`(`:11158`)で段数、等間隔の横線)+中央に登り方向の細線矢印+「UP」or「DN」テキスト(その階に上階があればUP)。`stair-corner`: 矩形+対角の回り段線。`it.rot` を `transform="rotate(...)"` で反映。線幅 `LW.mid`、文字 `LW.text`

- [ ] **Step 2: 設備記号(簡略線画)**

対象typeのみ、item外形内に:
- `kitchen`: 外形+シンク矩形(丸角)+コンロ丸4つ
- `bath`: 外形+内側offset矩形(浴槽)+丸(排水)
- `toilet`: 便器の楕円+タンク矩形
- `sink`: 矩形+楕円ボウル
それ以外のitem(ソファ等の可動家具・車・植栽)は**描かない**

- [ ] **Step 3: 部屋名+畳数**

各roomの中心に `r.n||'部屋'` と `(w*d*1e-6/1.62).toFixed(1)+'帖'` を2行で(`:5627` と同じ換算)。`text-anchor="middle"`、フォント `font-family="'Noto Sans JP',sans-serif"`

- [ ] **Step 4: 構文チェック+ブラウザ確認+Commit**

```bash
git add index.html && git commit -m "Add stairs, fixture symbols and room labels to floor plan"
```

---

### Task 4: 平面図SVG — 寸法線・方位記号・表題欄

**Files:**
- Modify: `index.html` JISDRAWモジュール内

**Interfaces:**
- Produces: `dimensionsToSvg(floor,LW)`, `northMarkSvg(bounds,LW)`, `titleBlockSvg(label,scale,bounds,LW)`。`buildFloorPlanSvg` はこれらを合成して完成

- [ ] **Step 1: 寸法線(下辺・左辺の2段)**

軸平行壁の芯座標(x1==x2の壁のx、y1==y2の壁のy)をユニーク化し:
- 外段: 全体寸法(min→max)1本
- 内段: 隣接芯間の連続寸法
表現: 細線+端部は45°斜線(JIS建築流)、寸法値はmm整数を線上中央に。図の下側(y=maxY+700/+1400)と左側(x=minX-700/-1400、文字は90°回転)に配置

- [ ] **Step 2: 方位記号**

右上に北矢印(円+上向き矢印+「N」)。2D画面の上=北

- [ ] **Step 3: 表題欄**

右下に枠(140×20mm紙寸相当×縮尺)。「図面名 | 縮尺 1:100 | 日付(YYYY-MM-DD) | WebCAD Planner」

- [ ] **Step 4: 構文チェック+ブラウザ確認(A3/A4・3縮尺の切替も)+Commit**

```bash
git add index.html && git commit -m "Add dimensions, north mark and title block to floor plan"
```

---

### Task 5: 立面図SVG — 壁シルエット+開口

**Files:**
- Modify: `index.html` JISDRAWモジュール内

**Interfaces:**
- Consumes: `floorBaseY(f)`, `wallTopYM(w)`(`:9541`付近の実名を確認して使用)、`windowHeightMm`, `openingSillMm`, `getOpeningWallInfo`
- Produces: `buildElevationSvg(dir,opts)` 完成形の前段(壁+開口+GL)。内部: 方位定義表 `ELEV_AXES`、`elevWallRects(dir)`, `elevSkyline(rects)`, `elevOpenings(dir)`

- [ ] **Step 1: 方位軸の定義**

```js
// u=画面右方向の(x,y)係数, dp=視点に近いほど大きくなる奥行き係数
var ELEV_AXES={
  s:{u:[ 1,0], dp:[0, 1], label:'南立面図'},
  n:{u:[-1,0], dp:[0,-1], label:'北立面図'},
  e:{u:[0,-1], dp:[ 1,0], label:'東立面図'},
  w:{u:[0, 1], dp:[-1,0], label:'西立面図'}
};
```
座標系(x=東, y=南)による: 南立面は右=東、北立面は右=西、東立面は右=北、西立面は右=南。**実装後にブラウザで平面図と見比べ、左右が実世界と一致するか必ず確認する**(逆なら u を反転)

- [ ] **Step 2: 壁矩形の投影とスカイライン**

全階の壁について `u1,u2 = 両端点のu射影`, `top = floorBaseY(f)+壁高`, `base = floorBaseY(f)`(1階はGL=0から)。イベント座標で区間分割し各区間のmax topを取り、隣接同高を結合して外形ポリライン(スカイライン)を作る。塗りなし・`LW.thick` の外形線で描く。GL線は太線で全幅+左右延長

- [ ] **Step 3: 開口の描画(その面に面した壁のみ)**

各区間の「最前面深度」= その区間で最大の `max(dp射影(両端点))` を記録。開口は親壁の深度が最前面深度−(壁厚+150mm)以上のときのみ描く。窓: `base+sill` から `sill+高さ` の矩形(`LW.mid`)+引違いは縦中桟1本、FIXは対角細線、掃き出しは床から。ドア: 床から高さ2000mmの矩形+ノブ点

- [ ] **Step 4: 構文チェック+ブラウザ確認(4方位すべて、平面図と方位の整合を目視)+Commit**

```bash
git add index.html && git commit -m "Render wall silhouettes and openings in elevation SVG"
```

---

### Task 6: 立面図SVG — 屋根・基礎・高さ寸法

**Files:**
- Modify: `index.html` JISDRAWモジュール内(着手前に `:11179` 付近の3D屋根生成コードを読むこと)

**Interfaces:**
- Consumes: roof item(`x,y,w,d,rot,roofType,pitch`)、3D屋根生成 `:11179`〜(各typeの棟方向・軒の出・高さ計算の実装を確認し同じ値を使う)
- Produces: `roofProfileToSvg(dir,LW)`, `foundationToSvg(dir,LW)`, `heightDimsToSvg(dir,LW)`

- [ ] **Step 1: 3D屋根コードの読解**

`:11179` からの `roofType` 分岐を読み、各typeの (a)棟の方向(footprintのw軸かd軸か、gable-yは90°) (b)軒の出 (c)棟高さ = `(スパン/2)*tan(pitch)` の各実値を確認してメモ(コメントとしてJISDRAW内に残す)

- [ ] **Step 2: 屋根プロファイル生成**

roof itemごとに、方位 `dir` の u軸へfootprintを投影し:
- `flat`: 薄い矩形(パラペット)
- `gable`/`gable-y`: 棟が視線と平行 → 三角形(妻面)。棟が視線と直交 → 軒から棟までの台形上辺(スロープ2辺+棟水平線)
- `mono`(片流れ): 視線と平行 → 直角三角形、直交 → 高い側から低い側への矩形
- `hip`系: 妻側=台形、平側=台形(hip-ridgeは棟線の長さを反映)
ベース高さは `floorBaseY(roof.floor)`。壁スカイラインの上に重ね描きし、屋根外形は `LW.thick`

- [ ] **Step 3: 基礎と高さ寸法**

基礎: GLから `foundationHeightM()` の帯を建物幅で描き、中線。高さ寸法: 図右側にGL・軒高(壁最上端)・最高高さ(屋根頂点)の3レベルを引出線+寸法値(mm)で

- [ ] **Step 4: 構文チェック+ブラウザ確認+Commit**

切妻・寄棟・片流れ・陸屋根をそれぞれ置いたテストプランで4方位を確認:

```bash
git add index.html && git commit -m "Add roof profiles, foundation and height dimensions to elevations"
```

---

### Task 7: 印刷/PDF・SVG/PNGダウンロード

**Files:**
- Modify: `index.html` の `jisPrint`/`jisDownloadSvg`/`jisDownloadPng`

**Interfaces:**
- Consumes: `jisCurrentSvg()`, `JIS_UI.sheet`, 既存 `downloadTextFile`(`:17045`付近で使用例)

- [ ] **Step 1: SVGダウンロード**

`jisCurrentSvg()` を `image/svg+xml` Blobで保存。ファイル名 `jis-{plan1f|elev-e等}-YYYYMMDD.svg`。既存のBlobダウンロードパターン(`makeAiDownloadObjectUrl` 周辺)を踏襲し、iPad Safariでも動く `<a download>` 方式

- [ ] **Step 2: PNGダウンロード**

SVG文字列→`new Blob`→`URL.createObjectURL`→`Image.onload`→canvas(長辺3000px、白背景で`fillRect`後に`drawImage`)→`canvas.toBlob('image/png')`→保存。日本語テキストがSVG内にあるためdata URLではなくobject URL経由で読み込む

- [ ] **Step 3: 印刷/PDF**

hidden iframeに `<style>@page{size:A3 landscape;margin:8mm} svg{width:100%;height:auto}</style>` +現在のSVG(用紙選択に応じてsizeを切替)を書き、`onload` 後 `iframe.contentWindow.print()`。印刷後にiframeを除去

- [ ] **Step 4: 構文チェック+ブラウザ確認(SVG/PNGの中身、印刷プレビュー)+Commit**

```bash
git add index.html && git commit -m "Add print and SVG/PNG export for JIS drawings"
```

---

### Task 8: 外観3D 立面方向カメラスナップボタン

**Files:**
- Modify: `index.html`(3Dビュー上のオーバーレイUI群の近く+`fitCameraToScene` の下)

**Interfaces:**
- Consumes: `camExt`, `orbit`, `fitCameraToScene()`(`:7734`)のバウンディング計算、`ST.view`
- Produces: `snapCameraToElevation(dir)`(dir: 'n'|'s'|'e'|'w')

- [ ] **Step 1: スナップ関数**

```js
// 立面図出力方向からの見え方を即確認するためのカメラショートカット。
// 正投影にはせず(パース感はピンチで調整する運用)、以後の操作は通常のOrbitControls。
function snapCameraToElevation(dir){
  if(!sc3||!camExt||!orbit) return;
  var box=new THREE.Box3();
  sc3.traverse(function(obj){ if(obj.isMesh&&obj.userData.b) box.expandByObject(obj); });
  if(box.isEmpty()) return;
  var center=box.getCenter(new THREE.Vector3());
  var size=box.getSize(new THREE.Vector3());
  var span=Math.max(size.x,size.z,4);
  var fov=camExt.fov*Math.PI/180;
  var dist=(span/2)/Math.tan(fov/2)*1.25;
  // 3D座標: x=東, z=南(2Dのy), y=高さ
  var v={e:[1,0],w:[-1,0],s:[0,1],n:[0,-1]}[dir];
  camExt.position.set(center.x+v[0]*dist, center.y, center.z+v[1]*dist);
  orbit.target.copy(center);
  orbit.update();
  invalidate3D();
}
```

- [ ] **Step 2: オーバーレイボタン**

外観3D表示中のみ見えるボタン列(既存の3Dオーバーレイ要素と同じ表示切替に乗せる)。「東」「西」「南」「北」の4ボタン、`onclick="snapCameraToElevation('e')"` 等。位置は画面右下(既存FABと重ならない位置)

- [ ] **Step 3: 構文チェック+ブラウザ確認(4方位スナップ→スワイプで自由移動できること)+Commit**

```bash
git add index.html && git commit -m "Add elevation-direction camera snap buttons to exterior 3D view"
```

---

### Task 9: 総合検証と仕上げ

- [ ] **Step 1: 総合ブラウザ検証**

2階建て+階段+各種窓+寄棟屋根のプランで: 全平面図・4立面・縮尺3種×用紙2種・印刷プレビュー・SVG/PNG保存・3Dスナップボタンを一通り確認。undo/redo・保存・共同編集など既存機能が壊れていないことをスモーク確認

- [ ] **Step 2: iPad Safari確認(可能なら)**

モーダル表示・PNG保存・スナップボタン。3D互換の既知の教訓(2D正常+3D全滅はエンジンロード失敗)に注意

- [ ] **Step 3: 最終コミット+ブランチ完了処理**

superpowers:finishing-a-development-branch スキルに従いマージ/PR判断をユーザーに確認
