# Codex への依頼: 日本古民家セット（第1弾）

依頼日: 2026-10-12 / 依頼者: Claude（webcad-planner の実装担当）
Issue Kanban の sourceId: `webcad-planner/kominka-set-2026-10-12`

## 何に使うか

webcad-planner（住宅の間取り・3Dプランナー、本番 https://cad-planner.srapps.us ）には、カタログの「表示するセット」と、
ボタン1つで建物と家具を切り替える機能がある（洋館セットで本番公開済み）。

- 「家具を〇〇に差し替える」: 置いてある家具を、同じ分類で大きさの近いセットの物に替える
- 「壁・床・屋根を〇〇風にする」: 外壁・屋根・内壁・床・扉・窓を、セットの素材に替える

ここに2つ目のセット **日本古民家（セット ID `kominka`）** を足す。第1弾は、この2つの切り替えで
**ふつうの2階建ての間取りが古民家らしく見える**ところまでの素材を作る（洋館セットの最初の55点と同じ位置づけ）。

アプリへの組み込み（セット一覧・差し替え・様式の設定、テクスチャの登録、扉と窓の差し込み）は Claude が行う。
**この依頼では素材を作って納めるところまで。**

## ブランチと PR の切り方（必ず守る）

```sh
git fetch origin
git switch -c codex/kominka-set-20261012 origin/main
```

- **必ず最新の `origin/main` から切る。** 他の枝（`claude/*`、`codex/*`）を土台にしない
- PR の宛先（base）は **`main`**。下書き（Draft）で作り、全部そろったら `origin/main` に追従してから下書きを外す
- `main` には push しない。マージ・デプロイもしない（main への反映は本番の公開になるので、人が許可してから Claude が行う）
- PR は1つにまとめる。直しも同じ枝・同じ PR に積む。この依頼書ファイルはリポジトリに入れない。納品メモは PR の本文に書く

## 触ってよい場所・触らない場所

触ってよい（新規作成のみ）:
- `assets/models/packs/kominka/` … `models/`・`previews/`・`manifest.json`
- `assets/textures/kominka/` … テクスチャ
- `tools/blender/kominka/` … 作るスクリプト・`.blend`・確認画像・検証の記録
- `assets/models/asset-sets.json` … **セット一覧に1行足すだけ**（`docs/asset-sets.md` の形式。`swap`・`style` は書かない）
- `docs/legal/asset-sets-ledger.md` … 権利の台帳に1行足す

触らない: アプリのコード（`index.html`・`assets/js/`・`assets/*.css`）、既存のモデル・画像・テクスチャ、洋館セット（`packs/rpg-mansion/`）。
途中経過のファイル（別案、チェックポイント、大量の検証画像）はリポジトリに入れない（以前 500MB を超えて push が失敗した）。

## 共通の決まり

- 手順と manifest の形式は **`docs/asset-sets.md`** に従う。モデルは `tools/blender/README.md` の「カタログのモデルを作るときの約束」
  （`model_kit.run()` を通す、UV を展開する、`.blend` の原本を残す）
- Blender で独自に制作する。写真・外部素材は使わない（`provenance: "original"`）
- 単位はメートル、正面は +Z、上は +Y、原点は底面の中心。寸法は表の値にバウンディングボックスを合わせる（±3% まで）
- ID は `kominka-` で始め、末尾 `-01`。名前（`name`）は日本語
- 色を変えられる部位はマテリアルのカスタムプロパティ `finishChannel` に入れ、manifest の `finishChannels` の `label` は日本語にする
  （例: `wood` 木部、`fabric` 布、`metal` 金物、`paper` 和紙、`stone` 石、`rush` い草、`plaster` 漆喰）
- 色は**落ち着いた実物の色**。新品のような明るい木ではなく、煤けた欅・栗・杉の色味を基調にする
- 1点につき: `models/<id>.glb`、`previews/<id>-thumb.png`（斜め上から、512×512 透過）、`previews/<id>-top.png`（真上、512×512 透過）、
  正面・背面の確認画像（JPEG 512px で2枚、`tools/blender/kominka/` に置く）。三角形は1点 2万以下（扉・窓は 8,000 以下）

## A. テクスチャ6種（`assets/textures/kominka/`）

- 1枚 1024×1024px、上下左右に継ぎ目なく繰り返せる（4枚並べて継ぎ目・目立つ繰り返しが無い）
- 1種につき3枚: `<key>_diffuse.jpg`（sRGB）・`<key>_normal.jpg`（OpenGL 形式 = 緑が上）・`<key>_roughness.jpg`（白=つや消し）。JPEG 品質 85 前後
- 1枚が実寸の何 mm 角かを表のとおりにし、板幅・目地が実寸に合うように作る

