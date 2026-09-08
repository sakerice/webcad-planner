(function(root){
  function create(T,texture){
    return new T.ShaderMaterial({
      name:'PhotographicSky',side:T.BackSide,depthWrite:false,toneMapped:false,
      uniforms:{cloudMap:{value:texture},sunDirection:{value:new T.Vector3(1,2,1).normalize()},night:{value:0},warmth:{value:0},haze:{value:0.2},coverage:{value:0.45},environmentMode:{value:0}},
      vertexShader:'varying vec2 skyUv; varying vec3 skyDirection; void main(){skyUv=uv;skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`
        uniform sampler2D cloudMap;
        uniform vec3 sunDirection;
        uniform float night;
        uniform float warmth;
        uniform float haze;
        uniform float coverage;
        uniform float environmentMode;
        varying vec2 skyUv;
        varying vec3 skyDirection;
        // Overlap translated tiles with periodic weights. No UV reflection.
        // A sample's weight reaches zero where that sample crosses its edge.
        float cloudDensity(vec2 uv){
          vec2 weight=0.5-0.5*cos(6.28318530718*uv);
          float a=texture2D(cloudMap,uv).r;
          float b=texture2D(cloudMap,uv+vec2(0.5,0.0)).r;
          float c=texture2D(cloudMap,uv+vec2(0.0,0.5)).r;
          float d=texture2D(cloudMap,uv+vec2(0.5,0.5)).r;
          return mix(mix(d,c,weight.x),mix(b,a,weight.x),weight.y);
        }
        void main(){
          vec3 dir=normalize(skyDirection);
          // Project onto a cloud layer: no longitude seam or pole singularity.
          // Mipmaps and horizon fade keep distant repetitions from shimmering.
          vec2 cloudUv=dir.xz/(max(dir.y,0.0)+0.24)*0.62;
          cloudUv+=vec2(0.37,0.19)+0.13*vec2(sin(cloudUv.y*1.7),sin(cloudUv.x*1.3));
          float detail=cloudDensity(cloudUv);
          float distribution=0.72+0.16*sin(cloudUv.x*1.17+cloudUv.y*0.71)
            +0.12*cos(cloudUv.y*1.39-cloudUv.x*0.43);
          float cloud=detail*distribution*smoothstep(-0.015,0.16,dir.y)*coverage/0.45;
          float positiveElevation=0.5*(dir.y+sqrt(dir.y*dir.y+0.0064));
          float elevation=pow(clamp(positiveElevation,0.0,1.0),0.42);
          // Linear-light colours: keep a saturated blue away from the horizon.
          // The narrow pale horizon must not wash out the whole hemisphere.
          float blueAltitude=pow(clamp(positiveElevation,0.0,1.0),0.16);
          vec3 clearSky=mix(vec3(0.18,0.40,0.65),vec3(0.003,0.065,0.48),blueAltitude);
          // Sun elevation and scattering angle influence the entire daytime sky,
          // including summer/equinox differences above the sunset range.
          float solarHeight=max(sunDirection.y,0.0);
          float towardSun=max(dot(dir,sunDirection),0.0);
          float airPath=1.0/(0.18+solarHeight);
          float veil=clamp(haze*(0.2+0.65*(1.0-elevation))+0.003*airPath*(1.0-elevation)*(1.0-elevation),0.0,0.75);
          clearSky*=0.72+0.28*sqrt(solarHeight);
          clearSky=mix(clearSky,vec3(0.69,0.76,0.84),veil);
          clearSky+=vec3(0.13,0.10,0.065)*pow(towardSun,8.0)*(0.025+haze);
          vec3 cloudLight=mix(vec3(0.59,0.65,0.73),vec3(0.96,0.97,1.0),detail);
          vec3 base=mix(clearSky,cloudLight,smoothstep(0.035,0.80,cloud));
          float horizon=exp(-abs(dir.y)*3.5);
          float luminance=dot(base,vec3(0.2126,0.7152,0.0722));
          vec3 dusk=mix(base*vec3(0.62,0.40,0.60),vec3(0.8,0.29,0.085)*(0.25+luminance),horizon*(0.25+0.5*pow(towardSun,2.0)));
          vec3 color=mix(base,dusk,warmth);
          color=mix(color,vec3(0.003,0.007,0.023)+base*0.024,night);
          float alignment=max(0.0,dot(dir,sunDirection));
          float glow=pow(alignment,160.0)*0.18;
          float disk=smoothstep(0.99994,0.99998,alignment);
          color+=mix(vec3(1.0,0.93,0.74),vec3(1.0,0.48,0.16),warmth)*(glow+disk)*(1.0-night);
          color=mix(color,vec3(0.12)*(1.0-night*0.95),environmentMode*(1.0-smoothstep(-0.12,0.02,dir.y)));
          gl_FragColor=vec4(color,1.0);
          #include <colorspace_fragment>
        }`
    });
  }
  root.PhotographicSky={create:create};
})(globalThis);
