# Codex への依頼: 日本古民家セット（第2弾・足りない物の補充）

依頼日: 2026-10-13 / 依頼者: Claude（webcad-planner の実装担当）
Issue Kanban の sourceId: `webcad-planner/kominka-set-2-2026-10-13`

## 何に使うか

webcad-planner（本番 https://cad-planner.srapps.us ）の日本古民家セット（`kominka`、第1弾は PR #92 で本番公開済み）を補う。
「家具を日本古民家に差し替える」を既定プラン2階建てにかけると、56点のうち35点が「替えられる物が無い」で現代の物のまま残る
（車・キッチンの戸棚とコンロとレンジフード・冷蔵庫・カーテン・押入れ・洗面台・便器・シャワー・洗濯・エアコン・デッキ・門柱など）。
また、低いテレビボード（サイドボード）が背の高い階段箪笥に替わってしまう。第2弾はこれを埋める。

アプリへの組み込み（差し替えの設定）は Claude が行う。**この依頼では素材を作って納めるところまで。**

## ブランチと PR の切り方（必ず守る）

```sh
git fetch origin
git switch -c codex/kominka-set-2-20261013 origin/main
```

- **必ず最新の `origin/main` から切る。** 他の枝（`claude/*`、`codex/*`）を土台にしない
- PR の宛先（base）は **`main`**。下書き（Draft）で作り、全部そろったら `origin/main` に追従してから下書きを外す
- `main` には push しない。マージ・デプロイもしない
- PR は1つにまとめる。直しも同じ枝・同じ PR に積む。この依頼書ファイルはリポジトリに入れない。納品メモは PR の本文に書く

## 触ってよい場所・触らない場所

触ってよい:
- `assets/models/packs/kominka/models/`・`previews/` … **新しい物のファイルだけ**（第1弾の物は変えない）
- `assets/models/packs/kominka/manifest.json` … **新しい物の行を足すだけ**（既存の行は変えない）
- `tools/blender/kominka/` … 作るスクリプト・`.blend`・確認画像・検証の記録（第2弾の物は `tools/blender/kominka/set2/` にまとめる）

触らない: アプリのコード（`index.html`・`assets/js/`・`assets/*.css`）、`asset-sets.json`、第1弾の物、洋館セット。
途中経過のファイル（別案、チェックポイント、大量の検証画像）はリポジトリに入れない。

## 共通の決まり（第1弾と同じ）

- 手順と manifest の形式は `docs/asset-sets.md`、モデルは `tools/blender/README.md` の「カタログのモデルを作るときの約束」に従う
  （`model_kit.run()` を通す、UV を展開する、`.blend` の原本を残す）
- Blender で独自に制作する。写真・外部素材は使わない（`provenance: "original"`）
- 単位はメートル、正面は +Z、上は +Y、原点は底面の中心。寸法は表の値にバウンディングボックスを合わせる（±3% まで）
- ID は表のとおり（`kominka-` で始まり末尾 `-01`）。名前（`name`）は日本語。`finishChannels` の `label` も日本語
- 色は第1弾にそろえる（煤けた欅・栗・杉、藍染、生成りの和紙・麻）。第1弾の物と並べて浮かないこと
- 1点につき: `models/<id>.glb`、`previews/<id>-thumb.png`・`-top.png`（512×512 透過）、正面・背面の確認画像。三角形は1点 2万以下
- **差し替えは同じ `kind` で大きさの近い物を選ぶ**。寸法は表のとおり、現代の物と同じ大きさの帯に作る

## 一覧（26点）

