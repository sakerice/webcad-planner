# 互換テストの見本（本番の利用者の保存データ）

`tools/tests/plan-compat.browser.mjs` が使う。本番で使っている人が作ってきたプランが、
どの変更のあとも今と同じ中身で開けることを確かめるための見本。

| ファイル | 中身 |
|---|---|
| `saved-2f.json` | 本番の画面で既定の2階建てを開き、部屋名と家具1点に手を入れて「保存」したもの（IndexedDB に入った文字列そのまま） |
| `saved-3f.json` | 同じく3階建て |
| `legacy-quirks.json` | `saved-2f.json` に、長く使われてきた保存に混ざっている古い値を入れたもの: 文字列の壁厚、長さ0の壁、廃止された `tv`、旧カタログの扉、`id` の無い物 |
| `legacy-no-heights.json` | `saved-2f.json` から `heightDefaults`・`floors`・各壁の `wallHeight` を消したもの。高さの既定を保存するようになる前の古い保存の代わり。開くときに壁の高さの全体の値（`WALL_H`）を既定へ戻すか、先に開いていたプランから引き継ぐかで建つ高さが変わるので、その扱いが今と同じかを見る（2026-11-11 追加。他の3つが全部 `wallHeight:2688` を持っていたため、この差を見落とした）。`ONLY_DERIVED=1 node make_fixtures.mjs` で `saved-2f.json` から作る |
| `golden.json` | 上の3つを6通りに開いたときの指紋と、出荷物の既定プランを2通りに開いたときの指紋。テストはこれと突き合わせる。IndexedDB・localStorage・JSON読込・保存し直しの4通りは本番（main d41e98db）で記録した。残りの経路（下の表）は、後述の改修の前の main で記録した。`legacy-no-heights` の7通りは、開く経路を `normalizeLoadedPlan` にまとめる前のコード（ef9f8fd7）で記録した |
| `make_fixtures.mjs` | 見本の作り方。普段は流さない |

## 更新のしかた

**普段は更新しない。** 更新してよいのは、保存形式や読み込み時の変換を**意図して**変え、
その変更が今の利用者のデータに何をするかを確かめたうえで受け入れるときだけ。

    UPDATE_GOLDEN=1 sh tools/run_browser_tests.sh plan-compat

意図をコミットメッセージに書く。「テストが落ちたから合わせた」で更新してはいけない —
利用者のプランを開けなくした変更を、検査ごと通すことになる。

## 開き方の経路

| 経路 | 通す製品の関数 |
|---|---|
| `idb` | 起動時の `checkStorageOnInit` → `loadPlanFromStorage`（IndexedDB の保存） |
| `localStorage` | 同上（localStorage の保存） |
| `json` | 「読込」の `#import-file` |
| `idb-resave` | `savePlanToStorage` で保存し直してから、もう一度 `idb` で開く |
| `library` | `PlanLibrary.put` で保存一覧に入れ、`PlanLibrary.openList` の「開く」ボタン（`loadIntoEditor`）で開く |
| `shared-patch` | 空のプラン（`?preset=blank`）に、見本の壁・家具・部屋を丸ごと `upserts` にした patch を `applySharedPatch` で当てる。patch の `fields` は付けない |
| `shared-patch-fields` | 上と同じ空のプランに、送信側の `buildSharedPatch(プラン, null)` がそのまま作る patch（`fields` に `SHARED_FIELDS` の全部が入る）を当てる |
| `preset-2f` / `preset-3f` | 起動時の間取り選択の画面でボタンを押す（`choosePresetPlan` → `loadPreset`） |

`preset-2f` と `preset-3f` は見本を使わない。開くのは出荷物（`assets/default_plan.json`、`assets/default_plan_3f.json`）なので、
指紋は golden.json の `default-plan` に「改修前の main でそう開いた」記録として入っている。
**既定プランの中身を意図して直したときは、この2つの指紋も変わる。** そのときは更新してよいが、
直した内容と指紋の変化が合っているかを見てから更新する。

`shared-patch` は `fields`（`heightDefaults`、`floors` など）を渡さない。そのため `idb` などと違い、階ごとの高さ設定が付かず `floors` も空で開く。
これは今の `applySharedPatch` の動きの記録で、正しい開き方かどうかを決めたものではない。

## 指紋に入れているもの

壁・部屋・家具の座標と寸法、`heightDefaults`、選択画面、天井付け照明の取付面に付いたか、に加えて、開くときの補完が書き換えた結果を値のまま入れている:
外壁・内壁・屋根・`exteriorDetail` の設定、`floorMetadata` と階ごとの高さ（`DATA.floors`）の値、`WALL_H`、
壁・部屋・家具の補完対象フィールド、各配列の全フィールドのハッシュ、id の欠け・重複と次に振る番号、方位、
`viewState`・取り置きの視点・2D の拡大と位置。

視点について。検査は2D表示で開くので、3D のカメラ(`camera`)は null のまま記録されている。3D の実際の視点は見ていない。
他に覆えていないのは、補完が書き換える画面の入力欄（`syncHeightDefaultsUI`、`syncNorthUi`）。
実行ごとに揺れた項目は無かったので、外した項目は無い。
