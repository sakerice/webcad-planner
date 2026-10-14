// 三人称のウォークスルー（作り直し計画 段階5）。完成までは隠しスイッチの裏に置く:
// URL に ?tps=1 を付けたときだけ、ウォークスルーの操作盤に「一人称／三人称」の切り替えが出る。
//
// 一人称のウォークスルーには手を入れない。歩く位置・向き・当たり判定は WALK（一人称と同じ物）を
// そのまま使い、カメラの置き場所だけを「人物の後ろ」に替える（walkApplyCamera の後ろに足す）。
//
// - 人物: 独自に組んだ簡単な人形（頭・胴・腕・脚）。歩いた距離に合わせて手足を振る。
//   本採用の人物モデルは後で差し替える（外部の素材は仮まで、という取り決めのため、最初から独自の形）
// - カメラ: 人物の頭の後ろ上、いつも同じ距離（狭い家で寄ったり離れたりすると煩わしいので、壁で縮めない）。
//   上下のドラッグは一人称と同じ向き（WALK.pitch をそのまま使う）。カメラと人物の間に壁・家具などが入ったら、
//   それ（壁なら壁に付いた窓・ドアも）を見えなくする。影は落とし続ける（部屋の明るさが変わらないように）
// - 下キー: カメラの向きはそのままで、人物がカメラの方へ向き直り、体の前をカメラに向けて手前へ歩いてくる
//   （カメラは同じ距離を保って下がる）。上キーで奥へ歩くと、また背中を向ける
var ThirdPerson = (function(){
  var enabled = /[?&]tps=1\b/.test(location.search);
  var on = false;                      // 三人称で歩いているか
  var DIST = 2.4, HEAD = 1.55, NEAR_PAD = 0.35, TURN_RATE = Math.PI / 0.45;
  var figure = null, parts = null, phase = 0, lastX = null, lastZ = null;
  // 人物の GLB（Codex がデザインし Meshy で立体化、動きは Mixamo）。読めなければ仮の人形で歩く。
  // 第2版（5.5頭身前後）の女性 a。男性 b は色の画像のむらが残るため、リリースの範囲から外した（利用者の判断）。
  // 人物を足すときは、この表に足すと切り替えの順番に入る（一人称 → 三人称・各人物 → 一人称）
  var CHARACTERS = [
    {id:'walker-female-02a', label:'女性', url:'assets/models/characters/walker-female-02a.glb', height:1.60}
  ];
  var charIndex = 0, models = {}, mixer = null, actions = null, lastTick = 0, figureFor = null, bones = {};
  var WALK_SPEED = 2.0;                // updateWalkMode の歩く速さ(m/s)。動きの再生の速さをこれに合わせる
  var ray = null, walls = null, wallsFor = null, hidden = [], HIDDEN_LAYER = 1;
  var bodyOff = 0, bodyTarget = 0, lastBodyAt = 0;
  // 座る: 近くの座れる家具（ソファ・椅子）。seat は座っている家具、near は座れる候補。sitBlend は 0=立ち 1=座り
  var SEAT_KINDS = {sofa:'ソファ', chair:'椅子'}, SEAT_FROM_FRONT_MM = 140, SEAT_REACH = 1.3, HIP_ABOVE_SEAT = 0.08, SIT_TIME = 0.35;
  var seat = null, near = null, sitBlend = 0, lastAnimAt = 0, lastSeat = null;   // lastSeat: 立ち上がる途中も、座っていた家具から離れていくように   // 人物の向き（カメラの向き WALK.yaw からのずれ。0=背中、π=正面をカメラへ）

  function mat(color){ return new THREE.MeshStandardMaterial({color:color, roughness:0.75, metalness:0}); }
  function limb(len, r, m){
    var g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r*2), 4, 10);
    g.translate(0, -len/2, 0);                       // 付け根(肩・股)を原点にして、振ると根元で回る
    var mesh = new THREE.Mesh(g, m); mesh.castShadow = true;
    var pivot = new THREE.Group(); pivot.add(mesh);
    return pivot;
  }
  // GLB の人物を読み込む。骨組みと動き(idle・walk)を持ち、原点は足元、正面は +Z の約束
  function loadCharacter(c){
    if(models[c.id]) return models[c.id];
    models[c.id] = {state:'loading'};
    var loader = (typeof getGltfLoader==='function') ? getGltfLoader() : new THREE.GLTFLoader();
    loader.load(c.url + '?v=' + (typeof MODEL_ASSET_VER!=='undefined' ? MODEL_ASSET_VER : 1), function(gltf){
      var root = gltf.scene;
      // 身長を約束の値に合わせる（Meshy の書き出しの縮尺の誤差を吸収する）
      var box = new THREE.Box3().setFromObject(root), h = box.max.y - box.min.y;
      if(h > 0.1) root.scale.multiplyScalar(c.height / h);
      toonify(root);
      root.traverse(function(o){ if(o.isMesh){ o.castShadow = true; o.frustumCulled = false; } o.userData._thirdPerson = true; });
      var holder = new THREE.Group(); holder.name = '_thirdPersonFigure';
      root.rotation.y = Math.PI;                          // GLB の正面 +Z を、歩く向き(-Z)へ向ける
      holder.add(root); holder.userData._thirdPerson = true;
      models[c.id] = {state:'ready', holder:holder, clips:gltf.animations || []};
      if(on && CHARACTERS[charIndex] === c) useModel(c);
    }, undefined, function(){ models[c.id] = {state:'failed'}; });
    return models[c.id];
  }
  // アニメ調の見た目にする（参考: 家庭用ゲーム機のアニメ調の主人公）。
  // 陰影を3段のトゥーン（MeshToonMaterial と段々の濃淡の画像）にし、写実的な照り返しをやめる
  var toonRamp = null;
  function rampTexture(){
    if(toonRamp) return toonRamp;
    var data = new Uint8Array([178, 178, 178, 255, 222, 222, 222, 255, 255, 255, 255, 255]);   // 影・中間・明るい所（影を濃くしすぎると顔がまだらになる）
    toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
    return toonRamp;
  }
  function toonify(root){
    var meshes = [];
    root.traverse(function(o){ if(o.isMesh) meshes.push(o); });
    meshes.forEach(function(o){
      var src = o.material;
      var toon = new THREE.MeshToonMaterial({
        color: 0xffffff, map: src.map || null, gradientMap: rampTexture()
        // 法線の画像は使わない（服のしわの細かい凹凸が、段々の陰影ではまだらの模様になる）
      });
      if(toon.map) toon.map.colorSpace = THREE.SRGBColorSpace;
      o.material = toon;
      // 輪郭線（裏返しの殻）は付けない（利用者の判断で外した。家の中では線が浮いて見える）
    });
  }
  function clipNamed(list, name){
    // Meshy の書き出しの名前は Walking・Running・Chair_Sit_Idle_M など。座る待機を立ち待機と取り違えない
    return list.find(function(a){ return a.name === name; })
      || list.find(function(a){ var n = a.name.toLowerCase(); return n.indexOf(name) >= 0 && n.indexOf('sit') < 0 && n.indexOf('chair') < 0; }) || null;
  }
  // 読み込めた人物に差し替える（読み込み前・失敗時は仮の人形のまま）
  function useModel(c){
    var m = models[c.id];
    if(!m || m.state !== 'ready') return false;
    var old = figure;
    figure = m.holder; figureFor = c.id;
    if(old && old !== figure && old.parent){ old.parent.add(figure); old.parent.remove(old); }
    mixer = new THREE.AnimationMixer(figure);
    var walk = clipNamed(m.clips, 'walk'), idle = clipNamed(m.clips, 'idle');
    var sit = m.clips.find(function(a){ return a.name === 'Sitting'; }) || null;
    actions = {walk: walk ? mixer.clipAction(walk) : null, idle: idle ? mixer.clipAction(idle) : null, sit: sit ? mixer.clipAction(sit) : null};
    if(actions.idle) actions.idle.play();
    if(actions.sit){ actions.sit.play(); actions.sit.setEffectiveWeight(0); }
    bones = {};
    figure.traverse(function(o){ if(o.isBone){ if(/Hips$/.test(o.name)) bones.hips = o; else if(/Head$/.test(o.name)) bones.head = o; } });
    if(actions.walk){ actions.walk.play(); actions.walk.setEffectiveWeight(actions.idle ? 0 : 1); }
    mixer.update(0);
    parts = null;
    lastX = null;
    if(typeof walkApplyCamera==='function') walkApplyCamera();
    if(typeof invalidate3D==='function') invalidate3D();
    return true;
  }
  // 身長 1.65m の人形。原点は足元の中心、正面は -Z（WALK.yaw=0 の進む向き）
  function buildFigure(){
    var skin = mat(0xe2c4a8), shirt = mat(0x4f6f8f), pants = mat(0x3b3f47), shoe = mat(0x2a2a2a), hair = mat(0x2b2420);
    var g = new THREE.Group(); g.name = '_thirdPersonFigure';
    var hips = new THREE.Group(); hips.position.y = 0.86; g.add(hips);
    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 4, 12), shirt);
    torso.scale.set(1, 1, 0.68); torso.position.y = 0.30; torso.castShadow = true; hips.add(torso);
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.08, 10), skin); neck.position.y = 0.58; hips.add(neck);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), skin); head.scale.set(0.92, 1.05, 1); head.position.y = 0.72; head.castShadow = true; hips.add(head);
    var hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 10, 0, Math.PI*2, 0, Math.PI*0.55), hair); hairCap.position.y = 0.735; hairCap.scale.set(0.95, 1.05, 1.03); hips.add(hairCap);
    var armL = limb(0.56, 0.042, shirt), armR = limb(0.56, 0.042, shirt);
    armL.position.set(-0.21, 0.50, 0); armR.position.set(0.21, 0.50, 0); hips.add(armL, armR);
    [armL, armR].forEach(function(a){ var hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); hand.position.y = -0.58; a.add(hand); });
    var legL = limb(0.82, 0.06, pants), legR = limb(0.82, 0.06, pants);
    legL.position.set(-0.09, 0.02, 0); legR.position.set(0.09, 0.02, 0); hips.add(legL, legR);
    [legL, legR].forEach(function(l){ var foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), shoe); foot.position.set(0, -0.82, -0.05); foot.castShadow = true; l.add(foot); });
    parts = {hips:hips, armL:armL, armR:armR, legL:legL, legR:legR};
    g.traverse(function(o){ o.userData._thirdPerson = true; });
    return g;
  }

  // カメラと人物の間に入ったら消す物: 床・天井（部屋）以外の、選べる物すべて（壁・ドア・窓・家具・植木など）。
  // 壁を消すときは、その壁に付いた窓・ドアも消す。場面を組み直したら集め直す。
  // 家具のまとめ描き（同じ形の家具を1つの物で何台も描く仕組み）は、当たった家具だけを大きさ0にして消す
  function collectWalls(){
    if(wallsFor === sc3 && walls && walls._n === sc3.children.length) return walls;
    walls = {meshes:[], openings:[], instanced:[], _n:sc3.children.length};
    sc3.traverse(function(o){ if(o.isInstancedMesh && !o.userData._thirdPerson) walls.instanced.push(o); });
    sc3.children.forEach(function(root){
      var ud = root.userData || {}, ref = ud.selectRef;
      if(ud._thirdPerson || !ud.b || ud.selectKind === 'room') return;
      root.traverse(function(o){ if(o.isMesh && !o.isInstancedMesh){ o.userData._tpsWallRoot = root; walls.meshes.push(o); } });
      if(ref && ref.type && typeof isOpeningItemType === 'function' && isOpeningItemType(ref.type)) walls.openings.push(root);
    });
    wallsFor = sc3;
    // 消した物も影は落とす: 影を描くカメラに、消した物を入れる層も見せる
    sc3.traverse(function(o){ if(o.isLight && o.shadow && o.shadow.camera) o.shadow.camera.layers.enable(HIDDEN_LAYER); });
    return walls;
  }
  function setHidden(list){
    hidden.forEach(function(root){
      if(list.indexOf(root) >= 0) return;
      root.traverse(function(o){ if(o.userData._tpsLayers !== undefined){ o.layers.mask = o.userData._tpsLayers; delete o.userData._tpsLayers; } });
    });
    list.forEach(function(root){
      if(hidden.indexOf(root) >= 0) return;
      root.traverse(function(o){ if(o.userData._tpsLayers === undefined){ o.userData._tpsLayers = o.layers.mask; o.layers.set(HIDDEN_LAYER); } });
    });
    hidden = list;
  }
  var hiddenInst = {}, ZERO = null;
  // 戻すときは、階の間引き(applyWalkCulling)が消している物は消したままにする
  function setHiddenInstances(next){
    next = next || {};
    ZERO = ZERO || new THREE.Matrix4().makeScale(0, 0, 0);
    Object.keys(hiddenInst).forEach(function(key){
      if(next[key]) return;
      var h = hiddenInst[key], ud = h.mesh.userData, vis = ud.instanceWalkVisible ? ud.instanceWalkVisible[h.id] !== false : true;
      h.mesh.setMatrixAt(h.id, vis && ud.instanceBaseMatrices ? ud.instanceBaseMatrices[h.id] : ZERO);
      h.mesh.instanceMatrix.needsUpdate = true;
    });
    Object.keys(next).forEach(function(key){
      var h = next[key]; h.mesh.setMatrixAt(h.id, ZERO);
      if(!hiddenInst[key]) h.mesh.instanceMatrix.needsUpdate = true;
    });
    hiddenInst = next;
  }
  var _box = null, _ctr = null;
  function hideBetween(head, cam){
    var w = collectWalls();
    if(!ray) ray = new THREE.Raycaster();
    ray.layers.enable(HIDDEN_LAYER);                         // 消している壁にも当てて、間にある間は消したままにする
    var dir = cam.clone().sub(head), len = dir.length();
    ray.set(head, dir.normalize()); ray.near = 0; ray.far = len + NEAR_PAD;   // カメラが壁の厚みの中にいるときも消す
    var list = [];
    ray.intersectObjects(w.meshes, false).forEach(function(h){
      var root = h.object.userData._tpsWallRoot;
      if(root && seat && root.userData.selectRef === seat.item) return;   // 座っている家具は消さない
      if(root && list.indexOf(root) < 0) list.push(root);
    });
    if(list.length && w.openings.length){
      // 消した壁の中にある窓・ドアも消す（壁だけ消すと、枠が宙に浮いて見える）
      _box = _box || new THREE.Box3(); _ctr = _ctr || new THREE.Vector3();
      var boxes = list.filter(function(root){ return root.userData.selectKind === 'wall'; })
        .map(function(root){ return new THREE.Box3().setFromObject(root).expandByScalar(0.05); });
      w.openings.forEach(function(op){
        _box.setFromObject(op).getCenter(_ctr);
        if(list.indexOf(op) < 0 && boxes.some(function(bx){ return bx.containsPoint(_ctr); })) list.push(op);
      });
    }
    setHidden(list);
    // まとめ描きの家具: 当たった家具（の全部品）を大きさ0にする。どの番号がどの家具かは instanceRefs に書いてある
    // 消している家具は大きさ0で光線が当たらないので、当てる間だけ元の位置へ戻しておく（画面に送り直しはしない）
    Object.keys(hiddenInst).forEach(function(key){ var h = hiddenInst[key], b = h.mesh.userData.instanceBaseMatrices; if(b) h.mesh.setMatrixAt(h.id, b[h.id]); });
    var refs = [];
    ray.intersectObjects(w.instanced.filter(function(m){ return m.userData.instanceRefs; }), false).forEach(function(h){
      var ref = h.instanceId !== undefined ? h.object.userData.instanceRefs[h.instanceId] : null;
      if(!ref || (seat && ref === seat.item) || refs.indexOf(ref) >= 0) return;   // 座っている家具は消さない
      refs.push(ref);
    });
    var next = {};
    if(refs.length) w.instanced.forEach(function(m){
      var r = m.userData.instanceRefs; if(!r) return;
      r.forEach(function(ref, idx){ if(refs.indexOf(ref) >= 0) next[m.uuid + ':' + idx] = {mesh:m, id:idx}; });
    });
    setHiddenInstances(next);
  }

  // ── 座る ──────────────────────────────────────────────────────
  // 座れる家具は、カタログの分類（kind）が sofa・chair の物。向き・位置は間取りのデータから求める
  // （食卓の椅子のように、同じ形をまとめて描いている家具は 3D から1脚ずつ取り出せないため）。
  // 正面は、回転 0 で図面の下向き(+y)、回転で回る（モデルの正面 +Z の約束と同じ）
  function seatKind(it){
    var f = (typeof getFmpItem === 'function') ? getFmpItem(it.type) : null;
    return f && SEAT_KINDS[f.kind] ? f.kind : null;
  }
  var _down = null;
  function seatInfo(it){
    var r = (it.rot || 0) * Math.PI / 180, fx = -Math.sin(r), fy = Math.cos(r);
    var cx = it.x + it.w / 2, cy = it.y + it.d / 2;
    // 腰を置く所: 浅めに腰掛ける（座面の前の縁から 140mm）。奥まで座らせると、座りの動きで
    // 下がる膝から下が、椅子やソファの前の部分にめり込んだ（利用者の指摘）
    var fwd = Math.max(it.d * 0.1, it.d / 2 - SEAT_FROM_FRONT_MM);
    var sx = (cx + fx * fwd) * U, sz = (cy + fy * fwd) * U;
    var floorY = floorTopY(it.floor) + (it.elev || 0) * U;
    return {item:it, x:sx, z:sz, floorY:floorY, yaw:Math.atan2(-fx, -fy), kind:seatKind(it)};
  }
  // 座面の高さ: 座面の中心へ上から光線を下ろし、床から 15〜65cm の高さで当たった一番上の面
  // （椅子を食卓に入れてあると、先に食卓の天板(70cm)に当たるので、それより低い所だけを見る）
  function seatTop(info){
    if(info.top !== undefined) return info.top;
    if(!_down) _down = new THREE.Raycaster();
    _down.set(new THREE.Vector3(info.x, info.floorY + 1.2, info.z), new THREE.Vector3(0, -1, 0)); _down.near = 0; _down.far = 1.2;
    var best = null;
    _down.intersectObjects(sc3.children, true).forEach(function(h){
      var o = h.object; while(o && !o.userData._thirdPerson) o = o.parent;
      if(o) return;
      var y = h.point.y - info.floorY;
      if(y > 0.15 && y < 0.65 && (best === null || y > best)) best = y;
    });
    info.top = info.floorY + (best === null ? 0.42 : best);     // 測れなければ一般的な座面の高さ 42cm
    return info.top;
  }
  function findNearSeat(){
    if(typeof DATA === 'undefined' || !DATA.items) return null;
    var bestD = SEAT_REACH, best = null;
    DATA.items.forEach(function(it){
      if(it.floor !== WALK.floor || !seatKind(it)) return;
      var info = seatInfo(it), d = Math.hypot(info.x - WALK.x, info.z - WALK.z);
      if(d < bestD){ bestD = d; best = info; }
    });
    return best;
  }
  function sitDown(){
    if(!near || !on) return;
    seat = lastSeat = near; seatTop(seat);
    WALK.yaw = seat.yaw; WALK.pitch = Math.min(WALK.pitch || 0, 0);   // 座った向き（家具の正面）を見る
    bodyOff = bodyTarget = 0;
    updateSitButton();
    if(typeof walkApplyCamera === 'function') walkApplyCamera();
    if(typeof invalidate3D === 'function') invalidate3D();
  }
  function standUp(){
    if(!seat) return;
    // 座ったままカメラを回していたら、人物は座っていた向きから、カメラの向きへ回って立ち上がる
    var d = seat.yaw - WALK.yaw;
    bodyOff = Math.atan2(Math.sin(d), Math.cos(d)); bodyTarget = 0;
    seat = null;
    updateSitButton();
    if(typeof walkApplyCamera === 'function') walkApplyCamera();
    if(typeof invalidate3D === 'function') invalidate3D();
  }
  function updateSitButton(){
    var b = document.getElementById('walk-sit-toggle');
    if(!b) return;
    var show = on && !!(seat || near) && typeof isWalkView === 'function' && isWalkView();
    b.style.display = show ? '' : 'none';
    if(!show) return;
    b.textContent = seat ? '立ち上がる' : SEAT_KINDS[near.kind] + 'に座る';
    b.setAttribute('aria-pressed', seat ? 'true' : 'false');
  }

  function feetY(){ return floorTopY(WALK.floor) + (WALK.groundOff || 0); }
  function place(){
    if(!camExt || !sc3) return;
    var want = CHARACTERS[charIndex];
    if(figureFor !== want.id && !useModel(want)){
      // まだ読めていない・読めなかった人物は、仮の人形で歩く（読めたら差し替わる）
      if(figureFor !== 'doll'){
        if(figure && figure.parent) figure.parent.remove(figure);
        figure = buildFigure(); mixer = null; actions = null; figureFor = 'doll';
      }
      loadCharacter(want);
    }
    if(figure.parent !== sc3) sc3.add(figure);       // いま歩いている側の場面に立たせる（比較中のもう片方は描く直前に移す）
    var fy = feetY();
    figure.position.set(WALK.x, fy, WALK.z);
    // 歩いた距離だけ手足を振る（止まると元へ戻す）
    var moved = lastX === null ? 0 : Math.hypot(WALK.x - lastX, WALK.z - lastZ);
    // 人物の向き: 奥へ歩けば背中、手前（カメラの方）へ歩けば正面をカメラへ向ける。止まったら向きはそのまま
    if(moved > 0.0005){
      var along = (WALK.x - lastX) * -Math.sin(WALK.yaw) + (WALK.z - lastZ) * -Math.cos(WALK.yaw);
      if(along < -moved * 0.5) bodyTarget = Math.PI; else if(along > moved * 0.5) bodyTarget = 0;
    }
    var tnow = performance.now(), tdt = lastBodyAt ? Math.min(0.1, (tnow - lastBodyAt) / 1000) : 0; lastBodyAt = tnow;
    if(bodyOff !== bodyTarget){
      var step = TURN_RATE * tdt;
      bodyOff = Math.abs(bodyTarget - bodyOff) <= step ? bodyTarget : bodyOff + (bodyTarget > bodyOff ? step : -step);
    }
    figure.rotation.set(0, WALK.yaw + bodyOff, 0);
    lastX = WALK.x; lastZ = WALK.z;
    // 座れる家具が近くにあれば「座る」を出す（座っている間は「立ち上がる」）
    if(!seat){ var nn = findNearSeat(); if((nn && nn.item) !== (near && near.item)){ near = nn; updateSitButton(); } }
    var now = performance.now(), dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0; lastTick = now;
    if(mixer){
      sitBlend = Math.max(0, Math.min(1, sitBlend + (seat ? 1 : -1) * dt / SIT_TIME));
      // 歩いた分だけ walk を進め、止まったら idle へ寄せる。座るときは sit へ寄せる
      var walking = moved > 0.0005 && !seat;
      if(actions.idle){
        var stand = 1 - (actions.sit ? sitBlend : 0);
        if(actions.walk) actions.walk.setEffectiveWeight(walking ? stand : 0);
        actions.idle.setEffectiveWeight(walking ? 0 : stand);
        if(actions.sit) actions.sit.setEffectiveWeight(1 - stand);
        mixer.update(walking ? Math.max(dt, moved / WALK_SPEED) : dt);
      } else if(walking){
        // 待機の動きが無い人物は、止まったら歩く動きをその場で止める（腕を広げた骨組みの基本の姿にしない）
        mixer.update(Math.max(dt, moved / WALK_SPEED));
      }
      var from = seat || lastSeat;
      if(sitBlend > 0 && from && bones.hips){
        // 腰が座面の中心の上に来るよう、人物ごと動かす（足は床に置いたまま）
        if(seat) figure.rotation.set(0, seat.yaw, 0);
        figure.updateMatrixWorld(true);
        var hp = bones.hips.getWorldPosition(new THREE.Vector3());
        var k = sitBlend * sitBlend * (3 - 2 * sitBlend);           // なめらかに寄せる
        figure.position.x += (from.x - hp.x) * k;
        figure.position.z += (from.z - hp.z) * k;
        var wantY = figure.position.y + (from.top + HIP_ABOVE_SEAT - hp.y);
        figure.position.y += (Math.max(from.floorY - 0.05, wantY) - figure.position.y) * k;
      }
    } else if(parts){
      if(moved > 0.0005){ phase += moved * 4.2; } else { phase *= 0.8; }
      var s = Math.sin(phase), swing = Math.min(1, Math.abs(phase) > 0.01 ? 1 : 0) * 0.5;
      parts.legL.rotation.x = s * swing; parts.legR.rotation.x = -s * swing;
      parts.armL.rotation.x = -s * swing * 0.8; parts.armR.rotation.x = s * swing * 0.8;
      parts.hips.position.y = 0.86 + Math.abs(Math.cos(phase)) * 0.025 * (swing ? 1 : 0);
    }
    // カメラ: 頭の後ろ、いつも同じ距離。見る向きは一人称と同じ(WALK.yaw と WALK.pitch)
    var pitch = WALK.pitch || 0;
    var dir = new THREE.Vector3(-Math.sin(WALK.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(WALK.yaw) * Math.cos(pitch));
    var headH = HEAD * CHARACTERS[charIndex].height / 1.72;      // 頭の高さは人物の身長に合わせる（HEAD は身長 1.72m のとき）
    var head = new THREE.Vector3(WALK.x, fy + headH, WALK.z);
    if(sitBlend > 0){
      // 座っている間（と立ち上がる途中）は、座った人物の頭の後ろから見る
      figure.updateMatrixWorld(true);
      var hd = bones.head ? bones.head.getWorldPosition(new THREE.Vector3()) : figure.position.clone().setY(figure.position.y + headH);
      head.lerp(hd, sitBlend);
    }
    figure.visible = true;
    camExt.position.copy(head).addScaledVector(dir, -DIST);
    camExt.position.y += 0.15;                                   // 肩越しに少し上から
    // 見下ろしても天井の上、見上げても床の下へは出さない（上の階の床や地面で画面がふさがらないように）
    var ceil = (typeof floorBaseY === 'function' && typeof wallFullHeightM === 'function') ? floorBaseY(WALK.floor) + wallFullHeightM(WALK.floor) - 0.12 : Infinity;
    camExt.position.y = Math.max(fy + 0.25, Math.min(ceil, camExt.position.y));
    camExt.rotation.order = 'YXZ';
    camExt.rotation.set(pitch, WALK.yaw, 0);
    hideBetween(head, camExt.position);
  }
  function attachTo(scene){
    if(!figure || !on) return;
    if(figure.parent !== scene) scene.add(figure);
    // three.js は onBeforeRender より前に場面の位置を計算し終えているので、入れた人物の分は自分で計算する
    figure.updateMatrixWorld(true);
  }
  function setOn(v){
    on = !!v && enabled;
    if(!on && figure && figure.parent) figure.parent.remove(figure);
    if(!on){ setHidden([]); setHiddenInstances({}); }
    lastX = null; bodyOff = bodyTarget = 0; seat = null; near = null; sitBlend = 0; updateSitButton();
    updateButton();
    if(typeof isWalkView==='function' && isWalkView() && WALK.active){ walkApplyCamera(); if(typeof invalidate3D==='function') invalidate3D(); }
  }
  function updateButton(){
    var b = document.getElementById('walk-tps-toggle');
    if(!b) return;
    b.textContent = on ? '三人称・' + CHARACTERS[charIndex].label : '一人称';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? '一人称に切り替え' : '三人称に切り替え（人物の後ろから見る）';
  }
  function install(){
    if(!enabled) return;
    // 切り替えボタンを、十字キーの上に横長の小さなボタンで足す（十字キーの中に置くと方向キーと紛れる）
    var h = document.getElementById('walk-height-toggle');
    if(h && !document.getElementById('walk-tps-toggle')){
      var b = document.createElement('button');
      b.id = 'walk-tps-toggle'; b.type = 'button'; b.className = 'wk-tps';
      b.addEventListener('click', function(){
        // 一人称 → 三人称（人物の表の順） → 一人称 の順に切り替える
        if(!on){ charIndex = 0; setOn(true); }
        else if(charIndex < CHARACTERS.length - 1){ charIndex++; if(!useModel(CHARACTERS[charIndex])) loadCharacter(CHARACTERS[charIndex]); updateButton(); }
        else setOn(false);
      });
      h.parentNode.appendChild(b);
      updateButton();
    }
    // 「座る／立ち上がる」は画面の下の中央に出す（座れる家具の近くに来たときだけ）
    var hud = document.getElementById('walk-hud');
    if(hud && !document.getElementById('walk-sit-toggle')){
      var sb = document.createElement('button');
      sb.id = 'walk-sit-toggle'; sb.type = 'button'; sb.style.display = 'none';
      sb.addEventListener('click', function(){ if(seat) standUp(); else sitDown(); });
      hud.appendChild(sb);
    }
    // 座っている間に前後へ歩く操作をしたら立ち上がる（左右は、座ったままカメラを回す）。
    // 止まっていても、待機・座りの動きを見せるため 30コマ/秒で描く
    var baseUpdate = updateWalkMode;
    updateWalkMode = function(now){
      if(on && seat){
        var k = WALK.keys || {};
        var moving = k.fwd || k.back || ['arrowup','arrowdown','w','s'].some(function(c){ return iMov[c]; });
        if(moving) standUp();
      }
      var r = baseUpdate.apply(this, arguments);
      if(!r && on && mixer && typeof isWalkView === 'function' && isWalkView() && WALK.active && now - lastAnimAt > 33){
        lastAnimAt = now; walkApplyCamera(); return true;
      }
      if(r) lastAnimAt = now;
      return r;
    };
    var baseApply = walkApplyCamera;
    walkApplyCamera = function(){
      var r = baseApply.apply(this, arguments);
      if(on && typeof isWalkView==='function' && isWalkView()) place();
      return r;
    };
    // 描く場面に人物を入れる（比較モードでは左右それぞれの場面に、描く直前に移す）
    var baseBefore = THREE.Scene.prototype.onBeforeRender;
    THREE.Scene.prototype.onBeforeRender = function(renderer, scene){
      if(on && scene.userData && scene.userData.mainScene && typeof isWalkView==='function' && isWalkView()) attachTo(scene);
      if(baseBefore) return baseBefore.apply(this, arguments);
    };
    // ウォークスルーを出たら人物を片付ける（次に入ったときは、三人称のままにしておく）
    var baseSetView = setView;
    setView = function(v){
      var r = baseSetView.apply(this, arguments);
      if(v !== '3d-walk'){ if(figure && figure.parent) figure.parent.remove(figure); setHidden([]); setHiddenInstances({}); seat = null; near = null; sitBlend = 0; updateSitButton(); }
      if(v === '3d-walk' && on){ lastX = null; walkApplyCamera(); }
      return r;
    };
  }
  window.addEventListener('load', function(){
    if(window.THREE) install(); else window.addEventListener('three-ready', install, {once:true});
  });
  return { isEnabled:function(){ return enabled; }, isOn:function(){ return on; }, setOn:setOn, _place:place,
    character:function(){ return CHARACTERS[charIndex].id; }, sitDown:sitDown, standUp:standUp, seated:function(){ return seat && seat.item; }, nearSeat:function(){ return near && near.item; }, modelState:function(id){ return (models[id]||{}).state || 'none'; } };
})();
