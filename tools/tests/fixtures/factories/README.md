# 壁と物を作る関数の出力の記録

`golden.json` は、`mkWall` と `mkItem`(いまは `assets/js/plan-data.js`)が全種類について返す
中身の記録。段2で両関数を `assets/js/plan-core/` へ移したあとも、出力が1項目も変わらないことを
`tools/tests/factories-golden.browser.mjs` で確かめる。

## 何を記録しているか

- 種類: `ISIZES`・`FMP_ITEMS`・`LEGACY_FMP_TYPE_MAP` のキーの和に `no-such-type` を足したもの
- 各種類について `mkItem(type,100,200,90,2)` と `mkItem(type,0,0,0,1,1234,567)` の結果と、項目の並び。`id` は除き、`nextId` の進み(1)だけ見る
- `mkWall` の2通り(`_texObj` は除く)
- 基礎を1つ置いた状態の `exterior-stair` と `ramp`
- 階ごとの高さを ON、2階の壁の高さ 2600 での `mkWall`

`FMP_ITEMS` はモデルのカタログを非同期に読んで入るので、テストは件数が落ち着くまで待ってから集める。
記録した件数は `golden.json` の `counts` にある。カタログに種類を足す・消すと件数が変わって落ちる。

## 更新のしかた

**普段は更新しない。** 物の中身を意図して変えたとき(項目の追加・既定値の変更)か、カタログの種類が
増減したときだけ、理由をコミットメッセージに書いて作り直す。

    UPDATE_GOLDEN=1 PLAYWRIGHT_MODULE=… sh tools/run_browser_tests.sh factories-golden

「テストが落ちたから合わせた」で作り直してはいけない。関数を移したときの取りこぼしを、検査ごと通すことになる。

## カタログが増えたとき

比べるのは、記録と今のカタログの**両方に在る種類だけ**。家具のモデルを足した・外しただけでは落ちない
（比べなかった種類の数は、通ったときの出力に出る）。増えた種類も比べたいときは、上の手順で記録し直す。
記録し直す前に、既に在る種類の値が1つも変わらないことを `git diff` で確かめること。
