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
| AIレンダー（3D を写真のような絵に仕上げる） | ★PR #162（未マージ）で入る。「外観3D」「内観3D」「ウォークスルー」から「画像AIレンダー」→「写真のように仕上げる」で、今の視点が写真のような絵になってアプリの中に出る。結果の画面に「元の3Dと見比べる」「画像を保存」「もう一度仕上げる」「問題を報告」と「今日はあと◯枚」、絵の下に「AI が仕上げた絵です。細部が実際の間取りと違うことがあります。」が出る。送るのは 3D 画面の絵 3 枚（3D の絵・奥行き・輪郭）と表現の種類だけで、送り先は Google の Vertex AI（日本国外）。利用者は文章を入力できず、指示文はサーバーが組み立てる。生成した絵は運営側に保存しない（「問題を報告」で「この絵も送る」を選んだときだけ R2 に置く）。生成した絵には SynthID の透かしが入る。静止画だけ | PR #162 の説明 | PR #162 のマージ後に有効 |
| AI に送る前の確認の画面 | ★AIレンダーには PR #162 で初回の同意が入る（送るもの・送り先・国外での処理を示す。同意は端末に残り、ダイアログから取り消せる）。読み取りとチャットには無い。いまは読み取りの画面に「図面に氏名や住所が写っている場合は、隠してから選んでください」、チャットの欄に「氏名・住所・電話番号などの個人情報は入力しないでください」と出しているだけで、送り先は示していない。審査の指針 5.1.2(i) は、第三者の AI に渡す前に渡し先を示して許可を得ることを求めている。調査メモの決めること F（初回だけ確認を出す）の答えがまだ無い | `index.html` 555 行・835 行 | 未実装。出す前に要る |
| 共同編集のルーム | 利用者が「共同編集を開始」を押すと、その間取りを当方のサーバーに置き、推測できない 22 字の id の URL を作る。URL を知る人だけが見て変えられる。公開の一覧・検索は無い。最後の変更から 60 日で消える。文を送り合う機能は無い。利用者が自分でルームを消す操作は無い（調査メモの決めること G） | `privacy-labels.md` と `age-rating-and-compliance.md` の表 | 消す操作は未実装 |
| ネイティブの機能 | ★まだ無い。調査メモ（`research-ios-app.md` 5 章の 4.2）の案は、「ファイル」への保存・写真への保存・共有シート・印刷・通信が無くても作図できること。Web 版の `<a download>` は WKWebView では何も起きないので、置き換えが要る | 調査メモ 1-2 | 実装後に確定 |
| AI の 1 日の回数 | 回数ではなく点で数える。1 つの接続元（IP。IPv6 は前半）で 1 日 168 点、全利用者の合計で 1 日 700 点。チャット 1 回が 21 点、読み取りは 1 ページにつき 10 点に見直しの分が加わる（3 ページの PDF で約 63 点）。日の区切りは日本時間の朝 9 時。画面に「本日あと N 回 読み取れます」「本日あと N 回 頼めます」を出す | `worker/ai-quota.mjs` 37〜47 行・19 行、`worker/routes-ai.mjs` 60〜64 行、`worker/chat.mjs` 47 行、`assets/js/plan-import.js` 74 行、`assets/js/chat/chat-ui.js` 189 行 | 確定（本番は既定の値。変数で変えられる） |
| AIレンダーの 1 日の枚数 | ★点とは別に枚数で数える。1 接続元 1 日 5 枚、全体 1 日 30 枚。画面に「今日はあと◯枚」を出す。月の金額の枠は読み取り・チャットと共有。`AI_RENDER_DAILY_TOTAL=0` でレンダーだけ止められる | PR #162 の説明 | PR #162 のマージ後に有効 |

### 審査員が回数の上限に当たるおそれ

- 1 つの接続元で、チャットなら 8 回、1 ページの図面の読み取りなら数回で、その日の分が尽きる。審査は同じ回線から何人かで試すことがあり、同じ IP なら 1 人分の枠を分け合う（推測。Apple の審査の回線の作りは確かめていない）。
- 全利用者の合計 700 点は、ほかの利用者が先に使い切ると、審査員はその日 1 回も試せない。
- 月の合計にも上限があり、尽きるとその月の残りは AI が使えない（`worker/ai-price.mjs` の月の枠）。
- 断られたときは、画面に「本日ぶんの AI は受付を終えました。明日の朝9時から再開します。画面の操作では引き続き作れます。」（月の上限なら「今月ぶんの AI の受付を終えました。…」）が出て、作図・3D・共同編集はそのまま使える（`worker/ai-budget.mjs` 19〜24 行）。
- ★取れる手は2つ。審査の間だけ本番の変数（`AI_DAILY_IMPORTS_PER_USER`・`AI_DAILY_IMPORTS_TOTAL`）で上限を上げるか、上げずにメモに上限があることを書くか。前者は審査に当たらない代わりに、その間は費用の上限まで使われうる（月の金額の枠は別にあるので、月の上限は超えない）。勧めは、メモに書いたうえで、審査に出している間だけ合計の上限を上げること。運営者が決める。
- ★AIレンダーは 1 接続元 1 日 5 枚、全体 1 日 30 枚。審査員が同じ回線から何度か試すと、5 枚はすぐ尽きる。認証の無い公開の受け口なので、ほかの接続元が全体の 30 枚を先に使い切ることもある（PR #162 が残っている点として挙げている）。全体の枚数は `AI_RENDER_DAILY_TOTAL` で変えられる。1 接続元の枚数を変える変数があるかは、PR の説明に無く確かめていない。
- 審査メモには、上限があることと、上限に当たっても AI 以外の機能は使えることを書く（下の枠に入れた）。

