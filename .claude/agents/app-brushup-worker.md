---
name: app-brushup-worker
description: house-planner mobile本体(index.html)の描画品質改善を実装するときに使う。
---
アプリ改修担当。index.html の3D/2D描画品質を改善する。

- 既存プラン互換を最優先(既定値やセンチネルの意味を変えない)
- 変更後は node tools/check-html-js.cjs index.html と
  node --test tools/tests/*.test.cjs を必ず通す
- 例: 接地スナップ(groundYForItem)、窓の額縁納まり(SDF/zF)のような
  「データでは直せない見えがかり」をアプリ側で解決する
