# App Store 登録に要る物の一覧（house-planner mobile）

iOS アプリ「house-planner mobile」を App Store に出すために要る物を、Apple と Google の公式文書の現行の記載で確かめて並べた。
前提は、Capacitor で包んだ iPhone と iPad のアプリ、日本だけで配信、無料、広告は AdMob、課金なし、ログインなし。

- 確かめた日: 2026-11-26（出典はすべてこの日に開いた。開けなかったページは末尾の節に書いた）
- 元にした調査: 2026-11-25 の調査メモ（`research-ios-app.md` の 4〜6 章）と、広告の準備メモ（`house-planner-ads-launch.md` の 6 章）
- 状態の列は仮置き。依頼元があとで直す。「できている」「これから作る（Claude）」「利用者にしかできない」「未確認」のどれかを書いた

## 出典

番号は表の「出典」の列で使う。どれも 2026-11-26 に読んだ。

| 番号 | ページ |
|---|---|
| S1 | Screenshot specifications https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications |
| S2 | App preview specifications https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications |
| S3 | App previews（中身の指針）https://developer.apple.com/app-store/app-previews/ |
| S4 | Human Interface Guidelines, App icons https://developer.apple.com/design/human-interface-guidelines/app-icons （ページは JavaScript で描くので、同じ内容の JSON https://developer.apple.com/tutorials/data/design/human-interface-guidelines/app-icons.json を読んだ） |
| S5 | App information https://developer.apple.com/help/app-store-connect/reference/app-information/app-information |
| S6 | Platform version information https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information |
| S7 | Required, localizable, and editable properties https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties |
| S8 | App privacy details https://developer.apple.com/app-store/app-privacy-details/ |
| S9 | Manage app privacy https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy |
| S10 | Google Mobile Ads SDK の App Store のデータ申告 https://developers.google.com/admob/ios/privacy/data-disclosure |
| S11 | Age ratings values and definitions https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions |
| S12 | Set an app age rating https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating |
| S13 | App Store Connect API の年齢区分の項目 https://developer.apple.com/documentation/appstoreconnectapi/ageratingdeclaration/attributes-data.dictionary （JSON で読んだ。質問票の項目の一覧として使った） |
| S14 | App Review Guidelines https://developer.apple.com/app-store/review/guidelines/ |
| S15 | Upcoming requirements https://developer.apple.com/news/upcoming-requirements/ |
| S16 | AdMob iOS Get started https://developers.google.com/admob/ios/quick-start |
| S17 | AdMob iOS の ATT と SKAdNetwork https://developers.google.com/admob/ios/privacy/strategies |
| S18 | AdMob の app-ads.txt https://support.google.com/admob/answer/9363762 |
| S19 | Privacy manifest files https://developer.apple.com/documentation/bundleresources/privacy-manifest-files と Adding a privacy manifest https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk |
| S20 | App Tracking Transparency https://developer.apple.com/documentation/apptrackingtransparency と NSUserTrackingUsageDescription https://developer.apple.com/documentation/bundleresources/information-property-list/nsusertrackingusagedescription |
| S21 | Export compliance の概要 https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance と ITSAppUsesNonExemptEncryption https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption |
| S22 | EU の DSA のトレーダーの申告 https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/ |
| S23 | 配信地域 https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store/ |
| S24 | 価格 https://developer.apple.com/help/app-store-connect/manage-app-pricing/set-a-price/ |
| S25 | 審査に要る情報 https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/ |
| S26 | 販売元の名前 https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/ |

## 一覧