| ID | 名前 | group / kind | 寸法 W×D×H (mm) | 中身・備考 |
|---|---|---|---|---|
| `kominka-rickshaw-01` | 人力車 | 外構 / （kind なし、category `車`） | 1100 × 2600 × 1650 | 黒塗りの車体、赤い座布団、大きな木の車輪2つ、前に梶棒。駐車スペースの車の代わり |
| `kominka-engawa-bench-1800-01` | 濡れ縁 | 外構 / deck | 1800 × 600 × 450 | 杉板の濡れ縁（縁台）。木の脚 |
| `kominka-engawa-bench-2600-01` | 濡れ縁（長い） | 外構 / deck | 2600 × 900 × 450 | 同上の大きい物 |
| `kominka-gate-post-01` | 木の門柱 | 外構 / gate-post | 400 × 200 × 1400 | 栗の角柱に小さな屋根、表札の板 |
| `kominka-kitchen-counter-450-01` | 木の調理台 450 | 住設 / kitchen-storage | 450 × 600 × 800 | 板の天板、引き出し3段 |
| `kominka-kitchen-counter-600-01` | 木の調理台 600 | 住設 / kitchen-storage | 600 × 600 × 800 | 板の天板、引き出しと板戸 |
| `kominka-kitchen-counter-900-01` | 木の調理台 900 | 住設 / kitchen-storage | 900 × 600 × 800 | 板の天板、両開きの板戸 |
| `kominka-kitchen-worktable-01` | 土間の作業台 | 住設 / kitchen-storage | 2100 × 900 × 850 | 厚い一枚板の作業台、下に棚。アイランドの代わり |
| `kominka-kamado-single-01` | 一口の竈 | 住設 / cooktop | 750 × 650 × 800 | 漆喰塗りの一口の竈と羽釜。コンロの代わり（第1弾の二口は 1200 幅） |
| `kominka-smoke-hood-01` | 煙出しの覆い | 住設 / range-hood | 900 × 600 × 700 | 竈の上に吊る木枠と銅板の覆い。`defaultElevation` 1500 |
| `kominka-icebox-01` | 木の冷蔵庫 | 住設 / refrigerator | 700 × 650 × 1700 | 昔の木製の氷冷蔵庫（上下2段の扉、真鍮の取手） |
| `kominka-sink-900-01` | 研ぎ出しの流し 900 | 住設 / kitchen-sink | 900 × 600 × 800 | 第1弾の流しの小さい物 |
| `kominka-chadansu-1500-01` | 茶箪笥（低い） | 家具 / cabinet | 1500 × 450 × 650 | 低い飾り棚。引き違いの小戸と引き出し。**テレビボードの代わり**（上に物を置ける高さ） |
| `kominka-chadansu-900-01` | 茶箪笥 | 家具 / cabinet | 900 × 400 × 900 | 小さい茶箪笥 |
| `kominka-oshiire-01` | 襖の衣装戸棚 | 家具 / closet | 1000 × 580 × 1900 | 襖2枚の戸棚（押入れの見た目）。洋服箪笥の代わり |
| `kominka-hanadai-01` | 花台 | 家具 / low-table | 460 × 460 × 400 | 欅の小さな台（サイドテーブルの代わり） |
| `kominka-bonsai-01` | 盆栽 | 家具 / plant | 600 × 450 × 700 | 松の盆栽と陶器の鉢、木の台 |
| `kominka-curtain-long-01` | 麻のカーテン（長い） | 家具 / curtain | 1300 × 150 × 2200 | 生成りの麻に藍の細い縞。両側に寄せて開いた状態。`defaultElevation` 0（上端 2200） |
| `kominka-curtain-short-01` | 麻のカーテン（短い） | 家具 / curtain | 900 × 150 × 1200 | 同上の腰窓用。`defaultElevation` 1000（上端 2200） |
| `kominka-washstand-01` | 陶器の手洗い鉢の洗面台 | 住設 / vanity | 700 × 450 × 850 | 木の台に白い陶器の鉢、真鍮の蛇口 |
| `kominka-washstand-small-01` | 小さな手洗い | 住設 / vanity | 500 × 400 × 800 | 同上の小さい物 |
| `kominka-toilet-01` | 木の蓋の便器 | 住設 / toilet | 420 × 650 × 1600 | 白い陶器の便器に木の便座と蓋、壁に木製のハイタンクと鎖 |
| `kominka-shower-01` | 真鍮のシャワー | 住設 / shower | 300 × 450 × 2000 | 真鍮の立ち上がり管とシャワー、檜の手桶と腰掛け |
| `kominka-tarai-01` | たらいと洗濯板 | 住設 / laundry | 900 × 500 × 600 | 木の台に木のたらいと洗濯板。洗濯機の代わり |
| `kominka-monohoshi-01` | 竹竿の物干し | 住設 / laundry | 1100 × 80 × 300 | 壁の金具に掛けた竹竿と手ぬぐい。`defaultElevation` 1700 |
| `kominka-ac-cover-01` | 木格子のエアコン覆い | 家具 / hvac | 850 × 300 × 320 | 壁掛けエアコンを覆う杉の格子。`defaultElevation` 1950 |

外構の補い（第1弾の任意分。時間があれば）: `kominka-takegaki-01` 竹垣（外構 / fence、1800 × 100 × 1500）、`kominka-matsu-01` 松（外構 / garden-plant、2500 × 2500 × 3000）。

## 完了条件

- 26点のファイルが上記の場所にあり、`manifest.json` に足されている（既存の行は変わっていない）
- `node --test tools/tests/asset-sets.test.cjs` が通る
- モデルは `model_kit.run()` の検査を通り、寸法・正面の向き・原点が決まりどおり
- 第1弾の物と並べた確認画像（同じ光で数点ずつ）で、色味がそろっている
- `.blend` の原本と作るスクリプトがあり、作り直し方が PR 本文に書いてある
- PR の本文に納品メモ: ID・名前・実測寸法・三角形数・部位と既定の色・検査の結果。**実施していない検査は「していない」と書く**
