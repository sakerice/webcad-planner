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
// - 下キー: 後ろ向きに歩かず、その場で振り返ってから、振り返った向きへ前に歩く（カメラも後ろへ回り込む）
var ThirdPerson = (function(){
  var enabled = /[?&]tps=1\b/.test(location.search);
  var on = false;                      // 三人称で歩いているか
  var DIST = 2.4, HEAD = 1.55, NEAR_PAD = 0.35, TURN_RATE = Math.PI / 0.45;
  var figure = null, parts = null, phase = 0, lastX = null, lastZ = null;
  // 人物の GLB（Codex がデザインし Meshy で立体化した物）。読めなければ仮の人形で歩く
  var CHARACTERS = [
    {id:'walker-male-01', label:'男性', url:'assets/models/characters/walker-male-01.glb', height:1.72},
    {id:'walker-female-01', label:'女性', url:'assets/models/characters/walker-female-01.glb', height:1.60}
  ];
  var charIndex = 0, models = {}, mixer = null, actions = null, lastTick = 0, figureFor = null;
  var WALK_SPEED = 2.0;                // updateWalkMode の歩く速さ(m/s)。動きの再生の速さをこれに合わせる
  var ray = null, walls = null, wallsFor = null, hidden = [], HIDDEN_LAYER = 1;
  var turnLeft = 0, backHeld = false, lastTurnAt = 0;   // 下キーで振り返る残りの角度と、下キーを押し続けているか

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
  // - 陰影を3段のトゥーン（MeshToonMaterial と段々の濃淡の画像）にし、写実的な照り返しをやめる
  // - 輪郭線: 同じ骨組みで動く、少し太らせた裏面だけの黒い写しを重ねる（裏返しの殻の手法）
  var toonRamp = null;
  function rampTexture(){
    if(toonRamp) return toonRamp;
    var data = new Uint8Array([178, 178, 178, 255, 222, 222, 222, 255, 255, 255, 255, 255]);   // 影・中間・明るい所（影を濃くしすぎると顔がまだらになる）
    toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
    return toonRamp;
  }
  var OUTLINE_M = 0.006;
  function outlineMaterial(){
    var m = new THREE.MeshBasicMaterial({color:0x2a2226, side:THREE.BackSide});
    m.onBeforeCompile = function(sh){
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(objectNormal) * ' + OUTLINE_M.toFixed(4) + ';');
    };
    m.customProgramCacheKey = function(){ return 'tps-outline'; };
    return m;
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
      // 輪郭線（スキン付きなら同じ骨組みに結び付ける）
      var line = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, outlineMaterial()) : new THREE.Mesh(o.geometry, outlineMaterial());
      if(o.isSkinnedMesh) line.bind(o.skeleton, o.bindMatrix);
      line.position.copy(o.position); line.quaternion.copy(o.quaternion); line.scale.copy(o.scale);
      line.castShadow = false; line.frustumCulled = false; line.name = '_outline';
      o.parent.add(line);
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
    actions = {walk: walk ? mixer.clipAction(walk) : null, idle: idle ? mixer.clipAction(idle) : null};
    if(actions.idle) actions.idle.play();
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
  // 家具のまとめ描き（同じ形の家具を1つにまとめた物）は1つだけ消せないので対象にしない
  function collectWalls(){
    if(wallsFor === sc3 && walls && walls._n === sc3.children.length) return walls;
    walls = {meshes:[], openings:[], _n:sc3.children.length};
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
    figure.rotation.set(0, WALK.yaw, 0);
    // 歩いた距離だけ手足を振る（止まると元へ戻す）
    var moved = lastX === null ? 0 : Math.hypot(WALK.x - lastX, WALK.z - lastZ);
    lastX = WALK.x; lastZ = WALK.z;
    if(mixer){
      // 歩いた分だけ walk を進め、止まったら idle へ寄せる
      var now = performance.now(), dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0; lastTick = now;
      var walking = moved > 0.0005;
      if(actions.idle){
        if(actions.walk) actions.walk.setEffectiveWeight(walking ? 1 : 0);
        actions.idle.setEffectiveWeight(walking ? 0 : 1);
        mixer.update(walking ? Math.max(dt, moved / WALK_SPEED) : dt);
      } else if(walking){
        // 待機の動きが無い人物は、止まったら歩く動きをその場で止める（腕を広げた骨組みの基本の姿にしない）
        mixer.update(Math.max(dt, moved / WALK_SPEED));
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
    var head = new THREE.Vector3(WALK.x, fy + HEAD, WALK.z);
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
    if(!on) setHidden([]);
    lastX = null; turnLeft = 0;
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
        // 一人称 → 三人称(男性) → 三人称(女性) → 一人称 の順に切り替える
        if(!on){ charIndex = 0; setOn(true); }
        else if(charIndex < CHARACTERS.length - 1){ charIndex++; if(!useModel(CHARACTERS[charIndex])) loadCharacter(CHARACTERS[charIndex]); updateButton(); }
        else setOn(false);
      });
      h.parentNode.appendChild(b);
      updateButton();
    }
    var baseApply = walkApplyCamera;
    walkApplyCamera = function(){
      var r = baseApply.apply(this, arguments);
      if(on && typeof isWalkView==='function' && isWalkView()) place();
      return r;
    };
    // 下キー: 三人称では、その場で振り返ってから、振り返った向きへ前に歩く
    var baseUpdate = updateWalkMode;
    updateWalkMode = function(now){
      if(!on || typeof isWalkView !== 'function' || !isWalkView() || !WALK.active){ backHeld = false; turnLeft = 0; return baseUpdate.apply(this, arguments); }
      var back = !!(WALK.keys.back || iMov['arrowdown'] || iMov['s']);
      if(back && !backHeld) turnLeft = Math.PI;            // 押した瞬間に半回転を始める
      backHeld = back;
      var saved = {kb:WALK.keys.back, kf:WALK.keys.fwd, ad:iMov['arrowdown'], s:iMov['s']};
      WALK.keys.back = false; iMov['arrowdown'] = false; iMov['s'] = false;
      var turning = false;
      if(turnLeft > 0){
        var dt = Math.min(0.1, Math.max(0.001, (now - (lastTurnAt || now)) / 1000));
        var step = Math.min(turnLeft, TURN_RATE * dt);
        WALK.yaw += step; turnLeft -= step; turning = true;
      } else if(back){
        WALK.keys.fwd = true;                                // 振り返り終えたら、押している間は前へ歩く
      }
      lastTurnAt = now;
      var r;
      try { r = baseUpdate.apply(this, arguments); }
      finally { WALK.keys.back = saved.kb; WALK.keys.fwd = saved.kf; iMov['arrowdown'] = saved.ad; iMov['s'] = saved.s; }
      if(turning){ walkApplyCamera(); return true; }
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
      if(v !== '3d-walk'){ if(figure && figure.parent) figure.parent.remove(figure); setHidden([]); }
      if(v === '3d-walk' && on){ lastX = null; walkApplyCamera(); }
      return r;
    };
  }
  window.addEventListener('load', function(){
    if(window.THREE) install(); else window.addEventListener('three-ready', install, {once:true});
  });
  return { isEnabled:function(){ return enabled; }, isOn:function(){ return on; }, setOn:setOn, _place:place,
    character:function(){ return CHARACTERS[charIndex].id; }, modelState:function(id){ return (models[id]||{}).state || 'none'; } };
})();
