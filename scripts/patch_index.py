#!/usr/bin/env python3
"""Apply remaining quality enhancement patches (Tasks 8-11) to index.html."""
import re, sys, os

TARGET = os.path.join(os.path.dirname(__file__), '..', 'index.html')
TARGET = os.path.normpath(TARGET)

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

original = src
patches_applied = []

# ─────────────────────────────────────────────────────────────────
# Task 8: GLTF_MAP → 全12種ローカルGLB
# ─────────────────────────────────────────────────────────────────
OLD_GLTF = """var GLTF_MAP = {
  'sofa': 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Sofa/glTF-Binary/Sofa.glb',
  'dining_6': 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/SheenChair/glTF-Binary/SheenChair.glb',
  'tree': 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BoxInterleaved/glTF-Binary/BoxInterleaved.glb' \n};"""

NEW_GLTF = """var GLTF_MAP = {
  'sofa':         'assets/models/sofa.glb',
  'bed-d':        'assets/models/bed_double.glb',
  'bed-s':        'assets/models/bed_single.glb',
  'kitchen':      'assets/models/kitchen.glb',
  'bath':         'assets/models/bathtub.glb',
  'toilet':       'assets/models/toilet.glb',
  'sink':         'assets/models/sink.glb',
  'fridge':       'assets/models/fridge.glb',
  'dining-table': 'assets/models/dining_table.glb',
  'desk':         'assets/models/desk.glb',
  'tv':           'assets/models/tv.glb',
  'closet':       'assets/models/closet.glb',
};"""

if OLD_GLTF in src:
    src = src.replace(OLD_GLTF, NEW_GLTF, 1)
    patches_applied.append('Task 8: GLTF_MAP expanded to 12 entries')
elif 'assets/models/sofa.glb' in src:
    patches_applied.append('Task 8: already applied (skipped)')
else:
    # Try flexible match
    src = re.sub(
        r"var GLTF_MAP = \{[\s\S]*?\};",
        NEW_GLTF, src, count=1
    )
    patches_applied.append('Task 8: GLTF_MAP replaced (flexible match)')

# ─────────────────────────────────────────────────────────────────
# Task 9a: pbrTex / pbrTexLinear ヘルパー関数を GLTF_MAP の直後に追加
# ─────────────────────────────────────────────────────────────────
PBR_HELPERS = """
// PBR Textures (lazy-loaded)
var _pbrTex = {};
function pbrTex(name) {
  if (_pbrTex[name]) return _pbrTex[name];
  var loader = new THREE.TextureLoader();
  var t = loader.load('assets/textures/' + name, function(){ if(ren) ren.render(sc3, ST.view==='interior'?camInt:camExt); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = THREE.sRGBEncoding;
  _pbrTex[name] = t;
  return t;
}
function pbrTexLinear(name) {
  if (!name) return null;
  if (_pbrTex['_lin_'+name]) return _pbrTex['_lin_'+name];
  var loader = new THREE.TextureLoader();
  var t = loader.load('assets/textures/' + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _pbrTex['_lin_'+name] = t;
  return t;
}"""

ANCHOR_PBR = "var _modelCache = {};"
if PBR_HELPERS.strip() not in src and '_pbrTex' not in src:
    src = src.replace(ANCHOR_PBR, ANCHOR_PBR + PBR_HELPERS, 1)
    patches_applied.append('Task 9a: pbrTex helpers added')
else:
    patches_applied.append('Task 9a: pbrTex helpers already present (skipped)')

# ─────────────────────────────────────────────────────────────────
# Task 9b: 床マテリアルに木目テクスチャ適用
# ─────────────────────────────────────────────────────────────────
OLD_FLOOR_MAT = """    var matParams = {color:0xffffff, roughness:0.8};
    var baseTex = getTexture3D(r.texture || 'wood_floor');
    if(baseTex){ matParams.map = baseTex; }"""

NEW_FLOOR_MAT = """    var isWet = r.texture === 'tile_floor' || r.n === 'バス' || r.n === 'トイレ' || r.n === '洗面';
    var diffName = isWet ? 'floor_tile_diffuse.jpg' : 'floor_wood_diffuse.jpg';
    var normName = isWet ? 'floor_tile_normal.jpg'  : 'floor_wood_normal.jpg';
    var roughName= isWet ? 'floor_tile_roughness.jpg': 'floor_wood_roughness.jpg';
    var repU = Math.max(0.5, r.w / 900), repV = Math.max(0.5, r.d / 900);
    var floorDiff  = pbrTex(diffName);
    var floorNorm  = pbrTexLinear(normName);
    var floorRough = pbrTexLinear(roughName);
    [floorDiff, floorNorm, floorRough].filter(Boolean).forEach(function(t){ t.repeat.set(repU, repV); });
    var matParams = {
      color: 0xffffff, map: floorDiff,
      normalMap: floorNorm, normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: floorRough, roughness: 1.0, metalness: 0.0
    };
    if(r.texture && r.texture !== 'wood_floor' && r.texture !== 'tile_floor'){
      var baseTex = getTexture3D(r.texture);
      if(baseTex) matParams.map = baseTex;
    }"""

