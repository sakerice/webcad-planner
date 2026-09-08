# モデル出典・利用条件の公開情報調査

調査日: 2026-09-08。適法性を保証する監査ではなく、公開情報とローカルmanifestの照合。購入履歴・取得当時の契約・作者の権利保有は未確認。モデルや公開UIは変更していない。

## Furniture Mega Pack（ローカル445点）

有力候補: dlgames「Furniture Mega Pack - Free」、製品ID330002。
https://assetstore.unity.com/packages/3d/props/furniture/furniture-mega-pack-free-330002
公式ページ: Standard Unity Asset Store EULA、無料、v1.0。ローカルはBeds/Chairs/Closets/Drawers/Sofas/Tables各50点、Bathroom35点、Kitchen110点。名前・構成から有力だが、購入/取得記録との完全照合は未了。同名の別作者製品もあるため名前だけで確定しない。

標準EULA https://unity.com/legal/as-terms
2.2.1は独自の機能・コンテンツを持つ製品への組み込みと改変・配布を認める。作者名の一律表示を求める条項は確認できない。2.2.1.1(c)はUGCを主目的とする製品内でのアセット収益化、(g)はAI関連利用に制約。本サイトの収益化とAIレンダーの具体的な利用形態について確認が必要。WebGLだから直ちに不可、画像をAIに送るから直ちに違反とは断定しない。

## Interior Model 0.26.1（ローカル240点）

販売元名 interior model。バージョン・配布ファイル名・240点の更新記載がローカルに一致。
https://superhivemarket.com/products/interior-model-0
製品のLicense欄「Creative Commons」のリンク:
https://superhivemarket.com/page/creative-commons-license
リンク先でCC BY 4.0を明示。
https://creativecommons.org/licenses/by/4.0/
この条件で提供されたコピーには作者・出典・ライセンス・変更表示が必要。商用利用・改変・共有を認める。車だけクレジットが必要という整理は誤り。

ArtStationにも同名・同バージョンの販売検索結果がありExtended Commercial License表示。ただし直接ページ取得は404。取得経路/時点によって適用ライセンスの確認が必要。現在のSuperhive表示だけで取得済みコピーの契約を確定しない。
https://www.artstation.com/marketplace/p/weJJk/interior-model-0-26-8-000-high-quality-3d-models
Downloadsの分割zipは存在確認。標準zipfileでは複数ディスク形式の一覧取得不可。同梱ライセンスは未確認。

## BMW M4 Competition M Package

原作者表記 SRT Performance、GLB内および再配布元でCC BY 4.0を確認。
https://github.com/lukaizj/car-mod-saas/blob/main/public/models/ATTRIBUTION.md
別の再配布元も同じ作者/CC BY 4.0を記載:
https://github.com/coopercodes/bmwGLB
原作品: https://skfb.ly/oyM8P
原作品の公開ページは取得できず、作者から直接のライセンス確認は未了。CC BYは商標権を許諾しないし権利非侵害保証でもない。ただし実車名・ロゴの存在だけで違法とは断定しない。

## 対応方針

公開クレジットはサイト共通ページにまとめ、素材ごとの条件を区別する。内部台帳では取得先・取得日・取得時ライセンス・購入記録・変更履歴を保持。購入履歴は公開不要。共通ページ作成だけで利用条件の未確認事項を解消したと扱わない。Unityの本サービス用途に関する問い合わせは未送信。

追加確認: Unity公式サポート（2025-07-02更新）は他エンジン利用を認める一方、利用者がrawアセットにアクセス・抽出できる形での配布を禁止と説明している。
https://support.unity.com/hc/en-us/articles/34387186019988-Can-I-use-assets-from-the-Asset-Store-with-other-engines
本サイトは assets/models/furniture_mega/glb/*.glb をブラウザから直接読み込む設計。この実装は公式説明との整合に具体的な懸念があるため、公開運用前に提供元またはUnityへWeb配信方法を含めて確認すべき。Draco圧縮やURL難読化だけでライセンス問題が解消するとは扱わない。
