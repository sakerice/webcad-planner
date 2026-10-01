# 案の比較：ローカル試作と次の提案

2026-10-01。`feat/local-plan-comparison`。main の `d41e98d` から開始。
公開・push・main 更新は行っていない。PR64 の変更は含まない。

## 今回のレビュー対象

キャンバス右下の「案を比較」から、現在のプランまたはJSONを名前付きで保存する。
左右のセレクトで保存した案を素早く切り替える。階・表示範囲・拡大率を共通にし、
名前を付けた平面視点を保存して呼び戻せる。左右の画像を1枚のPNGに保存でき、
それぞれの元JSONも書き出せる。スマホでは上下に並ぶ。

**これは平面比較の試作。壁紙を決定するための質感・光の評価には未対応。**
部屋の矩形と壁、床の色、壁の内側色を簡略表示し、壁の素材IDを添える。
家具・開口・テクスチャ・3Dの陰影・特殊な部屋形状は再現しない。
同じ色でも素材や光による違いはこの画像では判断できない。
色替えのレビュー画像は `tools/tests/fixtures/house-2f.json` のサンプルの派生であり、
ユーザーの家や採用する材料を示すものではない。

## 保全の境界

- `webcad-comparison-v1 / workspace / state` に保存。既存 `webcad/plans` と別DB。
- IndexedDB の request 成功ではなく transaction 完了を待って一覧へ反映。
- 入力JSONの構造と座標を検証し、全内容を複製する。未知の既存プロパティは保持。
- 比較用Canvas2Dで順番にPNGを作る。DATA、ST、履歴、選択、カメラ、共同編集へ書き込まない。
- doImport、markDirty、sharedForceFullSync は呼ばない。共同編集を切断しない。
- 保存失敗・transaction abort では案を追加しない。閉じた後のPNG出力はキャンセル。
- 案の切替はレビュー画面内のみ。編集用プランへの復元は未実装。
- ブラウザのデータ消去で失われるため、必要な案はJSON保存できる。

## 次に作る範囲

1. 3Dの読み取り専用シーン生成を編集ランタイムから分離。クローンしたプランを渡し、
   自動保存・共同編集・undo のない撮影専用ランタイムで順次処理する。
2. 共通カメラには position / target / FOV / up / floor / viewport / pixel ratio と
   照明・太陽条件を含める。モデルとテクスチャの読み込み完了を待ち、失敗は明示する。
   カメラ操作のdampingとautoRotateを止め、2案とも同一条件に固定する。
3. 1台の撮影レンダラーから順次PNGを生成し、比較画面には画像だけを並べる。
   閉じる・キャンセル・読込エラーで撮影ランタイムを破棄しても編集側に影響しない構造にする。
4. 案ごとに既存の6種の画像AI用入力マップ、JSON、指示文を同じ共通視点でZIP出力。
   案名、視点名、設定、生成日時を紐付ける。これはAI入力パッケージでありAI完成画像ではない。
5. IDhome に伝える採用候補・商品番号・適用する壁面のメモと比較画像をまとめる。

## 検証と再現

- `node --test tools/tests/plan-comparison.test.cjs tools/tests/js-modules.test.cjs tools/tests/fixture-only.test.cjs tools/tests/asset-version.test.cjs`
- `node tools/check-html-js.cjs`
- `python3 tools/dev_server.py 8931`
- `PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright node tools/tests/plan-comparison.browser.cjs`
- build.sh を確認後、`SKIP_DEPLOY=1 bash build.sh` で配信しないビルドだけ実行。

ブラウザ検証：保存、連打、JSON追加、共通視点の拡大・移動・復帰、同一案の画素一致、
不正JSON、quota failure、transaction abort、DATA/ST/undo/redo/共同編集状態の保持、
PNG生成キャンセル、Escape/再表示、PNGダウンロード、モバイル横はみ出し、再読込での永続化。
Chromium で pageerror は0件。フル既存テスト一式やSafari・実端末での検証は未実施。

レビュー画像とビルドログは `output/plan-comparison/`（git対象外）に保存。
開発プレビューはこの環境の `http://localhost:8931`。外部公開URLは作っていない。
