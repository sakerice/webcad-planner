# 洋館の窓4点

窓1台分の閉じた静的モデル。壁・開口・アプリ登録は含めません。Blender 5.1.2 の CLI で独自制作し、外部モデル・画像は使っていません。

| ID | 名前 | 実測 W×D×H mm（0.001mm丸め） | 三角形 |
| --- | --- | --- | ---: |
| rpg-mansion-sash-window-01 | 上げ下げ窓 | 900×150×1400 | 2460 |
| rpg-mansion-casement-window-01 | 両開きの開き窓 | 1200×150×1200 | 4944 |
| rpg-mansion-french-window-01 | 縦長のフランス窓 | 1600×150×2200 | 6196 |
| rpg-mansion-arched-fixed-window-01 | 飾り格子のはめ殺し窓 | 900×150×1200 | 3028 |

単位は m。Blender -Y が屋外正面、Z が上。GLB では正面 +Z、上 +Y。原点は下端中心、奥行きは窓台を含む ±75mm。外枠の木口・額縁・框・格子に物理的な段差と面取りを付けています。上げ下げ窓は上下の障子を奥行き方向にずらし各3×2、両開きは各2×4、フランス窓は各2×5と低い板・上部欄間、FIXは矩形外枠内に半円と5本の放射格子を持ちます。留め金・取手・蝶番は屋内側へ配置しています。開閉のアニメーションは持ちません。

## 色と素材

- `Painted timber`: `finishChannel=paint`、既定色 `#f4f1e9`、roughness 0.48。
- `Brass hardware`: `finishChannel=metal`、既定色 `#b69752`、roughness 0.28、metallic 0.76。
- `Limestone sill`: `#cec6b5`、roughness 0.85、finishChannel なし。
- `Glass`: `#dfe8ea`、alpha 0.25、`alphaMode=BLEND`、roughness 0.12、finishChannel なし。GLB の色因子は sRGB をリニアへ変換した値です。

1モデルは1メッシュ、4マテリアル。画像テクスチャを持ちません。UVは全三角形へ展開し、GLBの `TEXCOORD_0` も直接検査しています。

## 再生成と検査

リポジトリルートから実行します。Blender 5.1.2 を使用しました。

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" --background --factory-startup --python tools/blender/rpg_mansion/windows/build.py
"$BLENDER" --background --factory-startup --python tools/blender/rpg_mansion/windows/verify.py
"$BLENDER" --background --factory-startup --python tools/blender/rpg_mansion/windows/render.py
node tools/blender/rpg_mansion/windows/check-finishes.cjs
```

`build.py` は現行 `tools/blender/model_kit.py` の `run()` を通し、出力先だけこの窓用に指定します。既存アセットや manifest へ書きません。`authoring_sources/` は名前の付いた各部品を編集できる原本、`sources/` はUV展開・結合済みの出荷用原本です。検査は出荷用 blend からGLBを再出力して納品GLBとのバイト一致を確認し、さらに部品原本を結合して幾何一致と `run()`/GLB直接検査の再合格を確認します。

`render.py` は出荷GLBを読み込み、Cycles CPU 64 samplesで撮ります。thumb/topは512×512の背景透過PNG。屋外正面・屋内正面と幅/高さ120%/80%、80%/120%、130%/70%、70%/130%を記録します。奥行きは伸ばしません。固定格子を含むモデル全体の非等方伸縮なので、扇形は楕円形へ変化し、枠と金物の太さも一緒に変化します。確認画像の範囲で格子の欠落や破断がないことを目視レビューします。±30%を超える組合せや、壁への取り付け結果は未検査です。

各部材は閉じた多様体です。交差する木部や金物の接合箇所には意図的な内部重なりがあります。全体は閉じた部材を1メッシュへ結合したもので、Booleanで一体化した1殻ではありません。

## 記録

- `reports/asset-ledger.json`: 寸法、面数、部位、色、権利根拠、登録担当。
- `sources/*-validation.json`: `model_kit.run()` の実測結果。
- `reports/technical-validation.json`: GLB、UV、法線、閉じた部品、blend再生成とハッシュ。
- `reports/finish-validation.json`: 出荷GLBのextrasを既存 `applyFinishes()` に渡すCLI検査。
- `reports/render-bindings.json`: 各確認画像と元GLBのハッシュ・撮影条件・伸縮寸法。
- `reports/image-validation.json`: 全32画像のRGBA・寸法・透明背景・切れのない画角・伸縮実測・元GLBとの一致。
- `reports/visual-review.json`: 実画像レビュー。
- `reports/related-tests.txt`: 既存関連テスト49件の結果。
- `evidence/overview.png`: 4点の一覧画像。

ブラウザ操作、アプリでのGLTFLoader表示、壁開口へ差し込んだ本番表示、manifest登録後のUI/切り替え、モバイル端末での表示は**していません**。CLIによるGLB読み込み・レンダーと既存処理の検査を実施しています。アプリ組み込みはClaude側の後続作業です。

権利根拠はこの依頼で制作したオリジナル手続き形状です。第三者モデル、写真、画像テクスチャ、外部アセットは使用していません。

一覧・レビューシートと納品ZIPは Pillow がある Python で `package.py` を実行して生成します。画像の検査は同じ Python で `verify-images.py` を実行します。Mac の確認例:

```sh
/Users/nariiwa/.local/bin/python3 tools/blender/rpg_mansion/windows/verify-images.py
/Users/nariiwa/.local/bin/python3 tools/blender/rpg_mansion/windows/package.py
```

ZIPは相対パスを維持し、既存 `model_kit.py` / `shape_kit.py` / `exterior_build.py` と `assets/js/model-quality.js` の変更していないコピーを依存ファイルとして同梱します。ZIP内の `delivery-sha256.json` で全ファイルの内容を検証できます。
