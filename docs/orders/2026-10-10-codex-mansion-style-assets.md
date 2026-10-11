# Codex への発注: 洋館スタイルの素材（テクスチャ8種・額絵3点・洗濯の入れ物2点）

発注日: 2026-10-10 / 発注者: Claude（webcad-planner の実装担当）

## 何に使うか

webcad-planner（住宅の間取り・3Dプランナー、本番 https://cad-planner.srapps.us ）に、
ボタン1つで建物と家具を「洋館風」に切り替える機能を作る。

- 建物: 外壁・屋根・内壁・床の素材を洋館風に替える → **テクスチャ8種**が要る
- 家具: 置いてある家具を洋館の物に差し替える。テレビは額絵に、洗濯機は洗濯物の入れ物に替える
  → **横長の額絵3点**と**洗濯カゴ・ランドリーボックス2点**が要る

アプリへの組み込み（素材の登録、切り替えの画面と処理）は Claude が行う。**この発注では素材を作って納めるところまで。**

## ブランチと PR の切り方（必ず守る）

```sh
git fetch origin
git switch -c codex/mansion-style-assets-20261010 origin/main
```

- **必ず最新の `origin/main` から切る。** 他の枝（`claude/*`、`codex/pr81-*` など）を土台にしない。
  古い枝を土台にすると、その後に本番へ入った変更を消してしまう（PR #83 で起きた）
- PR の宛先（base）は **`main`**。下書き（Draft）で作り、全部そろったら下書きを外す
- 下書きを外す前に、もう一度 `origin/main` に追従する（`git fetch origin && git rebase origin/main`）
- `main` には push しない。マージ・デプロイもしない（main への反映は本番の公開になるので、人が許可してから Claude が行う）
- PR は1つにまとめる。追加のコミットは同じ枝に積む

## 触ってよい場所・触らない場所

触ってよい（新規作成のみ）:
- `assets/textures/mansion/` … テクスチャ
- `assets/models/packs/rpg-mansion/models/`・`previews/` … 新しいモデル5点のファイルだけ
- `tools/blender/rpg_mansion/style_assets/` … 作るためのスクリプト・`.blend`・確認画像
- `docs/orders/2026-10-10-codex-mansion-style-assets.md` … **この発注書をそのままこの場所に置き**、末尾の「納品メモ」欄だけ書き足す

**触らない:**
- `index.html`、`assets/js/`、`assets/ui-refinement.css` などアプリのコード
- 既存のモデル・画像・テクスチャ（**本番に出た素材は差し替えない**。保存プランが名前で参照している）
- `assets/models/packs/rpg-mansion/manifest.json`（新しい5点の登録は Claude が行う。下の「納品メモ」に書いてもらえばよい）
- 途中経過のファイル（別案、チェックポイント、大量の検証画像）をリポジトリに入れない。前回はこれで 500MB を超え、push が何度も失敗した

## A. テクスチャ8種

### 共通の決まり

- 1枚 **1024×1024px**、上下左右に**継ぎ目なく繰り返せる**こと（4枚並べて継ぎ目・同じ模様の目立つ繰り返しが無い）
- 1種につき3枚: `<key>_diffuse.jpg`（色）・`<key>_normal.jpg`（凹凸。OpenGL 形式 = 緑が上）・`<key>_roughness.jpg`（白=つや消し）
- JPEG、品質 85 前後。diffuse は sRGB、normal・roughness はリニア
- 1枚が**実寸の何mm角か**を決めて、その寸法ちょうどの1タイルとして作る（目地・板幅が実寸に合うように）
- 色は**落ち着いた実物の色**にする。彩度を上げすぎない（オレンジのプラスチックのような木は不可）
- 独自に作る（手続き生成・Blender でのベイクなど）。写真や外部素材は使わない

### 一覧

