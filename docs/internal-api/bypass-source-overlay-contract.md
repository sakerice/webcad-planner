# 引違い戸の原図閉位置・参考線

成果は既存SceneSourceOverlayへの2本のline追加だけ。物理door-slideやCAD/3D rendererを追加しない。
共通primitives/render/draw/drawPreview、floor filter、report translationと既存保存codecを使用する。
新しいUIパネルは無い。追加線を出すgapのラベルは「原図の閉位置・移動未確認 [source]」。

根拠はsourcePreview.openingsに保存済みのtypedな `mechanism:bypass-slide` と
`leafRelation:bypass`。両方のfactがobserved/inferredの形式を満たし、gap端点が有限・非零、
独立したslide葉2枚に既知のclosedCenterと正の有限leafWidthMmがある場合に限る。
このtyped bypass関係をgap平行の**参考描画方向**の根拠にする。closedAxisが欠落している場合も、
物理軌道や正確な葉方向を認定したわけではない。明示closedAxisがあればunit/平行一致を検査し、
unknown、非平行、非unitなら追加線を出さず元gapの1本へ戻す。関係・中心・幅・根拠形式が
欠落/矛盾している場合も同じfallback。特定opening/leaf IDによる分岐は無い。
source/reasonはtyped factの形式確認で、画像参照の真偽や推論の意味を検証する機能ではない。

各参考線は独立した閉中心からgap単位方向に±leafWidthMm/2。
厚さを使わず、既存1.5pxの破線strokeだけ。36mm矩形・fixed/movable指定・open=closed・travel0は生成しない。
primitiveのreferenceOnly/sourceFactStatus/parallelBasisは表示由来であり、原factのstatusは変更しない。
openCenter/travelDirection/travelDistance/thickness/height/sill等のunknownはそのまま残る。

固定rawのbyte SHA256は `c98e9213665b0527fae907a19d145d8a038db8f82bd049c57b74607add05485c`。
座標は原図からの**inferred**値で実測を意味しない。

| 参考対象 | start mm | end mm |
| --- | --- | --- |
| 原gap | (5560,2275) | (7200,2275) |
| 850mm葉1の閉位置 | (5565,2245) | (6415,2245) |
| 850mm葉2の閉位置 | (6345,2310) | (7195,2310) |

端の5mm差・葉の重なり・track offsetを残し、閉鎖や通行可能性は保証しない。
壁なし階段入口は元gap参考だけで、hostを作らずrequiredTraversableを書き換えない。
unsupported診断・unresolved/再現件数・canApply/fullReady・物理items/walls・wall cut/walk/animationは変更しない。

## 検証の範囲

Nodeで欠落fallback、独立幅、非ハードコードID、明示軸、報告JSON codec、mapped/partial、floor/translation、
原source/hash・compile/Apply不変を確認。Chromeは専用65355・新profileのみで、
既存native 2D editorの実draw2d、描画stroke/位置、部分report、floor、translation、
専用PlanRepositoryLab namespaceへの実保存→fresh reader→native installを検証する。
保存用fixture namespaceを除去後、元ホストDATA/history/redo/dirty/source/optionsと全storageを比較する。
画面座標は浮動小数演算差を1e-8px以内、raw端点は厳密一致で確認する。
この工程にAstra candidate previewやApply、AI/paid callsは無い。両台帳は2/2のまま保全する。

再現（完全checkout）:

```sh
node --test tools/tests/scene-source-overlay.test.cjs tools/tests/scene-source-bypass-overlay.test.cjs tools/tests/scene-ir-v3-routing.test.cjs tools/tests/scene-ir-v3-materialize.test.cjs tools/tests/editor-internal-api.test.cjs
WEBCAD_PREVIEW_PORT=65355 python3 local-preview/server.py
APP_URL=http://127.0.0.1:65355 OUTPUT_DIR=/tmp/webcad-bypass-overlay node tools/tests/scene-source-bypass-overlay.browser.cjs
```

## 画像共有caption

3画像（01-closed-position-reference.png / 02-translated-reference.png / 03-saved-reloaded-reference.png）には
次を添えて共有する。画像内のラベルだけでは詳細な限界すべてを表さない。

> 原図参考線（inferred、未解決）／gapと850mm葉2枚の閉位置のみ／移動・固定/可動・厚さ・高さ・閉鎖・通行未確認／物理door未生成／原図の正確な再現は未検証。平行移動・保存読込の工程でも、この参考表示の意味は変わらない。
