# 浴室ドア・玄関収納追加

2026-09-09。既存配置・モデルを維持して追加。

- 浴室透明開き戸・折り戸：金属枠、パネル押縁、透明ガラス、中桟。既存の壁開口と開閉ピボットを使用。
- Blender独自制作の下駄箱3種：トール、カウンター付き、コの字。前面+Z、上+Y。扉目地、把手、天板、小口、台輪を造形。
- 素材色・艶と姿見ON/OFFを配置ごとに保存。姿見は環境マップ反射であり、室内を再描画する平面鏡ではない。
- 編集元 tools/blender/build_entry_storage.py、work/original/original-shoe-*.blend。
- メーカー提供の形状・画像・ロゴを取り込まず独自作成。実製品の型番・寸法保証は行わない。

参考（公式）：
- https://www.lixil.co.jp/lineup/bathroom/rechent-bathdoor/
- https://www.lixil.co.jp/lineup/livingroom_bedroom/genkan_closet/variation/

検証：bath-entry.browser.mjs（配置、保存、素材、姿見メッシュ、透明パネル枚数、開閉ピボット、開閉4画像）。original-models.test.cjs。各収納の前・後・色変更レンダーは detail-loop/entry-storage。
