// Resolve the app's vendored Three.js in Node without creating node_modules.
// No browser, WebGL context, network fetch or repository dependency change.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return {url:new URL('../../../../assets/vendor/three/build/three.module.js',import.meta.url).href,shortCircuit:true};
  }
  return nextResolve(specifier,context);
}