| key | 用途 | 中身 | 1タイルの実寸 |
|---|---|---|---|
| `mansion_brick_red` | 外壁 | 赤レンガ（イギリス積み、目地は明るい灰色 10mm、レンガ 215×65mm） | 860mm角 |
| `mansion_ashlar_stone` | 外壁 | 切石積み（淡い砂岩色、石 600×300mm 前後、目地 5mm） | 1200mm角 |
| `mansion_slate_roof` | 屋根 | 天然スレート葺き（黒灰、1枚 300×600mm を半分ずらし、重なり見え 250mm） | 1200mm角 |
| `mansion_damask_wallpaper` | 内壁（居間・寝室） | ダマスク柄の壁紙（深緑か臙脂の地に、同系色の柄。柄の縦の繰り返し 530mm） | 530mm角 |
| `mansion_wainscot_panel` | 内壁（廊下・玄関・書斎） | 腰板（高さ 900mm の羽目板、上は漆喰。濃いめの胡桃色） | 900mm角 |
| `mansion_herringbone_oak` | 床（居室） | オークのヘリンボーン（板 70×350mm、中間の茶色、わずかに色差） | 1400mm角 |
| `mansion_marble_checker` | 床（玄関ホール） | 白と黒の大理石の市松（1枚 400mm 角、目地ほぼ無し、白は灰色の筋入り） | 800mm角 |
| `mansion_white_subway_tile` | 内壁・床（水回り） | 白のサブウェイタイル（75×150mm、横張り、目地は灰白 3mm） | 600mm角 |

## B. モデル5点

### 共通の決まり（`docs/asset-sets.md` の「モデルの決まり」と同じ）

- Blender で独自に制作。単位はメートル、**正面は +Z、上は +Y、原点は底面の中心**
- 色を変えられるよう、マテリアルを部位ごとに分け、マテリアルのカスタムプロパティ `finishChannel` に部位名（`wood`・`metal`・`fabric`・`canvas` など）を入れる
- ID は `rpg-mansion-` で始め、末尾 `-01`。既存の ID と重ねない
- 1点につき: `models/<id>.glb`、`previews/<id>-thumb.png`（斜め上から、512×512 透過）、`previews/<id>-top.png`（真上、512×512 透過）、
  `tools/blender/rpg_mansion/style_assets/<id>.blend`、正面・背面の確認画像（JPEG 512px で2枚）
- 三角形は1点 2万以下

### 一覧

| ID | 名前（画面に出す） | 寸法 W×D×H mm | 備考 |
|---|---|---|---|
| `rpg-mansion-landscape-painting-1000-01` | 金縁の横長の額絵 1000 | 1000×60×700 | 油絵の風景（暗めの森と空）。壁に掛ける物。背面は平ら |
| `rpg-mansion-landscape-painting-1400-01` | 金縁の横長の額絵 1400 | 1400×70×900 | 同上。別の絵柄（海辺の夕景など） |
| `rpg-mansion-landscape-painting-1800-01` | 金縁の横長の額絵 1800 | 1800×80×1100 | 同上。別の絵柄（屋敷と庭園など） |
| `rpg-mansion-wicker-laundry-basket-01` | 籐の洗濯カゴ | 600×450×600 | 取っ手付き。中に布が少し見える |
| `rpg-mansion-lidded-laundry-box-01` | 蓋付きの木製ランドリーボックス | 600×500×850 | 蓋が閉じた状態。洗濯機の代わりに置くので、洗濯機と同じくらいの大きさ |

額絵はテレビの代わりに、テレビの画面と同じ位置・高さに掛ける。絵の面が正面（+Z）を向くこと。

## 受け入れの検査（下書きを外す前に通す）

```sh
node --test tools/tests/asset-sets.test.cjs   # 既存の洋館の素材が差し替えられていないこと（必ず通る状態のまま）
sh tools/run_tests.sh                         # 既存の単体テスト
```

- 追加したファイルの合計が **60MB 以下**であること
- テクスチャ: 4枚を2×2に並べた画像を1枚ずつ作り、`tools/blender/rpg_mansion/style_assets/tiling/<key>.jpg` に置く（継ぎ目の確認用。1024px に縮小）
- モデル: 正面・背面の確認画像で、正面が +Z を向いていることを目で確かめる

## 納品メモ（Codex が書く）

PR の本文と、この欄の両方に書く。

- テクスチャ8種: key・1タイルの実寸・ファイル名
- モデル5点: ID・名前・寸法（実測）・`finishChannel` の部位名と既定の色・三角形数
- 作るためのスクリプトの場所と、作り直し方
- 検査の結果


### 納品メモ追記（2026-10-10、PR提出前の制作・素材検証段階）

2026-10-10のユーザー承認により、指定タイル寸法と継ぎ目なしを優先し、部材寸法を調整しました。腰板は高さ900mmの横方向リピート専用とし、上部の漆喰は実装側で分けます。アプリ組み込み・manifest登録は行っていません。

