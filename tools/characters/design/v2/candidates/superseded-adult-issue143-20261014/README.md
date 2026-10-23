# Claude向け2D人物デザイン第2版 — 正式6案

本人17:08 JST `Sentinel_05ffbbd842d08191a86a1d3d32c81fc9`「納品形式はClaude側の要求に従ってください」に従い、男女各3案・各3方向を揃えた。14:31承認の最新4正面head `1f1815e5ca7aca53d0893152e9f2926877c05c68` の絵柄/成人体型/在宅服を基準として保持し、男女Cを同じ方向へ追加。旧5〜5.5頭身/旧衣装へ戻していない。

**dot/Codexの正式納品は2D画像のみ。** 本人17:02 `Sentinel_b2789cd77240819194fdcc93430add48` の役割訂正でこちらの3D制作を停止。誤着手の全途中物89ファイルは同じMacのworktree外へ移し全SHAを照合、Git公開履歴head046553f3も保持。正式2Dパックと本PRの現在の差分へ3Dを含めない。[保持記録](3d-misstart-preservation.json)。Meshy/3D/rig/動き/陰影・輪郭線/組込みは元Claude担当。完了報告の保存は親が最終確認後に行う。

![6案一覧](lineup.png)

正式単体18枚は全て1254×1254の正式imagegen出力をバイト変更せずコピー。三面図6枚は2640×1280、一覧4800×1280。三面図/一覧は人物bbox切出し・等方拡縮・配置・文字のみで人物を加筆しない。Aポーズを広げたため一覧の列幅を800pxに確保し、手先の切れを修正した。前版の25PNG/6色表等は[candidates/superseded-six-20261014](candidates/superseded-six-20261014)へバイトを保持して移動。最新承認4原図は[attachment-style-review](candidates/attachment-style-review-20261014/README.md)内で不変。

## 6案と承認基準の対応

| ID | 基準/狙い | 正面 | 横 | 背面 | 三面図 | 色表 |
|---|---|---|---|---|---|---|
| walker-male-02a | 承認M-A：黄色スウェットの在宅カジュアル | [front](walker-male-02a-front.png) | [side](walker-male-02a-side.png) | [back](walker-male-02a-back.png) | [turnaround](walker-male-02a-turnaround.png) | [colors](walker-male-02a-colors.md) |
| walker-male-02b | 承認M-B：ミント半袖ハーフジップの軽い在宅服 | [front](walker-male-02b-front.png) | [side](walker-male-02b-side.png) | [back](walker-male-02b-back.png) | [turnaround](walker-male-02b-turnaround.png) | [colors](walker-male-02b-colors.md) |
| walker-male-02c | 追加C：コーラルカーディガンのきれいめ在宅服 | [front](walker-male-02c-front.png) | [side](walker-male-02c-side.png) | [back](walker-male-02c-back.png) | [turnaround](walker-male-02c-turnaround.png) | [colors](walker-male-02c-colors.md) |
| walker-female-02a | 承認F-A：緑スウェットと長スカートの在宅服 | [front](walker-female-02a-front.png) | [side](walker-female-02a-side.png) | [back](walker-female-02a-back.png) | [turnaround](walker-female-02a-turnaround.png) | [colors](walker-female-02a-colors.md) |
| walker-female-02b | 承認F-B：青ボートネックとワイドパンツのきれいめ在宅服 | [front](walker-female-02b-front.png) | [side](walker-female-02b-side.png) | [back](walker-female-02b-back.png) | [turnaround](walker-female-02b-turnaround.png) | [colors](walker-female-02b-colors.md) |
| walker-female-02c | 追加C：オートミール半袖ニットとローズパンツの在宅服 | [front](walker-female-02c-front.png) | [side](walker-female-02c-side.png) | [back](walker-female-02c-back.png) | [turnaround](walker-female-02c-turnaround.png) | [colors](walker-female-02c-colors.md) |

M-A時計は正面右/背面左、M-B腕輪は正面左/背面右、F-A白髪留めは正面右/背面左。F-B金円盤は前胸だけ、背面は細いチェーンだけ。Cは装飾を追加しない。M-B横のみ画面右向きで身体右側の腕輪を見せ、他5案は左向きの身体左側。白T裾はA/B男性・C男性・A/C女性に存在し、F-Bへ勝手に足していない。女性Aは本人の最新在宅服要求の長スカートで、旧膝上指定へ戻していない。

## 原寸の頭身とAポーズ検査

頭身は髪を含む頭頂〜顎と頭頂〜足底の実画素から計算し、顎輪郭の座標/RGBも保存。±1pxの境界不確かさがある。背面の顎は見えないため推測値を記入しない。袖外縁の角度はy400/520の局所投影角で、隠れた肩関節角の測定ではない。

| ID | 頭頂y | 顎(x,y) | 足底y | 頭高/全高px | 実測頭身 | 正面袖外縁 左/右° |
|---|---:|---|---:|---|---:|---|
| walker-male-02a | 14 | (618, 200) | 1226 | 186/1212 | 6.516129 | 34.670/37.174 |
| walker-male-02b | 12 | (618, 199) | 1222 | 187/1210 | 6.470588 | 35.311/33.358 |
| walker-male-02c | 14 | (618, 201) | 1224 | 187/1210 | 6.470588 | 30.964/30.964 |
| walker-female-02a | 23 | (618, 206) | 1217 | 183/1194 | 6.524590 | 30.611/31.661 |
| walker-female-02b | 21 | (620, 206) | 1216 | 185/1195 | 6.459459 | 37.174/37.476 |
| walker-female-02c | 22 | (620, 207) | 1220 | 185/1198 | 6.475676 | 35.628/36.254 |


