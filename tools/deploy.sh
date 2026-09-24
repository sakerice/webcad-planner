#!/bin/bash
# 本番へ出す。**人が、端末の前で、意図して実行するためのもの。**
#
# なぜ build.sh と分けたのか
# --------------------------
# build.sh の末尾にデプロイが入っていたため、「ビルドを確かめよう」と
# 思って実行すると本番が差し替わった。名前と結果が食い違うものは、
# いつか必ず間違って実行される。
#
# ここが守っていること
# --------------------
# 1. **端末からでないと動かない。** 標準入力が端末でなければ何もしない。
#    自動化・エージェント・CI からは通らない。
# 2. **出す中身を先に見せる。** 枝・コミット・未コミットの変更・宛先。
# 3. **打鍵を1つ求める。** `deploy` と打つまで進まない。
#
# 1 が肝心である。2 と 3 は人向けの確認で、自動実行を止めるのは 1 だけ。
set -e
cd "$(dirname "$0")/.."

if [ ! -t 0 ]; then
  cat >&2 <<'MSG'
本番へのデプロイは、端末から人が実行してください。

  bash tools/deploy.sh

自動実行（スクリプト・CI・エージェント）からは通しません。build.sh の末尾で
黙ってデプロイしていた頃に、検証のつもりの実行で本番が差し替わる事故が
起きています。
MSG
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')

echo "════════════════════════════════════════════"
echo " 本番へ出します"
echo "════════════════════════════════════════════"
echo "  枝          : $BRANCH"
echo "  コミット    : $COMMIT $(git log -1 --format=%s)"
echo "  未コミット  : $DIRTY 件"
echo "  宛先        : https://cad-planner.srapps.us"
echo
if [ "$BRANCH" != "main" ]; then
  echo "  ※ main ではありません。この枝の中身がそのまま本番になります。"
  echo
fi
if [ "$DIRTY" != "0" ]; then
  echo "  ※ コミットしていない変更が $DIRTY 件あります。それも出ます。"
  echo
fi

printf 'よければ deploy と打って Enter: '
read -r ANSWER
if [ "$ANSWER" != "deploy" ]; then
  echo "やめました。"
  exit 1
fi

bash build.sh
npx wrangler deploy
echo
echo "出しました。戻すときは:"
echo "  npx wrangler deployments list     # 1つ前のバージョンIDを調べる"
echo "  npx wrangler rollback <バージョンID>"
