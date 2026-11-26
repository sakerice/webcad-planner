# 審査メモ（App Review への説明）の下書き

2026-11-26 作成。アプリ版（Capacitor の入れ物・AdMob・同意の画面）がまだ無いため、★を付けた所はできあがってから確かめ直す。

根拠は 2026-11-26 の main（`2a6cf05c`）のコード、本番の Worker の設定（2026-11-26 06:59 UTC に配備された版。ふつうの変数は入っていない）、設計書 `docs/superpowers/specs/2026-11-10-one-source-platform-design.md`。

App Store Connect の「App Review に関する情報」の「メモ」欄に、最後の枠の中を貼る（上限 4,000 字）。かさねて・東京バズマップと同じく、英語のあとに同じ内容の日本語を置く形にした。連絡先（名前・電話・メール）を入れないと、この欄は保存できない（東京バズマップの記録。電話は `+81` から始める）。サインインは要らないので、「サインインが必要です」のチェックは外す。

## 書く中身と、いまの状態

| 書くこと | いまの事実 | 根拠 | 状態 |
|---|---|---|---|
| ログイン | 無い。アカウントも、メールアドレスの入力も無い | `index.html` に `type="password"`・`type="email"` の欄が無い（PR #156 の `docs/legal-pages-and-registry.md` 6 章と同じ確かめ方） | 確定 |
| 広告の出る場面 | ★iOS の AdMob はまだ実装が無い。設計書 3.5.1 の決まりは、全面広告（インタースティシャル）を「手で保存した直後」と「書き出しを終えた時」だけに出し、前の全面広告から保存 2 回以上かつ 3 分以上、1 回の起動で 1 回まで、1 日 3 回まで、初めて使った日は出さない。アプリのバナーの位置は設計書に決まりが無い（Web は画面の上端と、保存一覧・共有・書き出しのダイアログ）。Web 用の A8.net の枠はアプリの中では出さない | 設計書 3.5.1、`assets/js/pr-ads.js` 65〜73 行 | 実装後に確定 |
| AI に送る物と送り先 | 図面の読み取りは、選んだ画像か PDF・補足の文・見直し用に画面が描いた画像を、当方のサーバー（Cloudflare）を通して Anthropic へ。PDF の図面探しは Google Cloud の Vertex AI（日本の拠点）へ。どちらかが一時的に使えないときだけ OpenAI へ。チャットは、入れた文と間取りの要約を Anthropic だけへ。読み取りの仕上げは Cloudflare の中のモデル。当方のサーバーは、どれも保存しない | `privacy-labels.md` の「AI の事業者ごとの今の経路」 | 確定（本番の設定が変われば直す） |
| AI に送る前の確認の画面 | ★無い。いまは読み取りの画面に「図面に氏名や住所が写っている場合は、隠してから選んでください」、チャットの欄に「氏名・住所・電話番号などの個人情報は入力しないでください」と出しているだけで、送り先は示していない。審査の指針 5.1.2(i) は、第三者の AI に渡す前に渡し先を示して許可を得ることを求めている。調査メモの決めること F（初回だけ確認を出す）の答えがまだ無い | `index.html` 555 行・835 行 | 未実装。出す前に要る |
| 共同編集のルーム | 利用者が「共同編集を開始」を押すと、その間取りを当方のサーバーに置き、推測できない 22 字の id の URL を作る。URL を知る人だけが見て変えられる。公開の一覧・検索は無い。最後の変更から 60 日で消える。文を送り合う機能は無い。利用者が自分でルームを消す操作は無い（調査メモの決めること G） | `privacy-labels.md` と `age-rating-and-compliance.md` の表 | 消す操作は未実装 |
| ネイティブの機能 | ★まだ無い。調査メモ（`research-ios-app.md` 5 章の 4.2）の案は、「ファイル」への保存・写真への保存・共有シート・印刷・通信が無くても作図できること。Web 版の `<a download>` は WKWebView では何も起きないので、置き換えが要る | 調査メモ 1-2 | 実装後に確定 |
| AI の 1 日の回数 | 回数ではなく点で数える。1 つの接続元（IP。IPv6 は前半）で 1 日 168 点、全利用者の合計で 1 日 700 点。チャット 1 回が 21 点、読み取りは 1 ページにつき 10 点に見直しの分が加わる（3 ページの PDF で約 63 点）。日の区切りは日本時間の朝 9 時。画面に「本日あと N 回 読み取れます」「本日あと N 回 頼めます」を出す | `worker/ai-quota.mjs` 37〜47 行・19 行、`worker/routes-ai.mjs` 60〜64 行、`worker/chat.mjs` 47 行、`assets/js/plan-import.js` 74 行、`assets/js/chat/chat-ui.js` 189 行 | 確定（本番は既定の値。変数で変えられる） |

