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
    pages: null,        // PDFを選んだとき、送るページ画像 (data URL の配列)
    pageReview: null,   // 元ページ・切り出し範囲・確認状態
    pdfData: null,
    selectedPage: 0,
    version: 0,        // ファイル変更・取消し後の古い非同期結果を捨てる
    previewVersion: 0,
    fileName: '',
    crop: null,         // 切り出し範囲 {x,y,w,h} 画像の画素で
    drag: null,         // 囲んでいる最中の状態
    result: null,       // 読み取り結果 {plan, summary, notes, warnings, marks, usage}
    busy: false,
    requestVersion: 0,
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
      ST.sceneIRV3Available = !!(q && q.sceneIRV3 && q.sceneIRV3.enabled === true);
      if (!q || !q.counted || q.left === null || q.left === undefined) { box.style.display = 'none'; return; }
      box.style.display = '';
      box.textContent = q.left > 0
        ? '本日あと ' + q.left + ' 回 読み取れます（1日に ひとり ' + q.perUser + ' 回まで／全体 ' + q.total + ' 回まで）'
        : '本日ぶんの読み取りを使い切りました。明日またお試しください。';
      var run = $('plan-import-run');
      if (run && q.left <= 0) run.disabled = true;
    }).catch(function () { ST.sceneIRV3Available = false; box.style.display = 'none'; });
  }

  function closePlanImport() {
    if (ST.busy) resetPlanImport();
    ST.version++; ST.previewVersion++;
    ST.requestVersion++; ST.busy = false; ST.result = null; ST.mappingEditor = null;
    syncPlanImportButtons();
    var m = $('plan-import-modal');
    if (m) m.classList.remove('show');
    cancelPlanImportDrag();
  }

  function resetPlanImport() {
    ST.version++; ST.previewVersion++;
    ST.requestVersion++;
    ST.image = null; ST.pages = null; ST.fileName = '';
    ST.pageReview = null; ST.pdfData = null; ST.selectedPage = 0;
    ST.crop = null; ST.drag = null; ST.result = null; ST.busy = false; ST.mappingEditor = null;
    var f = $('plan-import-file'); if (f) f.value = '';
    show('plan-import-pdf-review', false);
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
  // 切り出せなかったページは、全体のプレビューを見て明示的に確認するか、
  // 手で囲み直してから送る。黙って全体を読み取りに回さない。
  // 位置探しに待てる時間。**上限が要る。** 実測で、AI 側が混んでいるときに
  // 1回200秒かかったことがある。切り出しは上乗せであって、これを待つために
  // 読み取りが始まらないのでは本末転倒。時間切れなら手元での確認へ進める。
  var LOCATE_TIMEOUT_MS = 25000;

  function locate(smallDataUrl) {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, LOCATE_TIMEOUT_MS);
      fetch('/api/ai/find-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: smallDataUrl }),
      }).then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) { clearTimeout(timer); resolve(body || null); })
        .catch(function () { clearTimeout(timer); resolve(null); });
    });
  }

  function validPlanBox(box) {
    return box && ['x0', 'y0', 'x1', 'y1'].every(function (key) {
      return typeof box[key] === 'number' && isFinite(box[key]) && box[key] >= 0 && box[key] <= 1;
    }) && box.x1 > box.x0 && box.y1 > box.y0;
  }

  function pendingPdfPages() {
    return ST.pageReview ? ST.pageReview.filter(function (p) { return !p.confirmed; }).length : 0;
  }

  function setPdfReviewStatus() {
    if (ST.pageReview && !ST.busy && !ST.result) {
      var pending = pendingPdfPages();
      setStatus(pending ? '未確認のページが ' + pending + ' 枚あります。各ページを囲み直すか、全体を確認してください。'
        : ST.pages.length + 'ページを読み取ります。送信予定の画像を確認してください。');
    }
  }

  function syncPdfReview() {
    if (!ST.pageReview) return;
    var select = $('plan-import-page');
    if (select) {
      select.textContent = '';
      ST.pageReview.forEach(function (page, i) {
        var option = document.createElement('option');
        option.value = String(i);
        option.textContent = (page.sourceIdentity ? page.sourceIdentity.pageNumber : i + 1) + 'ページ — ' + page.status;
        select.appendChild(option);
      });
      select.value = String(ST.selectedPage);
      select.disabled = ST.busy;
    }
    var page = ST.pageReview[ST.selectedPage];
    var status = $('plan-import-page-status');
    if (status) status.textContent = (page.sourceIdentity ? page.sourceIdentity.pageNumber : ST.selectedPage + 1) + 'ページ: ' + page.status + '。' + page.message
      + (page.sourceIdentity ? ' 元ページの階見出し: ' + (page.sourceIdentity.sourceHeader.labels.join(' / ') || '未確認') + '。' : '');
    var preview = $('plan-import-output');
    if (preview) {
      preview.src = ST.pages[ST.selectedPage];
      preview.alt = (ST.selectedPage + 1) + 'ページの送信予定画像';
    }
    var confirm = $('plan-import-confirm-page');
    if (confirm) confirm.disabled = ST.busy || !ST.image || page.confirmed || !!page.box;
  }

  function selectPlanImportPage(index) {
    index = Number(index);
    if (ST.busy || !ST.pageReview || !Number.isInteger(index) || !ST.pageReview[index]) return;
    ST.selectedPage = index;
    setPdfReviewStatus();
    ST.image = null; ST.crop = null; ST.drag = null;
    var c = $('plan-import-canvas');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    var version = ST.version, previewVersion = ++ST.previewVersion;
    var page = ST.pageReview[index], img = new Image();
    syncPlanImportButtons();
    img.onload = function () {
      if (version !== ST.version || previewVersion !== ST.previewVersion) return;
      ST.image = img;
      var b = page.box || { x0: 0, y0: 0, x1: 1, y1: 1 };
      ST.crop = { x: b.x0 * img.naturalWidth, y: b.y0 * img.naturalHeight,
        w: (b.x1 - b.x0) * img.naturalWidth, h: (b.y1 - b.y0) * img.naturalHeight };
      drawPlanImportPreview();
      syncPlanImportButtons();
    };
    img.onerror = function () {
      if (version !== ST.version || previewVersion !== ST.previewVersion) return;
      page.confirmed = false;
      page.status = '要確認'; page.message = 'プレビューを開けません。ファイルを選び直してください。';
      setPdfReviewStatus();
      syncPlanImportButtons();
    };
    img.src = page.source;
  }

  function confirmPlanImportPage() {
    if (ST.busy || !ST.pageReview || !ST.image) return;
    var page = ST.pageReview[ST.selectedPage];
    if (page.box) return;
    page.confirmed = true; page.status = '全体を確認済み';
    page.message = 'このページ全体を読み取ります。';
    setPdfReviewStatus();
    syncPlanImportButtons();
  }

  // 手で囲んだ範囲もPDFから3072pxで描き直す（縮小済みの画像を拡大しない）。
  function cropPlanImportPage() {
    if (!ST.pageReview || !ST.image || !ST.crop || ST.busy) return;
    var index = ST.selectedPage, page = ST.pageReview[index], version = ST.version;
    var box = { x0: ST.crop.x / ST.image.naturalWidth, y0: ST.crop.y / ST.image.naturalHeight,
      x1: (ST.crop.x + ST.crop.w) / ST.image.naturalWidth,
      y1: (ST.crop.y + ST.crop.h) / ST.image.naturalHeight };
    if (box.x0 === 0 && box.y0 === 0 && box.x1 === 1 && box.y1 === 1) {
      planImportSelectAll(); return;
    }
    page.confirmed = false;
    ST.result = null; ST.mappingEditor = null; ST.busy = true;
    show('plan-import-step3', false);
    page.status = '切り出し中'; page.message = '選んだ範囲をPDFから描き直しています。';
    syncPlanImportButtons();
    return Promise.resolve().then(function () {
      if (version !== ST.version) return null;
      return PdfPages.renderRegion(ST.pdfData, page.sourceIdentity ? page.sourceIdentity.pageNumber : index + 1, box, { maxPx: MAX_SEND_PX });
    }).then(function (cropped) {
      if (version !== ST.version) return;
      if (!cropped) throw new Error('empty crop');
      ST.pages[index] = cropped; page.box = box; page.confirmed = true;
      if (page.sourceIdentity) page.sourceIdentity = PlanSourceIdentity.cropPage(page.sourceIdentity, box, cropped);
      page.status = '手動で切り出し済み'; page.message = '選んだ範囲を読み取ります。';
    }).catch(function () {
      if (version !== ST.version) return;
      ST.pages[index] = page.source; page.box = null; page.confirmed = false;
      if (page.sourceIdentity) page.sourceIdentity = PlanSourceIdentity.cropPage(page.sourceIdentity, null, page.source);
      page.status = '要確認'; page.message = '切り出しに失敗しました。囲み直すか、ページ全体を確認してください。';
    }).then(function () {
      if (version !== ST.version) return;
      ST.busy = false;
      selectPlanImportPage(index);
    });
  }

  // ── 1. 画像を選ぶ ──────────────────────────────────────────────────
  function onPlanImportFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    resetPlanImport();
    ST.fileName = file.name || '';
    var version = ST.version, sourceVersion = ST.requestVersion;
    function current() { return version === ST.version && sourceVersion === ST.requestVersion; }
    function fail(message) {
      if (!current()) return;
      ST.busy = false; setStatus(message); syncPlanImportButtons();
    }
    ST.busy = true;
    syncPlanImportButtons();

    // PDFはページ全体と切り出し結果を別々に持ち、失敗したページを確認できる。
    if (file.type === 'application/pdf' || /\.pdf$/i.test(ST.fileName)) {
      var pdfReader = new FileReader();
      pdfReader.onload = function (e) {
        if (!current()) return;
        setStatus('PDFを開いています…');
        if (typeof PdfPages === 'undefined' || !PdfPages) {
          fail('PDFを開く部品がありません。画像にしてからお試しください。');
          return;
        }
        var pdfData = e.target.result, smalls = null, review = null;
        ST.pdfData = pdfData;
        PdfPages.renderPages(pdfData, {
          maxPx: MAX_SEND_PX,
          onProgress: function (n, total) {
            if (current()) setStatus('PDFを開いています… ' + n + ' / ' + total + 'ページ');
          },
        }).then(function (pages) {
          if (!current()) return [];
          if (!pages.length) { fail('このPDFにページがありません。'); return []; }
          // 小さい版を作れなくても、元ページのプレビューから手で確認できる。
          return PdfPages.renderPages(pdfData, { maxPx: 1024 }).then(function (small) {
            if (!current()) return [];
            smalls = small; return pages;
          }).catch(function () { return pages; });
        }).then(function (pages) {
          if (!current() || !pages || !pages.length) return [];
          setStatus('図面の位置を探しています…');
          var out = pages.slice();
          var documentHash = typeof PlanSourceIdentity !== 'undefined' ? PlanSourceIdentity.hash(pdfData) : null;
          review = pages.map(function (page, i) {
            return { source: page, sourceIdentity: documentHash ? PlanSourceIdentity.createPage(page, i + 1, documentHash, null) : null,
              box: null, confirmed: false, status: '要確認',
              message: '図面の位置を確認できませんでした。囲み直すか、ページ全体を確認してください。' };
          });
          return Promise.all(pages.map(function (page, i) {
            return locate((smalls && smalls[i]) || page);
          })).then(function (locations) {
            if (!current()) return [];
            var boxes = locations.map(function (location, i) {
              if (review[i].sourceIdentity) review[i].sourceIdentity = PlanSourceIdentity.createPage(pages[i], i + 1, documentHash, location && location.sourceHeader);
              return location && location.box;
            });
            var next = function (i) {
              if (!current()) return [];
              if (i >= pages.length) return out;
              if (!validPlanBox(boxes[i])) return next(i + 1);
              setStatus('図面を切り出しています… ' + (i + 1) + ' / ' + pages.length + 'ページ');
              return Promise.resolve().then(function () {
                if (!current()) return null;
                return PdfPages.renderRegion(pdfData, i + 1, boxes[i], { maxPx: MAX_SEND_PX });
              }).then(function (cropped) {
                if (!current()) return;
                if (!cropped) throw new Error('empty crop');
                out[i] = cropped;
                review[i].box = boxes[i]; review[i].confirmed = true;
                if (review[i].sourceIdentity) review[i].sourceIdentity = PlanSourceIdentity.cropPage(review[i].sourceIdentity, boxes[i], cropped);
                review[i].status = '自動切り出し済み';
                review[i].message = '送信予定の範囲を確認できます。必要なら囲み直してください。';
              }).catch(function () {
                if (!current()) return;
                review[i].message = '切り出しに失敗しました。囲み直すか、ページ全体を確認してください。';
              }).then(function () { return next(i + 1); });
            };
            return next(0);
          });
        }).then(function (pages) {
          if (!current() || !pages || !pages.length) return;
          ST.pages = pages; ST.pageReview = review; ST.busy = false;
          show('plan-import-step2', true);
          show('plan-import-crop', true);
          show('plan-import-pdf-review', true);
          show('plan-import-step3', false);
          selectPlanImportPage(0);
        }).catch(function (err) {
          fail('PDFを開けませんでした: ' + (err && err.message ? err.message : err));
        });
      };
      pdfReader.onerror = function () { fail('ファイルを読めませんでした。'); };
      pdfReader.readAsDataURL(file);
      return;
    }

    if (!/^image\//.test(file.type)) {
      fail('PDF か画像（PNG / JPEG / WebP）を選んでください。');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      if (!current()) return;
      var img = new Image();
      img.onload = function () {
        if (!current()) return;
        ST.image = img; ST.busy = false;
        ST.crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        show('plan-import-step2', true);
        show('plan-import-crop', true);
        drawPlanImportPreview();
        setStatus('このまま読み取れます。図面が紙面の一部にしか写っていない場合は、'
          + '図面の部分だけをドラッグで囲むと、より正確に読めます（任意）。');
        syncPlanImportButtons();
      };
      img.onerror = function () { fail('この画像を開けませんでした。別の形式で試してください。'); };
      img.src = e.target.result;
    };
    reader.onerror = function () { fail('ファイルを読めませんでした。'); };
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
    if (!ST.image || ST.busy) return;
    e.preventDefault();
    var p = canvasPointToImage(e);
    ST.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 };
    syncPlanImportButtons();
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

  function invalidateScenePlacement() {
    ST.requestVersion++; ST.busy = false;
    if (ST.result && ST.result.sceneIR && ST.result.sceneIR.sceneVersion === 3) {
      var opts = JSON.parse(JSON.stringify(ST.result.sceneOptions));
      opts.sourceInvalidated = true;
      opts.placementContext = null; opts.pageScope = null;
      opts.acceptedReviews = []; opts.acceptedReviewGroups = []; opts.reviewedEntities = {}; opts.unresolvedDecisions = [];
      stageSceneIR(ST.result.sceneIR, opts);
    }
  }

  function planImportUp() {
    if (!ST.drag) return;
    // 指が滑っただけの極小の矩形は、選び直しとみなして捨てる。
    if (ST.drag.w > 20 && ST.drag.h > 20) {
      invalidateScenePlacement();
      ST.crop = { x: ST.drag.x, y: ST.drag.y, w: ST.drag.w, h: ST.drag.h };
      if (ST.pageReview) cropPlanImportPage();
    }
    ST.drag = null;
    drawPlanImportPreview();
    syncPlanImportButtons();
  }

  function cancelPlanImportDrag() {
    ST.drag = null;
    drawPlanImportPreview();
    syncPlanImportButtons();
  }

  function planImportSelectAll() {
    if (!ST.image || ST.busy) return;
    invalidateScenePlacement();
    if (ST.pageReview) {
      var page = ST.pageReview[ST.selectedPage];
      page.box = null; page.confirmed = false; page.status = '要確認';
      page.message = 'ページ全体に戻しました。囲み直すか、全体を確認してください。';
      ST.pages[ST.selectedPage] = page.source;
      if (page.sourceIdentity) page.sourceIdentity = PlanSourceIdentity.cropPage(page.sourceIdentity, null, page.source);
      ST.result = null; ST.mappingEditor = null; show('plan-import-step3', false);
      setPdfReviewStatus();
    }
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
    if (run) run.disabled = (!ST.image && !ST.pages) || ST.busy || !!ST.drag || pendingPdfPages() > 0;
    syncPdfReview();

    var apply = $('plan-import-apply');
    if (apply) apply.disabled = !!ST.mappingEditor || !ST.result || ST.busy || !!(ST.result && ST.result.buildingApplied) || !!(ST.result.sceneCompilation && !ST.result.sceneCompilation.canApply) || !!(ST.result && ST.result.sourceLocal && (!ST.result.buildingCompilation || !ST.result.buildingCompilation.canApply));
    var size = $('plan-import-crop-size');
    if (size && ST.crop) {
      var pdfCrop = ST.pageReview && ST.pageReview[ST.selectedPage].box;
      var scale = pdfCrop ? MAX_SEND_PX / Math.max(ST.crop.w, ST.crop.h)
        : Math.min(1, MAX_SEND_PX / Math.max(ST.crop.w, ST.crop.h));
      size.textContent = '送る範囲: ' + Math.round(ST.crop.w) + '×' + Math.round(ST.crop.h) +
        ' 画素 → ' + Math.round(ST.crop.w * scale) + '×' + Math.round(ST.crop.h * scale) +
        (pdfCrop ? ' にPDFから描き直して送信' : ' に縮めて送信');
    }
  }

  // ── 3. 読み取る ────────────────────────────────────────────────────
  function runPlanImport(options) {
    var contract = options && options.extractionContract;
    if (contract && (contract !== 'scene-ir-v3' || (root.SCENE_IR_V3_IMAGE_IMPORT !== true || ST.sceneIRV3Available !== true))) {
      setStatus('この実験的な読み取り方式は有効になっていません。'); return;
    }
    if (ST.busy || ST.drag || pendingPdfPages() > 0) return;
    var version = ST.version;
    // PDFはページごとの画像、画像は切り出して(囲んでいなければ全体を)送る。
    var images = ST.pages ? ST.pages.slice() : (function () { var one = croppedDataUrl(); return one ? [one] : []; }());
    if (!images.length) return;
    var requestVersion = ++ST.requestVersion;
    var pageScope = contract ? images.map(function (image, i) { return "image:" + (i + 1) + ":" + SceneIR.sourceHash(image); }) : null;
    ST.busy = true; ST.result = null; ST.mappingEditor = null;
    show('plan-import-step3', false);
    syncPlanImportButtons();
    setStatus('読み取っています… 図面1枚で30秒ほどかかります。');

    var hint = ($('plan-import-hint') && $('plan-import-hint').value) || '';
    var requestBody = { images: images, hint: contract ? '' : hint };
    if (contract) requestBody.extractionContract = contract;
    // Full-page header evidence remains separate from the crop sent to extraction.
    var sourcePages = !contract && ST.pageReview && ST.pageReview.every(function (p) { return p.sourceIdentity; })
      ? ST.pageReview.map(function (p) { return JSON.parse(JSON.stringify(p.sourceIdentity)); }) : null;
    if (sourcePages) {
      var sourceCheck = PlanSourceIdentity.normalizePages(sourcePages, images);
      if (sourceCheck.problems.length) { ST.busy = false; setStatus(sourceCheck.problems.join('\n')); syncPlanImportButtons(); return; }
      requestBody.sourcePages = sourcePages;
    }
    function currentSource() {
      return !sourcePages || ST.pageReview && ST.pages && JSON.stringify(ST.pageReview.map(function (p) { return p.sourceIdentity; })) === JSON.stringify(sourcePages)
        && ST.pages.length === images.length && ST.pages.every(function (image, i) { return image === images[i]; });
    }
    return fetch('/api/ai/import-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    }).then(readReply).then(function (r) {
      if (version !== ST.version || requestVersion !== ST.requestVersion) return null;
      return waitForJobs(r, { isCurrent: function () { return version === ST.version && requestVersion === ST.requestVersion; }, onProgress: function (done, total) {
        if (version !== ST.version || requestVersion !== ST.requestVersion) return;
        setStatus('読み取っています… ' + done + ' / ' + total + ' 枚が終わりました。');
      } });
    }).then(function (r) {
      if (version !== ST.version || requestVersion !== ST.requestVersion || !r) return;
      var isSceneResponse = contract || (r.body && r.body.extractionContract === 'scene-ir-v3');
      var repairable = !isSceneResponse && r.status === 422 && r.body && r.body.error === 'ai_invalid_plan' &&
        r.body.revisionCandidate === true && Array.isArray(r.body.pages) && r.body.pages.length;
      if (r.status !== 200 && !repairable) {
        if (isSceneResponse) ST.failedSceneResponse = r.body;
        ST.busy = false;
        showPlanImportError(r.status, r.body); syncPlanImportButtons(); showQuota(); return;
      }
      if (contract || (r.body && r.body.extractionContract === 'scene-ir-v3')) {
        ST.busy = false;
        if (!contract || !r.body || r.body.extractionContract !== contract || !r.body.sceneIR || r.body.sceneIR.sceneVersion !== 3) {
          setStatus('読み取り方式と返答が一致しません。元の返答を保持し、旧方式へ切り替えずに停止しました。');
          ST.failedSceneResponse = r.body; syncPlanImportButtons(); return;
        }
        stageSceneIR(r.body.sceneIR, { materialization: 'bounded-v3', pageScope: pageScope, extraction: { extractionContract: r.body.extractionContract,
          rawResponse: r.body.rawResponse, contract: r.body.contract, provenance: r.body.provenance,
          diagnostics: r.body.diagnostics } });
        syncPlanImportButtons(); showQuota(); return;
      }
      if (!currentSource()) { ST.busy = false; setStatus('元ページまたは切り出しが変わりました。読み直してください。'); syncPlanImportButtons(); return; }
      if (sourcePages && r.body.sourcePages && JSON.stringify(r.body.sourcePages) !== JSON.stringify(sourcePages)) {
        ST.busy = false; setStatus('返答の元ページと送信した画像が一致しません。読み直してください。'); syncPlanImportButtons(); return;
      }
      if (sourcePages) r.body.sourcePages = sourcePages;
      return maybeRevisePlanImport(images, hint, r.body, version).then(function (body) {
        if (version !== ST.version || requestVersion !== ST.requestVersion) return;
        // A failed/skipped repair must never turn the invalid raw reading into
        // ST.result or enable Apply. Revisions are validated by the server again.
        if (!body || !body.plan || body.error) {
          ST.busy = false;
          showPlanImportError(422, body); syncPlanImportButtons(); showQuota(); return;
        }
        if (!currentSource()) { ST.busy = false; setStatus('元ページまたは切り出しが変わりました。読み直してください。'); syncPlanImportButtons(); return; }
        if (sourcePages) {
          if (body.sourcePages && JSON.stringify(body.sourcePages) !== JSON.stringify(sourcePages)) {
            ST.busy = false; setStatus('返答の元ページと送信した画像が一致しません。読み直してください。'); syncPlanImportButtons(); return;
          }
          var reconciled = PlanSourceIdentity.reconcile(body.pages || [], sourcePages);
          if (reconciled.pages.length !== sourcePages.length || reconciled.problems.length) {
            ST.busy = false;
            showPlanImportError(422, { error: 'ai_ambiguous_floors', problems: reconciled.problems }); syncPlanImportButtons(); return;
          }
          body.pages = reconciled.pages; body.sourcePages = sourcePages;
        }
        // 仕上げの判断をもらってから画面を出す。**失敗しても止めない。**
        // 判断が得られなければ、これまでどおり下書きだけを渡す。
        if (body.sourceLocal) {
          ST.busy = false; stageBuildingReview(body); showQuota(); return;
        }
        var finish = (typeof PlanFinish === 'undefined' || !body.plan)
          ? Promise.resolve(null) : PlanFinish.analyze(body.plan, body.marks);
        return finish.then(function (out) {
          if (version !== ST.version || requestVersion !== ST.requestVersion) return;
          if (!currentSource()) { ST.busy = false; setStatus('元ページまたは切り出しが変わりました。読み直してください。'); syncPlanImportButtons(); return; }
          body.finish = out;
          ST.busy = false;
          ST.result = body;
          renderPlanImportResult(body);
          syncPlanImportButtons();
          showQuota();
        });
      });
    }).catch(function () {
      if (version !== ST.version || requestVersion !== ST.requestVersion) return;
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
    var extractionContract = first.body.extractionContract;
    var until = Date.now() + JOB_TIMEOUT_MS;
    function once() {
      if (opts.isCurrent && !opts.isCurrent()) return null;
      if (opts.isCancelled && opts.isCancelled()) return null;
      if (Date.now() > until) return { status: 504, body: null };
      var pollBody = { jobs: jobs, revised: Boolean(opts.revised) };
      if (extractionContract) pollBody.extractionContract = extractionContract;
      return fetch('/api/ai/plan-result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pollBody),
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
  function maybeRevisePlanImport(images, hint, body, version) {
    if (body && (body.extractionContract === 'scene-ir-v3' || body.sceneIR)) return Promise.resolve(body);
    var advice = body && body.revise;
    if (!advice || !advice.skipAll) return revisePlanImport(images, hint, body, version);
    body.reviewSkipped = true;
    return Promise.resolve(body);
  }

  function revisePlanImport(images, hint, body, version) {
    if (body && (body.extractionContract === 'scene-ir-v3' || body.sceneIR)) return Promise.resolve(body);
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
      body: JSON.stringify(Object.assign({ images: images, renders: renders, pages: pages, hint: hint }, body.sourcePages ? { sourcePages: body.sourcePages } : {})),
    }).then(readReply).then(function (r) {
      if (version !== ST.version) return null;
      return waitForJobs(r, { revised: true, isCurrent: function () { return version === ST.version; }, onProgress: function (done, total) {
        if (version !== ST.version) return;
        setStatus('AIに見直させています… ' + done + ' / ' + total + ' 枚が終わりました。');
      } });
    }).then(function (r) {
      if (version !== ST.version || !r) return body;
      if (r.body && r.body.error === 'ai_ambiguous_floors') return r.body;
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
      ai_ambiguous_floors: 'ページと階の対応を確定できません。対象の階の図面だけを選び、階数を補足して読み直してください。',
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
    var applyButton = $('plan-import-apply');
    if (applyButton) applyButton.disabled = !!ST.mappingEditor || !!body.buildingApplied || !!(body.sceneCompilation && !body.sceneCompilation.canApply) || !!(body.sourceLocal && (!body.buildingCompilation || !body.buildingCompilation.canApply));
    var s = body.summary || {};
    setStatus(body.sourceLocal ? '複数階の下書きです。位置合わせと未検証項目を確認してください。' : '下書きができました。取り込んだあと、手で直して仕上げてください。');
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
            var jo = ((r.shape && typeof RoomGeometry !== 'undefined' ? RoomGeometry.area(r) : r.w * r.d) / 1656200).toFixed(1);   // 1帖 = 910×1820 mm
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
        var recs = PlanFinish.shownRecommendations(body.finish).length;
        if (swaps) lines.push('・水まわり ' + swaps + ' 点を、部屋の広さに合うモデルに差し替えます。');
        if (recs) lines.push('・図面に描かれていた家具 ' + recs + ' 種類を、カタログの先頭に「おすすめの家具」として出します。');
      }
      if (body.reviewNote) lines.push('・' + body.reviewNote);
      (body.notes || []).forEach(function (n) { lines.push('・' + n); });
      // 読み取りの指摘。**仕上げのあとのものも足す。**仕上げで部屋の用途が
      // 決まると、名前だけでは照らせなかった部屋(洋室など)も照らせる。
      // 同じ文は2度出さない。
      var said = {};
      (body.warnings || []).concat((body.finish && body.finish.warnings) || []).forEach(function (w) {
        if (said[w]) return;
        said[w] = true;
        lines.push('・' + w);
      });
      notes.textContent = lines.length ? lines.join('\n') : '特にありません。';
    }
    renderSceneIRReview(body);
    renderBuildingReview(body);
    show('plan-import-step3', true);
  }

  function syncBuildingNotice() {
    var notice=$('building-registration-notice'); if(!notice)return;
    var reports=typeof DATA==='object' && DATA ? (DATA.sceneReconstructionReports||[]).filter(function(r){return r.kind==='building-registration' && r.status==='partial-building-assembly';}) : [];
    notice.hidden=!reports.length;
    var details=$('building-registration-notice-detail');if(!details)return;
    var text=reports.map(function(r){var floors=(r.sourceLocal&&r.sourceLocal.floors||[]).map(function(f){return f.floor+'階';}).join('・');return floors+': 取り込み時に階段部材 '+(r.deferredItems||[]).length+' 点を未配置として保持。階高・階段の接続・床の開口・屋根は未検証です。高さは表示既定値を使用。元の図面・UP/DNの印・判断の記録は保存データに残っています。';}).join('\n');
    if(details.textContent!==text)details.textContent=text;
  }

  // Multi-floor v1 registration is a separate review of immutable local frames.
  // Server/model proposals never carry user approval. All decisions are snapshot-bound.
  function compileBuildingReview(body) {
    if (!body || !body.sourceLocal || typeof PlanRegistration === 'undefined') return null;
    var opts = body.buildingDecisions || {};
    opts = Object.assign({}, opts, {proposals:body.buildingRegistration || {version:1,floors:[]}});
    var compiled = PlanRegistration.compile(body.sourceLocal, opts);
    if (body.buildingSourceVersion !== undefined && body.buildingSourceVersion !== ST.version) {
      compiled.canApply = false;
      compiled.diagnostics.push({code:'stale_source_scope',severity:'error',message:'画像や切り出しが変わりました。読み取りからやり直してください。'});
    }
    if (typeof SHARED === 'object' && SHARED && SHARED.roomId) {
      compiled.canApply=false;
      compiled.diagnostics.push({code:'shared_session_unsupported',severity:'error',message:'複数階の位置合わせ記録は共同編集に未対応です。共有を終了してから取り込んでください。'});
    }
    body.buildingCompilation = compiled;
    return compiled;
  }
  function stageBuildingReview(body) {
    if (!body || !body.sourceLocal) return null;
    body.buildingSourceVersion = ST.version;
    body.originalBuildingRegistration = body.originalBuildingRegistration || JSON.parse(JSON.stringify(body.buildingRegistration || null));
    body.buildingDecisions = {sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[],partialAcknowledged:false};
    ST.result = body;
    compileBuildingReview(body);
    renderPlanImportResult(body);
    syncPlanImportButtons();
    return body.buildingCompilation;
  }
  function requestBuildingRegistration(body) {
    if (ST.result !== body || ST.busy || !body.sourceLocal || !ST.pages || ST.pages.length < 2) return;
    var version=ST.version, requestVersion=++ST.requestVersion, sourceSnapshot=PlanRegistration.snapshot(body.sourceLocal);
    ST.busy=true;
    body.buildingDecisions={sourceSnapshot:sourceSnapshot,floors:[],partialAcknowledged:false};
    syncPlanImportButtons();
    setStatus('全ページの位置合わせを追加で読み取っています。結果は確認前の提案です。');
    function current(){return ST.result===body && ST.version===version && ST.requestVersion===requestVersion && PlanRegistration.snapshot(body.sourceLocal)===sourceSnapshot;}
    function post(path,payload){return fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(readReply);}
    function poll(reply){
      if(!current()) return null;
      if(reply.status!==202) return reply;
      return new Promise(function(resolve){setTimeout(resolve,3000);}).then(function(){
        if(!current())return null;
        return post('/api/ai/register-plan-result',{jobs:reply.body.jobs,sourceLocal:body.sourceLocal,sourceSnapshot:sourceSnapshot}).then(poll);
      });
    }
    return post('/api/ai/register-plan',{images:ST.pages.slice(),sourceLocal:body.sourceLocal,sourceSnapshot:sourceSnapshot}).then(poll).then(function(reply){
      if(!current() || !reply)return;
      ST.busy=false;
      if(reply.status!==200 || !reply.body || reply.body.sourceSnapshot!==sourceSnapshot || !reply.body.buildingRegistration){
        setStatus(reply.body && reply.body.message || '位置合わせの提案を取得できませんでした。元の図面と未確認状態を保持しています。');syncPlanImportButtons();return;
      }
      body.buildingRegistration=JSON.parse(JSON.stringify(reply.body.buildingRegistration));
      body.originalBuildingRegistration=JSON.parse(JSON.stringify(reply.body.buildingRegistration));
      body.registrationExtraction={rawResponse:reply.body.rawResponse || null,usage:reply.body.usage || null};
      compileBuildingReview(body);renderPlanImportResult(body);syncPlanImportButtons();
    }).catch(function(){if(current()){ST.busy=false;setStatus('位置合わせの通信に失敗しました。未確認のまま保持しています。');syncPlanImportButtons();}});
  }
  function drawBuildingSource(canvas, source, f) {
    if (!canvas.getContext) return;
    var ctx=canvas.getContext('2d'); if(!ctx)return;
    var scale=Math.min(460/f.width,220/f.depth);
    canvas.width=480;canvas.height=240;ctx.clearRect(0,0,480,240);ctx.save();ctx.translate(10,10);ctx.scale(scale,scale);
    ctx.lineWidth=1/scale;ctx.strokeStyle='#73818a';
    (f.rooms||[]).forEach(function(r){(r.parts||[r]).forEach(function(p){ctx.strokeRect(p.x0,p.y0,p.x1-p.x0,p.y1-p.y0);});});
    ctx.strokeStyle='#cf6826';if(ctx.setLineDash)ctx.setLineDash([6/scale,4/scale]);
    (source.items||[]).filter(function(it){return it.floor===f.floor && /^stair/.test(it.type);}).forEach(function(it){
      if(!Number.isFinite(it.w)||!Number.isFinite(it.d))return;ctx.save();ctx.translate(it.x,it.y);ctx.rotate((it.rot||0)*Math.PI/180);ctx.strokeRect(-it.w/2,-it.d/2,it.w,it.d);ctx.restore();
    });
    ctx.font=(14/scale)+'px sans-serif';ctx.fillStyle='#cf6826';
    (source.marks||[]).filter(function(m){return m.floor===f.floor && /(?:UP|DN|階段)/i.test(m.label||'');}).forEach(function(m){if(Number.isFinite(m.x)&&Number.isFinite(m.y))ctx.fillText(m.label,m.x,m.y);});
    ctx.restore();
  }
  function drawBuildingAssembly(canvas, compiled) {
    if (!canvas.getContext || compiled.floors.some(function(f){return !f.solution.ok;})) return;
    var ctx=canvas.getContext('2d'), walls=compiled.plan.walls; if(!ctx || !walls.length)return;
    var xs=[],ys=[];walls.forEach(function(w){xs.push(w.x1,w.x2);ys.push(w.y1,w.y2);});
    var x0=Math.min.apply(null,xs),y0=Math.min.apply(null,ys),w=Math.max.apply(null,xs)-x0,d=Math.max.apply(null,ys)-y0;
    var scale=Math.min(590/Math.max(w,1),300/Math.max(d,1));canvas.width=640;canvas.height=360;
    ctx.clearRect(0,0,640,360);ctx.save();ctx.translate(25,25);ctx.scale(scale,scale);ctx.translate(-x0,-y0);
    var colors=['#2673a7','#bb4c52','#31866b','#9163af'];
    compiled.floors.forEach(function(f,i){ctx.strokeStyle=colors[i%colors.length];ctx.lineWidth=(i+1)/scale;
      if(ctx.setLineDash)ctx.setLineDash(i?[5/scale,3/scale]:[]);
      ctx.beginPath();walls.filter(function(wall){return wall.floor===f.floor;}).forEach(function(wall){ctx.moveTo(wall.x1,wall.y1);ctx.lineTo(wall.x2,wall.y2);});ctx.stroke();
    });ctx.restore();ctx.font='14px sans-serif';compiled.floors.forEach(function(f,i){ctx.fillStyle=colors[i%colors.length];ctx.fillText(f.floor+'F '+f.status,20+i*150,345);});
  }
  function renderBuildingReview(body) {
    var old=$('building-registration-review');if(old && old.parentNode)old.parentNode.removeChild(old);
    if(!body.sourceLocal || typeof PlanRegistration==='undefined')return;
    var compiled=compileBuildingReview(body), box=document.createElement('div');box.id='building-registration-review';box.className='scene-placement-context building-registration-review';
    var heading=document.createElement('p');heading.textContent=body.sourceLocal.floors.length>1?'複数階の位置合わせ（部分的な組み立て）':'元ページの階数確認';box.appendChild(heading);
    var explain=document.createElement('p');explain.textContent=body.sourceLocal.floors.length>1?'各階の元の実寸を保ち、対応点から平行移動と90度単位の回転だけを求めます。残差と根拠の精度を確認してください。残差ゼロは数式上の一致で、画像・建物の精度保証ではありません。階高・階段・床の開口・屋根は未検証です。':'元ページの表題を見て取り込み先の階数を確認してください。階の位置合わせは行いません。';box.appendChild(explain);
    var propose=document.createElement('button');propose.type='button';propose.textContent='全ページから位置合わせを提案（追加AI読み取り・ページ数分の利用枠）';propose.disabled=ST.busy || !ST.pages || ST.pages.length<2;propose.setAttribute('data-building-propose','');propose.addEventListener('click',function(){if(current())requestBuildingRegistration(body);});if(body.sourceLocal.floors.length>1)box.appendChild(propose);
    var ds=document.createElement('p');ds.style.whiteSpace='pre-wrap';ds.textContent=compiled.diagnostics.map(function(d){return (d.floor?d.floor+'階: ':'')+d.message;}).join('\n');box.appendChild(ds);
    if(compiled.floors.every(function(f){return f.solution.ok;})){var composite=document.createElement('canvas');composite.style.maxWidth='100%';composite.setAttribute('aria-label','位置合わせ後の各階の重ね合わせ。高さ・階段・開口・屋根は未検証。');box.appendChild(composite);drawBuildingAssembly(composite,compiled);}
    function current(){return ST.result===body && !ST.busy && body.buildingSourceVersion===ST.version && $('building-registration-review')===box;}
    body.sourceLocal.floors.forEach(function(f){
      var id=PlanRegistration.pageId(f), proposal=((body.buildingRegistration||{}).floors||[]).find(function(p){return p.floor===f.floor && p.sourcePageId===id;});
      var detail=document.createElement('details');detail.setAttribute('data-building-floor',String(f.floor));detail.open=true;
      var summary=document.createElement('summary');summary.textContent=f.floor+'階 / 元ページ '+(f.sourceIdentity&&f.sourceIdentity.pageNumber || id || '不明');detail.appendChild(summary);
      var titleEvidence=document.createElement('p');titleEvidence.textContent='保持した元ページ見出し: '+(f.sourceIdentity&&f.sourceIdentity.sourceHeader&&f.sourceIdentity.sourceHeader.labels||[]).join(' / ')+'（'+(f.sourceIdentity&&f.sourceIdentity.status||'unknown')+'）';detail.appendChild(titleEvidence);
      var canvas=document.createElement('canvas');canvas.style.maxWidth='100%';canvas.setAttribute('aria-label',f.floor+'階の元ローカル図面。橙の破線は未配置の階段。');detail.appendChild(canvas);drawBuildingSource(canvas,body.sourceLocal,f);
      var stairSource=(body.sourceLocal.items||[]).filter(function(it){return it.floor===f.floor && /^stair/.test(it.type);});
      var stairMarks=(body.sourceLocal.marks||[]).filter(function(m){return m.floor===f.floor && /(?:UP|DN|階段)/i.test(m.label||'');});
      var retained=document.createElement('p');retained.textContent='元の座標 '+f.width+' × '+f.depth+' mm。階段部材: '+stairSource.length+' 点 / UP・DN等の印: '+stairMarks.length+' 点（破線・印は元の記号で、床の開口や接続の確定ではありません）';detail.appendChild(retained);
      var solved=compiled.floors.find(function(r){return r.floor===f.floor;}), result=document.createElement('p');
      result.textContent=solved && solved.solution.ok?'回転 '+solved.solution.pose.quarterTurns*90+'° / 移動 '+solved.solution.pose.dx.toFixed(1)+', '+solved.solution.pose.dy.toFixed(1)+' mm / '+solved.status:'位置合わせ未確定';detail.appendChild(result);
      if(solved && solved.solution.residuals)solved.solution.residuals.forEach(function(r){var p=document.createElement('p');p.textContent='残差 '+r.residualMm.toFixed(2)+' mm / 根拠の精度 ±'+r.precisionMm+' mm: '+r.evidence;detail.appendChild(p);});
      if(solved && solved.solution.directionResiduals)solved.solution.directionResiduals.forEach(function(r){var p=document.createElement('p');p.textContent='角度残差 '+r.residualDeg.toFixed(2)+'° / 根拠の精度 ±'+r.precisionDeg+'°: '+r.evidence;detail.appendChild(p);});
      var anchors=proposal && Array.isArray(proposal.anchors)?JSON.parse(JSON.stringify(proposal.anchors)):[{local:{x:null,y:null},building:{x:null,y:null},precisionMm:null,evidence:''},{local:{x:null,y:null},building:{x:null,y:null},precisionMm:null,evidence:''}];
      if(anchors.length<2 && !(anchors.length===1 && proposal && proposal.directions && proposal.directions.length)){while(anchors.length<2)anchors.push({local:{x:null,y:null},building:{x:null,y:null},precisionMm:null,evidence:''});}
      var fields=[];
      if(body.sourceLocal.floors.length===1)anchors=[];
      anchors.forEach(function(a,index){
        var row=document.createElement('fieldset');row.className='building-registration-anchors';var legend=document.createElement('legend');legend.textContent='対応点 '+(index+1);row.appendChild(legend);var inputs={};
        [['local.x','元X',a.local&&a.local.x],['local.y','元Y',a.local&&a.local.y],['building.x','建物X',a.building&&a.building.x],['building.y','建物Y',a.building&&a.building.y],['precisionMm','精度 ±mm',a.precisionMm],['evidence','根拠（通り芯・寸法・実線の角など）',a.evidence]].forEach(function(entry){
          var label=document.createElement('label'),input=document.createElement('input');input.type=entry[0]==='evidence'?'text':'number';input.value=entry[2]===null||entry[2]===undefined?'':String(entry[2]);input.setAttribute('data-building-anchor',index+':'+entry[0]);input.setAttribute('aria-label',f.floor+'階 '+entry[1]);input.disabled=ST.busy;label.appendChild(document.createTextNode(entry[1]+' '));label.appendChild(input);row.appendChild(label);inputs[entry[0]]=input;
          input.addEventListener('input',function(){if(!current())return;body.buildingDecisions={sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[],partialAcknowledged:false};var partialCheck=box.querySelector('[data-building-partial]');if(partialCheck)partialCheck.checked=false;result.textContent='変更されたため全階の位置合わせを再確認してください。';compileBuildingReview(body);syncPlanImportButtons();});
        });fields.push(inputs);detail.appendChild(row);
      });
      (proposal&&proposal.directions||[]).forEach(function(direction){var p=document.createElement('p');p.textContent='方向: 元 '+JSON.stringify(direction.local)+' → 建物 '+JSON.stringify(direction.building)+' / 精度 ±'+direction.precisionDeg+'° / '+direction.evidence;detail.appendChild(p);});
      var savedDecision=(body.buildingDecisions&&body.buildingDecisions.floors||[]).find(function(d){return d.floor===f.floor;});
      var identity=document.createElement('label'),identityCheck=document.createElement('input');identityCheck.type='checkbox';identityCheck.checked=!!(savedDecision&&savedDecision.identityConfirmed);identityCheck.disabled=ST.busy;identityCheck.setAttribute('data-building-identity','');identity.appendChild(identityCheck);identity.appendChild(document.createTextNode(' 元ページの表題・寸法から '+f.floor+'階であることを確認'));detail.appendChild(identity);
      var identityEvidence=document.createElement('input');identityEvidence.type='text';identityEvidence.setAttribute('data-building-identity-evidence','');identityEvidence.setAttribute('aria-label','階数を確認した根拠');identityEvidence.placeholder='表題の階表記など';identityEvidence.value=savedDecision&&savedDecision.identityEvidence||'';identityEvidence.disabled=ST.busy;detail.appendChild(identityEvidence);
      function invalidateIdentity(){if(!current())return;var opts=body.buildingDecisions||{sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[]};opts.floors=opts.floors.filter(function(d){return d.floor!==f.floor;});opts.partialAcknowledged=false;body.buildingDecisions=opts;var checkbox=box.querySelector('[data-building-partial]');if(checkbox)checkbox.checked=false;result.textContent='階数の確認が変わりました。再確認してください。';compileBuildingReview(body);syncPlanImportButtons();}
      identityCheck.addEventListener('change',invalidateIdentity);identityEvidence.addEventListener('input',invalidateIdentity);
      var confirm=document.createElement('button');confirm.type='button';confirm.textContent=body.sourceLocal.floors.length>1?'対応点・精度・階数を確認して採用':'階数を確認して採用';confirm.setAttribute('data-building-confirm','');confirm.disabled=ST.busy;
      confirm.addEventListener('click',function(){
        if(!current())return;
        var points=fields.map(function(inputs){function n(k){return inputs[k].value.trim()===''?null:Number(inputs[k].value);}return {local:{x:n('local.x'),y:n('local.y')},building:{x:n('building.x'),y:n('building.y')},precisionMm:n('precisionMm'),evidence:inputs.evidence.value};});
        var accepted={floor:f.floor,sourcePageId:id,anchors:points,directions:proposal&&proposal.directions||[],reviewed:true,identityConfirmed:identityCheck.checked,identityEvidence:identityEvidence.value};
        var opts=body.buildingDecisions || {sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[]};opts.floors=(opts.floors||[]).filter(function(d){return d.floor!==f.floor;}).concat([accepted]);opts.partialAcknowledged=false;body.buildingDecisions=opts;
        var proposals=body.buildingRegistration || {version:1,floors:[]};proposals.floors=(proposals.floors||[]).filter(function(d){return d.floor!==f.floor;}).concat([{floor:f.floor,sourcePageId:id,anchors:points,directions:accepted.directions}]);body.buildingRegistration=proposals;opts.proposalSnapshot=PlanRegistration.snapshot(proposals);
        compileBuildingReview(body);renderPlanImportResult(body);syncPlanImportButtons();
      });detail.appendChild(confirm);box.appendChild(detail);
    });
    if(body.sourceLocal.floors.length>1){
    var partial=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!(body.buildingDecisions && body.buildingDecisions.partialAcknowledged);check.disabled=ST.busy;check.setAttribute('data-building-partial','');
    partial.appendChild(check);partial.appendChild(document.createTextNode(' '+body.sourceLocal.floors.map(function(f){return f.floor+'階';}).join('・')+'を部分的に取り込む: 高さ・未記載の奥行きは現在の表示既定値を使用。元の階段記号は記録に保持し配置せず、階段・開口・屋根は未完成'));box.appendChild(partial);
    check.addEventListener('change',function(){if(!current())return;body.buildingDecisions=body.buildingDecisions||{sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[]};body.buildingDecisions.partialAcknowledged=check.checked;body.buildingDecisions.proposalSnapshot=PlanRegistration.snapshot(body.buildingRegistration||{version:1,floors:[]});compileBuildingReview(body);syncPlanImportButtons();});
    }
    var host=$('plan-import-step3');if(host)host.appendChild(box);
  }

  function sceneFactValue(fact) { return fact && fact.value !== null ? fact.value : undefined; }

  // Only explicit catalogue semantics/axes are eligible. Similar names and room use
  // never turn a table into a desk, an assembly into a fixture, or an unknown front
  // into +Z. This list offers representations; it is not source identification.
  function sceneMappingCandidates(source, registry) {
    var candidates = [], rejected = [], type = sceneFactValue(source.objectType), extent = sceneFactValue(source.semanticExtent);
    var fp = sceneFactValue(source.sourceFootprint), place = sceneFactValue(source.placement);
    var axes = { '+Z': {x:0,y:1}, '-Z': {x:0,y:-1}, '+X': {x:1,y:0}, '-X': {x:-1,y:0} };
    if (!type || !extent || !fp || !place || type === 'stair' || type === 'unidentified-symbol') return { candidates: [], rejected: [], reason: '物の種類・範囲・外形・配置の根拠が不足、または未対応です。元の根拠を保持し、自動で置き換えません。' };
    registry.list().forEach(function (model) {
      if ((model.sourceObjectType || model.kind) !== type || model.openingOnly) return;
      var reasons = [], front = sceneFactValue(source.frontDirection), head = sceneFactValue(source.headDirection);
      if (model.semanticExtent !== extent) reasons.push('意味範囲が異なる: ' + extent + ' → ' + model.semanticExtent);
      if (!Number.isFinite(model.w) || !Number.isFinite(model.d) || model.w <= 0 || model.d <= 0) reasons.push('寸法が未確認');
      if (place.domain === 'exterior' && type !== 'car') reasons.push('この種類の屋外配置は未対応');
      var rotation = Math.atan2(fp.axisX.y, fp.axisX.x);
      if (front) {
        if (!axes[model.front]) reasons.push('モデル正面軸が未確認');
        else {
          rotation = Math.atan2(front.y, front.x) - Math.atan2(axes[model.front].y, axes[model.front].x);
          if (Math.abs(Math.sin(rotation - Math.atan2(fp.axisX.y, fp.axisX.x))) > .00001) reasons.push('正面と外形の軸が矛盾');
        }
      }
      if (head) {
        if (!axes[model.head]) reasons.push('モデル頭側軸が未確認');
        else if (front && Math.abs(Math.sin((Math.atan2(head.y, head.x) - Math.atan2(axes[model.head].y, axes[model.head].x) - rotation) / 2)) > .00001) reasons.push('正面と頭側の軸が矛盾');
      }
      var height = sceneFactValue(source.heightMm), color = source.appearance && sceneFactValue(source.appearance.diagramColor);
      if (height !== undefined && height !== model.h) reasons.push('既知の高さが異なる: ' + height + ' → ' + model.h + ' mm');
      if (typeof color === 'string' && !model.genericColor && (model.finishChannels || []).length !== 1) reasons.push('図面の単色に対応する表示チャンネルが未対応');
      if (reasons.length) rejected.push({ model: model, reasons: reasons });
      else candidates.push(model);
    });
    candidates.sort(function (a, b) {
      var difference = function (m) { return Math.abs(m.w - fp.sizeMm.w) + Math.abs(m.d - fp.sizeMm.d); };
      return difference(a) - difference(b) || a.id.localeCompare(b.id);
    });
    return { candidates: candidates, rejected: rejected, reason: candidates.length ? '' : '同じ種類・意味範囲と必要な軸を確認できるモデルがありません。未確認のカタログ情報を推測して補いません。' };
  }

  function renderSceneMappingButton(body, group, detail) {
    if (body.sceneIR.sceneVersion !== 3 || body.sceneOptions.materialization !== 'bounded-v3' || ['objects','rooms','openings'].indexOf(group.collection) < 0) return;
    var source = body.sceneIR[group.collection].find(function (e) { return e.id === group.entityId; });
    if (!source || (group.collection !== 'objects' && !source.appearance)) return;
    if (group.collection === 'objects' && sceneFactValue(source.semanticExtent) === 'symbol-only') return;
    var existing = body.sceneOptions.bindingDecisions.find(function (d) { return d.binding && d.binding.sourceEntityId === source.id && d.sourceSnapshot === JSON.stringify(source); });
    var button = document.createElement('button'); button.type = 'button'; button.className = 'scene-mapping-open';
    button.setAttribute('data-scene-mapping', source.id); button.setAttribute('data-scene-review-control', '');
    button.textContent = existing ? '対応付けを変更する' : group.collection === 'objects' ? 'カタログと見た目を対応付ける' : '図面の見た目を対応付ける';
    button.disabled = !!body.sceneOptions.sourceInvalidated;
    detail.appendChild(button);
    var saved = document.createElement('p'); saved.className = 'scene-mapping-summary';
    saved.textContent = existing ? '確認済みの対応: ' + (existing.binding.catalogId.value || '図面の色・模様') + ' / ' + existing.binding.sizingPolicy + ' / ' + existing.binding.appearanceMode + ((existing.retainedAppearanceRegions || []).length ? ' / 図面のみ: ' + existing.retainedAppearanceRegions.join(', ') : '') : '対応は未選択です。選択だけでは配置されず、確認後に根拠の再確認と「取り込む」が必要です。';
    detail.appendChild(saved);
    button.addEventListener('click', function () {
      if (ST.result !== body || ST.busy || ST.mappingEditor || body.sceneApplied || body.sceneOptions.sourceInvalidated) return;
      var editor = { body: body, sourceId: source.id }; ST.mappingEditor = editor;
      var reviewBox = $('scene-ir-review');
      if (reviewBox) Array.prototype.forEach.call(reviewBox.querySelectorAll('[data-scene-review-control]'), function (control) { control.disabled = true; });
      var apply = $('plan-import-apply'); if (apply) apply.disabled = true;
      var panel = document.createElement('fieldset'); panel.className = 'scene-mapping-editor';
      var legend = document.createElement('legend'); legend.textContent = '別の判断として対応付ける: ' + group.label; panel.appendChild(legend); detail.appendChild(panel);
      function text(message) { var p = document.createElement('p'); p.textContent = message; panel.appendChild(p); return p; }
      function selectControl(labelText, attribute, choices, selected, host) {
        var label = document.createElement('label'), select = document.createElement('select');
        label.appendChild(document.createTextNode(labelText)); select.setAttribute(attribute, ''); select.setAttribute('aria-label', labelText);
        choices.forEach(function (choice) { var option = document.createElement('option'); option.value = choice[0]; option.textContent = choice[1]; select.appendChild(option); });
        select.value = selected || ''; label.appendChild(select); (host || panel).appendChild(label); return select;
      }
      text('原図の値・色・出典は書き換えません。モデルの選択や色の対応は表示上の判断です。実物の製品・材質を特定したことにはなりません。');
      var isObject = group.collection === 'objects', registry = sceneCatalogue(), choices = isObject ? sceneMappingCandidates(source, registry) : null;
      var catalogue = null, sizing = null, appearance, regions = [], selectedMetadata = null;
      var binding = existing && existing.binding;
      if (isObject) {
        var fp = sceneFactValue(source.sourceFootprint), front = sceneFactValue(source.frontDirection);
        text('図面: ' + sceneFactValue(source.objectType) + ' / ' + sceneFactValue(source.semanticExtent) + ' / 外形 ' + (fp ? fp.sizeMm.w + ' × ' + fp.sizeMm.d + ' mm' : '不明') + ' / 正面 ' + (front ? JSON.stringify(front) : '不明（外形軸による表示を確認）'));
        if (choices.reason) text(choices.reason);
        if (choices.rejected.length) text('候補から除外 ' + choices.rejected.length + ' 件' + (choices.rejected.length > 12 ? '（先頭12件）' : '') + ': ' + choices.rejected.slice(0, 12).map(function (r) { return r.model.name + ' [' + r.model.id + '] ' + r.reasons.join('・'); }).join('\n'));
        catalogue = selectControl('正確なカタログIDを選択', 'data-scene-catalogue', [['','選択してください']].concat(choices.candidates.map(function (m) { return [m.id, m.name + ' [' + m.id + '] ' + m.w + '×' + m.d + ' mm']; })), binding && binding.catalogId.value);
        if (!choices.candidates.some(function (m) { return m.id === catalogue.value; })) catalogue.value = '';
        sizing = selectControl('寸法の対応', 'data-scene-sizing', [['','選択してください'],['native','モデル標準寸法（原図と一致する場合のみ）'],['fit-source','原図の外形に合わせる（形状の拡縮を確認）']], binding && binding.sizingPolicy);
      }
      appearance = selectControl('見た目の対応', 'data-scene-appearance', [['','選択してください'],['match-diagram-appearance','図面の色・模様を表示へ対応付ける'],['unspecified','未指定を保持する（既知の見た目が未反映なら適用不可）']], binding && binding.appearanceMode);
      var appearanceFacts = source.appearance || {}, color = sceneFactValue(appearanceFacts.diagramColor), material = appearanceFacts.specifiedMaterial;
      text('図面の色: ' + (color === undefined ? '不明' : JSON.stringify(color)) + ' / 模様: ' + (sceneFactValue(appearanceFacts.pattern) || '不明') + ' / モジュール: ' + (sceneFactValue(appearanceFacts.moduleMm) === undefined ? '不明' : sceneFactValue(appearanceFacts.moduleMm) + ' mm') + ' / 指定材質: ' + (material && sceneFactValue(material.category) || '不明') + '。不明な製品・材質は補いません。');
      if (!isObject) text(group.collection === 'rooms' ? '対応する表示: square-grid → タイル、plank-lines → 板目、plain / none → 無地。既知の正方形タイル寸法は保持します。未対応の模様・モジュールは診断を残します。' : '開口の単色は表示色へ対応します。複数領域の色・未対応の模様は診断を残します。');
      var modelDetails = document.createElement('p'), regionBox = document.createElement('div'); panel.appendChild(modelDetails); panel.appendChild(regionBox);
      function updateModel() {
        regionBox.textContent = ''; regions = [];
        var model = catalogue && choices.candidates.find(function (m) { return m.id === catalogue.value; }); selectedMetadata = model || null;
        if (!model) { modelDetails.textContent = ''; return; }
        var fp = sceneFactValue(source.sourceFootprint), channels = (model.genericColor ? [{key:'color',default:null}] : model.finishChannels || []);
        modelDetails.textContent = 'モデルとの差: 幅 ' + (model.w - fp.sizeMm.w) + ' / 奥行 ' + (model.d - fp.sizeMm.d) + ' mm。高さ ' + (model.h === null ? '不明' : model.h + ' mm') + '（図面の高さが不明ならモデル既定値）。正面軸 ' + (model.front || '未確認') + ' [' + model.frontProvenance + ']。色チャンネル: ' + channels.map(function (c) { return c.key + '（既定色 ' + (c.default || 'モデル既定') + '）'; }).join(', ') + '。元の質感や部位と一致するとは限りません。';
        if (typeof color === 'string' && channels.length > 1) modelDetails.textContent += ' この単色を複数チャンネルへ割り当てる機能は未対応です。確認しても適用の阻止理由が残ります。';
        if (!Array.isArray(color)) return;
        color.forEach(function (region) {
          var previous = binding && binding.catalogId.value === model.id && (binding.channels || []).find(function (c) { return c.sourceRegion === region.region; });
          var retained = existing && binding.catalogId.value === model.id && (existing.retainedAppearanceRegions || []).indexOf(region.region) >= 0;
          var control = selectControl(region.region + ' ' + region.color + ' の表示先', 'data-scene-region', [['','選択してください']].concat(channels.map(function (c) { return [c.key, c.key + '（モデル既定色 ' + (c.default || '既定') + ' → ' + region.color + '）']; }), [['__overlay__','図面上だけに保持（3Dの見た目は未完成）']]), retained ? '__overlay__' : previous && previous.channel, regionBox);
          control.setAttribute('data-scene-region', region.region); regions.push({source:region,control:control});
        });
      }
      if (catalogue) catalogue.addEventListener('change', updateModel);
      updateModel();
      var error = text(''); error.setAttribute('role', 'status');
      var confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'この対応を確認して保存'; confirm.setAttribute('data-scene-mapping-confirm', ''); panel.appendChild(confirm);
      var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '変更を取り消す'; cancel.setAttribute('data-scene-mapping-cancel', ''); panel.appendChild(cancel);
      function current() { return ST.result === body && ST.mappingEditor === editor && !ST.busy && !body.sceneApplied && !body.sceneOptions.sourceInvalidated; }
      cancel.addEventListener('click', function () { if (!current()) return; ST.mappingEditor = null; renderPlanImportResult(body); });
      confirm.addEventListener('click', function () {
        if (!current()) return;
        var model = selectedMetadata, policy = isObject ? sizing.value : 'native', mode = appearance.value;
        if (['match-diagram-appearance','unspecified'].indexOf(mode) < 0 || ['native','fit-source'].indexOf(policy) < 0 || isObject && !model) { error.textContent = 'カタログ・寸法・見た目の対応を意図的に選んでください。'; return; }
        if (isObject && (catalogue.value !== model.id || !sceneMappingCandidates(source, sceneCatalogue()).candidates.some(function (m) { return JSON.stringify(m) === JSON.stringify(model); }))) { error.textContent = 'カタログ情報が変わりました。取り消して候補を確認し直してください。'; return; }
        var fp = sceneFactValue(source.sourceFootprint);
        if (model && policy === 'native' && (model.w !== fp.sizeMm.w || model.d !== fp.sizeMm.d)) { error.textContent = '標準寸法が原図と異なります。原図の外形を維持する拡縮を明示的に選んでください。'; return; }
        var channels = [], retained = [], used = [], invalid = false;
        if (mode === 'match-diagram-appearance') regions.forEach(function (row) {
          var channel = row.control.value;
          if (channel === '__overlay__') retained.push(row.source.region);
          else if (!channel || used.indexOf(channel) >= 0 || !(model.genericColor && channel === 'color') && !model.finishChannels.some(function (c) { return c.key === channel; })) invalid = true;
          else { used.push(channel); channels.push({sourceRegion:row.source.region,channel:channel,color:row.source.color}); }
        });
        if (invalid) { error.textContent = '各色領域に異なる表示先、または「図面上だけに保持」を選んでください。同じ色チャンネルへ上書きできません。'; return; }
        var opts = JSON.parse(JSON.stringify(body.sceneOptions));
        opts.bindingDecisions = opts.bindingDecisions.filter(function (d) { return !d.binding || d.binding.sourceEntityId !== source.id; });
        var occupied = [];
        ['annotations','walls','rooms','openings','objects','siteRegions','buildingFootprints','bindings','connections'].forEach(function (k) { body.sceneIR[k].forEach(function (e) { occupied.push(e.id); (e.leaves || []).forEach(function (l) { occupied.push(l.id); }); }); });
        opts.bindingDecisions.forEach(function (d) { if (d.binding) occupied.push(d.binding.id); });
        var n = 1; while (occupied.indexOf('review-map-' + n) >= 0) n++;
        var decision = {sourceSnapshot:JSON.stringify(source),binding:{id:'review-map-' + n,sourceEntityId:source.id,catalogId:model ? {value:model.id,status:'inferred',source:'user-confirmed catalogue representation',reason:'Explicit display choice; source identity, dimensions and material facts are retained unchanged'} : {value:null,status:'unknown'},sizingPolicy:policy,appearanceMode:mode}};
        if (channels.length) decision.binding.channels = channels;
        if (retained.length) decision.retainedAppearanceRegions = retained;
        opts.bindingDecisions.push(decision);
        // Bindings can alter geometry/circulation and appearance, so require fresh
        // review of the whole staged result rather than carrying stale approvals.
        opts.acceptedReviews = []; opts.acceptedReviewGroups = []; opts.reviewedEntities = {}; opts.unresolvedDecisions = [];
        stageSceneIR(body.sceneIR, opts);
      });
    });
  }

  function renderSceneIRReview(body) {
    if (typeof document.createElement !== 'function') return;
    var old = $('scene-ir-review'), openGroups = [];
    if (old) { Array.prototype.forEach.call(old.querySelectorAll('details[open]'), function (d) { openGroups.push(d.getAttribute('data-scene-group')); }); old.remove(); }
    if (!body.sceneCompilation) return;
    var notes = $('plan-import-notes');
    if (!notes || !notes.parentNode) return;
    var box = document.createElement('div'); box.id = 'scene-ir-review';
    var heading = document.createElement('p');
    heading.textContent = '根拠を確認して採用するか、修正してください。未配置を認めても完全な再構成にはなりません。';
    box.appendChild(heading);
    if (body.sceneCompilation.version === 3 && typeof SceneSourceOverlay !== 'undefined') {
      var sourceCanvas = document.createElement('canvas'); sourceCanvas.width = 640; sourceCanvas.height = 360;
      sourceCanvas.style.maxWidth = '100%'; sourceCanvas.setAttribute('aria-label', 'Source evidence preview; dashed outlines are not physical 3D reconstruction');
      box.appendChild(sourceCanvas); SceneSourceOverlay.drawPreview(sourceCanvas, body.sceneIR, body.sceneCompilation.sourcePreview);
    }
    if (body.sceneCompilation.version === 3) {
      var destination = document.createElement('fieldset'), legend = document.createElement('legend');
      destination.className = 'scene-placement-context';
      legend.textContent = '取り込み先の階（図面の根拠とは別の配置指定）'; destination.appendChild(legend);
      var select = document.createElement('select'); select.setAttribute('aria-label', '取り込み先の階'); select.setAttribute('data-scene-review-control', '');
      var context = body.sceneOptions.placementContext;
      for (var floor = 1; floor <= 4; floor++) { var option = document.createElement('option'); option.value = String(floor); option.textContent = floor + 'F'; select.appendChild(option); }
      select.value = String(context ? context.targetFloor : body.sceneOptions.destinationFloor || root.ST && root.ST.floor || 1);
      destination.appendChild(select);
      var label = document.createElement('label'), confirmed = document.createElement('input'); confirmed.type = 'checkbox';
      confirmed.setAttribute('data-scene-review-control', ''); confirmed.checked = !!context; confirmed.disabled = !body.sceneOptions.pageScope || body.sceneOptions.pageScope.length !== 1;
      label.appendChild(confirmed); label.appendChild(document.createTextNode(' 選んだ画像は1つの階だけを表し、階表記が不明な壁・部屋・開口をこの階に配置することを確認しました'));
      destination.appendChild(label);
      var explanation = document.createElement('p'); explanation.textContent = '元の階情報は不明のまま保存します。既知の階と矛盾する指定、複数ページ、敷地や階段の接続は自動解決しません。配置後の個別確認と適用が別途必要です。'; destination.appendChild(explanation);
      confirmed.addEventListener('change', function () { confirmScenePlacement(body, Number(select.value), confirmed.checked); });
      select.addEventListener('change', function () { if (ST.result !== body) return; confirmed.checked = false; if (context) confirmScenePlacement(body, Number(select.value), false); });
      box.appendChild(destination);
    }
    body.sceneCompilation.reviewGroups.forEach(function (group) {
      var detail = document.createElement('details'), summary = document.createElement('summary');
      detail.setAttribute('data-scene-group', group.id); detail.open = openGroups.indexOf(group.id) >= 0;
      summary.textContent = group.label + ' — ' + group.diagnostics.length + ' 項目' + (group.acknowledgedOmission ? '（未配置・未完成）' : '');
      detail.appendChild(summary);
      var fields = document.createElement('pre'); fields.style.whiteSpace = 'pre-wrap';
      fields.textContent = group.diagnostics.map(function (d) { return d.severity + ': ' + d.path + '\n' + d.message; }).join('\n\n') + '\n\n' +
        group.evidence.map(function (e) { return e.path + ': ' + e.status + ' ' + JSON.stringify(e.value) + (e.source ? '\n出典: ' + e.source : '') + (e.reason ? '\n理由: ' + e.reason : ''); }).join('\n');
      detail.appendChild(fields);
      renderSceneMappingButton(body, group, detail);
      function choice(labelText, checked, change) {
        var label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.checked = checked; input.setAttribute('data-scene-review-control', '');
        input.setAttribute(labelText.indexOf('推定値') >= 0 ? 'data-scene-accept' : 'data-scene-omit', group.id);
        input.addEventListener('change', function () { change(input.checked); });
        label.appendChild(input); label.appendChild(document.createTextNode(labelText)); detail.appendChild(label);
      }
      if (group.reviewPaths.length) choice(' このオブジェクトの推定値を確認して採用する', group.accepted, function (on) {
        if (ST.result !== body || ST.mappingEditor) return;
        var opts = JSON.parse(JSON.stringify(ST.result.sceneOptions));
        opts.acceptedReviewGroups = opts.acceptedReviewGroups.filter(function (id) { return id !== group.id; });
        if (on) { opts.acceptedReviewGroups.push(group.id); if (group.reviewKey) opts.reviewedEntities[group.entityId] = group.reviewKey; }
        else if (opts.reviewedEntities) delete opts.reviewedEntities[group.entityId];
        stageSceneIR(ST.result.sceneIR, opts);
      });
      if (group.canAcknowledgeOmission) choice(' この物は非必須の装飾であり、未配置のまま残すことを確認する（再構成は未完成）', group.acknowledgedOmission, function (on) {
        if (ST.result !== body || ST.mappingEditor) return;
        var opts = JSON.parse(JSON.stringify(ST.result.sceneOptions));
        opts.unresolvedDecisions = opts.unresolvedDecisions.filter(function (d) { return d.entityId !== group.entityId; });
        if (on) { opts.unresolvedDecisions.push({ entityId: group.entityId, decision: 'leave-unplaced', classification: 'noncritical-decoration' }); if (group.reviewKey) opts.reviewedEntities[group.entityId] = group.reviewKey; }
        else if (opts.reviewedEntities) delete opts.reviewedEntities[group.entityId];
        stageSceneIR(ST.result.sceneIR, opts);
      });
      box.appendChild(detail);
    });
    notes.parentNode.appendChild(box);
  }

  function confirmScenePlacement(expectedResult, targetFloor, singleLevelConfirmed) {
    if (!expectedResult || ST.result !== expectedResult || ST.mappingEditor || ST.busy || expectedResult.sceneApplied || expectedResult.sceneOptions.sourceInvalidated || expectedResult.sceneIR.sceneVersion !== 3) return null;
    var opts = JSON.parse(JSON.stringify(expectedResult.sceneOptions));
    if (!opts.pageScope || opts.pageScope.length !== 1 || !Number.isInteger(targetFloor) || targetFloor < 1 || targetFloor > 4) return null;
    opts.destinationFloor = targetFloor;
    opts.placementContext = singleLevelConfirmed === true ? SceneIR.createPlacementContext(expectedResult.sceneIR, opts.pageScope, targetFloor, true) : null;
    opts.acceptedReviews = []; opts.acceptedReviewGroups = []; opts.reviewedEntities = {}; opts.unresolvedDecisions = [];
    return stageSceneIR(expectedResult.sceneIR, opts);
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
      var made = {
        id: 'rm_' + (nextId++), type: 'room', x: r.x, y: r.y, w: r.w, d: r.d, floor: floor,
        n: r.n || '', floorRaiseMm: newRoomFloorRaiseMm(floor),
        textureFlipX: false, textureFlipY: false,
      };
      // スキップフロア。**段のある部屋だけが持つ欄**なので、無い部屋には
      // 書かない(書くと、この欄を持たない既存プランと形が変わる)。
      if (r.skipLevelMm) made.skipLevelMm = r.skipLevelMm;
      // Keep the image reader's room-use evidence when making editable objects.
      if (typeof r.use === 'string' && r.use) made.use = r.use;
      out.rooms.push(made);
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

  // Scene IR is an opt-in, pure preview path. It does not alter the v1 endpoint/schema.
  function sceneCatalogue() {
    var finishModels = {};
    if (typeof EXTERIOR_MODEL_IDS === 'object' && typeof getItemFinishModel === 'function') {
      Object.keys(EXTERIOR_MODEL_IDS).forEach(function (id) { finishModels[id] = getItemFinishModel(id); });
    }
    return SceneCatalogue.create({
      items: typeof FMP_ITEMS === 'object' ? FMP_ITEMS : {},
      finishModels: finishModels,
      builtins: typeof ISIZES === 'object' ? ISIZES : {},
      builtinAssets: typeof CONTEXT_CAR_GLB === 'string' && CONTEXT_CAR_GLB === SceneCatalogue.carCertificate.url ? {car:SceneCatalogue.carCertificate} : {},
      aliases: typeof LEGACY_FMP_TYPE_MAP === 'object' ? LEGACY_FMP_TYPE_MAP : {},
      textureIds: typeof MODEL_FINISH_TEXTURES === 'object' ? MODEL_FINISH_TEXTURES.map(function (p) { return p[0]; }) : [],
    });
  }

  function previewSceneIR(scene, options) {
    options = options || {};
    var compiled = SceneIR.compile(scene, {
      registry: options.registry || sceneCatalogue(),
      targetPlan: typeof DATA === 'object' ? DATA : {},
      materialization: options.materialization,
      placementContext: options.placementContext || null,
      pageScope: options.pageScope || null,
      bindingDecisions: options.bindingDecisions || [],
      reviewedEntities: options.reviewedEntities || {},
      acceptedReviews: options.acceptedReviews || [],
      acceptedReviewGroups: options.acceptedReviewGroups || [],
      unresolvedDecisions: options.unresolvedDecisions || [],
      defaultFloorOffset: typeof newRoomFloorRaiseMm === 'function' ? newRoomFloorRaiseMm : null,
      windowVerticalLimitMm: typeof defaultWallHeightMmForFloor === 'function' ? function (floor, adjacentRooms) {
        // Conservative for raised finishes/platforms: never certify a frame above
        // the actual wall aperture. A separate context-aware renderer unification
        // is required before relaxing this for lifted/special-support walls.
        var raise = Math.max.apply(null, [0].concat(adjacentRooms.map(function (room) {
          var finish = typeof room.floorRaiseMm === 'number' ? room.floorRaiseMm : newRoomFloorRaiseMm(floor);
          return Math.max(0, finish) + Math.max(0, room.skipLevelMm || 0);
        })));
        return defaultWallHeightMmForFloor(floor) - 50 - raise;
      } : null,
      normalizeWindow: typeof normalizeWindowVerticalProps === 'function' ? function (item) {
        item._wallRef = { wallHeight: defaultWallHeightMmForFloor(item.floor) };
        normalizeWindowVerticalProps(item);
        delete item._wallRef;
        return item;
      } : null,
    });
    if (scene && scene.sceneVersion === 3 && options.sourceInvalidated) {
      compiled.diagnostics.push({code:'stale_source_scope',path:'scene',severity:'error',message:'The selected image or crop changed. Read it again before reviewing or applying this draft.'});
      compiled.canApply = false;
    }
    if (scene && scene.sceneVersion === 3 && typeof SHARED !== 'undefined' && SHARED.roomId) {
      compiled.diagnostics.push({code:'shared_v3_disabled',path:'scene',severity:'error',message:'v3 reconstruction is local-only until mixed-version shared-client protection exists'});
      compiled.canApply = false;
    }
    return compiled;
  }

  // Explicit caller action stages a draft in the existing review dialog; Apply is still required.
  function stageSceneIR(scene, options) {
    ST.mappingEditor = null;
    ST.requestVersion++;
    var input = JSON.parse(JSON.stringify(scene));
    var compiled = previewSceneIR(input, options);
    ST.result = { sceneIR: input, sceneOptions: { materialization: options && options.materialization,
        sourceInvalidated: !!(options && options.sourceInvalidated),
        destinationFloor: options && options.destinationFloor,
        placementContext: JSON.parse(JSON.stringify(options && options.placementContext || null)),
        pageScope: JSON.parse(JSON.stringify(options && options.pageScope || null)),
        reviewedEntities: JSON.parse(JSON.stringify(options && options.reviewedEntities || {})),
        bindingDecisions: JSON.parse(JSON.stringify(options && options.bindingDecisions || [])), acceptedReviews: (options && options.acceptedReviews || []).slice(),
        acceptedReviewGroups: (options && options.acceptedReviewGroups || []).slice(),
        unresolvedDecisions: JSON.parse(JSON.stringify(options && options.unresolvedDecisions || [])),
        extraction: options && options.extraction ? JSON.parse(JSON.stringify(options.extraction)) : null },
      sceneCompilation: compiled, plan: compiled.plan,
      extraction: options && options.extraction ? JSON.parse(JSON.stringify(options.extraction)) : null,
      summary: { walls: compiled.plan.walls.length, rooms: compiled.plan.rooms.length,
        items: compiled.plan.items.length, floors: floorsOfObjects(compiled.plan.walls, compiled.plan.rooms, compiled.plan.items) },
      notes: compiled.suggestions.map(function (s) { return s.path + ': ' + s.reason + ' (suggestion only)'; }).concat(
        compiled.defaults.map(function (d) { return d.path + ': ' + (d.value === null ? '既定値' : JSON.stringify(d.value)) + ' [' + d.provenance + '] 図面から読み取った値ではありません'; })),
      warnings: [compiled.reviewGroups.length + ' 個のオブジェクト・判断を確認できます。項目を開くと根拠と個別パラメータを表示します。'].concat(
        compiled.acknowledgedOmissions.length ? ['未配置 ' + compiled.acknowledgedOmissions.length + ' 点を残す未完成の再構成です。完全な再現ではありません。'] : [],
        compiled.diagnostics.filter(function (d) { return !compiled.reviewGroups.some(function (g) { return d.path === g.path || d.path.indexOf(g.path + '.') === 0; }); }).map(function (d) { return d.path + ': ' + d.message; })),
    };
    renderPlanImportResult(ST.result);
    var button = $('plan-import-apply');
    if (button) button.disabled = !compiled.canApply;
    if (!compiled.canApply) setStatus('Scene IR の未解決項目を確認してください。間取りはまだ変更していません。');
    var modal = $('plan-import-modal');
    if (modal) modal.classList.add('show');
    return compiled;
  }

  // Only compiler-created allowlisted values enter constructors. Stable references are remapped
  // after IDs are allocated; source evidence remains in the staged review, not saved as app props.
  function materializeSceneObjects(plan) {
    var out = { walls: [], rooms: [], items: [] }, idMap = Object.create(null);
    plan.walls.forEach(function (w) {
      var made = mkWall(w.x1, w.y1, w.x2, w.y2, w.floor, w.thick);
      idMap[w.id] = made.id; out.walls.push(made);
    });
    plan.rooms.forEach(function (r) {
      var made = Object.assign({ textureFlipX: false, textureFlipY: false,
        floorRaiseMm: newRoomFloorRaiseMm(r.floor) }, r, { id: 'rm_' + (nextId++) });
      idMap[r.id] = made.id; out.rooms.push(made);
    });
    plan.items.forEach(function (it) {
      var made = mkItem(it.type, it.x, it.y, it.rot, it.floor, it.w, it.d), id = made.id;
      Object.assign(made, JSON.parse(JSON.stringify(it)), { id: id });
      if (it.baseRoom !== undefined) made.baseRoom = idMap[it.baseRoom];
      if (it.openingHostWallId !== undefined) made.openingHostWallId = idMap[it.openingHostWallId];
      idMap[it.id] = id; out.items.push(made);
    });
    out.sourceIdMap = idMap;
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
    (plan.rooms || []).forEach(function (r) { if (r.shape && typeof RoomGeometry !== 'undefined') RoomGeometry.translate(r, dx, 0); else r.x += dx; });
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
    if (!ST.result || !ST.result.plan || ST.result.sceneApplied || ST.result.buildingApplied || ST.mappingEditor) return;
    if (typeof DATA === 'undefined' || !DATA || ST.busy) return;
    var buildingCompilation = ST.result.sourceLocal ? compileBuildingReview(ST.result) : null;
    if (ST.result.sourceLocal && (!buildingCompilation || !buildingCompilation.canApply)) {
      setStatus('複数階の位置合わせに未確認・矛盾があります。適用せず確認へ戻ります。'); syncPlanImportButtons(); return;
    }
    // 水まわりの既定モデルを、部屋に合うものへ差し替えてから組み立てる。
    // **中心は動かさない。** 寸法だけが入れ替わるので、図面どおりの位置に残る。
    // 組み立て(toAppObjects)より前に置くこと。後ろだと差し替えが効かない。
    if (!ST.result.sceneIR && ST.result.finish && typeof PlanFinish !== 'undefined') {
      PlanFinish.applyPicks(ST.result.plan, ST.result.finish.picks);
    }
    var sceneCompilation = null;
    if (ST.result.sceneIR) {
      // Revalidate against current target height settings/catalogue, even if they changed since preview.
      sceneCompilation = previewSceneIR(ST.result.sceneIR, ST.result.sceneOptions);
      ST.result.sceneCompilation = sceneCompilation;
      if (!sceneCompilation.canApply) {
        setStatus('Scene IR に未解決項目があります。適用せずに確認へ戻ります。');
        return;
      }
    }
    var candidatePlan = sceneCompilation ? sceneCompilation.plan : buildingCompilation ? buildingCompilation.plan : ST.result.plan;
    var readFloors = floorsOfObjects(candidatePlan.walls, candidatePlan.rooms, candidatePlan.items);
    if (!readFloors.length) return;

    // 起動直後の既定プランだけは下敷きにしない（下を見よ）。
    var fresh = isUntouchedDefault();
    var base = fresh ? { walls: [], rooms: [], items: [] } : DATA;
    var beside = hasWorkOnFloors(base, readFloors), sceneTranslationX = 0;

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

    var read = sceneCompilation ? materializeSceneObjects(candidatePlan) : toAppObjects(candidatePlan);

    // 取り消せるようにしてから触る。**丸ごと差し替えていた頃は、取り込みが
    // 最後の操作になるので履歴を捨てていた。** いまは元の間取りが残る以上、
    // 押し間違いを1手で戻せるべきである。
    if (typeof saveState === 'function') saveState();
    root._defaultPlanPending = false;
    // Consume this registration once before post-commit callbacks can fail.
    // Undo remains available; a render error must never duplicate the building.
    if (buildingCompilation) ST.result.buildingApplied = true;

    if (beside) {
      // 隣へずらしてから構造部材を作る。順番が逆だと、基礎と屋根だけが
      // 元の位置に残る。
      var here = planBounds(base), there = planBounds(read);
      if (here && there) { sceneTranslationX = Math.round(here.x1 - there.x0 + BESIDE_GAP_MM); shiftPlan(read, sceneTranslationX); }
      // **下書きの基礎と屋根は、下書きの壁だけから作る。** いまの間取りの壁と
      // まとめて外形を取ると、2棟をまたぐ1枚の基礎と1枚の屋根になる。
      DATA.walls = (base.walls || []).concat(read.walls);
      DATA.rooms = (base.rooms || []).concat(read.rooms);
      DATA.items = (base.items || []).concat(read.items, (buildingCompilation || sceneCompilation && sceneCompilation.version === 3) ? [] : structureItems(read.walls, null));
    } else {
      // 空いている階に入れる。読み取った階に在るのは、壁から決まる基礎・屋根
      // だけなので、それはここで作り直す（階が増えれば屋根の載る位置も変わる）。
      var keepItems = (base.items || []).filter(function (o) {
        return buildingCompilation || sceneCompilation && sceneCompilation.version === 3 || !(isDerivedStructure(o) && readFloors.indexOf(Number(o.floor) || 1) >= 0);
      });
      DATA.walls = (base.walls || []).concat(read.walls);
      DATA.rooms = (base.rooms || []).concat(read.rooms);
      var made = (buildingCompilation || sceneCompilation && sceneCompilation.version === 3) ? [] : structureItems(DATA.walls, readFloors);
      DATA.items = keepItems.filter(function (it) {
        return !made.some(function (st) {
          return it && it.type === st.type && (Number(it.floor) || 1) === (Number(st.floor) || 1);
        });
      }).concat(read.items, made);
    }
    if (buildingCompilation) {
      DATA.sceneReconstructionReports = (base.sceneReconstructionReports || []).concat([{
        kind:'building-registration',version:1,status:buildingCompilation.status,
        sourceLocal:JSON.parse(JSON.stringify(ST.result.sourceLocal)),
        sourceNotes:JSON.parse(JSON.stringify(ST.result.notes||[])),
        sourceReadings:JSON.parse(JSON.stringify(ST.result.pages||null)),
        proposals:JSON.parse(JSON.stringify(ST.result.buildingRegistration)),
        originalProposals:JSON.parse(JSON.stringify(ST.result.originalBuildingRegistration||null)),
        decisions:JSON.parse(JSON.stringify(ST.result.buildingDecisions)),
        diagnostics:buildingCompilation.diagnostics,deferredItems:buildingCompilation.deferredItems,
        poses:buildingCompilation.poses,translation:{x:sceneTranslationX,y:0},
        displayHeightAssumptions:JSON.parse(JSON.stringify({floors:DATA.floors||null,heightDefaults:DATA.heightDefaults||null})),
        registrationExtraction:ST.result.registrationExtraction||null
      }]);
    }
    if (sceneCompilation) {
      // Additive top-level provenance survives ordinary save/load and undo. It is
      // deliberately separate from live geometry and cannot authorize later actions.
      var report = { id: 'scene_' + (nextId++), version: sceneCompilation.version,
        status: sceneCompilation.reconstructionStatus,
        originalIR: JSON.parse(JSON.stringify(ST.result.sceneIR)),
        sourceIdMap: read.sourceIdMap, translation: { x: sceneTranslationX, y: 0 },
        evidence: sceneCompilation.evidence, defaults: sceneCompilation.defaults,
        unresolvedEntities: sceneCompilation.unresolvedEntities,
        acknowledgedOmissions: sceneCompilation.acknowledgedOmissions,
        reviewDecisions: JSON.parse(JSON.stringify(ST.result.sceneOptions)),
        diagnostics: sceneCompilation.diagnostics };
      if (sceneCompilation.version === 3) {
        report.placementContext = sceneCompilation.placementContext ? JSON.parse(JSON.stringify(sceneCompilation.placementContext)) : null;
        report.sourcePreview = JSON.parse(JSON.stringify(sceneCompilation.sourcePreview));
        report.extraction = ST.result.extraction ? JSON.parse(JSON.stringify(ST.result.extraction)) : null;
      }
      DATA.sceneReconstructionReports = (base.sceneReconstructionReports || []).concat([report]);
    }
    try {
    syncBuildingNotice();
    // 片引き戸は、壁のある側へ引くように向ける(読み取りは引く向きを持たない)。
    if (!sceneCompilation && typeof orientSlideInDoorsToWalls === 'function') orientSlideInDoorsToWalls(read.items);
    // 読み込み経路(doImport)と同じ手順で、アプリが期待する既定値をそろえる。
    if (typeof syncNorthFromPlan === 'function') syncNorthFromPlan();
    if (typeof ensureObjectIds === 'function') ensureObjectIds();
    if (typeof ensureExteriorWallSettings === 'function') ensureExteriorWallSettings();
    if (typeof ensureInteriorWallSettings === 'function') ensureInteriorWallSettings();
    if (typeof ensureRoofAppearance === 'function') ensureRoofAppearance();
    if (typeof ensureFloorMetadata === 'function') ensureFloorMetadata();
    if (typeof syncExteriorWallSettings === 'function') syncExteriorWallSettings();
    // Scene IR contains exact canonical types/poses, so a global legacy migration would
    // change unrelated existing work and could overwrite extracted elevations.
    if (!sceneCompilation && !buildingCompilation && typeof normalizeLegacyFurnitureItems === 'function') normalizeLegacyFurnitureItems();
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
    // 図面に描かれていた家具を「おすすめの家具」としてカタログの先頭に出す。
    // **ここからは置かない。**押すとカタログのその欄を開く(plan-finish.js の mount)。
    if (ST.result.finish && typeof PlanFinish !== 'undefined') PlanFinish.mount(ST.result.finish);
    if (sceneCompilation) ST.result.sceneApplied = true;
    closePlanImport();
    } catch (error) {
      if (!buildingCompilation) throw error;
      setStatus('部分的な取り込みは保存されましたが、表示の更新に失敗しました。重複を防ぐため再適用はできません。元に戻す操作で取り消せます。');
      syncPlanImportButtons();
    }
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
    root.addEventListener('touchcancel', cancelPlanImportDrag);
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
  root.cancelPlanImportDrag = cancelPlanImportDrag;
  root.planImportSelectAll = planImportSelectAll;
  root.selectPlanImportPage = selectPlanImportPage;
  root.confirmPlanImportPage = confirmPlanImportPage;
  root.runPlanImport = runPlanImport;
  root.applyPlanImport = applyPlanImport;
  // 検査から中身を覗くため
  root.PlanImport = {
    state: ST,
    croppedDataUrl: croppedDataUrl,
    toAppObjects: toAppObjects,
    previewSceneIR: previewSceneIR,
    stageSceneIR: stageSceneIR,
    confirmScenePlacement: confirmScenePlacement,
    sceneCatalogue: sceneCatalogue,
    sceneMappingCandidates: sceneMappingCandidates,
    showPlanImportError: showPlanImportError,
    showQuota: showQuota,
    renderPlanImportResult: renderPlanImportResult,
    stageBuildingReview: stageBuildingReview,
    syncBuildingNotice: syncBuildingNotice,
    compileBuildingReview: compileBuildingReview,
    requestBuildingRegistration: requestBuildingRegistration,
    reviewChanges: reviewChanges,
    fitContain: fitContain,
    validPlanBox: validPlanBox,
    MAX_SEND_PX: MAX_SEND_PX,
  };
}(typeof self !== 'undefined' ? self : this));
