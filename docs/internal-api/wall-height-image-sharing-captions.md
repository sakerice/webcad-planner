# 壁高検証画像を共有するときのcaption

画像内には `sourceMeasured:false` / `unreviewed` の専用表示が無い。
以下を画像に添えて共有する。mesh高は実ブラウザbboxの測定値をmmに丸めた概数で、
原図の実測高さではない。今回の検証は合成1階fixtureのみで、多階安全や他構造不変を保証しない。

| 画像 | 添付caption |
| --- | --- |
| native-height-300.png | 合成1階テスト／未承認の表示仮定・非実測／requested 300mm、mesh高 約480mm（床厚込み）／原図再現未検証 |
| native-height-6000.png | 合成1階テスト／未承認の表示仮定・非実測／requested 6000mm、mesh高 約6180mm（床厚込み）／原図再現未検証 |
| native-height-1100.png | 合成1階テスト／未承認の表示仮定・非実測／requested 1100mm、mesh高 約1280mm（床厚込み）／原図再現未検証 |
| native-height-1500.png | 合成1階テスト／未承認の表示仮定・非実測／requested 1500mm、mesh高 約1680mm（床厚込み）／原図再現未検証 |
| native-height-default-cleared.png | 合成1階テスト／未承認のeditor既定表示・非実測／requested 指定なし（override解除・editor既定2400mm）、mesh高 約2580mm（床厚・天井連動）／原図再現未検証 |

`origin: explicit-display-assumption` はcaller provenance認証ではなく、
ユーザー指定とAI推測を機械的に区別するものでもない。
画像から根拠の意味・数値の原図妥当性を認定しない。