#### テクスチャ8種
- mansion_ashlar_stone: 1タイル1200mm角、1024×1024。assets/textures/mansion/mansion_ashlar_stone_diffuse.jpg / mansion_ashlar_stone_normal.jpg / mansion_ashlar_stone_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_ashlar_stone.jpg。
- mansion_damask_wallpaper: 1タイル530mm角、1024×1024。assets/textures/mansion/mansion_damask_wallpaper_diffuse.jpg / mansion_damask_wallpaper_normal.jpg / mansion_damask_wallpaper_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_damask_wallpaper.jpg。
- mansion_herringbone_oak: 1タイル1400mm角、1024×1024。assets/textures/mansion/mansion_herringbone_oak_diffuse.jpg / mansion_herringbone_oak_normal.jpg / mansion_herringbone_oak_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_herringbone_oak.jpg。
- mansion_marble_checker: 1タイル800mm角、1024×1024。assets/textures/mansion/mansion_marble_checker_diffuse.jpg / mansion_marble_checker_normal.jpg / mansion_marble_checker_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_marble_checker.jpg。
- mansion_brick_red: 1タイル860mm角、1024×1024。assets/textures/mansion/mansion_brick_red_diffuse.jpg / mansion_brick_red_normal.jpg / mansion_brick_red_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_brick_red.jpg。
- mansion_slate_roof: 1タイル1200mm角、1024×1024。assets/textures/mansion/mansion_slate_roof_diffuse.jpg / mansion_slate_roof_normal.jpg / mansion_slate_roof_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_slate_roof.jpg。
- mansion_white_subway_tile: 1タイル600mm角、1024×1024。assets/textures/mansion/mansion_white_subway_tile_diffuse.jpg / mansion_white_subway_tile_normal.jpg / mansion_white_subway_tile_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_white_subway_tile.jpg。
- mansion_wainscot_panel: 1タイル900mm角、1024×1024。assets/textures/mansion/mansion_wainscot_panel_diffuse.jpg / mansion_wainscot_panel_normal.jpg / mansion_wainscot_panel_roughness.jpg。確認画像: tools/blender/rpg_mansion/style_assets/tiling/mansion_wainscot_panel.jpg。

調整寸法：
- 赤レンガ: 860mm角、10mm目地、12段（段ピッチ71.666667mm）。長手素地205×61.666667mm、小口素地97.5×61.666667mm。横ピッチ215/107.5mm、英国積みの長手段/小口段交互。元指定215×65mmの素地を調整。
- スレート: 1200mm角、幅300mm、名目長600mm、見付200mm、6段、半ずらし150mm。見付250→200mm（20%縮小）。5段240mmではタイル外周で半ずらしが連続しないため、偶数6段とした。
- 白サブウェイタイル: 600mm角、目地3mm、素地147×72mm。目地込みピッチ150×75mm、4列×8段、半ずらし75mm。元素地150×75mmを調整。
- 腰板: 高900mm、横周期900mm、板ピッチ100mm、上端笠木30mm、下端巾木80mm。漆喰なし。縦方向リピートは受入れ範囲に含めない。
- 切石: 目地込み600×300mm、石本体595×295mm、目地5mm。その他は原指定530/1400/800mm周期。

色データの扱い: diffuseはsRGBとしてデコードする色データ。normal/roughnessはlinearとして扱いsRGB変換しない。JPEGメタデータによる色管理保証ではない。normalはOpenGL（+Y上）で、JPEG不可逆圧縮後はシェーダーでnormalizeする。JPEG品質は85、今回追加4種のnormalのみ圧縮誤差低減のため90。

#### モデル5点（前回完成素材を変更せず保全）
- rpg-mansion-landscape-painting-1000-01 / 金縁の横長の額絵 1000: 実測W×D×H 1000.000×60.000×700.000mm、8166三角形。
  - Flat walnut backing: finishChannel=wood、既定sRGB=#614c3a。
  - Antique gold frame: finishChannel=metal、既定sRGB=#c7a461。
  - Burnished gilt bead: finishChannel=metal、既定sRGB=#ddbc79。
  - Patinated gold recess: finishChannel=metal、既定sRGB=#8e6f3f。
  - Original painted linen canvas: finishChannel=canvas、既定sRGB=#ffffff。
