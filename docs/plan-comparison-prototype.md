# 案の比較：ローカル試作と次の提案

2026-10-01。`feat/local-plan-comparison`。main の `d41e98d` から開始。
公開・push・main 更新は行っていない。PR64 の変更は含まない。

## 今回のレビュー対象

キャンバス右下の「案を比較」から、現在のプランまたはJSONを名前付きで保存する。
左右のセレクトで保存した案を切り替える。「比較表示」で平面概略と内観3Dを選べる。

内観3Dは、既存アプリのシーン生成・素材・家具・開口・照明を使う実描画。
左案の部屋から自動配置した視点、または編集中の内観3Dの現在の視点を使い、
両案を同じ position / target / up / FOV / floor / viewport / pixel ratio / lighting で撮影する。
名前付きの3Dカメラも保存できる。左右の画像を1枚のPNGに保存でき、元JSONも書き出せる。
スマホでは画像を上下に並べる。平面モードには共通の拡大・移動・視点保存がある。

**3Dはアプリの素材プレビューであり、製品の実物色・物理的な採光を保証しない。**
既存の「内観3D」の表現を引き継ぐため、天井の省略・切り欠き等も同じ。
部屋からの自動視点は家具や間仕切りと重なる場合があり、その場合は編集画面の
内観3Dで見たい視点を作ってから「現在の内観3D視点を使う」を選ぶ。
最終的な壁紙の採用には実物サンプル・商品番号・施工条件の確認が必要。
平面モードは部屋と壁・仕上げ色の概略であり、家具・開口・質感は省略する。

レビュー画像は `tools/tests/fixtures/house-2f.json` の凍結サンプルと、
組み込み素材 `plaster_white` / 色 `#9CAD9F` を適用した説明用の派生案。
ユーザーの家や採用する製品を示すものではない。

## 保全の境界

- 比較保存先は `webcad-comparison-v1 / workspace / state`。既存 `webcad/plans` と別DB。
- IndexedDB の request 成功ではなく transaction 完了を待って一覧へ反映。
- 入力JSONの構造と座標を検証し、全内容を複製。既存の未知のプロパティも保持。
- 3Dは child-only の `index.html?comparisonPreview=1` iframe で実行する。
  起動時の既定プラン・保存プラン復元・共同編集開始を無効にする。
  プレビューの StorageAdapter は読み取りも書き込みもせず、API要求とWebSocketを拒否する。
- ライブエディタの DATA、ST、undo/redo、選択、カメラを入れ替えない。
  プレビュー専用DATAだけをクローンに差し替える。親の共同編集を切断しない。
- 1つのプレビュー用WebGLレンダラーが A → B の順に処理し、結果はPNGの img 要素にする。
  ライブエディタの既存レンダラーは別のまま維持する。
- モデル/テクスチャの読み込みと再構築が完了するまで待つ。失敗・時間切れは明示し、
  未完の画像を完成品として表示しない。damping / autoRotate / 通常描画ループを停止して撮影。
- プレビューでは非同期シェーダー先行コンパイルを使わない。
  破棄後のコンパイル待ちポーリングが解放済みプログラムに触れる問題を避ける。
- 閉じる・中止・案の連打は古い処理を無効化してiframeを破棄。古い結果を再表示しない。
- 編集用プランへの復元は未実装。必要な案はJSON書き出しで保持できる。

## 保存・平面色のレビュー修正

比較レコードは追加時に同一の readwrite transaction 内で最新データを読み、IDで合流する。古いタブの保存でも他タブの案・平面視点・3D視点を失わない。同じIDの内容が異なる場合は保存を中止する（名前変更・削除は未実装）。保存中に閉じて開き直しても、その処理が完了するまで操作を無効化し、完了後に続けて保存できる。閉じたパネルから新しい撮影は始めない。

平面概略の内壁色は、既存3Dと同じ全体連動 → 階連動 → 個別内壁色 → 既定色の優先順で解決する。平面は色の概略であり、テクスチャや面ごとの見え方は内観3Dで確認する。

## 次に作る範囲

1. 写真に近い採光が必要なら、天井・太陽・照明条件を含む専用の撮影モードを別途評価。
   今回の内観3Dと区別し、光の改善を材質の差に見せない検証を行う。
2. 案ごとに既存の6種の画像AI用入力マップ、JSON、指示文を共通視点でZIP出力。
   案名、視点名、設定、生成日時を紐付ける。AI入力パッケージとAI完成画像は別物。
3. IDhome に伝える採用候補・商品番号・適用する壁面のメモと比較画像をまとめる。
4. 案の名前変更・削除・一覧の整理、3D撮影結果のキャッシュを追加する。

## 検証と再現

- `node --test tools/tests/plan-comparison.test.cjs tools/tests/light-budget.test.cjs tools/tests/material-lifecycle.test.cjs tools/tests/fixture-only.test.cjs tools/tests/js-modules.test.cjs tools/tests/asset-version.test.cjs`
- `node tools/check-html-js.cjs`
- `PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright node tools/tests/plan-comparison-persistence.browser.cjs`（複数タブ・遅延保存・連動色）
- `python3 tools/dev_server.py 8931`
- `PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright node tools/tests/plan-comparison.browser.cjs`
- `PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright node tools/tests/plan-comparison-3d.browser.cjs`
- build.sh を確認後、`SKIP_DEPLOY=1 bash build.sh` で配信しないビルドだけ実行。

3Dブラウザ試験では、比較自体は本物のWebGL描画を行う。ソフトウェアGPUでの競合を減らし
カメラの不変性を測るため、テスト中の親エディタのアニメーションループだけを停止する。
本体の動作を停止するコードは製品には加えていない。
フル既存テスト一式やSafari・実端末の検証は未実施。

レビュー画像・撮影設定・テスト結果・ビルドログは `output/plan-comparison/`（git対象外）。
開発プレビューはこの環境の `http://localhost:8931`。外部公開URLは作っていない。
