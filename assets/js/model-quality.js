/* Material corrections for bundled Unity exports. Apply once, before caching so
   individual meshes and instanced meshes use the same surface response. */
(function(root){
  function repairMaterial(mat, url){
    if(!mat || !/assets\/models\/(unity_exported|furniture_mega)\//.test(url)) return;
    var name=mat.name||'';
    // Refrigerator shell is coated sheet metal, not bare conductor.
    if(/Refrigerator\d*\.glb$/.test(url))mat.metalness=0.04;
    var textile=/blanket|mattress|fabric|pillow|cushion/i.test(name);
    // These exports multiply the roughness texture by zero. Restore the map's
    // authored values; do not flatten mixed-material atlases (kitchens/chairs).
    if(mat.roughness===0 && mat.roughnessMap) mat.roughness=1;
    if(textile){
      mat.roughness=0.94;
      mat.roughnessMap=null;
      mat.metalness=0;
      mat.metalnessMap=null;
      if(mat.clearcoat!==undefined) mat.clearcoat=0;
      mat.envMapIntensity=0.3;
    }
    mat.needsUpdate=true;
  }
  function neutralizeFinish(material){
    // Preserve compressed textures, UVs, normal/AO maps and alpha. Only remove
    // dye from the sampled base color, in linear space, for a custom finish.
    material.onBeforeCompile=function(shader){
      shader.uniforms.finishReference={value:material.userData.finishReference||1};
      shader.fragmentShader='uniform float finishReference;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n#ifdef USE_MAP\n diffuseColor.rgb = diffuse * vec3(clamp(dot(sampledDiffuseColor.rgb, vec3(0.2126,0.7152,0.0722))/finishReference,0.0,1.0));\n#endif');
    };
    material.customProgramCacheKey=function(){return 'neutral-model-finish-v1';};
    material.needsUpdate=true;
  }
  // 外部アセットの「色を変えられる部位」。
  //
  // **もとは2点だけ手書きしてあった。** 685点中684点がテクスチャ付きで、
  // applySelectableColor はテクスチャ付きを対象外にするため、外部アセットは
  // ほぼ色を変えられない状態だった。仕組み(neutralizeFinish)は足りていて、
  // 配線されていなかっただけなので、tools/assign_finish_channels.mjs が
  // 全点ぶんを assets/models/finishes.json に貼り、ここへ差し込む。
  //
  // 読めなければ空のまま。**その場合はこれまでどおり色を変えられないだけで、
  // モデルの見た目は変わらない。**
  // **人が実物を見て決めた2点は、ここに残す。** finishes.json が読めなかった
  // ときでも、前と同じだけは効く(検査 tools/tests/model-details.test.cjs が
  // これを見ている)。読めたら、その上に全点ぶんがかぶさる。
  var SEED_FINISHES={
    'assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb':
      {'BOLIA-Ivory':'wood','sofa-e5ybetgdh45y.002':'fabric','sofa-e5ybetgdh45y.003':'accent'},
    'assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb':{'43693':'wood'}
  };
  var SEED_REFERENCES={
    'assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb':{'BOLIA-Ivory':.3},
    'assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb':{'43693':.08}
  };
  function merge(base,extra){
    var out={};Object.keys(base).forEach(function(k){out[k]=Object.assign({},base[k]);});
    Object.keys(extra||{}).forEach(function(k){out[k]=Object.assign(out[k]||{},extra[k]);});
    return out;
  }
  var externalFinishes=merge(SEED_FINISHES,null);
  var finishReferences=merge(SEED_REFERENCES,null);
  // 部位ごとの代表値。**測れなかった柄はこれを使う。**
  // 既定の1のままだと、柄の平均輝度が0.36なら指定色が約1/3の明るさで出る。
  // 値の出どころは tools/measure_finish_references.py（測れたぶんの中央値）。
  var finishDefaults={};
  function setFinishes(data){
    externalFinishes=merge(SEED_FINISHES,data&&data.models);
    finishReferences=merge(SEED_REFERENCES,data&&data.references);
    finishDefaults=(data&&data.defaults)||{};
  }
  function applyFinishes(scene,colors,roughness){
    colors=colors&&typeof colors==='object'?colors:{};roughness=roughness&&typeof roughness==='object'?roughness:{};
    scene.traverse(function(mesh){
      if(!mesh.isMesh || !mesh.material) return;
      function finish(material){
        var channel=material.userData&&material.userData.finishChannel;
        var value=channel&&colors[channel];
        var hasColor=/^#[0-9a-f]{6}$/i.test(value||'')&&material.color;
        var r=channel&&roughness[channel],hasRoughness=typeof r==='number'&&isFinite(r)&&r>=.15&&r<=1;
        if(!hasColor&&!hasRoughness) return material;
        var own=material.clone();if(hasColor){own.color.set(value);if(material.map&&material.userData.neutralizeFinish)neutralizeFinish(own);}if(hasRoughness) own.roughness=r;return own;
      }
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(finish):finish(mesh.material);
    });
  }
  function sourceYaw(url){return (/assets\/models\/furniture_mega\//.test(url)||/assets\/models\/refined\/car_sedan_/.test(url))?Math.PI:0;}
  function prepare(scene,url){
    // Canonical furniture front: +Z; up: +Y. Apply before bounding boxes/instances.
    if(scene.rotation && !(scene.userData&&scene.userData.facingNormalized)){
      scene.rotation.y+=sourceYaw(url);
      scene.userData=scene.userData||{};scene.userData.facingNormalized=true;
      scene.updateMatrixWorld(true);
    }
    scene.traverse(function(mesh){
      if(!mesh.isMesh) return;
      mesh.castShadow=true; mesh.receiveShadow=true;
      (Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(function(m){repairMaterial(m,url);
        var channel=externalFinishes[url]&&externalFinishes[url][m.name];
        if(channel){
          m.userData=m.userData||{};m.userData.finishChannel=channel;m.userData.neutralizeFinish=true;
          // 柄を輝度に落とすときの基準値。**人が実物を見て決めたものだけ持つ。**
          // 機械が貼ったぶんには無いので既定(1)で効く。暗い木目ほど小さい値が要る。
          var ref=finishReferences[url]&&finishReferences[url][m.name];
          if(typeof ref!=='number') ref=finishDefaults[channel];
          if(typeof ref==='number') m.userData.finishReference=ref;
        }
      });
    });
  }
  var api={applyFinishes:applyFinishes,repairMaterial:repairMaterial,prepare:prepare,sourceYaw:sourceYaw,setFinishes:setFinishes};
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ModelQuality=api;
})(typeof window==='object'?window:globalThis);
