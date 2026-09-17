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
#
# キャッシュには複数のバージョンが残っていることがあり、**そのうち一部は
# ブラウザ本体をダウンロードしていない**。ただ見つけた順に使うと
# 「Executable doesn't exist」で落ちる。ブラウザ本体まで在るものを選ぶ。
if [ -z "$PLAYWRIGHT_MODULE" ]; then
  for d in $(find "$HOME/.npm/_npx" -maxdepth 3 -type d -name playwright 2>/dev/null); do
    # ESM からはディレクトリを import できないので入口のファイルを指す
    if node -e "
      const p=require('$d');
      const fs=require('node:fs');
      process.exit(fs.existsSync(p.chromium.executablePath())?0:1);
    " 2>/dev/null; then
      PLAYWRIGHT_MODULE="$d/index.js"
      break
    fi
  done
fi
if [ -z "$PLAYWRIGHT_MODULE" ]; then
  echo "使える Playwright が見つからない。'npx playwright install chromium' を一度実行してください。" >&2
  exit 1
fi
echo "Playwright: $PLAYWRIGHT_MODULE"
export PLAYWRIGHT_MODULE

# 検査用の静的サーバ。**必ず自分で立てる。空いているポートを探す。**
#
# 以前は「既に上がっていればそれを使う」作りだった。この作業ディレクトリを
# 複数 (git worktree で別のブランチを同時に見るなど) 開いていると、
# 先に立っていた**別のディレクトリのサーバ**に当たり、そちらの index.html を
# 検査してしまう。落ちないぶん質が悪い——直したはずの不具合がまだ出る、
# 直していない不具合が消える、という形で現れる。
if [ -n "$APP_URL" ]; then
  STARTED=0                      # 呼び出し側が場所を指定したときは従う
else
  STARTED=0
  for try in $(seq 0 20); do
    candidate=$((PORT + try))
    # そのポートに何か居るなら次へ
    curl -sf -o /dev/null --max-time 1 "http://localhost:$candidate/" && continue
    python3 -m http.server "$candidate" >/dev/null 2>&1 &
    SERVER_PID=$!
    sleep 0.3
    if curl -sf -o /dev/null --max-time 2 "http://localhost:$candidate/index.html"; then
      PORT=$candidate
      STARTED=1
      trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
      break
    fi
    kill $SERVER_PID 2>/dev/null
  done
  if [ $STARTED -eq 0 ]; then
    echo "静的サーバを立てられませんでした ($PORT 番から20個試しました)" >&2
    exit 1
  fi
  export APP_URL="http://localhost:$PORT/"
fi
echo "検査対象: $APP_URL ($(pwd))"

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
