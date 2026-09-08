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
  var externalFinishes={
    'assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb':{'BOLIA-Ivory':'wood','sofa-e5ybetgdh45y.002':'fabric','sofa-e5ybetgdh45y.003':'accent'},
    'assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb':{'43693':'wood'}
  };
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
        var channel=externalFinishes[url]&&externalFinishes[url][m.name];if(channel){m.userData=m.userData||{};m.userData.finishChannel=channel;m.userData.neutralizeFinish=true;if(channel==='wood')m.userData.finishReference=/bed-43693/.test(url)?.08:.3;}
      });
    });
  }
  var api={applyFinishes:applyFinishes,repairMaterial:repairMaterial,prepare:prepare,sourceYaw:sourceYaw};
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ModelQuality=api;
})(typeof window==='object'?window:globalThis);
