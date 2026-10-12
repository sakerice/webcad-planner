# 日本古民家・第1弾の制作原本

32モデルと6種18枚のPBRテクスチャを、本リポジトリのために独自制作した素材納品。
納品モデル・テクスチャに外部モデル・写真・画像・書家の字は使用していない。掛け軸と扁額の墨線も生成スクリプトの独自形状。
任意の竹垣と松は含まない。アプリへの組み込みは実装担当が行う。

- `catalogue.json`: 指定IDの語幹・日本語名・実寸・分類とテクスチャの実寸
- `build.py`: 全モデルを制作し、共通 `model_kit.run()` で検査・UV展開・保存・GLB出力
- `sources/<id>.blend`: **32点すべての編集可能な原本**（単位m、Blender -Y正面、Z上）
- `sources/<id>-validation.json`: 実測寸法・原点・三角形数・UV密度・部位の検査結果
- `render.py`: 原本から透過512pxのサムネイル／上面と、512px JPEGの正面／背面を生成。建具7点は幅120%/高さ80%・幅80%/高さ120%も生成
- `textures.py`: 固定シードと周期関数から1024px PBR JPEG（品質85）を生成。高さはmmで計算しOpenGL法線へ変換
- `render_textures.py`: 納品PBRを実寸の2×2タイルへ適用してBlenderレンダリング
- `reexport.py`: 保存原本を独立ディレクトリへGLB再出力
- `verify.py`: GLBバッファの実寸・原点・三角形・UV・部位・ガラス、画像の寸法／透過／余白、JPEG継ぎ目を直接検査。再生成とのSHA-256一致も検査
- `review_sheets.py`: 実際の納品画像を少数の一覧にまとめる
- `delivery-validation.json`: 全点の納品記録と原本／画像／GLBのSHA-256
- `evidence/`: 必須の個別検証画像と最小限の確認一覧。別案や制作途中のチェックポイントは含まない

## 再制作と検査

リポジトリのルートで実行する。Blender 5.1.2で制作・検証した。Python側はnumpyとPillowが必要。
`python3` はこれらが入った環境を使う。制作時は既存の `/tmp/webcad-materials-venv/bin/python` を使用。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/blender/kominka/build.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/blender/kominka/render.py
python3 tools/blender/kominka/textures.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/blender/kominka/render_textures.py
python3 tools/blender/kominka/review_sheets.py
node --test tools/tests/asset-sets.test.cjs
python3 tools/blender/kominka/verify.py
```

納品原本を保護して再現性を確認する場合:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/blender/kominka/build.py -- --output-root /tmp/kominka-regenerated-20261012
python3 tools/blender/kominka/textures.py --output-root /tmp/kominka-regenerated-20261012
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/blender/kominka/reexport.py -- --output-dir /tmp/kominka-source-reexport-20261012
python3 tools/blender/kominka/verify.py --replay-root /tmp/kominka-regenerated-20261012 --source-root /tmp/kominka-source-reexport-20261012
```

`build.py` と `render.py` の `--only chair` のような指定で一部だけ再生成できる。
全点のmanifestを更新するときは `--only` を付けない。
原本に手で修正を加えた場合は、生成スクリプトにも変更を戻すか、スクリプト生成との一致が崩れることを記録する。
既存の本番IDの差し替えは行わない。

## 素材と座標の注意

モデルには画像テクスチャを使わず、形状・色・粗さ・金属度で表現する。
色変更部位は `materials[].extras.finishChannel` に出力される。色の部位内には煤けた木材の濃淡を含む。
ガラスのみ `Glass`、既定sRGB `#dfe8ea`、alpha 0.25、BLEND、色変更部位なし。
モデルはglTFでX=幅・Y=高さ・Z=奥行、正面+Z、底面中心原点。

焼杉の1080mm角は**180mmピッチで6枚の板**を並べ、継ぎ目へ幅30mmの目板を重ねたもの。
板180mmに目板30mmを加算する210mmピッチでは1080mm周期に入らないため、目板は重ねる解釈。
古い松の板は幅150〜240mm、9列計1800mm、長さ方向の継ぎ目は列ごとにずらしている。
茅の繊維はv方向（屋根上り方向）。法線の緑はOpenGL +Y。画像の行方向とvが逆であることを変換に反映。
JPEGは圧縮により端の同値が数階調ずれる。圧縮前は左右・上下で同値、圧縮後は端差の平均4/255未満を検査。

## 実施範囲

Blenderでの制作・原本再生成・原本からのGLB再書き出し・実画像の目視確認・GLB/画像のCLI検査を実施。
**ブラウザ検査はしていない**（Macのブラウザ操作禁止のため）。実行アプリ上での配置・色変更・±30%伸縮の操作はしていない。
指定の幅120%/高さ80%と幅80%/高さ120%はBlenderでレンダリングして確認。
アプリコード・swap/style・テクスチャ登録・既存のモデルや画像・main push・merge・deployは対象外。
本番の統合確認は実装担当の工程に残る。
