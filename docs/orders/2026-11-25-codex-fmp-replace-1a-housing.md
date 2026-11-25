# Codex への依頼: Unity 由来の家具の置き換え 第1波1a（住設 26点）

依頼日: 2026-11-25 / 依頼者: Claude（webcad-planner の実装担当）
Issue Kanban の sourceId: `webcad-planner/fmp-replace-1a-2026-11-25`

## 何に使うか

webcad-planner（住宅の間取り・3Dプランナー、本番 https://cad-planner.srapps.us ）の家具カタログには、Unity Asset Store の
「Furniture Mega Pack」から取り込んだ 445 点（品番 `fmp-…`、置き場 `assets/models/furniture_mega/`）がある。
運営者は 2026-11-25 に、これを**近い形のオリジナルで作り直して置き換える**と決めた。この依頼はその第1波で、
アプリのコードと既定プランが名指ししている 41 点のうち、住設の 26 点（キッチン 18 点・浴室 8 点）を作る。
もう1通（第1波1b、家具 15 点）は別の依頼で、別の Codex が同時に進めることがある。

置き換え方は「**品番はそのまま残し、品番が指す GLB だけをオリジナルに替える**」。利用者の保存プランは品番（例 `fmp-Sofa01`）と
置き場所・幅・奥行・向きを持ち、高さは持たない。画面はモデルのバウンディングボックスを、保存プランの幅・奥行と manifest の高さの箱に
合わせて伸縮して描く。だから新しいモデルは、**外形寸法・正面の向き・接地・天面の高さを元に合わせることが最優先**。
ずれると、利用者のプランで形が歪む、向きが逆になる、上に載せた物が浮く・めり込む。意匠は元に「ほぼ近い」でよい。

manifest の付け替え（品番が新しい GLB を指すようにする）、`finishes.json` と検査の一覧の更新、`MODEL_ASSET_VER` の更新、
元の GLB と画像の削除は Claude が行う。**この依頼では、モデルを作って納めるところまで。**

## ブランチと PR の切り方（必ず守る）

```sh
git fetch origin
git switch -c codex/fmp-replace-1a-20261125 origin/main
```

- **必ず最新の `origin/main` から切る。** 他の枝（`claude/*`、`codex/*`、第1波1bの枝）を土台にしない
- PR の宛先（base）は **`main`**。下書き（Draft）で作り、全部そろったら `origin/main` に追従してから下書きを外す
- `main` には push しない。マージ・デプロイもしない（main への反映は本番の公開になるので、人が許可してから Claude が行う）
- 第1波1aと第1波1bは**別の枝・別の PR**。この波の直しも同じ枝・同じ PR に積む
- この依頼書ファイルは枝に足さない。納品メモは PR の本文に書く

## 触ってよい場所・触らない場所

触ってよい（**新しいファイルを足すだけ**。既存のファイルは変えない）:
- `assets/models/original/` … 新しい GLB（下の表の「新しい GLB」）
- `assets/models/previews-v2/` … 新しい ID の `<id>-thumb.png`・`<id>-top.png`（`run()` がここへ書く）。`fmp-*` の画像は変えない・消さない
- `tools/blender/work/original/` … 編集できる原本 `<id>.blend` と、`run()` が書く `<id>-validation.json`・`<id>-rear.png`
- `tools/blender/build_fmp_replace_1a.py` … 作るスクリプト（1本、または品の系統ごとに数本。名前は `build_fmp_replace_1a_*.py`）
- `tools/blender/fmp-replace/1a/` … 比較画像・寸法の表・登録用の一覧 JSON

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

## 一覧（26点）

元の画像は `assets/models/previews-v2/` の中のファイル。新しい ID は `original-fmp-` に元の名前を小文字にして付けた物（`_` は `-` に替えた）。
既存の `assets/models/custom/manifest.json` の ID とも、`assets/models/original/` のファイルとも重ならないことを確かめてある。

