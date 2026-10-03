# RPG pack 公開core

既存「日本建築標準」と「RPGアセット」の配置候補をpaneごとに切り替える。既存配置・ID・保存済みプランを変更しない。洋館50点は一棟の完全対応ではない。壁・開口・未対応設備は標準モデルを維持する。

公開treeにはruntime、GLB、配置用thumbnail/top画像、生成スクリプト、寸法・出典・材質・支持面の契約、軽量テストを含む。編集用Blenderファイル、背面レビュー画像、実行ログ・ブラウザQA画像は別アーカイブへ保全している。manifestの `sourceBlend` / `rear` は再生成先・出典追跡用のパスであり、配置UIに必要なruntime依存ではない。公開treeのコード・GLBは検証済み原本から変更しない。例外として配置用PNGから作業パス・撮影日時等のtext/EXIF chunkだけを除去する。画素とIDAT圧縮画像データは同一だが、PNGファイル全体のバイトは同一ではない。

## 再生成と検査

Blenderの既存model kitを使う。追加36点を再生成する場合：

```sh
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/expansion/build.py -- --no-icons
blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/previews.py
python3 tools/blender/rpg_mansion/test_pack.py
python3 tools/blender/rpg_mansion/test_surfaces.py
node --test tools/tests/asset-pack-registry.test.cjs tools/tests/asset-pack-conversion.test.cjs tools/tests/rpg-pack-contract.test.cjs
bash tools/run_tests.sh
SKIP_DEPLOY=1 bash build.sh
```

`test_pack.py` は配布GLB、寸法、UV、材質、重複面、法線、配置用画像を検証する。編集用sourceのアーカイブを復元した場合は、リポジトリと同じ相対パス構成を持つrootを `RPG_SOURCE_ARCHIVE` に指定すると、元のBlender・背面画像・sidecarのsource SHAも追加検証する。通常テストはアーカイブなしで実行できる。GLB検証を省略しない。

ブラウザテストは `APP_URL` でlocalhostのpreview先を指定できる。生成するQAデータはgitignore対象。`tps-fixture/adapter.js` は統合担当用の検査アダプターであり、runtimeに自動登録していない。

## 互換性と統合境界

変換はプレビュー後の独立コピーだけ。初期20件は装飾、308件は明示的な確認が必要。height v2は信頼済みsource/target/revisionと公称比0.25〜4倍を検証する。不正metadataは既定高さへfallbackしJSON自体を破棄しない。旧通常・v1は従来どおり。

seat/support v0.2.0は代表6点だけをv0.1.0へ追加する。骨盤、経路、到達性、占有、退出はTPS hostの検証が必要。loader/cancellation本体は変更していない。階段・手すり・扉窓・設備・外構の不足は次フェーズ候補として残す。
