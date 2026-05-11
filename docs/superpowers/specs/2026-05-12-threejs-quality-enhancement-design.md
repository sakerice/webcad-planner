# WebCAD 品質強化 設計仕様

**日付:** 2026-05-12  
**対象リポジトリ:** webcad-planner  
**目標:** myhome-cloud.net/webcad/trial/index.html に匹敵する高品質な間取りプレビューをブラウザ（モバイル含む）で実現する。2D図面・3Dビュー両方を日本住宅規格に準拠させる。

---

## 背景と制約

- フロントエンドは単一 HTML (`index.html`) + Three.js r128 + CDN スクリプト
- モバイルブラウザ（スマートフォン）で動作すること
- サーバーサイド処理なし（Cloudflare Pages でのスタティックホスティング）
- Three.js バージョンは r128 に固定（既存コードとの互換性）
- 品質が不足した場合はハイブリッド方式（Three.js + Unity HD レンダー）に切り替える

---

## 日本住宅規格 基準値

2D・3D 両方に適用するデフォルト寸法（木造在来工法・JIS/公庫仕様準拠）。

### 建築寸法

| 部位 | 規格値 | 備考 |
|------|--------|------|
| 天井高 | 2400mm | 標準。リビング等は 2500mm |
| フロア間高 | 2700mm | 階高（現行実装 2700mm ✓） |
| 外壁厚 | 120mm | 木造標準 |
| 内壁厚 | 90mm | 間仕切り壁 |
| 開き戸 W | 780mm | 一般室内（玄関は 900mm） |
| 引き戸 W | 780mm | |
| ドア高 | 2000mm | |
| 掃き出し窓 | W1800 × H2000mm | |
| 腰窓 | W1600 × H1100mm、床から 900mm | |

### 設備寸法

| 設備 | W × D（mm） | 備考 |
|------|------------|------|
| システムキッチン | 2550 × 650 | I型標準。H=850mm |
| ユニットバス | 1600 × 1600 | 1616型標準 |
| トイレ室 | 900 × 1600 | スペース。便器本体 W380×D680 |
| 洗面台 | 750 × 560 | 標準750幅。H=800mm |
| 冷蔵庫 | 650 × 700 | 一般 2ドア。H=1800mm |
| 洗濯機 | 640 × 640 | H=1050mm |

### 家具寸法

| 家具 | W × D（mm） | 備考 |
|------|------------|------|
| シングルベッド | 970 × 1950 | H=550mm（マットレス上面） |
| セミダブルベッド | 1200 × 1950 | |
| ダブルベッド | 1400 × 1950 | |
| 3Pソファ | 2100 × 850 | H=750mm |
| 2Pソファ | 1500 × 850 | |
| 食卓（4人） | 1200 × 800 | H=720mm |
| 食卓（6人） | 1600 × 900 | |
| ローテーブル | 900 × 500 | H=350mm |
| デスク | 1200 × 600 | H=720mm |
| 収納クローゼット | 1800 × 600 | H=2100mm |

---

## 現状の課題

### 3D ビュー

| 項目 | 現状 | 問題 |
|------|------|------|
| 環境マップ | なし | 反射・照り返しがなくフラットな見た目 |
| 床テクスチャ | Canvas 生成パターン（低解像度） | 法線マップなし、立体感なし |
| 家具GLBモデル | 3種のみ（KhronosサンプルGLB） | 日本家具に非対応、残り9種はキューブ |
| 外壁テクスチャ | なし（単色） | サイディング・漆喰の質感なし |
| 屋根テクスチャ | なし（単色） | 瓦の質感なし |
| SAOパラメータ | デフォルト値 | 接地感・陰影が弱い |

### 2D ビュー

| 項目 | 現状 | 問題 |
|------|------|------|
| 壁断面 | 単色塗りつぶし | 外壁・内壁の区別が弱い、層際表現なし |
| 建具記号 | 弧・スプライトが混在 | JIS A 0150 記号に統一されていない |
| 部屋情報 | 名称のみ | 畳数・㎡が表示されない |
| デフォルトサイズ | 独自値 | 日本住宅規格に合っていない |
| 配色・線幅 | ゲーム風 UI 配色 | 建築図面らしいクリーンなデザインでない |

---

## 改善設計

### 2D-1: 壁断面・層際表現の強化

**外壁と内壁を視覚的に明確に区別する。**