if OLD_FLOOR_MAT in src:
    src = src.replace(OLD_FLOOR_MAT, NEW_FLOOR_MAT, 1)
    patches_applied.append('Task 9b: floor PBR texture applied')
elif 'floor_wood_diffuse.jpg' in src:
    patches_applied.append('Task 9b: floor texture already applied (skipped)')
else:
    patches_applied.append('Task 9b: WARNING - floor mat anchor not found, skipped')

# ─────────────────────────────────────────────────────────────────
# Task 9c: 外壁マテリアルにサイディングテクスチャ適用
# ─────────────────────────────────────────────────────────────────
OLD_WALL_MAT = "  var matParams = {color:color, roughness:0.7, metalness:0.1};"

NEW_WALL_MAT = """  var matParams = {color:color, roughness:0.7, metalness:0.0};
  var isOuter3d = w.thick >= 120;
  if(!w.texture && isOuter3d && typeof pbrTex === 'function'){
    var sidingDiff = pbrTex(w.floor === 1 ? 'wall_siding_diffuse.jpg' : 'wall_plaster_diffuse.jpg');
    var sidingNorm = pbrTexLinear(w.floor === 1 ? 'wall_siding_normal.jpg' : null);
    var wallLen = Math.sqrt(Math.pow(w.x2-w.x1,2)+Math.pow(w.y2-w.y1,2));
    sidingDiff.repeat.set(Math.max(1, wallLen/600), 1);
    matParams.map = sidingDiff;
    matParams.color = 0xffffff;
    if(sidingNorm){ sidingNorm.repeat.copy(sidingDiff.repeat); matParams.normalMap = sidingNorm; matParams.normalScale = new THREE.Vector2(0.8,0.8); }
  } else if(w.texture) {"""

OLD_WALL_TEXTURE_CHECK = "  if(w.texture) {"

if OLD_WALL_MAT in src:
    src = src.replace(OLD_WALL_MAT,
        NEW_WALL_MAT, 1)
    # Also fix the dangling "if(w.texture)" that now needs to be "} else if..."
    # The NEW_WALL_MAT already ends with "} else if(w.texture) {" so we need to
    # remove the original standalone "if(w.texture) {" that follows
    src = src.replace(
        NEW_WALL_MAT + "\n  if(w.texture) {",
        NEW_WALL_MAT, 1)
    patches_applied.append('Task 9c: wall siding texture applied')
elif 'wall_siding_diffuse.jpg' in src:
    patches_applied.append('Task 9c: wall texture already applied (skipped)')
else:
    patches_applied.append('Task 9c: WARNING - wall mat anchor not found, skipped')

# ─────────────────────────────────────────────────────────────────
# Task 10a: RGBELoader CDN スクリプトタグを追加
# ─────────────────────────────────────────────────────────────────
RGBE_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/RGBELoader.js"></script>'
BLOOM_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js"></script>'

if RGBE_SCRIPT not in src:
    src = src.replace(BLOOM_SCRIPT, BLOOM_SCRIPT + '\n' + RGBE_SCRIPT, 1)
    patches_applied.append('Task 10a: RGBELoader CDN script added')
else:
    patches_applied.append('Task 10a: RGBELoader already present (skipped)')

# ─────────────────────────────────────────────────────────────────
# Task 10b: PMREMGenerator で HDR 環境マップ初期化
# ─────────────────────────────────────────────────────────────────
HDR_INIT = """
  // HDR Environment Map
  (function(){
    if(typeof THREE.RGBELoader === 'undefined') return;
    var pmrem = new THREE.PMREMGenerator(ren);
    pmrem.compileEquirectangularShader();
    new THREE.RGBELoader()
      .setDataType(THREE.UnsignedByteType)
      .load('assets/env/outdoor.hdr', function(hdrTex) {
        sc3.environment = pmrem.fromEquirectangular(hdrTex).texture;
        hdrTex.dispose(); pmrem.dispose();
        rebuild3D();
      }, undefined, function(err) {
        console.warn('[WebCAD] HDR load failed, using fallback lighting');
      });
  })();"""

# Anchor: the ambient light that's created in init3D
ANCHOR_HDR = "  var amb = new THREE.AmbientLight(0xffffff, 0.4);"
if HDR_INIT.strip() not in src and 'PMREMGenerator' not in src:
    if ANCHOR_HDR in src:
        src = src.replace(ANCHOR_HDR, ANCHOR_HDR + HDR_INIT, 1)
        patches_applied.append('Task 10b: PMREMGenerator HDR init added')
    else:
        patches_applied.append('Task 10b: WARNING - ambient light anchor not found, skipped')
else:
    patches_applied.append('Task 10b: HDR init already present (skipped)')

