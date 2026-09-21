#!/bin/bash
# Claude Code の PreToolUse フック。**本番を触るコマンドを、実行前に止める。**
#
# なぜ在るのか
# ------------
# 許可の仕組みだけでは足りなかった。.claude/settings.local.json に
# `Bash(npx wrangler *)` が許可として入っていたため、`wrangler deploy` が
# 確認なしで通った。さらに build.sh の末尾にデプロイが埋まっていたので、
# `bash build.sh` という「ビルドのつもりの1行」で本番が差し替わった。
#
# 許可の書き方は、コマンドを前方一致で見る。`cd x && npx wrangler deploy`
# のようにつなげた形や、スクリプトの中に隠れた呼び出しには当たらない。
# **ここは受け取ったコマンド文字列の全体を見る。**
#
# 止めるのは「本番の中身が変わる」操作だけ。調べるだけのもの
# (deployments list / versions list / whoami / tail) は通す。
#
# 出し方: 標準入力に Claude Code が渡す JSON。deny するときは
# permissionDecision に deny を返す（利用者が「許可」を選ぶ余地も無くなる）。
set -u
INPUT=$(cat)

# jq が無い環境でも動くようにする。JSON から command だけを取り出す。
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')
else
  CMD=$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')
fi
[ -z "$CMD" ] && exit 0

# 調べるだけのものは通す。**先に通す側を判定する**(deploy という語が
# `deployments list` にも入っているため)。
case "$CMD" in
  *"wrangler deployments"*|*"wrangler versions list"*|*"wrangler whoami"*|*"wrangler tail"*)
    exit 0 ;;
esac

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "\"$1\""
  exit 0
}

case "$CMD" in
  *"wrangler deploy"*|*"wrangler versions deploy"*|*"wrangler versions upload"*|*"wrangler pages deploy"*)
    deny "本番へのデプロイは止めました。人が端末から bash tools/deploy.sh を実行してください。build.sh はビルドだけを行います。" ;;
  *"wrangler rollback"*)
    deny "ロールバックも本番を差し替えます。人が端末から実行してください: npx wrangler rollback <バージョンID>" ;;
  *"wrangler secret"*)
    deny "本番の秘密の変更は止めました。人が端末から実行してください。" ;;
  *"wrangler d1 execute"*|*"wrangler r2 object delete"*|*"wrangler kv"*" delete"*)
    deny "本番のデータを触る操作は止めました。人が端末から実行してください。" ;;
  # **実行の形だけを止める。** 中身を読む・写す・文章に書く、は通す
  # (はじめは path を含むだけで止めていて、この方針を書いた文書の作成まで
  #  止まった)。
  *"bash tools/deploy.sh"*|*"sh tools/deploy.sh"*|*"./tools/deploy.sh"*|*"bash ./tools/deploy.sh"*)
    deny "本番へ出す手順は、端末から人が実行するものです。" ;;
esac

exit 0
