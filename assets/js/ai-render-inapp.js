// AIレンダー: いまの視点を、アプリの中で写真のような絵に仕上げる画面。
//
// 設計書: docs/superpowers/specs/2026-11-27-ai-render-in-app-design.md の「画面側」。
// 画面の部品は index.html の #unity-render-modal の上半分(id は ai-render-*)。下の折りたたみの
// 「画像AI用データ」は index.html の generateAiRenderPackage がそのまま受け持つ(ここからは触らない)。
//
// 流れ: 主ボタン → (初回だけ)同意 → 撮る(3Dの絵・深度・輪郭の3枚と、面の向き(法線)の4枚目) → 縦横比をそろえて中央で切り抜き、
// 長辺 1536px の JPEG に縮める → POST /api/ai/render → 結果を出す。
// 送るのは preset・view・aspect・images の4つだけ。**文章の欄は送らない**(指示文は Worker が組み立てる)。
// images は base・depth・edge が必ず。normal(法線)は撮れたときだけ足す(撮れなくても3枚で送る。Worker は任意の欄として受ける)。
//
// 撮る関数は index.html のもの(captureCurrent3DDataUrl・captureInstance3DData・captureAiOverrideGuideDataUrl・
// makeEdgeDataUrlFromSegmentation)を呼ぶ。「画像AI用データ」と同じ絵である。
//
// 結果の絵はメモリに持つだけ。プランにも端末にも自動では残さない。ページを読み直すまで最後の1枚が残る。
// 同意だけは端末の localStorage に版つきで残す(プランのデータには入れない)。
(function () {
  'use strict';

  // 同意の文面(index.html の #ai-render-consent)を変えたら上げる。上げると、もう一度聞く。
  var CONSENT_VERSION = 1;
  var CONSENT_KEY = 'hp.aiRender.consent';
  // 送る絵の長辺。3枚とも同じ大きさにそろえる。
  var LONG_SIDE = 1536;
  var JPEG_QUALITY = 0.88;
  // Worker が受ける1枚の大きさ(base64 の文字数)。worker/routes-render.mjs の MAX_RENDER_IMAGE_CHARS・MAX_REPORT_IMAGE_CHARS。
  var MAX_RENDER_IMAGE_CHARS = 3 * 1024 * 1024;
  var MAX_REPORT_IMAGE_CHARS = 6 * 1024 * 1024;
  // 返事を待つ上限。Worker は上流を 90 秒で切るので、それより長く待つ。
  var CLIENT_TIMEOUT_MS = 150000;
  // モデルが受ける縦横比(Gemini の画像生成の公式文書、2026-11-27 に確かめた)。
  // 1:4・4:1 などの極端な比も受けるが、画面がその形になることは無いので並べない。
  // Worker の許す一覧と食い違うと 400 になる。足す・減らすときは Worker 側の一覧も見る。
  var ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

  var MESSAGES = {
    quotaUser: '今日の分は使い切りました。明日また使えます。',
    quotaTotal: 'きょうは利用が集中していて、受付を終えました。明日また使えます。',
    unavailable: 'いま AI が混み合っています。少し待ってから、もう一度お試しください。',
    notConfigured: 'AIレンダーはいま準備中で使えません。しばらくしてからお試しください。',
    blocked: 'この画面は仕上げられませんでした。視点を変えてお試しください。',
    upstream: 'AI側でエラーが起きました。少し待ってからもう一度お試しください。',
    network: '通信できませんでした。電波の良い所で、もう一度お試しください。',
    other: 'うまく仕上げられませんでした。少し待ってから、もう一度お試しください。',
    capture: '3Dの画面を撮れませんでした。3Dの表示が終わってから、もう一度お試しください。',
    noView: '外観3D・内観3D・ウォークスルーのどれかを表示してから、もう一度お試しください。',
    reportDone: '報告を受け付けました。ありがとうございます。',
    reportLimit: '今日はこれ以上報告を受け付けられません。明日またお試しください。',
    reportFail: '報告を送れませんでした。少し待ってから、もう一度お試しください。',
    revoked: '同意を取り消しました。次に仕上げるときに、もう一度確かめます。',
    saveFail: '画像を保存できませんでした。もう一度お試しください。'
  };

  var S = {
    busy: false,
    consentOpen: false,
    waitingBase: '',      // 待っている間に薄く出す、撮った絵
    result: null,         // { image, base }
    error: null,          // { text, retry }
    compare: false,
    reportOpen: false,
    left: null,           // 今日あと何枚(分からなければ null)
    leftMessage: '',      // 0 枚のときの文(Worker が付けてくれば、それを出す)
    memConsent: false,    // localStorage が使えない端末では、開いている間だけ覚える
    saveHint: false       // 共有シートにファイルを渡せなかったとき、長押しで保存する案内を出す
  };

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text || ''; }

  // ── 同意 ───────────────────────────────────────────────
  function hasConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.v === CONSENT_VERSION) return true;
      }
    } catch (e) { /* 使えない端末は下で */ }
    return S.memConsent;
  }
  function saveConsent() {
    S.memConsent = true;
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, at: new Date().toISOString() })); } catch (e) {}
  }
  function clearConsent() {
    S.memConsent = false;
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) {}
  }

  // ── 残り枚数 ─────────────────────────────────────────────
  // GET /api/ai/quota の中から、レンダーの残り枚数を読む。**読む場所はここだけ。**
  // 欄の名前は Worker 側が決める(設計書「上限」)。2026-11-27 の Worker は q.render = { left, perUser, message? }。
  // 古い Worker や別の名前でも壊れないよう、どれにも当たらなければ null(残りを出さない)。
  function readRenderLeft(q) {
    if (!q || typeof q !== 'object') return null;
    var r = q.render;
    var cands = [];
    if (r && typeof r === 'object') {
      if (r.counted === false) return null;
      cands.push(r.left, r.remaining);
    } else {
      cands.push(r);
    }
    cands.push(q.renderLeft, q.render_left, q.renderRemaining);
    for (var i = 0; i < cands.length; i++) {
      var n = cands[i];
      if (typeof n === 'number' && isFinite(n) && n >= 0) return Math.floor(n);
    }
    return null;
  }
  // 0 枚のときの文。Worker が付けてくれば、それをそのまま出す(本日ぶん・今月ぶんで文が違うため)。
  function readRenderMessage(q) {
    var r = q && q.render;
    return r && typeof r === 'object' && typeof r.message === 'string' ? r.message : '';
  }
  function fetchQuota() {
    if (typeof fetch !== 'function') return;
    fetch('/api/ai/quota').then(function (r) { return r.json(); }).then(function (q) {
      S.left = readRenderLeft(q);
      S.leftMessage = readRenderMessage(q);
      paint();
    }).catch(function () { S.left = null; S.leftMessage = ''; paint(); });
  }

  // ── 縦横比と切り抜き ─────────────────────────────────────
  function ratioOf(a) { var p = a.split(':'); return Number(p[0]) / Number(p[1]); }
  // 画面の縦横比に最も近い、モデルが受ける比。比の対数の差で比べる(縦長と横長を同じ重みにする)。
  function pickAspect(w, h) {
    var want = Math.log(w / h), best = ASPECTS[0], bestD = Infinity;
    for (var i = 0; i < ASPECTS.length; i++) {
      var d = Math.abs(Math.log(ratioOf(ASPECTS[i])) - want);
      if (d < bestD) { bestD = d; best = ASPECTS[i]; }
    }
    return best;
  }
  function outSize(aspect) {
    var r = ratioOf(aspect);
    return r >= 1 ? { w: LONG_SIDE, h: Math.round(LONG_SIDE / r) } : { w: Math.round(LONG_SIDE * r), h: LONG_SIDE };
  }
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image')); };
      img.src = url;
    });
  }
  // 中央で aspect に切り抜いて、size に縮めた JPEG。どの絵も同じ割合の範囲を切るので、写る範囲がそろう。
  // Worker の上限(1枚 3MB)を超えるときだけ、画質を下げて詰め直す(大きさと範囲は変えない)。
  function cropTo(img, aspect, size) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var r = ratioOf(aspect), sw = iw, sh = ih;
    if (iw / ih > r) sw = ih * r; else sh = iw / r;
    var cv = document.createElement('canvas');
    cv.width = size.w; cv.height = size.h;
    var cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, size.w, size.h);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, size.w, size.h);
    var q = JPEG_QUALITY, url = cv.toDataURL('image/jpeg', q);
    while (url.length > MAX_RENDER_IMAGE_CHARS && q > 0.4) { q -= 0.15; url = cv.toDataURL('image/jpeg', q); }
    return url;
  }
  // 報告に付ける絵が Worker の上限(6MB)を超えるときは JPEG に詰め直す。
  async function reportImage(dataUrl) {
    if (dataUrl.length <= MAX_REPORT_IMAGE_CHARS) return dataUrl;
    try {
      var img = await loadImage(dataUrl);
      var cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      var url = cv.toDataURL('image/jpeg', 0.85);
      return url.length <= MAX_REPORT_IMAGE_CHARS ? url : '';
    } catch (e) { return ''; }
  }

  // ── 撮る ────────────────────────────────────────────────
  async function capture() {
    if (!isAiCaptureView()) {
      // 3D でない画面で押したときは、画像AI用データと同じく外観3Dに切り替える。
      setView('3d-ext');
      await waitFrame(260);
      if (!isAiCaptureView()) return { error: MESSAGES.noView };
    }
    await waitFrame(50);
    // 撮影の間で await しない(視点や読み込みが進んで、絵とガイドがずれないように)。
    // 内観か外観かも同じ区間で決める(輪郭を作る await の間に視点が切り替わると、絵と指示文が食い違う)。
    var base = captureCurrent3DDataUrl();
    var view = aiCaptureViewMode();
    var instanceData = captureInstance3DData();
    var depth = captureAiOverrideGuideDataUrl('depth');
    // 面の向き(法線)。天井や壁の傾きを AI に伝える手がかり。撮れなければ3枚で送る。
    var normal = '';
    try { normal = captureAiOverrideGuideDataUrl('normal'); } catch (e) { normal = ''; }
    if (!normal || normal.length < 1000) normal = '';
    var instance = instanceData && instanceData.dataUrl;
    if ([base, depth, instance].some(function (u) { return !u || u.length < 1000; })) return { error: MESSAGES.capture };
    var edge = await makeEdgeDataUrlFromSegmentation(instance);
    if (!edge || edge.length < 100) return { error: MESSAGES.capture };
    var imgs = await Promise.all([loadImage(base), loadImage(depth), loadImage(edge)]);
    var normalImg = null;
    if (normal) { try { normalImg = await loadImage(normal); } catch (e) { normalImg = null; } }
    var aspect = pickAspect(imgs[0].naturalWidth || imgs[0].width, imgs[0].naturalHeight || imgs[0].height);
    var size = outSize(aspect);
    var images = { base: cropTo(imgs[0], aspect, size), depth: cropTo(imgs[1], aspect, size), edge: cropTo(imgs[2], aspect, size) };
    if (normalImg) images.normal = cropTo(normalImg, aspect, size);
    return { aspect: aspect, view: view, images: images };
  }

  function selectedPresetId() {
    var p = (typeof aiRenderSelectedPreset === 'function' && aiRenderSelectedPreset()) || AI_IMAGE_PRESETS[0];
    return p.id;
  }

  // ── 失敗の文 ─────────────────────────────────────────────
  // 言い回しは間取り図の読み取り(assets/js/plan-import.js の showPlanImportError)に合わせる。
  // 上限の文は Worker の message をそのまま出す(本日ぶん・今月ぶんで文が違うため)。
  function errorFor(status, body) {
    var code = (body && body.error) || '';
    if (code === 'ai_quota_exceeded' || status === 429) {
      var msg = body && typeof body.message === 'string' && body.message ? body.message
        : (body && body.scope === 'total' ? MESSAGES.quotaTotal : MESSAGES.quotaUser);
      return { text: msg, retry: false };
    }
    if (code === 'ai_not_configured') return { text: MESSAGES.notConfigured, retry: false };
    if (code === 'ai_quota_unavailable' || status === 503) return { text: MESSAGES.unavailable, retry: true };
    if (code === 'render_blocked' || status === 422) return { text: MESSAGES.blocked, retry: true };
    if (code === 'ai_upstream_error' || status === 502 || status === 504 || status === 524) return { text: MESSAGES.upstream, retry: true };
    return { text: MESSAGES.other, retry: true };
  }

  // ── 生成 ────────────────────────────────────────────────
  async function run() {
    if (S.busy) return;
    S.busy = true;
    S.error = null;
    S.compare = false;
    S.reportOpen = false;
    S.waitingBase = '';
    S.saveHint = false;
    setText('ai-render-msg', '');
    paint();
    try {
      var shot;
      try { shot = await capture(); } catch (e) { shot = { error: MESSAGES.capture }; }
      if (shot.error) { S.error = { text: shot.error, retry: true }; return; }
      S.waitingBase = shot.images.base;
      paint();
      var body = { preset: selectedPresetId(), view: shot.view, aspect: shot.aspect, images: shot.images };
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CLIENT_TIMEOUT_MS) : null;
      var res, data = null;
      try {
        res = await fetch('/api/ai/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl ? ctrl.signal : undefined
        });
        try { data = await res.json(); } catch (e) { data = null; }
      } catch (e) {
        S.error = { text: MESSAGES.network, retry: true };
        fetchQuota();
        return;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (data && typeof data.remaining === 'number' && isFinite(data.remaining) && data.remaining >= 0) { S.left = Math.floor(data.remaining); S.leftMessage = ''; }
      if (!res.ok) {
        S.error = errorFor(res.status, data);
        // 上限で断られたら、押す前に分かるようにする(主ボタンと「もう一度仕上げる」を閉じ、残りの所に同じ文を出す)。
        if (res.status === 429) { S.left = 0; S.leftMessage = S.error.text; }
        // 失敗や安全上の停止でも1枚と数える(Worker は戻さない)。残りを聞き直して表示を合わせる。
        fetchQuota();
        return;
      }
      var image = data && typeof data.image === 'string' && /^data:image\//.test(data.image) ? data.image : '';
      if (!image) { S.error = { text: MESSAGES.blocked, retry: true }; fetchQuota(); return; }
      S.result = { image: image, base: shot.images.base };
    } finally {
      S.busy = false;
      S.waitingBase = '';
      paint();
    }
  }

  // ── 保存 ────────────────────────────────────────────────
  function fileName(mime) {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var ext = /jpe?g/.test(mime) ? 'jpg' : (/webp/.test(mime) ? 'webp' : 'png');
    return 'ai-render-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + ext;
  }
  // 指で操作する端末(iPhone・iPad)では共有シートを先に出す(「画像を保存」で写真に入れられる)。
  // 共有シートにファイルを渡せない端末(iOS のアプリ版の WebView など)では blob: の保存を試すが、
  // 何も起きないことがあるので、結果の下に「絵を長押しして写真に追加」の案内を出す(結果の絵は <img> で、
  // 長押しのメニュー(-webkit-touch-callout)は消していない)。
  function prefersShareSheet() {
    var ua = (navigator && navigator.userAgent) || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var coarse = false;
    try { coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches; } catch (e) {}
    return ios || coarse;
  }
  // 今の「画像AI用データ」の保存リンクと同じく blob: で保存する(iOS Safari は data: の download を無視して開いてしまう)。
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  async function save() {
    if (!S.result) return;
    var blob = dataUrlToBlobSync(S.result.image);
    if (!blob) { setText('ai-render-msg', MESSAGES.saveFail); return; }
    var name = fileName(blob.type || '');
    var touch = prefersShareSheet();
    if (touch && typeof File === 'function' && navigator.share && navigator.canShare) {
      var file = new File([blob], name, { type: blob.type || 'image/png' });
      var ok = false;
      try { ok = navigator.canShare({ files: [file] }); } catch (e) { ok = false; }
      if (ok) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          // 利用者が閉じたときは何もしない。それ以外(使えない)は保存に切り替える。
          if (e && e.name === 'AbortError') return;
        }
      }
    }
    downloadBlob(blob, name);
    if (touch && !S.saveHint) { S.saveHint = true; paint(); }
  }

  // ── 報告 ────────────────────────────────────────────────
  async function sendReport() {
    if (!S.result) return;
    var picked = document.querySelector('input[name="ai-render-report-reason"]:checked');
    var reason = picked ? picked.value : 'other';
    var body = { reason: reason };
    var withImage = $('ai-render-report-image');
    if (withImage && withImage.checked) {
      var im = await reportImage(S.result.image);
      if (im) body.image = im;
    }
    var btn = $('ai-render-report-send');
    if (btn) btn.disabled = true;
    setText('ai-render-report-msg', '');
    try {
      var res = await fetch('/api/ai/render-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        S.reportOpen = false;
        paint();
        setText('ai-render-msg', MESSAGES.reportDone);
        return;
      }
      setText('ai-render-report-msg', res.status === 429 ? MESSAGES.reportLimit : MESSAGES.reportFail);
    } catch (e) {
      setText('ai-render-report-msg', MESSAGES.reportFail);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── 画面に写す ───────────────────────────────────────────
  function setImg(id, src) {
    var img = $(id);
    if (!img) return;
    if (src) { if (img.getAttribute('src') !== src) img.src = src; }
    else img.removeAttribute('src');
  }
  function paint() {
    var waiting = S.busy && !!S.waitingBase;
    var hasResult = !!S.result;
    var showError = !S.busy && !!S.error;
    var showResult = !S.busy && !showError && hasResult;

    var go = $('ai-render-go');
    if (go) go.disabled = S.busy || S.left === 0;

    var left = $('ai-render-left');
    if (left) {
      if (S.left === null) { left.hidden = true; left.textContent = ''; }
      else {
        var leftText = S.left > 0 ? '今日はあと ' + S.left + ' 枚' : (S.leftMessage || MESSAGES.quotaUser);
        // 失敗の欄に同じ文が出ているあいだは、2回続けて出さない。
        left.hidden = showError && S.error.text === leftText;
        left.textContent = leftText;
      }
    }

    show('ai-render-consent', S.consentOpen && !S.busy);
    show('ai-render-stage', waiting || showError || showResult);

    // 絵: 待ち → 撮った絵を薄く。結果 → 仕上がり(見比べ中は元の3D)。
    var baseImg = $('ai-render-base-img');
    if (waiting) {
      setImg('ai-render-base-img', S.waitingBase);
      show('ai-render-base-img', true);
      show('ai-render-result-img', false);
    } else if (showResult) {
      setImg('ai-render-result-img', S.result.image);
      setImg('ai-render-base-img', S.result.base);
      show('ai-render-result-img', !S.compare);
      show('ai-render-base-img', S.compare);
    } else {
      show('ai-render-base-img', false);
      show('ai-render-result-img', false);
    }
    if (baseImg) baseImg.classList.toggle('is-waiting', waiting);
    show('ai-render-wait', waiting);

    show('ai-render-error', showError);
    if (showError) {
      setText('ai-render-error-text', S.error.text);
      show('ai-render-error-retry', !!S.error.retry);
    }

    show('ai-render-result-tools', showResult);
    show('ai-render-save-hint', showResult && S.saveHint);
    var cmp = $('ai-render-compare');
    if (cmp) {
      cmp.setAttribute('aria-pressed', S.compare ? 'true' : 'false');
      cmp.textContent = S.compare ? '仕上がりに戻す' : '元の3Dと見比べる';
    }
    ['ai-render-compare', 'ai-render-save', 'ai-render-again', 'ai-render-report-open'].forEach(function (id) {
      var b = $(id); if (b) b.disabled = S.busy || (id === 'ai-render-again' && S.left === 0);
    });
    show('ai-render-report', showResult && S.reportOpen);
    show('ai-render-revoke', hasConsent());
    // 待っている間は取り消せない(送信中の依頼は止められないので、取り消しても今の1枚は送られてしまう)。
    var revoke = $('ai-render-revoke');
    if (revoke) revoke.disabled = S.busy;
  }

  // ── 押されたとき(index.html の onclick から) ────────────────────
  var api = {
    onOpen: function () {
      // 前に開いていたときの一言(「報告を受け付けました」「同意を取り消しました」など)は、開き直したら消す。
      setText('ai-render-msg', '');
      paint();
      fetchQuota();
    },
    start: function () {
      if (S.busy) return;
      setText('ai-render-msg', '');
      if (!hasConsent()) { S.consentOpen = true; paint(); return; }
      run();
    },
    agree: function () {
      saveConsent();
      S.consentOpen = false;
      run();
    },
    cancelConsent: function () { S.consentOpen = false; paint(); },
    // 「もう一度」も主ボタンと同じ入口を通る(同意を取り消したあとなら、送らずに同意の画面を出す)。
    retry: function () { api.start(); },
    closeError: function () { S.error = null; paint(); },
    toggleCompare: function () { S.compare = !S.compare; paint(); },
    save: save,
    openReport: function () {
      S.reportOpen = true;
      setText('ai-render-report-msg', '');
      paint();
    },
    closeReport: function () { S.reportOpen = false; paint(); },
    sendReport: sendReport,
    revoke: function () {
      if (S.busy) return;
      clearConsent();
      S.consentOpen = false;
      // 失敗の表示(「もう一度」)を残すと、取り消した直後に押されて同意の画面に戻るだけになるので消す。
      S.error = null;
      paint();
      setText('ai-render-msg', MESSAGES.revoked);
    },
    // 検査と調べもの用(画面からは使わない)
    state: function () { return { busy: S.busy, hasResult: !!S.result, error: S.error ? S.error.text : null, left: S.left, consent: hasConsent() }; },
    _readRenderLeft: readRenderLeft,
    _pickAspect: pickAspect
  };
  window.AiRenderInApp = api;
})();
