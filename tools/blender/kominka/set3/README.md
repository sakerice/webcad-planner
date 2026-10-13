# 日本古民家・一体型台所

`kominka-kitchen-run-2560-01` / 一体型の台所（古民家） / 住設・cooktop。
左から研ぎ出し流しと真鍮蛇口、厚板の調理台、二口の漆喰竈・羽釜・木蓋。
引き出し、板戸、鍛鉄金物、低い背板を含む。外部モデル・写真・画像テクスチャは使用していない。

## 納品と実測

- `assets/models/packs/kominka/models/kominka-kitchen-run-2560-01.glb`
- 同 pack の `previews/` に透過512×512の thumb / top
- `sources/` に編集可能な `.blend` と `model_kit.run()` の検査記録
- `evidence/` に最終GLBから撮影した正面・背面と、第1弾流し／新台所／第1弾竈を同じシーン・照明で並べた1024×512比較画像
- `glb-reimport-validation.json`: 新しい Blender プロセスで最終GLBを読み直した検査
- `delivery-validation.json`: 独立GLBバッファ・画像実画素・再現性の検査
- `test-results.json`: カタログ検査と差分範囲の記録

実測 W2559.999943 × D649.999976 × H850.000024 mm、16,400 triangles、578,912 bytes。
glTF は正面+Z、上+Y、底面中心原点。Blender は正面-Y、上Z、単位m。
指定寸法に直接組み、全体の非等方スケール・`fit()`・`normalize_to()` は使わない。
羽釜の円形フランジは実測半径216 mm。再読込した頂点の半径ばらつきも検査している。
天板高さ690 mm、低い背板上端764 mm。総高850 mmには蛇口と木蓋の握りを含む。
火口は実際のアーチ形のくぼみ。9マテリアルを4つの色変更部位へ割り当てる。

| 部位 | 既定色 | 内部の濃淡・仕上げ |
|---|---|---|
| wood / 木部 | #5c412b | 煤けた木、#3b2b20 の枠・握り、#705039 の板 |
| stone / 石（研ぎ出し） | #85847c | 流し・火口石、灰床 #908f87 |
| plaster / 漆喰 | #d9d2c0 | 竈、火口内の煤 #30241e |
| metal / 金物 | #282a29 | 羽釜・取手・蝶番、真鍮 #897247 |

第1弾の共通制作関数を利用し、木・漆喰・石・鉄・真鍮の色／粗さ／金属度を引き継ぐ。
真鍮はこの依頼の4部位に合わせ `metal` にまとめる。材料ごとの `finishChannel` をGLB extrasに出力する。
UV は1層、退化UV／退化三角形0。`model_kit.run()` は閉じた辺・寸法・原点・UV密度・部位も検査した。

## 再生成と独立検査

リポジトリのルートで実行する。制作環境は本人の Mac、Blender 5.1.2。
以下の `python3` は numpy と Pillow が入った環境を使う。
今回の検査用環境は `/tmp/kominka-kitchen-venv/bin/python`。

```sh
# 納品場所へ再生成（manifestは通常変更しない）
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --factory-startup --python-exit-code 1 --python tools/blender/kominka/set3/build.py
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --factory-startup --python-exit-code 1 --python tools/blender/kominka/set3/render.py
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --factory-startup --python-exit-code 1 --python tools/blender/kominka/set3/glb_reimport.py

# 原本を保護して再現性を確認
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --factory-startup --python-exit-code 1 --python tools/blender/kominka/set3/build.py -- --output-root /tmp/kominka-kitchen-replay
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --factory-startup --python-exit-code 1 --python tools/blender/kominka/set3/render.py -- --root /tmp/kominka-kitchen-replay
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 1 --factory-startup --python-exit-code 1 --python tools/blender/kominka/set3/reexport.py -- --output-dir /tmp/kominka-kitchen-reexport
python3 tools/blender/kominka/set3/verify.py --replay-root /tmp/kominka-kitchen-replay --source-root /tmp/kominka-kitchen-reexport
node --test tools/tests/asset-sets.test.cjs
```

初回のみ `build.py -- --append-manifest` で新しい1行を追加できる。
既存IDがある場合は拒否し、既存行を書き換えない。
スクリプト再生成／保存原本再書き出しは納品GLBとSHA-256一致。
再生成GLBから撮ったthumb・top・正面・背面・比較画像は実画素がすべて一致した。
`.blend` ファイル自体のバイト一致は検査対象にしていない。

## 実施範囲と制限

独立GLBバッファ検査、Blenderでの独立再読込、最終GLBからのレンダリング、全画像の目視と画素／透過／余白検査、再現性、カタログテストを実施。
ブラウザ操作は禁止されているため実施していない。実行アプリでの配置・部位色変更・家具差し替えは検証していない。
Claudeがアプリ組込みとその統合検証を担当する。
既存モデル・既存manifest行・洋館・アプリコード・asset-sets.jsonは変更しない。
main push・マージ・デプロイ・認証変更・有料API利用はしていない。
Blenderはsandbox内でMetal初期化時にクラッシュしたため、同じMacで承認された実行権限を使った。

依頼原本: `claude/kominka-kitchen:docs/orders/2026-10-13-codex-kominka-kitchen.md`、blob SHA `7cce2dde555c8225c814e7ee9bf83692ab6925a8`。
共通条件: 同ブランチの `docs/orders/2026-10-13-codex-kominka-set-2.md`、blob SHA `eaec626ece41e1eff4de3273ca52a831323ea08c`。
依頼書自体は納品ブランチに追加していない。