三面図の完成PNG正面パネルも別に実測した。等方縮尺後の端数/AAにより原寸値と僅かに異なる。

| ID | 頭頂y | 顎(x,y) | 足底y | 頭高/全高px | 三面図実測頭身 |
|---|---:|---|---:|---|---:|
| walker-male-02a | 26 | (439, 211) | 1230 | 185/1204 | 6.508108 |
| walker-male-02b | 26 | (438, 212) | 1230 | 186/1204 | 6.473118 |
| walker-male-02c | 26 | (444, 212) | 1230 | 186/1204 | 6.473118 |
| walker-female-02a | 110 | (436, 282) | 1230 | 172/1120 | 6.511628 |
| walker-female-02b | 110 | (440, 284) | 1230 | 174/1120 | 6.436782 |
| walker-female-02c | 110 | (438, 283) | 1230 | 173/1120 | 6.473988 |

[final-inspection.json](final-inspection.json) に18画像寸法/bbox、6実測、構成変換/各SHAを保存。姿勢の狭い局所輪郭を見つけ、承認原図を保持したまま正式imagegenの姿勢のみ編集で明確な35〜45度Aポーズへ調整。正面の局所袖角は全て30〜45度に収まった。側/背も腕/袖と手の高さを合わせる編集を行ったが、生成された独立投影の手先位置等には数十px程度の残差があり、完全に同じ3D投影や骨格関節角とは主張しない。服・髪・配色・小物・全身/足底/手の形は18方向を実表示して確認した。[実表示QA](manual-qa.json)。

一覧は6px/cm、男性1032px=172cm、女性960px=160cm、全員足底y1132。完成PNGを再走査して72px=12cm差と手先の非切れを確認。三面図は7px/cmで男性1204px/女性1120pxを各3方向で共通にした。

## 生成・修正・権利

画像の制作・人物/姿勢の編集は正式 `image_gen.imagegen` とimagegen技能のみ。新しいCLI/APIキーや外部サービスに切替えていない。全指示/入力・出力SHA/採否は[production-generations.json](production-generations.json)。当工程33回＋承認基準4原図の元生成文章を記録し、正式採用18方向と比較用の履歴を区別。固有作品/キャラ名を生成指示へ含めず、具体的な人物/服/ロゴ/模様の複製を指示していない。元の外部参照画素をこの納品へ含めない。

低解像度の2ビュー試作1774×887は各887pxのため不採用。拡大で条件を満たしたとせず、正方形単体へ再生成。前の狭いポーズ18画像もMac原本を保持して正式採用数へ足さず、姿勢の一致を修正した。腕輪の色採取点が皮膚、靴下の点がパンツにかかっていた誤採取を修正。虹彩は瞳孔でなく色領域を再採取した。[colour-inspection.json](colour-inspection.json)。

[権利台帳](../../../../docs/legal/asset-sets-ledger.md) に公式[ROW Terms of Use](https://openai.com/policies/row-terms-of-use/)と[Services Agreement](https://openai.com/policies/services-agreement/)のContent/Ownership・Similarity条項を2026-10-14確認して記録。利用者とOpenAI間の法の許容範囲でのOutput帰属であり、独占性/第三者権利/参照権利の移転/非侵害を保証しない。公開再利用ライセンスは付与していない。

画素レベルではAA、低振幅のラスタ差、広い色面の微小な濃淡があり、全画素2色や背景の全画素均一を保証しない。細い輪郭と少数の大きな無地面/セル影を基準に確認。未実施：本人による新C/納品姿勢の最終選択、同一3D投影/隠れた関節角、素材物性、3D/rig/アニメ、アプリ/実室内/ブラウザ検査。3Dと本番の操作は停止したまま。

## 引渡し

[verify_deliverables.py](verify_deliverables.py) は現在の正式25PNG/6色表/6実測/原出力一致/姿勢/縮尺/基準原図・旧画像保持を検査する。正式6案一覧をMacの実ファイルから正式Libraryへ保存済み。`library_file_id: libfile_958eda43d7908191a1c635ab01097b5f`、`file_id: file_000000009250820e81d65968f56a407b`、サーバー名 `lineup(1).png`（同名衝突で付番）、3,374,345bytes。公式helperでメタデータを実ファイルへ書き戻し、Library読み戻しと原本のSHA256 `10690b0ab2f4aaaf7822096d4372f9f9a9d6fac8741a22034156705348eb963f` 一致を確認。[保存証跡](library-save-status.json)。旧6案Library `libfile_c50f1dff50c88191be9e01d40febb5a2`、承認4案Library `libfile_046fd46e92ec8191bed86b399fca949b` は履歴として保持。誤着手3D Libraryを2D引渡しに含めない。[正式引渡し一覧](handoff-manifest.json)は現行25PNG・6色表と検査/生成記録だけを指し、過去候補と3D途中物を採用に含めない。親が元Claude session `fbf688bf-1ba3-4478-bef4-3ba2070ab0ed` への完了条件・返送を最終確認する。
