# 変換コピーの有効高さ修正

独立レビュー対象 e81704f はそのまま保存し、後続ブランチで修正した。旧実装は `item.h` を保持しても通常家具レンダラーがそれを使わず、変換先カタログ高さで表示していた。

新規変換時だけ `assetPackConversion.version: 2` と `heightPolicy: preserve-effective-height-v1` を記録する。`renderHeightMm` は元の editor `getItemHeightValue` から取得し、同じ getter を経由するクローン／インスタンス描画に渡す。保存済みの通常家具、手動配置した RPG 家具、version 1 の変換コピーの従来動作は変えない。元の `h` はデータとして保持する。version 1 の候補は元プランから作り直す必要があり、自動移行しない。

`node tools/tests/asset-pack-height.browser.cjs` は20件の既定対応について、実GLBを読み込み `buildItem3D` と `finalizeFmpInstancePools` が作るワールド bounding box を測る。選択中の通常クローン、未選択の InstancedMesh を実際に区別する。994/1800mmの鏡や2040mmのカーテンを含む異なる高さが同じ変換先でも保持される。保存後ページをリロードして IndexedDB の比較セットを開き直し、元案・コピーの両paneを再測定する。旧プラン、v1、不正メタデータのフォールバックも検証。

実測結果は `tools/assets/rpg-pack-contract/expansion-evidence/height-regression.json`。20件の変換後高さは getter とモデル bbox とも一致（許容0.02mm）。元プランのモデル固有設定は元の描画結果と比較し、挙動を変更しない。GLB loader／キャンセル経路は変更していない。

## P2: インポートされたv2メタデータの境界

`renderHeight` は信頼済み対応表のsource/target/revisionと実カタログを検証する。targetの公称高さに対する0.25〜4倍、有限の正規正数、`sourceEffectiveHeightMm`との一致が必要。未知source、別家具への偽対応、別revision、極小値5e-324、10kmなどはカタログ既定高さへフォールバックし、JSONを削除・書換えしない。通常/v1は従来どおり。正しいv2 JSONも従来どおり。

初回描画より前に同期scriptで読めるallow-listを既存 `conversion-map.json` と同じ生成元から作成する。新しいGLB loaderや非同期再描画を追加しない。Node回帰で生成表の完全一致を検査。ブラウザ回帰ではPlanSchemaを通過した不正metadataを実importし、クローン/InstancedMesh双方が1520mmの鏡へfallbackすることを測る。
