# Codex への依頼: Unity 由来の家具の置き換え 第1波1b（家具 15点）

依頼日: 2026-11-25 / 依頼者: Claude（webcad-planner の実装担当）
Issue Kanban の sourceId: `webcad-planner/fmp-replace-1b-2026-11-25`

## 何に使うか

webcad-planner（住宅の間取り・3Dプランナー、本番 https://cad-planner.srapps.us ）の家具カタログには、Unity Asset Store の
「Furniture Mega Pack」から取り込んだ 445 点（品番 `fmp-…`、置き場 `assets/models/furniture_mega/`）がある。
運営者は 2026-11-25 に、これを**近い形のオリジナルで作り直して置き換える**と決めた。この依頼はその第1波で、
アプリのコードと既定プランが名指ししている 41 点のうち、家具の 15 点（テーブル 7・椅子 2・ベッド 2・ソファ 2・収納 1・引き出し 1）を作る。
もう1通（第1波1a、住設 26 点）は別の依頼で、別の Codex が同時に進めることがある。

置き換え方は「**品番はそのまま残し、品番が指す GLB だけをオリジナルに替える**」。利用者の保存プランは品番（例 `fmp-Sofa01`）と
置き場所・幅・奥行・向きを持ち、高さは持たない。画面はモデルのバウンディングボックスを、保存プランの幅・奥行と manifest の高さの箱に
合わせて伸縮して描く。だから新しいモデルは、**外形寸法・正面の向き・接地・天面の高さを元に合わせることが最優先**。
ずれると、利用者のプランで形が歪む、向きが逆になる、上に載せた物が浮く・めり込む。意匠は元に「ほぼ近い」でよい。

manifest の付け替え（品番が新しい GLB を指すようにする）、`finishes.json` と検査の一覧の更新、`MODEL_ASSET_VER` の更新、
元の GLB と画像の削除は Claude が行う。**この依頼では、モデルを作って納めるところまで。**

## ブランチと PR の切り方（必ず守る）

```sh
git fetch origin
git switch -c codex/fmp-replace-1b-20261125 origin/main
```

- **必ず最新の `origin/main` から切る。** 他の枝（`claude/*`、`codex/*`、第1波1aの枝）を土台にしない
- PR の宛先（base）は **`main`**。下書き（Draft）で作り、全部そろったら `origin/main` に追従してから下書きを外す
- `main` には push しない。マージ・デプロイもしない（main への反映は本番の公開になるので、人が許可してから Claude が行う）
- 第1波1bと第1波1aは**別の枝・別の PR**。この波の直しも同じ枝・同じ PR に積む
- この依頼書ファイルは枝に足さない。納品メモは PR の本文に書く

## 触ってよい場所・触らない場所

触ってよい（**新しいファイルを足すだけ**。既存のファイルは変えない）:
- `assets/models/original/` … 新しい GLB（下の表の「新しい GLB」）
- `assets/models/previews-v2/` … 新しい ID の `<id>-thumb.png`・`<id>-top.png`（`run()` がここへ書く）。`fmp-*` の画像は変えない・消さない
- `tools/blender/work/original/` … 編集できる原本 `<id>.blend` と、`run()` が書く `<id>-validation.json`・`<id>-rear.png`
- `tools/blender/build_fmp_replace_1b.py` … 作るスクリプト（1本、または品の系統ごとに数本。名前は `build_fmp_replace_1b_*.py`）
- `tools/blender/fmp-replace/1b/` … 比較画像・寸法の表・登録用の一覧 JSON

触らない: アプリのコード（`index.html`・`assets/js/`・`assets/*.css`・`worker/`）、既存の manifest（`assets/models/furniture_mega/manifest.json`・
`assets/models/custom/manifest.json`・`manifest.js`）、`assets/models/finishes.json`、`tools/tests/`、`reference-textures/`、`.dev.vars`、
既定プラン（`tools/default-plans/` と、それが書き出すプラン）、既存のモデル・画像。
途中経過のファイル（別案、チェックポイント、大量の検証画像）はリポジトリに入れない（以前 500MB を超えて push が失敗した）。

古民家・洋館の依頼では Codex が manifest に行を足して登録まで行ったが、**今回は登録しない。**
`tools/blender/README.md` の「登録」の手順（collection.json・`register_original_collection.py`・`tag_catalogue.mjs`）も走らせない。
代わりに、登録用の一覧 JSON を納める（「納めるもの」の 6）。古い品番の行を書き換えると利用者の保存プランの描画が変わるので、
付け替えは Claude が検査と一緒に行う。

## 権利の決まり（必ず守る）

