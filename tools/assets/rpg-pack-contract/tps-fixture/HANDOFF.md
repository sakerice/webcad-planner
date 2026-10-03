# RPG → TPS 代表6点の接続fixture

TPS統合担当向け。基準モデルcommitは `d7a89c65a370146b74ecb8c5c8da670b41fce247`。この差分はmetadata・fixture・検査だけで、モデル／loader／TPS本体を変更しない。

## 確認済みと未確認

確認済み：実GLBの座面3点、支持面3点、材質・上向きtriangle・面積・GLB/source SHA、実editorの選択クローンへのraycast、未選択InstancedMeshとの一致、回転・非一様scale・反転・2階・127mm持上げ、変換height v2と旧通常h解釈との整合。

未確認：このcheckoutにはTPS runtimeがない。実actorのrequestSit、rig骨盤解決、approach path/障害物/occupied状態、着座・立上り・退出、runtimeでの署名変更解放はTPS担当で実行する必要がある。`renderer-contract-passed-TPS-host-pending` をTPS実連携完了と解釈しない。

## 接続データ

`assets/models/packs/rpg-mansion-contract/v0.2.0/` をv0.1.0に**追加**してassetId単位で読む。v0.2.0は旧14点を含む全置換ではない。旧sidecarは不変。

| asset | 読み取った面Y（モデルm） | 区別するもの |
|---|---:|---|
| wing-chair | seat 0.560681 | 木枠上面約0.404936、背/翼上端1.220、進入地面、rig骨盤とは別 |
| stool | seat 0.540 | 木枠0.390とは別。bboxも0.540だが実fabric triangleから測定 |
| sofa | seat 0.540 | 木枠0.390、全高1.120とは別。中心1席のみ候補 |
| dining-table | support 0.780 | native高さ730mmの変換では支持面も730mmへfit |
| coffee-table | support 0.450 | native高さ400mmの変換では支持面も400mmへfit |
| secretary | working surface 0.983 | 上部小棚の天面1.410を支持面として誤採用しない |

全レコードは `geometry-candidate-host-validation-required`。前はglTF +Z、upは+Y。yaw 0が-Zを向くactor規約では正面+Zはyaw π。骨盤offsetをmetadataに入れない。

`adapter.js` は手渡し用で、本体に登録していない。引数のmodelMatrixは実editorが作ったGLB-local→world行列（height v2含む）を渡す。fixtureでは実描画階層とInstancedMeshから取得する。座面法線はinverse transpose、前向きは方向変換、支持polygonは全頂点をworldへ変換する。進入候補のYは家具bottom/elevを流用せず、hostの地面解決関数が返す。地面未解決／revision不一致は拒否する。

## TPS担当の受入手順

1. `plan.json` を独立したfixture案として読み込む。元データを上書きしない。actorは明示的に2階の安全な開始位置から試す。1階actorからの要求はsame-floor条件で拒否する。
2. `adapter.js` の候補を既存TPS seat provider/requestSitへ接続する。hostが歩行経路、足元、クリアランス、同階、占有、退出を検査するまでreachableをtrueにしない。
3. rigの座面接触から骨盤を解決し、木枠参照点や家具bottomを骨盤位置として使わない。座面と靴/膝/肘の干渉を確認する。ソファの追加席は未定義。
4. width/depth/effectiveHeight/rotation/elev/floor、asset/socket revision、削除が変わったら署名を無効化して既存TPSの解放処理へ渡す。出口が塞がる場合の扱いも既存TPS方針で検証する。
5. candlestick/letter等を支持面へ載せる場合はprop底面、足跡polygonの包含、他部品との衝突を確認する。750mmの既定持上げを流用しない。fixtureの書記机作業面は983mmで233mm異なる。

## 再現

```sh
WEBCAD_PREVIEW_PORT=8947 python3 local-preview/server.py
python3 tools/assets/rpg-pack-contract/probe_expansion_surfaces.py
node tools/tests/rpg-seat-support.browser.cjs
python3 tools/blender/rpg_mansion/test_surfaces.py
node --test tools/tests/rpg-pack-contract.test.cjs
```

`world-results.json` は実rendererの測定結果。PNGは同rendererの形状と診断点（紫=座面/支持面、黄=木枠、青=host地面上の進入候補）を示す。点は可視化用にdepth test無効で重ねている。actor姿勢や到達性の画像ではない。

## 洋館一棟で不足するカテゴリ

- 階段・手すりと階間移動用の接続部材。
- 洋館の扉・窓・開口まわり（既存標準構造部材は維持）。
- 連続した調理カウンター、冷蔵設備に相当する機能付き家具。
- シャワー／小型洗面、用途に合う玄関の靴収納。
- 玄関ポーチ・外構の門扉／塀。

灯具・ベッド・机・収納の基本形状はあるが、照明効果や開閉、座面/寝面/支持面の残りの監査は別途必要。まず代表6点のTPS受入を行い、新モデル数を増やさない。