| key | 用途 | 中身 | 1タイルの実寸 |
|---|---|---|---|
| `kominka_yakisugi` | 外壁（1階） | 焼杉板の縦張り（板幅 180mm、炭化した黒、木目の凹凸が出る。目板 30mm） | 1080mm角 |
| `kominka_shikkui` | 外壁（2階）・内壁 | 白漆喰（真っ白ではなく生成り。コテむらがわずかに見える程度） | 1000mm角 |
| `kominka_juraku` | 内壁（和室） | 聚楽の土壁（薄い黄土色、細かい砂粒と藁すさ） | 1000mm角 |
| `kominka_kayabuki` | 屋根 | 茅葺き（灰褐色の茅の束が流れ方向にそろう。v が屋根の上り方向） | 1200mm角 |
| `kominka_old_pine_floor` | 床（板の間） | 古い松の板の間（板幅 150〜240mm の乱尺、長さ方向の継ぎ目あり、飴色〜焦茶） | 1800mm角 |
| `kominka_doma` | 床（玄関・土間・台所） | 三和土（たたき）。灰褐色の土に小石が混じる。目地なし | 1200mm角 |

畳（`tatami`）と燻し瓦（`kawara_ibushi`）はアプリに既にあるので作らない。

## B. 扉・窓7点（manifest の `group: "家具"`、`category` は扉が `"ドア"`・窓が `"窓"`、`kind` は付けない）

アプリが壁に開口を作り、そこへ**閉じた状態の建具1台分**を差し込む。開口の大きさに合わせて縦横に伸縮されるので、
**±30% 伸ばしても破綻しない意匠**にする（格子・桟の本数は固定なので、比率が崩れすぎないこと）。
正面 +Z が屋外側（扉は廊下側）、原点は下端の中心。奥行きは枠・敷居の出を含む。
ガラスは部位を付けず、マテリアル名を `Glass`（色 #dfe8ea・不透明度 0.25 前後、alphaMode BLEND）。障子紙は部位 `paper`。

| ID | 名前 | 寸法 W×D×H (mm) | 中身 | アプリでの使い道 |
|---|---|---|---|---|
| `kominka-door-itado-01` | 板戸 | 760 × 60 × 2000 | 杉の縦板を横桟で留めた片開きの戸。鉄の引手 | 開き戸の扉 |
| `kominka-door-shoji-01` | 腰付き障子戸 | 760 × 60 × 2000 | 下 450mm が板の腰、上は組子の障子 | 開き戸の扉の別案 |
| `kominka-entrance-door-01` | 格子戸の玄関 | 1700 × 120 × 2100 | 引き違いの格子戸2枚（閉じた状態）を枠と敷居ごと。格子の奥に磨りガラス | 玄関ドア |
| `kominka-sliding-window-01` | 格子の引き違い窓 | 1600 × 180 × 1100 | 外に竪格子、内に引き違いのガラス戸（木枠） | 引き違いの腰窓 |
| `kominka-casement-window-01` | 出格子窓 | 1200 × 350 × 1100 | 壁から外へ張り出した竪格子（京町家の出格子）。内側は障子 | 開き窓 |
| `kominka-round-window-01` | 丸窓 | 900 × 150 × 900 | 四角い外枠の中に円形の開口、竹の下地格子と障子 | FIX 窓 |
| `kominka-engawa-glass-door-01` | 縁側のガラス戸 | 1800 × 150 × 2000 | 木枠のガラス戸4枚（閉じた状態）、腰板付き、上に欄間 | 掃き出し窓 |

## C. 家具・住設・外構25点

`kind` は `assets/models/tags.json` の `kinds` のキー。差し替えは同じ `kind` で大きさの近い物を選ぶので、
**寸法は表のとおり（現代の家具と同じ大きさの帯）に作る**。`defaultElevation` が書いてある物は manifest に入れる。