- 元の縮小画像と平面図の画像（表の「元の画像」）は、形・大きさ・色味の**参考として見るだけ**
- **元の GLB は開かない・読み込まない。** `assets/models/furniture_mega/glb/` と `assets/models/unity_exported/` のファイルを Blender にも
  スクリプトにも入れない（寸法を測るためでも開かない。寸法は表の値を使う）
- 元のメッシュ・UV・テクスチャを写さない、なぞらない、間引かない、張り直さない、ボクセル化しない。画像を下絵に敷いてなぞるのもしない
- **Blender の基本形（箱・円柱・押し出し・`model_kit` の部品）から新しく組む**
- 意匠は「ほぼ近い」でよく、同一にしなくてよい。細部（取っ手の形、木目、縫い目）は似せなくてよい。迷ったら、日本の住宅でよく見る一般的な形に寄せる
- 外部の素材（写真・ストックモデル・生成 AI の 3D）は使わない

## 作り方の決まり（標準の仕様）

`tools/blender/README.md` の「カタログのモデルを作るときの約束」と落とし穴（5つ）を先に読む。

1. `tools/blender/model_kit.py` の `run()` を通す。1点ずつ `(ID, (w, d, h), 組み立て関数, 部位, 3000)` を渡す。部位は表の「色の部位」の集合（なしは `None`）
2. 単位はメートル。Blender は Z-up で組み、`export_yup=True` で書き出す（`run()` の書き出しのまま）
3. 原点は接地面の中心。正面は **Blender の -Y**（glTF の +Z）。表の「正面」の面を -Y へ向ける
4. バウンディングボックスを表の w/d/h に `normalize_to()` でぴたりと合わせる。`run()` は 1mm を超える差で止まる。どこかの部品で X・Y・Z の両端が箱に届くように組む
5. 単一のメッシュへ join。画像テクスチャは使わず、色・粗さ・金属度だけ。マテリアル名は英語
6. 色を変えられる部位はマテリアルの `finishChannel` で示す。**名前は表の「色の部位」と同じにする**（利用者が保存した色は部位の名前で効くため）
7. UV は `unwrap()` で展開してから書き出す（`run()` が行う）。`tools/tests/model-uv.test.cjs` の `UNWRAPPED` への追加は Claude が登録のときに行う
8. 三角形は1点 3,000 以内。角の R は削らない
9. 編集できる原本 `tools/blender/work/original/<id>.blend` を残す
10. 縮小画像（斜め上・512 透過）と平面図の画像（真上・512 透過）を、新しいモデルから `run()` で描く

**今回は、実寸の範囲（`tools/catalogue-vocab.mjs` の `REAL_SIZE`）へ寸法を直すことはしない。** 外形は表の値（元の manifest の値）のまま作る。
manifest の高さを変えると、利用者の保存プランでその家具の高さが変わり、上に載せた物が浮く・めり込むため。寸法が不自然に見える品も直さない
（標準の寸法の品は、Claude が別の新しい品番で足す）。

## 見た目を元に合わせる条件

- 外形: 表の w/d/h と ±1% 以内（`run()` は 1mm で止まるので、通れば満たす）
- 接地: 底が Z=0。脚・台輪の位置と太さを元に近づける（脚の位置が変わると、周りとの取り合いが変わって見える）
- 正面: 元の縮小画像で手前（左下）に見えている面が正面。元の平面図の画像では下の辺が正面。新しい縮小画像で、左右・前後が元と合っている
- 輪郭: 真上から見た外形（角の丸み、脚の出、張り出し）を元に近づける
- 色: 元の主な色の明るさと色味に近づける。部位の名前は表のとおり
- 天面: 表の「天面」が「要」の品は、**天板の上面を最上面（= h）にする。** 天板より上に物（蛇口、飾り、背板の立ち上がり）を足さない。足すと `normalize_to()` で天板が下がり、上に載せた物がめり込む

## 一覧（15点）

元の画像は `assets/models/previews-v2/` の中のファイル。新しい ID は `original-fmp-` に元の名前を小文字にして付けた物（`_` は `-` に替えた）。
既存の `assets/models/custom/manifest.json` の ID とも、`assets/models/original/` のファイルとも重ならないことを確かめてある。