### 出す前に確かめること

- ★下の手順の画面の文言（「平面図」「外観3D」「ウォークスルー」「間取り図から下書き」「この範囲を読み取る」「AIに頼む」「共同編集」「共同編集を開始」「AIアプリから直す」）は 2026-11-26 の main の `index.html` から写した。出すビルドで、書いたとおりに操作できるかを確かめる。アプリ版では、共有の URL と AI アプリの住所がいま `location` から作られていて、`capacitor://localhost` の URL になる（`index.html` 16888 行・16945 行）。本番の URL に差し替えてから出す。
- ★試し用の図面。審査員が自分で図面を用意しなくても試せるよう、サンプルの図面（画像 1 枚）をアプリに入れておくか、審査メモに図面の URL を書くかを決める。手元にサンプルは無い。
- ★広告・初回の確認・ネイティブの機能の行は、実装ができたら書き直す。下の枠では［未確定］と書いてある所。
- ★AIレンダー（アプリの中で 3D を写真のような絵に仕上げる機能）。PR #162 で実装され、まだ main に入っていない。下の枠には、PR #162 の説明から手順・送るデータ（3D 画面の絵 3 枚と表現の種類。指示文はサーバーが組み立てるので利用者からは送らない）・事業者名・同意・通報・1 日の枚数を入れた。マージされないまま出すなら、枠の該当の段落を消す。マージされたら次を確かめる。
  - アプリ版で「画像を保存」（共有シート）が写真かファイルへ保存できるか。PR #162 はアプリ版の本体が無いため、ブラウザの検査で差し替えて確かめただけ。シミュレーターか実機で確かめる。保存できないなら、掲載文と下の枠に「保存できる」と書かない。
  - 初回の同意のダイアログの文言と、同意のボタン名（PR の説明では「同意して仕上げる」）を、出すビルドの画面から枠に写し直す。
  - 外観3D と水彩の表現で本物の生成が通るか。PR #162 で試したのは内観の「生活画像」だけ。
  - 天井の形と細かい設備（ダウンライト・スイッチ・コンセントなど）が、生成ごとに図面と違う形で描かれることがある。結果の下の注意書きで足りるかは審査の判断になる。

### 枠の長さ

★「App Review に関する情報」のメモは、`checklist.md` の出典（S6）では 4000 バイトまで。下の枠は、AIレンダーを足す前で 3,821 字・5,901 バイト、足したあとは 6,395 字・9,977 バイトある（2026-11-27 に数えた）。バイトで数えれば足す前から上限を超えていて、足したあとは字で数えても 4,000 を超える。冒頭の「上限 4,000 字」の書き方とも食い違う。貼る前に削る必要がある。英語の段だけでも 4,402 字・4,680 バイト（ボタン名の日本語が 1 字 3 バイトになる）で、バイトで数えるならそれでも収まらない。勧めは、日本語の段を落として英語だけにし、さらに英語を 1 割ほど縮めること（メモの言語は自由。`checklist.md` の S6）。どこを縮めるかは決めていない。欄が字とバイトのどちらで数えるかは、App Store Connect に貼って確かめる。

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
6. AI render: in "外観3D", "内観3D" or "ウォークスルー", tap "画像AIレンダー", then "写真のように仕上げる". The first time, the app shows what is sent, to whom, and that it is processed outside Japan; tap "同意して仕上げる". After about 20 seconds the current 3D view appears as a photo-like image, with "元の3Dと見比べる" (compare with the 3D view), "画像を保存" (save), "もう一度仕上げる" (generate again) and "問題を報告" (report a problem). [TBD: available after the AI render feature is released; confirm the consent text and button names in the submitted build.]
7. [TBD: native features such as saving to Files / Photos, the share sheet and printing.]

