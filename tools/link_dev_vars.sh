#!/bin/bash
# 読み取り(AI)を手元で動かすための秘密を、この作業場から見えるようにする。
#
# なぜ在るのか
# ------------
# `wrangler dev` は **wrangler.toml と同じ場所の .dev.vars** しか読まない。
# エージェントの作業場(.claude/worktrees/<名前>/)は使い捨てなので、そこに
# 秘密を置くと作業場ごと消える。実際、鍵を貼った作業場が消えて、次の作業で
# 同じところから始め直すことになった。
#
# **本体(webcad-planner/.dev.vars)に1つだけ置き、各作業場からは symlink で見る。**
# 実体が1つなので、鍵を入れ替えるときに探し回らなくてよい。
#
# .dev.vars は .gitignore 済み。symlink も同じ名前なので git には出ない。
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
# 作業場(.claude/worktrees/<名前>)なら3つ上、本体ならそこが本体。
case "$HERE" in
  */.claude/worktrees/*) ROOT=$(cd "$HERE/../../.." && pwd) ;;
  *) ROOT="$HERE" ;;
esac
REAL="$ROOT/.dev.vars"

if [ ! -e "$REAL" ]; then
  cat >&2 <<EOF
$REAL がありません。

読み取り(OpenAI / Vertex)の鍵をここに1つだけ置いてください。**本番と同じ
ものである必要はありません。**検証専用の鍵に使用上限を付けるほうが安全です。

  OPENAI_API_KEY="sk-..."
  OPENAI_MODEL="..."

Vertex を使うなら OPENAI_API_KEY の代わりに:

  GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}   # 1行にする
  VERTEX_PROJECT="..."
  VERTEX_LOCATION="asia-northeast1"

置いたら chmod 600 "$REAL" をしてください。
EOF
  exit 1
fi

if [ "$HERE" != "$ROOT" ]; then
  ln -sfn "$REAL" "$HERE/.dev.vars"
  echo "$HERE/.dev.vars -> $REAL"
else
  echo "$REAL があります"
fi

cat <<EOF

手元で読み取りを動かす:
  npx wrangler dev --local --port 8899

**--remote は付けなくてよい。** 付けると本番の利用回数と費用を実際に使う。
ローカルなら R2 は preview バケット、Durable Object もローカルになる。
ただし jev(env.AI = Workers AI)はローカルでは繋がらないので、jev を試すときは
wrangler.toml の [ai] に remote = true を足す(この値はデプロイ時には無視される)。
EOF
