# 個別壁高の表示専用仮設定（height contract v1）

`preview_patch.displayOverrides` はその呼出の complete replacement で、0件または1件だけ。
省略・空配列は editor 既定高へ戻す。前回の仮設定は暗黙継承しない。

必須フィールドは `sourceEntityId`, `field: "wallHeight"`, 数値 `valueMm`,
`source`, `reason`, `origin: "explicit-display-assumption"`, `sourceHash`,
`baseRevision`, `heightContractVersion: 1`。数値は有限の300–6000mm（両端含む）。
HeightModelの個別壁高範囲を使用し、globalの1800–4000mmとは分ける。
文字列・非数値・範囲外は拒否し、clampで成功扱いにしない。
定性的な「低い」から数値を生成する処理は無い。
`source` と `reason` は文字列・空白を除いて非空・500文字以内という形式だけを検査する。
記載内容の意味、根拠の妥当性、画像参照の正しさは検証しない。
sourceHash/baseRevision/version、対象壁・選択範囲・origin・数値範囲の検査とは別である。
`origin: "explicit-display-assumption"` は固定の表示仮定ラベルであり、
ユーザー指定・AI推測の機械的区別やcaller provenance認証を実装したものではない。

対象は明示 `selectedEntityIds` 内の実在wall1本。開口の明示host、unknown hostの
既存exact-span依存に接する壁は拒否。未選択・別collection・重複・未知field・
sourceHash/revision/version不一致・承認/実測偽装も拒否する。
`approvalState: "unreviewed"` と `sourceMeasured: false` はサーバーが固定し、
リクエストにそれらのフィールド自体を書いた場合も拒否。
原図の observed/inferred factsに高さを書き足さない。

optionsの正規化済みproposalをmaterializerが再検証し、wall生成時点にだけ個別壁高を設定。
compile後のplan後付patchは無い。source全体hash、proposal全内容、partial scope、
heightDefaults、floors、既定値とbinding/catalogue依存をreviewKeyに含める。
レビュー承認groupを渡してもdisplay overrideを含むcompileは `canApply:false`。
APIは常に `applyAvailable:false`, `fullReconstructionReady:false`。

`wallDisplays` は sourceHeight（未入力ならnull）、requestedHeight（proposal全内容）、
materializedWallHeightMm（生成時の値）、effectiveHeight（描画済みnative wall meshの
bbox高）、bbox（native world x/y-up/z、mm）、rendererContext を分けて返す。
床スラブ、段差、天井連動による差異を要求値の変更やsource実測と称さない。
2D表示やnative meshの無いcallbackではeffectiveHeightはnull、bboxもnull。
rendererContextにはwallHeight、既定高、天井連動、wallDisplayHeight、wallLift、
floorSlabHeight、baseSupportWorld、床設定を記録する。

wall diffのbeforeは同revisionで最後に成功した隔離表示。拒否・compile error・
stale・render failure・取消はbaselineを更新しない。
`displayOverrides:[]`による解除も、直前の成功した仮設定からの差分として返す。
隔離案はmemoryOnlyで既存保存guardを利用し、Apply・永続化は追加しない。

## 検証と範囲

今回の成果は「未承認の明示数値を既存壁高へ渡す隔離preview API」である。
原図から数値の妥当性を判断する機能や、高さ未定の可視化を完成させたものではない。
validatorは多階・段差依存を拒否していない。実ブラウザで確認したのは合成1階fixtureで、
その成功から多階での安全性や、仮設定が他の描画構造に影響しないことは保証しない。
実効高・bbox・床/天井contextを返すことと、依存影響の安全性を検証することは別である。

`sourceMeasured:false` と `unreviewed` はJSON/reportに含まれるが、
画像内にはそれらの専用表示を追加していない。画像共有には
「合成テスト／未承認の表示仮定／requested値とmesh高／原図再現未検証」のcaptionを添える。
各検証画像用captionは [wall-height-image-sharing-captions.md](wall-height-image-sharing-captions.md) に記録する。

原図に実測高さは未入力なので、Astraに数値候補を作る新実験はしていない。
合成fixtureの明示テスト値だけを使用。既存の両Astra台帳は2/2のまま保全。
今回の実験では原図へ数値overrideを追加せず、凍結結果の既存source-only部分も
記録どおり据え置く方針とした。これはAPI一般のsource-only保証ではない。
APIでは、overrideなしの明示選択壁がcompile可能ならeditor既定高で生成する。
有効な明示数値proposalも、未承認・表示専用・`sourceMeasured:false`として受け付ける。
新overlay・3Dghost・汎用parameter編集・
家具scale/material・外部MCP・token・paid calls・push/deployは作らない。

再現（完全なこのcheckout）:

```sh
node --test tools/tests/editor-internal-api-wall-height.test.cjs tools/tests/editor-internal-api.test.cjs tools/tests/editor-internal-api-lifecycle.test.cjs tools/tests/editor-internal-api-catalogue.test.cjs tools/tests/scene-material-api.test.cjs tools/tests/scene-ir-v3-materialize.test.cjs tools/tests/scene-catalogue-object-audit.test.cjs tools/tests/scene-catalogue-fixture-audit.test.cjs tools/tests/height-model.test.cjs
WEBCAD_PREVIEW_PORT=65354 python3 local-preview/server.py
APP_URL=http://127.0.0.1:65354 OUTPUT_DIR=/tmp/webcad-wall-height-native node tools/tests/editor-internal-api-wall-height.browser.cjs
```

ブラウザ検証は新しい専用Chrome profileを毎回作り、loopback以外と/api通信を拒否。
63239/65236および凍結実験ポートは使用しない。