[AI features and data]
Floor-plan reading and the chat send the selected drawing, the optional note, images of the built plan, the typed text and a summary of the plan through our server (Cloudflare) to Anthropic (Claude). For PDFs, a reduced page image is sent to Google Cloud Vertex AI (Japan region) to locate the drawing. Only when one of these services is temporarily unavailable, the same content is sent to OpenAI instead. Our server does not store these inputs. [TBD: before the first upload the app asks for permission and names the AI providers.]
The AI features have a daily usage limit per connection and in total. The screen shows the remaining count ("本日あと N 回"). If the limit is reached, drawing, 3D and collaboration still work. The count resets at 9:00 JST.
[TBD: AI render] The AI render sends only three images of the current 3D view (the rendered view, depth and outlines) and the selected style to Google Cloud Vertex AI (image generation model), processed outside Japan. The original drawing, names, addresses and any text written by the user are not sent. Before the first use the app asks for consent, naming what is sent, the provider and processing outside Japan; consent is stored on the device and can be withdrawn in the same dialog. Google does not use the images for training, and its cache is deleted within 24 hours. Generated images carry a SynthID watermark and are not stored on our server, except when the user chooses to attach the image to a problem report. The limit is 5 images per connection and 30 in total per day; the screen shows "今日はあと◯枚".
Users cannot type any text for the AI render; the prompt is built by our server, and the only input is the app's own 3D view. Images blocked by Google's safety filters are not shown. The result screen has "問題を報告" (report a problem). Generated images are shown only on the user's own device and there is no place to show them to other users, so there is no one to block. A note under each image says it is AI-generated and details may differ from the actual plan.

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
6. AIレンダーは、「外観3D」「内観3D」「ウォークスルー」のどれかで「画像AIレンダー」→「写真のように仕上げる」を押します。初回は、送るもの・送り先・日本国外で処理することを示す画面が出るので、「同意して仕上げる」を押します。20 秒ほどで今の視点が写真のような絵になり、「元の3Dと見比べる」「画像を保存」「もう一度仕上げる」「問題を報告」が出ます。［未確定：AIレンダーを出してから有効。同意の文とボタン名を出すビルドで確かめる］
7. ［未確定：「ファイル」や写真への保存、共有シート、印刷などのネイティブの機能］

【AI の機能と送るもの】
読み取りとチャットでは、選んだ図面・補足の文・組み立てた間取りの画像・入力した文・間取りの要約を、当方のサーバー（Cloudflare）を通して Anthropic（Claude）に送ります。PDF のときは、図面の場所を探すために、縮小したページの画像を Google Cloud の Vertex AI（日本の拠点）に送ります。これらが一時的に使えないときに限り、同じ内容を OpenAI に送ります。当方のサーバーはこれらを保存しません。［未確定：初めて送る前に、送り先を示して許可を求める画面］
AI の機能には、接続元ごとと全体の 1 日の上限があり、画面に「本日あと N 回」と出します。上限に達しても、作図・3D・共同編集は使えます。日本時間の朝 9 時に戻ります。
［未確定：AIレンダー］AIレンダーで送るのは、今見ている 3D 画面の絵 3 枚（3D の絵・奥行き・輪郭）と表現の種類だけで、送り先は Google Cloud の Vertex AI（画像生成のモデル）です。処理は日本国外です。図面の原本・氏名・住所・利用者が書いた文は送りません。初めて使う前に、送るもの・送り先・国外での処理を示して同意を取ります。同意は端末に残り、同じダイアログから取り消せます。Google は送った絵を学習に使わず、キャッシュは 24 時間以内に消えます。生成した絵には SynthID の透かしが入ります。生成した絵は当方のサーバーに保存しません。例外は、利用者が「問題を報告」で絵を添えたときだけです。上限は 1 接続元 1 日 5 枚、全体 1 日 30 枚で、画面に「今日はあと◯枚」と出します。
AIレンダーでは、利用者は文章を入力できません。指示文は当方のサーバーが組み立て、入力はアプリの 3D 画面の絵だけです。Google の安全フィルタで止まった絵は出しません。結果の画面に「問題を報告」があります。生成した絵は本人の端末にだけ出て、ほかの利用者に見せる場は無いので、利用者のブロックは対象がありません。絵の下に、AI が仕上げた絵で細部が実際の間取りと違うことがある、と出します。

【共同編集】
共有した間取りは、リンク（推測できない 22 字の id）を知る人だけが開けます。公開の一覧や検索、利用者どうしのメッセージはありません。最後の変更から 60 日で消えます。共同編集のダイアログの「AIアプリから直す」から、ChatGPT や Claude に共有の間取りを直させることもでき、同じダイアログで止められます。

【広告と追跡】
Google AdMob を使います。［未確定：バナーの位置］全画面の広告は、手で保存した直後か書き出しを終えたときだけ出ます。1 回の起動で 1 回、1 日 3 回まで、前の広告から保存 2 回以上かつ 3 分以上空け、使い始めた日は出しません。追跡の許可を断っても、合わせない広告を出し、全機能が使えます。

【アプリ内課金】
ありません。
```
