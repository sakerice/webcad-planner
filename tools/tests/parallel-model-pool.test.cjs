'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {modelPool}=require('../../assets/js/parallel-editors.js');
test('concurrent model requests load once and retain immutable geometry/texture ownership',async()=>{
 const pool=modelPool();let loads=0,geometryDisposed=0,textureDisposed=0,materialDisposed=0;
 const geometry={dispose(){geometryDisposed++;}},texture={isTexture:true,dispose(){textureDisposed++;}};
 const material={map:texture,dispose(){materialDisposed++;}};
 const scene={traverse(fn){fn({geometry,material});fn({geometry,material:[]});}};
 const load=async()=>{loads++;return scene;};
 const [a,b]=await Promise.all([pool.get('sofa.glb',load),pool.get('sofa.glb',load)]);
 assert.equal(loads,1);assert.equal(a,b);assert.deepEqual([...pool.resources],[geometry,texture]);
 assert.equal(geometryDisposed+textureDisposed+materialDisposed,0,'loading a template does not dispose shared resources');
 await pool.dispose();assert.equal(geometryDisposed,1);assert.equal(textureDisposed,1);assert.equal(materialDisposed,1);assert.equal(pool.cache.size,0);assert.equal(pool.resources.size,0);
 await pool.dispose();assert.equal(geometryDisposed,1,'repeat cleanup does not release twice');
});
test('failed load is evicted, retries succeed, disposal waits for in-flight loads',async()=>{
 const pool=modelPool();await assert.rejects(pool.get('bad.glb',()=>Promise.reject(Error('fixture load failure'))),/fixture load failure/);assert.equal(pool.cache.size,0);
 let resolveLoad,disposed=0;const pending=pool.get('bad.glb',()=>new Promise(resolve=>{resolveLoad=resolve;}));
 await Promise.resolve();const release=pool.dispose();resolveLoad({traverse(fn){fn({geometry:{dispose(){disposed++;}}});}});await pending;await release;assert.equal(disposed,1);assert.equal(pool.cache.size,0);
});
