#!/bin/sh
# ブラウザで動かす検査 (tools/tests/*.browser.mjs) をまとめて走らせる。
#
# tools/run_tests.sh は node:vm の単体検査だけを走らせる。こちらは実物の
# ブラウザが要るので分けてある。Playwright はこのリポジトリの依存には入って
# いないので、npx のキャッシュから見つけて使う。
#
#   sh tools/run_browser_tests.sh                 # 全部
#   sh tools/run_browser_tests.sh render-fingerprint multi-selection   # 名前で選ぶ
set -e
cd "$(dirname "$0")/.."
PORT=${PORT:-8932}

# Playwright の場所。明示指定が無ければ npx のキャッシュから拾う。
if [ -z "$PLAYWRIGHT_MODULE" ]; then
  d=$(find "$HOME/.npm/_npx" -maxdepth 3 -type d -name playwright 2>/dev/null | head -1)
  # ESM からはディレクトリを import できないので入口のファイルを指す
  [ -n "$d" ] && PLAYWRIGHT_MODULE="$d/index.js"
fi
if [ -z "$PLAYWRIGHT_MODULE" ]; then
  echo "Playwright が見つからない。先に 'npx playwright install chromium' を一度実行してください。" >&2
  exit 1
fi
export PLAYWRIGHT_MODULE

# 検査用の静的サーバ。既に上がっていればそれを使う。
STARTED=0
if ! curl -sf -o /dev/null "http://localhost:$PORT/index.html"; then
  python3 -m http.server "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  STARTED=1
  trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -sf -o /dev/null "http://localhost:$PORT/index.html" && break
    sleep 0.5
  done
fi
export APP_URL="http://localhost:$PORT/"

if [ $# -gt 0 ]; then
  files=""
  for name in "$@"; do files="$files tools/tests/$name.browser.mjs"; done
else
  files=$(ls tools/tests/*.browser.mjs)
fi

fail=0
for f in $files; do
  [ -f "$f" ] || { echo "FAIL $f (無い)"; fail=1; continue; }
  if node "$f"; then
    echo "ok   $f"
  else
    echo "FAIL $f"
    fail=1
  fi
done
[ $STARTED -eq 1 ] && kill $SERVER_PID 2>/dev/null
echo "exit=$fail"
exit $fail