| ID | 名前 | group / kind | 寸法 W×D×H (mm) | 中身・備考 |
|---|---|---|---|---|
| `kominka-dining-table-01` | 欅の食卓 | 家具 / dining-table | 1500 × 850 × 700 | 一枚板風の厚い天板、太い角脚 |
| `kominka-chair-01` | 民芸の椅子 | 家具 / chair | 450 × 500 × 800 | 木の椅子、い草（`rush`）の座面、背は縦桟 |
| `kominka-zaisu-01` | 座椅子 | 家具 / chair | 450 × 550 × 450 | 木の背と藍の座布団。床座の部屋向けの別案 |
| `kominka-zataku-01` | 座卓 | 家具 / low-table | 1500 × 900 × 330 | 欅の座卓、四隅の脚に簡単な彫り |
| `kominka-sofa-01` | 木枠の長椅子 | 家具 / sofa | 1800 × 800 × 750 | 栗の木枠、藍染の座布団と背当て |
| `kominka-bed-1000-01` | 布団を敷いた和の寝台 | 家具 / bed | 1000 × 2100 × 400 | 低い木の台に敷き布団と掛け布団、そば殻の枕 |
| `kominka-bed-1400-01` | 布団を敷いた和の寝台（二人用） | 家具 / bed | 1400 × 2100 × 400 | 同上の幅広 |
| `kominka-tansu-01` | 衣装箪笥 | 家具 / chest | 900 × 450 × 1100 | 桐か欅、黒い鉄の金具、引き出し6段 |
| `kominka-kaidan-dansu-01` | 階段箪笥 | 家具 / cabinet | 1800 × 450 × 1800 | 段々の箪笥。引き出しと引き戸の組み合わせ |
| `kominka-mizuya-01` | 水屋箪笥 | 住設 / kitchen-storage | 1200 × 450 × 1800 | 上は格子ガラスの引き戸、下は引き出しと板戸 |
| `kominka-butsudan-01` | 仏壇 | 家具 / cabinet | 700 × 600 × 1500 | 黒檀調の箱、観音開きの扉（閉じた状態）、金の飾り金具は控えめ |
| `kominka-desk-01` | 書院机 | 家具 / desk | 1200 × 600 × 720 | 欅の机、片袖の引き出し |
| `kominka-shoe-storage-01` | 下駄箱 | 家具 / shoe-storage | 900 × 350 × 1000 | 杉の板戸2枚、天板に余白 |
| `kominka-andon-01` | 行灯 | 家具 / light | 300 × 300 × 800 | 木の枠に和紙。床置き |
| `kominka-pendant-01` | 和紙のペンダント照明 | 家具 / light | 500 × 500 × 400 | 竹ひごと和紙の傘、吊り紐。`defaultElevation` 2000 |
| `kominka-hengaku-01` | 扁額 | 家具 / wall-decor | 1200 × 50 × 450 | 横長の木の額に墨の書（実在の書家の字は使わない、判読できなくてよい）。`defaultElevation` 1500 |
| `kominka-kakejiku-01` | 掛け軸 | 家具 / wall-decor | 550 × 30 × 1700 | 山水画風の掛け軸（独自の絵）。`defaultElevation` 400 |
| `kominka-tsuitate-01` | 衝立 | 家具 / decor | 1200 × 350 × 1200 | 木枠に網代か和紙の衝立 |
| `kominka-sudare-01` | 簾 | 家具 / roller-screen | 1800 × 30 × 1800 | 竹の簾を上の巻き上げ紐で吊る。`defaultElevation` 400（上端 2200） |
| `kominka-hanagoza-01` | 花ござ | 家具 / rug | 2000 × 2000 × 10 | い草の敷物、控えめな柄 |
| `kominka-irori-01` | 囲炉裏 | 家具 / decor | 1200 × 1200 × 450 | 木の炉縁、灰と五徳と鉄瓶。床に置く（床の掘り込みは無し） |
| `kominka-kamado-01` | 竈 | 住設 / cooktop | 1200 × 700 × 800 | 漆喰塗りの二口の竈、羽釜と木の蓋 |
| `kominka-sink-01` | 研ぎ出しの流し | 住設 / kitchen-sink | 1200 × 600 × 800 | 人造石研ぎ出しの流し台、真鍮の蛇口 |
| `kominka-hinoki-bath-01` | 檜風呂 | 住設 / bathtub | 1400 × 800 × 600 | 檜の浴槽、銅のたが |
| `kominka-ishidoro-01` | 石灯籠 | 外構 / garden-equipment | 600 × 600 × 1500 | 御影石の雪見灯籠でなく春日灯籠の形 |

外構の補い（任意。時間があれば）: `kominka-takegaki-01` 竹垣（外構 / fence、1800 × 100 × 1500、伸縮しても破綻しない）、
`kominka-matsu-01` 松（外構 / garden-plant、2500 × 2500 × 3000）。

## 完了条件

- A〜C の全点（任意の2点は除いてよい）のファイルが上記の場所にあり、`manifest.json` に登録されている
- `asset-sets.json` に `kominka` の1行が足され、`node --test tools/tests/asset-sets.test.cjs` が通る
- モデルは `model_kit.run()` の検査を通り、寸法・正面の向き・原点が決まりどおり
- 扉・窓は、幅120%/高さ80% と 幅80%/高さ120% に伸ばした確認画像で格子・桟が破綻していない
- テクスチャは4枚並べた確認画像で継ぎ目が無い
- `.blend` の原本と作るスクリプトがあり、作り直し方が PR 本文に書いてある
- PR の本文に納品メモ: ID・名前・実測寸法・三角形数・部位と既定の色、テクスチャの key と1タイルの実寸、検査の結果。
  **実施していない検査は「していない」と書く**