### ストアの絵と動画

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| iPhone のスクリーンショット | 「iPhone with Dynamic Island（medium）」を最低 1 枚。縦 1179×2556 か 1206×2622、横はその逆。1 つの大きさにつき最大 10 枚。JPEG か PNG、アルファチャンネルと透過は不可。画面の作りが同じなら最も大きい必須の大きさだけ出せば、小さい欄へ縮めて使われる | これから作る（Claude）。いまは試し撮りだけ | S1 |
| iPhone の大きい画面の欄 | 「Dynamic Island（large）」1260×2736・1290×2796・1320×2868 は任意。出さないなら「Face ID（large）」1284×2778 か 1242×2688 が必須。どちらかを出す | これから作る（Claude） | S1 |
| iPad 13 インチのスクリーンショット | iPad で動くなら最低 1 枚。縦 2064×2752 か 2048×2732、横はその逆。12.9・11・10.5 インチの欄は 13 インチから縮めて使われる | これから作る（Claude） | S1 |
| iPhone Duo のスクリーンショット | 外側 1398×2034（横 2034×1398）、内側 2007×2853（横 2853×2007）。いまは必須の一覧に入っていない。「2027 年 4 月から、iOS 27.1 SDK 以降で組んだアプリに必須」。出すと製品ページに Duo 向けの印が付く | 初版は任意。2027-04 以降の更新で要る見込み（手元の SDK は 27.2） | S1 |
| スクリーンショットの中身 | アプリを使っている所を見せる。タイトルの絵・ログイン画面・起動画面だけは不可。文字や絵を重ねてよい（2.3.3）。値段や、欄に関係ない文を入れない（2.3.7）。他の携帯端末の名前・アイコン・絵を出さない（2.3.10） | これから作る（Claude） | S14 |
| App プレビュー（動画） | 任意。1 つの大きさ・言語につき 3 本まで。15〜30 秒。500MB まで。H.264（.mov・.m4v・.mp4、10〜12Mbps、Progressive、High Profile Level 4.0 まで）か ProRes 422 HQ（.mov、約 220Mbps）。30fps まで。iOS は縦横どちらでもよい。上げてから処理に最大 24 時間 | 未確認（作るかを決めていない） | S2 |
| プレビューの解像度 | iPhone（Dynamic Island・Face ID・Duo の各欄）は 886×1920、横は 1920×886。iPad 13・11 インチは 1200×1600、横は 1600×1200。iPad 12.9 インチ（第2世代）は 1200×1600 か 900×1200 も可（横は逆）。端末の解像度ではなく、この「受け付ける解像度」で書き出す | 未確認 | S2 |
| プレビューの音 | 音の有無を必須とする記載は無い。入れるならステレオ、AAC 256kbps（ProRes は PCM も可）、44.1kHz か 48kHz、全トラック有効。既定では消音で再生されるので、文字で補うよう勧めている | 未確認 | S2、S3 |
| プレビューのポスターフレーム | 自動再生を切った人と、入れている最中に見せる絵を選ぶ。既定は 5 秒の位置。承認後に変えると、プレビューを出し直すことになる | 未確認 | S2、S3 |
| プレビューの中身 | アプリの画面の録画だけ（2.3.4）。端末を操作する人や指を撮らない。操作の位置を示す絵や、ナレーション・文字は重ねてよい。値段や「春の新作」のような時期の言葉を入れない。権利のある音楽・素材だけを使う。端末ごとに作る物で、Mac の QuickTime で実機の画面を録る方法を案内している | 未確認 | S3、S14 |

### アイコン

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| アプリのアイコン | iOS・iPadOS は 1024×1024 の正方形。角丸はシステムが付けるので、角を丸めた絵や切り抜いた絵を出さない（縁がギザギザになると書いている）。中身は中央に寄せる。色空間は sRGB・Gray Gamma 2.2・Display P3 | 決定（2026-11-26）。今の配色を 1024×1024 にした `app-icon/AppIcon-1024.png` を使う。アプリの入れ物へ入れるのは本体のセッション | S4 |
| アイコンの形式 | PNG のような層の無い絵か、Icon Composer の層つきファイルのどちらでもよい。Icon Composer を勧めている。PNG を出すと、システムが前景と背景を自動で分けて 2 層にし、ダーク・ティントにも使う | これから作る（Claude） | S4 |
| ダーク・クリア・ティントの各バリエーション | 利用者は default・dark・clear・tinted を選べる。表では iOS の見え方は default・dark・clear light・clear dark・tinted light・tinted dark。「出さなかったバリエーションはシステムが自動で作る」とあり、必須ではない。別のアイコンを選べるようにするなら、その分はダーク・クリア・ティントを自分で用意する | 任意。出すかは未確認（決めていない） | S4 |
| アイコンの決まり | 背景は単色かグラデーションを勧める。文字は必要なときだけ。写真より絵。Apple の製品の絵は使わない。黒の背景は避ける（tvOS の節）。HIG のこのページは 2026-10-28 に「アイコンの形式の選び方」を足している | 今のアイコンは白地に朱色の家と青い指で、文字は無い。当たる点は無い見込み（確かめていない） | S4 |

