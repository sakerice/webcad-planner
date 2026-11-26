# 公開の申請に要るページと設定

作った日: 2026-11-26。Claude のコネクタの一覧、公式 MCP Registry、ChatGPT のアプリの一覧、App Store に出すときに求められる、
プライバシーポリシー・利用規約・サポートのページと、ドメインの確認用のファイル、MCP Registry 用の `server.json` の置き場と手順をまとめる。

文面は弁護士の確認を受けていない。公開の前に、運営者が自分で読んで確かめる。
外部の一覧への登録・申請は、この文書を書いた時点では何もしていない。

## 1. 何がどこにあるか

| 物 | 置き場 | 配られる URL |
| --- | --- | --- |
| ページの本文（日本語・英語） | `legal/pages/<privacy\|terms\|support>.<ja\|en>.html` | `/privacy`・`/terms`・`/support`、英語は `/en/privacy`・`/en/terms`・`/en/support` |
| 運営者が決める値 | `legal/site.json` | 本文の `{{operatorName}}` などに入る |
| 書き出しの道具 | `legal/build.cjs`（`build.sh` が呼ぶ） | `dist/privacy.html` などを作る |
| ドメインの確認用のファイル | `legal/site.json` の `openaiAppsChallenge`・`mcpRegistryAuth` | `/.well-known/openai-apps-challenge`・`/.well-known/mcp-registry-auth` |
| MCP Registry 用の下書き | `docs/mcp-registry/server.json` | 配らない（登録の道具に渡すファイル） |

ページは静的ファイルで、Worker（`worker/router.mjs`）は通らない。`dist/privacy.html` は、Cloudflare の静的アセットが `/privacy` で返す
（`/privacy.html` で開いても `/privacy` に移る）。見出し（`_headers` の `/*`）はアプリの画面と同じ物が付く。
ページは外から何も読み込まない（字は端末の字、絵はこのサイトのアイコンだけ）。

英語版を作ったのは、OpenAI と Anthropic の審査の担当が読めるようにするため。OpenAI の申請の文書は、掲載文について「Keep English text in the base listing fields.」と書いている
（ https://developers.openai.com/plugins/deploy/submission 。2026-11-26 に読んだ）。ページそのものの言語の決まりは、OpenAI にも Anthropic にも見つからなかった。

## 2. 運営者が入れる値（`legal/site.json`）

`null` の欄を、運営者が決めた値に書き換える。

| 欄 | 何に使うか | 書き方 |
| --- | --- | --- |
| `operatorName` | 3ページの「運営者」の表示。OpenAI は、ページが申請の名義と同じ運営者を示すことを求める（「identify the same publisher as the submission」） | 文字。屋号でも個人名でもよい。日本語版と英語版に同じ文字が入る |
| `contactEmail` | 問い合わせ先。Anthropic はプライバシーポリシーに連絡先を、各社はサポートの連絡先を求める | メールアドレス |
| `effectiveDate` | プライバシーポリシーと利用規約の制定日 | `2026-12-01` の形 |
| `governingLaw.ja`・`governingLaw.en` | 利用規約の 9 章「この規約は ○○ に従います」「governed by ○○」 | 文に入る語句。例の形: 「日本法」と「the laws of Japan」 |
| `jurisdiction.ja`・`jurisdiction.en` | 利用規約の 9 章「○○ を第一審の専属的な合意管轄裁判所とします」 | 文に入る語句。例の形: 「△△地方裁判所」と「the △△ District Court」 |
| `openaiAppsChallenge` | ChatGPT のアプリの申請の、ドメインの確認（3 章） | OpenAI の画面が出す文字列。無い間は `""` |
| `mcpRegistryAuth` | 公式 MCP Registry の、ドメインでの確認（4 章） | `v=MCPv1; k=ed25519; p=…` の1行。無い間は `""` |

入れたあとに `node legal/build.cjs --check` を実行すると、足りない欄と形の誤りが出る。

### 値が入るまでの動き

