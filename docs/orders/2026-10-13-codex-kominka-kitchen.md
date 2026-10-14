# Codex への依頼: 日本古民家セット — 一体型の台所1点

依頼日: 2026-10-13 / 依頼者: Claude（webcad-planner の実装担当）
Issue Kanban の sourceId: `webcad-planner/kominka-kitchen-2026-10-13`

## 何に使うか

webcad-planner（本番 https://cad-planner.srapps.us ）の「家具を日本古民家に差し替える」で、壁付けの一体型キッチン
（`original-kitchen-cooking`、幅 2560 × 奥行 650、流し・コンロ・収納が1台になった物。kind は `cooktop`）だけが、
古民家に同じ大きさの物が無くて白い現代のキッチンのまま残る。これを替える一体型の台所を1点作る。
アプリへの組み込みは Claude が行う。**この依頼では素材を作って納めるところまで。**

## ブランチ・置き場所・決まり

- 最新の `origin/main` から `codex/kominka-kitchen-20261013` を切り、PR の宛先は `main`（Draft で作り、そろったら外す）。`main` には push・マージしない
- 触ってよい: `assets/models/packs/kominka/models/`・`previews/` の新しいファイル、`assets/models/packs/kominka/manifest.json` に1行足す、
  `tools/blender/kominka/set3/`。それ以外（アプリのコード・既存の物・`asset-sets.json`）は触らない
- 作り方・寸法・向き・原点・部位・確認画像の決まりは第1弾・第2弾と同じ（`docs/orders/2026-10-13-codex-kominka-set-2.md` の「共通の決まり」）

## 作る物

| ID | 名前 | group / kind | 寸法 W×D×H (mm) | 中身 |
|---|---|---|---|---|
| `kominka-kitchen-run-2560-01` | 一体型の台所（古民家） | 住設 / cooktop | 2560 × 650 × 850 | 左から、人造石研ぎ出しの流し（真鍮の蛇口）・木の調理台・漆喰塗りの二口の竈（羽釜と木の蓋）を1台につないだ物。天板は一続きの厚い板（竈の所は漆喰）。下は引き出しと板戸。背面に低い板の立ち上がり |

色は第1弾・第2弾にそろえる（煤けた欅・栗・杉、白い漆喰、灰色の研ぎ出し）。部位は `wood` 木部・`stone` 研ぎ出し・`plaster` 漆喰・`metal` 金物。

## 完了条件

- GLB・thumb・top・正背面の確認画像・`.blend` 原本・作るスクリプトがそろい、manifest に1行足されている
- `node --test tools/tests/asset-sets.test.cjs` と `model_kit.run()` の検査が通る。寸法・正面・原点が決まりどおり
- 第1弾の流し・竈と並べた確認画像で色味がそろっている
- PR の本文に納品メモ（実測寸法・三角形数・部位と既定の色・検査の結果）。**実施していない検査は「していない」と書く**