### 掲載文の各欄

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| 名前 | 2〜30 文字（2.3.7 も 30 文字）。商標や他のアプリ名、値段を詰め込まない | これから作る（Claude） | S5、S14 |
| サブタイトル | 30 文字まで。他のアプリに触れない、確かめようのない主張をしない | これから作る（Claude） | S5、S14 |
| プロモーション用テキスト | 170 文字まで。審査なしで書き換えられる欄 | これから作る（Claude） | S6 |
| 説明 | 4000 文字まで。必須 | これから作る（Claude） | S6 |
| キーワード | 100 バイトまで（文字数ではない。日本語は 1 字 3 バイト）。必須。1 語は 2 文字より長く | これから作る（Claude） | S6 |
| 新機能（What's New） | 4000 文字まで。初版には欄が無く、2 版目から必須 | 初版は不要 | S6 |
| サポート URL | 必須。プロトコルから書き、実際の連絡先に辿れること | 利用者にしかできない（PR #156 のマージ）。ページは作成中 | S6 |
| マーケティング URL | 任意。ただし AdMob の app-ads.txt は、App Store では「マーケティング URL」に載せたサイトの最上位で探す（下の広告の節） | これから作る（Claude）。app-ads.txt を置くなら実質必須 | S6、S18 |
| プライバシーポリシー URL | iOS アプリは必須 | 利用者にしかできない（PR #156 のマージ） | S5、S9 |
| プライバシーの選択の URL | 任意 | 不要の見込み | S9 |
| 著作権 | 必須。「権利を得た年 名前」の形（例 2014 Example, Inc.）。© は自動で付く | これから作る（Claude）。名前は個人の氏名か屋号かを決める必要がある | S6 |
| カテゴリ | 主カテゴリと副カテゴリの欄がある。どれが必須かの印はページの抜き出しで読めなかった | これから作る（Claude）。主はグラフィック／デザインか、仕事効率化かを決める | S5、S7 |
| 販売元の名前 | 個人で登録した場合は法的な氏名がそのまま出る。屋号には変えられない | 利用者にしかできない（変えようがない） | S26 |

### App のプライバシーの申告

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| 申告の義務 | App Store で配るなら、自分と第三者（広告ネットワーク、第三者の SDK など、組み込んだコードの提供元）が集めるデータを申告する。入れたら「公開」を押す。製品ページがまだ無ければ、公開されたときに出る。いつでも直せる | 利用者にしかできない（入力と公開）。値は Claude が用意する | S8、S9 |
| 「収集」の定義 | 端末の外へ送り、要求にその場で応えるのに要る時間より長く、自分か第三者が見られる状態にすること | Claude が当てはめる | S8 |
| 申告しなくてよい条件 | 次の全部を満たすときだけ。トラッキングに使わない。第三者の広告・自社の広告・その他の目的に使わない。主な機能の外のまれな場面で、利用者が選んだときだけ集める。利用者が画面で毎回はっきり選んで出し、名前が送信の画面に出ている。最初の許可のあと続けて集めるものは申告する | 図面の読み取りは主な機能なので、この条件には当たらない見込み（推測） | S8 |
| トラッキングの定義 | アプリで集めた利用者・端末のデータを、他社のアプリ・サイトのデータと結びつけて、狙った広告や広告の効果測定に使うこと。またはデータブローカーに渡すこと。他社のデータと結びつける SDK を入れていれば、自分がその用途に使わなくても当たる | AdMob で個人に合わせた広告を出すなら当たる | S8 |
| データの種類の一覧 | 連絡先（氏名・メール・電話・住所・その他）、健康とフィットネス、金融、位置（正確・おおよそ）、機微な情報、連絡先リスト、ユーザコンテンツ（メールとメッセージ・写真やビデオ・音声・ゲームの中身・問い合わせ・その他のユーザコンテンツ）、閲覧履歴、検索履歴、ID（ユーザ ID・デバイス ID）、購入、使用状況（製品の操作・広告データ・その他）、診断（クラッシュ・パフォーマンス・その他）、周辺環境、体（手・頭）、その他 | Claude が当てはめる | S8 |
| 目的の一覧 | 第三者の広告、自社の広告やマーケティング、分析、製品のパーソナライズ、アプリの機能、その他 | Claude が当てはめる | S8 |
| 利用者に結びつくか | 収集の前に識別子を外すなどしていなければ「結びつく」。各法の個人データは結びつく扱い | Claude が当てはめる | S8 |
| AdMob の分 | Google のページが挙げる種類は 6 つ。クラッシュのログ（利用者と関係ない、と書く）、パフォーマンスのデータ（起動時間・ハングの率・電力。利用者に結びつく、と書く）、デバイス ID（広告識別子など。第三者の広告と分析）、広告データ（見た広告）、おおよその位置（IP アドレスから。SDK の設定で止められる）、製品の操作（起動のタップ、動画の視聴など）。ページは SDK 13.12.0 を指す。各種類が「結びつくか」「トラッキングか」の欄は無く、Apple の定義で自分で判断せよと書く | Claude が当てはめる | S10 |
| house-planner の分 | 図面の画像・文を AI に送る（Anthropic、PDF の図面探しは Google の Vertex AI。どちらかが失敗したときだけ OpenAI。経路は `privacy-labels.md`）。共有の間取りを 60 日残す。★PR #162 のマージ後は、AIレンダーで 3D 画面の絵を Google の Vertex AI（日本国外）へ送る | Claude が当てはめる（昨日のメモ 4-2 の案のとおり） | S8 |