| 古い品番 | 名前・形の要点 | w×d×h (mm) | 正面 | 天面 | 色の部位 | 元の画像（`assets/models/previews-v2/` の） | 新しい ID | 新しい GLB |
|---|---|---|---|---|---|---|---|---|
| `fmp-CabinetA01` | キッチン下台・片開き（紺の框扉、白い天板、金の縦取っ手） | 366×522×797 | 扉の面 | 要 | `body` | `fmp-CabinetA01-thumb.png`・`fmp-CabinetA01-top.png` | `original-fmp-cabineta01` | `assets/models/original/original-fmp-cabineta01.glb` |
| `fmp-CabinetA_Sink` | キッチン下台・シンク（紺の両開き扉、白い天板に角形のシンク） | 732×522×797 | 扉の面 | 要 | `body` | `fmp-CabinetA_Sink-thumb.png`・`fmp-CabinetA_Sink-top.png` | `original-fmp-cabineta-sink` | `assets/models/original/original-fmp-cabineta-sink.glb` |
| `fmp-CabinetD01` | キッチン下台・片開き（黒の扉、白い天板、銀の縦取っ手、台輪） | 366×519×797 | 扉の面 | 要 | `body` | `fmp-CabinetD01-thumb.png`・`fmp-CabinetD01-top.png` | `original-fmp-cabinetd01` | `assets/models/original/original-fmp-cabinetd01.glb` |
| `fmp-CabinetD02` | キッチン下台・片開き（D01 の扉の吊り元が逆） | 366×519×797 | 扉の面 | 要 | `body` | `fmp-CabinetD02-thumb.png`・`fmp-CabinetD02-top.png` | `original-fmp-cabinetd02` | `assets/models/original/original-fmp-cabinetd02.glb` |
| `fmp-CabinetD03` | キッチン下台・引き出し3段（黒、白い天板、銀の横取っ手） | 364×519×797 | 引き出しの面 | 要 | `body` | `fmp-CabinetD03-thumb.png`・`fmp-CabinetD03-top.png` | `original-fmp-cabinetd03` | `assets/models/original/original-fmp-cabinetd03.glb` |
| `fmp-CabinetD_Sink` | キッチン下台・シンク（黒の両開き扉、白い天板に角形のシンク） | 732×519×797 | 扉の面 | 要 | `body` | `fmp-CabinetD_Sink-thumb.png`・`fmp-CabinetD_Sink-top.png` | `original-fmp-cabinetd-sink` | `assets/models/original/original-fmp-cabinetd-sink.glb` |
| `fmp-GasStove01` | 2口のガスコンロ（黒い天板、五徳2つ、前につまみ2つ） | 513×287×113 | つまみの面 | 不要 | `body` | `fmp-GasStove01-thumb.png`・`fmp-GasStove01-top.png` | `original-fmp-gasstove01` | `assets/models/original/original-fmp-gasstove01.glb` |
| `fmp-GasStove07` | 4口のガラストップコンロ（黒、薄い板状、五徳4つ） | 572×507×52 | つまみの面 | 不要 | `body` | `fmp-GasStove07-thumb.png`・`fmp-GasStove07-top.png` | `original-fmp-gasstove07` | `assets/models/original/original-fmp-gasstove07.glb` |
| `fmp-KitchenExhaust01` | 壁付けのレンジフード（灰色、台形のフードに角形の煙突） | 482×334×403 | フードの斜面の側 | 不要 | `body` | `fmp-KitchenExhaust01-thumb.png`・`fmp-KitchenExhaust01-top.png` | `original-fmp-kitchenexhaust01` | `assets/models/original/original-fmp-kitchenexhaust01.glb` |
| `fmp-KitchenExhaust07` | レンジフード（灰色、薄い角形のフードに角形の煙突） | 466×466×430 | どれか1面（四方対称） | 不要 | `body` | `fmp-KitchenExhaust07-thumb.png`・`fmp-KitchenExhaust07-top.png` | `original-fmp-kitchenexhaust07` | `assets/models/original/original-fmp-kitchenexhaust07.glb` |
| `fmp-KitchenOven01` | ビルトインのオーブン（灰色、黒いガラス窓、上につまみ2つ） | 529×378×607 | ガラス窓の面 | 不要 | `glass`・`metal` | `fmp-KitchenOven01-thumb.png`・`fmp-KitchenOven01-top.png` | `original-fmp-kitchenoven01` | `assets/models/original/original-fmp-kitchenoven01.glb` |
| `fmp-Refrigerator01` | 冷蔵庫・2ドア（白、上下の扉、縦の取っ手） | 706×749×1514 | 扉の面 | 不要 | `body` | `fmp-Refrigerator01-thumb.png`・`fmp-Refrigerator01-top.png` | `original-fmp-refrigerator01` | `assets/models/original/original-fmp-refrigerator01.glb` |
| `fmp-Refrigerator02` | 冷蔵庫・2ドア（白、上の扉が小さい） | 640×695×1499 | 扉の面 | 不要 | `body` | `fmp-Refrigerator02-thumb.png`・`fmp-Refrigerator02-top.png` | `original-fmp-refrigerator02` | `assets/models/original/original-fmp-refrigerator02.glb` |
| `fmp-Refrigerator03` | 冷蔵庫・両開き（グレージュ、左右の扉） | 808×808×1612 | 扉の面 | 不要 | `body` | `fmp-Refrigerator03-thumb.png`・`fmp-Refrigerator03-top.png` | `original-fmp-refrigerator03` | `assets/models/original/original-fmp-refrigerator03.glb` |
| `fmp-Refrigerator04` | 冷蔵庫・観音開き＋下に引き出し2段（白） | 808×808×1612 | 扉の面 | 不要 | `body` | `fmp-Refrigerator04-thumb.png`・`fmp-Refrigerator04-top.png` | `original-fmp-refrigerator04` | `assets/models/original/original-fmp-refrigerator04.glb` |
| `fmp-Refrigerator05` | 冷蔵庫・両開き（ベージュ、弓形の取っ手） | 808×863×1612 | 扉の面 | 不要 | `body` | `fmp-Refrigerator05-thumb.png`・`fmp-Refrigerator05-top.png` | `original-fmp-refrigerator05` | `assets/models/original/original-fmp-refrigerator05.glb` |
| `fmp-Refrigerator06` | 冷蔵庫・観音開き＋下に引き出し2段（白） | 808×855×1612 | 扉の面 | 不要 | `body` | `fmp-Refrigerator06-thumb.png`・`fmp-Refrigerator06-top.png` | `original-fmp-refrigerator06` | `assets/models/original/original-fmp-refrigerator06.glb` |
| `fmp-Refrigerator07` | 冷蔵庫・小型2ドア（白、横の取っ手溝） | 696×626×1244 | 扉の面 | 不要 | `body` | `fmp-Refrigerator07-thumb.png`・`fmp-Refrigerator07-top.png` | `original-fmp-refrigerator07` | `assets/models/original/original-fmp-refrigerator07.glb` |
| `fmp-BathTub01` | 置き型の浴槽（白、猫脚でなく台座付き、両端が高い） | 1150×526×412 | 長い側面 | 不要 | `body` | `fmp-BathTub01-thumb.png`・`fmp-BathTub01-top.png` | `original-fmp-bathtub01` | `assets/models/original/original-fmp-bathtub01.glb` |
| `fmp-BathTub03` | エプロン付きの浴槽（白、角の丸い箱形） | 1179×535×411 | エプロンの面 | 不要 | `body` | `fmp-BathTub03-thumb.png`・`fmp-BathTub03-top.png` | `original-fmp-bathtub03` | `assets/models/original/original-fmp-bathtub03.glb` |
| `fmp-ShowerSystem01` | 壁付けのシャワー柱（銀、丸いヘッド、混合栓、手持ちシャワー） | 279×422×1343 | ヘッドが張り出す側 | 不要 | `body` | `fmp-ShowerSystem01-thumb.png`・`fmp-ShowerSystem01-top.png` | `original-fmp-showersystem01` | `assets/models/original/original-fmp-showersystem01.glb` |
| `fmp-ShowerSystem03` | 壁付けのシャワー柱（黒、角形のヘッド、混合栓、手持ちシャワー） | 281×451×1348 | ヘッドが張り出す側 | 不要 | `body` | `fmp-ShowerSystem03-thumb.png`・`fmp-ShowerSystem03-top.png` | `original-fmp-showersystem03` | `assets/models/original/original-fmp-showersystem03.glb` |
| `fmp-Toilet01` | タンク付きの洋式便器（白、ふた開き） | 339×516×708 | 便座の側（タンクが背面） | 不要 | `body` | `fmp-Toilet01-thumb.png`・`fmp-Toilet01-top.png` | `original-fmp-toilet01` | `assets/models/original/original-fmp-toilet01.glb` |
| `fmp-WashBasin01` | カウンター一体の洗面ボウル（白、四角、奥の中央に水栓） | 644×435×264 | 手前の縁 | 不要 | `body` | `fmp-WashBasin01-thumb.png`・`fmp-WashBasin01-top.png` | `original-fmp-washbasin01` | `assets/models/original/original-fmp-washbasin01.glb` |
| `fmp-WashBasin04` | 置き型の洗面ボウル（白、角の丸い四角、金の水栓） | 496×423×276 | 水栓の反対側 | 不要 | `body` | `fmp-WashBasin04-thumb.png`・`fmp-WashBasin04-top.png` | `original-fmp-washbasin04` | `assets/models/original/original-fmp-washbasin04.glb` |
| `fmp-BathroomVanity07` | 洗面化粧台の下台（白、両開き扉、木の丸つまみ、台輪） | 682×426×695 | 扉の面 | 要 | `body` | `fmp-BathroomVanity07-thumb.png`・`fmp-BathroomVanity07-top.png` | `original-fmp-bathroomvanity07` | `assets/models/original/original-fmp-bathroomvanity07.glb` |

