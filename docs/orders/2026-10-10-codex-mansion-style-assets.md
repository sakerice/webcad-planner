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