### 年齢区分

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| 区分 | 4+・9+・13+・16+・18+。全部の質問に答えて決まる。年齢区分は必須の欄。「Unrated」は公開できない | 利用者にしかできない（回答）。答えの案は Claude | S11、S5 |
| 質問票の項目（広告） | 「広告」は有無で答える質問がある（API の項目名 `advertising`、真偽値）。あっても 4+ の範囲 | AdMob を出すので「はい」。4+ のまま | S11、S13 |
| 質問票の項目（ユーザー生成コンテンツ） | 有無で答える（`userGeneratedContent`）。4+ の範囲 | 共同編集の扱いを決める。どちらでも 4+ | S11、S13 |
| 質問票の項目（メッセージとチャット） | 利用者どうしが直接やり取りできるか（`messagingAndChat`）。4+ の範囲 | 共同編集に文のやり取りが無ければ「いいえ」（確かめていない） | S11、S13 |
| 質問票の項目（制限のない Web アクセス） | アプリの中で任意のページへ行ける、自由に Web を見られるなら 16+（`unrestrictedWebAccess`） | アプリの中に自由に開けるブラウザが無ければ「いいえ」。外部リンクの開き方を確かめる | S11、S13 |
| 質問票の項目（AI・チャットボット） | AI やチャットボットを名指しする質問は無い。近いのは「出会いと関係」（18+）で、性的・恋愛のやり取りをする会話の相手を含む | 当たらない | S11、S13 |
| その他の項目 | ほかに、ペアレンタルコントロール・年齢確認・SNS・位置の共有（いずれも有無）、健康の話題、医療の情報、くじ（ルートボックス）、ギャンブル、コンテスト、暴力・性・恐怖・飲酒などの頻度（なし／まれ／頻繁）がある | すべて「なし」の見込み | S13 |
| 手順 | App 情報の「年齢区分を設定」から。最初にアプリ内の制限の機能を選び、各節に答える。Kids カテゴリと引き上げをしないなら「該当なし」。年齢の目安の URL は任意 | 利用者にしかできない | S12 |

### 広告まわり

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| 「広告を含む」の申告 | App Store Connect で広告を含むことを答える場所は、年齢区分の質問票の「広告」の質問（上の表）と、App のプライバシーの申告（第三者の広告の目的）の 2 か所。広告だけの独立した欄は見つけられなかった | 利用者にしかできない | S11、S13、S8 |
| ATT（追跡の許可） | 他社と共有して追跡するなら App Tracking Transparency を使う。`NSUserTrackingUsageDescription` を Info.plist に書く。書かずに呼ぶとアプリが落ちる。アプリ名は自動で出るので文に入れない。AdMob は、許可の結果が返ってから広告を読み込むよう勧め、システムの画面の前に説明を出すことも勧める | これから作る（Claude） | S20、S17、S14（5.1.2(i)） |
| SKAdNetwork | Info.plist の `SKAdNetworkItems` に Google の `cstr6suwn9.skadnetwork` と、Google が挙げる買い手の ID を入れる | これから作る（Claude） | S16、S17 |
| AdMob のアプリ ID | Info.plist の `GADApplicationIdentifier` に AdMob のアプリ ID を入れる | 利用者にしかできない（AdMob でアプリを登録）。入れるのは Claude | S16 |
| Privacy Manifest | `PrivacyInfo.xcprivacy` をアプリの最上位に置く。中身はトラッキングの有無・トラッキングの通信先・集めるデータの種類・理由の要る API の理由。SDK の分も含め、理由の無いアップロードは 2024-05-01 から受け付けない。中身が不正なファイルがあると提出を拒まれる。2025-02-12 からは、よく使われる第三者の SDK に正しい manifest が要る。Google は SDK 11.2.0 以降が manifest に対応と書く | これから作る（Claude） | S19、S15、S10 |
| app-ads.txt | ストアの掲載に開発者のサイトが要る（App Store ではマーケティング URL）。そのサイトの最上位に置く。1 階層までのサブドメインを見る。行の形は `google.com, pub-…, DIRECT`。AdMob が見つけて確認するまで最大 24 時間 | これから作る（Claude）。置き場所と、マーケティング URL をどれにするかを決める | S18 |
| 広告の出し方の決まり | 広告はアプリ本体だけ。年齢区分に合う広告にする。全画面の広告は広告とはっきり分かり、閉じるボタンが見やすく押しやすいこと。不適切な広告を利用者が報告できる手段を入れる（2.5.18） | これから作る（Claude） | S14 |

