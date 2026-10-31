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
    pages: null,        // PDFを選んだとき、ページごとの画像 (data URL の配列。ページ全体)
    pdf: null,          // PDFを選んだとき {data, previews: [Image], boxes: [{x0,y0,x1,y1} ページに対する割合], page}
    fileName: '',
    crop: null,         // 切り出し範囲 {x,y,w,h} 画像の画素で
    drag: null,         // 囲んでいる最中の状態
    result: null,       // 読み取り結果 {plan, summary, notes, warnings, marks, usage}
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
        // 使う人に要るのは「あと何回できるか」だけ。上限の内訳（ひとり・全体）は運営側の事情なので出さない。
        ? '本日あと ' + q.left + ' 回 読み取れます'
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
    ST.image = null; ST.pages = null; ST.pdf = null; ST.fileName = '';
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
        ST.image = null; ST.crop = null; ST.result = null; ST.pages = null; ST.pdf = null;
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
          if (!pages || !pages.length) return;
          // ページごとに図面の位置を AI に聞き、その範囲を最初から選んだ状態で見せる。
          // 利用者は何もしなくてよい。位置がずれていたときだけ囲み直せる（2026-10-20 利用者の要望:
          // PDF でも読み取る範囲が見えて、直せること）。位置はまとめて聞く。順番に聞くと、
          // 1ページぶんの待ちがページ数だけ積み上がる。
          setStatus('図面の位置を探しています…');
          return Promise.all(pages.map(function (page, i) {
            return locate((smalls && smalls[i]) || page);
          })).then(function (boxes) {
            return Promise.all((smalls || pages).map(loadImage)).then(function (previews) {
              ST.pages = pages;
              ST.pdf = { data: pdfData, previews: previews, boxes: boxes.map(function (b) { return b ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : FULL_PAGE; }), page: 0 };
              show('plan-import-step2', true);
              show('plan-import-crop', true);
              show('plan-import-step3', false);
              showPdfPage(0);
              setStatus(pages.length > 1
                ? pages.length + 'ページを読み取ります。図面の部分を囲んであります。ずれていたら囲み直してください（ページは「次のページ」で切り替え）。'
                : '図面の部分を囲んであります。ずれていたら囲み直してください。');
              syncPlanImportButtons();
            });
          });
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
        ST.image = img; ST.pages = null; ST.pdf = null;
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
  var FULL_PAGE = { x0: 0, y0: 0, x1: 1, y1: 1 };

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // PDF のいま見ているページを囲む画面に出す。囲みはページに対する割合で覚えておき、
  // 画面の画素（ST.crop）とはここで行き来する。
  function showPdfPage(i) {
    var pdf = ST.pdf;
    if (!pdf) return;
    savePdfCrop();
    pdf.page = Math.max(0, Math.min(pdf.previews.length - 1, i));
    var img = pdf.previews[pdf.page], b = pdf.boxes[pdf.page];
    ST.image = img;
    ST.crop = { x: b.x0 * img.naturalWidth, y: b.y0 * img.naturalHeight, w: (b.x1 - b.x0) * img.naturalWidth, h: (b.y1 - b.y0) * img.naturalHeight };
    var nav = $('plan-import-pages');
    if (nav) {
      nav.style.display = pdf.previews.length > 1 ? '' : 'none';
      var label = $('plan-import-page-label');
      if (label) label.textContent = (pdf.page + 1) + ' / ' + pdf.previews.length + 'ページ';
    }
    drawPlanImportPreview();
  }

  function savePdfCrop() {
    var pdf = ST.pdf;
    if (!pdf || !ST.image || !ST.crop || ST.image !== pdf.previews[pdf.page]) return;
    var W = ST.image.naturalWidth, H = ST.image.naturalHeight, r = ST.crop;
    pdf.boxes[pdf.page] = { x0: r.x / W, y0: r.y / H, x1: (r.x + r.w) / W, y1: (r.y + r.h) / H };
  }

  function planImportPage(step) {
    if (ST.pdf) showPdfPage(ST.pdf.page + step);
  }

  // AI が受け取れる大きさに収める（Claude は1枚あたり約5MB・1回の送信全体で約32MB まで。
  // 超えると断られ、何度試しても通らない）。色の多いスキャンや写真の PNG は大きくなるので、
  // 上限を超えるものだけ JPEG にし、それでも大きければ縮める。線画の PNG はほとんど小さいまま。
  // 1枚あたりの上限は、最大8ページと見直しの撮影を足しても全体の上限に収まる大きさにしてある。
  var MAX_SEND_B64 = 3.5 * 1024 * 1024;
  function fitForAi(url) {
    if (String(url).length <= MAX_SEND_B64) return Promise.resolve(url);
    return loadImage(url).then(function (img) {
      var encode = function (scale) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.9);
      };
      var scale = 1, out = encode(scale);
      while (out.length > MAX_SEND_B64 && scale > 0.3) { scale *= 0.8; out = encode(scale); }
      return out;
    }).catch(function () { return url; });
  }

  // 送る画像。PDF は囲んだ範囲をページから高い解像度で描き直す（ページ全体ならそのまま）。
  // 画像は囲んだ範囲を切り出す（囲んでいなければ全体）。どちらも AI が受け取れる大きさに収める。
  function imagesToSend() {
    return collectImages().then(function (list) { return Promise.all(list.map(fitForAi)); });
  }
  function collectImages() {
    if (!ST.pdf) { var one = croppedDataUrl(); return Promise.resolve(one ? [one] : []); }
    savePdfCrop();
    var pdf = ST.pdf, out = ST.pages.slice();
    var next = function (i) {
      if (i >= out.length) return out;
      var b = pdf.boxes[i];
      if ((b.x1 - b.x0) * (b.y1 - b.y0) > 0.97) return next(i + 1);
      return PdfPages.renderRegion(pdf.data, i + 1, b, { maxPx: MAX_SEND_PX })
        .then(function (cropped) { if (cropped) out[i] = cropped; return next(i + 1); })
        .catch(function () { return next(i + 1); });
    };
    return Promise.resolve(next(0));
  }

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
    savePdfCrop();
    drawPlanImportPreview();
    syncPlanImportButtons();
  }

  function planImportSelectAll() {
    if (!ST.image) return;
    ST.crop = { x: 0, y: 0, w: ST.image.naturalWidth, h: ST.image.naturalHeight };
    savePdfCrop();
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
  }

  // ── 3. 読み取る ────────────────────────────────────────────────────
  function runPlanImport() {
    if (ST.busy || (!ST.image && !ST.pages)) return;
    ST.busy = true; ST.result = null;
    show('plan-import-step3', false);
    syncPlanImportButtons();
    setStatus('読み取りの準備をしています…');

    var hint = ($('plan-import-hint') && $('plan-import-hint').value) || '';
    var images = null;
    // 短い指示で読む経路（Claude）を先に試す。使えない環境（鍵が無い）では、これまでの読み取りへ戻る。
    imagesToSend().then(function (list) {
      images = list;
      if (!images.length) return { status: 400, body: { error: 'no_image' } };
      return readPlanStream(images, hint);
    }).then(function (r) {
      if (r && r.unavailable) return runLegacyPlanImport(images, hint);
      ST.busy = false;
      showProgress(false);
      if (!r || r.status !== 200) {
        show('plan-import-step2', true);
        showPlanImportError(r ? r.status : 0, r ? r.body : null); syncPlanImportButtons(); showQuota(); return;
      }
      ST.result = r.body;
      renderPlanImportResult(r.body);
      syncPlanImportButtons();
      showQuota();
    }).catch(function () {
      ST.busy = false;
      showProgress(false);
      setStatus('サーバに接続できませんでした。通信の状態を確かめて、もう一度お試しください。');
      syncPlanImportButtons();
      showQuota();
    });
  }

  // これまでの読み取り（手順で縛った指示を1ページずつ。OpenAI / Vertex）。Claude の鍵が無い環境で使う。
  function runLegacyPlanImport(images, hint) {
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
          ? Promise.resolve(null) : PlanFinish.analyze(body.plan, body.marks);
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

  // ── 短い指示での読み取り（Claude、答えを少しずつ受け取る） ────────────
  //
  // Worker は Anthropic の返事（SSE）を読み解かずにそのまま流してくる。ここで読み、
  //   考えている間  … 目安の時間に対する経過と、考えている内容の要約
  //   書き出し中    … 何階の何を、いくつ作ったか
  // を出す。答えを少しずつ受け取っても、費用はまとめて受け取るときと同じ。
  //
  // 目安の時間は図面の枚数から出す（2026-10-19 実測: 3枚で約3分、ほとんどが考えている時間）。
  var READ_SECONDS_PER_PAGE = 60;
  var ANSWER_CHARS_PER_PAGE = 2800;

  // 読み取り中は、図面を囲む欄をたたんで進み具合を見える位置に出す。図面のプレビューが
  // 大きいと、進み具合がダイアログの下に押し出されて「何も起きていない」ように見える。
  function showProgress(on) {
    var box = $('plan-import-progress');
    if (!box) return;
    box.hidden = !on;
    if (on) {
      show('plan-import-step2', false);
      if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    }
  }

  // 段階: 1 読み取り → 2 組み立てた家を3Dで見せて見直し。目安の時間は両方を合わせて出す。
  var STAGE_LABEL = { read: '1/2 読み取り', review: '2/2 3Dで見直し' };

  function renderProgress(p) {
    var elapsed = Math.round((Date.now() - p.started) / 1000);
    var estimate = Math.max(30, p.pages * READ_SECONDS_PER_PAGE) * (p.withReview ? 2 : 1);
    var mmss = function (sec) { return Math.floor(sec / 60) + '分' + String(sec % 60).padStart(2, '0') + '秒'; };
    var stageElapsed = Math.round((Date.now() - p.stageStarted) / 1000);
    var stageEstimate = Math.max(30, p.pages * READ_SECONDS_PER_PAGE);
    var base = p.stage === 'review' ? 50 : 0, span = p.withReview ? 50 : 100;
    var fill, phase;
    if (p.stage === 'capture') {
      phase = '読み取った家を組み立てて、平面図と3Dを撮っています';
      fill = 50;
    } else if (!p.answer) {
      phase = p.stage === 'review' ? '組み立てた家を図面と見比べています' : '図面を読み、間取りを考えています';
      // 考えている間は、その段階の目安の 7 割までしか進めない。書き出しに入ってから残りを埋める。
      fill = base + Math.min(0.7, 0.7 * stageElapsed / (stageEstimate * 0.7)) * span;
    } else {
      var made = (typeof PlanFreeApply !== 'undefined') ? PlanFreeApply.progressOf(p.answer) : null;
      var SECTION = { walls: '壁', rooms: '部屋', openings: '窓・扉', stairs: '階段', roofs: '屋根', objects: '家具・設備' };
      var verb = p.stage === 'review' ? 'を直しています' : 'を置いています';
      phase = made && made.floor ? made.floor + '階の' + (SECTION[made.section] || '間取り') + verb : '間取りを書き出しています';
      fill = base + (0.7 + Math.min(0.28, 0.28 * p.answer.length / (p.pages * ANSWER_CHARS_PER_PAGE))) * span;
      if (made) {
        $('plan-import-progress-made').textContent = (p.stage === 'review' ? '直したあとの数: ' : '作ったもの: ') + '壁 ' + made.walls + ' / 部屋 ' + made.rooms
          + ' / 窓・扉 ' + made.openings + ' / 家具・設備 ' + made.objects;
      }
    }
    if (p.withReview) phase = STAGE_LABEL[p.stage === 'capture' ? 'review' : p.stage] + '：' + phase;
    $('plan-import-progress-phase').textContent = phase;
    $('plan-import-progress-time').textContent = '経過 ' + mmss(elapsed) + '（目安 ' + mmss(estimate) + '）';
    $('plan-import-progress-fill').style.width = Math.min(99, fill).toFixed(1) + '%';
    // 利用者に見せるのは、日本語で、座標や寸法の数字が並んでいない行だけ（作業の様子が伝わればよく、
    // 数字の列は利用者の役に立たない）。考えの要約が英語で来ることもある（2026-10-19 実測）。
    var shown = function (line) { return /[぀-ヿ一-鿿]/.test(line) && (line.match(/\d+/g) || []).length < 2; };
    var thought = String(p.thought || '').trim().split(/\n+/).filter(shown).pop() || '';
    $('plan-import-progress-thought').textContent = thought ? 'AIのメモ: ' + thought.slice(-160) : '';
  }

  // 1つの SSE の出来事（data: {...}）を読み、進み具合に足す。
  function takeStreamEvent(p, data) {
    var ev;
    try { ev = JSON.parse(data); } catch (e) { return; }
    if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'thinking_delta') p.thought += ev.delta.thinking || '';
      else if (ev.delta.type === 'text_delta') p.answer += ev.delta.text || '';
    } else if (ev.type === 'message_start' && ev.message && ev.message.usage) {
      p.usage.inputTokens += (ev.message.usage.input_tokens || 0) + (ev.message.usage.cache_read_input_tokens || 0)
        + (ev.message.usage.cache_creation_input_tokens || 0);
    } else if (ev.type === 'message_delta') {
      if (ev.usage) p.stageOutput = ev.usage.output_tokens || 0;
      if (ev.delta && ev.delta.stop_reason) p.stopReason = ev.delta.stop_reason;
    } else if (ev.type === 'error') {
      p.error = (ev.error && ev.error.message) || 'AI 側で失敗しました。';
    }
  }

  // 1回分の問い合わせを、答えが届ききるまで読む。
  //   { unavailable: true }  … この環境では使えない（404）
  //   { status, body }       … Worker が断った・失敗した
  //   { answer }             … 届いた答え（JSON として読めたもの）
  //   { error, code }        … 届いたが読めなかった（code で次の一手の文面を分ける。showPlanImportError）
  function streamAnswer(url, payload, p) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (res.status === 404) return { unavailable: true };
      if (!res.ok || !res.body) return readReply(res);
      p.thought = ''; p.answer = ''; p.stopReason = ''; p.error = ''; p.stageOutput = 0;
      var reader = res.body.getReader(), decoder = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buf += decoder.decode(chunk.value, { stream: true });
          var cut;
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            var block = buf.slice(0, cut); buf = buf.slice(cut + 2);
            block.split('\n').forEach(function (line) {
              if (line.indexOf('data:') === 0) takeStreamEvent(p, line.slice(5).trim());
            });
          }
          return pump();
        });
      }
      return pump().then(function () {
        p.usage.outputTokens += p.stageOutput;
        // 途中で AI 側が止まった（混雑など）・断った・答えが切れた・読めなかった、は次の一手が違う。
        if (p.error) return { error: p.error, code: 'ai_upstream_error' };
        if (p.stopReason === 'refusal') return { error: 'refused', code: 'ai_refused' };
        try { return { answer: JSON.parse(p.answer) }; } catch (e) {
          return { error: 'unreadable', code: p.stopReason === 'max_tokens' ? 'ai_truncated' : 'ai_bad_response' };
        }
      });
    });
  }

  function catalogueTags() {
    return (typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items) || {};
  }

  // 答えを、取り込んだときと同じ形（基礎・屋根まで）に組み立てる。3Dで撮るため。
  function assembleForSnapshot(importPlan) {
    var read = toAppObjects(importPlan);
    var made = structureItems(read.walls, null);
    if (read.items.some(function (it) { return it.type === 'roof'; })) made = made.filter(function (st) { return st.type !== 'roof'; });
    return { walls: read.walls, rooms: read.rooms, items: read.items.concat(made) };
  }

  function readPlanStream(images, hint) {
    var withReview = typeof PlanSnapshot !== 'undefined' && PlanSnapshot.available();
    var p = { started: Date.now(), stageStarted: Date.now(), stage: 'read', withReview: withReview, pages: images.length,
      thought: '', answer: '', usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, stopReason: '', error: '', stageOutput: 0 };
    var timer = null;
    var startUi = function () {
      if (timer) return;
      setStatus('');
      showProgress(true);
      renderProgress(p);
      timer = setInterval(function () { renderProgress(p); }, 500);
    };
    var stop = function () { if (timer) { clearInterval(timer); timer = null; } };
    startUi();
    return streamAnswer('/api/ai/read-plan', { images: images, hint: hint }, p).then(function (r) {
      if (r.unavailable || r.status) {
        stop();
        // この環境では使えない・断られた: 進み具合を閉じ、図面の欄を戻す（これまでの読み取りやり直しに備える）。
        showProgress(false);
        show('plan-import-step2', true);
        return r;
      }
      p.usage.calls++;
      if (r.error) { stop(); return { status: 502, body: { error: r.code || 'ai_bad_response' } }; }
      var first = r.answer;
      if (!withReview) { stop(); return finishPlanStream(p, first, { review: 'off' }); }

      // ── 2. 組み立てた家を撮って、AI 自身に見直させる ──────────────────
      p.stage = 'capture'; p.stageStarted = Date.now(); renderProgress(p);
      var tags = catalogueTags();
      var draft = PlanFreeApply.toImportPlan(first, tags, { keepOffWall: true });
      var facts = PlanFreeApply.factsOf(draft, first);
      var shots = null;
      try { shots = PlanSnapshot.capture(assembleForSnapshot(draft)); } catch (e) { shots = null; }
      var list = shots ? shots.plans.map(function (s) { return { label: s.floor + '階 平面図', image: s.url }; })
        .concat(shots.views.map(function (s) { return { label: '外観3D ' + s.name, image: s.url }; })) : [];
      if (!list.length) { stop(); return finishPlanStream(p, first, { review: 'failed' }); }
      p.stage = 'review'; p.stageStarted = Date.now(); renderProgress(p);
      return streamAnswer('/api/ai/review-plan-3d', { images: images, shots: list, answer: first, facts: facts, hint: hint }, p)
        .then(function (r2) {
          stop();
          if (r2.answer) { p.usage.calls++; return finishPlanStream(p, r2.answer, { review: 'done' }); }
          if (r2.status !== 429) p.usage.calls += r2.error ? 1 : 0;
          return finishPlanStream(p, first, { review: 'failed' });
        }, function () {
          stop();
          return finishPlanStream(p, first, { review: 'failed' });
        });
    }, function (e) { stop(); throw e; });
  }

  // 届ききった答えを、取り込みの形（renderPlanImportResult が受ける形）にする。
  function finishPlanStream(p, answer, extra) {
    var plan = PlanFreeApply.toImportPlan(answer, catalogueTags());
    if (!plan.walls.length) {
      return { status: 422, body: { error: 'ai_invalid_plan', message: '図面から壁を読み取れませんでした。平面図のページか確かめてください。' } };
    }
    var summary = (typeof PlanSchema !== 'undefined' && PlanSchema.summarize) ? PlanSchema.summarize(plan)
      : { walls: plan.walls.length, rooms: plan.rooms.length, items: plan.items.length };
    // 利用者に見せるのは、利用者が知って役に立つことだけ（AI の作業メモや、見直しの成否は出さない）。
    // 見直しの成否（review: done / failed / off）は測る道具（tools/plan-eval/run.mjs）のためで、画面には出さない。
    var review = (extra && extra.review) || 'off';
    var notes = plan.userNotes.slice(0, 20);
    if (review === 'done') notes.unshift('立体にして図面と見比べ、整えました。');
    return { status: 200, body: {
      plan: plan, summary: summary, marks: [], warnings: [], notes: notes,
      usage: p.usage, freeRead: true, review: review,
    } };
  }

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
      ai_truncated: '図面の情報が多く、AIの答えが途中で切れました。ページを分けて読み取ってください。',
      ai_refused: 'AIがこの図面の読み取りを断りました。間取り図のページか確かめてください。',
      ai_upstream_error: 'AI側でエラーが起きました。少し待ってからもう一度お試しください。',
      ai_quota_exceeded: '',   // message をそのまま出す（残り回数を含むため）
      invalid_request: '送った画像に問題がありました。',
      no_image: '読み取る範囲がありません。図面の部分を囲み直してください。',
      image_too_large: '図面の画像が大きすぎます。ページ数を減らすか、図面の部分だけを囲んでからお試しください。',
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
    // 新しい下書きのたびに、取り込みのボタンを出し直し、前の確認は閉じる。
    hideApplyConfirm();
    var s = body.summary || {};
    setStatus('下書きができました。取り込んだあと、手で直して仕上げてください。');
    var head = $('plan-import-summary');
    if (head) {
      head.textContent = '壁 ' + (s.walls || 0) + ' / 部屋 ' + (s.rooms || 0) +
        (body.freeRead ? ' / 建具・階段・家具など ' : ' / 開口・階段 ') + (s.items || 0) + '（階 ' + ((s.floors || []).join('・') || '-') + '）';
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
    // 費用・トークン数は利用者の画面に出さない（利用者にとって必要の無い、開発の都合の情報）。
    // 測定に要る値は body.usage に残してある。
    var cost = $('plan-import-cost');
    if (cost) cost.textContent = '';
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
      // 見直しを省いたことは利用者に関係が無いので出さない。
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
      if (w.wallStyle) made.wallStyle = w.wallStyle;   // 手すり壁（balcony-fence）など
      mergeExtra(made, w.extra);                        // 壁の高さなど（assets/js/plan-settable.js の項目）
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
      mergeExtra(made, r.extra);                        // 床材・天井高・吹抜け・土間
      // 土間（plan-settable.js の floorLevel=doma）。深さはいまの間取りの床の厚みで決まるので、
      // 設定パネルの「玄関土間」と同じ計算でここで mm にする。アプリの部屋は floorLevel を持たない。
      if (made.floorLevel === 'doma' && typeof domaFloorRaiseMm === 'function') made.floorRaiseMm = domaFloorRaiseMm(floor);
      delete made.floorLevel;
      out.rooms.push(made);
    });
    // 敷地（境界・地面・駐車スペースなどの区画）。図面に描かれていたときだけ。
    if (plan.site) {
      var s = plan.site;
      var site = mkItem('site-rect', s.x, s.y, 0, 1, s.w, s.d);
      site.name = '敷地境界（土地全体）'; site.siteBoundary = true; site.siteSurface = s.surface;
      site.siteZones = (s.zones || []).map(function (z) { return { name: z.name, x: z.x, y: z.y, w: z.w, d: z.d, surface: z.surface }; });
      out.items.push(site);
    }
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
      // 短い指示の読み取りは、扉の吊り元・開く側（flipX/flipY）、閉じた状態、モデルの正面軸などを
      // extra に持ってくる（assets/js/plan-free-apply.js）。mkItem の既定値の上に重ねる。
      mergeExtra(made, it.extra);
      // 部屋の中に置いた「地面に置く印」のモデル（洗濯機・物干しなど）は、その部屋の床に載せる。
      // 印のままだと1階の地面に置かれ、床から下に埋まる（2026-10-23 利用者の指摘「洗濯機の
      // 高さが潰れる」）。印の意味は app-constants.js の itemPlacedOnFloorExplicitly。
      var model = (typeof getFmpItem === 'function') ? getFmpItem(made.type) : null;
      if (model && model.groundLevel && roomContains(out.rooms, made)) made.indoor = true;
      out.items.push(made);
    });
    return out;
  }

  function roomContains(rooms, it) {
    var cx = it.x + (it.w || 0) / 2, cy = it.y + (it.d || 0) / 2;
    return rooms.some(function (r) {
      return (r.floor || 1) === (it.floor || 1) && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.d;
    });
  }

  function mergeExtra(made, extra) {
    if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (k) { made[k] = extra[k]; });
  }

  // その間取りに出てくる階。
  function floorsOfObjects() {
    var seen = [];
    for (var i = 0; i < arguments.length; i++) {
      (arguments[i] || []).forEach(function (o) {
        // 屋根は「その下の階の上」に載る物で、floor は1つ上の数になる（3階建ての屋根は 4）。
        // 階として数えると、確認の文に無い「4階」が出る。
        // 敷地も階の物ではない（1階として数えると、2階だけ読んだときに確認の文へ「1階」が出る）。
        if (o && (o.type === 'roof' || o.type === 'site-rect')) return;
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

  // 敷地と周辺（道路・隣家・電柱）。間取りの階の中身ではない（敷地は読み取りが答えることもある）。
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

  // 取り込みの確認は、ダイアログの中に出す。ブラウザの確認の窓（confirm）は、アプリに埋め込まれた
  // 画面などで表示されずに「いいえ」が返ることがあり、押しても何も起きないように見えた（2026-10-19）。
  function showApplyConfirm(text) {
    var box = $('plan-import-confirm');
    if (!box) return;
    $('plan-import-confirm-text').textContent = text;
    box.hidden = false;
    show('plan-import-apply', false);
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }
  function hideApplyConfirm() {
    var box = $('plan-import-confirm');
    if (box) box.hidden = true;
    show('plan-import-apply', true);
  }
  function cancelPlanImportApply() { hideApplyConfirm(); }

  // mode: 省略（押したとき）→ 確認が要れば確認を出す。'confirmed'（確認で「取り込む」）→
  // 「取り込んでいます」を出して画面を描かせてから 'go' で組み立てる。
  function applyPlanImport(mode) {
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
    // 敷地はひとつ。いまの間取りに敷地があれば、そちらを残す（利用者が整えた外構を消さない）。
    if ((base.items || []).some(function (o) { return o && o.type === 'site-rect'; })) {
      read.items = read.items.filter(function (o) { return o.type !== 'site-rect'; });
    }

    // 何が起きるのかを、押す前に言う。
    if ((DATA.walls || []).length || (DATA.rooms || []).length) {
      var ask = fresh
        ? 'いまの間取りを外して、読み取った下書き（' + floorLabel(readFloors) + '）から作りはじめます。よろしいですか？'
        : beside
          ? 'いまの' + floorLabel(readFloors) + 'には間取りがあります。消さずに、'
            + '読み取った下書きをその右隣に建てます。よろしいですか？'
            + '（見比べて、要らないほうを消してください）'
          : '読み取った下書き（' + floorLabel(readFloors) + '）を、いまの間取りに足します。よろしいですか？';
      if (mode !== 'confirmed' && mode !== 'go') { showApplyConfirm(ask); return; }
    }
    if (mode !== 'go') {
      // 組み立てと3Dの作り直しには時間がかかることがある。先に何が起きているかを出し、
      // 画面が描かれてから組み立てる（黙って止まって見えないように）。
      hideApplyConfirm();
      show('plan-import-apply', false);
      setStatus('下書きを取り込んでいます…');
      setTimeout(function () { applyPlanImport('go'); }, 30);
      return;
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
      var besideStruct = structureItems(read.walls, null);
      if (read.items.some(function (it) { return it.type === 'roof'; })) {
        besideStruct = besideStruct.filter(function (st) { return st.type !== 'roof'; });
      }
      DATA.items = (base.items || []).concat(read.items, besideStruct);
    } else {
      // 空いている階に入れる。読み取った階に在るのは、壁から決まる基礎・屋根
      // だけなので、それはここで作り直す（階が増えれば屋根の載る位置も変わる）。
      var keepItems = (base.items || []).filter(function (o) {
        return !(isDerivedStructure(o) && readFloors.indexOf(Number(o.floor) || 1) >= 0);
      });
      DATA.walls = (base.walls || []).concat(read.walls);
      DATA.rooms = (base.rooms || []).concat(read.rooms);
      var made = structureItems(DATA.walls, readFloors);
      // 読み取りが屋根を答えたときは、それを使う（階ごとの屋根・下屋・形）。壁から作る屋根は
      // 答えが無いときの代わり（いちばん上の階に平らな屋根を1枚）。
      if (read.items.some(function (it) { return it.type === 'roof'; })) {
        made = made.filter(function (st) { return st.type !== 'roof'; });
      }
      DATA.items = keepItems.filter(function (it) {
        return !made.some(function (st) {
          return it && it.type === st.type && (Number(it.floor) || 1) === (Number(st.floor) || 1);
        });
      }).concat(read.items, made);
    }
    // 片引き戸は、壁のある側へ引くように向ける(読み取りは引く向きを持たない)。
    if (typeof orientSlideInDoorsToWalls === 'function') orientSlideInDoorsToWalls(read.items);
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
    // 図面に描かれていた家具を「おすすめの家具」としてカタログの先頭に出す。
    // **ここからは置かない。**押すとカタログのその欄を開く(plan-finish.js の mount)。
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
  root.planImportPage = planImportPage;
  root.runPlanImport = runPlanImport;
  root.applyPlanImport = applyPlanImport;
  root.cancelPlanImportApply = cancelPlanImportApply;
  // 検査から中身を覗くため
  root.PlanImport = {
    state: ST,
    croppedDataUrl: croppedDataUrl,
    imagesToSend: imagesToSend,
    fitForAi: fitForAi,
    toAppObjects: toAppObjects,
    showPlanImportError: showPlanImportError,
    showQuota: showQuota,
    renderPlanImportResult: renderPlanImportResult,
    reviewChanges: reviewChanges,
    fitContain: fitContain,
    MAX_SEND_PX: MAX_SEND_PX,
  };
}(typeof self !== 'undefined' ? self : this));
