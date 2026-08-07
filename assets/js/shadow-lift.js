// 生成AIに渡す前に、自分のレンダで潰れた暗部を持ち上げる。
//
// これは好みの話ではなく計測の結果。生成AIが「保て」と言われた仕上げをドリフト
// させるかどうかを最も強く予測するのは、テクスチャでも複雑さでもプロンプトの書き方
// でもなく、こちらのレンダがその部材をどれだけ暗くしたか (Pearson -0.81)。
// 輝度30以下に潰れた部材のドリフト中央値は 43.7、それ以外は 7.4。
// 真値 #010302 の部材に「保て」と指示するのは、見えていないものを保てと言うのと同じ。
// だから仕上げの保持はプロンプト側ではなく素材側の仕事になる。
//
// 使い方は「測る → カーブを決める → 適用する → カーブを記録する」。
// 記録が要るのは、判定器が「生成結果 vs モデルが実際に見た絵」を比べるため。
// 持ち上げ前のレンダと比べてしまうと、自分で入れた補正がドリフトとして数えられる。
//
// 前提と決めごと:
//   - 輝度は R,G,B の単純平均。計測がこの定義で取られているので、知覚重み付けに
//     変えてはいけない。閾値 30 が黙ってずれる。
//   - カーブは画像全体にかけるガンマ1本。部材ごとに補正すると部材同士の明るさの
//     関係が変わり、設計そのものを偽ることになる。
//   - FREE の部材は持ち上げの理由にならない。そこは生成AIが作ってよい領域。
//   - ガイドに1画素も出てこない部材 (このカメラから隠れている) は測れないので、
//     カーブを引っぱらせない。
//   - ハイライトはクリップさせない。255 は 255 のまま。
//
// ImageData について: node には ImageData が無いので、この module は
// {data, width, height} という素の形だけを扱い、ImageData コンストラクタを
// 一切参照しない。ブラウザの ImageData は構造的に同じなのでそのまま渡せる。
// canvas に書き戻すときだけ、呼び出し側で
// new ImageData(out.data, out.width, out.height) を作ること。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShadowLift = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // 計測で校正された閾値。ここを動かすと -0.81 の根拠から外れる。
  var FLOOR_LUMINANCE = 30;

  // 持ち上げの下限。ガンマは画像全体にかかるので、極端に暗い部材1つのために
  // ここを下げると、その1つのために絵全体が白茶ける。既定は「ほぼ無制限」で、
  // brief の規則 (最も暗い部材が床に届くまで持ち上げる) をそのまま満たす値。
  // 実測 (T96) では真っ黒に近い部材1つが 0.285 を要求し、画面の 78% が輝度200以上に
  // なった。ここを締めたい場合は curveFor(..., {minGamma: n}) で明示的に締めること。
  // 締めた結果として床に届かなかった部材は unliftableColors に残るので、
  // 「持ち上げで誤魔化す」のではなく「その部材の照明を直す」判断ができる。
  var MIN_GAMMA = 0.2;

  // 床ちょうどを狙うと、解いた平均と測り直した平均が浮動小数の最終桁でずれて
  // 30 をわずかに割ることがある。整数値の LUT に対する余白としては十分小さい。
  var FLOOR_EPSILON = 1e-3;

  function isImageLike(im) {
    return !!im && !!im.data && typeof im.width === 'number' && typeof im.height === 'number';
  }

  // '#rrggbb' -> 0xrrggbb。読めなければ -1。
  function parseHexColor(color) {
    if (typeof color !== 'string') return -1;
    var s = color.charAt(0) === '#' ? color.slice(1) : color;
    if (s.length !== 6) return -1;
    var v = parseInt(s, 16);
    if (isNaN(v) || v < 0 || v > 0xffffff) return -1;
    return v;
  }

  // ガンマ LUT。apply が実際に使うものと、curveFor が解くときに使うものは
  // 同じでなければならない。丸めまで含めて一致していないと、解いた床を
  // 測り直しが下回る。
  function lutFor(gamma) {
    var lut = new Array(256);
    var i;
    for (i = 0; i < 256; i++) {
      var out = Math.round(255 * Math.pow(i / 255, gamma));
      if (out < 0) out = 0;
      if (out > 255) out = 255;
      lut[i] = out;
    }
    lut[0] = 0;
    lut[255] = 255; // ハイライトは動かさない (0^g=0, 1^g=1 なので本来こうなるが、明示する)
    return lut;
  }

  // 部材ごとに、base の平均輝度・画素数・チャンネル値のヒストグラムを集める。
  // ヒストグラムを持つのは curveFor が「持ち上げた後の平均」を推測ではなく
  // 厳密に計算できるようにするため。ガンマは凹関数なので、平均に対してガンマを
  // 解くと必ず持ち上げ不足になる (Jensen)。
  function measure(baseData, instanceData, tierTable) {
    if (!isImageLike(baseData) || !isImageLike(instanceData)) {
      throw new Error('ShadowLift.measure: expected {data,width,height} for base and instance');
    }
    if (baseData.width !== instanceData.width || baseData.height !== instanceData.height) {
      throw new Error('ShadowLift.measure: base ' + baseData.width + 'x' + baseData.height +
        ' and instance ' + instanceData.width + 'x' + instanceData.height +
        ' must come from the same camera at the same size');
    }

    var table = tierTable || {};
    var colors = [];
    var tiers = [];
    var byRgb = {}; // 0xrrggbb -> 部材の添字。数値キーなので prototype と衝突しない。
    var key;
    for (key in table) {
      if (!Object.prototype.hasOwnProperty.call(table, key)) continue;
      var rgb = parseHexColor(key);
      if (rgb < 0) continue;
      byRgb[rgb] = colors.length;
      colors.push(key.toLowerCase());
      tiers.push(table[key]);
    }

    var n = colors.length;
    var sums = new Array(n);
    var counts = new Array(n);
    var hists = new Array(n);
    var i;
    for (i = 0; i < n; i++) {
      sums[i] = 0;
      counts[i] = 0;
      hists[i] = null; // 1画素も無い部材に 256 要素を確保しない
    }

    var src = baseData.data;
    var guide = instanceData.data;
    var pixels = baseData.width * baseData.height;
    for (i = 0; i < pixels; i++) {
      var p = i * 4;
      var idx = byRgb[(guide[p] << 16) | (guide[p + 1] << 8) | guide[p + 2]];
      if (idx === undefined) continue; // 凡例に無い色 (背景など) は測らない
      var r = src[p];
      var g = src[p + 1];
      var b = src[p + 2];
      sums[idx] += r + g + b;
      counts[idx] += 1;
      var h = hists[idx];
      if (h === null) {
        h = hists[idx] = [];
        for (var z = 0; z < 256; z++) h[z] = 0;
      }
      h[r] += 1;
      h[g] += 1;
      h[b] += 1;
    }

    var out = [];
    for (i = 0; i < n; i++) {
      if (counts[i] === 0) continue; // このカメラから見えない部材は測れない
      out.push({
        color: colors[i],
        tier: tiers[i],
        meanLuminance: sums[i] / (counts[i] * 3),
        pixels: counts[i],
        histogram: hists[i]
      });
    }
    return out;
  }

  // ヒストグラムに LUT をかけた後の平均輝度。輝度は R,G,B の単純平均なので、
  // 「画素ごとの輝度の平均」と「全チャンネル値の平均」は同じ値になる。
  function meanAfter(entry, lut) {
    var h = entry.histogram;
    if (!h) {
      // ヒストグラムを持たない測定値 (手で組んだものなど) への保険。
      // 分布が1点に集まっているとみなすので、実際より甘い見積りになりうる。
      var v = Math.round(entry.meanLuminance);
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      return lut[v];
    }
    var sum = 0;
    var total = 0;
    for (var v2 = 0; v2 < 256; v2++) {
      if (h[v2] === 0) continue;
      sum += lut[v2] * h[v2];
      total += h[v2];
    }
    return total === 0 ? 0 : sum / total;
  }

  // その部材を床まで持ち上げる最大の (＝最も穏やかな) ガンマ。
  // 届かせられなければ -1。
  function gammaToLift(entry, floor, minGamma) {
    var target = floor + FLOOR_EPSILON;
    if (meanAfter(entry, lutFor(minGamma)) < target) return -1;
    var lo = minGamma; // 届く
    var hi = 1;         // 届かない (呼ぶ前に mean < floor を確認している)
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (meanAfter(entry, lutFor(mid)) >= target) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // LOCKED/SOFT のうち1つでも床を割っていれば持ち上げる。
  // 選ぶガンマは、床を割っている部材すべてが床に届く中で最も穏やかなもの。
  // ガンマは単調増加なので、もともと床以上の部材が持ち上げで割ることはない。
  function curveFor(measurements, options) {
    var list = measurements || [];
    var floor = (options && typeof options.floorLuminance === 'number') ?
      options.floorLuminance : FLOOR_LUMINANCE;
    var minGamma = (options && typeof options.minGamma === 'number' &&
      options.minGamma > 0 && options.minGamma < 1) ? options.minGamma : MIN_GAMMA;

    var darkest = Infinity;
    var gamma = 1;
    var unliftable = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || entry.pixels <= 0) continue;
      if (entry.tier !== 'LOCKED' && entry.tier !== 'SOFT') continue; // FREE はAIの領分
      if (entry.meanLuminance < darkest) darkest = entry.meanLuminance;
      if (entry.meanLuminance >= floor) continue;
      var g = gammaToLift(entry, floor, minGamma);
      if (g < 0) unliftable.push(entry.color);
      else if (g < gamma) gamma = g;
    }

    if (darkest === Infinity || darkest >= floor) return { applied: false };

    if (gamma >= 1) {
      // 床を割った部材はあるのに、どのガンマでも届かない。真っ黒 (情報ゼロ) の
      // 部材にガンマは効かない -- 無い情報は作れない。ここで絵全体を白茶けさせても
      // 得るものが無いので何もしないが、黙って見逃すのは事故なので警告する。
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('ShadowLift.curveFor: ' + unliftable.length +
          ' locked/soft part(s) are too black for any gamma to reach luminance ' + floor +
          ' (' + unliftable.join(', ') + ') -- fix the lighting, not the curve');
      }
      return { applied: false };
    }

    return {
      applied: true,
      liftedFrom: darkest,
      gamma: gamma,
      floorLuminance: floor,
      // 選んだガンマでも届かなかった部材。空なら全部届いている。
      unliftableColors: unliftable
    };
  }

  // 常に新しい {data, width, height} を返す。呼び出し側は元の絵をまだ使う。
  function apply(baseData, curve) {
    if (!isImageLike(baseData)) {
      throw new Error('ShadowLift.apply: expected {data,width,height}');
    }
    var src = baseData.data;
    var copy = new Uint8ClampedArray(src.length);
    var i;
    for (i = 0; i < src.length; i++) copy[i] = src[i];
    var out = { data: copy, width: baseData.width, height: baseData.height };

    if (!curve || !curve.applied) return out;
    var gamma = curve.gamma;
    if (typeof gamma !== 'number' || !isFinite(gamma) || gamma <= 0 || gamma === 1) return out;

    var lut = lutFor(gamma);
    for (i = 0; i < copy.length; i += 4) {
      copy[i] = lut[copy[i]];
      copy[i + 1] = lut[copy[i + 1]];
      copy[i + 2] = lut[copy[i + 2]];
      // アルファは触らない
    }
    return out;
  }

  return {
    FLOOR_LUMINANCE: FLOOR_LUMINANCE,
    MIN_GAMMA: MIN_GAMMA,
    measure: measure,
    curveFor: curveFor,
    apply: apply
  };
}));