- 手元のビルド（`SKIP_DEPLOY=1 bash build.sh`）は、ページを「下書き」として書き出す。上端に下書きの帯が出て、未設定の箇所が【未設定：運営者の名前】のように表示される。
- 本番のビルド（Workers Builds）は、必須の欄が1つでも `null` なら、ページを書き出さない。`/privacy` などは今までどおり「ページが見つかりません」になる。ビルドは止めない。
- `tools/tests/legal-config-ready.test.cjs` は、値が入るまで落ちる。`sh tools/run_tests.sh` と GitHub の検査が赤くなるので、値が入るまで main に入れない。
- `openaiAppsChallenge` と `mcpRegistryAuth` は必須ではない。空の間は、そのファイルを置かない（404）。

## 3. ChatGPT のアプリの申請: ドメインの確認

OpenAI は、確認用の文字列を `https://<MCP のホストか親ドメイン>/.well-known/openai-apps-challenge` に、文字列だけで置くことを求める
（「host the exact challenge token as plain text」「Return only the exact token—not JSON or a list of tokens.」。出典は 1 章と同じページ）。

1. 運営者が、OpenAI Platform の申請の画面で MCP サーバー（`https://cad-planner.srapps.us/api/mcp`）をつなぎ、画面が出す確認用の文字列と、置き場の URL を控える。
2. その文字列を `legal/site.json` の `openaiAppsChallenge` に入れる（前後の空白なし）。
3. PR を作って main に入れる（本番に出る）。`https://cad-planner.srapps.us/.well-known/openai-apps-challenge` を開き、文字列だけが出ることを確かめる。
4. 運営者が、OpenAI の画面で確認を進める。

画面が `srapps.us`（親ドメイン）の URL を示した場合は、このリポジトリでは置けない（`srapps.us` は別のサイト）。その場合は `cad-planner.srapps.us` を選び直せるかを画面で確かめる。

申請の欄に入れる URL。

| 欄 | 値 |
| --- | --- |
| `websiteURL` | `https://cad-planner.srapps.us/` |
| `supportURL` | `https://cad-planner.srapps.us/en/support` |
| `privacyPolicyURL` | `https://cad-planner.srapps.us/en/privacy` |
| `termsOfServiceURL` | `https://cad-planner.srapps.us/en/terms` |

Claude のコネクタの一覧（ https://claude.com/docs/connectors/building/submission ）は、説明文書の URL・プライバシーポリシーの URL・サポートの連絡先を求める。
説明文書の URL には `/en/support`（AI アプリからの使い方を書いてある）、プライバシーポリシーには `/en/privacy` を入れる。

## 4. 公式 MCP Registry: `server.json` と名前空間の確認

書式は 2026-11-26 に原文で確かめた（ https://modelcontextprotocol.io/registry/quickstart 、
https://modelcontextprotocol.io/registry/remote-servers 、https://modelcontextprotocol.io/registry/authentication 、
スキーマ https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json ）。Registry は「currently in preview」と書いてあり、書式は変わりうる。登録の前にもう一度見る。

- 必須は `name`・`description`（100 字まで）・`version`。遠隔だけのサーバーは `remotes` に `type: "streamable-http"` と `url` を書き、`packages` は要らない。
- `repository` は任意なので、リポジトリを公開しなくても登録できる。下書きには書いていない。
- `name` の前半（名前空間）は、確認の方法で決まる。

| 確認の方法 | 名前 | 運営者がすること |
| --- | --- | --- |
| HTTP（下書きはこれ） | `us.srapps.cad-planner/house-planner` | 鍵を作り、公開鍵の1行を `legal/site.json` の `mcpRegistryAuth` に入れて本番に出す。秘密鍵は手元に置く |
| DNS | `us.srapps/house-planner` | `srapps.us` の頂点に TXT を足す（Cloudflare のダッシュボード） |
| GitHub | `io.github.<GitHub のユーザー名>/house-planner` | `mcp-publisher login github` でブラウザから認証する |

HTTP を下書きにしたのは、名前が受け口と同じドメインになり、DNS を触らずにこのリポジトリだけで済むため。
公式の説明も、遠隔の URL が自分のドメインにあるならドメインでの確認を勧めている。Registry は遠隔の URL の持ち主かどうかは確かめない。
別の方法にするなら、`docs/mcp-registry/server.json` の `name` を上の表の名前に変える（検査 `tools/tests/legal-pages.test.cjs` の名前空間の行も合わせる）。

### 登録の手順（運営者が行う。ここまでは何も登録していない）