### 審査員が回数の上限に当たるおそれ

- 1 つの接続元で、チャットなら 8 回、1 ページの図面の読み取りなら数回で、その日の分が尽きる。審査は同じ回線から何人かで試すことがあり、同じ IP なら 1 人分の枠を分け合う（推測。Apple の審査の回線の作りは確かめていない）。
- 全利用者の合計 700 点は、ほかの利用者が先に使い切ると、審査員はその日 1 回も試せない。
- 月の合計にも上限があり、尽きるとその月の残りは AI が使えない（`worker/ai-price.mjs` の月の枠）。
- 断られたときは、画面に「本日ぶんの AI は受付を終えました。明日の朝9時から再開します。画面の操作では引き続き作れます。」（月の上限なら「今月ぶんの AI の受付を終えました。…」）が出て、作図・3D・共同編集はそのまま使える（`worker/ai-budget.mjs` 19〜24 行）。
- ★取れる手は2つ。審査の間だけ本番の変数（`AI_DAILY_IMPORTS_PER_USER`・`AI_DAILY_IMPORTS_TOTAL`）で上限を上げるか、上げずにメモに上限があることを書くか。前者は審査に当たらない代わりに、その間は費用の上限まで使われうる（月の金額の枠は別にあるので、月の上限は超えない）。勧めは、メモに書いたうえで、審査に出している間だけ合計の上限を上げること。運営者が決める。
- 審査メモには、上限があることと、上限に当たっても AI 以外の機能は使えることを書く（下の枠に入れた）。

### 出す前に確かめること

- ★下の手順の画面の文言（「平面図」「外観3D」「ウォークスルー」「間取り図から下書き」「この範囲を読み取る」「AIに頼む」「共同編集」「共同編集を開始」「AIアプリから直す」）は 2026-11-26 の main の `index.html` から写した。出すビルドで、書いたとおりに操作できるかを確かめる。アプリ版では、共有の URL と AI アプリの住所がいま `location` から作られていて、`capacitor://localhost` の URL になる（`index.html` 16888 行・16945 行）。本番の URL に差し替えてから出す。
- ★試し用の図面。審査員が自分で図面を用意しなくても試せるよう、サンプルの図面（画像 1 枚）をアプリに入れておくか、審査メモに図面の URL を書くかを決める。手元にサンプルは無い。
- ★広告・初回の確認・ネイティブの機能の行は、実装ができたら書き直す。下の枠では［未確定］と書いてある所。

## 貼る文の下書き

［未確定］の所は、実装ができたら書き直してから貼る。