色の部位 `body` は、元の割り当てで「部位を分けない」の意味。新しいモデルでは、元で一番広く見えている色の部分（扉と側板、張地、本体）に
`body` を付け、取っ手・脚・蛇口・五徳のような小物には付けない。

## この波で気をつける点

- 冷蔵庫・便器・浴槽・洗面ボウルは、元の割り当てが `body` なので `body` を付ける。標準の仕様の「陶器・白物家電には部位を付けない」とは食い違うが、
  利用者が保存した色を残すため、今回は元の割り当てに合わせる
- `fmp-KitchenOven01` は部位が2つ（`metal` と `glass`）。本体の金属に `metal`、前のガラス窓に `glass` を付ける
- シンクの下台（`CabinetA_Sink`・`CabinetD_Sink`）は、元に蛇口が無い。**蛇口を足さない**（天面が下がる）。シンクは天板に掘り込む
- 下台の系列（A・D）は、同じ系列の品で天板の厚み・台輪の高さ・扉の目地をそろえる（並べて使われる）。`CabinetD01` と `D02` は取っ手の左右が逆。
  組み立て関数は系列で共有してよいが、GLB は品ごとに1つずつ作る
- 冷蔵庫7点も、扉の割り方・取っ手の形・色で見分けがつくようにする（同じ形を7つにしない）
- 薄い品（`GasStove07` は高さ 52mm、`GasStove01` は 113mm）は、五徳やつまみで高さの端を決めると天板が潰れる。どの部品が h に届くかを決めて組む
- 細い管（シャワー柱・水栓）は `add_tube()` の12角形で寸法の端を決めない（落とし穴3）。端は継ぎ手や箱の部品で決める
- レンジフード・オーブン・シャワー柱は、アプリで床からの高さを付けて置かれることがあるが、モデルの原点は他と同じく底面の中心。
  `run()` の第7要素（下から見せる）は使わない（元の縮小画像と同じく上から撮る）

