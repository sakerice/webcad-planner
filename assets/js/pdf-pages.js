// PDF を、1ページずつの画像に変換する。
//
// なぜ在るのか
// ------------
// PDF をそのまま AI へ渡していたが、**1ページあたり約260トークンしか使われて
// いなかった**。これは 768 画素角のタイル1枚ぶんで、その中に紙面全体が
// 収まる。試した図面では平面図が紙面の6%しかないため、平面図の部分は
// 幅190画素ほどになり、寸法の文字は読めない。
//
// 実測（同じ1ページ・gemini-2.5-flash）:
//
//   PDFのまま          260 トークン/ページ
//   画像 768〜2072px  1,821 トークン
//   画像 3072px       3,369 トークン
//   画像 6144px       3,369 トークン（頭打ち）
//
// こちらでページを画像にしてから送れば13倍の情報量になる。頭打ちが
// あるので、3072 画素を超えて大きくしても意味はない。
//
// pdf.js は assets/vendor/pdfjs/ に自前で置いている。CDN に依存すると、
// そこが読めない環境で PDF だけ黙って使えなくなる（iPad Safari で three.js が
// 読めず3Dが全滅した件と同じ形の事故になる）。読み込みは PDF を選んだときの
// 1回だけで、通常の起動には影響しない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfPages = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // 送る画像の長辺。これ以上大きくしても、AI 側が読む解像度は増えない。
  var MAX_PAGE_PX = 3072;
  // 1回に読むページ数の上限。各ページが各階になる。
  var MAX_PAGES = 8;

  var BASE = 'assets/vendor/pdfjs/';
  var loading = null;

  function loadPdfjs() {
    if (loading) return loading;
    loading = import(new URL(BASE + 'pdf.min.mjs', document.baseURI).href)
      .then(function (mod) {
        var lib = mod.default && mod.default.getDocument ? mod.default : mod;
        lib.GlobalWorkerOptions.workerSrc = new URL(BASE + 'pdf.worker.min.mjs', document.baseURI).href;
        return lib;
      })
      .catch(function (e) {
        loading = null;
        throw new Error('PDFを開く部品を読み込めませんでした: ' + (e && e.message ? e.message : e));
      });
    return loading;
  }

  // data URL (application/pdf) を、ページごとの PNG の data URL にする。
  //
  //   onProgress(何ページ目, 全ページ数) … 進み具合を画面に出すため
  function renderPages(dataUrl, options) {
    options = options || {};
    var maxPx = options.maxPx || MAX_PAGE_PX;
    var onProgress = options.onProgress || function () {};
    return loadPdfjs().then(function (pdfjs) {
      var bin = atob(String(dataUrl).replace(/^data:[^,]*,/, ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return pdfjs.getDocument({ data: bytes }).promise;
    }).then(function (doc) {
      var total = Math.min(doc.numPages, MAX_PAGES);
      var pages = [];
      var next = function (n) {
        if (n > total) return pages;
        onProgress(n, total);
        return doc.getPage(n).then(function (page) {
          var base = page.getViewport({ scale: 1 });
          var scale = maxPx / Math.max(base.width, base.height);
          var view = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(view.width);
          canvas.height = Math.round(view.height);
          var ctx = canvas.getContext('2d');
          // 図面は白地。透過のまま送ると背景が黒く出ることがある。
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          return page.render({ canvasContext: ctx, viewport: view }).promise.then(function () {
            pages.push(canvas.toDataURL('image/png'));
            return next(n + 1);
          });
        });
      };
      return next(1);
    });
  }

  // ページの一部分だけを、長辺 maxPx で描き直す。
  //
  // **縮小した絵を拡大するのではなく、PDFから描き直す。** ベクターなので、
  // 切り出した範囲を大きく描けば、その範囲の線と文字がそのぶん鮮明になる。
  // 紙面の6%しかない平面図を、上限いっぱいの解像度で送れるようになる。
  //
  //   box … {x0,y0,x1,y1} 0〜1 の割合。ページの左上が (0,0)
  function renderRegion(dataUrl, pageNo, box, options) {
    options = options || {};
    var maxPx = options.maxPx || MAX_PAGE_PX;
    return loadPdfjs().then(function (pdfjs) {
      var bin = atob(String(dataUrl).replace(/^data:[^,]*,/, ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return pdfjs.getDocument({ data: bytes }).promise;
    }).then(function (doc) {
      return doc.getPage(pageNo);
    }).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var w = base.width * (box.x1 - box.x0);
      var h = base.height * (box.y1 - box.y0);
      if (!(w > 0) || !(h > 0)) return null;
      var scale = maxPx / Math.max(w, h);
      var view = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // 切り出したい範囲が原点に来るようにずらしてから描く。
      ctx.translate(-base.width * box.x0 * scale, -base.height * box.y0 * scale);
      return page.render({ canvasContext: ctx, viewport: view }).promise.then(function () {
        return canvas.toDataURL('image/png');
      });
    });
  }

  // 画像（PDFでないもの）の一部分を切り出す。こちらは元の画素しか無いので、
  // 拡大はしない。切り出して、上限を超えていれば縮めるだけ。
  function cropImage(img, box, options) {
    options = options || {};
    var maxPx = options.maxPx || MAX_PAGE_PX;
    var sx = Math.round(img.naturalWidth * box.x0);
    var sy = Math.round(img.naturalHeight * box.y0);
    var sw = Math.round(img.naturalWidth * (box.x1 - box.x0));
    var sh = Math.round(img.naturalHeight * (box.y1 - box.y0));
    if (!(sw > 0) || !(sh > 0)) return null;
    var scale = Math.min(1, maxPx / Math.max(sw, sh));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  // 位置を聞くために送る、小さい絵。位置が分かればよいので粗くてよい。
  function shrink(dataUrl, maxPx) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, (maxPx || 1024) / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = function () { reject(new Error('画像を開けませんでした')); };
      img.src = dataUrl;
    });
  }

  return {
    renderPages: renderPages,
    renderRegion: renderRegion,
    cropImage: cropImage,
    shrink: shrink,
    MAX_PAGE_PX: MAX_PAGE_PX,
    MAX_PAGES: MAX_PAGES,
  };
}));