# ─────────────────────────────────────────────────────────────────
# Task 11a: fitShadowCamera 関数を追加
# ─────────────────────────────────────────────────────────────────
FIT_SHADOW = """
function fitShadowCamera(sunLight) {
  var box = new THREE.Box3();
  sc3.traverse(function(obj){
    if(obj.isMesh && obj.name !== '_sky') box.expandByObject(obj);
  });
  if(box.isEmpty()) return;
  var size = box.getSize(new THREE.Vector3());
  var r = Math.max(size.x, size.z) * 1.3 / 2;
  sunLight.shadow.camera.left   = -r; sunLight.shadow.camera.right  =  r;
  sunLight.shadow.camera.top    =  r; sunLight.shadow.camera.bottom = -r;
  sunLight.shadow.camera.near   = 0.5;
  sunLight.shadow.camera.far    = size.y * 3 + 80;
  sunLight.shadow.camera.updateProjectionMatrix();
}"""

if 'function fitShadowCamera' not in src:
    # Insert before rebuild3D
    src = src.replace('function rebuild3D()', FIT_SHADOW + '\nfunction rebuild3D()', 1)
    patches_applied.append('Task 11a: fitShadowCamera added')
else:
    patches_applied.append('Task 11a: fitShadowCamera already present (skipped)')

# ─────────────────────────────────────────────────────────────────
# Task 11b: rebuild3D の末尾で fitShadowCamera を呼ぶ
# ─────────────────────────────────────────────────────────────────
# Find a reliable anchor near the end of rebuild3D
SHADOW_CALL = """
  // Fit shadow camera to building
  var _sunLight = null;
  sc3.traverse(function(o){ if(o.isDirectionalLight) _sunLight = o; });
  if(_sunLight) fitShadowCamera(_sunLight);"""

# Anchor: the toneMapping line near end of rebuild3D
ANCHOR_REBUILD_END = "  ren.toneMappingExposure=1.0;"
if 'fitShadowCamera(_sunLight)' not in src:
    if ANCHOR_REBUILD_END in src:
        src = src.replace(ANCHOR_REBUILD_END, ANCHOR_REBUILD_END + SHADOW_CALL, 1)
        patches_applied.append('Task 11b: fitShadowCamera call added to rebuild3D')
    else:
        patches_applied.append('Task 11b: WARNING - rebuild3D anchor not found, skipped')
else:
    patches_applied.append('Task 11b: fitShadowCamera call already present (skipped)')

# ─────────────────────────────────────────────────────────────────
# Task 11c: SAO パラメータ最適化
# ─────────────────────────────────────────────────────────────────
OLD_SAO = "        var sao = new THREE.SAOPass(sc3, camExt, false, true);\n        composer.addPass(sao);"
NEW_SAO = """        var sao = new THREE.SAOPass(sc3, camExt, false, true);
        sao.params.output = 0;
        sao.params.saoBias = 0.5;
        sao.params.saoIntensity = 0.18;
        sao.params.saoScale = 10;
        sao.params.saoKernelRadius = 12;
        sao.params.saoMinResolution = 0;
        sao.params.saoBlur = true;
        composer.addPass(sao);"""

if OLD_SAO in src:
    src = src.replace(OLD_SAO, NEW_SAO, 1)
    patches_applied.append('Task 11c: SAO params tuned')
elif 'sao.params.saoIntensity' in src:
    patches_applied.append('Task 11c: SAO params already tuned (skipped)')
else:
    patches_applied.append('Task 11c: WARNING - SAO anchor not found, skipped')

# ─────────────────────────────────────────────────────────────────
# Task 11d: Bloom 調整（strength を 0.35→0.25、threshold を 0.85→0.90）
# ─────────────────────────────────────────────────────────────────
OLD_BLOOM = "var bloom = new THREE.UnrealBloomPass(new THREE.Vector2(wrap.clientWidth, wrap.clientHeight), 0.35, 0.4, 0.85);"
NEW_BLOOM = "var bloom = new THREE.UnrealBloomPass(new THREE.Vector2(wrap.clientWidth, wrap.clientHeight), 0.25, 0.4, 0.90);"

if OLD_BLOOM in src:
    src = src.replace(OLD_BLOOM, NEW_BLOOM, 1)
    patches_applied.append('Task 11d: Bloom tuned (0.35->0.25, 0.85->0.90)')
elif '0.25, 0.4, 0.90' in src:
    patches_applied.append('Task 11d: Bloom already tuned (skipped)')
else:
    patches_applied.append('Task 11d: WARNING - Bloom anchor not found, skipped')

# ─────────────────────────────────────────────────────────────────
# 書き出し
# ─────────────────────────────────────────────────────────────────
if src == original:
    print("No changes made (all patches already applied or anchors not found).")
else:
    with open(TARGET, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f"Patched: {TARGET}")

print("\nPatch summary:")
for p in patches_applied:
    status = "✓" if "WARNING" not in p else "⚠"
    print(f"  {status} {p}")
