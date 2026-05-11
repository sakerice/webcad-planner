# WebCAD 品質強化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2D間取り図の建築図面品質化（JIS記号・畳数表示・ハッチング）と3D描画の高品質化（HDR環境マップ・PBRテクスチャ・正確な家具GLB）を日本住宅規格準拠で実装する

**Architecture:** index.html の Canvas2D 描画関数と Three.js 初期化コードを直接修正する。Python スクリプト（gen_textures.py / gen_models.py）でアセットを事前生成し assets/ に配置。外部 HDR ファイルで環境マップを実現する。

**Tech Stack:** HTML/Canvas2D, Three.js r128, Python 3 + Pillow + pygltflib, GLB/GLTF 2.0

---

## ファイルマップ

| ファイル | 操作 | 担当 |
|---------|------|------|
| `index.html` | 修正 | 全タスク（2D/3D 両方） |
| `scripts/gen_textures.py` | 新規作成 | Task 6 |
| `scripts/gen_models.py` | 新規作成 | Task 7 |
| `assets/env/outdoor.hdr` | ダウンロード | Task 9 |
| `assets/textures/*.jpg` | gen_textures.py が生成 | Task 6 |
| `assets/models/*.glb` | gen_models.py が生成 | Task 7 |

---

## Task 1: 家具・建具のデフォルトサイズを日本住宅規格値に修正

**Files:**
- Modify: `index.html:221-233` (ISIZES 定数)

---

- [ ] **Step 1: ISIZES を規格値に書き換える**

`index.html` の `var ISIZES = {` ブロック（現在行 221〜233）を以下に置き換える:

```javascript
var ISIZES = {
  bath:{w:1600,d:1600}, toilet:{w:380,d:680}, sink:{w:750,d:560},
  kitchen:{w:2550,d:650}, fridge:{w:650,d:700}, washer:{w:640,d:640},
  sofa:{w:2100,d:850}, loveseat_2p:{w:1500,d:850}, low_table:{w:900,d:500},
  'dining-table':{w:1200,d:800}, dining_6:{w:1600,d:900}, round_table_4:{w:1000,d:1000},
  'bed-d':{w:1400,d:1950}, 'bed-s':{w:970,d:1950}, semi_double_bed:{w:1200,d:1950},
  futon_set:{w:1000,d:2100}, desk:{w:1200,d:600}, tv:{w:1200,d:80},
  closet:{w:1800,d:600}, shoe_cabinet:{w:1200,d:400}, stair:{w:910,d:1820},
  balcony:{w:1820,d:910}, tree:{w:1500,d:1500},
  'door-swing':{w:780,d:780}, 'door-slide':{w:1650,d:150},
  window:{w:1650,d:150}, 'door-front':{w:900,d:200},
  'site-rect':{w:10000,d:8000}
};
```

主な変更点: `toilet` 380×680, `bed-d` 1400×1950, `bed-s` 970×1950, `sofa` 2100×850, `dining-table` 1200×800, `tv` 1200×80, `door-front` 900×200, `sink` 750×560, `fridge` 650×700

- [ ] **Step 2: ブラウザで確認**

`index.html` をブラウザで開き、ベッド(D) を配置してサイズが **1400mm × 1950mm** になっていることをプロパティパネルで確認する。

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat: update item default sizes to Japanese housing standards"
```

---

## Task 2: 2D 配色・壁色を建築図面スタイルに変更

**Files:**
- Modify: `index.html` — `draw2d`, `drawWall2d`, `drawGrid` 関数

---

- [ ] **Step 1: キャンバス背景色を変更**

`draw2d` 関数内（現在: `ctx.fillStyle='#e8e4dc';` の行）:

```javascript
// 変更前
ctx.fillStyle='#e8e4dc'; ctx.fillRect(0,0,W,H);

// 変更後
ctx.fillStyle='#f5f3ee'; ctx.fillRect(0,0,W,H);
```

- [ ] **Step 2: 外壁の塗り色を変更**

`drawWall2d` 関数内の `isOuter` 分岐（現在 `ctx.fillStyle='#3a3a40'` の部分）を修正する。また判定閾値を 120mm に変更する:

```javascript
// 変更前
var isOuter=w.thick>=130, sel=ST.selected===w;

// 変更後
var isOuter=w.thick>=120, sel=ST.selected===w;
```

```javascript
// 変更前（isOuter の else if ブロック）
  } else if(isOuter){
    ctx.fillStyle='#3a3a40'; ctx.fill();
    ctx.strokeStyle='#111'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(a.cx+nx*t*0.6, a.cy+ny*t*0.6); ctx.lineTo(b.cx+nx*t*0.6, b.cy+ny*t*0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.cx-nx*t*0.6, a.cy-ny*t*0.6); ctx.lineTo(b.cx-nx*t*0.6, b.cy-ny*t*0.6); ctx.stroke();
  } else {
    ctx.fillStyle='#909098'; ctx.fill();
    ctx.strokeStyle='#666'; ctx.lineWidth=1; ctx.stroke();
  }

// 変更後
  } else if(isOuter){
    ctx.fillStyle='#e8e4dc'; ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=2.0; ctx.stroke();
  } else {
    ctx.fillStyle='#d0cfc8'; ctx.fill();
    ctx.strokeStyle='#888'; ctx.lineWidth=1.2; ctx.stroke();
  }