1. 鍵を作る。macOS に入っている `openssl` は Ed25519 を作れないので（公式の説明に注意書きがある）、`brew install openssl@3` で入れた物を使う。秘密鍵（`key.pem`）はリポジトリに入れない。

   ```sh
   openssl genpkey -algorithm Ed25519 -out key.pem
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}"
   ```

2. 出た1行を `legal/site.json` の `mcpRegistryAuth` に入れ、main に入れて本番に出す。`https://cad-planner.srapps.us/.well-known/mcp-registry-auth` でその1行が出ることを確かめる。
3. `mcp-publisher` を入れ、ドメインで認証する。

   ```sh
   PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
   mcp-publisher login http --domain "cad-planner.srapps.us" --private-key "${PRIVATE_KEY}"
   ```

   Registry は自分の側からこのファイルを取りに来る。手元の `curl` で見えても、Cloudflare のボット対策で Registry が弾かれると `token exchange failed with status 401` で失敗する（公式の説明の注意書き）。
4. `docs/mcp-registry/` で `mcp-publisher publish` を実行する。人の審査は無く、すぐ載る。
5. 版を上げるときは、`worker/mcp.mjs` の `SERVER_INFO.version` と `server.json` の `version` を同じにして、もう一度 `publish` する（検査が2つの版の一致を見ている）。

`server.json` の `websiteUrl` は `/support` を指している。ページが本番に出る前に登録すると、リンク先が「ページが見つかりません」になる。

## 5. App Store

App Store Connect は、プライバシーポリシーの URL（必須）とサポートの URL（必須）を求める。日本だけに配信するなら、日本語の `/privacy` と `/support` を入れる。
アプリ版（Capacitor）は、ページの出どころが `capacitor://localhost` なので、画面のリンク（`privacy` などの相対の道）がそのままでは開かない。
アプリ版を作るときに、`https://cad-planner.srapps.us/privacy` を外のブラウザで開くよう差し替える。
アプリ版で広告（AdMob）を出すときは、プライバシーポリシーの 5 章に AdMob の行を足す（いまの本文は Web 版がしていることだけを書いている）。

## 6. 本文に書いた事実と、コードの根拠

本文を変えるとき・コードを変えるときは、ここを見て両方を合わせる。行番号は 2026-11-26 の main のもの。