```
[Overview]
house-planner mobile is a home floor-plan tool. You can draw a floor plan in 2D, view it as a 3D exterior and interior, and walk through it. No sign-in or account is required. The UI is Japanese only. Plans are saved on the device.

[How to review]
1. On launch a sample plan is shown. [TBD: confirm the first screen in the submitted build.]
2. Switch views with the buttons "平面図" (2D plan), "外観3D" (3D exterior), "内観3D" (3D interior) and "ウォークスルー" (walkthrough).
3. AI floor-plan reading: tap "間取り図から下書き", choose an image or PDF of a floor plan, then tap "この範囲を読み取る". The plan is built from the drawing. [TBD: sample floor-plan image for review.]
4. AI chat: tap "AIに頼む" and type a request in Japanese, e.g. "リビングを広くして" (make the living room larger). The AI edits the plan. The AI only handles floor-plan edits and questions about the plan.
5. Collaboration: tap "共同編集", then "共同編集を開始". A link is created; open it on another device to edit the same plan together.
6. [TBD: native features such as saving to Files / Photos, the share sheet and printing.]

[AI features and data]
Floor-plan reading and the chat send the selected drawing, the optional note, images of the built plan, the typed text and a summary of the plan through our server (Cloudflare) to Anthropic (Claude). For PDFs, a reduced page image is sent to Google Cloud Vertex AI (Japan region) to locate the drawing. Only when one of these services is temporarily unavailable, the same content is sent to OpenAI instead. Our server does not store these inputs. [TBD: before the first upload the app asks for permission and names the AI providers.]
The AI features have a daily usage limit per connection and in total. The screen shows the remaining count ("本日あと N 回"). If the limit is reached, drawing, 3D and collaboration still work. The count resets at 9:00 JST.

[Collaboration]
A shared plan is reachable only by people who have its link (a random 22-character ID). There is no public list or search, no messaging between users, and shared plans are deleted 60 days after the last change. Users can also let ChatGPT or Claude edit a shared plan through our MCP server ("AIアプリから直す"); this can be turned off in the same dialog.

[Ads and tracking]
Google AdMob. [TBD: banner positions.] Interstitial ads appear only right after a manual save or after finishing an export, at most once per launch and three times per day, at least two saves and three minutes apart, and never on the first day of use. The app asks for App Tracking Transparency; if declined, non-personalized ads are shown and all features work.

[In-app purchases]
None.

【概要】
house-planner mobile は、住宅の間取りを 2D で描き、外観と内観の 3D で見て、中を歩けるアプリです。サインインもアカウントも要りません。画面は日本語だけです。間取りは端末の中に保存します。

【確かめ方】
1. 起動すると見本の間取りが出ます。［未確定：出すビルドの最初の画面を確かめる］
2. 「平面図」「外観3D」「内観3D」「ウォークスルー」で表示を切り替えます。
3. AI の読み取りは、「間取り図から下書き」で間取り図の画像か PDF を選び、「この範囲を読み取る」を押します。図面から間取りを組み立てます。［未確定：審査用の見本の図面］
4. AI のチャットは、「AIに頼む」を押し、「リビングを広くして」のように日本語で頼みます。AI が間取りを直します。AI は間取りの作成・修正と、間取りについての質問だけを扱います。
5. 共同編集は、「共同編集」→「共同編集を開始」を押すとリンクができます。別の端末で開くと、同じ間取りを一緒に直せます。
6. ［未確定：「ファイル」や写真への保存、共有シート、印刷などのネイティブの機能］

【AI の機能と送るもの】
読み取りとチャットでは、選んだ図面・補足の文・組み立てた間取りの画像・入力した文・間取りの要約を、当方のサーバー（Cloudflare）を通して Anthropic（Claude）に送ります。PDF のときは、図面の場所を探すために、縮小したページの画像を Google Cloud の Vertex AI（日本の拠点）に送ります。これらが一時的に使えないときに限り、同じ内容を OpenAI に送ります。当方のサーバーはこれらを保存しません。［未確定：初めて送る前に、送り先を示して許可を求める画面］
AI の機能には、接続元ごとと全体の 1 日の上限があり、画面に「本日あと N 回」と出します。上限に達しても、作図・3D・共同編集は使えます。日本時間の朝 9 時に戻ります。

【共同編集】
共有した間取りは、リンク（推測できない 22 字の id）を知る人だけが開けます。公開の一覧や検索、利用者どうしのメッセージはありません。最後の変更から 60 日で消えます。共同編集のダイアログの「AIアプリから直す」から、ChatGPT や Claude に共有の間取りを直させることもでき、同じダイアログで止められます。

【広告と追跡】
Google AdMob を使います。［未確定：バナーの位置］全画面の広告は、手で保存した直後か書き出しを終えたときだけ出ます。1 回の起動で 1 回、1 日 3 回まで、前の広告から保存 2 回以上かつ 3 分以上空け、使い始めた日は出しません。追跡の許可を断っても、合わせない広告を出し、全機能が使えます。

【アプリ内課金】
ありません。
```
