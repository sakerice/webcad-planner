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

  function canvasPointToImage(e) {
    var c = $('plan-import-canvas');
    var rect = c.getBoundingClientRect();
    var t = (e.touches && e.touches[0]) || e;
    var s = previewScale();
    // getBoundingClientRect は CSS 上の大きさ。canvas の画素とは限らない。
    var sx = c.width / rect.width, sy = c.height / rect.height;
    return {
      x: Math.max(0, Math.min(ST.image.naturalWidth, (t.clientX - rect.left) * sx / s)),
      y: Math.max(0, Math.min(ST.image.naturalHeight, (t.clientY - rect.top) * sy / s)),
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
    }).then(function (res) {
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    }).then(function (r) {
      if (r.status !== 200) {
        ST.busy = false;
        showPlanImportError(r.status, r.body); syncPlanImportButtons(); showQuota(); return;
      }
      return revisePlanImport(images, hint, r.body).then(function (body) {
        ST.busy = false;
        ST.result = body;
        renderPlanImportResult(body);
        syncPlanImportButtons();
        showQuota();
      });
    }).catch(function (e) {
      ST.busy = false;
      setStatus('通信に失敗しました: ' + (e && e.message ? e.message : e));
      syncPlanImportButtons();
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
    }).then(function (res) {
      return res.json().then(function (out) { return { status: res.status, body: out }; });
    }).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.plan) {
        body.reviewNote = '見直しは行えませんでした（読み取った結果をそのまま出しています）。';
        return body;
      }
      // 費用は2回ぶんの合計で見せる。片方だけ出すと実際より安く見える。
      r.body.usage = addUsage(body.usage, r.body.usage);
      r.body.reviewImages = renders;
      r.body.reviewChanges = reviewChanges(pages, r.body.pages || []);
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
  function reviewChanges(before, after) {
    var bf = {}, lines = [];
    flatFloors(before).forEach(function (f) { bf[f.floor] = f; });
    flatFloors(after).forEach(function (a) {
      var b = bf[a.floor];
      if (!b) return;
      var n = a.floor + '階';
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
    return lines;
  }

  function flatFloors(pages) {
    var out = [];
    (pages || []).forEach(function (p) { ((p && p.floors) || []).forEach(function (f) { out.push(f); }); });
    return out;
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
  function showPlanImportError(status, body) {
    var code = (body && body.error) || '';
    var map = {
      ai_not_configured: 'この環境ではまだAIの読み取りを使えません（管理者の設定待ちです）。',
      ai_model_not_japan_resident: 'AIの設定が正しくないため実行しませんでした。管理者にお伝えください。',
      ai_invalid_plan: 'AIは読み取りましたが、そのままでは使えない形でした。図面の部分だけを大きく囲み直すと通ることがあります。',
      ai_bad_response: 'AIが間取りとして答えられませんでした。図面がはっきり写るように囲み直してください。',
      ai_upstream_error: 'AI側でエラーが起きました。少し待ってからもう一度お試しください。',
      ai_quota_exceeded: '',   // message をそのまま出す（残り回数を含むため）
      invalid_request: '送った画像に問題がありました。',
    };
    var text = map[code] || ('読み取れませんでした（' + status + ' ' + code + '）。');
    if (code === 'ai_quota_exceeded' && body && body.message) text = body.message;
    if (body && body.problems && body.problems.length) {
      text += '\n' + body.problems.slice(0, 5).join('\n');
    }
    setStatus(text);
  }

  function renderPlanImportResult(body) {
    var s = body.summary || {};
    setStatus('読み取りました。下の内容でよければ取り込んでください。');
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
      if (body.reviewNote) lines.push('・' + body.reviewNote);
      (body.notes || []).forEach(function (n) { lines.push('・' + n); });
      (body.warnings || []).forEach(function (w) { lines.push('・' + w); });
      notes.textContent = lines.length ? lines.join('\n') : '特にありません。';
    }
    show('plan-import-step3', true);
  }

  // ── 4. 取り込む ────────────────────────────────────────────────────
  //
  // 読み取れるのは壁・部屋・開口・階段だけなので、いまの間取りへ混ぜず
  // **置き換える**。混ぜると、どれが読み取った分でどれが元からの分か
  // 分からなくなり、取り消しもできない。
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
    // 壁から決まる構造部材（基礎・屋根）をここで足す。
    //
    // AIには出させない。基礎は1階の壁の外形そのもの、屋根は最上階の外形＋軒で
    // 一意に決まるので、読み取りの精度に左右されず必ず正しく置ける。
    // これが無いと、出来上がるのは「家」ではなく「壁の集まり」になる。
    var structure = (typeof PlanStructure !== 'undefined' && PlanStructure)
      ? PlanStructure.structureFor(plan.walls) : [];
    structure.forEach(function (st) {
      var made = mkItem(st.type, st.x, st.y, st.rot || 0, st.floor, st.w, st.d);
      // 種類ごとの欄（基礎の高さ・屋根の形）は mkItem の既定値より、
      // 壁から決めたこちらの値を優先する。
      Object.keys(st).forEach(function (k) {
        if (['type', 'x', 'y', 'w', 'd', 'rot', 'floor'].indexOf(k) < 0) made[k] = st[k];
      });
      out.items.push(made);
    });

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

  function applyPlanImport() {
    if (!ST.result || !ST.result.plan) return;
    if (typeof DATA !== 'undefined' && DATA && ((DATA.walls || []).length || (DATA.rooms || []).length)) {
      if (!confirm('いまの間取りを、読み取った間取りで置き換えます。よろしいですか？')) return;
    }
    var plan = toAppObjects(ST.result.plan);
    // 読み込み経路(doImport)と同じ手順で、アプリが期待する既定値をそろえる。
    root._defaultPlanPending = false;
    DATA = plan;
    if (typeof syncNorthFromPlan === 'function') syncNorthFromPlan();
    if (typeof ensureObjectIds === 'function') ensureObjectIds();
    if (typeof ensureExteriorWallSettings === 'function') ensureExteriorWallSettings();
    if (typeof ensureInteriorWallSettings === 'function') ensureInteriorWallSettings();
    if (typeof ensureRoofAppearance === 'function') ensureRoofAppearance();
    if (typeof ensureFloorMetadata === 'function') ensureFloorMetadata();
    if (typeof syncExteriorWallSettings === 'function') syncExteriorWallSettings();
    if (typeof normalizeLegacyFurnitureItems === 'function') normalizeLegacyFurnitureItems();
    if (typeof clearEditHistory === 'function') clearEditHistory();
    if (typeof sharedForceFullSync === 'function') sharedForceFullSync();
    if (typeof markDirty === 'function') markDirty();
    if (typeof resetView === 'function') resetView();
    if (typeof draw2d === 'function') draw2d();
    if (typeof rebuild3D === 'function') rebuild3D();
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
    MAX_SEND_PX: MAX_SEND_PX,
  };
}(typeof self !== 'undefined' ? self : this));