### 審査に出すときの入力欄と事務

| 物 | 公式の要件（数値つき） | 状態 | 出典 |
|---|---|---|---|
| 審査の連絡先 | 名前・メール・電話。電話は「+81」のように + と国番号から書く（数字だけは受け付けない）。審査に出すには必須 | 利用者にしかできない | S6 |
| 審査のメモ | 4000 バイトまで。どの言語でもよい | これから作る（Claude） | S6 |
| メモに書くこと | 新しいアプリなら、アプリの考え方と事業の形（収益の出し方）、目的と対象、試した端末と OS、主な機能に使う外部のサービス（AI のサービスを例に挙げている）、地域で違う点の有無。足りない提出は差し戻される | これから作る（Claude）。広告の出る場面・ログインが無いこと・AI に送るものと送り先・1 日の回数の上限も書く | S25 |
| サインイン情報 | ログインが要るアプリだけ必須。デモのアカウントは期限切れにしない | 不要（ログインなし） | S6、S25 |
| 添付 | 審査に要る書類は「App Review 情報」の添付の欄に入れ、説明やリンクはメモに書く。ハードウェアが要るアプリは、実機で動く動画（画面の録画ではない）が要る。添付のファイル形式と大きさの上限は見つけられなかった | 不要の見込み | S25 |
| 輸出コンプライアンス | 暗号を使うなら新しい版を出すたびに質問に答える。Info.plist に `ITSAppUsesNonExemptEncryption` を NO で入れると、暗号を使わないか免除の暗号だけ使う、という意味になり、毎回の質問が省ける。フランスは別に規制があると書く | これから作る（Claude）。NO を入れる。OS の HTTPS・WSS だけなので免除の見込み（免除の条件の本文は読んでいない） | S21 |
| コンテンツの権利 | 第三者のコンテンツを含む・見せる・使うなら、配信する国や地域の法律で必要な権利を持っていること | 利用者にしかできない（回答）。家具などの外部素材をオリジナルに置き換える方針と合わせて答える | S5 |
| DSA のトレーダーの申告 | EU で配信しなくても申告は要る。EU で配信しないならトレーダーとして振る舞っていない扱い。連絡先が公開されるのは EU の 27 の国・地域で配信したときだけ。新しいアプリを出すときに聞かれる | できている（かさねてでアカウントに申告済み。昨日のメモ 4-3）。アプリごとに確かめる | S22 |
| 配信地域 | 審査に出す前に設定が要る。「特定の国または地域」で日本だけを選ぶ。一覧の下の欄に印を付けると、今後増える国にも自動で出るので、日本だけなら付けない | 利用者にしかできない | S23 |
| 価格 | 審査に出す前に価格の設定が要る。有料アプリの契約に同意していなければ無料でしか出せない | 利用者にしかできない（無料を選ぶ） | S24 |
| Xcode と SDK | 2026-04-28 から Xcode 26 以降・iOS 26 SDK 以降で組んだ物だけ受け付ける。2026-09-09 から最低の対象を iOS 13 以降にする | できている（手元は Xcode 27.2・iOS SDK 27.2） | S15 |
| 最低の iOS | Google は「Xcode 27 ではすべてのターゲットの最低が iOS 15.0」と書く | 昨日の案は iOS 17.0 なので満たす | S16 |
| アプリの入れ物 | Capacitor の iOS のプロジェクト | これから作る（Claude）。まだ無い | なし |
| 第三者の AI に送ることの同意 | 個人のデータを第三者に渡すなら、第三者の AI も含めて渡し先をはっきり示し、渡す前に明示の許可を取る。追跡には ATT で許可を取る。追跡や通知の許可を、機能を使う条件にしない（5.1.2(i)） | これから作る（Claude）。初回の確認の画面。★AIレンダーの分は PR #162 に入っている（未マージ）。読み取りとチャットの分はまだ無い | S14 |

