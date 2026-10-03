# 独立レビューの幾何不具合修正

e81704f を保存した後続修正。モデル追加は行わず50点を維持する。旧14点のmanifest定義およびGLB/Blender/前後上面画像/validationの84ファイルはバイト単位で不変。

共通生成コード `tools/blender/rpg_mansion/expansion/build.py` を修正した。

- 流し台・洗面台・浴槽：浮いていたcross handleを、連続したmanifoldと2本のvalve stemで主軸へ接続。
- 円形食卓：支柱を天板下面まで延長し、約10mmの空隙を解消。
- 食器棚：皿・瓶の底面を棚上面に合わせる。
- キャビネット：carcassの上端をcap下面まで延長し、5mmの空隙を解消。
- panelを使う13モデル：4本の交差レールを単一の閉じたフレームへ変更。角の同位置・同面積trianglesをなくし、法線を再計算。
- 鉢植え：9枚の閉じた葉の面順序を反転し外向きへ修正。

再生成は17点：round-table, console, secretary, single-bed, canopy-bed, nightstand, wardrobe, dresser, linen-cabinet, kitchen-hutch, butler-sink, range, icebox, bathtub, washstand, planter, fireplace。ID、寸法、向き、材質チャンネルを変更しない。他19追加モデルは不変。model/source/thumbnail/top/rear/validationを同期した。

検証：Blender `expansion/check_connections.py` で部品を結合する前のhandle→stem→manifold→uprightの交差、天板/棚/キャビネットの支持面、葉のsigned volumeを検査。これはsource空間の接続検査で、全モデル全接続の自動保証ではない。`test_pack.py` は配布GLBの全追加36モデルをまたいでcoplanar重複triangleが0、法線とface winding整合、鉢植えの9個のleaf solidが正体積であることを別途確認。50モデルのUV、材質、寸法、接地、画像非欠落も確認。

実ブラウザ50点の正面/背面ギャラリーを再撮影し、修正箇所を視認した。GLB計2,634,484bytes、68,402triangles（修正前69,542）。固定カメラ画像とログは `tools/assets/rpg-pack-contract/expansion-evidence/`。

再現：

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/expansion/build.py -- --no-icons --only round-table,console,secretary,single-bed,canopy-bed,nightstand,wardrobe,dresser,linen-cabinet,kitchen-hutch,butler-sink,range,icebox,bathtub,washstand,planter,fireplace
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/previews.py -- --only round-table,console,secretary,single-bed,canopy-bed,nightstand,wardrobe,dresser,linen-cabinet,kitchen-hutch,butler-sink,range,icebox,bathtub,washstand,planter,fireplace
blender -b -t 2 --factory-startup --python tools/blender/rpg_mansion/expansion/check_connections.py
python3 tools/blender/rpg_mansion/test_pack.py
node tools/blender/rpg_mansion/expansion/browser_qa.cjs
```

## 追加レビュー：小ノブの接続

3f2d968を保持して追加修正。共通 `knob()` の頭部位置を変えず、細い取付軸を本体方向へ延長した。寝椅子だけは共通のボタン高さが低い背もたれ上端を超えていたため、背もたれの面内へ下げた。

13点を再生成：wing-chair, sofa, chaise, console, secretary, nightstand, wardrobe, dresser, linen-cabinet, kitchen-hutch, butler-sink, icebox, toilet。接続回帰は全13点の全ノブで頭部→軸→非金物の本体が交差することを確認する（従来8項目と合計21）。寝椅子の旧位置ではこの回帰が失敗し、修正後に通ることも確認した。証拠に配布GLB SHA256を紐付けた。

50点計78,014triangles／2,927,852bytes、最大5,092triangles/モデル。追加36点の重複triangleは引き続きゼロ。旧14点の84ファイルと全manifest item定義は不変。再生成画像と実ブラウザの前後面を確認した。

## 最終小隙間3種

レンジの取手は両端の取付軸で扉面へ接続。カーテンの留め帯は前端を維持し、裏側の厚みを増やして布のfoldへ接続。暖炉の薪2本は10mm下げて炉床に接地させた。ID・manifest寸法・材質は不変。接続検査は24項目となり、追加3種はmesh表面の交差を確認した（隙間0）。旧14点と他47モデルは未変更。
