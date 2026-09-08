# 自動車品質更新（2026-09-08）

AGENTS.md / agent.md による停止指示はリポジトリ・祖先ディレクトリに見つからなかった。前回の停止は進行判断の誤り。

自作ハッチバックの試作は接合・曲面品質が低く不採用。参照画像と同車種の再現ではなく、精密な BMW M4 Competition M Package を採用し、Blenderで座標・寸法・塗装・窓を調整した。新規配置の幅2083mmはミラー込み、長さ4790mm。保存済み配置の寸法は上書きしない。

原作者 SRT Performance、CC BY 4.0。配布元と原作品、変更内容は assets/models/refined/precision-car-credits.html に記載し、車のプロパティから開ける。GLB内にも元の作者・ライセンス・出典を保持。

再現:
1. Blenderで tools/blender/prepare_precision_car.py を実行。
2. GLTF_TRANSFORM_BIN を glTF Transform 4.2.1 CLIに指定し tools/assets/package_precision_car.py を実行。
3. MODEL_FILTER=context-car で tools/assets/render_model_previews.mjs を実行。

圧縮: 簡略化なし。重複・未使用データ整理、元解像度のlossless WebP、Draco position16 / normal14 / UV14。最終3,019,612 bytes。Blender書き出し後の形状を保ち、元モデル自体のローポリ化は行っていない。

検証画像は同じブラウザ・カメラ・照明条件の before-browser.png / after-browser.png / rear-browser.png。WebGLの描画呼び出しは102→32。描画三角形は81,126→202,263（透明面の追加描画を含む）、テクスチャ数2→9。CPUコマンド送信時間は参考値でありGPUフレーム時間・モバイルFPSではない。ブラウザ例外なし。正面+Z、底面0、塗装色変更時に窓・タイヤを着色しないことを確認。

造形の品質は旧モデルから大きく改善。参考画像のハッチバックとは車種が異なる。モバイル実機のGPU計測は未実施。
