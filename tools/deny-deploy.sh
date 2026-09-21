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
# **本番へ出る経路は、wrangler だけではない。**
#
#   1. wrangler の配信コマンド             … 手元から直接
#   2. origin/main へのマージ / push        … Cloudflare Workers Builds が拾う
#   3. main への push(pv/storyboard 配下)   … .github/workflows/deploy-pv-storyboard.yml
#
# 2 と 3 は「デプロイ」という語がどこにも出てこない。`git push origin main` と
# `gh pr merge` が、そのまま本番の差し替えである。ここで一緒に止める。
#
# 止めるのは「本番の中身が変わる」操作だけ。調べるだけのもの
# (deployments list / versions list / whoami / tail / status / log) は通す。
# 枝への push と PR を作ることは通す（そこまでは本番に出ない）。
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

# ── main へ載せる操作 ────────────────────────────────────────────────
#
# **ここが本命の経路。** origin/main に commit が載った時点で、Cloudflare が
# 本番を差し替える。人の目に「デプロイ」と映らないので、いちばん危ない。
# build.sh は CI(WORKERS_CI)からの実行だけ配信する。**その名札を手元で
# 偽れないようにする。** `WORKERS_CI=1 bash build.sh` と打てば配信できて
# しまうので、この環境変数に触るコマンドごと止める。
case "$CMD" in
  *"WORKERS_CI"*)
    deny "WORKERS_CI は Cloudflare のビルド環境が入れるものです。手元で名乗ると配信が起きます。" ;;
esac

case "$CMD" in
  *"gh pr merge"*)
    deny "PR のマージは origin/main への反映＝本番デプロイです。人が実行してください。" ;;
  *"gh workflow run"*)
    deny "ワークフローの手動実行は公開物を差し替えます。人が実行してください。" ;;
  *"gh api"*"/merges"*|*"gh api"*"/merge"*)
    deny "API 経由のマージも本番デプロイです。人が実行してください。" ;;
esac

case "$CMD" in
  *"git push"*)
    # 枝への push は通す。**main へ向かう push だけ**を止める。
    case "$CMD" in
      *" main"*|*":main"*|*"main:"*|*"/main"*)
        deny "main への push は本番デプロイ(Cloudflare Workers Builds)を起こします。人が実行してください。" ;;
    esac
    # 宛先を書かない push は、いまの枝に出る。main に居るなら止める。
    #
    # **symbolic-ref を使う。** rev-parse --abbrev-ref HEAD は、コミットが
    # 1つも無いリポジトリで失敗し、枝名が空になる（検査で捕まえた）。
    BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" symbolic-ref --short HEAD 2>/dev/null || echo "")
    if [ "$BRANCH" = "main" ]; then
      deny "いま main に居ます。この push は本番デプロイになります。人が実行してください。"
    fi
    ;;
esac

exit 0