| 古い品番 | 名前・形の要点 | w×d×h (mm) | 正面 | 天面 | 色の部位 | 元の画像（`assets/models/previews-v2/` の） | 新しい ID | 新しい GLB |
|---|---|---|---|---|---|---|---|---|
| `fmp-Table01` | 食卓（赤茶の木、角脚4本） | 1042×643×630 | 長い辺 | 要 | `body` | `fmp-Table01-thumb.png`・`fmp-Table01-top.png` | `original-fmp-table01` | `assets/models/original/original-fmp-table01.glb` |
| `fmp-Table31` | 細長いコンソール（木の天板、黒い角パイプの脚枠） | 1690×474×905 | 長い辺 | 要 | `body` | `fmp-Table31-thumb.png`・`fmp-Table31-top.png` | `original-fmp-table31` | `assets/models/original/original-fmp-table31.glb` |
| `fmp-Table33` | ローテーブル（明るい木、下に棚板） | 988×656×378 | 長い辺 | 要 | `body` | `fmp-Table33-thumb.png`・`fmp-Table33-top.png` | `original-fmp-table33` | `assets/models/original/original-fmp-table33.glb` |
| `fmp-Table34` | 箱形の座卓・ローテーブル（白っぽい木、下に開いた区画2つ） | 1250×625×320 | 開いた区画の面 | 要 | `body` | `fmp-Table34-thumb.png`・`fmp-Table34-top.png` | `original-fmp-table34` | `assets/models/original/original-fmp-table34.glb` |
| `fmp-Table36` | 丸いコーヒーテーブル（木の天板、黒い鉄の輪の脚） | 633×635×357 | どこでもよい（円形） | 要 | `body` | `fmp-Table36-thumb.png`・`fmp-Table36-top.png` | `original-fmp-table36` | `assets/models/original/original-fmp-table36.glb` |
| `fmp-Table37` | 角のサイドテーブル（白い大理石調の天板、黒い角パイプの枠） | 304×304×384 | どこでもよい（四方対称） | 要 | `body` | `fmp-Table37-thumb.png`・`fmp-Table37-top.png` | `original-fmp-table37` | `assets/models/original/original-fmp-table37.glb` |
| `fmp-Table44` | 白い机（薄い天板、両端に T 字の脚） | 1049×524×626 | 長い辺（座る側） | 要 | `body` | `fmp-Table44-thumb.png`・`fmp-Table44-top.png` | `original-fmp-table44` | `assets/models/original/original-fmp-table44.glb` |
| `fmp-Chair01` | 木の食卓椅子（茶、縦桟の背、板座） | 351×411×759 | 座面の前 | 不要 | `body` | `fmp-Chair01-thumb.png`・`fmp-Chair01-top.png` | `original-fmp-chair01` | `assets/models/original/original-fmp-chair01.glb` |
| `fmp-Chair29` | 成形座の椅子（灰色の座と背の一体シェル、黒い細い脚4本） | 430×442×775 | 座面の前 | 不要 | `body` | `fmp-Chair29-thumb.png`・`fmp-Chair29-top.png` | `original-fmp-chair29` | `assets/models/original/original-fmp-chair29.glb` |
| `fmp-Bed01` | シングルベッド（白木の縦桟のヘッド・フット、橙の掛け布団） | 1050×1950×882 | 足元側 | 不要 | `fabric`・`wood` | `fmp-Bed01-thumb.png`・`fmp-Bed01-top.png` | `original-fmp-bed01` | `assets/models/original/original-fmp-bed01.glb` |
| `fmp-Bed05` | シングルベッド（茶の木枠、板のヘッド、橙の掛け布団） | 1112×1950×882 | 足元側 | 不要 | `fabric`・`wood` | `fmp-Bed05-thumb.png`・`fmp-Bed05-top.png` | `original-fmp-bed05` | `assets/models/original/original-fmp-bed05.glb` |
| `fmp-Sofa01` | 3人掛けソファ（ベージュの布、背クッション3つ、黒い細脚） | 1867×770×731 | 座面の前 | 不要 | `body` | `fmp-Sofa01-thumb.png`・`fmp-Sofa01-top.png` | `original-fmp-sofa01` | `assets/models/original/original-fmp-sofa01.glb` |
| `fmp-Sofa02` | 1人掛けソファ（Sofa01 と同じ意匠） | 699×770×731 | 座面の前 | 不要 | `body` | `fmp-Sofa02-thumb.png`・`fmp-Sofa02-top.png` | `original-fmp-sofa02` | `assets/models/original/original-fmp-sofa02.glb` |
| `fmp-Closet01` | 扉のない棚（生成り、左に大きい区画、右に小さい棚板） | 1523×773×2213 | 棚の開いた面 | 不要 | `body` | `fmp-Closet01-thumb.png`・`fmp-Closet01-top.png` | `original-fmp-closet01` | `assets/models/original/original-fmp-closet01.glb` |
| `fmp-Drawer01` | 引き出し3段のチェスト（明るい木、橙の横長つまみ） | 460×658×577 | 引き出しの面 | 要 | `body` | `fmp-Drawer01-thumb.png`・`fmp-Drawer01-top.png` | `original-fmp-drawer01` | `assets/models/original/original-fmp-drawer01.glb` |