## 完了条件

- 表の全点の GLB・`.blend`・縮小画像・平面図の画像がそろい、全点が `run()` を通っている
- 外形の差の表: 品ごとに、表の w/d/h と、GLB の頂点から測った w/d/h（mm、小数1桁）と差（%）。全点 ±1% 以内。
  **Blender の `obj.dimensions` ではなく、書き出した GLB を読み直して頂点から測る**
- 三角形の数: 品ごとに書く。3,000 を超えた品は理由を書く
- 原点と正面: 品ごとに、底面の中心が原点（X・Y の中心のずれ、Z の最小値）、正面が +Z（`render_thumb()` の縮小画像に正面が写っている）
- 天面: 「要」の品は、天板の上面の高さを頂点から測って書く（h と同じであること）
- 比較画像: 品ごとに1枚。左に元、右に新しい物。上の段に縮小画像、下の段に平面図の画像（1024×1024 の JPEG、品質 85 前後）。
  `tools/blender/fmp-replace/1a/compare/<新しい ID>.jpg`。新しい縮小画像は `render_thumb()` のカメラのまま描く（元に合わせてカメラを変えない）
- `sh tools/run_tests.sh` の結果（`exit=0` か、落ちた検査の名前と、この依頼の変更と関係があるか）。
  新しいモデルは manifest に入らないので、`model-uv`・`original-models` はまだ新しい品を見ない。上の表が主な検査になる

## 納めるもの

1. GLB: 表の「新しい GLB」
2. `.blend`: `tools/blender/work/original/<新しい ID>.blend`
3. 作るスクリプト: `tools/blender/build_fmp_replace_1a*.py`（このスクリプトを流せば全点を作り直せること）
4. 縮小画像と平面図の画像: `assets/models/previews-v2/<新しい ID>-thumb.png`・`-top.png`
5. 比較画像: `tools/blender/fmp-replace/1a/compare/<新しい ID>.jpg`
6. 登録用の一覧 JSON: `tools/blender/fmp-replace/1a/replacements.json`。品ごとに次の欄を持つ配列

```json
[{"fmpId": "fmp-CabinetA01", "newId": "original-fmp-cabineta01", "model": "assets/models/original/original-fmp-cabineta01.glb",
  "thumb": "assets/models/previews-v2/original-fmp-cabineta01-thumb.png", "top": "assets/models/previews-v2/original-fmp-cabineta01-top.png",
  "w": 366, "d": 522, "h": 797, "triangles": 0, "finishChannels": ["body"]}]
```

`w`・`d`・`h` は GLB の頂点から測った値（mm、整数に丸める）、`finishChannels` は GLB に入っている `finishChannel` の名前の一覧。
7. 外形の差の表と検査の記録: `tools/blender/fmp-replace/1a/checks.md`

## 納品メモ（PR の本文に書く）

- 品ごとの検査の結果（外形の差、三角形の数、原点と正面、天面の高さ、部位の名前）。表で書いてよい
- 元と形を変えた所と、その理由（例: 元の細い装飾を省いた、取っ手を一般的な形にした）
- 迷って決めた点（正面がどちらか分かりにくかった品など）
- `sh tools/run_tests.sh` の結果
- 作り直し方（流すコマンド）
- **実施していない検査は「していない」と書く**
