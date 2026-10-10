# 洋館用クラシックセダン 1 台

`rpg-mansion-classic-sedan-01` は、洋館の敷地に駐車するための架空の
1930 年代風セダンです。暗緑色の長いボンネット、縦グリル、独立した丸い
ヘッドライト、張り出した 4 枚のフェンダー、4 輪、二分割の前窓、2 列の
革張りベンチ、木製ダッシュボードとハンドルを独自の曲面から制作しました。
実在メーカーのロゴ・車名・図面・外部モデル・画像テクスチャは使っていません。

新規素材だけのレビュー用納品です。既存カタログへの登録・manifest・asset-sets・
アプリの変更は含みません。既存の配置データや既存素材を差し替えません。

| 検査項目 | 結果 |
| --- | --- |
| 実測寸法（全長 × 全幅 × 全高） | 4,599.29 × 1,750.00 × 1,649.99995 mm |
| 三角形 | 11,508 / 12,000（余裕 492） |
| GLB | 493,856 bytes、1 mesh / 10 material primitives |
| 座標・原点 | m、GLB +Z 正面 / +Y 上、接地面の中心 |
| メッシュ | 閉じた部品の結合、非多様体の辺 0、実面積の潰れ 0 |
| UV | 1 層、11,508 三角形すべて有効、潰れ・欠損・非有限値 0 |
| UV 密度 p95/p05 | 約 1.189（規約の 2 未満） |
| 色変更 | `finishChannel=body`、初期色 `#28493c` |
| 材質保持 | アプリの `ModelQuality.applyFinishes` で車体の色・粗さだけ変更、他の 9 材質は保持 |
| 512px アイコン | RGBA thumb/top、透過あり、端への切れ 0 |
| 向きの検査 | GLB のライトは +Z、テールライトは -Z 側に存在 |
| 保存原本からの書き出し | 形状・材質・UV・GLB の SHA-256 が完全一致 |
| コードからの再生成 | 形状・材質・面数は一致、再計算した UV も全三角形有効 |

再生成時の UV 島の配置には微小な変動があります。出荷済みと同一の UV 配置や
GLB のバイト列が必要な場合は、保存済みの書き出し用 `.blend` を開いて
`reexport_source.py` で出力してください。

## 納品ファイル

- `assets/models/packs/rpg-mansion/models/rpg-mansion-classic-sedan-01.glb`
- `assets/models/packs/rpg-mansion/previews/rpg-mansion-classic-sedan-01-{thumb,top}.png`
- このフォルダの `rpg-mansion-classic-sedan-01.blend`：UV 検査済みの単一メッシュ原本。
- `rpg-mansion-classic-sedan-01-authoring.blend`：命名された部品を個別に編集できる制作原本。
- `build.py`、`render.py`、`reexport_source.py`：再生成・レンダー・原本書き出しコード。
- `asset-record.json`：独立した新規素材の寸法・部位・権利・納品台帳。カタログ manifest ではありません。
- `rpg-mansion-classic-sedan-01-validation.json`：変更していない `model_kit.run()` の検査。
- `checks.json`、`source-checks.json`、`three-checks.json`、`render-record.json`：実データ検査記録。
- `evidence/*-{front,side,rear}.png`：最終 GLB を Blender に読み戻した確認画像。
- `overview.png`：一覧画像。`make_delivery.py` で素材 ZIP とともに再作成可能。

GLB では車体とホイールの塗装を `body` 部位として変更できます。タイヤ、ガラス、
メッキ、レンズ、革、木部などは初期材質を保持します。ガラスは glTF の
`alphaMode=BLEND` です。発光・アニメーション・車輪の回転・ドア開閉・衝突判定は
持たない静的な配置素材です。

## 再生成と検査

制作確認環境は Mac ローカル、Blender 5.1.2 / Cycles CPU、Node 25.6.1、
Python 3 + NumPy + Pillow です。GUI や Blender MCP は不要です。
リポジトリのルートから実行します。Mac の sandbox では Blender の Metal 検出時に
起動が終了するため、制作時は許可された headless 実行を用いました。

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" -b -t 4 --factory-startup --python tools/blender/rpg_mansion/classic_car/build.py

# 形状だけのクリーン再生成。既存納品を上書きしない出力先を指定。
WEBCAD_CAR_OUTPUT_ROOT=/tmp/webcad-classic-car-replay \
  "$BLENDER" -b -t 4 --factory-startup \
  --python tools/blender/rpg_mansion/classic_car/build.py -- --no-icons

"$BLENDER" -b -t 4 --factory-startup \
  --python tools/blender/rpg_mansion/classic_car/reexport_source.py

python3 tools/blender/rpg_mansion/classic_car/verify.py \
  --compare /tmp/webcad-classic-car-replay \
  --compare-source /tmp/webcad-classic-car-source-reexport

node --experimental-loader ./tools/blender/rpg_mansion/classic_car/three-loader.mjs \
  tools/blender/rpg_mansion/classic_car/verify_three.mjs
python3 tools/blender/rpg_mansion/classic_car/make_delivery.py
```

`build.py` は既存の `model_kit.run()` を通します。共通 helper は変更せず、
この 1 台の出力ディレクトリだけを新規納品先へ切り替えます。ZIP には必要な
共通 Blender helper と CLI 検査の依存ファイルも同じ相対パスで同梱します。

ブラウザ操作は禁止のため、Chrome/Edge・WebGL 描画・エディタ内の配置確認は
実施していません。確認画像は Blender の GLB 読み戻しレンダーです。
Node CLI のローダー・部位変更の成功を、ブラウザ描画の成功とは扱いません。
main 更新・マージ・手動デプロイはこの納品範囲に含みません。
