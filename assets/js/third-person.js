// 三人称のウォークスルー（作り直し計画 段階5）。完成までは隠しスイッチの裏に置く:
// URL に ?tps=1 を付けたときだけ、ウォークスルーの操作盤に「一人称／三人称」の切り替えが出る。
//
// 一人称のウォークスルーには手を入れない。歩く位置・向き・当たり判定は WALK（一人称と同じ物）を
// そのまま使い、カメラの置き場所だけを「人物の後ろ」に替える（walkApplyCamera の後ろに足す）。
//
// - 人物: 独自に組んだ簡単な人形（頭・胴・腕・脚）。歩いた距離に合わせて手足を振る。
//   本採用の人物モデルは後で差し替える（外部の素材は仮まで、という取り決めのため、最初から独自の形）
// - カメラ: 人物の頭の後ろ上。上下のドラッグは一人称と同じ向き（WALK.pitch をそのまま使う）。
//   壁の向こうに出ないよう、頭からカメラへ光線を飛ばし、壁に当たったら手前へ寄せる
var ThirdPerson = (function(){
  var enabled = /[?&]tps=1\b/.test(location.search);
  var on = false;                      // 三人称で歩いているか
  var DIST = 2.4, HEAD = 1.55, MIN_DIST = 0.35, CRAMPED = 0.8;
  var figure = null, parts = null, phase = 0, lastX = null, lastZ = null;
  // 人物の GLB（Codex がデザインし Meshy で立体化した物）。読めなければ仮の人形で歩く
  var CHARACTERS = [
    {id:'walker-male-01', label:'男性', url:'assets/models/characters/walker-male-01.glb', height:1.72},
    {id:'walker-female-01', label:'女性', url:'assets/models/characters/walker-female-01.glb', height:1.60}
  ];
  var charIndex = 0, models = {}, mixer = null, actions = null, lastTick = 0, figureFor = null;
  var WALK_SPEED = 2.0;                // updateWalkMode の歩く速さ(m/s)。動きの再生の速さをこれに合わせる
  var ray = null, colliders = null, collidersFor = null;

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
      root.traverse(function(o){ if(o.isMesh){ o.castShadow = true; o.frustumCulled = false; } o.userData._thirdPerson = true; });
      var holder = new THREE.Group(); holder.name = '_thirdPersonFigure';
      root.rotation.y = Math.PI;                          // GLB の正面 +Z を、歩く向き(-Z)へ向ける
      holder.add(root); holder.userData._thirdPerson = true;
      models[c.id] = {state:'ready', holder:holder, clips:gltf.animations || []};
      if(on && CHARACTERS[charIndex] === c) useModel(c);
    }, undefined, function(){ models[c.id] = {state:'failed'}; });
    return models[c.id];
  }
  function clipNamed(list, name){
    return list.find(function(a){ return a.name === name; }) || list.find(function(a){ return a.name.toLowerCase().indexOf(name) >= 0; }) || null;
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
    if(actions.walk){ actions.walk.play(); actions.walk.setEffectiveWeight(0); }
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

  // 壁・天井・床など、カメラがすり抜けてはいけない物（家具の小物や半透明のガラスは除く）
  function collect(){
    if(collidersFor === sc3 && colliders && colliders._n === sc3.children.length) return colliders;
    colliders = [];
    sc3.traverse(function(o){
      if(!o.isMesh || !o.visible || o.userData._thirdPerson) return;
      var m = o.material;
      if(!m || Array.isArray(m) || m.transparent) return;
      var root = o; while(root.parent && root.parent !== sc3) root = root.parent;
      var kind = root.userData && root.userData.selectKind;
      if(kind === 'wall' || kind === 'room' || (root.userData && root.userData.selectRef && /^(roof|stair|floor|slab)/.test(root.userData.selectRef.type || ''))) colliders.push(o);
    });
    colliders._n = sc3.children.length; collidersFor = sc3;
    return colliders;
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
      if(actions.walk) actions.walk.setEffectiveWeight(walking ? 1 : 0);
      if(actions.idle) actions.idle.setEffectiveWeight(walking ? 0 : 1);
      mixer.update(walking ? Math.max(dt, moved / WALK_SPEED) : dt);
    } else if(parts){
      if(moved > 0.0005){ phase += moved * 4.2; } else { phase *= 0.8; }
      var s = Math.sin(phase), swing = Math.min(1, Math.abs(phase) > 0.01 ? 1 : 0) * 0.5;
      parts.legL.rotation.x = s * swing; parts.legR.rotation.x = -s * swing;
      parts.armL.rotation.x = -s * swing * 0.8; parts.armR.rotation.x = s * swing * 0.8;
      parts.hips.position.y = 0.86 + Math.abs(Math.cos(phase)) * 0.025 * (swing ? 1 : 0);
    }
    // カメラ: 頭の後ろ。見る向きは一人称と同じ(WALK.yaw と WALK.pitch)
    var pitch = WALK.pitch || 0;
    var dir = new THREE.Vector3(-Math.sin(WALK.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(WALK.yaw) * Math.cos(pitch));
    var head = new THREE.Vector3(WALK.x, fy + HEAD, WALK.z);
    var d = DIST;
    if(!ray) ray = new THREE.Raycaster();
    ray.set(head, dir.clone().negate()); ray.far = DIST + 0.2; ray.near = 0;
    var hits = ray.intersectObjects(collect(), false);
    if(hits.length) d = Math.max(MIN_DIST, Math.min(DIST, hits[0].distance - 0.2));
    // 後ろに壁が近く(狭い廊下・壁を背にしたとき)人物の後ろへ引けないときは、一人称の目線に戻す。
    // カメラを上げて見下ろす方法も試したが、壁に近い視点は壁の向こうが透けて見え、かえって分かりにくい
    if(d < CRAMPED){ figure.visible = false; return; }
    figure.visible = true;
    camExt.position.copy(head).addScaledVector(dir, -d);
    camExt.position.y += 0.15;                                   // 肩越しに少し上から
    camExt.rotation.order = 'YXZ';
    camExt.rotation.set(pitch, WALK.yaw, 0);
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
    lastX = null;
    updateButton();
    if(typeof isWalkView==='function' && isWalkView() && WALK.active){ walkApplyCamera(); if(typeof invalidate3D==='function') invalidate3D(); }
  }
  function updateButton(){
    var b = document.getElementById('walk-tps-toggle');
    if(!b) return;
    b.innerHTML = on ? '三人称<br>' + CHARACTERS[charIndex].label : '一人<br>称';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? '一人称に切り替え' : '三人称に切り替え（人物の後ろから見る）';
  }
  function install(){
    if(!enabled) return;
    // 切り替えボタンを、ウォークスルーの視点の高さボタンの隣に足す
    var h = document.getElementById('walk-height-toggle');
    if(h && !document.getElementById('walk-tps-toggle')){
      var b = document.createElement('button');
      b.id = 'walk-tps-toggle'; b.type = 'button'; b.className = 'wk-btn wk-height wk-tps';
      b.addEventListener('click', function(){
        // 一人称 → 三人称(男性) → 三人称(女性) → 一人称 の順に切り替える
        if(!on){ charIndex = 0; setOn(true); }
        else if(charIndex < CHARACTERS.length - 1){ charIndex++; if(!useModel(CHARACTERS[charIndex])) loadCharacter(CHARACTERS[charIndex]); updateButton(); }
        else setOn(false);
      });
      h.parentNode.insertBefore(b, h.nextSibling);
      updateButton();
    }
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
      if(v !== '3d-walk' && figure && figure.parent) figure.parent.remove(figure);
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
