#!/bin/bash
# Claude Code の PreToolUse フック。**本番を触るコマンドで、実行前に確認を出す。**
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
# 止め方は「拒否」ではなく「毎回たずねる」。
#
# もとは deny を返していた（利用者が「許可」を選ぶ余地も無くした）。
# 利用者の指示で、**本番は許可制**——毎回たずねる形へ変えた。
# permissionDecision に ask を返すと、確認の窓にコマンドがそのまま出るので、
# 何が起きるのかを見てから判断できる。
#
# **ゆるめたのは「誰が押すか」だけで、「黙って通らない」は変えていない。**
# 誤操作を止める仕組み（build.sh は CI の外で配信しない / deploy.sh は端末
# からしか動かない / 宛先を書かない push も main なら捕まえる）はそのまま。
#
# 出し方: 標準入力に Claude Code が渡す JSON。
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

ask() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":%s}}\n' \
    "\"$1\""
  exit 0
}

case "$CMD" in
  *"wrangler deploy"*|*"wrangler versions deploy"*|*"wrangler versions upload"*|*"wrangler pages deploy"*)
    ask "本番へのデプロイです。許可すればこのまま実行します。build.sh はビルドだけを行います。" ;;
  *"wrangler rollback"*)
    ask "ロールバックは本番を差し替えます。戻す先のバージョンIDを確かめてから許可してください。" ;;
  *"wrangler secret"*)
    ask "本番の秘密を変更します。許可すればこのまま実行します。" ;;
  *"wrangler d1 execute"*|*"wrangler r2 object delete"*|*"wrangler kv"*" delete"*)
    ask "本番のデータを変更します。許可すればこのまま実行します。" ;;
  # **実行の形だけを止める。** 中身を読む・写す・文章に書く、は通す
  # (はじめは path を含むだけで止めていて、この方針を書いた文書の作成まで
  #  止まった)。
  *"bash tools/deploy.sh"*|*"sh tools/deploy.sh"*|*"./tools/deploy.sh"*|*"bash ./tools/deploy.sh"*)
    ask "本番へ出す手順です。許可すればこのまま実行します。" ;;
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
    ask "WORKERS_CI は Cloudflare のビルド環境が入れるものです。手元で名乗ると本番へ配信されます。" ;;
esac

case "$CMD" in
  *"gh pr merge"*)
    ask "PR のマージは origin/main への反映＝本番デプロイです。許可すればこのまま実行します。" ;;
  *"gh workflow run"*)
    ask "ワークフローの手動実行は公開物を差し替えます。許可すればこのまま実行します。" ;;
  *"gh api"*"/merges"*|*"gh api"*"/merge"*)
    ask "API 経由のマージも本番デプロイです。許可すればこのまま実行します。" ;;
esac

case "$CMD" in
  *"git push"*)
    # 枝への push は通す。**main へ向かう push だけ**を止める。
    case "$CMD" in
      *" main"*|*":main"*|*"main:"*|*"/main"*)
        ask "main への push は本番デプロイ(Cloudflare Workers Builds)を起こします。許可すればこのまま実行します。" ;;
    esac
    # 宛先を書かない push は、いまの枝に出る。main に居るなら止める。
    #
    # **symbolic-ref を使う。** rev-parse --abbrev-ref HEAD は、コミットが
    # 1つも無いリポジトリで失敗し、枝名が空になる（検査で捕まえた）。
    BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" symbolic-ref --short HEAD 2>/dev/null || echo "")
    if [ "$BRANCH" = "main" ]; then
      ask "いま main に居ます。この push は本番デプロイになります。許可すればこのまま実行します。"
    fi
    ;;
esac

exit 0