色の部位 `body` は、元の割り当てで「部位を分けない」の意味。新しいモデルでは、元で一番広く見えている色の部分（扉と側板、張地、本体）に
`body` を付け、取っ手・脚・蛇口・五徳のような小物には付けない。

## この波で気をつける点

- `Table01`（高さ 630mm）と `Table44`（626mm）は、食卓や机としては低い。それでも今回は**表の高さのまま作る**（直すと保存プランの高さが変わる）
- ベッド2点は部位が2つ（`wood` と `fabric`）。枠・ヘッド・フットに `wood`、マットレス・掛け布団・枕に `fabric` を付ける
- 椅子・ソファの細い脚、`Table31`・`Table37` の角パイプは、`add_tube()` の12角形で寸法の端を決めない（落とし穴3）。端は天板・座・枠の箱で決める
- `Table36` は 633×635 のほぼ円形。天板を楕円にして w と d の両端へ届かせる（真円のまま `normalize_to()` に渡すと片方の軸が届かない。落とし穴1）
- `Sofa01` と `Sofa02` は同じ意匠の3人掛けと1人掛け。肘・脚・クッションの厚みをそろえる
- `Closet01` は扉の無い棚。棚の奥に背板を付けて、裏から見ても穴が開いていないようにする
- `Drawer01`・`Table33`・`Table34` は、下段の棚板や引き出しが見える。正面の向きを元の平面図の画像（取っ手・開いた面が下の辺）で確かめる

## 完了条件

- 表の全点の GLB・`.blend`・縮小画像・平面図の画像がそろい、全点が `run()` を通っている
- 外形の差の表: 品ごとに、表の w/d/h と、GLB の頂点から測った w/d/h（mm、小数1桁）と差（%）。全点 ±1% 以内。
  **Blender の `obj.dimensions` ではなく、書き出した GLB を読み直して頂点から測る**
- 三角形の数: 品ごとに書く。3,000 を超えた品は理由を書く
- 原点と正面: 品ごとに、底面の中心が原点（X・Y の中心のずれ、Z の最小値）、正面が +Z（`render_thumb()` の縮小画像に正面が写っている）
- 天面: 「要」の品は、天板の上面の高さを頂点から測って書く（h と同じであること）
- 比較画像: 品ごとに1枚。左に元、右に新しい物。上の段に縮小画像、下の段に平面図の画像（1024×1024 の JPEG、品質 85 前後）。
  `tools/blender/fmp-replace/1b/compare/<新しい ID>.jpg`。新しい縮小画像は `render_thumb()` のカメラのまま描く（元に合わせてカメラを変えない）
- `sh tools/run_tests.sh` の結果（`exit=0` か、落ちた検査の名前と、この依頼の変更と関係があるか）。
  新しいモデルは manifest に入らないので、`model-uv`・`original-models` はまだ新しい品を見ない。上の表が主な検査になる

## 納めるもの

1. GLB: 表の「新しい GLB」
2. `.blend`: `tools/blender/work/original/<新しい ID>.blend`
3. 作るスクリプト: `tools/blender/build_fmp_replace_1b*.py`（このスクリプトを流せば全点を作り直せること）
4. 縮小画像と平面図の画像: `assets/models/previews-v2/<新しい ID>-thumb.png`・`-top.png`
5. 比較画像: `tools/blender/fmp-replace/1b/compare/<新しい ID>.jpg`
6. 登録用の一覧 JSON: `tools/blender/fmp-replace/1b/replacements.json`。品ごとに次の欄を持つ配列

```json
[{"fmpId": "fmp-Table01", "newId": "original-fmp-table01", "model": "assets/models/original/original-fmp-table01.glb",
  "thumb": "assets/models/previews-v2/original-fmp-table01-thumb.png", "top": "assets/models/previews-v2/original-fmp-table01-top.png",
  "w": 1042, "d": 643, "h": 630, "triangles": 0, "finishChannels": ["body"]}]
```

`w`・`d`・`h` は GLB の頂点から測った値（mm、整数に丸める）、`finishChannels` は GLB に入っている `finishChannel` の名前の一覧。
7. 外形の差の表と検査の記録: `tools/blender/fmp-replace/1b/checks.md`

## 納品メモ（PR の本文に書く）

- 品ごとの検査の結果（外形の差、三角形の数、原点と正面、天面の高さ、部位の名前）。表で書いてよい
- 元と形を変えた所と、その理由（例: 元の細い装飾を省いた、取っ手を一般的な形にした）
- 迷って決めた点（正面がどちらか分かりにくかった品など）
- `sh tools/run_tests.sh` の結果
- 作り直し方（流すコマンド）
- **実施していない検査は「していない」と書く**
