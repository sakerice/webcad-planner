#!/bin/bash
# 読み取りの点数を1回測る。手元で本番と同じ Worker と画面を立て、図面を読ませて採点する。
#
#   bash tools/plan-eval/measure.sh <図面> <この測定の名前> <提供元> <モデル> [考える深さ]
#   例) bash tools/plan-eval/measure.sh madori-3f openai-1 openai gpt-6-astra
#       bash tools/plan-eval/measure.sh madori-3f opus-1 anthropic claude-opus-5-5 high
#
# **1回ごとに AI の費用がかかる**（3ページの図面で、読み取り＋見直しの最大6回）。
# 何回測るかは利用者と決めてから回すこと。jev と残高を共有している。
#
# 鍵は本体の .dev.vars から読む（tools/link_dev_vars.sh）。このスクリプトは鍵を
# 表示も複製もしない。Claude を測るには、そこに ANTHROPIC_API_KEY が要る。
set -eu
cd "$(dirname "$0")/../.."

FIXTURE=${1:?図面の名前}; LABEL=${2:?測定の名前}; PROVIDER=${3:?提供元 openai/anthropic}; MODEL=${4:?モデル}
EFFORT=${5:-}

bash tools/link_dev_vars.sh >/dev/null
SKIP_DEPLOY=1 bash build.sh >/dev/null

WRANGLER=""
for d in $(ls -dt "$HOME"/.npm/_npx/*/node_modules/.bin/wrangler 2>/dev/null); do WRANGLER="$d"; break; done
[ -n "$WRANGLER" ] || { echo "wrangler が見つからない。'npx wrangler --version' を一度実行してください。" >&2; exit 1; }

if [ -z "${PLAYWRIGHT_MODULE:-}" ]; then
  for d in $(find "$HOME/.npm/_npx" -maxdepth 3 -type d -name playwright 2>/dev/null); do
    if node -e "const p=require('$d');process.exit(require('node:fs').existsSync(p.chromium.executablePath())?0:1)" 2>/dev/null; then
      PLAYWRIGHT_MODULE="$d/index.js"; break
    fi
  done
fi
[ -n "${PLAYWRIGHT_MODULE:-}" ] || { echo "使える Playwright が見つからない。" >&2; exit 1; }
export PLAYWRIGHT_MODULE

PORT=8790
while curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/"; do PORT=$((PORT + 1)); done

VARS=()
if [ "$PROVIDER" = "anthropic" ]; then
  VARS+=(--var "AI_IMPORT_PROVIDER:anthropic" --var "ANTHROPIC_MODEL:$MODEL")
  [ -n "$EFFORT" ] && VARS+=(--var "ANTHROPIC_EFFORT:$EFFORT")
else
  VARS+=(--var "AI_IMPORT_PROVIDER:openai" --var "OPENAI_MODEL:$MODEL")
fi

# 回数の数え（Durable Object）は毎回まっさらな保存先で始める。手元の測定で
# 1日の上限に当たって止まらないように。本番の数えには触らない（手元だけの保存先）。
STATE=$(mktemp -d)
LOG="$STATE/wrangler.log"
"$WRANGLER" dev --port "$PORT" --persist-to "$STATE" "${VARS[@]}" >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null; rm -rf "$STATE"' EXIT INT TERM
for i in $(seq 1 120); do
  curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/" && break
  sleep 1
done
curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/" || { echo "手元の Worker が起動しなかった:"; tail -30 "$LOG"; exit 1; }

APP_URL="http://localhost:$PORT/" node tools/plan-eval/run.mjs "$FIXTURE" "$LABEL" --provider "$PROVIDER" --model "$MODEL"
