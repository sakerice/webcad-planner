// 間取り図の画像から作りはじめる。
//
// 流れ
// ----
//   1. 画像を選ぶ          … ハウスメーカーの図面の写真・PDFを画像にしたもの
//   2. 図面の部分だけ囲む  … 表題欄・俯瞰図・余白を落とす
//   3. 読み取る            … /api/ai/import-plan へ送る（鍵は Worker 側だけが持つ）
//   4. 結果を見て取り込む  … 読めた部屋を一覧で見せ、納得してから反映する
//
// 2の切り出しには2つ意味がある。ひとつは**送る画像から個人情報を落とす**こと
// (メーカーの図面は表題欄に施主名・敷地住所が入ることが多い)。もうひとつは、
// 送る量が減って安く・正確になること。A4の紙の隅に小さく図がある、という
// 図面が実際に多い。
//
// 写真の位置情報(EXIF)は、canvas に描き直した時点で落ちる。元の画像の
// バイト列をそのまま送らないのは、そのためでもある。
(function (root) {
  'use strict';

  // 送る画像の長辺の上限。
  //
  // AI 側が読む解像度には頭打ちがある。実測（同じ1ページ）:
  //
  //   768〜2072px … 1,821 トークン
  //   3072px      … 3,369 トークン
  //   6144px      … 3,369 トークン（増えない）
  //
  // 3072 を超えて送っても読まれる情報は増えず、通信量だけが増える。
  var MAX_SEND_PX = 3072;
  // 画面に出すプレビューの長辺。大きな写真をそのまま描くと操作が重くなる。
  var MAX_PREVIEW_PX = 1200;

  var ST = {
    image: null,        // 読み込んだ画像 (Image)
    pages: null,        // PDFを選んだとき、ページごとの画像 (data URL の配列)
    fileName: '',
    crop: null,         // 切り出し範囲 {x,y,w,h} 画像の画素で
    drag: null,         // 囲んでいる最中の状態
    result: null,       // 読み取り結果 {plan, summary, notes, warnings, usage}
    busy: false,
  };

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var e = $(id); if (e) e.style.display = on ? '' : 'none'; }

  function setStatus(text) {
    var e = $('plan-import-status');
    if (e) e.textContent = text;
  }

  // ── 開く・閉じる ────────────────────────────────────────────────────
  function openPlanImport() {
    var m = $('plan-import-modal');
    if (!m) return;
    m.classList.add('show');
    if (!ST.image && !ST.pages) resetPlanImport();
    showQuota();
  }

  // 本日あと何回使えるかを出す。
  //
  // **全体の上限がある**ので、自分が使っていなくても使えないことがある。
  // 押してから断られるより、押す前に分かっているほうがよい。
  function showQuota() {
    var box = $('plan-import-quota');
    if (!box) return;
    fetch('/api/ai/quota').then(function (r) { return r.json(); }).then(function (q) {
      if (!q || !q.counted || q.left === null || q.left === undefined) { box.style.display = 'none'; return; }
      box.style.display = '';
      box.textContent = q.left > 0
        ? '本日あと ' + q.left + ' 回 読み取れます（1日に ひとり ' + q.perUser + ' 回まで／全体 ' + q.total + ' 回まで）'
        : '本日ぶんの読み取りを使い切りました。明日またお試しください。';
      var run = $('plan-import-run');
      if (run && q.left <= 0) run.disabled = true;
    }).catch(function () { box.style.display = 'none'; });
  }

  function closePlanImport() {
    var m = $('plan-import-modal');
    if (m) m.classList.remove('show');
  }

  function resetPlanImport() {
    ST.image = null; ST.pages = null; ST.fileName = '';
    ST.crop = null; ST.drag = null; ST.result = null; ST.busy = false;
    var f = $('plan-import-file'); if (f) f.value = '';
    show('plan-import-step2', false);
    show('plan-import-step3', false);
    setStatus('間取り図のPDFか画像を選んでください。');
    syncPlanImportButtons();
  }

  // ── 図面の部分だけにする ────────────────────────────────────────────
  //
  // 紙面の中で平面図が小さいことが多い。試した図面は**ページ面積の約6%**で、
  // ページ全体を送ると寸法の文字が縦3〜4画素になり読めなかった。
  //
  // AI が読む解像度には頭打ちがあるので、**その枠を平面図だけで使う**。
  // 位置は安いモデルに1回聞く（1ページ ¥0.5 前後）。紙面の構成はメーカーごとに
  // 違い、写真ではなおさら決まった形が無いので、画素の解析では当てにならない。
  //
  // 切り出せなかったページは、ページ全体のまま送る。切り出しは上乗せであって、
  // 失敗したら読めなくなる、という作りにはしない。
  // 位置探しに待てる時間。**上限が要る。** 実測で、AI 側が混んでいるときに
  // 1回200秒かかったことがある。切り出しは上乗せであって、これを待つために
  // 読み取りが始まらないのでは本末転倒。時間切れならページ全体のまま送る。
  var LOCATE_TIMEOUT_MS = 25000;

  function locate(smallDataUrl) {
    var asked = fetch('/api/ai/find-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: smallDataUrl }),
    }).then(function (res) { return res.json(); })
      .then(function (body) { return (body && body.box) || null; })
      .catch(function () { return null; });
    var giveUp = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, LOCATE_TIMEOUT_MS); });
    return Promise.race([asked, giveUp]);
  }

  // ── 1. 画像を選ぶ ──────────────────────────────────────────────────
  function onPlanImportFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    ST.fileName = file.name || '';

    // PDF は、こちらでページごとの画像にしてから送る。
    //
    // 以前はそのまま送っていたが、**1ページあたり約260トークンしか使われて
    // いなかった**(768画素角のタイル1枚ぶん)。画像にすれば1ページ3,369
    // トークンまで使われる。詳しくは assets/js/pdf-pages.js の実測値。
    if (file.type === 'application/pdf' || /\.pdf$/i.test(ST.fileName)) {
      var pdfReader = new FileReader();
      pdfReader.onload = function (e) {
        ST.image = null; ST.crop = null; ST.result = null; ST.pages = null;
        setStatus('PDFを開いています…');
        if (typeof PdfPages === 'undefined' || !PdfPages) {
          setStatus('PDFを開く部品がありません。画像にしてからお試しください。');
          return;
        }
        var pdfData = e.target.result;
        var smalls = null;
        PdfPages.renderPages(pdfData, {
          maxPx: MAX_SEND_PX,
          onProgress: function (n, total) { setStatus('PDFを開いています… ' + n + ' / ' + total + 'ページ'); },
        }).then(function (pages) {
          if (!pages.length) { setStatus('このPDFにページがありません。'); return []; }
          // 位置を聞くための小さい版も、PDFから描く。大きい絵を画像として
          // 読み直すと、画面が隠れているあいだ復号が返ってこない。
          return PdfPages.renderPages(pdfData, { maxPx: 1024 }).then(function (small) {
            smalls = small;
            return pages;
          });
        }).then(function (pages) {
          if (!pages || !pages.length) return [];
          // ページごとに、図面の部分だけを高い解像度で描き直す。
          //
          // 位置はまとめて聞く。順番に聞くと、1ページぶんの待ちがページ数だけ
          // 積み上がる。描き直しはこちらの処理なので、聞き終えてから順に行う。
          setStatus('図面の位置を探しています…');
          var out = pages.slice();
          return Promise.all(pages.map(function (page, i) {
            return locate((smalls && smalls[i]) || page);
          })).then(function (boxes) {
            var next = function (i) {
              if (i >= pages.length) return out;
              if (!boxes[i]) return next(i + 1);
              setStatus('図面を切り出しています… ' + (i + 1) + ' / ' + pages.length + 'ページ');
              return PdfPages.renderRegion(pdfData, i + 1, boxes[i], { maxPx: MAX_SEND_PX })
                .then(function (cropped) { if (cropped) out[i] = cropped; return next(i + 1); })
                .catch(function () { return next(i + 1); });
            };
            return Promise.resolve(next(0));
          });
        }).then(function (pages) {
          if (!pages || !pages.length) return;
          ST.pages = pages;
          show('plan-import-step2', true);
          show('plan-import-crop', false);
          show('plan-import-step3', false);
          setStatus(pages.length + 'ページを読み取ります。');
          syncPlanImportButtons();
        }).catch(function (err) {
          setStatus('PDFを開けませんでした: ' + (err && err.message ? err.message : err));
          syncPlanImportButtons();
        });
      };
      pdfReader.onerror = function () { setStatus('ファイルを読めませんでした。'); };
      pdfReader.readAsDataURL(file);
      return;
    }

    if (!/^image\//.test(file.type)) {
      setStatus('PDF か画像（PNG / JPEG / WebP）を選んでください。');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        ST.image = img; ST.pages = null;
        // 最初は全体を選んでおく。狭めるのは利用者の任意。
        ST.crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        ST.result = null;
        show('plan-import-step2', true);
        show('plan-import-crop', true);
        show('plan-import-step3', false);
        drawPlanImportPreview();
        setStatus('このまま読み取れます。図面が紙面の一部にしか写っていない場合は、'
          + '図面の部分だけをドラッグで囲むと、より正確に読めます（任意）。');
        syncPlanImportButtons();
      };
      img.onerror = function () { setStatus('この画像を開けませんでした。別の形式で試してください。'); };
      img.src = e.target.result;
    };
    reader.onerror = function () { setStatus('ファイルを読めませんでした。'); };
    reader.readAsDataURL(file);
  }

  // ── 2. 図面の部分を囲む ────────────────────────────────────────────
  // プレビューの表示倍率。画像の画素 → 画面の画素。
  function previewScale() {
    if (!ST.image) return 1;
    var long = Math.max(ST.image.naturalWidth, ST.image.naturalHeight);
    return Math.min(1, MAX_PREVIEW_PX / long);
  }

  function drawPlanImportPreview() {
    var c = $('plan-import-canvas');
    if (!c || !ST.image) return;
    var s = previewScale();
    c.width = Math.round(ST.image.naturalWidth * s);
    c.height = Math.round(ST.image.naturalHeight * s);
    var g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(ST.image, 0, 0, c.width, c.height);
    var r = ST.drag || ST.crop;
    if (!r) return;
    // 選んでいる外側を暗くして、どこを送るのかを一目で分かるようにする。
    var x = r.x * s, y = r.y * s, w = r.w * s, h = r.h * s;
    g.save();
    g.fillStyle = 'rgba(8,12,24,0.55)';
    g.beginPath();
    g.rect(0, 0, c.width, c.height);
    g.rect(x + w, y, -w, h);   // 逆回りで穴をあける
    g.fill('evenodd');
    g.restore();
    g.strokeStyle = '#e94560';
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
  }

  // 実際に絵が描かれている範囲と、その倍率。
  //
  // **canvas は object-fit: contain で表示している。** 幅は 100%、高さは
  // 上限(52dvh)付き。縦長の画像だと高さが上限に当たり、**要素の箱のほうが
  // 絵より横に広くなる**。contain は絵を箱の中央に収めるので、左右に余白が
  // できる。getBoundingClientRect が返すのは箱なので、余白を差し引かずに
  // 座標を換算すると、囲みの始点がその分ずれる。
  //
  // 余白が無いときは left/top は箱のままで、倍率も縦横で同じになる。
  function fitContain(rect, cw, ch) {
    var scale = Math.min(rect.width / cw, rect.height / ch);
    if (!(scale > 0) || !isFinite(scale)) scale = 1;
    return {
      left: rect.left + (rect.width - cw * scale) / 2,
      top: rect.top + (rect.height - ch * scale) / 2,
      scale: scale,
    };
  }

  function canvasPointToImage(e) {
    var c = $('plan-import-canvas');
    var t = (e.touches && e.touches[0]) || e;
    var s = previewScale();
    var fit = fitContain(c.getBoundingClientRect(), c.width, c.height);
    return {
      x: Math.max(0, Math.min(ST.image.naturalWidth, (t.clientX - fit.left) / fit.scale / s)),
      y: Math.max(0, Math.min(ST.image.naturalHeight, (t.clientY - fit.top) / fit.scale / s)),
    };
  }

  function planImportDown(e) {
    if (!ST.image) return;
    e.preventDefault();
    var p = canvasPointToImage(e);
    ST.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 };
    drawPlanImportPreview();
  }

  function planImportMove(e) {
    if (!ST.drag) return;
    e.preventDefault();
    var p = canvasPointToImage(e);
    ST.drag.x = Math.min(ST.drag.x0, p.x);
    ST.drag.y = Math.min(ST.drag.y0, p.y);
    ST.drag.w = Math.abs(p.x - ST.drag.x0);
    ST.drag.h = Math.abs(p.y - ST.drag.y0);
    drawPlanImportPreview();
  }

  function planImportUp() {
    if (!ST.drag) return;
    // 指が滑っただけの極小の矩形は、選び直しとみなして捨てる。
    if (ST.drag.w > 20 && ST.drag.h > 20) {
      ST.crop = { x: ST.drag.x, y: ST.drag.y, w: ST.drag.w, h: ST.drag.h };
    }
    ST.drag = null;
    drawPlanImportPreview();
    syncPlanImportButtons();
  }

  function planImportSelectAll() {
    if (!ST.image) return;
    ST.crop = { x: 0, y: 0, w: ST.image.naturalWidth, h: ST.image.naturalHeight };
    drawPlanImportPreview();
    syncPlanImportButtons();
  }

  // 切り出した範囲を、送る大きさに縮めて data URL にする。
  // ここで canvas に描き直すので、写真の位置情報(EXIF)は落ちる。
  function croppedDataUrl() {
    if (!ST.image || !ST.crop) return null;
    var r = ST.crop;
    var scale = Math.min(1, MAX_SEND_PX / Math.max(r.w, r.h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * scale));
    c.height = Math.max(1, Math.round(r.h * scale));
    var g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // 図面は白地に細い線なので、下地を白で埋めてから描く(透過PNG対策)。
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(ST.image, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function syncPlanImportButtons() {
    var run = $('plan-import-run');
    if (run) run.disabled = (!ST.image && !ST.pages) || ST.busy;
    var apply = $('plan-import-apply');
    if (apply) apply.disabled = !ST.result || ST.busy;
    var size = $('plan-import-crop-size');
    if (size && ST.crop) {
      var scale = Math.min(1, MAX_SEND_PX / Math.max(ST.crop.w, ST.crop.h));
      size.textContent = '送る範囲: ' + Math.round(ST.crop.w) + '×' + Math.round(ST.crop.h) +
        ' 画素 → ' + Math.round(ST.crop.w * scale) + '×' + Math.round(ST.crop.h * scale) + ' に縮めて送信';
    }
  }

  // ── 3. 読み取る ────────────────────────────────────────────────────
  function runPlanImport() {
    if (ST.busy) return;
    // PDFはページごとの画像、画像は切り出して(囲んでいなければ全体を)送る。
    var images = ST.pages || (function () { var one = croppedDataUrl(); return one ? [one] : []; }());
    if (!images.length) return;
    ST.busy = true; ST.result = null;
    show('plan-import-step3', false);
    syncPlanImportButtons();
    setStatus('読み取っています… 図面1枚で30秒ほどかかります。');

    var hint = ($('plan-import-hint') && $('plan-import-hint').value) || '';
    fetch('/api/ai/import-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images: images, hint: hint }),
    }).then(readReply).then(function (r) {
      return waitForJobs(r, { onProgress: function (done, total) {
        setStatus('読み取っています… ' + done + ' / ' + total + ' 枚が終わりました。');
      } });
    }).then(function (r) {
      if (r.status !== 200) {
        ST.busy = false;
        showPlanImportError(r.status, r.body); syncPlanImportButtons(); showQuota(); return;
      }
      return maybeRevisePlanImport(images, hint, r.body).then(function (body) {
        // 仕上げの判断をもらってから画面を出す。**失敗しても止めない。**
        // 判断が得られなければ、これまでどおり下書きだけを渡す。
        var finish = (typeof PlanFinish === 'undefined' || !body.plan)
          ? Promise.resolve(null) : PlanFinish.analyze(body.plan);
        return finish.then(function (out) {
          body.finish = out;
          ST.busy = false;
          ST.result = body;
          renderPlanImportResult(body);
          syncPlanImportButtons();
          showQuota();
        });
      });
    }).catch(function () {
      ST.busy = false;
      setStatus('サーバに接続できませんでした。通信の状態を確かめて、もう一度お試しください。');
      syncPlanImportButtons();
      showQuota();
    });
  }

  // 受付番号を受け取ったら、出来上がるまで数秒おきに見に行く。
  //
  // **待つ役をこちら側に置く。** サーバが待つと、1つのリクエストから出せる
  // 外向きの通信の上限（Cloudflare の無料プランで50回）に当たって落ちる。
  // 3秒おきの問い合わせを図面3枚ぶん回すと70回を超え、本番で HTTP 500 になった。
  //
  // こちらから短い問い合わせを繰り返せば、1回あたりの通信は図面の枚数ぶんで
  // 済む。**つなぎっぱなしの接続も無くなる**ので、回線が切れたりタブが眠ったり
  // しても、そこで読み取りが失われることがない。
  var JOB_POLL_MS = 3000;
  var JOB_TIMEOUT_MS = 15 * 60 * 1000;

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 受付番号が入っていなければ、そのまま返す（Vertex は投げた通信で答えが返る）。
  function waitForJobs(first, opts) {
    opts = opts || {};
    if (first.status !== 200 || !first.body || !first.body.jobs) return Promise.resolve(first);
    var jobs = first.body.jobs;
    var until = Date.now() + JOB_TIMEOUT_MS;
    function once() {
      if (Date.now() > until) return { status: 504, body: null };
      return fetch('/api/ai/plan-result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobs: jobs, revised: Boolean(opts.revised) }),
      }).then(readReply).then(function (r) {
        if (r.status !== 200 || !r.body || !r.body.pending) return r;
        if (opts.onProgress) opts.onProgress(r.body.done, r.body.total);
        return delay(JOB_POLL_MS).then(once);
      });
    }
    return once();
  }

  // 返事を読む。**JSON とは限らない。**
  //
  // 失敗の中身は Cloudflare が作ることがあり、そのときは HTML のエラーページが
  // 返る。res.json() をそのまま呼ぶと JSON の構文エラーになり、その文面
  // (「Unexpected token \'<\', "<!DOCTYPE "...」) が利用者の画面に出ていた。
  // 読む側の事情であって、利用者には何の意味も無い。
  function readReply(res) {
    return res.text().then(function (text) {
      var body = null;
      try { body = JSON.parse(text); } catch (e) { body = null; }
      return { status: res.status, body: body };
    });
  }

  // ── 3b. AI に自分の答えを見直させる ────────────────────────────────
  //
  // 読み取りは、これまで投げて一度答えを受け取るだけだった。モデルは自分の
  // 書いた座標が間取りとしてどう見えるかを一度も見ていない。
  //
  // そこで、答えをこちらで平面図として描き直し(assets/js/plan-review-draw.js)、
  // 元の図面と並べてもう一度渡す。数字の列では気づけない誤り——部屋が隣へ
  // 食い込む、玄関が飲み込まれて消える、階の輪郭が揃わない——は、絵にすると
  // 一目で分かる。
  //
  // **上積みであって、必須の工程ではない。** 描けなかったとき、通信に失敗した
  // とき、上限に達したときは、見直す前の結果をそのまま使う。ここで落ちて
  // 読み取り自体を失うほうが損である。
  // 見直しを払うかどうかは、サーバ側の門(worker/plan-gate.mjs)が決めている。
  //
  // **見直しは、読み取りと同じだけ費用がかかる。** 直すところが無ければ同じ
  // JSONがそのまま返るので、辻褄の合っているページでは ¥40 を確実に捨てて
  // いた。1日の取り込み回数が5回に絞られているのは、この倍額がそのまま
  // 効いている。
  //
  // 門が答えを出せなかったとき・古いサーバに当たったときは revise が
  // 付いてこない。そのときは**これまでどおり見直す**。
  function maybeRevisePlanImport(images, hint, body) {
    var advice = body && body.revise;
    if (!advice || !advice.skipAll) return revisePlanImport(images, hint, body);
    body.reviewSkipped = true;
    return Promise.resolve(body);
  }

  function revisePlanImport(images, hint, body) {
    var pages = (body && body.pages) || [];
    if (!pages.length || typeof PlanReviewDraw === 'undefined') return Promise.resolve(body);

    var renders = [];
    try {
      for (var i = 0; i < pages.length; i++) {
        var drawn = PlanReviewDraw.drawPage(pages[i]);
        if (!drawn) return Promise.resolve(body);
        renders.push(drawn);
      }
    } catch (e) { return Promise.resolve(body); }
    if (renders.length !== images.length) return Promise.resolve(body);

    setStatus('読み取った間取りを描き起こして、AIに見直させています… 30秒ほどかかります。');
    return fetch('/api/ai/revise-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images: images, renders: renders, pages: pages, hint: hint }),
    }).then(readReply).then(function (r) {
      return waitForJobs(r, { revised: true, onProgress: function (done, total) {
        setStatus('AIに見直させています… ' + done + ' / ' + total + ' 枚が終わりました。');
      } });
    }).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.plan) {
        body.reviewNote = '見直しは行えませんでした（読み取った結果をそのまま出しています）。';
        return body;
      }
      // 費用は2回ぶんの合計で見せる。片方だけ出すと実際より安く見える。
      r.body.usage = addUsage(body.usage, r.body.usage);
      r.body.reviewImages = renders;
      r.body.reviewChanges = reviewChanges(pages, r.body.pages || []);
      r.body.beforePages = pages;   // 見直す前の答え。何が変わったかを後から確かめるため
      return r.body;
    }).catch(function () {
      body.reviewNote = '見直しは行えませんでした（読み取った結果をそのまま出しています）。';
      return body;
    });
  }

  // 見直しで何が変わったかを、利用者の言葉にする。
  //
  // **黙って直すと、直ったことも直し損ねたことも分からない。** 費用を2回ぶん
  // 払っている以上、何が変わったかは見えているべきである。
  // **階の番号で突き合わせない。** 見直しはページごとに投げているので、前と後は
  // ページの順で1対1に並ぶ。番号で突き合わせると、同じ番号を名乗る階が2つ
  // あったときに別の階どうしを比べてしまう。実測で、3ページ目が「2階」と
  // 読まれ、2ページ目の2階と3ページ目の2階を比べて「2階に趣味部屋を足した」
  // といった出鱈目が並んだ（アプリに渡る間取りのほうは mergeFloors が
  // ページ順で番号を振り直すので正しい）。
  function reviewChanges(before, after) {
    var lines = [];
    (before || []).forEach(function (bp, page) {
      var ap = (after || [])[page];
      if (!ap) return;
      var bfs = (bp && bp.floors) || [];
      ((ap && ap.floors) || []).forEach(function (a, i) {
        var b = bfs[i];
        if (!b) return;
        var n = (Number(a.floor) || (page + 1)) + '階';
        if (Number(a.floor) !== Number(b.floor)) {
          lines.push((page + 1) + 'ページ目を ' + (Number(b.floor) || '?') + '階 → '
            + (Number(a.floor) || '?') + '階 に直しました。');
        }
        if (Math.round(a.width) !== Math.round(b.width)) {
          lines.push(n + 'の間口を ' + Math.round(b.width) + ' → ' + Math.round(a.width) + 'mm に直しました。');
        }
        if (Math.round(a.depth) !== Math.round(b.depth)) {
          lines.push(n + 'の奥行きを ' + Math.round(b.depth) + ' → ' + Math.round(a.depth) + 'mm に直しました。');
        }
        var bn = roomNames(b), an = roomNames(a);
        var gone = bn.filter(function (x) { return an.indexOf(x) < 0; });
        var came = an.filter(function (x) { return bn.indexOf(x) < 0; });
        if (came.length) lines.push(n + 'に ' + came.join('・') + ' を足しました。');
        if (gone.length) lines.push(n + 'から ' + gone.join('・') + ' を外しました。');
        var bl = partCounts(b), al = partCounts(a);
        if (bl !== al) lines.push(n + 'の部屋の形（長方形の数）を ' + bl + ' → ' + al + ' に直しました。');
      });
    });
    return lines;
  }
  function roomNames(floor) {
    return ((floor && floor.rooms) || []).map(function (r) { return String(r.name || '(名前なし)'); });
  }
  function partCounts(floor) {
    return ((floor && floor.rooms) || []).reduce(function (n, r) { return n + ((r.parts || []).length); }, 0);
  }

  function addUsage(a, b) {
    if (!a) return b; if (!b) return a;
    var out = {};
    ['calls', 'inputTokens', 'answerTokens', 'thoughtTokens', 'outputTokens', 'totalTokens']
      .forEach(function (k) { out[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0); });
    return out;
  }

  // 失敗の理由を、利用者が次に何をすればよいか分かる言葉で出す。
  // 次の一手の文面。**キーはサーバと共有するが、日本語はこちらにしかない。**
  // worker/plan-gate.mjs の NEXT_STEP_QUESTION の選択肢と1対1で対応する。
  var NEXT_STEP = {
    recrop_tighter: '平面図だけを大きく囲み直してください。立面図や外観パース、表題欄が一緒に入っていると読み取れません。',
    recrop_wider: '寸法線まで入るように、少し広めに囲み直してください。',
    single_page: 'ページを1枚ずつに分けて取り込むと通ることがあります。',
    better_scan: 'もっと大きく、はっきり写った画像でお試しください。寸法の数字が読める大きさが必要です。',
    not_a_floorplan: 'この画像には平面図が写っていないようです。間取りの描かれたページを選んでください。',
    too_complex: 'この間取りは自動では読み取れない形のようです（曲線や斜めの壁、スキップフロアなど）。お手数ですが、手で引いてください。',
    retry: 'もう一度お試しください。',
  };

  function showPlanImportError(status, body) {
    var code = (body && body.error) || '';
    var map = {
      ai_not_configured: 'この環境ではまだAIの読み取りを使えません（管理者の設定待ちです）。',
      ai_model_not_japan_resident: 'AIの設定が正しくないため実行しませんでした。管理者にお伝えください。',
      ai_invalid_plan: 'AIは読み取りましたが、そのままでは使えない形でした。',
      ai_bad_response: 'AIが間取りとして答えられませんでした。',
      ai_upstream_error: 'AI側でエラーが起きました。少し待ってからもう一度お試しください。',
      ai_quota_exceeded: '',   // message をそのまま出す（残り回数を含むため）
      invalid_request: '送った画像に問題がありました。',
    };
    var byStatus = {
      500: 'サーバ側でエラーが起きました。少し待ってからもう一度お試しください。',
      502: 'AI側と通信できませんでした。少し待ってからもう一度お試しください。',
      503: 'いまこの機能を使えません。少し待ってからもう一度お試しください。',
      504: '時間がかかりすぎて、通信が切れました。ページ数の少ない図面でお試しください。',
      524: '時間がかかりすぎて、通信が切れました。ページ数の少ない図面でお試しください。',
    };
    var text = map[code] || byStatus[status]
      || ('読み取れませんでした（' + status + (code ? ' ' + code : '') + '）。');
    if (code === 'ai_quota_exceeded' && body && body.message) text = body.message;
    // **次に何をすればよいか。**
    //
    // 起きたことと、次の一手は別である。これまでは1つの文面に混ぜていたので、
    // 原因が何であれ「図面がはっきり写るように囲み直してください」と言うほか
    // なかった。実際の原因は、囲みが広すぎる・狭すぎる・そもそも平面図が写って
    // いない・画像が小さすぎる、と別物である。
    //
    // サーバが next を付けてくるのは、送った画像の枚数・大きさ・返ってきた
    // 不整合から一手を選べたときだけ。**文面はここにしかない**ので、選択肢に
    // 無い答えが返っても画面には出ない。
    if ((code === 'ai_invalid_plan' || code === 'ai_bad_response') && !NEXT_STEP[(body && body.next) || '']) {
      text += '図面の部分だけを大きく囲み直すと通ることがあります。';
    }
    if (body && NEXT_STEP[body.next]) text += NEXT_STEP[body.next];
    if (body && body.problems && body.problems.length) {
      text += '\n' + body.problems.slice(0, 5).join('\n');
    }
    setStatus(text);
  }

  function renderPlanImportResult(body) {
    var s = body.summary || {};
    setStatus('下書きができました。取り込んだあと、手で直して仕上げてください。');
    var head = $('plan-import-summary');
    if (head) {
      head.textContent = '壁 ' + (s.walls || 0) + ' / 部屋 ' + (s.rooms || 0) +
        ' / 開口・階段 ' + (s.items || 0) + '（階 ' + ((s.floors || []).join('・') || '-') + '）';
    }
    var list = $('plan-import-rooms');
    if (list) {
      var rooms = (body.plan && body.plan.rooms) || [];
      list.textContent = rooms.length
        ? rooms.map(function (r) {
            var jo = (r.w * r.d / 1656200).toFixed(1);   // 1帖 = 910×1820 mm
            return '・' + (r.n || '(名前なし)') + '  ' + Math.round(r.w) + '×' + Math.round(r.d) + 'mm  約' + jo + '帖';
          }).join('\n')
        : '部屋を読み取れませんでした。';
    }
    // 1回いくらかかったかを、毎回その場で見せる。推定ではなく実測の
    // トークン数から出す。費用は使う側からは見えないので、見えるようにする。
    var cost = $('plan-import-cost');
    if (cost) {
      var u = body.usage;
      if (u && u.inputTokens) {
        // 単価は gpt-6-astra（$10 / $50 per 1M）。$1=¥150 と置いた概算。
        // **モデルを替えたらここも替える。** 実際より安く見えるのが一番まずい。
        var yen = (u.inputTokens / 1e6 * 10 + u.outputTokens / 1e6 * 50) * 150;
        cost.textContent = 'この読み取りの費用: 約 ' + yen.toFixed(1) + '円'
          + '（入力 ' + u.inputTokens + ' / 出力 ' + u.outputTokens
          + (u.thoughtTokens ? '（うち思考 ' + u.thoughtTokens + '）' : '') + ' トークン）';
      } else {
        cost.textContent = '';
      }
    }
    var notes = $('plan-import-notes');
    if (notes) {
      var lines = [];
      if (body.revised) {
        var ch = body.reviewChanges || [];
        lines.push('・AIが自分の読み取りを平面図として見直しました'
          + (ch.length ? '（' + ch.length + '件を直しました）。' : '（直すところはありませんでした）。'));
        ch.forEach(function (c) { lines.push('　・' + c); });
      }
      // **省いたことも書く。** 費用を見せている以上、払わなかった理由も
      // 見えているべきである。黙って省くと、見直しが動かなくなったのか
      // 省いたのかが、使う側から区別できない。
      if (body.reviewSkipped) {
        lines.push('・読み取りの辻褄が合っていたので、見直しは省きました（その分の費用と時間はかかっていません）。');
      }
      // 仕上げの見通し。**取り込む前に、このあと何が起きるかを出す。**
      if (body.finish) {
        var swaps = (body.finish.picks || []).length;
        var lacks = PlanFinish.missingLines(body.finish).length;
        if (swaps) lines.push('・水まわり ' + swaps + ' 点を、部屋の広さに合うモデルに差し替えます。');
        if (lacks) lines.push('・取り込んだあと、足りないもの ' + lacks + ' 件を道具の一覧に出します。');
      }
      if (body.reviewNote) lines.push('・' + body.reviewNote);
      (body.notes || []).forEach(function (n) { lines.push('・' + n); });
      (body.warnings || []).forEach(function (w) { lines.push('・' + w); });
      notes.textContent = lines.length ? lines.join('\n') : '特にありません。';
    }
    show('plan-import-step3', true);
  }

  // ── 4. 取り込む ────────────────────────────────────────────────────
  //
  // **利用者が作ったものは、取り込みでは消さない。**
  //
  // 以前は、読み取り結果で間取りをまるごと差し替えていた。2階の平面図を
  // 1枚読み取っただけで1階が消え、方位も外壁の仕様も敷地も失われた。
  // 読み取りが言っているのは「この図面にはこう描いてある」ことだけで、
  // 図面に写っていないものをどうこうする理由は何も無い。
  //
  // そこで、取り込みは2つの置き方に分かれる。
  //
  //   空いている階      … そのまま入れる（1階の次に2階を読む、いつもの流れ）
  //   既に間取りがある階 … 消さずに、いまの間取りの**隣に**建てる
  //
  // 隣に建てるほうは、古いほうと読み取った下書きが並んで見える。どちらを
  // 残すか（あるいは両方直して使うか）は利用者が決める。取り込みが決める
  // ことではない。
  //
  // 読み取った素の JSON を、**アプリ自身の生成関数を通して**作り直す。
  //
  // AIが返すのは座標と種類だけで、色・テクスチャ・壁の見え方・建具の高さと
  // いった欄が無い。生のまま DATA に入れると、見た目は出ても「手で置いた壁」
  // とは別物になり、あとから色を変えられないなどの形で効いてくる。
  // mkWall / mkItem を通せば、手で置いたものと1つも違わない。
  function toAppObjects(plan) {
    var out = { walls: [], rooms: [], items: [] };
    (plan.walls || []).forEach(function (w) {
      var made = mkWall(w.x1, w.y1, w.x2, w.y2, w.floor || 1, w.thick);
      out.walls.push(made);
    });
    (plan.rooms || []).forEach(function (r) {
      var floor = r.floor || 1;
      out.rooms.push({
        id: 'rm_' + (nextId++), type: 'room', x: r.x, y: r.y, w: r.w, d: r.d, floor: floor,
        n: r.n || '', floorRaiseMm: newRoomFloorRaiseMm(floor),
        textureFlipX: false, textureFlipY: false,
      });
    });
    // 構造部材（基礎・屋根）はここでは作らない。**いまの間取りと合わせた
    // 壁から決まる**ので、階を差し替えたあと withStructure で作る。
    (plan.items || []).forEach(function (it) {
      // **アプリのアイテムは x,y が左上の角。** AIには「開口の中心」で
      // 答えさせているので、ここで角へ直す。直さないと開口が幅の半分ぶん
      // ずれる（幅1690の窓なら845mm）。3Dで見て初めて気づいた食い違い。
      //
      // 中心で答えさせているのは、そのほうがモデルにとって自然で誤りが
      // 少ないから。変換はこちら側の仕事にする。
      var w = it.w, d = it.d;
      if (w == null || d == null) {
        var sz = (typeof getItemDefaultSize === 'function') ? getItemDefaultSize(it.type) : { w: 0, d: 0 };
        if (w == null) w = sz.w;
        if (d == null) d = sz.d;
      }
      var made = mkItem(it.type, it.x - w / 2, it.y - d / 2, it.rot || 0, it.floor || 1, it.w, it.d);
      out.items.push(made);
    });
    return out;
  }

  // その間取りに出てくる階。
  function floorsOfObjects() {
    var seen = [];
    for (var i = 0; i < arguments.length; i++) {
      (arguments[i] || []).forEach(function (o) {
        var f = Number(o && o.floor) || 1;
        if (seen.indexOf(f) < 0) seen.push(f);
      });
    }
    return seen.sort(function (a, b) { return a - b; });
  }

  // 壁から決まる構造部材（基礎・屋根）を作る。
  //
  // AIには出させない。基礎は最下階の壁の外形そのもの、屋根は最上階の外形＋軒で
  // 一意に決まるので、読み取りの精度に左右されず必ず正しく置ける。
  // これが無いと、出来上がるのは「家」ではなく「壁の集まり」になる。
  //
  // floors を渡すと、その階から決まるものだけを作る。2階を読み取ったなら
  // 屋根（最上階から決まる）は作り直すが、基礎（最下階から決まる）は
  // そのままにする、という区別のため。
  function structureItems(walls, floors) {
    if (typeof PlanStructure === 'undefined' || !PlanStructure) return [];
    var all = PlanStructure.floorsOf(walls);
    if (!all.length) return [];
    var bottom = all[0], top = all[all.length - 1];
    return PlanStructure.structureFor(walls).filter(function (st) {
      return !floors || floors.indexOf(st.type === 'roof' ? top : bottom) >= 0;
    }).map(function (st) {
      var made = mkItem(st.type, st.x, st.y, st.rot || 0, st.floor, st.w, st.d);
      // 種類ごとの欄（基礎の高さ・屋根の形）は mkItem の既定値より、
      // 壁から決めたこちらの値を優先する。
      Object.keys(st).forEach(function (k) {
        if (['type', 'x', 'y', 'w', 'd', 'rot', 'floor'].indexOf(k) < 0) made[k] = st[k];
      });
      return made;
    });
  }

  function floorLabel(floors) {
    return floors.map(function (f) { return f + '階'; }).join('・');
  }

  // 基礎と屋根は壁から決まる「派生物」で、利用者が置いたものではない。
  // 形や勾配は手で直せるが、どこに載るかは壁が決める。
  function isDerivedStructure(o) { return !!o && (o.type === 'foundation' || o.type === 'roof'); }

  // 敷地と周辺（道路・隣家・電柱）。平面図には描かれていない。
  function isSiteOrContext(o) {
    return !!o && (o.type === 'site-rect' ||
      (typeof isContextExteriorItemType === 'function' && isContextExteriorItemType(o.type)));
  }

  // その階に、利用者の作ったものが在るか。
  //
  // 基礎と屋根は壁から決まる派生物、敷地と周辺は図面の外の話なので数えない。
  // 1階を読んだ家に2階を足す、という流れでこれらが引っかかると、2階が
  // 上に載らず隣に建ってしまう。
  function hasWorkOnFloors(plan, floors) {
    var on = function (o) { return o && floors.indexOf(Number(o.floor) || 1) >= 0; };
    if ((plan.walls || []).some(on)) return true;
    if ((plan.rooms || []).some(on)) return true;
    return (plan.items || []).some(function (o) {
      return on(o) && !isDerivedStructure(o) && !isSiteOrContext(o);
    });
  }

  // いまの間取りが載っている範囲。隣をどこにするか決めるのに使う。
  // 道路・隣家・電柱は敷地の外まで広がっているので、数に入れない。
  function planBounds(plan) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, got = false;
    var add = function (ax, ay, bx, by) {
      if (![ax, ay, bx, by].every(function (v) { return typeof v === 'number' && isFinite(v); })) return;
      x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx);
      y0 = Math.min(y0, ay, by); y1 = Math.max(y1, ay, by);
      got = true;
    };
    (plan.walls || []).forEach(function (w) { add(w.x1, w.y1, w.x2, w.y2); });
    (plan.rooms || []).forEach(function (r) { add(r.x, r.y, r.x + (r.w || 0), r.y + (r.d || 0)); });
    (plan.items || []).forEach(function (it) {
      if (!it || (typeof isContextExteriorItemType === 'function' && isContextExteriorItemType(it.type))) return;
      add(it.x, it.y, it.x + (it.w || 0), it.y + (it.d || 0));
    });
    return got ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
  }

  // 隣に建てるときの間隔(mm)。近すぎると1棟に見え、遠すぎると画面から外れる。
  var BESIDE_GAP_MM = 3000;

  function shiftPlan(plan, dx) {
    if (!dx) return;
    (plan.walls || []).forEach(function (w) { w.x1 += dx; w.x2 += dx; });
    (plan.rooms || []).forEach(function (r) { r.x += dx; });
    (plan.items || []).forEach(function (it) { it.x += dx; });
  }

  // いまの間取りが「起動時の既定プランのまま」か。
  //
  // 起動ダイアログの「間取り図の画像から下書きを作る」で入ってきたときも、
  // 裏では既定プランが読み込まれている。**利用者は図面から作りはじめる
  // つもりでいる**ので、そこへ読み取った階を混ぜると、身に覚えのない部屋が
  // 別の階に残る。この場合だけは、下敷きを外して図面だけから作る。
  //
  // 既定プランを手で直してきた人にとっては、それはもう自分の間取りである。
  // 触った跡(編集履歴)が無いことまで見て分ける。
  function isUntouchedDefault() {
    return root._defaultPlanPending === true &&
      (typeof HISTORY === 'undefined' || !HISTORY || !HISTORY.length);
  }

  function applyPlanImport() {
    if (!ST.result || !ST.result.plan) return;
    if (typeof DATA === 'undefined' || !DATA) return;
    // 水まわりの既定モデルを、部屋に合うものへ差し替えてから組み立てる。
    // **中心は動かさない。** 寸法だけが入れ替わるので、図面どおりの位置に残る。
    // 組み立て(toAppObjects)より前に置くこと。後ろだと差し替えが効かない。
    if (ST.result.finish && typeof PlanFinish !== 'undefined') {
      PlanFinish.applyPicks(ST.result.plan, ST.result.finish.picks);
    }
    var read = toAppObjects(ST.result.plan);
    var readFloors = floorsOfObjects(read.walls, read.rooms, read.items);
    if (!readFloors.length) return;

    // 起動直後の既定プランだけは下敷きにしない（下を見よ）。
    var fresh = isUntouchedDefault();
    var base = fresh ? { walls: [], rooms: [], items: [] } : DATA;
    var beside = hasWorkOnFloors(base, readFloors);

    // 何が起きるのかを、押す前に言う。
    if ((DATA.walls || []).length || (DATA.rooms || []).length) {
      var ask = fresh
        ? 'いまの間取りを外して、読み取った下書き（' + floorLabel(readFloors) + '）から作りはじめます。よろしいですか？'
        : beside
          ? 'いまの' + floorLabel(readFloors) + 'には間取りがあります。消さずに、'
            + '読み取った下書きをその右隣に建てます。よろしいですか？'
            + '（見比べて、要らないほうを消してください）'
          : '読み取った下書き（' + floorLabel(readFloors) + '）を、いまの間取りに足します。よろしいですか？';
      if (!confirm(ask)) return;
    }

    // 取り消せるようにしてから触る。**丸ごと差し替えていた頃は、取り込みが
    // 最後の操作になるので履歴を捨てていた。** いまは元の間取りが残る以上、
    // 押し間違いを1手で戻せるべきである。
    if (typeof saveState === 'function') saveState();
    root._defaultPlanPending = false;

    if (beside) {
      // 隣へずらしてから構造部材を作る。順番が逆だと、基礎と屋根だけが
      // 元の位置に残る。
      var here = planBounds(base), there = planBounds(read);
      if (here && there) shiftPlan(read, Math.round(here.x1 - there.x0 + BESIDE_GAP_MM));
      // **下書きの基礎と屋根は、下書きの壁だけから作る。** いまの間取りの壁と
      // まとめて外形を取ると、2棟をまたぐ1枚の基礎と1枚の屋根になる。
      DATA.walls = (base.walls || []).concat(read.walls);
      DATA.rooms = (base.rooms || []).concat(read.rooms);
      DATA.items = (base.items || []).concat(read.items, structureItems(read.walls, null));
    } else {
      // 空いている階に入れる。読み取った階に在るのは、壁から決まる基礎・屋根
      // だけなので、それはここで作り直す（階が増えれば屋根の載る位置も変わる）。
      var keepItems = (base.items || []).filter(function (o) {
        return !(isDerivedStructure(o) && readFloors.indexOf(Number(o.floor) || 1) >= 0);
      });
      DATA.walls = (base.walls || []).concat(read.walls);
      DATA.rooms = (base.rooms || []).concat(read.rooms);
      var made = structureItems(DATA.walls, readFloors);
      DATA.items = keepItems.filter(function (it) {
        return !made.some(function (st) {
          return it && it.type === st.type && (Number(it.floor) || 1) === (Number(st.floor) || 1);
        });
      }).concat(read.items, made);
    }
    // 読み込み経路(doImport)と同じ手順で、アプリが期待する既定値をそろえる。
    if (typeof syncNorthFromPlan === 'function') syncNorthFromPlan();
    if (typeof ensureObjectIds === 'function') ensureObjectIds();
    if (typeof ensureExteriorWallSettings === 'function') ensureExteriorWallSettings();
    if (typeof ensureInteriorWallSettings === 'function') ensureInteriorWallSettings();
    if (typeof ensureRoofAppearance === 'function') ensureRoofAppearance();
    if (typeof ensureFloorMetadata === 'function') ensureFloorMetadata();
    if (typeof syncExteriorWallSettings === 'function') syncExteriorWallSettings();
    if (typeof normalizeLegacyFurnitureItems === 'function') normalizeLegacyFurnitureItems();
    if (typeof sharedForceFullSync === 'function') sharedForceFullSync();
    if (typeof markDirty === 'function') markDirty();
    // 読み取った階を開く。**2階の下書きを1階の画面のまま返すと、何も
    // 起きなかったように見える。** 画面の当て直し(resetView)は開いている階に
    // 合わせるので、階を替えてから呼ぶ。
    var showFloor = readFloors[0];
    if (root.ST && Number(root.ST.floor) !== showFloor && typeof onFloorChange === 'function') {
      var sel = document.getElementById('floor-sel');
      if (sel) sel.value = String(showFloor);
      onFloorChange(showFloor);
    }
    if (typeof resetView === 'function') resetView();
    if (typeof draw2d === 'function') draw2d();
    if (typeof rebuild3D === 'function') rebuild3D();
    // 隣に建てたぶん、3Dも入りきらなくなる。両方が見える位置へ引く。
    if (typeof fitCameraToScene === 'function') fitCameraToScene();
    // 足りないものを道具の一覧に出す。**ここは閉じたあとも残る。**
    // 1つ置いてから次を置く、という使い方になるため。
    if (ST.result.finish && typeof PlanFinish !== 'undefined') PlanFinish.mount(ST.result.finish);
    closePlanImport();
  }

  // 囲む操作をキャンバスに繋ぐ。この script はダイアログのマークアップより
  // 後ろで読まれるので、この時点で要素は在る。
  // 指を離す位置がキャンバスの外になることがあるので、離す側は window で拾う。
  function wirePlanImportCanvas() {
    var c = $('plan-import-canvas');
    if (!c || c._planImportWired) return;
    c._planImportWired = true;
    c.addEventListener('mousedown', planImportDown);
    c.addEventListener('touchstart', planImportDown, { passive: false });
    root.addEventListener('mousemove', planImportMove);
    root.addEventListener('touchmove', planImportMove, { passive: false });
    root.addEventListener('mouseup', planImportUp);
    root.addEventListener('touchend', planImportUp);
    root.addEventListener('touchcancel', planImportUp);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wirePlanImportCanvas);
    else wirePlanImportCanvas();
  }

  root.openPlanImport = openPlanImport;
  root.closePlanImport = closePlanImport;
  root.resetPlanImport = resetPlanImport;
  root.onPlanImportFile = onPlanImportFile;
  root.planImportDown = planImportDown;
  root.planImportMove = planImportMove;
  root.planImportUp = planImportUp;
  root.planImportSelectAll = planImportSelectAll;
  root.runPlanImport = runPlanImport;
  root.applyPlanImport = applyPlanImport;
  // 検査から中身を覗くため
  root.PlanImport = {
    state: ST,
    croppedDataUrl: croppedDataUrl,
    toAppObjects: toAppObjects,
    showPlanImportError: showPlanImportError,
    showQuota: showQuota,
    renderPlanImportResult: renderPlanImportResult,
    reviewChanges: reviewChanges,
    fitContain: fitContain,
    MAX_SEND_PX: MAX_SEND_PX,
  };
}(typeof self !== 'undefined' ? self : this));
