# TPS walkthrough — draft for independent review

既存ウォークスルーに、明示的に選ぶFPS/TPS切替と家具操作を追加する試作です。**未レビューであり、ready-to-mergeではありません。人物・歩行・姿勢は服を着た手続き生成のplaceholderです。正式キャラクターとMixamoモーションは未取得です。**

## Scope and ownership

- 既存WALK入力・歩行衝突・床高・renderer・描画ループを再利用します。TPSは各editor/paneに1つの所有者を持ち、別controller/RAF/rendererを追加しません。
- cameraは連続volume castと実RoomGeometryの境界を使います。近接壁ではboomを縮め、短すぎる場合は仮人物を一時非表示にします。未検証形状・読み込み/再構築待ちは既存FPS表示へ戻します。材質のfadeや共有material変更は行いません。
- 薄い結合meshの開口をtriangle boundsで扱い、厚いsolidのcamera判定は保守的な全体boundsを維持します。
- ソファの明示socket、`original-shoe-tall`の既存「姿見」オプション、`original-bathtub`のみ対応します。近接＋明示操作で開始し、入力をロックして外側のWALK位置を保持します。移動/削除・floor/plan/view変更・pane終了時は既存ライフサイクルと安全な復帰位置を使います。
- 浴槽は既存GLBの実surfaceと仮人物の各部位を連続掃引します。縁の上を通る経路、低い天井、障害物、部屋境界を確認し、退出路が塞がった場合は解除を保留します。非表示の判定用仮人物は同じbuilderを再利用し、private資源だけを破棄します。
- socketはclone-local座標で、実matrixWorldにより回転・反転・寸法・床高を反映します。姿勢、socket、avatarはplan JSONへ保存しません。FPSが既定で、version 1のTPS preferenceはpane view stateだけに保持します。
- 共通変更は`index.html`の既存camera/scene/UI接続、`app-constants.js`のplan reset、`parallel-editors.js`のview preference/disposeに限定しています。GLTF loaderは変更していません。RPG asset-packや別のloader最適化は取り込んでいません。

## Limitations

姿勢切替は即時で、entering/posing timerは自然な跨ぎ・着座motionの再生ではありません。鏡の反射renderer、水、裸モデル、新しい階段移動、通常歩行の四肢collision/foot IKは追加していません。将来のrig/motionには別の接触・遷移検証が必要で、現在の仮人物のclearanceを流用できません。狭い形状では保守的に操作やTPS cameraを拒否します。正式素材の取得・課金・認証・raw Mixamo配布は行っていません。

退出できないactionは入力lockを維持し、人物を非表示にします。最後のaction座標・支持高は診断用に保持しますが、削除・移動済み家具の支持が残るとは扱わず、未検証のWALK位置へ人物を移しません。障害物を除いて「退出を再確認」するか、既存の「ウォークスルー終了」で編集表示へ戻れます。階/plan/view変更は既存のcontext resetへ渡します。非表示は安全な位置への復帰が完了したという意味ではありません。

## Reproduction

既存の完全checkoutとモデル資産が必要です。新たなモデルbinaryや実行ログ、画像、ブラウザprofileはこの差分に含めません。ブラウザーfixtureは各テスト内の合成プランだけを使用し、local origin以外と`/api/`への通信を遮断します。

```sh
node --test tools/tests/walk-tps-*.test.cjs
bash tools/run_tests.sh
SKIP_DEPLOY=1 bash build.sh
python3 -m http.server 8950 --bind 127.0.0.1
```

別ターミナルで、インストール済みPlaywrightとChromiumを使います（この手順にinstall/login操作はありません）。`CHROMIUM_PATH`、`PLAYWRIGHT_MODULE`、`EVIDENCE_DIR`は必要に応じて指定できます。出力先未指定時は一時ディレクトリを作ります。

```sh
for suite in mirror bath eye-height acceptance actions-panes integrated blocked-action; do
  APP_URL=http://127.0.0.1:8950 node "tools/tests/walk-tps-${suite}.browser.cjs" || exit 1
done
```

初回公開snapshot `a8b3ea6f` では全193 Node test files＋lint selftest、TPS subset 51 cases、選択した実Chromium 6 scripts・49 groups、非deploy buildが成功しました。独立レビューで見つかった「退出拒否中に削除済み家具のaction座標が未検証のWALK位置へ置き換わる」欠陥を後続修正し、`blocked-action` のNode/実ブラウザー回帰を追加しています。検証ログ・画像と途中履歴は別途保全しており、この修正もレビュー済みとは扱いません。

## Integration

基準はPR #72 head `0a1af8d3bcf47f1834128fa6dd15302397f22adf`です。mainとの差分にはPR72の変更が重なるため、まずPR72を採用/調整し、その後TPS固有差分をレビューしてください。mainへ直接mergeする準備ができたという意味ではありません。既存のbuild/deploy guard、CI/Cloudflare設定は変更しません。