- **外壁（thick ≧ 120mm）**: 壁領域を `#e8e4dc` で塗りつぶし、内側に斜線ハッチング（45°、ピッチ 6px、色 `#bbb`）、外縁に 2.5px 黒線
- **内壁（thick < 120mm）**: `#d0cfc8` 単色塗りつぶし、1.5px ダークグレー線
- 断面ハッチングは Canvas の `clip + lineTo` で実装（外部ライブラリ不要）

---

### 2D-2: 建具記号の JIS A 0150 準拠

**開き戸・引き戸・窓をそれぞれ正確な JIS 建築図面記号で描画する。**

| 建具 | JIS 記号の描画方法 |
|------|-----------------|
| 開き戸（door-swing） | 開口部に扉厚矩形 + 1/4 円弧（現行の弧を改良） |
| 引き戸（door-slide） | 開口部に 2本平行線（レール） + 戸の矩形 |
| 引き分け戸 | 中央から左右に引き戸 × 2 |
| 窓（window） | 壁開口に細い 3本平行線（框 + ガラス） |
| 玄関ドア（door-front） | 開き戸と同様。外壁厚を貫通する形状 |

- 現在は `buildItem3D`/2D 描画に混在しているロジックを `drawBuilding(item)` 関数として分離
- 建具の寸法デフォルト値を上記規格値（W780mm, H2000mm 等）に修正

---

### 2D-3: 部屋の畳数・平米表示

**各部屋の中央に名称 + 畳数 + ㎡ を自動表示する。**

- 面積計算: `area_m2 = (w_mm × d_mm) / 1_000_000`
- 畳数換算: `tatami = area_m2 / 1.62`（関東間基準）
- 表示形式: `LDK\n14.0畳 / 22.7㎡`（2行）
- フォント: Noto Sans JP 11px（名称）/ 9px（畳数）、色 `#555`
- ズームが小さい（scale < 0.4）場合は畳数行を非表示にして名称のみ表示

---

### 2D-4: 配色・フォント・線幅の整理

**建築図面らしいクリーンな配色に統一する。**

| 要素 | 現在 | 変更後 |
|------|------|--------|
| 背景 | `#1a2540`（紺） | `#f5f3ee`（白に近いベージュ） |
| グリッド | `#223` | `#ddd`（薄いグレー） |
| 外壁塗り | `#333` | `#e8e4dc` + ハッチング |
| 内壁塗り | `#555` | `#d0cfc8` |
| 部屋背景 | 薄い青 | `#faf8f3`（アイボリー） |
| 家具輪郭 | 各色 | `#8a9ab0`（統一ブルーグレー） |
| 寸法テキスト | 白 | `#444` |
| UI（ツールバー等） | 変更しない | スコープ外 |

- Canvas の線幅: 外壁 2.5px、内壁 1.5px、家具 1px、補助線 0.5px（破線）

---

### Layer 1: HDR 環境マップ（3D・最優先）

**目的:** PBR マテリアル全体に環境反射を乗せて一気にフォトリアルな質感に  
**実装:**
- `RGBELoader` + `PMREMGenerator` で外観用 HDR をロード
  - ソース: polyhaven.com の CC0 1K HDR（`venice_sunset_1k.hdr` 相当、約500KB）
  - `assets/env/outdoor.hdr` に配置
- 内観用: `WebGLCubeRenderTarget` で白室内環境を手動生成（外部ファイル不要）
- `sc3.environment = envTexture` でシーン全体に適用
- `sc3.background` は既存のグラデーション sky mesh を維持

**モバイル対応:** HDR ロード失敗時は HemisphereLight のみにフォールバック

---

### Layer 2: 家具 GLB モデル整備（3D）

**目的:** 全12種の家具を日本規格寸法・PBR マテリアルの GLB で表現  
**実装:**
- `scripts/gen_models.py` を作成（pygltflib 使用）
- 寸法は上記「家具寸法」規格値に準拠
- `GLTF_MAP` を全12種に拡張（`assets/models/<type>.glb`）

| 家具キー | ファイル | W×D×H（mm） |
|---------|---------|-------------|
| sofa | sofa.glb | 2100×850×750 |
| bed-d | bed_double.glb | 1400×1950×550 |
| bed-s | bed_single.glb | 970×1950×550 |
| kitchen | kitchen.glb | 2550×650×850 |
| bath | bathtub.glb | 1600×1600×600 |
| toilet | toilet.glb | 380×680×400 |
| sink | sink.glb | 750×560×800 |
| fridge | fridge.glb | 650×700×1800 |
| dining-table | dining_table.glb | 1200×800×720 |
| desk | desk.glb | 1200×600×720 |
| tv | tv.glb | 1200×80×700 |
| closet | closet.glb | 1800×600×2100 |