- rpg-mansion-landscape-painting-1400-01 / 金縁の横長の額絵 1400: 実測W×D×H 1400.000×70.000×900.000mm、8934三角形。
  - Flat walnut backing: finishChannel=wood、既定sRGB=#614c3a。
  - Antique gold frame: finishChannel=metal、既定sRGB=#c7a461。
  - Burnished gilt bead: finishChannel=metal、既定sRGB=#ddbc79。
  - Patinated gold recess: finishChannel=metal、既定sRGB=#8e6f3f。
  - Original painted linen canvas: finishChannel=canvas、既定sRGB=#ffffff。
- rpg-mansion-landscape-painting-1800-01 / 金縁の横長の額絵 1800: 実測W×D×H 1800.000×80.000×1100.000mm、10758三角形。
  - Flat walnut backing: finishChannel=wood、既定sRGB=#614c3a。
  - Antique gold frame: finishChannel=metal、既定sRGB=#c7a461。
  - Burnished gilt bead: finishChannel=metal、既定sRGB=#ddbc79。
  - Patinated gold recess: finishChannel=metal、既定sRGB=#8e6f3f。
  - Original painted linen canvas: finishChannel=canvas、既定sRGB=#ffffff。
- rpg-mansion-wicker-laundry-basket-01 / 籐の洗濯カゴ: 実測W×D×H 600.000×450.000×600.000mm、17344三角形。
  - Honey wicker 0: finishChannel=wood、既定sRGB=#816142。
  - Honey wicker 1: finishChannel=wood、既定sRGB=#93734f。
  - Honey wicker 2: finishChannel=wood、既定sRGB=#a0805b。
  - Honey wicker 3: finishChannel=wood、既定sRGB=#8a6a48。
  - Warm ivory linen: finishChannel=fabric、既定sRGB=#e5e1d1。
  - Muted sage linen: finishChannel=fabric、既定sRGB=#93a497。
- rpg-mansion-lidded-laundry-box-01 / 蓋付きの木製ランドリーボックス: 実測W×D×H 600.000×500.000×850.000mm、12240三角形。
  - Oiled walnut rails: finishChannel=wood、既定sRGB=#503521。
  - Walnut inset panels: finishChannel=wood、既定sRGB=#5d422b。
  - Subtle walnut grain: finishChannel=wood、既定sRGB=#482c19。
  - Aged brass hardware: finishChannel=metal、既定sRGB=#c5a66c。

#### 再生成
- Python 3、NumPy、SciPy、Pillow: python tools/blender/rpg_mansion/style_assets/generate_order_textures.py
- テクスチャ検証: python tools/blender/rpg_mansion/style_assets/validate_order_textures.py
- Blender 4.3.2: blender --background --python tools/blender/rpg_mansion/style_assets/build_style_models.py
- GLB/画像検証: python tools/blender/rpg_mansion/style_assets/validate_style_models.py
- .blend原本・正面/背面画像・検証JSONは同style_assets/内。GLBと透過previewは発注指定パス。

#### 検査結果と未実施範囲
- 24maps＋8tile確認画像の全32JPEG: 1024×1024/RGB/JPEGデコード、roughness灰色、normal＋Z・正負勾配、再生成byte一致、1タイル座標移動生成byte一致。各種周期寸法と交互段の外周連続性を確認。腰板は横方向のみ。
- 2×2確認画像を実見。落着いた色、英国積み/半ずらし、木目・切石・ダマスク・白黒大理石を確認。
- JPEGnormalの長さ誤差はtexture-validation.jsonへ記録。損失圧縮後のnormalizeが必要。
- 5モデルの寸法、GLB方向、finishChannel、三角形数、透過画像は既存models-validation-report.jsonに記録。今回はモデル全ファイルをSHA照合し変更なし。
- 2026-10-10: origin/main（a06d6db104c11114bc3e62a74f4dc37eae60216e）を取得し、codex/mansion-style-assets-20261010へ71ファイルを衝突なしで追加。node --test tools/tests/asset-sets.test.cjsは8/8成功。sh tools/run_tests.shは113テストファイルとlint自己検査を実行し、失敗なし（exit=0表示）。Playwright未導入時にskipするブラウザ検証は実施済みとは扱わない。commit、push、PR作成・下書き解除、main反映、deployは未実施。