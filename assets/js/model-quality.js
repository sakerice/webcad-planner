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
  // UVの1辺が実世界の何メートルに当たるか。
  //
  // **家具のUVは物によってばらばら**なので、テクスチャをそのまま貼ると、
  // 同じ木目が机では板幅30mm、クローゼットでは300mmに見える。面の世界面積と
  // UV面積の比から密度を出して、壁と同じ実寸(TEX_TILE_M)で貼れるようにする。
  //
  // 壁は面の寸法から直接タイル数を出せるが、家具は箱ではないのでこの方法になる。
  function metresPerUv(mesh){
    var g=mesh.geometry,uv=g&&g.attributes&&g.attributes.uv,pos=g&&g.attributes&&g.attributes.position;
    if(!uv||!pos) return 0;
    var index=g.index, count=index?index.count:pos.count, world=0, area=0;
    var m=mesh.matrixWorld, a={},b={},c={};
    function at(i,out){
      var k=index?index.getX(i):i;
      out.x=pos.getX(k);out.y=pos.getY(k);out.z=pos.getZ(k);out.u=uv.getX(k);out.v=uv.getY(k);
      // 世界座標へ（行列の適用は three.js に任せず、必要な3成分だけ自前で）
      var e=m.elements,x=out.x,y=out.y,z=out.z;
      out.wx=e[0]*x+e[4]*y+e[8]*z+e[12];
      out.wy=e[1]*x+e[5]*y+e[9]*z+e[13];
      out.wz=e[2]*x+e[6]*y+e[10]*z+e[14];
    }
    // **三角形ごとの密度を集めて、中央値を採る。**
    // 面積の合計どうしで割ると、アトラス(1枚の絵に部位を詰め込んだUV)の
    // 外れ値に引きずられる。実測で、1.2mのクローゼットに repeat=15 が出た
    // (板幅が10分の1になる)。中央値なら、その品の大半の面に合う。
    var step=Math.max(3,Math.floor(count/900)*3);   // 大きいメッシュは間引いて測る
    var samples=[];
    for(var i=0;i+2<count;i+=step){
      at(i,a);at(i+1,b);at(i+2,c);
      var ux=b.wx-a.wx,uy=b.wy-a.wy,uz=b.wz-a.wz,vx=c.wx-a.wx,vy=c.wy-a.wy,vz=c.wz-a.wz;
      var cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx;
      world=Math.sqrt(cx*cx+cy*cy+cz*cz)/2;
      area=Math.abs((b.u-a.u)*(c.v-a.v)-(c.u-a.u)*(b.v-a.v))/2;
      if(world>1e-9&&area>1e-9) samples.push(Math.sqrt(world/area));
    }
    if(!samples.length) return 0;
    samples.sort(function(x,y){return x-y;});
    return samples[samples.length>>1];
  }

  /**
   * 色・艶・テクスチャを部位ごとに当てる。
   * @param deps {texture,normal,tileM} アプリ側の資産解決。無ければテクスチャは当てない。
   */
  function applyFinishes(scene,colors,roughness,textures,deps){
    colors=colors&&typeof colors==='object'?colors:{};roughness=roughness&&typeof roughness==='object'?roughness:{};
    textures=textures&&typeof textures==='object'?textures:{};deps=deps||{};
    scene.traverse(function(mesh){
      if(!mesh.isMesh || !mesh.material) return;
      function finish(material){
        var channel=material.userData&&material.userData.finishChannel;
        var value=channel&&colors[channel];
        var hasColor=/^#[0-9a-f]{6}$/i.test(value||'')&&material.color;
        var r=channel&&roughness[channel],hasRoughness=typeof r==='number'&&isFinite(r)&&r>=.15&&r<=1;
        var key=channel&&textures[channel];
        var map=key&&typeof deps.texture==='function'?deps.texture(key):null;
        if(!hasColor&&!hasRoughness&&!map) return material;
        var own=material.clone();
        if(map){
          // **柄を差し替えたら、元の柄をほどく処理は要らない。** 指定色は
          // 新しい柄にそのまま掛かる(neutralizeFinish は元の柄の色味を
          // 消すためのもので、差し替え後にかけると二重に効く)。
          var metres=metresPerUv(mesh);
          var tile=typeof deps.tileM==='function'?deps.tileM(key,0.9):0.9;
          if(metres>0&&tile>0){
            var repeat=metres/tile;
            if(isFinite(repeat)&&repeat>0){ map.repeat.set(repeat,repeat); map.needsUpdate=true; }
          }
          own.map=map;
          var normal=typeof deps.normal==='function'?deps.normal(key):null;
          if(normal){ if(map.repeat) normal.repeat.copy(map.repeat); own.normalMap=normal; }
          own.userData=Object.assign({},own.userData,{neutralizeFinish:false});
          if(hasColor) own.color.set(value);
        }else if(hasColor){
          own.color.set(value);
          if(material.map&&material.userData.neutralizeFinish)neutralizeFinish(own);
        }
        if(hasRoughness) own.roughness=r;
        return own;
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