---

### Layer 3: PBR テクスチャ生成（3D）

**目的:** 床・壁・屋根に法線マップ付きリアルテクスチャを適用  
**実装:**
- `scripts/gen_textures.py` を作成（Pillow 使用）
- 生成物は `assets/textures/` に配置

| テクスチャ | ファイル群 | 適用箇所 |
|-----------|-----------|---------|
| 木目フロア | `floor_wood_{diffuse,normal,roughness}.jpg` | 室内床 |
| タイル床 | `floor_tile_{diffuse,normal,roughness}.jpg` | 洗面・浴室床 |
| 外壁サイディング | `wall_siding_{diffuse,normal}.jpg` | 1F外壁 |
| 漆喰壁 | `wall_plaster_diffuse.jpg` | 2F外壁・内壁 |
| 瓦屋根 | `roof_tile_{diffuse,normal}.jpg` | 屋根 |

- Three.js 側で `normalMap` + `normalScale` を MeshStandardMaterial に追加
- モバイル: テクスチャを 512×512 に制限し `generateMipmaps: true`

---

### Layer 4: ポストプロセス・ライティング調整（3D）

**SAO パラメータ最適化:**
```
sao.params.saoBias = 0.5
sao.params.saoIntensity = 0.18
sao.params.saoScale = 10
sao.params.saoKernelRadius = 12
```

**シャドウカメラ動的フィット:**
- `rebuild3D()` 後にビルディングの BoundingBox を計算
- `sun.shadow.camera` の left/right/top/bottom をビルサイズ + 20% マージンに設定

**Bloom 調整:**
- `strength: 0.25`（現在 0.35 → 控えめに）
- `threshold: 0.90`

---

## ファイル構成（変更・追加）

```
webcad-planner/
├── index.html                         # 変更: 2D-1〜4, Layer 1,3,4 を適用
├── scripts/
│   ├── gen_textures.py                # 新規: PBR テクスチャ生成
│   └── gen_models.py                  # 新規: GLB モデル生成（規格寸法）
├── assets/
│   ├── env/
│   │   └── outdoor.hdr                # 新規: CC0 HDR 環境マップ
│   ├── textures/
│   │   ├── floor_wood_diffuse.jpg
│   │   ├── floor_wood_normal.jpg
│   │   ├── floor_tile_diffuse.jpg
│   │   ├── floor_tile_normal.jpg
│   │   ├── wall_siding_diffuse.jpg
│   │   ├── wall_siding_normal.jpg
│   │   ├── wall_plaster_diffuse.jpg
│   │   ├── roof_tile_diffuse.jpg
│   │   └── roof_tile_normal.jpg
│   └── models/
│       ├── sofa.glb
│       ├── bed_double.glb
│       └── ... (計12種)
└── docs/superpowers/specs/
    └── 2026-05-12-threejs-quality-enhancement-design.md
```

---

## 実装順序

1. **2D-1〜4** — 2D 図面ブラッシュアップ（配色・壁断面・建具記号・畳数表示・規格デフォルト値）
2. **Layer 1** — HDR 環境マップ（3D 最大インパクト）
3. **Layer 2** — gen_models.py 実行 + GLTF_MAP 拡張（規格寸法 GLB）
4. **Layer 3** — gen_textures.py 実行 + normalMap 追加
5. **Layer 4** — ポストプロセス・ライティング調整

---

## 品質チェック基準

実装後、以下をすべて確認する:
- 2D: 外壁がハッチング付きで、内壁と明確に区別できる
- 2D: 各部屋に「○○畳 / △△㎡」が表示される
- 2D: ドアが JIS 弧記号、窓が JIS 3本線で描画される
- 3D: 外壁に環境光の反射が見える
- 3D: 家具が全12種正しく表示される（規格寸法）
- 3D: 床・壁に立体感のあるテクスチャが表示される
- モバイル（Safari/Chrome iOS）で 60fps 維持
- 品質がベンチマーク未達の場合 → Unity WebGL ハイブリッド方式に移行

---

## 将来の拡張（スコープ外）

- Unity WebGL 埋め込みビューア（ハイブリッド方式）
- Unity による HD PNG ダウンロード機能
- ユーザーが任意テクスチャを追加できるパレット UI
- 部屋ごとのテクスチャ選択 UI の充実