| 本文に書いたこと | 根拠 |
| --- | --- |
| ログインが無い。当方は Cookie を保存しない | `index.html` に `type="password"`・`type="email"` の欄が無い。`document.cookie` を使う箇所が `index.html`・`assets/js` に無い |
| 間取りはブラウザの中（IndexedDB）に保存する | 前回のプランは `assets/js/app-state.js` 2303 行（`DB_NAME='webcad'`）。名前を付けた一覧は `assets/js/plan-library.js` 14 行（`'webcad-library'`）。一覧から消す操作は同 68 行（`remove`） |
| 共同編集で開いた間取りの写しを 5 件まで残す | `assets/js/app-state.js` 2311 行（`ROOM_KEEP=5`） |
| 表示名と画面の設定をブラウザに残す | `index.html` 16881 行（`webcad-collab-name`）、16872 行（タブごとの乱数 `webcad-collab-client`。sessionStorage）、16778 行、`assets/js/asset-swap.js` 376 行、`assets/js/asset-sets.js` 16 行 |
| 図面の読み取りで、画像・PDF・補足の文・画面が描いた画像を送る。サーバーに保存しない | 受け口は `worker/routes-ai.mjs`（`/api/ai/read-plan`・`import-plan`・`find-plan`・`revise-plan`・`review-plan-3d`。画面が描いた画像は 650〜660 行の `renders`）。このファイルと `worker/chat.mjs` に、R2（`PLANS`）やルームへ書く処理が無い |
| チャットで、入力した文と間取りの内容を Anthropic に渡す | `worker/chat.mjs` 134 行・285 行（`sendConversation`）。送れるのは文字と道具の結果だけ（同ファイルの冒頭） |
| 読み取りとチャットの渡し先は Anthropic。使えないときだけ OpenAI | `worker/routes-ai.mjs` 363 行（`importProvider`）、321 行（`openaiFallback`）、`worker/ai-fallback.mjs` の冒頭。本番の Worker に事業者を名指しする変数が無いことは、2026-11-26 に `wrangler versions view` で確かめた（秘密は `ANTHROPIC_API_KEY`・`OPENAI_API_KEY`・`GOOGLE_SERVICE_ACCOUNT_JSON`・`GEMINI_API_KEY` の4つ） |
| PDF のときは、縮小した画像を Google Cloud の AI（日本の拠点）に渡す。使えないときだけ OpenAI | `worker/routes-ai.mjs` 294 行（`locateProvider`）、309 行（`locateFallback`）、388 行（日本の拠点でなければ断る） |
| Gemini API（Google AI Studio）は書いていない | `worker/gemini.mjs` 37 行。`AI_GEMINI_FALLBACK=on` のときだけ使う。本番にこの変数は無い。**入れるときは、プライバシーポリシーの 4 章を先に直す** |
| 読み取った間取りの仕上げに、Cloudflare の上の AI のモデルを使う | `worker/jev.mjs` 21 行・44 行（`env.AI`）、`/api/ai/finish-plan` |
| 共同編集の間取りは、最後の変更または保存から 60 日で消える | `worker/shared.mjs` 10 行（`RETENTION_MS`）、`worker/collab-room.mjs` 438 行（変更）・670 行（保存）・723 行（期限で R2 とルームの中身を消す） |
| 表示名と乱数は、つないでいる間だけ使う | `worker/collab-room.mjs` 357 行（WebSocket の付け札にだけ持つ） |
| URL を知っている人はだれでも見て変えられる。利用者が自分で消す操作は無い | `worker/routes-rooms.mjs` の経路の一覧（認証が無く、消す経路が無い） |
| AI アプリからの操作を受ける。間取りの内容を AI アプリに返す | `worker/mcp.mjs`（`/api/mcp`。`get_plan`・`create_plan` など） |
| 回数を数えるために、IP アドレス（IPv6 は前半）を当日と前日の分だけ保存する | `worker/ai-budget.mjs` 81 行（`whoOf`）、`worker/ai-quota.mjs` 329 行（`keepDays`）、AI アプリからの作成は `worker/mcp.mjs` 400 行（`takeRoomCreate`） |
| アクセスの記録（IP アドレス・ブラウザの情報・URL・おおよその地域）が最長 7 日残る | `wrangler.toml` 21〜22 行（`[observability] enabled = true`）。記録の中身と日数は、コードではなく Cloudflare の側で決まる。2026-11-21 の調査（広告の準備のメモ）が本番の記録を見て確かめた内容に合わせた |
| Google Fonts を読み込む | `index.html` 13〜14 行 |
| A8.net の広告を出す。Cookie を含む情報が A8.net に送られる | `assets/js/pr-ads.js` 36 行〜（素材）、76 行（`a8.net` 以外を受け付けない）。送られる情報の項目は A8.net 自身の公表（ https://www.a8.net/compliance/external-transmission-discipline.php ）に合わせた |
| Cloudflare Web Analytics は書いていない | 本番の `/` の HTML に計測の部品が入っていない（2026-11-26 に取得して確かめた）。入れるときは 5 章に足す |

## 7. 確かめていないこと

- 文面の法的な妥当性（弁護士の確認はしていない）。特に、利用規約の 7 章（責任の範囲）と、個人情報保護法・電気通信事業法の外部送信の公表として足りているか。
- AI の事業者が受け取った内容を学習に使わないこと、保存の期間。各社の規約を自分では読み直していない（2026-11-21 の調査のメモの記述に合わせた）。
- Cloudflare のアクセスの記録の保存の日数（Cloudflare の契約のプランで変わる）。
- `srapps.us` で公開済みのプライバシーポリシー（ https://srapps.us/legal/privacy ）との関係。あちらにも house-planner mobile の節がある。2つの文書を両方残すのか、どちらかを正とするのかは決めていない。
  あちらは PDF のときの渡し先を OpenAI と書いているが、いまのコードは Google Cloud の AI が先で、OpenAI は予備。あちらには AI アプリからの操作と、読み取りの予備の OpenAI の記述が無い。
- OpenAI の確認用の文字列の形（公開されていない）。`legal/build.cjs` は、URL に使える字・空白なし・8〜512 字だけを見ている。実物が通らなければ、その検査を緩める。
- 公式 MCP Registry が Cloudflare を通して `/.well-known/mcp-registry-auth` を取れるか（本番でしか分からない）。