## 昨日のメモと食い違った点・新しく分かった点

スクリーンショットとプレビューの寸法・枚数・形式は、昨日のメモの 6 章と食い違いは無かった。iPhone Duo が 2027 年 4 月から iOS 27.1 SDK 以降のアプリに必須になる点も同じ記載だった。ほかに次のことが分かった。

- 今のアイコンの画像は 1254×1254 で、App Store が求める 1024×1024 ではない。透過は無いので、縮めて書き出せば済む。
- ダーク・クリア・ティントのアイコンは必須ではない。出さなければシステムが自動で作る。PNG を出すと、システムが前景と背景を分けて使う。
- 年齢区分の質問票に「広告」の有無の質問がある。App Store Connect で広告を含むと答える場所はここ（と App のプライバシーの申告）。AI やチャットボットを名指しする質問は無い。「制限のない Web アクセス」に「はい」と答えると 16+ になる。
- Google の AdMob のデータ申告のページは、いま SDK 13.12.0 を指し、データの種類を 6 つ挙げる（昨日のメモは、かさねての 13.11.0 の記録の「7 行」を写していた）。かさねての 7 行と、どこが違うかは比べていない。Google のページは「利用者に結びつくか」「トラッキングか」を種類ごとに書いておらず、判断は開発者に任せている。
- Google は 2026-12-02 から Google Mobile Ads SDK の新しい版を CocoaPods に出さない、と書く。昨日の調査では手元に CocoaPods は入っていない。AdMob のプラグインが Swift Package Manager で入れられるかを、作るときに確かめる必要がある（確かめていない）。
- 審査に要る情報のページが、メモに「主な機能に使う外部のサービス（AI のサービスを例に挙げる）」「試した端末と OS」「地域で違う点」を書くよう求めている。昨日のメモ 4-2 の審査メモの項目に、試した端末と OS を足す必要がある。
- Apple が受け付ける最低の対象は 2026-09-09 から iOS 13 以降。Google は Xcode 27 では最低が iOS 15.0 と書く。昨日の案の iOS 17.0 はどちらも満たす。
- 2025-02-12 から、よく使われる第三者の SDK には正しい Privacy Manifest が要る。中身が不正な manifest が入っていると提出が拒まれる。
- app-ads.txt は App Store ではマーケティング URL のサイトの最上位で探される。マーケティング URL は任意の欄だが、AdMob の確認のためには入れることになる。
- 販売元の名前のページの本文を読んだ。個人で登録した場合は法的な氏名がそのまま出る（昨日は検索結果の要約だけだった）。

## 確かめられなかった点

- アプリのアイコンの HIG は通常のページでは本文が読めず、同じ内容の JSON で読んだ。
- App Store Connect の各欄の「必須」の印は、ページの表から抜き出せなかった（S7）。必須と書いたものは、各欄の説明文に「必須」とある物だけ。カテゴリが必須かは確かめていない。
- 審査の添付の欄のファイル形式と大きさの上限。
- 輸出コンプライアンスの「免除」の条件の本文（OS の HTTPS だけなら免除、という文は読んだページに無かった）。昨日までの判断（かさねてと同じく免除）をそのまま置いた。
- 年齢区分の質問票の画面上の文言。API の項目名と、区分の定義のページから項目を並べた。画面の質問文そのものは読んでいない。
- 「コンテンツの権利」の質問の文。App 情報のページの説明だけ読んだ。専用のヘルプのページは「見つからない」だった（ https://developer.apple.com/help/app-store-connect/manage-app-information/set-content-rights-information ）。
- AdMob の Privacy Manifest の専用ページ（ https://developers.google.com/admob/ios/privacy/manifest ）は 404 で開けなかった。
- 配信地域の古い URL（ https://developer.apple.com/help/app-store-connect/manage-app-availability/manage-availability-for-your-app-on-the-app-store ）は「見つからない」だった。新しい URL（S23）で読んだ。
- App Store の製品ページのアイコンが、ビルドのアイコンから取られるのか、別に上げるのかは、今回のページでは確かめていない。
- アクセシビリティの表示（Accessibility の欄）が要るかは、欄の名前だけ見た（S7）。要件は読んでいない。
