# Three.js 品質強化 設計仕様

**日付:** 2026-05-12  
**対象リポジトリ:** webcad-planner  
**目標:** myhome-cloud.net/webcad/trial/index.html に匹敵する高品質な間取り3Dプレビューをブラウザ（モバイル含む）で実現する

---

## 背景と制約

- フロントエンドは単一 HTML (`index.html`) + Three.js r128 + CDN スクリプト
- モバイルブラウザ（スマートフォン）で動作すること
- サーバーサイド処理なし（Cloudflare Pages でのスタティックホスティング）
- Three.js バージョンは r128 に固定（既存コードとの互換性）
- 品質が不足した場合はハイブリッド方式（Three.js + Unity HD レンダー）に切り替える

---

## 現状の課題

| 項目 | 現状 | 問題 |
|------|------|------|
| 環境マップ | なし | 反射・照り返しがなくフラットな見た目 |
| 床テクスチャ | Canvas 生成パターン (低解像度) | 法線マップなし、立体感なし |
| 家具GLBモデル | 3種のみ (KhronosサンプルGLB) | 日本家具に非対応、残り9種はキューブ |
| 外壁テクスチャ | なし (単色) | サイディング・漆喰の質感なし |
| 屋根テクスチャ | なし (単色) | 瓦の質感なし |
| SAOパラメータ | デフォルト値 | 接地感・陰影が弱い |

---

## 改善設計

### Layer 1: HDR 環境マップ（最優先）

**目的:** PBR マテリアル全体に環境反射を乗せて一気にフォトリアルな質感に  
**実装:**
- `RGBELoader` + `PMREMGenerator` で外観用 HDR をロード  
  - ソース: polyhaven.com の CC0 1K HDR（`venice_sunset_1k.hdr` 相当、約500KB）  
  - `assets/env/outdoor.hdr` に配置
- 内観用: Three.js の `WebGLCubeRenderTarget` で白室内環境を手動生成（外部ファイル不要）
- `sc3.environment = envTexture` でシーン全体に適用
- `sc3.background` は既存のグラデーション sky mesh を維持（環境マップは反射のみに使用）

**モバイル対応:** HDR ロード失敗時は HemisphereLight のみにフォールバック

---

### Layer 2: 家具 GLB モデル整備

**目的:** 全12種の家具を形状・マテリアル正確な GLB で表現  
**実装:**
- `scripts/gen_models.py` を作成（pygltflib 使用）
- 12種すべてをプロシージャルに生成し `assets/models/` に配置
- 各モデルは正確な寸法・PBR マテリアル（baseColor, roughness, metallic）を持つ
- `GLTF_MAP` を全12種に拡張

| 家具 | ファイル | 形状 |
|------|---------|------|
| sofa | sofa.glb | L字or直線、クッション付き |
| bed-d | bed_double.glb | ベッドフレーム + マットレス |
| bed-s | bed_single.glb | 同上（幅変更） |
| kitchen | kitchen.glb | カウンター + シンク + コンロ |
| bath | bathtub.glb | 浴槽形状 |
| toilet | toilet.glb | 便器形状 |
| sink | sink.glb | 洗面台 |
| fridge | fridge.glb | 冷蔵庫（箱＋ハンドル） |
| dining-table | dining_table.glb | テーブル + 脚 |
| desk | desk.glb | デスク形状 |
| tv | tv.glb | 薄型パネル + スタンド |
| closet | closet.glb | 収納棚 |

---

### Layer 3: PBR テクスチャ生成

**目的:** 床・壁・屋根に法線マップ付きリアルテクスチャを適用  
**実装:**
- `scripts/gen_textures.py` を作成（Pillow 使用）
- 生成物は `assets/textures/` に配置

| テクスチャ | ファイル群 | 適用箇所 |
|-----------|-----------|---------|
| 木目フロア | `floor_wood_{diffuse,normal,roughness}.jpg` | 室内床 |
| タイル床 | `floor_tile_{diffuse,normal,roughness}.jpg` | 洗面・浴室 |
| 外壁サイディング | `wall_siding_{diffuse,normal}.jpg` | 1F外壁 |
| 漆喰壁 | `wall_plaster_diffuse.jpg` | 2F外壁・内壁 |
| 瓦屋根 | `roof_tile_{diffuse,normal}.jpg` | 屋根 |

- Three.js 側で `normalMap` + `normalScale` を MeshStandardMaterial に追加
- モバイル: テクスチャを 512×512 に制限し `generateMipmaps: true`

---

### Layer 4: ポストプロセス・ライティング調整

**SAO パラメータ最適化:**
```
sao.params.output = SAOPass.OUTPUT.Default
sao.params.saoBias = 0.5
sao.params.saoIntensity = 0.18
sao.params.saoScale = 10
sao.params.saoKernelRadius = 12
sao.params.saoMinResolution = 0
```

**シャドウカメラ動的フィット:**
- `rebuild3D()` 後にビルディングのバウンディングボックスを計算
- `sun.shadow.camera` の left/right/top/bottom をビルサイズ + マージン 20% に設定

**Bloom 調整:**
- `strength: 0.25`（現在 0.35 → 控えめに）
- `threshold: 0.90`（光源部分のみ）

---

## ファイル構成（変更・追加）

```
webcad-planner/
├── index.html                        # 変更: Layer 1,3,4 を適用
├── scripts/
│   ├── gen_textures.py               # 新規: PBR テクスチャ生成
│   └── gen_models.py                 # 新規: GLB モデル生成
├── assets/
│   ├── env/
│   │   └── outdoor.hdr               # 新規: CC0 HDR 環境マップ
│   ├── textures/
│   │   ├── floor_wood_diffuse.jpg    # 新規 (gen_textures.py 生成)
│   │   ├── floor_wood_normal.jpg
│   │   ├── floor_tile_diffuse.jpg
│   │   ├── floor_tile_normal.jpg
│   │   ├── wall_siding_diffuse.jpg
│   │   ├── wall_siding_normal.jpg
│   │   ├── wall_plaster_diffuse.jpg
│   │   ├── roof_tile_diffuse.jpg
│   │   └── roof_tile_normal.jpg
│   └── models/
│       ├── sofa.glb                   # 新規 (gen_models.py 生成)
│       ├── bed_double.glb
│       └── ... (計12種)
└── docs/superpowers/specs/
    └── 2026-05-12-threejs-quality-enhancement-design.md
```

---

## 実装順序

1. **Layer 1** — HDR 環境マップ（最大インパクト、index.html のみ変更）
2. **Layer 2** — gen_models.py 実行 + GLTF_MAP 拡張
3. **Layer 3** — gen_textures.py 実行 + normalMap 追加
4. **Layer 4** — ポストプロセス・ライティング調整

---

## 品質チェック基準

Layer 1〜4 実装後、以下を確認する:
- 外壁に環境光の反射が見える
- 家具が全種正しく表示される
- 床・壁に立体感のあるテクスチャが表示される
- モバイル（Safari/Chrome iOS）で60fps 維持
- 品質がベンチマークと同等でない場合 → Unity WebGL ハイブリッド方式に移行

---

## 将来の拡張（スコープ外）

- Unity WebGL 埋め込みビューア（ハイブリッド方式）
- Unity による HD PNG ダウンロード機能
- ユーザーが任意テクスチャを追加できるパレット UI