```

- [ ] **Step 3: グリッド色を薄く調整**

`drawGrid` 関数:

```javascript
// 変更前
ctx.strokeStyle='rgba(0,0,0,0.07)'; ctx.lineWidth=1;
// ...
ctx.strokeStyle='rgba(0,0,0,0.03)';

// 変更後
ctx.strokeStyle='rgba(0,0,0,0.10)'; ctx.lineWidth=0.8;
// ...
ctx.strokeStyle='rgba(0,0,0,0.04)';
```

- [ ] **Step 4: ブラウザで確認**

壁が薄いベージュ系（外壁 `#e8e4dc`、内壁 `#d0cfc8`）で表示されることを確認。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat: update 2D color scheme to architectural style"
```

---

## Task 3: 外壁ハッチング（2D-1）

**Files:**
- Modify: `index.html` — `drawWall2d` 関数の直前に `drawHatch` ヘルパーを追加

---

- [ ] **Step 1: `drawHatch` 関数を追加**

`drawWall2d` 関数（`function drawWall2d(w){` の行）の**直前**に以下を挿入:

```javascript
function drawHatch(ctx, path4pts, pitch) {
  // path4pts = [{cx,cy}, {cx,cy}, {cx,cy}, {cx,cy}] 壁の4頂点
  // pitch: ハッチング間隔(px)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(path4pts[0].cx, path4pts[0].cy);
  ctx.lineTo(path4pts[1].cx, path4pts[1].cy);
  ctx.lineTo(path4pts[2].cx, path4pts[2].cy);
  ctx.lineTo(path4pts[3].cx, path4pts[3].cy);
  ctx.closePath();
  ctx.clip();
  // Bounding box
  var xs = path4pts.map(function(p){return p.cx;}), ys = path4pts.map(function(p){return p.cy;});
  var x0=Math.min.apply(null,xs)-pitch, x1=Math.max.apply(null,xs)+pitch;
  var y0=Math.min.apply(null,ys)-pitch, y1=Math.max.apply(null,ys)+pitch;
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(100,90,80,0.35)';
  ctx.lineWidth = 0.6;
  for(var d=x0-y1; d<x1-y0+pitch*2; d+=pitch) {
    ctx.moveTo(x0, y0 + (x0 - x0 + d));  // 45° lines
    ctx.moveTo(d < 0 ? x0 - d : x0, d < 0 ? y0 : y0 + d);
    ctx.lineTo(d + (y1-y0) < x1 ? x0 + d + (y1-y0) : x1, d + (y1-y0) < x1 ? y1 : y0 + (x1 - x0 - d));
  }
  // Simpler approach: draw diagonal lines across bbox
  ctx.beginPath();
  var span = (x1-x0) + (y1-y0);
  for(var s = -span; s < span; s += pitch) {
    ctx.moveTo(x0, y0 + s);
    ctx.lineTo(x0 + span, y0 + s + span);
  }
  ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 2: `drawWall2d` の外壁分岐でハッチングを呼ぶ**

`drawWall2d` の外壁 (`isOuter`) 分岐を以下に変更:

```javascript
  } else if(isOuter){
    ctx.fillStyle='#e8e4dc'; ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=2.0; ctx.stroke();
    // ハッチング
    var pts = [
      {cx: a.cx+nx*t, cy: a.cy+ny*t},
      {cx: b.cx+nx*t, cy: b.cy+ny*t},
      {cx: b.cx-nx*t, cy: b.cy-ny*t},
      {cx: a.cx-nx*t, cy: a.cy-ny*t}
    ];
    drawHatch(ctx, pts, Math.max(4, t * 0.7));
  }
```

- [ ] **Step 3: ブラウザで確認**

外壁（120mm 以上）に斜線ハッチングが表示されることを確認。内壁にはハッチングが出ないことを確認。

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat: add JIS-style wall section hatching for exterior walls"
```

---

## Task 4: 部屋の畳数・平米自動表示（2D-3）

**Files:**
- Modify: `index.html` — `drawRoomLbls` 関数

---

- [ ] **Step 1: `drawRoomLbls` を自動面積計算に変更**

現在の `drawRoomLbls` 関数全体（`function drawRoomLbls(){` から `}` まで）を以下に置き換える:

```javascript
function drawRoomLbls(){
  var fr=DATA.rooms.filter(function(r){return r.floor===ST.floor;});
  fr.forEach(function(l){
    var p=w2c(l.x+l.w/2,l.y+l.d/2);
    var name=l.n||'部屋';
    // 自動面積計算（関東間: 1畳=1.62㎡）
    var sqm = (l.w * l.d) / 1000000;
    var tatami = sqm / 1.62;
    var areaStr = tatami.toFixed(1) + '畳 / ' + sqm.toFixed(2) + '㎡';
    var showArea = ST.zoom >= 0.4;
    var szN=Math.max(10,ST.zoom*0.8), szA=Math.max(8,ST.zoom*0.55);
    ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
    var tw=Math.max(ctx.measureText(name).width, showArea?ctx.measureText(areaStr).width:0)+18;
    var th=showArea?szN+szA+14:szN+12;
    ctx.save();
    ctx.translate(p.cx,p.cy);
    if(ST.selected===l) {
      ctx.shadowBlur=10; ctx.shadowColor='rgba(0,120,255,0.5)';
      ctx.strokeStyle='#0078ff'; ctx.lineWidth=2;
    }
    ctx.fillStyle='rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.roundRect(-tw/2,-th/2,tw,th,6); ctx.fill();
    if(ST.selected===l) ctx.stroke();
    ctx.restore();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
    ctx.fillStyle='#222';
    ctx.fillText(name, p.cx, showArea ? p.cy-szA/2-2 : p.cy);
    if(showArea){
      ctx.font=szA+'px "Noto Sans JP",sans-serif';
      ctx.fillStyle='#666';
      ctx.fillText(areaStr, p.cx, p.cy+szN/2+3);
    }
  });
}
```

- [ ] **Step 2: ブラウザで確認**

部屋を配置した状態で「LDK\n14.0畳 / 22.68㎡」のように自動表示されることを確認。ズームアウト（zoom < 0.4）で畳数行が非表示になることを確認。

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat: add auto tatami/sqm display in 2D room labels"
```

---

## Task 5: JIS A 0150 建具記号の改善（2D-2）

**Files:**
- Modify: `index.html` — `drawItem2d` 内の `door-slide` / `window` 描画ブロック

---

- [ ] **Step 1: `door-slide`（引き戸）を JIS 記号に変更**

`drawItem2d` 内の `door-slide` ブロック（現在 `ctx.strokeRect(-hw,-hd*0.3,...` の部分）を置き換える:

```javascript
    } else if(it.type === 'door-slide') {
      // JIS 引き戸: 2本平行レール線 + 戸の矩形
      ctx.strokeStyle='#333'; ctx.lineWidth=1.2;
      // レール線（壁の開口を示す上下2本線）
      ctx.beginPath();
      ctx.moveTo(-hw, -hd); ctx.lineTo(hw, -hd);
      ctx.moveTo(-hw,  hd); ctx.lineTo(hw,  hd);
      ctx.stroke();
      // 戸の矩形（左側に寄せる）
      ctx.strokeRect(-hw, -hd*0.85, it.w*sc*0.6, hd*1.7);
      // 戸の引手
      ctx.beginPath();
      ctx.moveTo(-hw + it.w*sc*0.55, -hd*0.3);
      ctx.lineTo(-hw + it.w*sc*0.55,  hd*0.3);
      ctx.lineWidth=2; ctx.stroke();
```

- [ ] **Step 2: `window`（窓）を JIS 3 本線記号に変更**

`drawItem2d` 内の `window` ブロックを置き換える:

```javascript
    } else if(it.type === 'window') {
      // JIS 窓記号: 壁厚内に3本平行線（框×2 + ガラス線）
      ctx.strokeStyle='#555'; ctx.lineWidth=1.0;
      // 外枠
      ctx.strokeRect(-hw, -hd, it.w*sc, it.d*sc);
      // 中央ガラス線
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0);
      ctx.strokeStyle='#3080e8'; ctx.lineWidth=1.5; ctx.stroke();
      // 框線 (上下 1/3 位置)
      ctx.beginPath();
      ctx.moveTo(-hw, -hd*0.45); ctx.lineTo(hw, -hd*0.45);
      ctx.moveTo(-hw,  hd*0.45); ctx.lineTo(hw,  hd*0.45);
      ctx.strokeStyle='#777'; ctx.lineWidth=0.8; ctx.stroke();
```

- [ ] **Step 3: `door-swing` の弧の方向を改善**

現在の door-swing は左下コーナーを軸に描画されている。JIS 記号に合わせ、壁の開口幅いっぱいに弧が収まるよう修正:

```javascript
    } else if(it.type === 'door-swing' || it.type === 'door-front') {
      ctx.strokeStyle='#333'; ctx.lineWidth=1.8;
      // 扉軸（左端）
      ctx.beginPath(); ctx.moveTo(-hw, -hd); ctx.lineTo(-hw, hd); ctx.stroke();
      // 扉葉（開口幅に合わせた長さ）
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(-hw, hd); ctx.lineTo(hw, hd); ctx.stroke();
      // 弧（扉の軌跡: 左下から右下へ）
      ctx.lineWidth=0.8; ctx.setLineDash([3,3]);
      ctx.beginPath();
      ctx.arc(-hw, hd, it.w*sc, -Math.PI/2, 0);
      ctx.strokeStyle='#555'; ctx.stroke();
      ctx.setLineDash([]);
```

- [ ] **Step 4: ブラウザで確認**

引き戸がレール2本線＋戸矩形で表示、窓が3本平行線で表示されることを確認。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat: implement JIS A 0150 door and window symbols in 2D"
```

---

## Task 6: PBR テクスチャ生成スクリプト作成・実行

**Files:**
- Create: `scripts/gen_textures.py`
- Generate: `assets/textures/*.jpg` (11ファイル)

---

- [ ] **Step 1: `scripts/gen_textures.py` を作成**

```python
#!/usr/bin/env python3
"""Generate PBR textures for WebCAD floor/wall/roof surfaces."""
import os, math
import numpy as np
try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("pip install Pillow"); exit(1)

OUT = "assets/textures"
os.makedirs(OUT, exist_ok=True)
SZ = 512

def save(img, name):
    img.save(os.path.join(OUT, name), quality=92)
    print(f"  {name}")

def wood_floor_diffuse():
    img = Image.new("RGB", (SZ, SZ), (200, 158, 105))
    draw = ImageDraw.Draw(img)
    pw = SZ // 4
    plank_colors = [(195,152,100),(210,168,115),(192,149,97),(205,161,108)]
    for i in range(4):
        x = i * pw
        draw.rectangle([x, 0, x+pw-2, SZ], fill=plank_colors[i])
        for y in range(0, SZ, 10):
            c = plank_colors[i]
            dark = tuple(max(0, v-25) for v in c)
            draw.line([(x+3, y), (x+pw-5, y+4)], fill=dark, width=1)
    return img.filter(ImageFilter.GaussianBlur(0.7))

def wood_floor_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    pw = SZ // 4
    for i in range(4):
        x = i * pw
        draw.line([(x, 0), (x, SZ)], fill=(90, 128, 200), width=2)
        for y in range(0, SZ, 14):
            draw.line([(x+4, y), (x+pw-4, y+3)], fill=(148, 128, 255), width=1)
    return img

def wood_floor_roughness():
    arr = np.random.normal(185, 18, (SZ, SZ, 3)).clip(155, 210).astype(np.uint8)
    return Image.fromarray(arr)

def tile_floor_diffuse():
    img = Image.new("RGB", (SZ, SZ), (242, 240, 236))
    draw = ImageDraw.Draw(img)
    tp = SZ // 4
    for x in range(0, SZ, tp):
        draw.line([(x, 0),(x, SZ)], fill=(195,193,190), width=3)
    for y in range(0, SZ, tp):
        draw.line([(0, y),(SZ, y)], fill=(195,193,190), width=3)
    return img

def tile_floor_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    tp = SZ // 4
    for x in range(0, SZ, tp):
        draw.line([(x, 0),(x, SZ)], fill=(80, 80, 200), width=4)
    for y in range(0, SZ, tp):
        draw.line([(0, y),(SZ, y)], fill=(80, 80, 200), width=4)
    return img

def tile_floor_roughness():
    arr = np.random.normal(75, 8, (SZ, SZ, 3)).clip(55, 95).astype(np.uint8)
    return Image.fromarray(arr)

def wall_siding_diffuse():
    img = Image.new("RGB", (SZ, SZ), (82, 65, 50))
    draw = ImageDraw.Draw(img)
    ph = SZ // 14
    for i in range(15):
        y = i * ph
        shade = 78 + (i % 2) * 14
        draw.rectangle([0, y, SZ, y+ph-3], fill=(shade, shade-18, shade-30))
        draw.line([(0, y+ph-2),(SZ, y+ph-2)], fill=(45,35,25), width=2)
        draw.line([(0, y),(SZ, y)], fill=(shade+18, shade, shade-10), width=1)
    return img

def wall_siding_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    ph = SZ // 14
    for i in range(15):
        y = i * ph
        draw.line([(0, y),(SZ, y)], fill=(165, 128, 255), width=2)
        draw.line([(0, y+ph-3),(SZ, y+ph-3)], fill=(85, 128, 200), width=2)
    return img

def wall_plaster_diffuse():
    arr = np.random.normal(238, 3, (SZ, SZ, 3)).astype(np.float32)
    arr[:,:,0] = arr[:,:,0].clip(231, 246)
    arr[:,:,1] = (arr[:,:,1] - 2).clip(228, 244)
    arr[:,:,2] = (arr[:,:,2] - 5).clip(225, 241)
    img = Image.fromarray(arr.astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(0.4))

def roof_tile_diffuse():
    img = Image.new("RGB", (SZ, SZ), (40, 40, 45))
    draw = ImageDraw.Draw(img)
    tw, th = SZ//7, SZ//5
    for row in range(6):
        for col in range(8):
            ox = col*tw + (row % 2)*(tw//2) - tw//4
            oy = row*th
            shade = 38 + (row*col) % 10
            draw.ellipse([ox, oy, ox+tw, oy+th], fill=(shade, shade, shade+5),
                         outline=(58, 58, 65), width=1)
    return img

def roof_tile_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    tw, th = SZ//7, SZ//5
    for row in range(6):
        for col in range(8):
            ox = col*tw + (row % 2)*(tw//2) - tw//4
            oy = row*th
            for dy in range(th):
                t = dy / th
                r = int(115 + 40*(1 - abs(2*t - 1)))
                draw.line([(ox, oy+dy),(ox+tw, oy+dy)], fill=(r, 128, 210), width=1)
    return img

if __name__ == "__main__":
    items = [
        ("floor_wood_diffuse.jpg",   wood_floor_diffuse()),
        ("floor_wood_normal.jpg",    wood_floor_normal()),
        ("floor_wood_roughness.jpg", wood_floor_roughness()),
        ("floor_tile_diffuse.jpg",   tile_floor_diffuse()),
        ("floor_tile_normal.jpg",    tile_floor_normal()),
        ("floor_tile_roughness.jpg", tile_floor_roughness()),
        ("wall_siding_diffuse.jpg",  wall_siding_diffuse()),
        ("wall_siding_normal.jpg",   wall_siding_normal()),
        ("wall_plaster_diffuse.jpg", wall_plaster_diffuse()),
        ("roof_tile_diffuse.jpg",    roof_tile_diffuse()),
        ("roof_tile_normal.jpg",     roof_tile_normal()),
    ]
    print(f"Generating {len(items)} textures → {OUT}/")
    for name, img in items:
        save(img, name)
    print("Done.")
```

- [ ] **Step 2: スクリプトを実行**

```bash
cd /Users/nariiwa/Documents/GitHub/webcad-planner
python3 scripts/gen_textures.py
```

期待出力:
```
Generating 11 textures → assets/textures/
  floor_wood_diffuse.jpg
  floor_wood_normal.jpg
  ... (計11ファイル)
Done.
```

- [ ] **Step 3: 生成ファイルを確認**

```bash
ls -lh assets/textures/
```

11ファイルが全て存在し、各ファイルが 20KB〜150KB であることを確認。

- [ ] **Step 4: コミット**

```bash
git add scripts/gen_textures.py assets/textures/
git commit -m "feat: add PBR texture generation script and generated textures"
```

---

## Task 7: 家具 GLB モデル生成スクリプト作成・実行

**Files:**
- Create: `scripts/gen_models.py`
- Generate: `assets/models/*.glb` (12ファイル)

---

- [ ] **Step 1: `scripts/gen_models.py` を作成**

```python
#!/usr/bin/env python3
"""Generate GLB furniture models at Japanese housing standard dimensions."""
import os
import numpy as np
try:
    import pygltflib as gl
except ImportError:
    print("pip install pygltflib"); exit(1)

OUT = "assets/models"
os.makedirs(OUT, exist_ok=True)

# (name, W_m, D_m, H_m, [R,G,B] 0-1)
FURNITURE = [
    ("sofa",         2.100, 0.850, 0.750, [0.85, 0.78, 0.65]),
    ("bed_double",   1.400, 1.950, 0.550, [0.95, 0.92, 0.88]),
    ("bed_single",   0.970, 1.950, 0.550, [0.95, 0.92, 0.88]),
    ("kitchen",      2.550, 0.650, 0.850, [0.80, 0.75, 0.65]),
    ("bathtub",      1.600, 1.600, 0.600, [0.96, 0.96, 0.98]),
    ("toilet",       0.380, 0.680, 0.400, [0.96, 0.96, 0.96]),
    ("sink",         0.750, 0.560, 0.800, [0.92, 0.92, 0.95]),
    ("fridge",       0.650, 0.700, 1.800, [0.90, 0.92, 0.93]),
    ("dining_table", 1.200, 0.800, 0.720, [0.65, 0.48, 0.28]),
    ("desk",         1.200, 0.600, 0.720, [0.72, 0.62, 0.48]),
    ("tv",           1.200, 0.080, 0.700, [0.10, 0.10, 0.12]),
    ("closet",       1.800, 0.600, 2.100, [0.82, 0.76, 0.64]),
]

def box_glb(path, w, d, h, color):
    """Single-box GLB: centered on X/Z, bottom at Y=0, +Y up."""
    hw, hd = w/2, d/2
    v = np.array([
        [-hw,0,hd],[hw,0,hd],[hw,h,hd],[-hw,h,hd],
        [hw,0,-hd],[-hw,0,-hd],[-hw,h,-hd],[hw,h,-hd],
        [-hw,0,-hd],[-hw,0,hd],[-hw,h,hd],[-hw,h,-hd],
        [hw,0,hd],[hw,0,-hd],[hw,h,-hd],[hw,h,hd],
        [-hw,h,hd],[hw,h,hd],[hw,h,-hd],[-hw,h,-hd],
        [-hw,0,-hd],[hw,0,-hd],[hw,0,hd],[-hw,0,hd],
    ], dtype='f4')
    n = np.array(
        [[0,0,1]]*4+[[0,0,-1]]*4+[[-1,0,0]]*4+
        [[1,0,0]]*4+[[0,1,0]]*4+[[0,-1,0]]*4, dtype='f4')
    i = np.array([
        0,1,2,0,2,3, 4,5,6,4,6,7, 8,9,10,8,10,11,
        12,13,14,12,14,15, 16,17,18,16,18,19, 20,21,22,20,22,23
    ], dtype='u2')
    vb, nb, ib = v.tobytes(), n.tobytes(), i.tobytes()
    pad = (4 - len(ib)%4) % 4
    buf = vb + nb + ib + b'\x00'*pad

    gltf = gl.GLTF2(
        scene=0, scenes=[gl.Scene(nodes=[0])], nodes=[gl.Node(mesh=0)],
        meshes=[gl.Mesh(primitives=[gl.Primitive(
            attributes=gl.Attributes(POSITION=0, NORMAL=1),
            indices=2, material=0)])],
        materials=[gl.Material(
            pbrMetallicRoughness=gl.PbrMetallicRoughness(
                baseColorFactor=[*color, 1.0],
                roughnessFactor=0.78, metallicFactor=0.0),
            doubleSided=False)],
        accessors=[
            gl.Accessor(bufferView=0, componentType=gl.FLOAT, count=24,
                        type=gl.VEC3, max=v.max(0).tolist(), min=v.min(0).tolist()),
            gl.Accessor(bufferView=1, componentType=gl.FLOAT, count=24, type=gl.VEC3),
            gl.Accessor(bufferView=2, componentType=gl.UNSIGNED_SHORT,
                        count=36, type=gl.SCALAR),
        ],
        bufferViews=[
            gl.BufferView(buffer=0, byteOffset=0,         byteLength=len(vb), target=gl.ARRAY_BUFFER),
            gl.BufferView(buffer=0, byteOffset=len(vb),   byteLength=len(nb), target=gl.ARRAY_BUFFER),
            gl.BufferView(buffer=0, byteOffset=len(vb)+len(nb), byteLength=len(ib),
                          target=gl.ELEMENT_ARRAY_BUFFER),
        ],
        buffers=[gl.Buffer(byteLength=len(buf))],
    )
    gltf.set_binary_blob(buf)
    gltf.save(path)
    sz = os.path.getsize(path)
    print(f"  {os.path.basename(path):25s}  {w:.3f}×{d:.3f}×{h:.3f}m  {sz} bytes")

if __name__ == "__main__":
    print(f"Generating {len(FURNITURE)} GLB models → {OUT}/")
    for name, w, d, h, color in FURNITURE:
        box_glb(f"{OUT}/{name}.glb", w, d, h, color)
    print("Done.")
```

- [ ] **Step 2: 依存ライブラリをインストールして実行**

```bash
pip install pygltflib numpy
cd /Users/nariiwa/Documents/GitHub/webcad-planner
python3 scripts/gen_models.py
```

期待出力:
```
Generating 12 GLB models → assets/models/
  sofa.glb                   2.100×0.850×0.750m  ...
  bed_double.glb             1.400×1.950×0.550m  ...
  ... (計12ファイル)
Done.
```

- [ ] **Step 3: GLB の整合性確認**

```bash
ls -lh assets/models/
python3 -c "
import pygltflib, glob
for f in sorted(glob.glob('assets/models/*.glb')):
    g = pygltflib.GLTF2().load(f)
    a = g.accessors[0]
    print(f'{f}: verts={a.count}, min={a.min}, max={a.max}')
"
```

全12ファイルが読み込め、`count=24` (頂点数)、 min/max がそれぞれの寸法と一致することを確認。

- [ ] **Step 4: コミット**

```bash
git add scripts/gen_models.py assets/models/
git commit -m "feat: add GLB furniture model generation script and generated models"
```

---

## Task 8: Three.js GLTF_MAP を全12種に拡張

**Files:**
- Modify: `index.html:242-246` (GLTF_MAP)

---

- [ ] **Step 1: GLTF_MAP を書き換える**

`index.html` の `var GLTF_MAP = {` ブロックを以下に置き換える:

```javascript
var GLTF_MAP = {
  'sofa':         'assets/models/sofa.glb',
  'bed-d':        'assets/models/bed_double.glb',
  'bed-s':        'assets/models/bed_single.glb',
  'kitchen':      'assets/models/kitchen.glb',
  'bath':         'assets/models/bathtub.glb',
  'toilet':       'assets/models/toilet.glb',
  'sink':         'assets/models/sink.glb',
  'fridge':       'assets/models/fridge.glb',
  'dining-table': 'assets/models/dining_table.glb',
  'desk':         'assets/models/desk.glb',
  'tv':           'assets/models/tv.glb',
  'closet':       'assets/models/closet.glb',
};
```

- [ ] **Step 2: ブラウザで3Dビューを確認**

ブラウザで開いて 3D 外観ビューに切り替え、ソファ・ベッド等が GLB モデルとして表示（カラー付きボックス形状）されることをコンソールエラーなく確認する。

確認コマンド（ブラウザコンソール）:
```javascript
Object.keys(GLTF_MAP).forEach(k => console.log(k, GLTF_MAP[k]))
// → 12種すべて assets/models/*.glb が出力される
```

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat: expand GLTF_MAP to all 12 furniture types with local GLB files"
```

---

## Task 9: Three.js マテリアルに PBR テクスチャ + normalMap を適用

**Files:**
- Modify: `index.html` — `buildRoom3D`/`buildWall3D` のマテリアル生成部分

---

- [ ] **Step 1: テクスチャプリロード定数を追加**

`var GLTF_MAP = {...};` の直後（`var _modelCache = {};` の前）に以下を追加:

```javascript
// PBR Textures (lazy-loaded)
var _pbrTex = {};
function pbrTex(name) {
  if (_pbrTex[name]) return _pbrTex[name];
  var loader = new THREE.TextureLoader();
  var t = loader.load('assets/textures/' + name, function(){ if(ren) ren.render(sc3, ST.view==='interior'?camInt:camExt); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = THREE.sRGBEncoding;
  _pbrTex[name] = t;
  return t;
}
function pbrTexLinear(name) {
  if (_pbrTex['_lin_'+name]) return _pbrTex['_lin_'+name];
  var loader = new THREE.TextureLoader();
  var t = loader.load('assets/textures/' + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // Normal/roughness maps must NOT use sRGB encoding
  _pbrTex['_lin_'+name] = t;
  return t;
}
```

- [ ] **Step 2: 床マテリアルに木目テクスチャを適用**

`rebuild3D` 内の `DATA.rooms.forEach` ブロック（`var matParams = {color:0xffffff, roughness:0.8};` の部分、現在行 1110 付近）を修正:

```javascript
    // 変更前
    var matParams = {color:0xffffff, roughness:0.8};
    var baseTex = getTexture3D(r.texture || 'wood_floor');
    if(baseTex){ matParams.map = baseTex; }

    // 変更後
    var isWet = r.texture === 'tile_floor' || r.n === 'バス' || r.n === 'トイレ' || r.n === '洗面';
    var diffName = isWet ? 'floor_tile_diffuse.jpg' : 'floor_wood_diffuse.jpg';
    var normName = isWet ? 'floor_tile_normal.jpg'  : 'floor_wood_normal.jpg';
    var roughName= isWet ? 'floor_tile_roughness.jpg': 'floor_wood_roughness.jpg';
    var repU = r.w / 900, repV = r.d / 900;  // 900mm per tile repeat
    var floorDiff  = pbrTex(diffName);
    var floorNorm  = pbrTexLinear(normName);
    var floorRough = pbrTexLinear(roughName);
    [floorDiff, floorNorm, floorRough].forEach(function(t){ t.repeat.set(repU, repV); });
    var matParams = {
      color: 0xffffff, map: floorDiff,
      normalMap: floorNorm, normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: floorRough, roughness: 1.0, metalness: 0.0
    };
    if(r.texture && r.texture !== 'wood_floor' && r.texture !== 'tile_floor'){
      var baseTex = getTexture3D(r.texture);
      if(baseTex) matParams.map = baseTex;
    }
```

- [ ] **Step 3: 外壁マテリアルにサイディングテクスチャを適用**

`buildWall3D` 内（`var matParams = {color:color, roughness:0.7, metalness:0.1};` の部分）を修正:

```javascript
    // 変更前
    var matParams = {color:color, roughness:0.7, metalness:0.1};
    if(w.texture) { ... }
    var mat=new THREE.MeshStandardMaterial(matParams);

    // 変更後
    var matParams = {color:color, roughness:0.7, metalness:0.0};
    var isOuter3d = w.thick >= 120;
    if(!w.texture && isOuter3d){
      var sidingDiff = pbrTex(w.floor === 1 ? 'wall_siding_diffuse.jpg' : 'wall_plaster_diffuse.jpg');
      var sidingNorm = pbrTexLinear(w.floor === 1 ? 'wall_siding_normal.jpg' : null);
      var wallLen = Math.sqrt(Math.pow(w.x2-w.x1,2)+Math.pow(w.y2-w.y1,2));
      sidingDiff.repeat.set(wallLen/600, 1);
      matParams.map = sidingDiff;
      matParams.color = 0xffffff;
      if(sidingNorm){ sidingNorm.repeat.copy(sidingDiff.repeat); matParams.normalMap = sidingNorm; matParams.normalScale = new THREE.Vector2(0.8,0.8); }
    } else if(w.texture) {
      var baseTex = getTexture3D(w.texture);
      if(baseTex){ matParams.map = baseTex; matParams.color = 0xffffff; }
    }
    var mat=new THREE.MeshStandardMaterial(matParams);
```

- [ ] **Step 4: ブラウザで確認**

3D 外観ビューで外壁にサイディングパターン、室内床に木目テクスチャが表示されることを確認する。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat: apply PBR textures with normalMap to 3D floor and walls"
```

---

## Task 10: HDR 環境マップの追加（Layer 1）

**Files:**
- Modify: `index.html` — CDN スクリプト追加 + `init3D` 関数
- Download: `assets/env/outdoor.hdr`

---

- [ ] **Step 1: HDR ファイルをダウンロード**

```bash
mkdir -p assets/env
curl -L "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr" \
     -o assets/env/outdoor.hdr
ls -lh assets/env/outdoor.hdr
# 期待: ~800KB
```

ダウンロードできない場合の代替:
```bash
curl -L "https://threejs.org/examples/textures/equirectangular/blouberg_sunrise_2_1k.hdr" \
     -o assets/env/outdoor.hdr
```

- [ ] **Step 2: RGBELoader CDN スクリプトを追加**

`index.html` の `<script src="...UnrealBloomPass.js">` の行の直後に追加:

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/RGBELoader.js"></script>
```

- [ ] **Step 3: `init3D` 内に環境マップ初期化を追加**

`init3D` 関数（`var gnd=new THREE.Mesh(...)` の直後あたり）に以下を追加:

```javascript
  // HDR Environment Map
  (function(){
    var pmrem = new THREE.PMREMGenerator(ren);
    pmrem.compileEquirectangularShader();
    new THREE.RGBELoader()
      .setDataType(THREE.UnsignedByteType)
      .load('assets/env/outdoor.hdr', function(hdrTexture) {
        var envMap = pmrem.fromEquirectangular(hdrTexture).texture;
        sc3.environment = envMap;
        hdrTexture.dispose();
        pmrem.dispose();
        rebuild3D();
        console.log('[WebCAD] HDR environment map loaded');
      }, undefined, function(err) {
        console.warn('[WebCAD] HDR load failed, using fallback lighting', err);
      });
  })();
```

- [ ] **Step 4: ブラウザで確認**

ブラウザコンソールに `[WebCAD] HDR environment map loaded` が表示され、外壁・床・家具に環境光の反射が乗ることを確認。Network タブで `outdoor.hdr` がロードされていることを確認。

- [ ] **Step 5: コミット**

```bash
git add index.html assets/env/outdoor.hdr
git commit -m "feat: add HDR environment map for photorealistic 3D rendering"
```

---

## Task 11: ポストプロセス・ライティング・シャドウ調整（Layer 4）

**Files:**
- Modify: `index.html` — `init3D` 関数のシャドウ設定・SAO・Bloom パラメータ・`rebuild3D`

---

- [ ] **Step 1: シャドウカメラを動的フィットさせる関数を追加**

`rebuild3D` 関数（`function rebuild3D(){` の行）の直後・中身の先頭に以下を追加:

```javascript
function fitShadowCamera(sun) {
  // ビルディング全体の BoundingBox を計算してシャドウカメラをフィット
  var box = new THREE.Box3();
  sc3.traverse(function(obj){
    if(obj.isMesh && obj.name !== '_sky' && !obj.name.startsWith('Ground')) {
      box.expandByObject(obj);
    }
  });
  if(box.isEmpty()) return;
  var size = box.getSize(new THREE.Vector3());
  var center = box.getCenter(new THREE.Vector3());
  var margin = 1.3;
  var r = Math.max(size.x, size.z) * margin / 2;
  sun.shadow.camera.left   = -r;
  sun.shadow.camera.right  =  r;
  sun.shadow.camera.top    =  r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = size.y * 3 + 80;
  sun.shadow.camera.updateProjectionMatrix();
}
```

`rebuild3D` の最後（`}` の直前）に `fitShadowCamera(sun);` を呼ぶ行を追加する。
(`sun` 変数は `init3D` スコープにある。`rebuild3D` から参照できるよう `var sun;` を `init3D` の外側に引き出すか、`sc3.getObjectByName('Sun')` で取得する。)

実際には以下のように `rebuild3D` の末尾に追加:
```javascript
  // 末尾に追加
  var sunLight = null;
  sc3.traverse(function(o){ if(o.isDirectionalLight) sunLight = o; });
  if(sunLight) fitShadowCamera(sunLight);
```

- [ ] **Step 2: SAO パラメータを最適化**

`init3D` 内の SAOPass 設定（`if(THREE.SAOPass)` ブロック）を修正:

```javascript
      if(THREE.SAOPass) {
        var sao = new THREE.SAOPass(sc3, camExt, false, true);
        // 変更前: デフォルト値
        // 変更後: 接地感を出すパラメータ
        sao.params.output = 0; // Default
        sao.params.saoBias = 0.5;
        sao.params.saoIntensity = 0.18;
        sao.params.saoScale = 10;
        sao.params.saoKernelRadius = 12;
        sao.params.saoMinResolution = 0;
        sao.params.saoBlur = true;
        composer.addPass(sao);
      }
```

- [ ] **Step 3: Bloom を控えめに調整**

`if(THREE.UnrealBloomPass)` ブロック:

```javascript
      if(THREE.UnrealBloomPass) {
        // 変更前: strength:0.35, radius:0.4, threshold:0.85
        var bloom = new THREE.UnrealBloomPass(
          new THREE.Vector2(wrap.clientWidth, wrap.clientHeight),
          0.25,   // strength（控えめ）
          0.4,    // radius
          0.90    // threshold（光源部分のみ）
        );
        composer.addPass(bloom);
      }
```

- [ ] **Step 4: ブラウザで確認**

3D 外観ビューで接地部分・軒下に自然な影（AO）が見えること、Bloom が建物のハイライト部分のみに適度にかかることを確認。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat: tune SAO/Bloom post-processing and add dynamic shadow camera fit"
```

---

## 品質チェック（全タスク完了後）

- [ ] **2D: 外壁ハッチング**
  - `index.html` を開き、壁を引いて 3D ビューに切り替えず 2D のまま確認
  - 120mm 以上の壁に斜線ハッチングが出る

- [ ] **2D: 畳数表示**
  - 部屋を配置して `10.2畳 / 16.52㎡` のように表示される

- [ ] **2D: JIS 建具記号**
  - 引き戸が 2本平行線＋戸矩形で描画される
  - 窓が 3本平行線で描画される

- [ ] **3D: 環境マップ**
  - ブラウザコンソール `[WebCAD] HDR environment map loaded`
  - 外壁・床材に環境反射が乗っている

- [ ] **3D: 全12種 GLB**
  - ソファ・ベッド等すべてがコンソールエラーなく表示される

- [ ] **3D: テクスチャ**
  - 床に木目（または浴室にタイル）が表示される
  - 外壁にサイディングパターンが表示される

- [ ] **モバイル動作**
  - iOS Safari / Android Chrome で開き、60fps を維持する
  - HDR ロード失敗時にフォールバックで表示が壊れない

---

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| `outdoor.hdr` が 404 | `assets/env/` にファイルが存在するか確認。`file://` プロトコルでは CORS 制限あり — `python3 -m http.server` でローカルサーバを使う |
| GLB が読み込まれない | ブラウザコンソールの Network タブで `assets/models/*.glb` の HTTP ステータスを確認。404 なら gen_models.py を再実行 |
| ハッチングが壁全体を覆う | `drawHatch` の clip が正しく機能しているか確認。`ctx.save()/restore()` を drawWall2d 呼び出し外に移動 |
| テクスチャが真っ黒 | `pbrTexLinear` の normalMap は `encoding` を `THREE.LinearEncoding`（デフォルト）のままにする。`sRGBEncoding` を設定しない |
