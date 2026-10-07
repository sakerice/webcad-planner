/* Temporary presentation-only fading owned by one editor. Never edits plan data,
 * physical placement, shared source materials, textures or instance matrices. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.WalkTpsOcclusion=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var FADE=.18;
  function create(T){
    var records=new Map(),boundsContracts=new WeakMap(),scene=null,disposed=false,last={occluders:0,instances:0,invalid:0};
    var ray=new T.Ray(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3();
    var matrix=new T.Matrix4(),local=new T.Matrix4(),origin=new T.Vector3();
    function finiteMatrix(m){return m&&m.elements.every(Number.isFinite)&&Math.abs(m.determinant())>1e-12;}
    function visible(o){for(var p=o;p;p=p.parent)if(!p.visible)return false;return true;}
    function excluded(o){for(var p=o;p;p=p.parent){var u=p.userData||{};
      if(u.walkTpsAvatar||u.walkTpsFootShadow||u.walkTpsOcclusion||u.setbackHelper||u.selectionHelper||u.moveGizmo||u.hitProxy||u.shadowHelper)return true;}return false;}
    function restore(r){
      // Another owner may deliberately replace a material/geometry. Do not
      // overwrite that newer state when releasing an old effect.
      if(r.mesh.material===r.faded){
        if(Array.isArray(r.faded)&&r.faded.some(function(m,i){return m!==r.ownedMaterials[i];}))
          r.mesh.material=r.faded.map(function(m,i){return m===r.ownedMaterials[i]?r.original[i]:m;});
        else r.mesh.material=r.original;
      }
      if(r.geometry&&r.mesh.geometry===r.geometry)r.mesh.geometry=r.originalGeometry;
    }
    function release(r){restore(r);new Set(r.ownedMaterials).forEach(function(m){m.dispose();});if(r.geometry)r.geometry.dispose();}
    function reset(){records.forEach(release);records.clear();scene=null;last={occluders:0,instances:0,invalid:0};}
    function equal(a,b){
      if(Object.is(a,b))return true;
      if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every(function(v,i){return equal(v,b[i]);});
      if(a&&b&&Object.getPrototypeOf(a)===Object.prototype&&Object.getPrototypeOf(b)===Object.prototype){
        var keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(function(k){return equal(a[k],b[k]);});
      }
      return false;
    }
    function valueState(value,depth,seen){
      if(!value||typeof value!=='object'||value.isTexture)return value;
      if(depth>6||seen.has(value))return value;
      if(value.isColor||value.isVector2||value.isVector3||value.isVector4||value.isQuaternion||value.isEuler||value.isMatrix3||value.isMatrix4)
        return {ref:value,values:value.toArray()};
      if(value.isPlane)return {ref:value,values:value.normal.toArray().concat(value.constant)};
      if(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null){
        seen.add(value);var keys=Object.keys(value).sort(),out={ref:value,values:keys.map(function(k){return [k,valueState(value[k],depth+1,seen)];})};seen.delete(value);return out;
      }
      return value;
    }
    function materialState(m){
      return Object.keys(m).filter(function(k){return k!=='_listeners';}).sort().map(function(k){return [k,valueState(m[k],0,new Set())];})
        .concat([['onBeforeCompile',m.onBeforeCompile],['customProgramCacheKey',m.customProgramCacheKey]]);
    }
    function attributeState(a){
      return a&&{ref:a,array:a.array||a.data&&a.data.array,data:a.data,version:a.version,dataVersion:a.data&&a.data.version,
        itemSize:a.itemSize,count:a.count,normalized:a.normalized,offset:a.offset,stride:a.data&&a.data.stride,
        usage:a.usage,gpuType:a.gpuType,meshPerAttribute:a.meshPerAttribute};
    }
    function geometryState(g){
      return {ref:g,index:attributeState(g.index),attributes:Object.keys(g.attributes).sort().map(function(k){return [k,attributeState(g.attributes[k])];}),
        morph:Object.keys(g.morphAttributes).sort().map(function(k){return [k,g.morphAttributes[k].map(attributeState)];}),
        morphTargetsRelative:g.morphTargetsRelative,instanceCount:g.instanceCount,start:g.drawRange.start,count:g.drawRange.count,
        groups:g.groups.map(function(group){return [group.start,group.count,group.materialIndex];})};
    }
    function injectionPoint(source,token){return source.split(token).length===2;}
    function privateDefines(value,seen){
      if(!value||typeof value!=='object')return value;
      if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return value;
      if(seen.has(value))return seen.get(value);
      var copy=Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value));seen.set(value,copy);
      Object.keys(value).forEach(function(k){Object.defineProperty(copy,k,{value:privateDefines(value[k],seen),
        writable:true,enumerable:true,configurable:true});});return copy;
    }
    function cloneMaterial(source,instanced,unsupported){
      if(!source||!source.isMaterial||!source.clone)return null;
      if(source.isShaderMaterial||source.isRawShaderMaterial)return null;
      if(instanced&&!(source.isMeshStandardMaterial||source.isMeshPhysicalMaterial||source.isMeshBasicMaterial||source.isMeshPhongMaterial||source.isMeshLambertMaterial||source.isMeshToonMaterial))return null;
      var m=source.clone(),compile=source.onBeforeCompile,key=source.customProgramCacheKey;
      // Built-in Material.copy resets constructor defines in Three r169. Keep
      // authored shader defines and hook semantics in an owned dictionary.
      m.defines=privateDefines(source.defines,new Map());
      m.onBeforeCompile=compile;m.customProgramCacheKey=key;
      m.transparent=true;m.depthWrite=false;m.side=T.DoubleSide;
      if(!instanced){m.opacity=source.opacity*FADE;m.alphaTest=source.alphaTest*FADE;}
      var coverageOnly=!instanced&&source.alphaToCoverage&&source.alphaTest>0;
      if(instanced||coverageOnly){
        m.onBeforeCompile=function(shader,renderer){
          if(compile)compile.call(this,shader,renderer);
          var nativeAlpha=T.ShaderChunk&&T.ShaderChunk.alphatest_fragment;
          var valid=typeof nativeAlpha==='string'&&injectionPoint(shader.fragmentShader,'#include <alphatest_fragment>')&&
            (!instanced||injectionPoint(shader.vertexShader,'#include <common>')&&injectionPoint(shader.vertexShader,'#include <begin_vertex>')&&
              injectionPoint(shader.fragmentShader,'#include <common>'));
          if(!valid){unsupported('shader-hook-incompatible');return;}
          if(coverageOnly){
            shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',nativeAlpha+
              '\n#if defined(USE_ALPHATEST) && defined(ALPHA_TO_COVERAGE)\ndiffuseColor.a *= '+FADE+';\n#endif');
            return;
          }
          shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float walkTpsFade;\nvarying float vWalkTpsFade;')
            .replace('#include <begin_vertex>','#include <begin_vertex>\nvWalkTpsFade=walkTpsFade;');
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vWalkTpsFade;')
            // Keep the exact native alpha-test/coverage branch. Fading AFTER
            // that branch preserves its original cutout and derivative semantics.
            .replace('#include <alphatest_fragment>',nativeAlpha+'\ndiffuseColor.a *= 1.0 - '+(1-FADE)+' * clamp(vWalkTpsFade, 0.0, 1.0);');
        };
        m.customProgramCacheKey=function(){return (key?key.call(source):'')+(instanced?'|walk-tps-instance-fade-v2':'|walk-tps-coverage-fade-v1');};
      }
      m.needsUpdate=true;return m;
    }
    function record(mesh){
      var prior=records.get(mesh),sources=[].concat(mesh.material||[]),geometryContract=geometryState(mesh.geometry),
        materialContract=sources.map(function(m){return m&&materialState(m);});
      if(prior&&(mesh.material!==prior.original||mesh.count!==prior.count||!equal(prior.geometryContract,geometryContract)||
        !equal(prior.materialContract,materialContract)||sources.length!==prior.sources.length||
        sources.some(function(m,i){return m!==prior.sources[i];}))){release(prior);records.delete(mesh);prior=null;}
      if(prior)return prior;
      var r=null,clones=sources.map(function(m){return cloneMaterial(m,mesh.isInstancedMesh,function(issue){
        if(r){r.shaderIssue=issue;last.invalid++;restore(r);}
      });});
      if(!sources.length||clones.some(function(m){return !m;})){clones.filter(Boolean).forEach(function(m){m.dispose();});return null;}
      r={mesh:mesh,original:mesh.material,originalGeometry:mesh.geometry,sources:sources,count:mesh.count,
        geometryContract:geometryContract,materialContract:materialContract,shaderIssue:null,ownedMaterials:clones.slice(),
        faded:Array.isArray(mesh.material)?clones:clones[0],geometry:null,attribute:null};
      if(mesh.isInstancedMesh){
        // A private geometry adds only presentation alpha. Original geometry,
        // matrices and culling/base-matrix bookkeeping stay untouched.
        r.geometry=mesh.geometry.clone();r.attribute=new T.InstancedBufferAttribute(new Float32Array(mesh.count),1);
        r.geometry.setAttribute('walkTpsFade',r.attribute);
      }
      records.set(mesh,r);return r;
    }
    function targetRays(camera,avatar){
      var box=new T.Box3().setFromObject(avatar);
      if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray(),...camera.position.toArray()].every(Number.isFinite))return null;
      var centre=box.getCenter(new T.Vector3()),half=box.getSize(new T.Vector3()).multiplyScalar(.5),targets=[];
      // Cover the visible body width and three height bands. Keep the lowest
      // band above the floor so a contact slab is not mistaken for an occluder.
      [-.85,0,.85].forEach(function(x){[-.85,0,.85].forEach(function(z){[-.7,0,.85].forEach(function(y){
        targets.push(new T.Vector3(centre.x+half.x*x,centre.y+half.y*y,centre.z+half.z*z));
      });});});
      origin.copy(camera.getWorldPosition(new T.Vector3()));
      if(!origin.toArray().every(Number.isFinite))return null;
      return targets.map(function(target){var d=target.sub(origin),length=d.length();return {direction:d.normalize(),length:length};});
    }
    function intersects(geometry,world,rays,materials){
      if(!finiteMatrix(world))return null;
      var p=geometry&&geometry.attributes.position,index=geometry&&geometry.index,count=index?index.count:p&&p.count;
      if(!p||!Number.isInteger(count)||count<3||count%3)return null;
      var positionContract=attributeState(p);
      if(!geometry.boundingBox||!equal(boundsContracts.get(geometry),positionContract)){
        geometry.computeBoundingBox();boundsContracts.set(geometry,positionContract);
      }
      var bounds=geometry.boundingBox&&geometry.boundingBox.clone().applyMatrix4(world);
      if(!bounds||bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))return null;
      var candidates=rays.filter(function(r){if(bounds.containsPoint(origin))return true;ray.set(origin,r.direction);var v=ray.intersectBox(bounds,hit);return v&&origin.distanceTo(v)<r.length-.06;});
      if(!candidates.length)return false;
      var start=Math.max(0,geometry.drawRange.start||0),end=Math.min(count,start+geometry.drawRange.count);
      if(!Number.isInteger(start)||!Number.isInteger(end)||start%3||end%3)return null;
      if(!Array.isArray(materials)&&materials&&materials.visible===false)return false;
      for(var i=start;i<end;i+=3){
        if(Array.isArray(materials)){
          var group=geometry.groups.find(function(g){return i>=g.start&&i+2<g.start+g.count;});
          if(!group||!materials[group.materialIndex]||materials[group.materialIndex].visible===false)continue;
        }
        var ids=index?[index.getX(i),index.getX(i+1),index.getX(i+2)]:[i,i+1,i+2];
        if(ids.some(function(id){return !Number.isInteger(id)||id<0||id>=p.count;}))return null;
        a.fromBufferAttribute(p,ids[0]).applyMatrix4(world);b.fromBufferAttribute(p,ids[1]).applyMatrix4(world);c.fromBufferAttribute(p,ids[2]).applyMatrix4(world);
        if(![...a.toArray(),...b.toArray(),...c.toArray()].every(Number.isFinite))return null;
        for(var j=0;j<candidates.length;j++){
          var r=candidates[j];ray.set(origin,r.direction);
          if(ray.intersectTriangle(a,b,c,false,hit)&&origin.distanceTo(hit)<r.length-.06)return true;
        }
      }
      return false;
    }
    function update(nextScene,camera,avatar){
      if(disposed)return false;
      if(nextScene!==scene){reset();scene=nextScene;}
      records.forEach(restore);last={occluders:0,instances:0,invalid:0};
      if(!scene||!camera||!avatar||!avatar.visible)return false;
      scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
      var rays=targetRays(camera,avatar);if(!rays){last.invalid++;return false;}
      var live=new Set();scene.traverse(function(mesh){
        if(!mesh.isMesh||!mesh.geometry||!mesh.userData.b||excluded(mesh)||!visible(mesh))return;
        live.add(mesh);var ids=[],blocked=false;
        if(mesh.isInstancedMesh){
          for(var i=0;i<mesh.count;i++){
            mesh.getMatrixAt(i,local);
            // A culled zero-scale instance is not rendered, and must remain
            // exactly in its existing culling state.
            if(local.elements.every(function(v,k){return v===(k===15?1:0);}))continue;
            matrix.multiplyMatrices(mesh.matrixWorld,local);var answer=intersects(mesh.geometry,matrix,rays,mesh.material);
            if(answer===null)last.invalid++;else if(answer)ids.push(i);
          }
          blocked=ids.length>0;
        }else{var answer=intersects(mesh.geometry,mesh.matrixWorld,rays,mesh.material);if(answer===null)last.invalid++;else blocked=answer;}
        if(!blocked)return;
        var r=record(mesh);if(!r){last.invalid++;return;}if(r.shaderIssue){last.invalid++;return;}
        if(r.attribute){r.attribute.array.fill(0);ids.forEach(function(i){r.attribute.setX(i,1);});r.attribute.needsUpdate=true;mesh.geometry=r.geometry;last.instances+=ids.length;}
        mesh.material=r.faded;last.occluders++;
      });
      records.forEach(function(r,mesh){if(!live.has(mesh)){release(r);records.delete(mesh);}});
      return last.occluders>0;
    }
    return {update:update,reset:reset,dispose:function(){if(!disposed){reset();disposed=true;}},
      debug:function(){return {occluders:last.occluders,instances:last.instances,invalid:last.invalid,
        shaderIssues:Array.from(records.values()).filter(function(r){return !!r.shaderIssue;}).map(function(r){return r.shaderIssue;}),
        ownedRecords:records.size,disposed:disposed};}};
  }
  return {create:create};
});
