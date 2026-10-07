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
    quotaBlocked: false,
    extractionMode: 'v1', // Session-only explicit choice; never persisted into plans.
  };

  // Session-local ownership. The comparison host owns the fixed-operation transport;
  // source evidence is never added to a persistent source archive.
  var importEpoch = 0, quotaVersion = 0, reviewOwner = null, activeContexts = new Set();
  var fallbackTarget = null, fallbackText = null, fallbackGeneration = 0;
  var transportContexts = new WeakMap(), transportTickets = new WeakMap();
  function targetOwner() {
    if (root._editorPaneDisposed || root._editorPlanInstalling) return null;
    if (root.EditorPane && root.EditorPane.importOwner) return root.EditorPane.importOwner();
    var data = typeof DATA === 'object' ? DATA : null;
    var text = JSON.stringify(data, function(key,value){return key === '_texObj' || key === 'viewState' && this === data ? undefined : value;});
    if (data !== fallbackTarget || text !== fallbackText) { fallbackGeneration++; fallbackTarget = data; fallbackText = text; }
    return { planId: root.__editorPlanId || null, generation: fallbackGeneration, snapshot: text };
  }
  function sourceKey() {
    return JSON.stringify([ST.fileName, ST.pages ? null : ST.image && ST.image.src || null, ST.pages, ST.pageReview, ST.pdfData, ST.pages ? null : ST.crop, ST.extractionMode]);
  }
  function captureContext(withSource) { return createContext(withSource, 'local'); }
  function createContext(withSource, kind, extraCurrent) {
    var owner = JSON.stringify(targetOwner()), epoch = importEpoch, version = ST.version, request = ST.requestVersion;
    var source = withSource === false ? null : sourceKey(), controller = typeof AbortController === 'function' ? new AbortController() : null;
    var cancelled = false, cancels = new Set(), networkSource = null, sequence = 0;
    var context = { signal: controller && controller.signal,
      isCurrent: function () { return !cancelled && epoch === importEpoch && version === ST.version && request === ST.requestVersion && owner !== 'null' && owner === JSON.stringify(targetOwner()) && (source === null || source === sourceKey()) && (networkSource === null || networkSource === sourceKey()) && (!extraCurrent || extraCurrent()); },
      cancel: function () { cancelled = true; if (controller) controller.abort(); cancels.forEach(function (fn) { fn(); }); cancels.clear(); activeContexts.delete(context); },
      delay: function (ms) { return new Promise(function (resolve) { var finish = function () { clearTimeout(timer); cancels.delete(finish); resolve(); }, timer = setTimeout(finish, ms); cancels.add(finish); }); },
      onCancel: function (fn) { cancels.add(fn);return function(){cancels.delete(fn);}; },
      done: function () { activeContexts.delete(context); },
      finish: function (body) { return requestOperation('finish', body, context); },
      retainFailedReply: function(body){if(activeContexts.has(context)&&context.isCurrent())ST.failedSceneResponse=body;}
    };
    transportContexts.set(context, { kind: kind, descriptor: function () {
      return {kind:kind,epoch:epoch,sourceVersion:version,requestVersion:request,target:owner,source:networkSource};
    }, ticket: function (operation,payload,signal) {
      if(kind !== 'quota' && networkSource === null) networkSource=sourceKey();
      return {operation:operation,body:payload === null ? null : JSON.stringify(payload),signal:signal || context.signal,sequence:++sequence,claimed:false};
    }});
    activeContexts.add(context); return context;
  }
  // Tickets are created only at the existing controller's network call sites.
  // The host consumes a real ticket once; an asserted pane/context ID is not enough.
  function transportContext(context) {
    var record=transportContexts.get(context);
    return record && activeContexts.has(context) && context.isCurrent() ? record.descriptor() : null;
  }
  function claimTransportRequest(context,ticket) {
    var intent=transportTickets.get(ticket),owner=transportContext(context);
    if(!owner || !intent || intent.context!==context || intent.claimed)return null;
    intent.claimed=true;
    return Object.assign({},owner,{operation:intent.operation,body:intent.body,signal:intent.signal,sequence:intent.sequence});
  }
  function requestOperation(operation,payload,context,signal) {
    if(!context || !context.isCurrent())return Promise.reject(new Error('Import owner is no longer current'));
    var record=transportContexts.get(context),intent=record.ticket(operation,payload,signal),ticket={};
    intent.context=context;transportTickets.set(ticket,intent);
    var result;
    try {
      if(root.EDITOR_PANE && root.parent && root.parent!==root && root.parent.PlanLibrary){
        result=root.parent.PlanLibrary.requestImportOperation(root.EDITOR_PANE,root,context,ticket);
      }else{
        var paths={quota:'/api/ai/quota',locate:'/api/ai/find-plan',read:'/api/ai/import-plan','read-result':'/api/ai/plan-result',revise:'/api/ai/revise-plan',finish:'/api/ai/finish-plan',register:'/api/ai/register-plan','register-result':'/api/ai/register-plan-result'};
        if(!Object.prototype.hasOwnProperty.call(paths,operation))throw Error('Import operation is unavailable');
        var options={signal:intent.signal};
        if(operation!=='quota'){options.method='POST';options.headers={'content-type':'application/json'};options.body=intent.body;}
        result=fetch(paths[operation],options);
      }
    }catch(error){result=Promise.reject(error);}
    return Promise.resolve(result).then(function(reply){transportTickets.delete(ticket);return reply;},function(error){transportTickets.delete(ticket);throw error;});
  }
  function bindReview(body) { reviewOwner = body ? { body: body, owner: JSON.stringify(targetOwner()), source: sourceKey(), epoch: importEpoch } : null; }
  function currentReview(body) {
    return !root._editorPaneDisposed && !(body && body.sourceInvalidated) && (!reviewOwner || reviewOwner.body === body && reviewOwner.epoch === importEpoch && reviewOwner.owner === JSON.stringify(targetOwner()) && reviewOwner.source === sourceKey());
  }
  function invalidateImport(options) {
    options = options || {}; importEpoch++; quotaVersion++;
    activeContexts.forEach(function (context) { context.cancel(); });
    ST.version++; ST.previewVersion++; ST.requestVersion++; ST.busy = false;ST.drag = null;
    if (root.PlanFinish && root.PlanFinish.invalidate) root.PlanFinish.invalidate();
    if (root.SceneReviewFlow) root.SceneReviewFlow.invalidate({ preserveReference: options.preserve === true });
    if (!options.preserve) { ST.originalImageSource = null; ST.image = null; ST.pages = null; ST.pdfData = null; ST.pageReview = null; ST.crop = null; ST.fileName = ''; ST.selectedPage = 0; ST.result = null; ST.failedSceneResponse = null; ST.mappingEditor = null; }
    if (!options.preserve) bindReview(null);
    syncPlanImportButtons();
  }
  function cancellationStatus() {
    if(ST.fileName&&!ST.pdfData&&!ST.originalImageSource&&!ST.image&&!ST.pages)return '原図の準備を取消しました。ファイル名だけを保持しています。再開するには元のファイルを選び直してください。';
    return '処理を取消しました。元の入力と完了した確認結果はこの作業内に保持しています。通信の取消は受付済みの処理・利用分を取り消しません。再開には確認または元のファイルの選び直しが必要です。';
  }
  function markChangedReviewSource(body) {
    if(body&&!body.sceneIR&&reviewOwner&&reviewOwner.body===body&&reviewOwner.source!==sourceKey())body.sourceInvalidated=true;
  }
  function revalidateReview() {
    var body = ST.result; if (!body) return;
    markChangedReviewSource(body);
    if(body.sourceInvalidated){bindReview(body);renderPlanImportResult(body);setStatus('原図または切り出しが変わったため、元の結果は照合用として保持しています。新しく読み取るまで取り込めません。');return;}
    if (body.importApplied || body.sceneApplied || body.scenePartialOpened || body.buildingApplied) {
      if(body.sceneIR){body.sceneCompilation=previewSceneIR(body.sceneIR,body.sceneOptions);body.sceneFullCompilation=body.sceneOptions.partialSelection?previewSceneIR(body.sceneIR,Object.assign({},body.sceneOptions,{partialSelection:null})):body.sceneCompilation;}
      bindReview(body);renderPlanImportResult(body);return;
    }
    if (body.sceneIR) {
      var opts = JSON.parse(JSON.stringify(body.sceneOptions));
      opts.acceptedReviews = []; opts.acceptedReviewGroups = []; opts.reviewedEntities = {}; opts.unresolvedDecisions = []; opts.extraction = body.extraction;
      stageSceneIR(body.sceneIR, opts);
    } else if (body.sourceLocal) {
      body.buildingSourceVersion = ST.version;
      body.buildingDecisions = {sourceSnapshot: PlanRegistration.snapshot(body.sourceLocal), floors: [], partialAcknowledged: false};
      body.fixtureDecisions = []; body.entryFloorDecisions = []; body.objectDecisions = []; body.stairDisplayDecisions = [];
      compileBuildingReview(body); bindReview(body); renderPlanImportResult(body);
    } else { bindReview(body); renderPlanImportResult(body); }
  }
  function captureImport() {
    if (ST.mappingEditor) throw Error('対応付けの入力を確定か取消してから画面を切り替えてください。確認中の入力は保持しています。');
    markChangedReviewSource(ST.result);
    var state = {};
    ['pages','pageReview','pdfData','originalImageSource','selectedPage','fileName','crop','result','failedSceneResponse','extractionMode'].forEach(function (key) { if (ST[key] !== undefined) state[key] = ST[key]; });
    state.imageSource = ST.pageReview ? null : ST.image && ST.image.src || ST.originalImageSource || null;
    return JSON.parse(JSON.stringify({ version: 1, state: state, reference: root.SceneReviewFlow && root.SceneReviewFlow.capture ? root.SceneReviewFlow.capture() : null,
      status: ST.busy ? cancellationStatus() : ($('plan-import-status') && $('plan-import-status').textContent || ''), modalOpen: !!($('plan-import-modal') && $('plan-import-modal').classList.contains && $('plan-import-modal').classList.contains('show')) }));
  }
  function restoreImport(memento) {
    invalidateImport();
    if (!memento || memento.version !== 1) { show('plan-import-step2',false);show('plan-import-step3',false);show('plan-import-pdf-review',false);var emptyModal=$('plan-import-modal');if(emptyModal)emptyModal.classList.remove('show');syncPlanImportButtons();return; }
    var state = JSON.parse(JSON.stringify(memento.state));
    Object.keys(state).forEach(function (key) { if (key !== 'imageSource') ST[key] = state[key]; });
    if (root.SceneReviewFlow && root.SceneReviewFlow.restore) root.SceneReviewFlow.restore(memento.reference);
    show('plan-import-step2', !!(state.imageSource || ST.pages)); show('plan-import-pdf-review', !!ST.pageReview);
    revalidateReview();
    if (state.imageSource && !ST.pageReview && typeof Image === 'function') {
      var context = captureContext(false), image = new Image(); ST.image = image;
      image.onload = function () { if (!context.isCurrent()) {context.done();return;}if(!ST.crop)ST.crop={x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};drawPlanImportPreview(); bindReview(ST.result); syncPlanImportButtons(); context.done(); };
      image.onerror = function () { if (context.isCurrent()) setStatus('原図のプレビューを復元できません。元の確認結果を保持しています。'); context.done(); }; image.src = state.imageSource;
    }
    if (ST.pageReview) selectPlanImportPage(ST.selectedPage);
    bindReview(ST.result); syncPlanImportButtons();
    if(memento.status)setStatus(memento.status);
    var modal = $('plan-import-modal'); if (modal) modal.classList.toggle('show', !!memento.modalOpen);
  }

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var e = $(id); if (e) e.style.display = on ? '' : 'none'; }

  function setStatus(text) {
    var e = $('plan-import-status');
    if (e) e.textContent = text;
    show('plan-import-error-details', false);
  }

  // ── 開く・閉じる ────────────────────────────────────────────────────
  function openPlanImport() {
    var m = $('plan-import-modal');
    if (!m) return;
    m.classList.add('show');
    if (!ST.image && !ST.pages && !ST.pdfData && !ST.originalImageSource && !ST.fileName && !ST.result && !ST.failedSceneResponse) resetPlanImport();
    else if (ST.result && !currentReview(ST.result)) revalidateReview();
    if (!ST.image && !ST.pages && (ST.pdfData || ST.originalImageSource || ST.fileName)) setStatus(ST.pdfData||ST.originalImageSource?'選択した元のPDF・画像はこの作業内に保持しています。ページの準備は取消済みです。再開するには元のファイルを選び直してください。自動の読み取りは行いません。':'原図の準備を取消しました。ファイル名だけを保持しています。再開するには元のファイルを選び直してください。自動の読み取りは行いません。');
    showQuota();
    if(root.SceneReviewFlow)root.SceneReviewFlow.mount();
  }

  // 本日あと何回使えるかを出す。
  //
  // **全体の上限がある**ので、自分が使っていなくても使えないことがある。
  // 押してから断られるより、押す前に分かっているほうがよい。
  function showQuota() {
    var box = $('plan-import-quota');
    if (!box) return;
    var token = ++quotaVersion, context = createContext(false, 'quota', function(){return token === quotaVersion;});
    function current() { return token === quotaVersion && context.isCurrent(); }
    requestOperation('quota', null, context).then(function (r) { if(root.EDITOR_PANE && !r.ok)throw Error('Import quota is unavailable');return r.json(); }).then(function (q) {
      if (!current()) return;
      ST.sceneIRV3Available = !!(q && q.sceneIRV3 && q.sceneIRV3.enabled === true);
      ST.quotaBlocked = !!(q && q.counted && q.left !== null && q.left !== undefined && q.left <= 0);
      syncPlanImportButtons();
      if (!q || !q.counted || q.left === null || q.left === undefined) { box.style.display = 'none'; return; }
      box.style.display = '';
      box.textContent = q.left > 0
        ? '本日あと ' + q.left + ' 回 読み取れます（1日に ひとり ' + q.perUser + ' 回まで／全体 ' + q.total + ' 回まで）'
        : '本日ぶんの読み取りを使い切りました。明日またお試しください。';
      var run = $('plan-import-run');
      if (run && q.left <= 0) run.disabled = true;
    }).catch(function () { if (!current()) return; ST.sceneIRV3Available = false; if(root.EDITOR_PANE){box.style.display='';box.textContent='残り回数を確認できませんでした。読み取りの利用可否はサーバの確認が必要です。';}else box.style.display = 'none'; syncPlanImportButtons(); }).then(context.done);
  }

  function closePlanImport() {
    if (ST.mappingEditor) { setStatus('対応付けの入力を確定か取消してから閉じてください。確認中の入力は保持しています。'); return false; }
    var wasBusy=ST.busy,cancelledStatus=cancellationStatus();
    invalidateImport({preserve: true});if(wasBusy)setStatus(cancelledStatus);
    if (ST.result && ST.result.sceneOptions) {
      ST.result.sceneOptions.acceptedReviews=[];ST.result.sceneOptions.acceptedReviewGroups=[];ST.result.sceneOptions.reviewedEntities={};ST.result.sceneOptions.unresolvedDecisions=[];
    }
    if (ST.result && ST.result.sourceLocal) ST.result.buildingDecisions={sourceSnapshot:PlanRegistration.snapshot(ST.result.sourceLocal),floors:[],partialAcknowledged:false};
    syncPlanImportButtons();
    var m = $('plan-import-modal'); if (m) m.classList.remove('show');
    cancelPlanImportDrag(); return true;
  }

  function resetPlanImport() {
    invalidateImport();
    var host = root.EDITOR_PANE ? root.parent && root.parent.PlanLibrary : root.PlanLibrary;
    if (host && host.resetImport) host.resetImport(root.EDITOR_PANE || root.NATIVE_EDITOR_PANE, root);
    ST.extractionMode = 'v1';
    ST.version++; ST.previewVersion++;
    ST.requestVersion++;
    ST.image = null; ST.pages = null; ST.fileName = '';
    ST.pageReview = null; ST.pdfData = null; ST.selectedPage = 0;
    ST.crop = null; ST.drag = null; ST.result = null; ST.busy = false; ST.mappingEditor = null;
    var f = $('plan-import-file'); if (f) f.value = '';
    show('plan-import-pdf-review', false);
    show('plan-import-step2', false);
    show('plan-import-step3', false);
    ['scene-ir-review','building-registration-review'].forEach(function(id){var old=$(id);if(old&&old.remove)old.remove();});
    ['scene-review-files','plan-import-result-details','plan-import-error-details'].forEach(function(id){var details=$(id);if(details)details.open=false;});
    ['plan-import-source-files','plan-import-step2'].forEach(function(id){var details=$(id);if(details)details.open=true;});
    var fileTitle=$('plan-import-file-title');if(fileTitle)fileTitle.textContent='図面を選ぶ（α版）';
    setStatus('');
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

  function locate(smallDataUrl, context) {
    if (context && !context.isCurrent()) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var controller=typeof AbortController==='function'?new AbortController():null;
      function cancel(){clearTimeout(timer);if(controller)controller.abort();resolve(null);}
      var timer=setTimeout(cancel,LOCATE_TIMEOUT_MS),detach=context?context.onCancel(cancel):function(){};
      requestOperation('locate', { image: smallDataUrl }, context, controller && controller.signal).then(function (res) { return res.ok ? res.json() : null; })
        .then(function (body) { clearTimeout(timer);detach();resolve(body || null); })
        .catch(function () { clearTimeout(timer);detach();resolve(null); });
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
    if (!targetOwner()) return;
    index = Number(index);
    if (ST.busy || !ST.pageReview || !Number.isInteger(index) || !ST.pageReview[index]) return;
    ST.selectedPage = index;
    setPdfReviewStatus();
    ST.image = null; ST.crop = null; ST.drag = null;
    var c = $('plan-import-canvas');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    var version = ST.version, previewVersion = ++ST.previewVersion, context = captureContext(false);
    var page = ST.pageReview[index], img = new Image();
    syncPlanImportButtons();
    img.onload = function () {
      if (!context.isCurrent() || version !== ST.version || previewVersion !== ST.previewVersion) {context.done();return;}
      ST.image = img;
      var b = page.box || { x0: 0, y0: 0, x1: 1, y1: 1 };
      ST.crop = { x: b.x0 * img.naturalWidth, y: b.y0 * img.naturalHeight,
        w: (b.x1 - b.x0) * img.naturalWidth, h: (b.y1 - b.y0) * img.naturalHeight };
      drawPlanImportPreview();
      syncPlanImportButtons(); context.done();
    };
    img.onerror = function () {
      if (!context.isCurrent() || version !== ST.version || previewVersion !== ST.previewVersion) {context.done();return;}
      page.confirmed = false;
      page.status = '要確認'; page.message = 'プレビューを開けません。ファイルを選び直してください。';
      setPdfReviewStatus();
      syncPlanImportButtons(); context.done();
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
    if (!targetOwner() || !ST.pageReview || !ST.image || !ST.crop || ST.busy) return;
    var index = ST.selectedPage, page = ST.pageReview[index], version = ST.version, context = captureContext(false);
    var box = { x0: ST.crop.x / ST.image.naturalWidth, y0: ST.crop.y / ST.image.naturalHeight,
      x1: (ST.crop.x + ST.crop.w) / ST.image.naturalWidth,
      y1: (ST.crop.y + ST.crop.h) / ST.image.naturalHeight };
    if (box.x0 === 0 && box.y0 === 0 && box.x1 === 1 && box.y1 === 1) {
      context.done();planImportSelectAll(); return;
    }
    page.confirmed = false;
    ST.result = null; ST.mappingEditor = null; ST.busy = true;
    show('plan-import-step3', false);
    page.status = '切り出し中'; page.message = '選んだ範囲をPDFから描き直しています。';
    syncPlanImportButtons();
    return Promise.resolve().then(function () {
      if (!context.isCurrent() || version !== ST.version) return null;
      return PdfPages.renderRegion(ST.pdfData, page.sourceIdentity ? page.sourceIdentity.pageNumber : index + 1, box, { maxPx: MAX_SEND_PX });
    }).then(function (cropped) {
      if (!context.isCurrent() || version !== ST.version) return;
      if (!cropped) throw new Error('empty crop');
      ST.pages[index] = cropped; page.box = box; page.confirmed = true;
      if (page.sourceIdentity) page.sourceIdentity = PlanSourceIdentity.cropPage(page.sourceIdentity, box, cropped);
      page.status = '手動で切り出し済み'; page.message = '選んだ範囲を読み取ります。';
    }).catch(function () {
      if (!context.isCurrent() || version !== ST.version) return;
      ST.pages[index] = page.source; page.box = null; page.confirmed = false;
      if (page.sourceIdentity) page.sourceIdentity = PlanSourceIdentity.cropPage(page.sourceIdentity, null, page.source);
      page.status = '要確認'; page.message = '切り出しに失敗しました。囲み直すか、ページ全体を確認してください。';
    }).then(function () {
      if (!context.isCurrent() || version !== ST.version) return;
      ST.busy = false;
      selectPlanImportPage(index);
    }).then(context.done);
  }

  // ── 1. 画像を選ぶ ──────────────────────────────────────────────────
  function onPlanImportFile(input) {
    if (!targetOwner()) return;
    var file = input && input.files && input.files[0];
    if (!file) return;
    resetPlanImport();
    ST.fileName = file.name || '';
    var version = ST.version, sourceVersion = ST.requestVersion;
    var context = createContext(false, 'locate');
    function current() { return context.isCurrent() && version === ST.version && sourceVersion === ST.requestVersion; }
    function fail(message) {
      if (!current()) {context.done();return;}
      ST.busy = false; setStatus(message); syncPlanImportButtons(); context.done();
    }
    ST.busy = true;
    syncPlanImportButtons();

    // PDFはページ全体と切り出し結果を別々に持ち、失敗したページを確認できる。
    if (file.type === 'application/pdf' || /\.pdf$/i.test(ST.fileName)) {
      var pdfReader = new FileReader();
      pdfReader.onload = function (e) {
        if (!current()) {context.done();return;}
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
            return locate((smalls && smalls[i]) || page, context);
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
          selectPlanImportPage(0); context.done();
        }).catch(function (err) {
          fail('PDFを開けませんでした: ' + (err && err.message ? err.message : err));
        }).then(context.done);
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
      if (!current()) {context.done();return;}
      ST.originalImageSource = e.target.result;
      var img = new Image();
      img.onload = function () {
        if (!current()) {context.done();return;}
        ST.image = img; ST.busy = false; context.done();
        ST.crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        show('plan-import-step2', true);
        show('plan-import-crop', true);
        drawPlanImportPreview();
        setStatus('');
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
    if(ST.result&&!ST.result.sceneIR)ST.result.sourceInvalidated=true;
    invalidateImport({preserve:true});
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
    var drag=ST.drag;
    // 指が滑っただけの極小の矩形は、選び直しとみなして捨てる。
    if (drag.w > 20 && drag.h > 20) {
      invalidateScenePlacement();
      ST.crop = { x: drag.x, y: drag.y, w: drag.w, h: drag.h };
      if (ST.pageReview) cropPlanImportPage();
    }
    ST.drag = null;
    if(ST.result&&ST.result.sceneIR&&ST.result.sceneIR.sceneVersion===2)revalidateReview();
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
    // Local v2 JSON evidence is independent of this optional source-image crop.
    // Recompile with fresh approvals; pending work still owns the retired epoch.
    if(ST.result&&ST.result.sceneIR&&ST.result.sceneIR.sceneVersion===2)revalidateReview();
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
    var sourceMode = ST.extractionMode === 'scene-ir-v3';
    var available = root.SCENE_IR_V3_IMAGE_IMPORT === true && ST.sceneIRV3Available === true;
    var singleImage = !ST.pages || ST.pages.length === 1;
    var mode = $('plan-import-mode'), sourceOption = $('plan-import-source-mode');
    show('plan-import-mode-wrap', available || sourceMode);
    if (mode) { mode.value = sourceMode ? 'scene-ir-v3' : 'v1'; mode.disabled = ST.busy; }
    if (sourceOption) sourceOption.disabled = !available || !singleImage;
    var note = $('plan-import-mode-note');
    if (note) note.textContent = sourceMode
      ? (!available ? '実験の読み取りは現在使えません。従来の下書きを使う場合は選び直してください。'
        : !singleImage ? '実験の読み取りは図面1枚に対応しています。従来の下書きを使う場合は選び直してください。'
        : '実験中です。図面1枚の読み取れた情報を確認し、選んだ部分だけ取り込みます。補足は使いません。失敗しても自動で読み直しません。')
      : (!singleImage ? '複数ページは従来の下書きで読み取ります。実験の読み取りは図面1枚に対応しています。'
        : '元図の情報を確認する読み取りも試せます（実験・図面1枚）。失敗しても自動で読み直しません。');
    var hint = $('plan-import-hint'); if (hint) hint.disabled = sourceMode || ST.busy;
    if (run) run.disabled = (!ST.image && !ST.pages) || ST.busy || !!ST.drag || pendingPdfPages() > 0 || ST.quotaBlocked || (sourceMode && (!available || !singleImage));
    show('plan-import-run-actions', !!(ST.image || ST.pages));
    if (run && run.classList && run.classList.toggle) run.classList.toggle('sec', !!ST.result);
    syncPdfReview();

    var apply = $('plan-import-apply');
    if (apply) apply.disabled = !!(ST.result && !currentReview(ST.result)) || !!ST.mappingEditor || !ST.result || ST.busy || !!(ST.result && (ST.result.importApplied||ST.result.buildingApplied||ST.result.sceneApplied||ST.result.scenePartialOpened)) || !!(ST.result.sceneCompilation && !ST.result.sceneCompilation.canApply) || !!(ST.result && ST.result.sourceLocal && (!ST.result.buildingCompilation || !ST.result.buildingCompilation.canApply));
    var sceneReview = $('scene-ir-review');
    if (sceneReview && typeof sceneReview.querySelectorAll === 'function' && ST.result && (ST.result.sceneApplied || ST.result.scenePartialOpened)) {
      Array.prototype.forEach.call(sceneReview.querySelectorAll('[data-scene-review-control]'), function (control) { control.disabled = true; });
    }
    var size = $('plan-import-crop-size');
    if (size && ST.crop) {
      var pdfCrop = ST.pageReview && ST.pageReview[ST.selectedPage].box;
      var scale = pdfCrop ? MAX_SEND_PX / Math.max(ST.crop.w, ST.crop.h)
        : Math.min(1, MAX_SEND_PX / Math.max(ST.crop.w, ST.crop.h));
      size.textContent = '送る範囲: ' + Math.round(ST.crop.w) + '×' + Math.round(ST.crop.h) +
        ' 画素 → ' + Math.round(ST.crop.w * scale) + '×' + Math.round(ST.crop.h * scale) +
        (pdfCrop ? ' にPDFから描き直して送信' : ' に縮めて送信');
    }
    syncPlanImportResultUi();
  }

  // Presentation only: compiler/ownership/Apply gates remain authoritative.
  function syncPlanImportResultUi() {
    var body = ST.result, notice = $('plan-import-result-state'), next = $('plan-import-next'), apply = $('plan-import-apply');
    if (!body) { if (notice) notice.textContent = ''; if (next) next.style.display = 'none'; return; }
    var scene = body.sceneCompilation, full = body.sceneFullCompilation || scene, building = body.buildingCompilation;
    var blocked = !apply || apply.disabled, partial = !!(scene && scene.partialSelection), stale = !!(body.sourceInvalidated || body.sceneOptions && body.sceneOptions.sourceInvalidated || !currentReview(body));
    var errors = full ? full.diagnostics.filter(function(d){return d.severity === 'error';}).length : building ? building.diagnostics.filter(function(d){return d.severity === 'error';}).length : 0;
    var unresolved = full ? full.unresolvedEntities.length : errors;
    var review = scene ? scene.reviewGroups.filter(function(g){return g.reviewPaths.length && !g.accepted;}).length : 0;
    var messages = [];
    if (body.importApplied || body.buildingApplied || body.sceneApplied || body.scenePartialOpened) messages.push('取り込み済み');
    else if (ST.mappingEditor) messages.push('対応付けを確定か取消してください');
    else if (stale) messages.push('図面・編集先が変わりました。再確認が必要です');
    else if (partial) messages.push('部分プレビュー（未完成）', '全体の未解決 ' + unresolved + ' 件');
    else if (body.sourceLocal && body.sourceLocal.floors.length > 1) messages.push('部分取り込み。階段の接続・床開口・屋根は未検証');
    else if (scene && /^incomplete/.test(scene.reconstructionStatus || '')) messages.push('未完成。一部は原図の情報のみ');
    if (scene && (scene.acknowledgedOmissions || []).length) messages.push('未配置 ' + scene.acknowledgedOmissions.length + ' 件');
    if (scene && !partial) messages.push('未解決 ' + unresolved + ' 件' + (review ? ' / 要確認 ' + review + ' 件' : ''));
    if (building && errors) messages.push('未解決 ' + errors + ' 件');
    if (!scene && !building) {
      var memos = (body.notes || []).concat(body.warnings || [], body.finish && body.finish.warnings || []);
      var count = memos.filter(function(v,i){return memos.indexOf(v) === i;}).length;
      if (count) messages.push('読み取りメモ ' + count + ' 件');
    }
    if (blocked && !ST.mappingEditor && !stale && !(body.importApplied || body.buildingApplied || body.sceneApplied || body.scenePartialOpened)) messages.push('まだ取り込めません');
    if (notice) notice.textContent = messages.join('。');
    if (apply) {
      apply.textContent = partial ? '部分プレビューを開く' : body.sourceLocal && body.sourceLocal.floors.length > 1 ? '部分的に取り込む' : '取り込む';
      if (apply.classList && apply.classList.toggle) apply.classList.toggle('sec', blocked);
    }
    if (next) {
      next.style.display = blocked && !ST.busy && !ST.mappingEditor && !(body.importApplied || body.buildingApplied || body.sceneApplied || body.scenePartialOpened) ? '' : 'none';
      next.textContent = stale ? '再確認する' : '確認する箇所を見る';
    }
  }

  function focusSceneReviewGroup(groupId) {
    var body = ST.result, box = $('scene-ir-review');
    if (!body || !box || !currentReview(body) || ST.mappingEditor || ST.busy) return false;
    var search = box.querySelector('[data-scene-review-search]'), filter = box.querySelector('[data-scene-review-filter]');
    if (search) { search.value = ''; search.dispatchEvent(new Event('input', {bubbles:true})); }
    if (filter) { filter.value = 'all'; filter.dispatchEvent(new Event('change', {bubbles:true})); }
    var groups = box.querySelectorAll('[data-scene-group]'), target = null;
    Array.prototype.forEach.call(groups, function(node){if(node.getAttribute('data-scene-group') === groupId) target = node;});
    if (!target) target = box.querySelector('[data-scene-audit]') || box;
    if(target.hasAttribute&&target.hasAttribute('data-scene-audit')){var errors=target.querySelector('[data-scene-full-errors]');if(errors&&errors.parentNode)errors.parentNode.open=true;}
    for (var parent = target; parent && parent !== box; parent = parent.parentNode) if (parent.tagName === 'DETAILS') parent.open = true;
    target.hidden = false;
    if (target !== box && target.tagName === 'DETAILS') { target.open = true; target.dispatchEvent(new Event('toggle')); }
    var title = target.querySelector('summary') || target; title.setAttribute('tabindex','-1');
    if (title.focus) title.focus(); if (target.scrollIntoView) target.scrollIntoView({block:'nearest'});
    return true;
  }

  function focusReviewIssue() {
    var body = ST.result; if (!body || ST.busy || ST.mappingEditor) return false;
    if (body.sceneCompilation) {
      var compiled = body.sceneFullCompilation || body.sceneCompilation;
      var issue = compiled.diagnostics.find(function(d){return d.severity === 'error';});
      var group = issue && compiled.reviewGroups.find(function(g){return issue.path === g.path || (issue.path || '').indexOf(g.path + '.') === 0;});
      if (!group) group = body.sceneCompilation.reviewGroups.find(function(g){return g.reviewPaths.length && !g.accepted;});
      if (focusSceneReviewGroup(group && group.id)) return true;
    }
    var target = body.sourceLocal ? $('building-registration-review') : $('plan-import-step2');
    if (target) {
      target.open = true;
      var title = target.querySelector && target.querySelector('summary') || target; title.setAttribute('tabindex','-1');
      if (title.focus) title.focus(); if (target.scrollIntoView) target.scrollIntoView({block:'nearest'}); return true;
    }
    return false;
  }

  // ── 3. 読み取る ────────────────────────────────────────────────────
  // UI can opt in after both capabilities are available; no automatic retry/fallback.
  function setPlanImportExtractionMode(mode) {
    if (ST.busy || (mode !== 'v1' && mode !== 'scene-ir-v3')) { syncPlanImportButtons(); return false; }
    if (mode === 'scene-ir-v3' && (root.SCENE_IR_V3_IMAGE_IMPORT !== true || ST.sceneIRV3Available !== true || (ST.pages && ST.pages.length !== 1))) { syncPlanImportButtons(); return false; }
    ST.extractionMode = mode;
    syncPlanImportButtons();
    return true;
  }

  function runPlanImport(options) {
    var explicitContract = options && Object.prototype.hasOwnProperty.call(options, 'extractionContract')
      && options.extractionContract !== null && options.extractionContract !== undefined && options.extractionContract !== '';
    var contract = explicitContract ? options.extractionContract : (ST.extractionMode === 'scene-ir-v3' ? 'scene-ir-v3' : undefined);
    if ((explicitContract || contract) && (contract !== 'scene-ir-v3' || (root.SCENE_IR_V3_IMAGE_IMPORT !== true || ST.sceneIRV3Available !== true))) {
      setStatus('この実験的な読み取り方式は有効になっていません。'); return;
    }
    if (!targetOwner() || ST.busy || ST.drag || pendingPdfPages() > 0) return;
    var version = ST.version;
    // PDFはページごとの画像、画像は切り出して(囲んでいなければ全体を)送る。
    var images = ST.pages ? ST.pages.slice() : (function () { var one = croppedDataUrl(); return one ? [one] : []; }());
    if (!images.length) return;
    if (contract && images.length !== 1) { setStatus('この読み取り方式は図面1枚に対応しています。旧方式を使う場合は明示的に選び直してください。'); return; }
    var requestVersion = ++ST.requestVersion, context = createContext(true, 'read');
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
    return requestOperation('read', requestBody, context).then(readReply).then(function (r) {
      if (!context.isCurrent() || version !== ST.version || requestVersion !== ST.requestVersion) return null;
      return waitForJobs(r, { context: context, extractionContract: contract || null, isCurrent: function () { return context.isCurrent() && version === ST.version && requestVersion === ST.requestVersion; }, onProgress: function (done, total) {
        if (!context.isCurrent() || version !== ST.version || requestVersion !== ST.requestVersion) return;
        setStatus('読み取っています… ' + done + ' / ' + total + ' 枚が終わりました。');
      } });
    }).then(function (r) {
      if (!context.isCurrent() || version !== ST.version || requestVersion !== ST.requestVersion || !r) return;
      if(unexpectedImportContract(r.body,contract,r.status===200)){
        ST.failedSceneResponse=r.body;ST.busy=false;showPlanImportError(409,{error:'ai_extraction_contract_mismatch'});syncPlanImportButtons();return;
      }
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
        if (root.SCENE_IR_V3_IMAGE_IMPORT !== true || ST.sceneIRV3Available !== true) {
          ST.failedSceneResponse = r.body;
          setStatus('読み取り方式が無効になったため取り込みを停止しました。返答は保持し、自動で読み直すことはありません。');
          syncPlanImportButtons(); showQuota(); return;
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
      return maybeRevisePlanImport(images, hint, r.body, version, context).then(function (body) {
        if (!context.isCurrent() || version !== ST.version || requestVersion !== ST.requestVersion) return;
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
          ? Promise.resolve(null) : PlanFinish.analyze(body.plan, body.marks, context);
        return finish.then(function (out) {
          if (!context.isCurrent() || version !== ST.version || requestVersion !== ST.requestVersion) return;
          if (!currentSource()) { ST.busy = false; setStatus('元ページまたは切り出しが変わりました。読み直してください。'); syncPlanImportButtons(); return; }
          body.finish = out;
          ST.busy = false;
          ST.result = body; bindReview(body);
          renderPlanImportResult(body);
          syncPlanImportButtons();
          showQuota();
        });
      });
    }).catch(function () {
      if (!context.isCurrent() || version !== ST.version || requestVersion !== ST.requestVersion) return;
      ST.busy = false;
      setStatus('サーバに接続できませんでした。通信の状態を確かめて、もう一度お試しください。');
      syncPlanImportButtons();
      showQuota();
    }).then(context.done);
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
  function unexpectedImportContract(body, expected, required) {
    if(!body)return !!expected && required;
    if(Object.prototype.hasOwnProperty.call(body,'extractionContract'))return body.extractionContract!==expected;
    return !!expected && required || !expected && !!body.sceneIR;
  }
  function waitForJobs(first, opts) {
    opts = opts || {};
    if (first.status !== 200 || !first.body || !first.body.jobs) return Promise.resolve(first);
    if (Object.prototype.hasOwnProperty.call(opts,'extractionContract') && unexpectedImportContract(first.body,opts.extractionContract || undefined,true)) return Promise.resolve(first);
    var jobs = first.body.jobs;
    var extractionContract = first.body.extractionContract;
    var until = Date.now() + JOB_TIMEOUT_MS;
    function once() {
      if (opts.isCurrent && !opts.isCurrent()) return null;
      if (opts.isCancelled && opts.isCancelled()) return null;
      if (Date.now() > until) return { status: 504, body: null };
      var pollBody = { jobs: jobs, revised: Boolean(opts.revised) };
      if (extractionContract) pollBody.extractionContract = extractionContract;
      return requestOperation('read-result', pollBody, opts.context).then(readReply).then(function (r) {
        if (opts.isCurrent && !opts.isCurrent()) return null;
        if (Object.prototype.hasOwnProperty.call(opts,'extractionContract') && unexpectedImportContract(r.body,opts.extractionContract || undefined,r.status===200)) return r;
        if (extractionContract && (!r.body || r.body.extractionContract !== extractionContract)) return r;
        if (r.status !== 200 || !r.body || !r.body.pending) return r;
        if (opts.onProgress) opts.onProgress(r.body.done, r.body.total);
        return (opts.context ? opts.context.delay(JOB_POLL_MS) : delay(JOB_POLL_MS)).then(once);
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
  function maybeRevisePlanImport(images, hint, body, version, context) {
    if (body && (body.extractionContract === 'scene-ir-v3' || body.sceneIR)) return Promise.resolve(body);
    var advice = body && body.revise;
    if (!advice || !advice.skipAll) return revisePlanImport(images, hint, body, version, context);
    body.reviewSkipped = true;
    return Promise.resolve(body);
  }

  function revisePlanImport(images, hint, body, version, context) {
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

    if (context && !context.isCurrent()) return Promise.resolve(null);
    setStatus('読み取った間取りを描き起こして、AIに見直させています… 30秒ほどかかります。');
    return requestOperation('revise', Object.assign({ images: images, renders: renders, pages: pages, hint: hint }, body.sourcePages ? { sourcePages: body.sourcePages } : {}), context).then(readReply).then(function (r) {
      if (context && !context.isCurrent() || version !== ST.version) return null;
      return waitForJobs(r, { context: context, revised: true, extractionContract: null, isCurrent: function () { return (!context || context.isCurrent()) && version === ST.version; }, onProgress: function (done, total) {
        if (context && !context.isCurrent() || version !== ST.version) return;
        setStatus('AIに見直させています… ' + done + ' / ' + total + ' 枚が終わりました。');
      } });
    }).then(function (r) {
      if (context && !context.isCurrent() || version !== ST.version || !r) return body;
      if(unexpectedImportContract(r.body,undefined,r.status===200)){
        ST.failedSceneResponse=r.body;return {error:'ai_extraction_contract_mismatch'};
      }
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
    }).catch(function (error) {
      if (context && !context.isCurrent()) return null;
      if(error && error.name==='AbortError')return {error:'ai_import_context_mismatch'};
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
      ai_import_context_mismatch: '原図・確認対象または受付番号が一致しないため停止しました。現在の入力を保持し、自動の読み直しは行いません。',
      ai_extraction_contract_mismatch: '読み取り方式と返答が一致しません。元の返答を保持し、自動で読み直したり別の方式へ切り替えずに停止しました。',
      scene_ir_v3_job_mismatch: '読み取り方式が更新されたため、この結果は現在の方式では取り込めません。保存済みプランは変更していません。自動で読み直すことはありません。読み直す場合は新しいAPI呼び出しになり、利用回数・費用が発生する可能性があります。',
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
    var shortNext = {recrop_tighter:'図面だけを囲み直してください',recrop_wider:'寸法線まで囲んでください',single_page:'1ページずつお試しください',better_scan:'鮮明な画像を選んでください',not_a_floorplan:'平面図を選んでください',too_complex:'この形は自動読み取り未対応です',retry:'もう一度お試しください'};
    var shortText = code === 'ai_quota_exceeded' ? text : text.split('。')[0] + '。';
    if (code === 'scene_ir_v3_job_mismatch') shortText = '旧方式の結果は取り込めません。自動では読み直しません。再読み取りは新しいAI処理です（回数・料金を消費する場合があります）';
    if (body && shortNext[body.next]) shortText += shortNext[body.next];
    else if (code === 'ai_invalid_plan' || code === 'ai_bad_response') shortText += '図面だけを囲み直してください';
    setStatus(shortText);
    var sourceSettings=$('plan-import-step2');if(sourceSettings)sourceSettings.open=false;
    var sourceFiles=$('plan-import-source-files');if(sourceFiles)sourceFiles.open=false;
    var fileTitle=$('plan-import-file-title');if(fileTitle)fileTitle.textContent='別の図面';
    var errorDetails = $('plan-import-error-details'), errorNotes = $('plan-import-error-notes');
    if (errorNotes) errorNotes.textContent = text;
    if (errorDetails && errorNotes && text !== shortText) { errorDetails.open = false; show('plan-import-error-details', true); }
  }

  function renderPlanImportResult(body) {
    if (ST.result === body && (!reviewOwner || !root.EditorPane && reviewOwner.body !== body)) bindReview(body);
    var applyButton = $('plan-import-apply');
    if (applyButton) applyButton.disabled = !currentReview(body) || !!ST.mappingEditor || !!(body.importApplied||body.sceneApplied||body.buildingApplied||body.scenePartialOpened) || !!(body.sceneCompilation && !body.sceneCompilation.canApply) || !!(body.sourceLocal && (!body.buildingCompilation || !body.buildingCompilation.canApply));
    var s = body.summary || {};
    setStatus('');
    var sourceSettings = $('plan-import-step2'); if (sourceSettings) sourceSettings.open = false;
    var sourceFiles = $('plan-import-source-files'); if (sourceFiles) sourceFiles.open = false;
    var fileTitle = $('plan-import-file-title'); if (fileTitle) fileTitle.textContent = '別の図面';
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
    var costDetail = $('plan-import-cost-detail'); if (costDetail) costDetail.textContent = '';
    if (cost) {
      var u = body.usage;
      if (u && u.inputTokens) {
        // 単価は gpt-6-astra（$10 / $50 per 1M）。$1=¥150 と置いた概算。
        // **モデルを替えたらここも替える。** 実際より安く見えるのが一番まずい。
        var yen = (u.inputTokens / 1e6 * 10 + u.outputTokens / 1e6 * 50) * 150;
        cost.textContent = '費用: 約 ' + yen.toFixed(1) + '円';
        if (costDetail) costDetail.textContent = '入力 ' + u.inputTokens + ' / 出力 ' + u.outputTokens
          + (u.thoughtTokens ? '（うち思考 ' + u.thoughtTokens + '）' : '') + ' トークン。換算レート・単価に基づく概算です。';
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
    renderLegacyImportPreview(body);
    if(root.SceneReviewFlow)root.SceneReviewFlow.render(body);
    show('plan-import-step3', true);
    syncPlanImportResultUi();
  }

  function renderLegacyImportPreview(body) {
    var old=$('plan-import-legacy-preview');if(old&&old.remove)old.remove();
    var host=$('plan-import-review');
    if(!host||body.sceneCompilation||body.sourceLocal||!body.pages||!body.pages.length||typeof PlanReviewDraw==='undefined')return;
    var details=document.createElement('details');details.id='plan-import-legacy-preview';details.className='plan-import-disclosure';
    var title=document.createElement('summary');title.textContent='プレビュー';details.appendChild(title);host.appendChild(details);
    var drawn=false;
    details.addEventListener('toggle',function(){
      if(!details.open||drawn||ST.result!==body)return;drawn=true;
      var note=document.createElement('p');note.className='airx-source-note';note.textContent='読み取り直後の図面（モデル差し替え前）';details.appendChild(note);
      body.pages.forEach(function(page,index){
        var url=null;try{url=PlanReviewDraw.drawPage(page);}catch(_){return;}
        if(!url)return;var image=document.createElement('img');image.src=url;image.alt=(index+1)+'ページの読み取りプレビュー';image.style.maxWidth='100%';details.appendChild(image);
      });
    });
  }

  function syncBuildingNotice() {
    var notice=$('building-registration-notice'); if(!notice)return;
    var reports=typeof DATA==='object' && DATA ? (DATA.sceneReconstructionReports||[]).filter(function(r){return r.kind==='building-registration' && r.status==='partial-building-assembly';}) : [];
    notice.hidden=!reports.length;
    var details=$('building-registration-notice-detail');if(!details)return;
    var text=reports.map(function(r){var floors=(r.sourceLocal&&r.sourceLocal.floors||[]).map(function(f){return f.floor+'階';}).join('・');return floors+': 取り込み時に階段部材 '+(r.deferredItems||[]).length+' 点を未配置として保持。階高・階段の接続・床の開口・屋根は未検証です。高さは表示既定値を使用。元の図面・UP/DNの印・判断の記録は保存データに残っています。';}).join('\n');
    var unresolvedDoors=(DATA.items||[]).filter(function(it){return it.sourceOpeningMapping&&it.sourceOpeningMapping.status==='unresolved';});if(unresolvedDoors.length)text+='\n建具 '+unresolvedDoors.length+' 点の向き・機構は未確認です。壁のある側へ自動反転しません。建具を選び、既存の位置・反転・引く向き設定と、開いた3Dの支持壁を確認してください。';
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
    body.fixtureDecisions=[];body.entryFloorDecisions=[];body.objectDecisions=[];body.stairDisplayDecisions=[];
    ST.result = body; bindReview(body);
    compileBuildingReview(body);
    renderPlanImportResult(body);
    syncPlanImportButtons();
    return body.buildingCompilation;
  }
  function requestBuildingRegistration(body) {
    if (!currentReview(body) || ST.result !== body || ST.busy || body.importApplied || body.buildingApplied || !body.sourceLocal || !ST.pages || ST.pages.length < 2) return;
    var version=ST.version, requestVersion=++ST.requestVersion, sourceSnapshot=PlanRegistration.snapshot(body.sourceLocal);
    var registrationContract=null,context=createContext(true,'register',function(){return currentReview(body)&&ST.result===body&&PlanRegistration.snapshot(body.sourceLocal)===sourceSnapshot;});
    ST.busy=true;
    invalidateFixtureReview(body);
    body.buildingDecisions={sourceSnapshot:sourceSnapshot,floors:[],partialAcknowledged:false};
    syncPlanImportButtons();
    setStatus('全ページの位置合わせを追加で読み取っています。結果は確認前の提案です。');
    function current(){return context.isCurrent() && currentReview(body) && ST.result===body && ST.version===version && ST.requestVersion===requestVersion && PlanRegistration.snapshot(body.sourceLocal)===sourceSnapshot;}
    function post(operation,payload){if(!current())return Promise.resolve(null);return requestOperation(operation,payload,context).then(readReply).then(function(reply){
      if(!current())return null;
      var explicit=reply.body&&Object.prototype.hasOwnProperty.call(reply.body,'registrationContract');
      if(explicit&&reply.body.registrationContract!=='building-registration-v1'||registrationContract&&(reply.status===200||reply.status===202)&&(!explicit||reply.body.registrationContract!==registrationContract)){
        ST.failedSceneResponse=reply.body;return {status:409,body:{message:'位置合わせの方式と返答が一致しません。元の返答を保持し、自動で読み直さずに停止しました。'}};
      }
      if(explicit)registrationContract=reply.body.registrationContract;return reply;
    });}
    function poll(reply){
      if(!current() || !reply) return null;
      if(reply.status!==202) return reply;
      return context.delay(3000).then(function(){
        if(!current())return null;
        return post('register-result',{jobs:reply.body.jobs,sourceLocal:body.sourceLocal,sourceSnapshot:sourceSnapshot}).then(poll);
      });
    }
    return post('register',{images:ST.pages.slice(),sourceLocal:body.sourceLocal,sourceSnapshot:sourceSnapshot}).then(poll).then(function(reply){
      if(!current() || !reply)return;
      ST.busy=false;
      if(reply.status!==200 || !reply.body || reply.body.sourceSnapshot!==sourceSnapshot || !reply.body.buildingRegistration){
        setStatus(reply.body && reply.body.message || '位置合わせの提案を取得できませんでした。元の図面と未確認状態を保持しています。');syncPlanImportButtons();return;
      }
      body.buildingRegistration=JSON.parse(JSON.stringify(reply.body.buildingRegistration));
      body.originalBuildingRegistration=JSON.parse(JSON.stringify(reply.body.buildingRegistration));
      body.registrationExtraction={rawResponse:reply.body.rawResponse || null,usage:reply.body.usage || null};
      compileBuildingReview(body);renderPlanImportResult(body);syncPlanImportButtons();
    }).catch(function(){if(current()){ST.busy=false;setStatus('位置合わせの通信に失敗しました。未確認のまま保持しています。');syncPlanImportButtons();}}).then(context.done);
  }
  // Catalogue mapping is a reviewed display decision, never a rewrite of source readings.
  function bathtubCandidates(body) {
    var local=body&&body.sourceLocal,model=typeof getFmpItem==='function'&&getFmpItem('original-bathtub');
    if(!local||!model)return [];
    var candidates=[];
    (local.items||[]).forEach(function(it,index){
      if(it.type!=='bath'||![it.x,it.y,it.w,it.d].every(Number.isFinite))return;
      var marks=(local.marks||[]).map(function(m,i){return {mark:m,index:i};}).filter(function(e){var m=e.mark;return m.guess==='bathtub'&&m.floor===it.floor&&[m.x,m.y,m.w,m.d].every(Number.isFinite)&&m.w>0&&m.d>0&&Math.abs(m.x-it.x)<=it.w/2&&Math.abs(m.y-it.y)<=it.d/2;});
      if(marks.length===1)candidates.push({itemIndex:index,markIndex:marks[0].index,item:it,mark:marks[0].mark,modelId:'original-bathtub',modelHeightMm:Number(model.h)||600});
    });
    return candidates.filter(function(c){return candidates.filter(function(other){return other.markIndex===c.markIndex;}).length===1;});
  }
  function invalidateFixtureReview(body) {
    if(!(body.fixtureDecisions||[]).length&&!(body.entryFloorDecisions||[]).length&&!(body.objectDecisions||[]).length&&!(body.stairDisplayDecisions||[]).length)return;
    body.fixtureDecisions=[];body.entryFloorDecisions=[];body.objectDecisions=[];body.stairDisplayDecisions=[];
    body.fixtureReviewNotice='元図面・階数・位置合わせの確認が変わりました。浴槽・玄関土間・家具と柵の対応付けを解除しました。再確認して選択してください。';
    var box=$('building-registration-review');
    if(box){box.querySelectorAll('[data-source-entry-floor], [data-source-bathtub], [data-source-object], [data-source-image-rail], [data-source-stair]').forEach(function(check){if(check.tagName==='SELECT')check.value='';else check.checked=false;});}
    setStatus(body.fixtureReviewNotice);
  }
  function entryFloorCandidates(body) {
    var plan=body&&body.buildingCompilation&&body.buildingCompilation.plan;
    if(!plan||!body.sourceLocal||typeof newRoomFloorRaiseMm!=='function')return [];
    return (plan.rooms||[]).filter(function(r){return r.use==='entry'&&r.floor===1&&newRoomFloorRaiseMm(r.floor)>0;}).map(function(r){return {room:r,key:JSON.stringify([r.floor,r.n,r.x,r.y,r.w,r.d]),ordinaryRaiseMm:newRoomFloorRaiseMm(r.floor),entryRaiseMm:0};});
  }
  function mapReviewedReaderOpenings(plan,body) {
    var out=Object.assign({},plan,{items:(plan.items||[]).map(function(it){return /^door-/.test(it.type)?Object.assign({},it):it;})});out.sourceOpeningReviewRequested=true;
    (out.items||[]).forEach(function(it){
      if(!/^door-/.test(it.type))return;delete it.sourceOpeningReview;
      var originals=body&&body.sourceLocal&&body.sourceLocal.items,pose=body&&body.buildingCompilation&&body.buildingCompilation.poses[it.floor];
      if(!originals||!pose){it.sourceOpeningReference={coordinateFrame:'reader-frame',originalSnapshot:JSON.stringify(it)};return;}
      var matches=originals.map(function(raw,index){return {raw:raw,index:index,point:raw&&raw.floor===it.floor&&raw.type===it.type?PlanRegistration.transform(raw,pose):null};}).filter(function(c){return c.point&&Math.abs(c.point.x-it.x)<1e-6&&Math.abs(c.point.y-it.y)<1e-6;});
      if(matches.length===1){var source=matches[0],floor=body.sourceLocal.floors.find(function(f){return f.floor===it.floor;});it.sourceOpeningReference={coordinateFrame:'registered-building-frame',sourceItemIndex:source.index,sourcePageId:floor&&floor.sourcePageId||null,originalSnapshot:JSON.stringify(source.raw),registrationPose:JSON.parse(JSON.stringify(pose))};}
      else it.sourceOpeningReference={coordinateFrame:'registered-building-frame',unresolvedSourceIdentity:true};
    });return out;
  }
  function mapReviewedFixtures(plan,body) {
    var decisions=body.fixtureDecisions||[],floorDecisions=body.entryFloorDecisions||[],out=JSON.parse(JSON.stringify(plan));
    if(!decisions.length&&!floorDecisions.length)return out;
    var sourceKey=PlanRegistration.snapshot(body.sourceLocal),proposalKey=PlanRegistration.snapshot(body.buildingRegistration),candidates=bathtubCandidates(body);
    decisions.forEach(function(d){
      if(d.sourceSnapshot!==sourceKey||d.proposalSnapshot!==proposalKey)throw Error('浴槽の元図面または位置合わせが変わりました。設備の対応付けを再確認してください。');
      var c=candidates.find(function(v){return v.itemIndex===d.itemIndex&&v.markIndex===d.markIndex&&v.modelId===d.modelId;});
      if(!c||d.mode!=='fit-source')throw Error('浴槽の対応付けが現在の元図面と一致しません。');
      var pose=body.buildingCompilation&&body.buildingCompilation.poses[c.item.floor];
      if(!pose)throw Error('浴槽の階の位置合わせを確認してください。');
      var old=PlanRegistration.transform(c.item,pose),matches=out.items.filter(function(it){return it.type==='bath'&&it.floor===c.item.floor&&Math.abs(it.x-old.x)<1e-6&&Math.abs(it.y-old.y)<1e-6;});
      if(matches.length!==1)throw Error('浴槽の置き換え先を一意に確認できません。');
      var pos=PlanRegistration.transform(c.mark,pose),vertical=c.mark.d>c.mark.w,it=matches[0];
      it.type=c.modelId;it.x=pos.x;it.y=pos.y;it.w=vertical?c.mark.d:c.mark.w;it.d=vertical?c.mark.w:c.mark.d;it.rot=(pose.quarterTurns*90+(vertical?90:0))%360;
      it.sourceFixtureMapping={modelId:c.modelId,sourceItemIndex:c.itemIndex,sourceMarkIndex:c.markIndex,sizing:'reviewed-source-symbol-envelope',heightMm:c.modelHeightMm,heightProvenance:'catalogue-display-default',sourceSnapshot:sourceKey};
    });
    floorDecisions.forEach(function(d){
      var c=entryFloorCandidates(body).find(function(v){return v.key===d.roomKey;});
      if(d.sourceSnapshot!==sourceKey||d.proposalSnapshot!==proposalKey||!c||d.ordinaryRaiseMm!==c.ordinaryRaiseMm||d.entryRaiseMm!==0)throw Error('玄関の位置合わせまたは表示高さの前提が変わりました。土間表示を再確認してください。');
      var target=out.rooms.filter(function(r){return JSON.stringify([r.floor,r.n,r.x,r.y,r.w,r.d])===c.key;});
      if(target.length!==1)throw Error('玄関の土間の適用先を一意に確認できません。');
      target[0].floorRaiseMm=0;target[0].floorMaterial='tile_floor';target[0].sourceRoomMapping={role:'entry-display',floorRaiseMm:0,ordinaryRaiseMm:c.ordinaryRaiseMm,provenance:'user-reviewed-app-display-assumption',measured:false};
    });
    return out;
  }
  // Exact audited representation choices; names never auto-select a model.
  var BUILDING_OBJECT_MODELS={'cabinet':['im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown'],'sofa':['fmp-Sofa01'],'dining-table':['original-table'],'low-table':['original-table'],'table':['original-table'],'refrigerator':['fmp-Refrigerator01'],'fridge':['fmp-Refrigerator01'],'kitchen-unit':['original-kitchen-i2400'],'bed':['fmp-Bed01'],'chair':['fmp-Chair07'],'laundry':['original-washer-drum']};
  function buildingObjectCandidates(body) {
    if(typeof SourceObjectMapping==='undefined'||!body||!body.sourceLocal)return [];
    var registry=sceneCatalogue(),allCandidates=SourceObjectMapping.candidates(body.sourceLocal),markCounts=new Map(),markKey=function(c){return JSON.stringify([c.semantic,c.source.floor,c.source.x,c.source.y,c.source.w,c.source.d]);};allCandidates.filter(c=>c.collection==='marks').forEach(c=>markCounts.set(markKey(c),(markCounts.get(markKey(c))||0)+1));
    return allCandidates.filter(function(c){
      if(c.collection!=='marks'||markCounts.get(markKey(c))!==1)return false;
      var aliases={'cabinet':'cabinet','kitchen-unit':'kitchen','refrigerator':'refrigerator','fridge':'refrigerator','sofa':'sofa','dining-table':'table','low-table':'table','table':'table','bed':'bed','chair':'chair','laundry':'washer'};
      var overlaps=(body.sourceLocal.items||[]).map(function(it,index){return {item:it,index:index};}).filter(function(v){var it=v.item;var dx=c.source.x-it.x,dy=c.source.y-it.y;if(c.semantic==='kitchen-unit'){var a=(it.rot||0)*Math.PI/180;return it.floor===c.source.floor&&it.type===aliases[c.semantic]&&Math.abs(dx*Math.cos(a)+dy*Math.sin(a))<=it.w/2&&Math.abs(-dx*Math.sin(a)+dy*Math.cos(a))<=it.d/2;}return it.floor===c.source.floor&&(it.type===aliases[c.semantic]||(BUILDING_OBJECT_MODELS[c.semantic]||[]).includes(it.type))&&Math.abs(dx)<=it.w/2&&Math.abs(dy)<=it.d/2;});
      if(overlaps.length){if(c.semantic!=='kitchen-unit'||overlaps.length!==1)return false;c.replacesSourceItemIndex=overlaps[0].index;c.replacesSourceItemSnapshot=PlanRegistration.snapshot(overlaps[0].item);}

      if(BUILDING_OBJECT_MODELS[c.semantic])return true;
      return ['rail','railing','balcony-fence','parapet','lattice','lattice-rail','lattice-screen'].indexOf(c.semantic)>=0;
    }).map(function(c){
      c.models=(BUILDING_OBJECT_MODELS[c.semantic]||[]).map(function(id){return registry.get(id);}).filter(function(m){return m&&!m.openingOnly;});
      c.isRail=!BUILDING_OBJECT_MODELS[c.semantic];return c;
    }).concat(typeof SourceImageRails==='undefined'?[]:SourceImageRails.candidates(body.sourceLocal,body.sourceImageAnnotations));
  }
  function mapReviewedSourceObjects(plan,body) {
    var out=JSON.parse(JSON.stringify(plan)),sourceKey=PlanRegistration.snapshot(body.sourceLocal),proposalKey=PlanRegistration.snapshot(body.buildingRegistration),registry=sceneCatalogue();
    var seenSourceIds=new Set();
    (body.objectDecisions||[]).forEach(function(d){
      if(seenSourceIds.has(d.sourceId))throw Error('同じ元記号に複数の家具判断があります。対応付けを再確認してください。');seenSourceIds.add(d.sourceId);
      var c=buildingObjectCandidates(body).find(function(c){return c.id===d.sourceId;});
      if(!c||d.sourceSnapshot!==sourceKey||d.proposalSnapshot!==proposalKey||d.entitySnapshot!==c.snapshot)throw Error('家具・柵の元図面や位置合わせが変わりました。対応付けを再確認してください。');
      if(!c.isRail&&!c.models.some(function(m){return m.id===d.catalogId&&d.catalogueSnapshot===PlanRegistration.snapshot(m);} ))throw Error('家具の既存カタログ対応を再確認してください。');
      var mapped=c.isImageRail?SourceImageRails.map(body.sourceLocal,body.sourceImageAnnotations,d):SourceObjectMapping.map(body.sourceLocal,Object.assign({},d,{sourceSnapshot:d.entitySnapshot}),registry);
      if(!mapped.canApply)throw Error('家具・柵の対応付けを再確認してください: '+mapped.diagnostics.join(', '));
      var pose=body.buildingCompilation.poses[c.source.floor];if(!pose)throw Error('家具・柵の階の位置合わせを確認してください。');
      if(c.replacesSourceItemIndex!==undefined){if(d.replacesSourceItemIndex!==c.replacesSourceItemIndex||d.replacesSourceItemSnapshot!==c.replacesSourceItemSnapshot)throw Error('調理台の置き換え対象を再確認してください。');var original=body.sourceLocal.items[c.replacesSourceItemIndex],old=PlanRegistration.transform(original,pose),matches=out.items.filter(function(it){return it.type===original.type&&it.floor===original.floor&&Math.abs(it.x-old.x)<1e-6&&Math.abs(it.y-old.y)<1e-6;});if(matches.length!==1)throw Error('調理台の置き換え先を一意に確認できません。');out.items=out.items.filter(function(it){return it!==matches[0];});mapped.items.forEach(function(it){it.sourceObjectMapping.replacedSourceItem={index:c.replacesSourceItemIndex,snapshot:c.replacesSourceItemSnapshot,source:JSON.parse(JSON.stringify(original))};});}
      mapped.items.forEach(function(it){var center=PlanRegistration.transform({x:it.x+it.w/2,y:it.y+it.d/2},pose);it.x=center.x;it.y=center.y;it.rot=(it.rot+pose.quarterTurns*90)%360;out.items.push(it);});
      mapped.walls.forEach(function(w){var a=PlanRegistration.transform({x:w.x1,y:w.y1},pose),b=PlanRegistration.transform({x:w.x2,y:w.y2},pose);w.x1=a.x;w.y1=a.y;w.x2=b.x;w.y2=b.y;out.walls.push(w);});
    });return out;
  }
  function mapReviewedStairDisplay(plan,body) {
    var out=JSON.parse(JSON.stringify(plan)),decisions=body.stairDisplayDecisions||[];
    if(!decisions.length)return out;
    var sourceKey=PlanRegistration.snapshot(body.sourceLocal),proposalKey=PlanRegistration.snapshot(body.buildingRegistration);
    if(typeof SourceStairDisplay==='undefined'||decisions.some(function(d){return d.sourceSnapshot!==sourceKey||d.proposalSnapshot!==proposalKey;}))throw Error('階段表示の元図面・位置合わせが変わりました。再確認してください。');
    var items=SourceStairDisplay.materialize(body.sourceLocal,decisions.map(function(d){return Object.assign({},d,{sourceSnapshot:d.entitySnapshot});}));
    items.forEach(function(it){var pose=body.buildingCompilation.poses[it.floor];if(!pose)throw Error('階段表示の階を確認してください。');var center=PlanRegistration.transform({x:it.x+it.w/2,y:it.y+it.d/2},pose);it.x=center.x;it.y=center.y;it.rot=((it.rot||0)+pose.quarterTurns*90)%360;it.stairOrder=it.sourceStairDisplay.partOrder;it.stairTarget='upper';out.items.push(it);});return out;
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
    var old=$('building-registration-review'), wasOpen=old&&old.open, openFloors=[];
    if(old&&old.querySelectorAll)Array.prototype.forEach.call(old.querySelectorAll('[data-building-floor]'),function(d){if(d.open)openFloors.push(d.getAttribute('data-building-floor'));});
    if(old && old.parentNode)old.parentNode.removeChild(old);
    if(!body.sourceLocal || typeof PlanRegistration==='undefined')return;
    var sourceNow=PlanRegistration.snapshot(body.sourceLocal),proposalNow=PlanRegistration.snapshot(body.buildingRegistration);
    if((body.fixtureDecisions||[]).concat(body.entryFloorDecisions||[],body.objectDecisions||[],body.stairDisplayDecisions||[]).some(function(d){return d.sourceSnapshot!==sourceNow||d.proposalSnapshot!==proposalNow;}))invalidateFixtureReview(body);
    var compiled=compileBuildingReview(body), box=document.createElement('details');box.id='building-registration-review';box.className='scene-placement-context building-registration-review';box.open=!!wasOpen;
    var title=document.createElement('summary');title.textContent=body.sourceLocal.floors.length>1?'階数・位置合わせ':'取り込み先の階';box.appendChild(title);
    var heading=document.createElement('p');heading.textContent=body.sourceLocal.floors.length>1?'複数階の位置合わせ（部分的な組み立て）':'元ページの階数確認';box.appendChild(heading);
    if(body.fixtureReviewNotice){var notice=document.createElement('p');notice.textContent=body.fixtureReviewNotice;box.appendChild(notice);}
    var explain=document.createElement('p');explain.textContent=body.sourceLocal.floors.length>1?'各階の元の実寸を保ち、対応点から平行移動と90度単位の回転だけを求めます。残差と根拠の精度を確認してください。残差ゼロは数式上の一致で、画像・建物の精度保証ではありません。階高・階段・床の開口・屋根は未検証です。':'元ページの表題を見て取り込み先の階数を確認してください。階の位置合わせは行いません。';box.appendChild(explain);
    var propose=document.createElement('button');propose.type='button';propose.textContent='全ページから位置合わせを提案（追加AI読み取り・ページ数分の利用枠）';propose.disabled=ST.busy || body.importApplied || body.buildingApplied || !ST.pages || ST.pages.length<2;propose.setAttribute('data-building-propose','');propose.addEventListener('click',function(){if(current())requestBuildingRegistration(body);});if(body.sourceLocal.floors.length>1)box.appendChild(propose);
    var ds=document.createElement('p');ds.style.whiteSpace='pre-wrap';ds.textContent=compiled.diagnostics.map(function(d){return (d.floor?d.floor+'階: ':'')+d.message;}).join('\n');box.appendChild(ds);
    if(compiled.floors.every(function(f){return f.solution.ok;})){var composite=document.createElement('canvas');composite.style.maxWidth='100%';composite.setAttribute('aria-label','位置合わせ後の各階の重ね合わせ。高さ・階段・開口・屋根は未検証。');box.appendChild(composite);drawBuildingAssembly(composite,compiled);}
    function current(){return currentReview(body) && !body.importApplied && !body.buildingApplied && ST.result===body && !ST.busy && body.buildingSourceVersion===ST.version && $('building-registration-review')===box;}
    entryFloorCandidates(body).forEach(function(c){
      var label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('data-source-entry-floor',c.key);
      var sourceKey=PlanRegistration.snapshot(body.sourceLocal),proposalKey=PlanRegistration.snapshot(body.buildingRegistration);
      check.checked=(body.entryFloorDecisions||[]).some(function(d){return d.roomKey===c.key&&d.sourceSnapshot===sourceKey&&d.proposalSnapshot===proposalKey;});
      label.appendChild(check);label.appendChild(document.createTextNode(' 1階 '+c.room.n+' を土間として表示: 通常床 '+c.ordinaryRaiseMm+'mm → 土間 0mm、タイルの表示既定値を使う（差 '+c.ordinaryRaiseMm+'mm はアプリの仮定で、図面で測定した段差・素材ではありません）'));box.appendChild(label);
      check.addEventListener('change',function(){if(!current())return;body.entryFloorDecisions=(body.entryFloorDecisions||[]).filter(function(d){return d.roomKey!==c.key&&d.sourceSnapshot===sourceKey&&d.proposalSnapshot===proposalKey;});if(check.checked)body.entryFloorDecisions.push({roomKey:c.key,ordinaryRaiseMm:c.ordinaryRaiseMm,entryRaiseMm:0,sourceSnapshot:sourceKey,proposalSnapshot:proposalKey});});
    });
    bathtubCandidates(body).forEach(function(c){
      var label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('data-source-bathtub',String(c.itemIndex));
      var sourceKey=PlanRegistration.snapshot(body.sourceLocal),proposalKey=PlanRegistration.snapshot(body.buildingRegistration);
      check.checked=(body.fixtureDecisions||[]).some(function(d){return d.itemIndex===c.itemIndex&&d.sourceSnapshot===sourceKey&&d.proposalSnapshot===proposalKey;});
      label.appendChild(check);label.appendChild(document.createTextNode(' '+c.item.floor+'階の浴槽: 図面記号 '+c.mark.w+'×'+c.mark.d+'mm の位置・外形へ、既存の横長浴槽モデルを対応付ける（高さ '+c.modelHeightMm+'mm はカタログの表示仮値、図面の実測値ではありません）'));box.appendChild(label);
      check.addEventListener('change',function(){if(!current())return;body.fixtureDecisions=(body.fixtureDecisions||[]).filter(function(d){return d.itemIndex!==c.itemIndex&&d.sourceSnapshot===sourceKey&&d.proposalSnapshot===proposalKey;});if(check.checked)body.fixtureDecisions.push({itemIndex:c.itemIndex,markIndex:c.markIndex,modelId:c.modelId,mode:'fit-source',sourceSnapshot:sourceKey,proposalSnapshot:proposalKey});});
    });
    buildingObjectCandidates(body).forEach(function(c){
      var label=document.createElement(c.isImageRail||c.replacesSourceItemIndex!==undefined?'fieldset':'label'),select=document.createElement('select');label.style.color='#f4f5f3';select.style.color='#f4f5f3';if(c.isImageRail||c.replacesSourceItemIndex!==undefined){label.style.background='#ffffff';label.style.color='#27332d';label.style.padding='12px';label.style.borderRadius='12px';select.style.color='#27332d';select.style.background='#f4f5f3';}if(c.isImageRail||c.replacesSourceItemIndex!==undefined)select.setAttribute('aria-label',c.source.floor+'階 '+c.semantic+'の部材対応');select.setAttribute(c.isImageRail?'data-source-image-rail':'data-source-object',c.id);
      var sourceKey=PlanRegistration.snapshot(body.sourceLocal),proposalKey=PlanRegistration.snapshot(body.buildingRegistration);
      var blank=document.createElement('option');blank.value='';blank.textContent='元記号を保持・配置しない';select.appendChild(blank);
      c.models.forEach(function(m){var opt=document.createElement('option');opt.value=m.id;opt.textContent=m.name+' — 元外形へ寸法を合わせる（高さはモデルの表示既定値）';select.appendChild(opt);});
      if(c.isRail){var rail=document.createElement('option');rail.value=c.semantic==='parapet'||c.semantic==='balcony-fence'?'solid-parapet':'lattice-screen';rail.textContent=rail.value==='solid-parapet'?'既存の不透明なパラペットとして表示（1100mmは表示仮定）':'既存の格子柵へ対応: 元端点・厚みを使用、高さ未記載は1100mm、床からの高さ未記載は0mm、格子未記載は縦格子を表示仮定として確認';if(c.isImageRail)rail.textContent='原本の画像注釈を確認し、既存の黒い横格子として表示（高さ・厚み・間隔は未測定の仮定）';select.appendChild(rail);}
      var existing=(body.objectDecisions||[]).find(function(d){return d.sourceId===c.id;});select.value=existing?(existing.catalogId||(existing.kind==='lattice-rail'||existing.kind==='image-lattice-rail'?'lattice-screen':'solid-parapet')):'';
      label.appendChild(document.createTextNode(c.isImageRail?c.source.floor+'階 '+c.semantic+' 長さ約'+Math.round(c.source.w)+'mm（画像の目測）: ':c.source.floor+'階 '+c.semantic+' '+c.source.w+'×'+c.source.d+'mm: '));label.appendChild(select);var rotation=null;if(!c.isRail&&c.source.rot===undefined){rotation=document.createElement('input');rotation.type='number';rotation.min='0';rotation.max='270';rotation.step='90';rotation.value=existing&&existing.displayRotationDeg!==undefined?String(existing.displayRotationDeg):'0';rotation.setAttribute('data-source-object-rotation',c.id);label.appendChild(document.createTextNode(' 表示回転°（元の角度は未知・表示仮定） '));label.appendChild(rotation);}box.appendChild(label);
      if(c.replacesSourceItemIndex!==undefined)label.appendChild(document.createTextNode(' 元の汎用調理台1点を置換します（重複配置なし）。シンク・コンロ一体モデル。向き・高さ・製品・仕上げは表示仮定です。'));
      var imageFields={};if(c.isImageRail){var evidence=document.createElement('p');evidence.style.color='#27332d';evidence.textContent='手動の画像注釈（AI原本には追加しません）: '+c.annotation.evidence.description+' 位置の目測誤差 ±'+c.annotation.evidence.precisionMm+'mm。黒は図面表示色で実物材質・色は未確認。';label.appendChild(evidence);var link=document.createElement('a');link.href='/tools/tests/fixtures/madori-3f.pdf#page=2';link.target='_blank';link.rel='noopener';link.textContent='2階の平面図・俯瞰図を確認';label.appendChild(link);[['heightMm','表示高さ'],['thicknessMm','表示厚み'],['pitchMm','格子間隔'],['slatMm','格子見付'],['elevationMm','床表示面オフセット']].forEach(function(field){var span=document.createElement('label'),input=document.createElement('input');input.type='number';input.value=String(existing&&existing.display?existing.display[field[0]]:c.annotation.displaySuggestion[field[0]]);input.setAttribute('data-image-rail-field',c.id+':'+field[0]);span.style.color='#27332d';span.appendChild(document.createTextNode(field[1]+' mm（未測定） '));span.appendChild(input);label.appendChild(span);imageFields[field[0]]=input;input.addEventListener('input',function(){select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));});});}
      if(rotation)rotation.addEventListener('input',function(){select.dispatchEvent(new Event('change',{bubbles:true}));});
      select.addEventListener('change',function(){if(!current())return;body.objectDecisions=(body.objectDecisions||[]).filter(function(d){return d.sourceId!==c.id&&d.sourceSnapshot===sourceKey&&d.proposalSnapshot===proposalKey;});if(select.value){var d={sourceId:c.id,entitySnapshot:c.snapshot,sourceSnapshot:sourceKey,proposalSnapshot:proposalKey,reviewed:true,semantic:c.semantic,sizingPolicy:'fit-source'};if(c.isImageRail){d.kind='image-lattice-rail';d.annotationSnapshot=c.snapshot;d.acceptDiagramColor=true;d.display={};Object.keys(imageFields).forEach(function(k){d.display[k]=imageFields[k].value.trim()===''?null:Number(imageFields[k].value);});}else if(c.isRail){d.kind=select.value==='lattice-screen'?'lattice-rail':'rail';d.acceptDisplayHeightMm=1100;if(d.kind==='lattice-rail'){d.acceptDisplayElevationMm=0;d.acceptDisplayRailInfill='baluster';d.acceptLatticeRepresentation=true;}else d.acceptSolidParapet=true;}else {if(rotation)d.displayRotationDeg=rotation.value.trim()===''?null:Number(rotation.value);if(c.replacesSourceItemIndex!==undefined){d.replacesSourceItemIndex=c.replacesSourceItemIndex;d.replacesSourceItemSnapshot=c.replacesSourceItemSnapshot;}d.catalogId=select.value;d.catalogueSnapshot=PlanRegistration.snapshot(c.models.find(function(m){return m.id===select.value;}));}body.objectDecisions.push(d);}});
    });
    var stairDiagnostics=document.createElement('p');stairDiagnostics.setAttribute('data-source-stair-diagnostics','');box.appendChild(stairDiagnostics);function updateStairDiagnostics(){if(typeof SourceStairDisplay==='undefined')return;try{var ds=SourceStairDisplay.directionDiagnostics(body.sourceLocal,(body.stairDisplayDecisions||[]).map(function(d){return d.directionDecision;}).filter(Boolean));stairDiagnostics.textContent=ds.length?ds.map(function(d){return d.floor+'階: '+(d.portRole==='up'?'上端同士':'下端同士')+'が一致する向きの矛盾。元図面の段番号・UP/DNを確認してください。';}).join(' / '):'上端同士・下端同士の一致は検出されません。物理接続・行先床の段差・開口は未確認です。';}catch(error){stairDiagnostics.textContent=error.message;}}updateStairDiagnostics();
    if(typeof SourceStairDisplay!=='undefined')SourceStairDisplay.candidates(body.sourceLocal).forEach(function(c){
      var row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=c.floor+'階 '+c.type+' — 表示用階段（接続・床開口・歩行経路は作りません）';row.appendChild(legend);
      var saved=(body.stairDisplayDecisions||[]).find(function(d){return d.sourceItemIndex===c.sourceItemIndex;}),inputs={};
      [['displayRiseMm','表示上り高さ mm'],['displayBaseOffsetMm','床からの表示基準高さ mm'],['partOrder','部材順（接続は未確認）']].forEach(function(entry){var label=document.createElement('label'),input=document.createElement('input');input.type='number';input.value=saved?String(saved[entry[0]]):entry[0]==='displayBaseOffsetMm'?'0':'';input.setAttribute('data-stair-field',c.sourceItemIndex+':'+entry[0]);label.appendChild(document.createTextNode(entry[1]+' '));label.appendChild(input);row.appendChild(label);inputs[entry[0]]=input;input.addEventListener('input',function(){if(!current())return;body.stairDisplayDecisions=(body.stairDisplayDecisions||[]).filter(function(d){return d.sourceItemIndex!==c.sourceItemIndex;});check.checked=false;});});
      var direction=null,directionEvidence=null;if(c.type==='stair'){var dirLabel=document.createElement('label');direction=document.createElement('select');direction.setAttribute('data-stair-direction',String(c.sourceItemIndex));[['source','原本の向きで表示'],['flip-y','図面の段番号・上り方向を確認し表示だけ反転']].forEach(function(v){var opt=document.createElement('option');opt.value=v[0];opt.textContent=v[1];direction.appendChild(opt);});direction.value=saved&&saved.directionDecision?'flip-y':'source';directionEvidence=document.createElement('input');directionEvidence.setAttribute('data-stair-direction-evidence',String(c.sourceItemIndex));directionEvidence.placeholder='元ページの段番号・UP/DN・接続辺の根拠';directionEvidence.value=saved&&saved.directionDecision?saved.directionDecision.evidence:'';dirLabel.appendChild(direction);dirLabel.appendChild(directionEvidence);row.appendChild(dirLabel);[direction,directionEvidence].forEach(function(input){input.addEventListener(input===direction?'change':'input',function(){if(!current())return;body.stairDisplayDecisions=(body.stairDisplayDecisions||[]).filter(function(d){return d.sourceItemIndex!==c.sourceItemIndex;});check.checked=false;updateStairDiagnostics();});});}
      var label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('data-source-stair',String(c.sourceItemIndex));check.checked=!!saved;label.appendChild(check);label.appendChild(document.createTextNode(' '+c.floor+'→'+(c.floor+1)+'階の元部材を、上記の表示上の仮定で配置する。高さは実測ではありません。コーナーは既存モデルの3段固定です。'));row.appendChild(label);box.appendChild(row);
      check.addEventListener('change',function(){if(!current())return;body.stairDisplayDecisions=(body.stairDisplayDecisions||[]).filter(function(d){return d.sourceItemIndex!==c.sourceItemIndex&&d.sourceSnapshot===PlanRegistration.snapshot(body.sourceLocal)&&d.proposalSnapshot===PlanRegistration.snapshot(body.buildingRegistration);});if(check.checked)body.stairDisplayDecisions.push({sourceItemIndex:c.sourceItemIndex,entitySnapshot:c.sourceSnapshot,sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),proposalSnapshot:PlanRegistration.snapshot(body.buildingRegistration),reviewed:true,displayRiseMm:inputs.displayRiseMm.value.trim()===''?null:Number(inputs.displayRiseMm.value),displayBaseOffsetMm:Number(inputs.displayBaseOffsetMm.value),partOrder:inputs.partOrder.value.trim()===''?null:Number(inputs.partOrder.value),targetFloor:c.floor+1,directionDecision:direction&&direction.value==='flip-y'?{sourceItemIndex:c.sourceItemIndex,sourceSnapshot:c.sourceSnapshot,reviewed:true,flipX:!!body.sourceLocal.items[c.sourceItemIndex].flipX,flipY:!body.sourceLocal.items[c.sourceItemIndex].flipY,evidence:directionEvidence.value}:undefined});updateStairDiagnostics();});
    });
    body.sourceLocal.floors.forEach(function(f){
      var id=PlanRegistration.pageId(f), proposal=((body.buildingRegistration||{}).floors||[]).find(function(p){return p.floor===f.floor && p.sourcePageId===id;});
      var detail=document.createElement('details');detail.setAttribute('data-building-floor',String(f.floor));
      detail.open=openFloors.indexOf(String(f.floor))>=0;
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
          input.addEventListener('input',function(){if(!current())return;invalidateFixtureReview(body);body.buildingDecisions={sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[],partialAcknowledged:false};var partialCheck=box.querySelector('[data-building-partial]');if(partialCheck)partialCheck.checked=false;result.textContent='変更されたため全階の位置合わせを再確認してください。';compileBuildingReview(body);syncPlanImportButtons();});
        });fields.push(inputs);detail.appendChild(row);
      });
      (proposal&&proposal.directions||[]).forEach(function(direction){var p=document.createElement('p');p.textContent='方向: 元 '+JSON.stringify(direction.local)+' → 建物 '+JSON.stringify(direction.building)+' / 精度 ±'+direction.precisionDeg+'° / '+direction.evidence;detail.appendChild(p);});
      var savedDecision=(body.buildingDecisions&&body.buildingDecisions.floors||[]).find(function(d){return d.floor===f.floor;});
      var identity=document.createElement('label'),identityCheck=document.createElement('input');identityCheck.type='checkbox';identityCheck.checked=!!(savedDecision&&savedDecision.identityConfirmed);identityCheck.disabled=ST.busy;identityCheck.setAttribute('data-building-identity','');identity.appendChild(identityCheck);identity.appendChild(document.createTextNode(' 元ページの表題・寸法から '+f.floor+'階であることを確認'));detail.appendChild(identity);
      var identityEvidence=document.createElement('input');identityEvidence.type='text';identityEvidence.setAttribute('data-building-identity-evidence','');identityEvidence.setAttribute('aria-label','階数を確認した根拠');identityEvidence.placeholder='表題の階表記など';identityEvidence.value=savedDecision&&savedDecision.identityEvidence||'';identityEvidence.disabled=ST.busy;detail.appendChild(identityEvidence);
      function invalidateIdentity(){if(!current())return;invalidateFixtureReview(body);var opts=body.buildingDecisions||{sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[]};opts.floors=opts.floors.filter(function(d){return d.floor!==f.floor;});opts.partialAcknowledged=false;body.buildingDecisions=opts;var checkbox=box.querySelector('[data-building-partial]');if(checkbox)checkbox.checked=false;result.textContent='階数の確認が変わりました。再確認してください。';compileBuildingReview(body);syncPlanImportButtons();}
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
    partial.appendChild(check);partial.appendChild(document.createTextNode(' '+body.sourceLocal.floors.map(function(f){return f.floor+'階';}).join('・')+'を部分的に取り込む: 高さ・未記載の奥行きは現在の表示既定値を使用。元の階段記号は保持し、明示確認した表示用階段だけ配置。階接続・開口・屋根は未完成'));box.appendChild(partial);
    check.addEventListener('change',function(){if(!current())return;body.buildingDecisions=body.buildingDecisions||{sourceSnapshot:PlanRegistration.snapshot(body.sourceLocal),floors:[]};body.buildingDecisions.partialAcknowledged=check.checked;body.buildingDecisions.proposalSnapshot=PlanRegistration.snapshot(body.buildingRegistration||{version:1,floors:[]});compileBuildingReview(body);syncPlanImportButtons();});
    }
    var host=$('plan-import-review')||$('plan-import-step3');if(host)host.appendChild(box);
  }

  function sceneFactValue(fact) { return fact && fact.value !== null ? fact.value : undefined; }

  // Only explicit catalogue semantics/axes are eligible. Similar names and room use
  // never turn a table into a desk, an assembly into a fixture, or an unknown front
  // into +Z. This list offers representations; it is not source identification.
  function sceneMappingCandidates(source, registry) {
    var candidates = [], rejected = [], fits = {}, type = sceneFactValue(source.objectType), extent = sceneFactValue(source.semanticExtent);
    var fp = sceneFactValue(source.sourceFootprint), place = sceneFactValue(source.placement);
    var axes = { '+Z': {x:0,y:1}, '-Z': {x:0,y:-1}, '+X': {x:1,y:0}, '-X': {x:-1,y:0} };
    if (!type || !extent || !fp || !fp.axisX || !fp.sizeMm || !place || type === 'stair' || type === 'unidentified-symbol') return { candidates: [], rejected: [], reason: '物の種類・範囲・外形・配置の根拠が不足、または未対応です。元の根拠を保持し、自動で置き換えません。' };
    registry.list().forEach(function (model) {
      if (!SceneCatalogue.supportsSourceObjectType(model, type) || model.openingOnly) return;
      var reasons = [], front = sceneFactValue(source.frontDirection), head = sceneFactValue(source.headDirection);
      if (!SceneCatalogue.supportsSemanticExtent(model, extent)) reasons.push('意味範囲が異なる: ' + extent + ' → ' + model.semanticExtent);
      if (!Number.isFinite(model.w) || !Number.isFinite(model.d) || model.w <= 0 || model.d <= 0) reasons.push('寸法が未確認');
      if (place.domain === 'exterior' && type !== 'car') reasons.push('この種類の屋外配置は未対応');
      var rotation = Math.atan2(fp.axisX.y, fp.axisX.x);
      if (front) {
        if (!axes[model.front]) reasons.push('モデル正面軸が未確認');
        else {
          rotation = Math.atan2(front.y, front.x) - Math.atan2(axes[model.front].y, axes[model.front].x);

        }
      }
      if (head) {
        if (!axes[model.head]) reasons.push('モデル頭側軸が未確認');
        else if (front && Math.abs(Math.sin((Math.atan2(head.y, head.x) - Math.atan2(axes[model.head].y, axes[model.head].x) - rotation) / 2)) > .00001) reasons.push('正面と頭側の軸が矛盾');
      }
      if (head && axes[model.head] && !front) rotation = Math.atan2(head.y, head.x) - Math.atan2(axes[model.head].y, axes[model.head].x);
      var fit = SceneCatalogue.deriveFootprintFit(fp, rotation * 180 / Math.PI);
      if (!fit) reasons.push('正面と外形の軸が矛盾');
      else fits[model.id] = fit;
      var height = sceneFactValue(source.heightMm), color = source.appearance && sceneFactValue(source.appearance.diagramColor);
      if (height !== undefined && height !== model.h) reasons.push('既知の高さが異なる: ' + height + ' → ' + model.h + ' mm');
      if (typeof color === 'string' && !model.genericColor && (model.finishChannels || []).length !== 1) reasons.push('図面の単色に対応する表示チャンネルが未対応');
      if (reasons.length) rejected.push({ model: model, reasons: reasons });
      else candidates.push(model);
    });
    candidates.sort(function (a, b) {
      var difference = function (m) { return Math.abs(m.w - fits[m.id].w) + Math.abs(m.d - fits[m.id].d); };
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
      if (!currentReview(body) || ST.result !== body || ST.busy || ST.mappingEditor || (body.sceneApplied||body.scenePartialOpened) || body.sceneOptions.sourceInvalidated) return;
      if(root.SceneReviewFlow)root.SceneReviewFlow.reviewInteraction();
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
      var catalogue = null, sizing = null, orientation = null, appearance, profileControl=null, regions = [], selectedMetadata = null;
      var binding = existing && existing.binding;
      if (isObject) {
        var fp = sceneFactValue(source.sourceFootprint), front = sceneFactValue(source.frontDirection);
        text('候補は表示用の提案で、元図の製品特定ではありません。');
        text('図面: ' + sceneFactValue(source.objectType) + ' / ' + sceneFactValue(source.semanticExtent) + ' / 外形 ' + (fp ? fp.sizeMm.w + ' × ' + fp.sizeMm.d + ' mm' : '不明') + ' / 正面 ' + (front ? JSON.stringify(front) : '不明（外形軸による表示を確認）'));
        if (choices.reason) text(choices.reason);
        if (choices.rejected.length) text('候補から除外 ' + choices.rejected.length + ' 件' + (choices.rejected.length > 12 ? '（先頭12件）' : '') + ': ' + choices.rejected.slice(0, 12).map(function (r) { return r.model.name + ' [' + r.model.id + '] ' + r.reasons.join('・'); }).join('\n'));
        catalogue = selectControl('表示用カタログモデルを選択（製品特定ではありません）', 'data-scene-catalogue', [['','選択してください']].concat(choices.candidates.map(function (m) { return [m.id, m.name + ' [' + m.id + '] ' + m.w + '×' + m.d + ' mm']; })), binding && binding.catalogId.value || choices.candidates.length === 1 && choices.candidates[0].id);
        if (choices.candidates.length === 1 && !binding) text('候補が1つのため推奨候補を事前選択しています。寸法・見た目・表示仮定を確認してから保存してください。');
        if (!choices.candidates.some(function (m) { return m.id === catalogue.value; })) catalogue.value = '';
        sizing = selectControl('寸法の対応', 'data-scene-sizing', [['','選択してください'],['native','モデル標準寸法（原図と一致する場合のみ）'],['fit-source','原図の外形に合わせる（形状の拡縮を確認）']], binding && binding.sizingPolicy);
        if(fp&&fp.axisX&&!sceneFactValue(source.frontDirection)&&!sceneFactValue(source.headDirection)){var baseAngle=Math.atan2(fp.axisX.y,fp.axisX.x)*180/Math.PI,previous= binding&&sceneFactValue(binding.rotationDeg),quarter=previous===undefined?0:((Math.round((previous-baseAngle)/90)%4)+4)%4;orientation=selectControl('正面が不明なため確認する表示の向き（原図の外形を保持）','data-scene-orientation',[[0,'外形基底と同じ'],[1,'基底から90度（幅・奥行を交換）'],[2,'基底から180度'],[3,'基底から270度（幅・奥行を交換）']],String(quarter));}
      }
      appearance = selectControl('見た目の対応', 'data-scene-appearance', [['','選択してください'],['match-diagram-appearance','図面の色・模様を表示へ対応付ける'],['unspecified','未指定を保持する（既知の見た目が未反映なら適用不可）']], binding && binding.appearanceMode);
      var appearanceFacts = source.appearance || {}, color = sceneFactValue(appearanceFacts.diagramColor), material = appearanceFacts.specifiedMaterial;
      text('図面の色: ' + (color === undefined ? '不明' : JSON.stringify(color)) + ' / 模様: ' + (sceneFactValue(appearanceFacts.pattern) || '不明') + ' / モジュール: ' + (sceneFactValue(appearanceFacts.moduleMm) === undefined ? '不明' : sceneFactValue(appearanceFacts.moduleMm) + ' mm') + ' / 指定材質: ' + (material && sceneFactValue(material.category) || '不明') + '。不明な製品・材質は補いません。');
      if (!isObject) text(group.collection === 'rooms' ? '対応する表示: square-grid → タイル、plank-lines → 板目、plain / none → 無地。既知の正方形タイル寸法は保持します。未対応の模様・モジュールは診断を残します。' : '開口の単色は表示色へ対応します。複数領域の色・未対応の模様は診断を残します。');
      var modelDetails = document.createElement('p'), regionBox = document.createElement('div'); panel.appendChild(modelDetails); panel.appendChild(regionBox);
      function updateModel() {
        regionBox.textContent = ''; regions = []; profileControl=null;
        var model = catalogue && choices.candidates.find(function (m) { return m.id === catalogue.value; }); selectedMetadata = model || null;
        if (!model) { modelDetails.textContent = ''; return; }
        var fp = sceneFactValue(source.sourceFootprint), channels = (model.genericColor ? [{key:'color',default:null}] : model.finishChannels || []);
        var front=sceneFactValue(source.frontDirection),head=sceneFactValue(source.headDirection),direction=front||head,axis=front?model.front:head?model.head:null,axes={'+Z':{x:0,y:1},'-Z':{x:0,y:-1},'+X':{x:1,y:0},'-X':{x:-1,y:0}},rotation=direction&&axes[axis]?Math.atan2(direction.y,direction.x)-Math.atan2(axes[axis].y,axes[axis].x):Math.atan2(fp.axisX.y,fp.axisX.x),fit=SceneCatalogue.deriveFootprintFit(fp,rotation*180/Math.PI+(orientation?Number(orientation.value)*90:0));
        modelDetails.textContent = '原図の外形 '+fp.sizeMm.w+'×'+fp.sizeMm.d+' mm / 導出したモデル基底 '+(fit?fit.w+'×'+fit.d:'不整合')+' mm'+(fit&&fit.basisExchanged?'（直交基底交換、原図の値は不変）':'')+'。モデルとの差: 幅 '+(model.w-(fit?fit.w:fp.sizeMm.w))+' / 奥行 '+(model.d-(fit?fit.d:fp.sizeMm.d))+' mm。高さ '+(model.h===null?'不明':model.h+' mm')+'（図面の高さが不明ならモデル既定値）。正面軸 '+(model.front||'未確認')+' ['+model.frontProvenance+']。色チャンネル: '+channels.map(function(c){return c.key+'（既定色 '+(c.default||'モデル既定')+'）';}).join(', ')+'。元の質感や部位と一致するとは限りません。';
        if (typeof color === 'string' && channels.length > 1) modelDetails.textContent += ' この単色を複数チャンネルへ割り当てる機能は未対応です。確認しても適用の阻止理由が残ります。';
        if (!Array.isArray(color)) return;
        var profile=(model.appearanceProfiles||[]).find(function(p){return p.available;});
        if(profile){profileControl=selectControl('専用の2色表示仮定（脚・縫い目は固定）','data-scene-appearance-profile',[['','専用profileを使わない'],[profile.id,'body → 背・肘・台座 / seat → 2枚の座面（原図の部位意味は未確認）']],binding&&binding.appearanceProfile&&binding.appearanceProfile.id,regionBox);}
        color.forEach(function (region) {
          var previous = binding && binding.catalogId.value === model.id && (binding.channels || []).find(function (c) { return c.sourceRegion === region.region; });
          var retained = existing && binding.catalogId.value === model.id && (existing.retainedAppearanceRegions || []).indexOf(region.region) >= 0;
          var control = selectControl(region.region + ' ' + region.color + ' の表示先', 'data-scene-region', [['','選択してください']].concat(channels.map(function (c) { return [c.key, c.key + '（モデル既定色 ' + (c.default || '既定') + ' → ' + region.color + '）']; }), [['__overlay__','図面上だけに保持（3Dの見た目は未完成）']]), retained ? '__overlay__' : previous && previous.channel, regionBox);
          control.setAttribute('data-scene-region', region.region); regions.push({source:region,control:control});
        });
      }
      if (catalogue) catalogue.addEventListener('change', updateModel);
      if(orientation)orientation.addEventListener('change',updateModel);
      updateModel();
      var error = text(''); error.setAttribute('role', 'status');
      var confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'この対応を確認して保存'; confirm.setAttribute('data-scene-mapping-confirm', ''); panel.appendChild(confirm);
      var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '変更を取り消す'; cancel.setAttribute('data-scene-mapping-cancel', ''); panel.appendChild(cancel);
      function current() { return currentReview(body) && ST.result === body && ST.mappingEditor === editor && !ST.busy && !body.sceneApplied && !body.scenePartialOpened && !body.sceneOptions.sourceInvalidated; }
      cancel.addEventListener('click', function () { if(ST.result!==body||ST.mappingEditor!==editor)return;ST.mappingEditor=null;if(currentReview(body))renderPlanImportResult(body);else revalidateReview();syncPlanImportButtons(); });
      confirm.addEventListener('click', function () {
        if (!current()) return;
        var model = selectedMetadata, policy = isObject ? sizing.value : 'native', mode = appearance.value;
        if (['match-diagram-appearance','unspecified'].indexOf(mode) < 0 || ['native','fit-source'].indexOf(policy) < 0 || isObject && !model) { error.textContent = 'カタログ・寸法・見た目の対応を意図的に選んでください。'; return; }
        if (isObject && (catalogue.value !== model.id || !sceneMappingCandidates(source, sceneCatalogue()).candidates.some(function (m) { return JSON.stringify(m) === JSON.stringify(model); }))) { error.textContent = 'カタログ情報が変わりました。取り消して候補を確認し直してください。'; return; }
        var fp = sceneFactValue(source.sourceFootprint);
        var front=sceneFactValue(source.frontDirection),head=sceneFactValue(source.headDirection),axis=front&&model&&model.front||head&&model&&model.head,axes={'+Z':{x:0,y:1},'-Z':{x:0,y:-1},'+X':{x:1,y:0},'-X':{x:-1,y:0}},direction=front||head,rotation=axis&&axes[axis]?Math.atan2(direction.y,direction.x)-Math.atan2(axes[axis].y,axes[axis].x):fp?Math.atan2(fp.axisX.y,fp.axisX.x):0,fit=fp&&SceneCatalogue.deriveFootprintFit(fp,rotation*180/Math.PI+(orientation?Number(orientation.value)*90:0));
        if (model && policy === 'native' && (!fit || model.w !== fit.w || model.d !== fit.d)) { error.textContent = '標準寸法が原図と異なります。原図の外形を維持する拡縮を明示的に選んでください。'; return; }
        var channels = [], retained = [], used = [], invalid = false;
        if (mode === 'match-diagram-appearance' && !(profileControl&&profileControl.value)) regions.forEach(function (row) {
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
        if(orientation)decision.binding.rotationDeg={value:Math.atan2(fp.axisX.y,fp.axisX.x)*180/Math.PI+Number(orientation.value)*90,status:'inferred',source:'user-confirmed display orientation',reason:'Source front/head remain unknown; orthogonal display choice preserves the original world envelope'};
        if(profileControl&&profileControl.value){
          var metadata=model.appearanceProfiles.find(function(p){return p.id===profileControl.value;}),rawColors={};(color||[]).forEach(function(r){rawColors[r.region]=r.color;});
          try{var verified=SceneAppearanceProfiles.validate({id:metadata.id,version:metadata.version,assetSha256:metadata.assetSha256,colors:rawColors},decision.binding,source,model);decision.binding.appearanceProfile=verified.profile;decision.appearanceProvenance=verified.provenance;}
          catch(e){error.textContent=e.message;return;}
        }
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

  function renderScenePartialControls(body, box, optionsOpen, modeOpen) {
    if(body.sceneIR.sceneVersion!==3||body.sceneOptions.materialization!=='bounded-v3'||typeof SceneIR.createPartialSelection!=='function')return;
    var field=document.createElement('details');field.className='scene-placement-context';field.setAttribute('data-scene-partial-mode','');field.open=!!modeOpen;var legend=document.createElement('summary');legend.textContent='部分プレビュー（未完成）';field.appendChild(legend);
    var candidates=body.sceneIR.objects.map(function(source){return {source:source,choices:sceneMappingCandidates(source,sceneCatalogue())};}).filter(function(row){return row.choices.candidates.length;});
    var label=document.createElement('label'),enable=document.createElement('input');enable.type='checkbox';enable.setAttribute('data-scene-partial-enable','');enable.setAttribute('data-scene-review-control','');enable.checked=!!body.sceneOptions.partialSelection;label.appendChild(enable);label.appendChild(document.createTextNode(' 選んだ物・構造と必要な部屋だけを確認する。その他は原図の根拠として残し、未配置・未完成であることを確認する'));field.appendChild(label);
    var note=document.createElement('p');note.textContent='候補は製品特定ではありません。一意候補は推奨として事前選択、複数候補は明示選択です。寸法・向きは原図を保持し、高さ・質感は確認した表示仮定を使用します。既存の案を変更せず、通常の編集画面へ別の案として開きます。';field.appendChild(note);
    function stage(ids,on,structureIds){if(!currentReview(body)||ST.result!==body||ST.mappingEditor||ST.busy||body.sceneApplied||body.scenePartialOpened)return;var opts=JSON.parse(JSON.stringify(body.sceneOptions));opts.partialSelection=on?SceneIR.createPartialSelection(body.sceneIR,ids,true,structureIds===undefined?(body.sceneOptions.partialSelection&&body.sceneOptions.partialSelection.structureIds||[]):structureIds)||{version:1,objectIds:[],entityIds:[],incompleteConfirmed:true}:null;opts.acceptedReviews=[];opts.acceptedReviewGroups=[];opts.reviewedEntities={};opts.unresolvedDecisions=[];stageSceneIR(body.sceneIR,opts);}
    enable.addEventListener('change',function(){if(enable.checked)field.setAttribute('data-open-selection','');stage(candidates.map(function(row){return row.source.id;}),enable.checked);});
    if(enable.checked){
      var controls = document.createElement('details'), title = document.createElement('summary'); controls.setAttribute('data-scene-partial-options', ''); controls.open = !!optionsOpen;
      title.textContent = '選択対象・表示仮定を確認する（選択 ' + body.sceneOptions.partialSelection.entityIds.length + ' 項目）'; controls.appendChild(title); field.appendChild(controls);
      candidates.forEach(function(row){var label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('data-scene-partial-object',row.source.id);input.setAttribute('data-scene-review-control','');input.checked=body.sceneOptions.partialSelection.objectIds.indexOf(row.source.id)>=0;label.appendChild(input);label.appendChild(document.createTextNode(' '+row.source.id+' — '+(row.choices.candidates.length===1?'推奨候補1つ':'候補'+row.choices.candidates.length+'件・選択が必要')));controls.appendChild(label);input.addEventListener('change',function(){var ids=body.sceneOptions.partialSelection.objectIds.filter(function(id){return id!==row.source.id;});if(input.checked)ids.push(row.source.id);stage(ids,true);});});
      ['walls','rooms','openings'].forEach(function(collection){body.sceneIR[collection].forEach(function(source){var label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('data-scene-partial-structure',source.id);input.setAttribute('data-scene-review-control','');input.checked=(body.sceneOptions.partialSelection.structureIds||[]).indexOf(source.id)>=0;label.appendChild(input);label.appendChild(document.createTextNode(' '+source.id+' — '+collection+'（host壁の全開口と隣接部屋も確認）'));controls.appendChild(label);input.addEventListener('change',function(){var ids=(body.sceneOptions.partialSelection.structureIds||[]).filter(function(id){return id!==source.id;});if(input.checked)ids.push(source.id);stage(body.sceneOptions.partialSelection.objectIds,true,ids);});});});
      var assumed=document.createElement('pre');assumed.style.whiteSpace='pre-wrap';assumed.textContent='この部分の表示仮定（図面から測定した値ではありません）\n'+body.sceneCompilation.defaults.map(function(d){return d.path+': '+JSON.stringify(d.value)+' — '+d.reason;}).join('\n')+'\n色の部位範囲が不明な場合、既存の染色チャンネルだけに適用します。黒い脚など元の色が残る場合があり、全面単色再現は保証しません。';controls.appendChild(assumed);
      var reviewLabel=document.createElement('label'),review=document.createElement('input');review.type='checkbox';review.setAttribute('data-scene-partial-accept','');review.setAttribute('data-scene-review-control','');var groups=body.sceneCompilation.reviewGroups.filter(function(g){return body.sceneOptions.partialSelection.entityIds.indexOf(g.entityId)>=0&&g.reviewPaths.length;});review.checked=groups.length>0&&groups.every(function(g){return g.accepted;});review.disabled=body.sceneCompilation.diagnostics.some(function(d){return d.severity==='error';});reviewLabel.appendChild(review);reviewLabel.appendChild(document.createTextNode(' 選んだ候補・元図の推定値・表示仮定と適用限界をまとめて確認した（未配置部分の再現は承認しない）'));controls.appendChild(reviewLabel);review.addEventListener('change',function(){if(!currentReview(body)||ST.result!==body||ST.mappingEditor||ST.busy||body.scenePartialOpened)return;var opts=JSON.parse(JSON.stringify(body.sceneOptions));groups.forEach(function(g){opts.acceptedReviewGroups=opts.acceptedReviewGroups.filter(function(id){return id!==g.id;});delete opts.reviewedEntities[g.entityId];if(review.checked){opts.acceptedReviewGroups.push(g.id);opts.reviewedEntities[g.entityId]=g.reviewKey;}});stageSceneIR(body.sceneIR,opts);});
    }
    if(!candidates.length&&!body.sceneIR.walls.length&&!body.sceneIR.rooms.length&&!body.sceneIR.openings.length){enable.disabled=true;note.textContent+=' このページには適合候補がありません。原図の記号と拒否理由は下に残します。';}
    box.appendChild(field);
  }

  function renderSceneIRReview(body) {
    if (typeof document.createElement !== 'function') return;
    var old = $('scene-ir-review'), openGroups = [];
    var entitiesOpen = old && old.querySelector && old.querySelector('[data-scene-entities]'), selectedEntity = old && old.getAttribute('data-selected-entity');
    var oldAudit=old&&old.querySelector&&old.querySelector('[data-scene-audit]'),oldPlacement=old&&old.querySelector&&old.querySelector('[data-scene-placement]');
    var oldSearch = old && old.querySelector && old.querySelector('[data-scene-review-search]'), oldFilter = old && old.querySelector && old.querySelector('[data-scene-review-filter]');
    var oldPartial = old && old.querySelector && old.querySelector('[data-scene-partial-options]'), partialOptionsOpen = oldPartial && oldPartial.open;
    var oldPartialMode=old&&old.querySelector&&old.querySelector('[data-scene-partial-mode]'), partialModeOpen=oldPartialMode&&oldPartialMode.open;
    if(oldPartialMode&&oldPartialMode.hasAttribute&&oldPartialMode.hasAttribute('data-open-selection'))partialOptionsOpen=true;
    var searchValue = oldSearch ? oldSearch.value : '', filterValue = oldFilter ? oldFilter.value : 'all';
    if (old) { Array.prototype.forEach.call(old.querySelectorAll('details[open]'), function (d) { openGroups.push(d.getAttribute('data-scene-group')); }); old.remove(); }
    if (!body.sceneCompilation) return;
    var notes = $('plan-import-notes'), host = $('plan-import-review') || notes && notes.parentNode;
    if (!host) return;
    var box = document.createElement('div'); box.id = 'scene-ir-review';
    var heading = document.createElement('p');
    heading.textContent = '箇所を選ぶと根拠を表示します';
    heading.className = 'airx-source-note';
    box.appendChild(heading);
    if (body.sceneCompilation.version === 3 && typeof SceneSourceOverlay !== 'undefined') {
      var sourceCanvas = document.createElement('canvas'); sourceCanvas.width = 640; sourceCanvas.height = 360;
      sourceCanvas.style.maxWidth = '100%'; sourceCanvas.setAttribute('data-scene-source-preview','');sourceCanvas.setAttribute('aria-label', '原図の情報プレビュー。破線は3D再現ではありません');
      box.appendChild(sourceCanvas); SceneSourceOverlay.drawPreview(sourceCanvas, body.sceneIR, body.sceneCompilation.sourcePreview, {quietLabels:true});
      var previewNote=document.createElement('p');previewNote.className='airx-source-note';previewNote.setAttribute('data-scene-preview-selection','');previewNote.textContent='原図の情報（破線は3D再現ではありません）';box.appendChild(previewNote);
    }
    if (body.sceneCompilation.version === 3 && (body.sceneOptions.placementContext || ['walls','rooms','openings'].some(function(k){return (body.sceneIR[k] || []).some(function(e){return !e.floor || e.floor.value === null;});}))) {
      var destination = document.createElement('details'), legend = document.createElement('summary');destination.setAttribute('data-scene-placement','');
      destination.className = 'scene-placement-context';
      destination.open=!!(oldPlacement&&oldPlacement.open);
      legend.textContent = '取り込み先の階' + (body.sceneOptions.placementContext ? '（指定済み）' : '（未確認）'); destination.appendChild(legend);
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
      select.addEventListener('change', function () { if (!currentReview(body) || ST.result !== body) return; confirmed.checked = false; if (context) confirmScenePlacement(body, Number(select.value), false); });
      box.appendChild(destination);
    }
    var full = body.sceneFullCompilation || body.sceneCompilation;
    var audit = document.createElement('details'); audit.className = 'scene-placement-context';audit.setAttribute('data-scene-audit','');
    audit.open=!!(oldAudit&&oldAudit.open);
    var auditLegend = document.createElement('summary'); auditLegend.textContent = '全体の診断・検索'; audit.appendChild(auditLegend);
    var fullErrors = full.diagnostics.filter(function (d) { return d.severity === 'error'; });
    var auditStatus = document.createElement('p'); auditStatus.setAttribute('data-scene-full-status', '');
    auditStatus.textContent = '全体のエラー ' + fullErrors.length + ' 件 / 未解決 ' + full.unresolvedEntities.length + ' 項目 / 全体適用: ' + (full.canApply ? '確認済みの範囲で可能' : '不可'); box.appendChild(auditStatus);
    var diagnosticList = document.createElement('details'), diagnosticTitle = document.createElement('summary');
    diagnosticTitle.textContent = '全体の診断コードと対象を確認（' + fullErrors.length + ' 件）'; diagnosticList.appendChild(diagnosticTitle);
    var diagnostics = document.createElement('pre'); diagnostics.style.whiteSpace = 'pre-wrap'; diagnostics.setAttribute('data-scene-full-errors', '');
    diagnostics.textContent = fullErrors.map(function (d) { return d.code + ' — ' + d.path + '\n' + d.message; }).join('\n\n') || 'エラーはありません。推定値・表示仮定の確認は各項目に残ります。'; diagnosticList.appendChild(diagnostics); audit.appendChild(diagnosticList);
    var searchLabel = document.createElement('label'); searchLabel.textContent = '根拠・ID・診断コードを検索 ';
    var search = document.createElement('input'); search.type = 'search'; search.value = searchValue; search.setAttribute('data-scene-review-search', ''); search.setAttribute('data-scene-review-control', ''); searchLabel.appendChild(search); audit.appendChild(searchLabel);
    var filter = document.createElement('select'); filter.setAttribute('data-scene-review-filter', ''); filter.setAttribute('data-scene-review-control', ''); filter.setAttribute('aria-label', '根拠の表示対象');
    [['all','すべて'],['unresolved','全体で未解決'],['review','現在の範囲で確認が必要']].forEach(function (row) { var option = document.createElement('option'); option.value = row[0]; option.textContent = row[1]; filter.appendChild(option); }); filter.value = filterValue; audit.appendChild(filter);
    var visibleCount = document.createElement('p'); visibleCount.setAttribute('data-scene-filter-count', ''); visibleCount.setAttribute('aria-live', 'polite'); audit.appendChild(visibleCount); box.appendChild(audit);
    renderScenePartialControls(body, box, partialOptionsOpen, partialModeOpen);
    var entities = document.createElement('details');entities.setAttribute('data-scene-entities','');entities.className='scene-placement-context';entities.open=!!(entitiesOpen&&entitiesOpen.open);
    var entitiesTitle=document.createElement('summary');entitiesTitle.textContent='箇所を選ぶ（'+body.sceneCompilation.reviewGroups.length+'）';entities.appendChild(entitiesTitle);box.appendChild(entities);
    var rows = [];
    body.sceneCompilation.reviewGroups.forEach(function (group) {
      var detail = document.createElement('details'), summary = document.createElement('summary');
      detail.setAttribute('data-scene-group', group.id); detail.open = openGroups.indexOf(group.id) >= 0;
      summary.textContent = (body.sceneOptions.partialSelection&&body.sceneOptions.partialSelection.entityIds.indexOf(group.entityId)<0?'[原図のみ・未配置] ':'') + group.label + ' — ' + group.diagnostics.length + ' 項目' + (group.acknowledgedOmission ? '（未配置・未完成）' : '');
      detail.appendChild(summary);
      var fullGroup = full.reviewGroups.find(function (g) { return g.id === group.id; }) || group;
      if (body.sceneOptions.partialSelection && fullGroup.diagnostics.some(function (d) { return d.severity === 'error'; })) {
        summary.textContent += ' / 全体の未解決 ' + fullGroup.diagnostics.filter(function (d) { return d.severity === 'error'; }).length + ' 件';
        var remaining = document.createElement('pre'); remaining.style.whiteSpace = 'pre-wrap'; remaining.setAttribute('data-scene-full-group-errors', group.id);
        remaining.textContent = '原図全体で残る未解決（部分の承認では解消しません）\n' + fullGroup.diagnostics.filter(function (d) { return d.severity === 'error'; }).map(function (d) { return d.code + ' — ' + d.path + '\n' + d.message; }).join('\n\n'); detail.appendChild(remaining);
      }
      var fields = document.createElement('pre'); fields.style.whiteSpace = 'pre-wrap';
      fields.textContent = group.diagnostics.map(function (d) { return d.severity + ': ' + d.code + ' — ' + d.path + '\n' + d.message; }).join('\n\n') + '\n\n' +
        fullGroup.evidence.map(function (e) { return e.path + ': ' + e.status + ' ' + JSON.stringify(e.value) + (e.source ? '\n出典: ' + e.source : '') + (e.reason ? '\n理由: ' + e.reason : ''); }).join('\n');
      var evidenceDetails=document.createElement('details'),evidenceTitle=document.createElement('summary');evidenceTitle.textContent='根拠・診断の詳細';evidenceDetails.appendChild(evidenceTitle);evidenceDetails.appendChild(fields);detail.appendChild(evidenceDetails);
      if(group.collection==='objects'){var source=body.sceneIR.objects.find(function(e){return e.id===group.entityId;}),choices=sceneMappingCandidates(source,sceneCatalogue()),status=document.createElement('p');status.className='scene-mapping-summary';var reasons=[];choices.rejected.forEach(function(r){r.reasons.forEach(function(reason){if(reasons.indexOf(reason)<0)reasons.push(reason);});});status.textContent=choices.candidates.length?'表示用の'+(choices.candidates.length===1?'推奨候補1つ':'候補'+choices.candidates.length+'件（明示選択が必要）')+'。製品特定ではありません。':'候補なし — '+choices.reason+(reasons.length?' '+reasons.join('／'):'');detail.appendChild(status);}
      renderSceneMappingButton(body, group, detail);
      function choice(labelText, checked, change) {
        var label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.checked = checked; input.setAttribute('data-scene-review-control', '');
        input.setAttribute(labelText.indexOf('推定値') >= 0 ? 'data-scene-accept' : 'data-scene-omit', group.id);
        input.addEventListener('change', function () { change(input.checked); });
        label.appendChild(input); label.appendChild(document.createTextNode(labelText)); detail.appendChild(label);
      }
      if (group.reviewPaths.length) choice(' このオブジェクトの推定値を確認して採用する', group.accepted, function (on) {
        if (!currentReview(body) || ST.result !== body || ST.mappingEditor || body.sceneApplied || body.scenePartialOpened || ST.busy) return;
        var opts = JSON.parse(JSON.stringify(ST.result.sceneOptions));
        opts.acceptedReviewGroups = opts.acceptedReviewGroups.filter(function (id) { return id !== group.id; });
        if (on) { opts.acceptedReviewGroups.push(group.id); if (group.reviewKey) opts.reviewedEntities[group.entityId] = group.reviewKey; }
        else if (opts.reviewedEntities) delete opts.reviewedEntities[group.entityId];
        stageSceneIR(ST.result.sceneIR, opts);
      });
      if (group.canAcknowledgeOmission) choice(' この物は非必須の装飾であり、未配置のまま残すことを確認する（再構成は未完成）', group.acknowledgedOmission, function (on) {
        if (!currentReview(body) || ST.result !== body || ST.mappingEditor || body.sceneApplied || body.scenePartialOpened || ST.busy) return;
        var opts = JSON.parse(JSON.stringify(ST.result.sceneOptions));
        opts.unresolvedDecisions = opts.unresolvedDecisions.filter(function (d) { return d.entityId !== group.entityId; });
        if (on) { opts.unresolvedDecisions.push({ entityId: group.entityId, decision: 'leave-unplaced', classification: 'noncritical-decoration' }); if (group.reviewKey) opts.reviewedEntities[group.entityId] = group.reviewKey; }
        else if (opts.reviewedEntities) delete opts.reviewedEntities[group.entityId];
        stageSceneIR(ST.result.sceneIR, opts);
      });
      rows.push({node:detail, unresolved:fullGroup.diagnostics.some(function (d) { return d.severity === 'error'; }), review:group.reviewPaths.length > 0 && !group.accepted, text:(group.entityId + ' ' + detail.textContent).toLowerCase()});
      entities.appendChild(detail);
      detail.addEventListener('toggle',function(){
        if(!detail.open||ST.result!==body)return;
        box.setAttribute('data-selected-entity',group.entityId);
        var canvas=box.querySelector('[data-scene-source-preview]'),note=box.querySelector('[data-scene-preview-selection]');
        if(canvas&&typeof SceneSourceOverlay!=='undefined')SceneSourceOverlay.drawPreview(canvas,body.sceneIR,body.sceneCompilation.sourcePreview,{quietLabels:true,highlightIds:[group.entityId]});
        if(note)note.textContent='選択中: '+group.label+'（原図の情報）';
      });
    });
    function filterRows() {
      if (ST.result !== body) return;
      var query = search.value.trim().toLowerCase(), count = 0;
      rows.forEach(function (row) { var show = (!query || row.text.indexOf(query) >= 0) && (filter.value === 'all' || filter.value === 'unresolved' && row.unresolved || filter.value === 'review' && row.review); row.node.hidden = !show; if (show) count++; });
      visibleCount.textContent = count + ' / ' + rows.length + ' 項目を表示。絞り込みは診断・適用条件を変更しません。';
    }
    search.addEventListener('input', filterRows); filter.addEventListener('change', filterRows); filterRows();
    if(root.SceneReviewFlow)root.SceneReviewFlow.enhance(body,box);
    host.appendChild(box);
    if(selectedEntity){var selected=rows.find(function(row){return row.node.open&&row.node.getAttribute('data-scene-group').split(':').slice(1).join(':')===selectedEntity;});if(selected)selected.node.dispatchEvent(new Event('toggle'));}
  }

  function confirmScenePlacement(expectedResult, targetFloor, singleLevelConfirmed) {
    if (!expectedResult || !currentReview(expectedResult) || ST.result !== expectedResult || ST.mappingEditor || ST.busy || (expectedResult.sceneApplied||expectedResult.scenePartialOpened) || expectedResult.sceneOptions.sourceInvalidated || expectedResult.sceneIR.sceneVersion !== 3) return null;
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
  function copyReviewedWallProperties(made,w) {
    ['wallStyle','color','colorCustom','wallHeight','wallHeightMm','texture','textureFlipX','textureFlipY','railFrameColor','railCapColor','railInfill','fencePattern'].forEach(function(k){if(w[k]!==undefined)made[k]=JSON.parse(JSON.stringify(w[k]));});
    if(w.sourceObjectMapping)made.sourceObjectMapping=JSON.parse(JSON.stringify(w.sourceObjectMapping));
  }
  // Preserve only dimension fields, not another full plan/image/response copy.
  function legacyReaderDimensionFact(value, provided, key, invalid) {
    if (!provided || value === null && !invalid) return {provided:provided,value:null,status:'unknown'};
    var numeric = typeof value === 'number' || typeof value === 'string' && value.length <= 32 && value.trim() !== '';
    if (!invalid && numeric && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 200000) {
      return {provided:true,value:value,status:'reader-reported-unverified'};
    }
    return {provided:true,value:null,status:'invalid',diagnostic:{code:'invalid_reader_dimension',field:key}};
  }

  function sanitizeLegacyReaderDimensions(input) {
    var type = input && input.type;
    var out = {type:typeof type === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(type) ? type : null};
    if (out.type === null) out.typeDiagnostic = {code:'invalid_reader_item_type',field:'type'};
    ['w','d'].forEach(function(key) {
      var f = input && input[key];
      out[key] = legacyReaderDimensionFact(f && f.value, !!(f && f.provided === true), key, !!(f && f.status === 'invalid'));
    });
    return out;
  }

  function legacyReaderDisplaySnapshot(item) {
    var checked = sanitizeLegacyReaderDimensions({type:item.type,
      w:{provided:item.w !== undefined,value:item.w},d:{provided:item.d !== undefined,value:item.d}});
    var out = {type:checked.type,w:checked.w.value,d:checked.d.value,basis:'legacy-catalogue-and-renderer-assumptions'};
    if (checked.typeDiagnostic) out.typeDiagnostic = checked.typeDiagnostic;
    ['w','d'].forEach(function(key) { if (checked[key].diagnostic) out[key+'Diagnostic'] = {code:'invalid_display_dimension',field:key}; });
    return out;
  }

  function legacyReaderDimensionSnapshot(plan) {
    return (plan.items || []).map(function(it) {
      var out = {type:it.type};
      ['w','d'].forEach(function(key) {
        var provided = Object.prototype.hasOwnProperty.call(it, key) && it[key] !== undefined;
        out[key] = legacyReaderDimensionFact(it[key], provided, key, false);
      });
      return sanitizeLegacyReaderDimensions(out);
    });
  }

  function toAppObjects(plan, readerDimensions) {
    var out = { walls: [], rooms: [], items: [] };
    (plan.walls || []).forEach(function (w) {
      var made = mkWall(w.x1, w.y1, w.x2, w.y2, w.floor || 1, w.thick);
      copyReviewedWallProperties(made,w);out.walls.push(made);
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
      if(r.sourceRoomMapping){made.floorRaiseMm=r.floorRaiseMm;made.floorMaterial=r.floorMaterial;made.sourceRoomMapping=JSON.parse(JSON.stringify(r.sourceRoomMapping));}
      out.rooms.push(made);
    });
    // 構造部材（基礎・屋根）はここでは作らない。**いまの間取りと合わせた
    // 壁から決まる**ので、階を差し替えたあと withStructure で作る。
    (plan.items || []).forEach(function (it, itemIndex) {
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
      if (readerDimensions && readerDimensions[itemIndex]) made.legacyReaderDimensions = {
        version:1,origin:'app-v1-plan-before-finish-picks',sourceMeasurementStatus:'unverified',extentRole:'unspecified',
        input:sanitizeLegacyReaderDimensions(readerDimensions[itemIndex]),
        displayAtImport:legacyReaderDisplaySnapshot(made)
      };
      if(it.sourceObjectMapping){made.sourceObjectMapping=JSON.parse(JSON.stringify(it.sourceObjectMapping));['color','colorCustom','modelFacingVersion','latticeHeight','fencePattern','railInfill','railFrameColor','railCapColor','elev','latticeCap','latticePitch','latticeSlat'].forEach(function(k){if(it[k]!==undefined)made[k]=it[k];});}
      if(made.sourceObjectMapping?.catalogueDisplay&&typeof SourceObjectMapping!=='undefined')made.sourceObjectMapping.editorDisplayBaseline=SourceObjectMapping.displayGeometry(made);
      if(made.sourceObjectMapping?.sourceKind==='manual-source-image-annotation')made.sourceObjectMapping.importedDisplayGeometry=Object.fromEntries(['floor','x','y','w','d','rot','flipX','flipY','latticeHeight','elev','fencePattern','railInfill','railFrameColor','latticeCap','latticePitch','latticeSlat'].map(k=>[k,made[k]??null]));
      if(it.sourceStairDisplay){['stairDisplayOnly','displayRiseMm','displayBaseOffsetMm','stairOrder','stairTarget','flipX','flipY','baseRoom','baseLevel','sourceStairDisplay'].forEach(function(k){if(it[k]!==undefined)made[k]=JSON.parse(JSON.stringify(it[k]));});}
      if(it.sourceFixtureMapping)made.sourceFixtureMapping=JSON.parse(JSON.stringify(it.sourceFixtureMapping));
      if(/^door-/.test(it.type)&&(it.doorOpenState==='open'||it.doorOpenState==='closed'))made.doorOpenState=it.doorOpenState;
      out.items.push(made);
    });
    if(plan.sourceOpeningReviewRequested&&typeof SourceOpeningReview!=='undefined')return SourceOpeningReview.bind(plan.items||[],out,{ownedOutput:true}).plan;
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
      finishData: typeof CATALOGUE_FINISHES === 'object' ? CATALOGUE_FINISHES : null,
      finishModels: finishModels,
      builtins: typeof ISIZES === 'object' ? ISIZES : {},
      builtinAssets: typeof CONTEXT_CAR_GLB === 'string' && CONTEXT_CAR_GLB === SceneCatalogue.carCertificate.url ? {car:SceneCatalogue.carCertificate} : {},
      aliases: typeof LEGACY_FMP_TYPE_MAP === 'object' ? LEGACY_FMP_TYPE_MAP : {},
      textureIds: typeof MODEL_FINISH_TEXTURES === 'object' ? MODEL_FINISH_TEXTURES.map(function (p) { return p[0]; }) : [],
    });
  }

  function previewSceneIR(scene, options) {
    options = options || {};
    var target=options.targetSnapshot!==undefined?options.targetSnapshot:(typeof DATA==='object'?JSON.parse(JSON.stringify(DATA)):{});
    var compiled = SceneIR.previewSnapshot(scene,target, {
      registry: options.registry || sceneCatalogue(),
      materialization: options.materialization,
      placementContext: options.placementContext || null,
      partialSelection: options.partialSelection || null,
      pageScope: options.pageScope || null,
      bindingDecisions: options.bindingDecisions || [],
      reviewedEntities: options.reviewedEntities || {},
      acceptedReviews: options.acceptedReviews || [],
      acceptedReviewGroups: options.acceptedReviewGroups || [],
      unresolvedDecisions: options.unresolvedDecisions || [],
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
    if (ST.result && ST.result.sceneIR && !currentReview(ST.result)) {
      options=Object.assign({},options,{acceptedReviews:[],acceptedReviewGroups:[],reviewedEntities:{},unresolvedDecisions:[],placementContext:null,targetSnapshot:typeof DATA==='object'?JSON.parse(JSON.stringify(DATA)):{}});
    }
    ST.mappingEditor = null;
    ST.requestVersion++;
    var input = JSON.parse(JSON.stringify(scene));
    // Both scopes use the same detached editor snapshot and unchanged source.
    options = Object.assign({}, options, {targetSnapshot: options && options.targetSnapshot !== undefined ? options.targetSnapshot : (typeof DATA === 'object' ? JSON.parse(JSON.stringify(DATA)) : {})});
    var compiled = previewSceneIR(input, options);
    var fullCompiled = options.partialSelection ? previewSceneIR(input, Object.assign({}, options, {partialSelection:null})) : compiled;
    options=Object.assign({},options,{bindingDecisions:JSON.parse(JSON.stringify(options&&options.bindingDecisions||[]))});
    (compiled.appearanceProfiles||[]).forEach(function(p){var decision=options.bindingDecisions.find(function(d){return d.binding&&d.binding.sourceEntityId===p.sourceEntityId;});if(decision)decision.appearanceProvenance=JSON.parse(JSON.stringify(p.provenance));});
    ST.result = { sceneIR: input, sceneOptions: { materialization: options && options.materialization,
        sourceInvalidated: !!(options && options.sourceInvalidated),
        destinationFloor: options && options.destinationFloor,
        placementContext: JSON.parse(JSON.stringify(options && options.placementContext || null)),
        partialSelection: JSON.parse(JSON.stringify(options && options.partialSelection || null)),
        pageScope: JSON.parse(JSON.stringify(options && options.pageScope || null)),
        reviewedEntities: JSON.parse(JSON.stringify(options && options.reviewedEntities || {})),
        bindingDecisions: JSON.parse(JSON.stringify(options && options.bindingDecisions || [])), acceptedReviews: (options && options.acceptedReviews || []).slice(),
        acceptedReviewGroups: (options && options.acceptedReviewGroups || []).slice(),
        unresolvedDecisions: JSON.parse(JSON.stringify(options && options.unresolvedDecisions || [])),
        extraction: options && options.extraction ? JSON.parse(JSON.stringify(options.extraction)) : null },
      sceneCompilation: compiled, sceneFullCompilation: fullCompiled, plan: compiled.plan,
      extraction: options && options.extraction ? JSON.parse(JSON.stringify(options.extraction)) : null,
      summary: { walls: compiled.plan.walls.length, rooms: compiled.plan.rooms.length,
        items: compiled.plan.items.length, floors: floorsOfObjects(compiled.plan.walls, compiled.plan.rooms, compiled.plan.items) },
      notes: compiled.suggestions.map(function (s) { return s.path + ': ' + s.reason + ' (suggestion only)'; }).concat(
        compiled.defaults.map(function (d) { return d.path + ': ' + (d.value === null ? '既定値' : JSON.stringify(d.value)) + ' [' + d.provenance + '] 図面から読み取った値ではありません'; })),
      warnings: [compiled.reviewGroups.length + ' 個のオブジェクト・判断を確認できます。項目を開くと根拠と個別パラメータを表示します。'].concat(
        compiled.acknowledgedOmissions.length ? ['未配置 ' + compiled.acknowledgedOmissions.length + ' 点を残す未完成の再構成です。完全な再現ではありません。'] : [],
        compiled.diagnostics.filter(function (d) { return !compiled.reviewGroups.some(function (g) { return d.path === g.path || d.path.indexOf(g.path + '.') === 0; }); }).map(function (d) { return d.path + ': ' + d.message; })),
    };
    bindReview(ST.result);
    renderPlanImportResult(ST.result);
    var button = $('plan-import-apply');
    if (button) {button.disabled = !compiled.canApply;button.textContent=ST.result.sceneOptions.partialSelection?'確認した部分を新しい案で開く':'取り込む';}
    syncPlanImportResultUi();
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
      var id=made.id;Object.assign(made,JSON.parse(JSON.stringify(w)),{id:id});idMap[w.id] = made.id; out.walls.push(made);
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

  function reconstructionReport(body, compiled, read, translationX) {
    var report={id:'scene_'+(nextId++),version:compiled.version,status:compiled.reconstructionStatus,originalIR:JSON.parse(JSON.stringify(body.sceneIR)),sourceIdMap:read.sourceIdMap,translation:{x:translationX,y:0},evidence:compiled.evidence,defaults:compiled.defaults,unresolvedEntities:compiled.unresolvedEntities,acknowledgedOmissions:compiled.acknowledgedOmissions,reviewDecisions:JSON.parse(JSON.stringify(body.sceneOptions)),diagnostics:compiled.diagnostics};
    if(compiled.version===3){report.placementContext=compiled.placementContext?JSON.parse(JSON.stringify(compiled.placementContext)):null;report.sourcePreview=JSON.parse(JSON.stringify(compiled.sourcePreview));report.extraction=body.extraction?JSON.parse(JSON.stringify(body.extraction)):null;if(compiled.unmatchedSourceRegions)report.unmatchedSourceRegions=JSON.parse(JSON.stringify(compiled.unmatchedSourceRegions));if(compiled.partialSelection){report.partialSelection=JSON.parse(JSON.stringify(compiled.partialSelection));report.deferredEntities=JSON.parse(JSON.stringify(compiled.deferredEntities));report.fullReconstructionReady=false;}}
    return report;
  }
  async function openScenePartialPlan(expected) {
    if(!expected||!currentReview(expected)||ST.result!==expected||ST.busy||ST.mappingEditor||expected.scenePartialOpened||expected.sceneOptions.sourceInvalidated)return;
    var compiled=previewSceneIR(expected.sceneIR,expected.sceneOptions);
    if(!compiled.canApply||!compiled.partialSelection){
      // The target defaults/catalogue may have changed since the last review.
      // Restage both selected and full diagnostics; retire the stale controls.
      stageSceneIR(expected.sceneIR,expected.sceneOptions);
      setStatus('選んだ部分の候補・表示仮定・未解決項目を確認してください。既存の案は変更していません。');return;
    }
    var workspace=root.EDITOR_PANE&&root.parent.PlanLibrary?root.parent.PlanLibrary:root.PlanLibrary||root.ParallelEditors,common=typeof workspace?.createIndependentPlan==='function';
    if(!workspace||!common&&typeof workspace.openPlan!=='function'){setStatus('新しい案の編集画面を開けません。既存の案へは適用しません。');return;}
    var read=materializeSceneObjects(compiled.plan),payload={walls:read.walls,rooms:read.rooms,items:read.items,heightDefaults:JSON.parse(JSON.stringify(DATA.heightDefaults||{modelVersion:2,floorThickness:180})),floors:JSON.parse(JSON.stringify(DATA.floors||{})),sceneReconstructionReports:[reconstructionReport(expected,compiled,read,0)]};
    if(root.SceneReviewFlow)root.SceneReviewFlow.reviewInteraction();
    var sourceText=typeof root.serializeDataSnapshot==='function'?root.serializeDataSnapshot():null;
    var context=captureContext();
    var current=function(){return context.isCurrent() && currentReview(expected) && ST.result===expected&&!expected.sceneOptions.sourceInvalidated&&(sourceText===null||root.serializeDataSnapshot()===sourceText)&&!root._editorPaneDisposed;};
    ST.busy=true;syncPlanImportButtons();
    try{var id=common?await workspace.createIndependentPlan(payload,'原図からの部分プレビュー（未完成）',{sourcePaneId:root.EDITOR_PANE||root.NATIVE_EDITOR_PANE||null,sourcePlanId:root.__editorPlanId,sourceSnapshot:sourceText,isCurrent:current,cataloguePack:root.AssetPackPicker?.getSelection()}):await workspace.openPlan(payload,'原図からの部分プレビュー（未完成）');if(!current()){if(!common)await workspace.remove(id);return;}expected.scenePartialOpened=true;expected.partialPlanId=id;var reviewModal=$('plan-import-modal');if(reviewModal)reviewModal.classList.remove('show');setStatus(common?'確認した部分を共通一覧の新しい案へ追加しました。未完成の根拠と元の案を保持しています。':'確認した部分を新しい案で開きました。未配置の根拠を保持する未完成のプレビューです。元の案は変更していません。');return id;}
    catch(error){if(current())setStatus(error.message);}
    finally{if(current()){ST.busy=false;syncPlanImportButtons();}context.done();}
  }

  function applyPlanImport() {
    // Explicit legacy caller staging can replace the result; stale review callbacks cannot.
    if (!root.EditorPane && ST.result && reviewOwner && ST.result !== reviewOwner.body) bindReview(ST.result);
    if (!ST.result || !ST.result.plan || ST.result.importApplied || ST.result.sceneApplied || ST.result.scenePartialOpened || ST.result.buildingApplied || ST.mappingEditor) return;
    if (typeof DATA === 'undefined' || !DATA || ST.busy || !targetOwner()) return;
    if (!currentReview(ST.result)) {
      if(reviewOwner&&reviewOwner.source!==sourceKey()&&!ST.result.sceneIR)ST.result.sourceInvalidated=true;
      revalidateReview();setStatus('編集先または原図が変わりました。原本と選択は保持し、現在の条件で再確認してください。まだ適用していません。');syncPlanImportButtons();return;
    }
    if(root.SceneReviewFlow)root.SceneReviewFlow.reviewInteraction();
    if(ST.result.sceneIR&&ST.result.sceneOptions.partialSelection)return openScenePartialPlan(ST.result);
    var buildingCompilation = ST.result.sourceLocal ? compileBuildingReview(ST.result) : null;
    if (ST.result.sourceLocal && (!buildingCompilation || !buildingCompilation.canApply)) {
      setStatus('複数階の位置合わせに未確認・矛盾があります。適用せず確認へ戻ります。'); syncPlanImportButtons(); return;
    }
    var readerDimensions = null;
    if (root.LEGACY_READER_DIMENSION_RETENTION === true && !ST.result.sceneIR && !ST.result.sourceLocal) {
      if (!ST.result.legacyReaderDimensionSnapshot) ST.result.legacyReaderDimensionSnapshot = legacyReaderDimensionSnapshot(ST.result.plan);
      readerDimensions = ST.result.legacyReaderDimensionSnapshot;
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
        stageSceneIR(ST.result.sceneIR, ST.result.sceneOptions);
        setStatus('Scene IR に未解決項目があります。適用せずに確認へ戻ります。');
        return;
      }
    }
    var candidatePlan = sceneCompilation ? sceneCompilation.plan : buildingCompilation ? buildingCompilation.plan : ST.result.plan;
    if(buildingCompilation){try{candidatePlan=mapReviewedStairDisplay(mapReviewedSourceObjects(mapReviewedFixtures(candidatePlan,ST.result),ST.result),ST.result);}catch(error){setStatus(error.message);return;}}
    if(!sceneCompilation)candidatePlan=mapReviewedReaderOpenings(candidatePlan,ST.result);
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

    if (!currentReview(ST.result)) return;
    var read;try{read=sceneCompilation ? materializeSceneObjects(candidatePlan) : toAppObjects(candidatePlan, readerDimensions);}catch(error){setStatus(error.message);return;}

    if(beside){try{var here=planBounds(base),there=planBounds(read);if(here&&there){sceneTranslationX=Math.round(here.x1-there.x0+BESIDE_GAP_MM);shiftPlan(read,sceneTranslationX);if(typeof SourceOpeningReview!=='undefined')SourceOpeningReview.initialTranslation(read,sceneTranslationX);if(typeof SourceObjectMapping!=='undefined')SourceObjectMapping.initialTranslation(read,sceneTranslationX);}}catch(error){setStatus(error.message);return;}}

    // 取り消せるようにしてから触る。**丸ごと差し替えていた頃は、取り込みが
    // 最後の操作になるので履歴を捨てていた。** いまは元の間取りが残る以上、
    // 押し間違いを1手で戻せるべきである。
    if (!currentReview(ST.result)) return;
    if (typeof saveState === 'function') saveState();
    root._defaultPlanPending = false;
    // Consume this reviewed import once before post-commit callbacks can fail.
    // Undo remains available; a render error must never duplicate its geometry.
    ST.result.importApplied = true;
    if (buildingCompilation) ST.result.buildingApplied = true;
    if (sceneCompilation) ST.result.sceneApplied = true;

    if (beside) {
      // 隣へずらしてから構造部材を作る。順番が逆だと、基礎と屋根だけが
      // 元の位置に残る。
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
        objectDecisions:JSON.parse(JSON.stringify(ST.result.objectDecisions||[])),
        sourceImageAnnotations:JSON.parse(JSON.stringify(ST.result.sourceImageAnnotations||[])),
        stairDisplayDecisions:JSON.parse(JSON.stringify(ST.result.stairDisplayDecisions||[])),
        fixtureDecisions:JSON.parse(JSON.stringify(ST.result.fixtureDecisions||[])),
        entryFloorDecisions:JSON.parse(JSON.stringify(ST.result.entryFloorDecisions||[])),
        poses:buildingCompilation.poses,translation:{x:sceneTranslationX,y:0},
        displayHeightAssumptions:JSON.parse(JSON.stringify({floors:DATA.floors||null,heightDefaults:DATA.heightDefaults||null})),
        registrationExtraction:ST.result.registrationExtraction||null
      }]);
    }
    if (sceneCompilation) {
      // Additive top-level provenance survives ordinary save/load and undo. It is
      // deliberately separate from live geometry and cannot authorize later actions.
      var report=reconstructionReport(ST.result,sceneCompilation,read,sceneTranslationX);
      DATA.sceneReconstructionReports = (base.sceneReconstructionReports || []).concat([report]);
    }
    try {
    syncBuildingNotice();
    // Reader direction may be unknown. Keep diagnostics and native edit controls;
    // never reverse source-derived doors just because one side has more wall.
    // 読み込み経路(doImport)と同じ手順で、アプリが期待する既定値をそろえる。
    if (typeof syncNorthFromPlan === 'function') syncNorthFromPlan();
    if (typeof ensureObjectIds === 'function') ensureObjectIds();
    if (typeof ensureExteriorWallSettings === 'function') ensureExteriorWallSettings();
    if (typeof ensureInteriorWallSettings === 'function') ensureInteriorWallSettings();
    if (typeof ensureRoofAppearance === 'function') ensureRoofAppearance();
    if (typeof ensureFloorMetadata === 'function') ensureFloorMetadata();
    if(typeof SourceObjectMapping!=='undefined'&&typeof item3DBaseY==='function')SourceObjectMapping.captureSupportBaseline(read.items,function(it){return item3DBaseY(it)/(typeof U==='number'?U:.001);});
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
    closePlanImport();
    } catch (error) {
      if (!buildingCompilation && !sceneCompilation) throw error;
      setStatus('取り込みは案へ反映しましたが、表示の更新に失敗しました。重複を防ぐため再適用はできません。元に戻す操作で取り消せます。');
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
  root.setPlanImportExtractionMode = setPlanImportExtractionMode;
  root.runPlanImport = runPlanImport;
  root.applyPlanImport = applyPlanImport;
  // 検査から中身を覗くため
  root.PlanImport = {
    state: ST,
    capture: captureImport, restore: restoreImport, invalidate: invalidateImport, captureContext: captureContext, transportContext: transportContext, claimTransportRequest: claimTransportRequest, currentReview: currentReview,
    hasUnexportedReview: function () { return !!(ST.result || ST.failedSceneResponse || ST.image || ST.originalImageSource || ST.pages || ST.pdfData || ST.fileName); },
    get epoch() { return importEpoch; },
    croppedDataUrl: croppedDataUrl,
    toAppObjects: toAppObjects,
    legacyReaderDimensionSnapshot: legacyReaderDimensionSnapshot,
    previewSceneIR: previewSceneIR,
    stageSceneIR: stageSceneIR,
    confirmScenePlacement: confirmScenePlacement,
    sceneCatalogue: sceneCatalogue,
    sceneMappingCandidates: sceneMappingCandidates,
    showPlanImportError: showPlanImportError,
    showQuota: showQuota,
    renderPlanImportResult: renderPlanImportResult,
    focusReviewIssue: focusReviewIssue,
    focusSceneReviewGroup: focusSceneReviewGroup,
    stageBuildingReview: stageBuildingReview,
    bathtubCandidates: bathtubCandidates,
    entryFloorCandidates: entryFloorCandidates,
    mapReviewedFixtures: mapReviewedFixtures,
    buildingObjectCandidates: buildingObjectCandidates,
    mapReviewedSourceObjects: mapReviewedSourceObjects,
    syncBuildingNotice: syncBuildingNotice,
    compileBuildingReview: compileBuildingReview,
    requestBuildingRegistration: requestBuildingRegistration,
    reviewChanges: reviewChanges,
    fitContain: fitContain,
    validPlanBox: validPlanBox,
    MAX_SEND_PX: MAX_SEND_PX,
  };
}(typeof self !== 'undefined' ? self : this));
