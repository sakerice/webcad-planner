"""Six original periodic PBR surfaces. Requires Python + numpy + Pillow.
No photos, external textures, downloaded images, or generated bitmap inputs.
Python textures.py [--output-root /tmp/kominka-replay]
Height is in millimetres; normals use OpenGL +Y / image-row-down convention.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
N=1023
Y,X=np.mgrid[0:N,0:N].astype(np.float64)/N
V=1-Y
RNG=np.random.default_rng(20261012)
FX=np.fft.fftfreq(N)[None,:]
FY=np.fft.fftfreq(N)[:,None]


def noise(radius, seed):
    rng=np.random.default_rng(seed)
    values=rng.normal(size=(N,N))
    spectrum=np.fft.fft2(values)
    spectrum*=np.exp(-2*np.pi*np.pi*radius*radius*(FX*FX+FY*FY))
    a=np.fft.ifft2(spectrum).real
    return a/(a.std()+1e-12)

COARSE=noise(38,301)
MEDIUM=noise(9,302)
FINE=noise(.9,303)
MICRO=noise(.25,304)


def wrap_distance(value,center):return np.abs((value-center+.5)%1-.5)


def yakisugi():
    # 6 x 180mm pitch, 30mm cover battens overlap board edges, not additive.
    phase=(X*6)%1
    distance=np.minimum(phase,1-phase)
    batten=np.clip((30/180/2-distance)*35,0,1)
    warp=.9*np.sin(2*np.pi*V*2)+.45*MEDIUM
    grain=np.sin(2*np.pi*X*165+warp)+.55*np.sin(2*np.pi*X*331+.7*warp)
    crack=np.clip((grain-1.0)*2,0,1)
    board_tones=np.array([0,1.1,-1.2,.8,-.4,1.2])[np.floor(X*6).astype(int)]
    tone=3*COARSE+1.6*MEDIUM+1.6*FINE+2.6*grain-5*crack+board_tones
    color=np.stack([38+tone,38+tone*.93,34+tone*.90],axis=-1)
    color=color*(1-.29*batten[...,None])
    height=.40*grain+.06*FINE-.35*crack+5.0*batten
    return color,height,.93-.025*grain+.018*FINE


def shikkui():
    # Soft trowel clouding with shallow original overlapping periodic arcs.
    trowel=.4*COARSE+.16*MEDIUM
    color=np.stack([218+1.5*trowel+.4*FINE,212+1.5*trowel+.4*FINE,
                     196+1.6*trowel+.4*FINE],axis=-1)
    return color,.11*trowel+.012*FINE,.95+.012*FINE


def juraku():
    tone=2.2*COARSE+1.0*MEDIUM+1.5*FINE
    straw=np.zeros((N,N))
    rng=np.random.default_rng(81)
    for i in range(110):
        x,y=rng.random(2);a=rng.uniform(0,np.pi)
        dx=(X-x+.5)%1-.5;dy=(Y-y+.5)%1-.5
        along=dx*np.cos(a)+dy*np.sin(a)
        across=-dx*np.sin(a)+dy*np.cos(a)
        straw+=np.exp(-((along/.004)**8+(across/.00045)**2))
    color=np.stack([171+tone+11*straw,148+tone+10*straw,106+tone+7*straw],axis=-1)
    return color,.07*FINE+.02*MICRO+.1*straw,.95+.02*FINE


def aniso_noise(rx, ry, seed):
    # Gaussian-filtered noise stretched along one axis (ry>rx: streaks along v).
    rng=np.random.default_rng(seed)
    spectrum=np.fft.fft2(rng.normal(size=(N,N)))
    spectrum*=np.exp(-2*np.pi*np.pi*(rx*rx*FX*FX+ry*ry*FY*FY))
    a=np.fft.ifft2(spectrum).real
    return a/(a.std()+1e-12)


def kayabuki():
    # Redone by Claude (2026-10-12): the first version drew 5mm sine reeds, which at
    # 1024px/1.2m read as corduroy. A thatch surface shows the trimmed butt ends of
    # reed bundles: short streaks along the slope (v), stacked in courses with a
    # shadowed lip every 200mm, weathered grey-brown with darker damp patches.
    streak=aniso_noise(.7,9,411)                 # individual reed ends, ~1mm wide x ~10mm long
    clump=aniso_noise(3,24,412)                  # bundles of reeds
    course=(V*6+.06*MEDIUM)%1                    # 6 courses per 1.2m tile, slightly wavy
    lip=np.clip(1-course/.3,0,1)**3              # shadow under the overhang of the course above
    rise=course                                  # each course thickens toward its top
    damp=np.clip(.5*COARSE+.35*MEDIUM-.15,0,None)
    tone=9*streak+6*clump-30*lip-8*damp+2.5*FINE
    color=np.stack([118+tone,108+tone*.95,88+tone*.88],axis=-1)
    height=.9*streak+1.2*clump+6*rise-4*lip
    rough=np.clip(.94+.02*FINE+.03*lip,0,1)
    return color,height,rough


def old_pine():
    widths=np.array([180,210,150,240,180,210,150,240,240])/1800
    edges=np.r_[0,np.cumsum(widths)]
    col=np.searchsorted(edges,X,side='right')-1
    col=np.clip(col,0,8)
    base_tones=np.array([0,-8,6,-3,3,-6,5,1,-4])[col]
    grain=np.sin(2*np.pi*X*193+.65*np.sin(2*np.pi*V*3))
    grain+=.55*np.sin(2*np.pi*X*371+.4*np.sin(2*np.pi*V*5))
    tone=base_tones+2.2*grain+1.3*FINE+1.9*MEDIUM
    seam=np.zeros((N,N));joint=np.zeros((N,N));jointtone=np.zeros((N,N))
    for edge in edges[:-1]:
        seam=np.maximum(seam,np.exp(-(wrap_distance(X,edge)/.0009)**4))
    # Different length-wise butt joints on every course; no continuous grid.
    positions=[(.16,.69),(.35,),(.12,.59),(.44,.86),(.24,.72),(.53,),(.08,.63),(.31,.78),(.45,)]
    for i,ys in enumerate(positions):
        mask=(col==i)
        for j,yy in enumerate(ys):
            joint=np.maximum(joint,np.exp(-(wrap_distance(Y,yy)/.0009)**4)*mask)
            jointtone+=mask*(Y>yy)*(2 if j%2 else -3)
    seams=np.maximum(seam,joint)
    tone+=jointtone
    color=np.stack([101+tone,68+tone*.82,40+tone*.64],axis=-1)
    color=color*(1-.62*seams[...,None])
    return color,.12*grain+.014*FINE-.8*seams,.79+.020*FINE+.1*seams


def doma():
    tone=2.0*COARSE+1.1*MEDIUM+1.5*FINE
    pebble=np.zeros((N,N));relief=np.zeros((N,N))
    rng=np.random.default_rng(73)
    for i in range(740):
        x,y=rng.random(2);rx=rng.uniform(.0008,.0045);ry=rx*rng.uniform(.55,1.3)
        ds=(wrap_distance(X,x)/rx)**2+(wrap_distance(Y,y)/ry)**2
        shape=np.clip(1-ds,0,1)
        pebble+=shape*rng.uniform(-13,16)
        relief+=shape*rng.uniform(.06,.33)
    color=np.stack([139+tone+pebble,131+tone+pebble,113+tone+pebble],axis=-1)
    return color,.08*FINE+.012*MICRO+relief,.94+.015*FINE


def tatami():
    # Added by Claude (2026-10-12). Two 910x1820mm mats side by side make one 1820mm
    # tile; repeated, they lie in a plain grid. The rush weave runs across each mat
    # (rows every ~4mm along v), the cloth border (heri, 30mm) runs along the long sides.
    mat=(X*2)%1                                  # 0..1 across each mat's 910mm width
    d=np.minimum(mat,1-mat)*910                  # mm to the nearest long side
    heri=np.clip((30-d)*.6,0,1)
    seam=np.exp(-(d/1.2)**2)
    weave=np.sin(2*np.pi*V*121+.25*FINE)          # the ~15mm rows of the mat surface (目)
    endseam=np.exp(-(wrap_distance(V,0)*1820/1.2)**2)  # short ends of the mats meet at the tile edge
    reed=aniso_noise(6,.6,421)                   # individual rush stems run across (along u)
    tone=3*COARSE+1.5*MEDIUM+6*np.abs(weave)**.5*np.sign(weave)+3*reed
    mats=np.where(np.floor(X*2)%2==0,2,-2)       # the two mats age a little differently
    color=np.stack([178+tone+mats,170+tone*.95+mats,116+tone*.75],axis=-1)
    hericolor=np.stack([46+1.5*FINE,40+1.5*FINE,34+1.5*FINE],axis=-1)
    color=color*(1-heri[...,None])+hericolor*heri[...,None]
    seam=np.maximum(seam,endseam*(1-heri))
    color=color*(1-.5*seam[...,None])
    height=.25*weave+.1*reed+.6*heri-.8*seam
    rough=np.clip(.86+.02*FINE+.06*heri,0,1)
    return color,height,rough


def encode(a):
    if a.ndim==2:a=np.repeat(a[...,None],3,axis=2)
    a=np.concatenate((a,a[:1,:,:]),axis=0)
    a=np.concatenate((a,a[:,:1,:]),axis=1)
    return np.clip(np.rint(a),0,255).astype(np.uint8)


def main():
    p=argparse.ArgumentParser();p.add_argument('--output-root',type=Path,default=ROOT)
    args=p.parse_args();out=args.output_root
    target=out/'assets/textures/kominka';target.mkdir(parents=True,exist_ok=True)
    evidence=out/'tools/blender/kominka/evidence';evidence.mkdir(parents=True,exist_ok=True)
    catalog=json.loads((HERE/'catalogue.json').read_text())
    functions=[yakisugi,shikkui,juraku,kayabuki,old_pine,doma,tatami]
    reports=[]
    sheet=Image.new('RGB',(3*640,3*686),'#e6e4df');draw=ImageDraw.Draw(sheet)
    for i,(it,fun) in enumerate(zip(catalog['textures'],functions)):
        rgb,height,rough=fun()
        dhdu=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))/(2*it['tileMm']/N)
        # JPEG rows point down; physical v points up. Green = +dH/d(row distance).
        dhdv=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))/(2*it['tileMm']/N)
        normal=np.stack([-dhdu,dhdv,np.ones_like(height)],axis=-1)
        normal/=np.linalg.norm(normal,axis=-1)[...,None]
        maps={'diffuse':encode(rgb),'normal':encode((normal*.5+.5)*255),'roughness':encode(rough*255)}
        for suffix,array in maps.items():
            path=target/f'{it["key"]}_{suffix}.jpg'
            Image.fromarray(array).save(path,quality=85,subsampling=0)
        im=Image.open(target/f'{it["key"]}_diffuse.jpg')
        tiled=Image.new('RGB',(2048,2048))
        for x in (0,1024):
            for y in (0,1024):tiled.paste(im,(x,y))
        tiled.resize((1024,1024),Image.Resampling.LANCZOS).save(evidence/f'{it["key"]}-tile4.jpg',quality=85)
        cx=i%3*640;cy=i//3*686
        draw.text((cx+12,cy+12),it['key']+' | tile '+str(it['tileMm'])+' mm',fill='#2b302e')
        sheet.paste(tiled.resize((620,620),Image.Resampling.LANCZOS),(cx+10,cy+40))
        rec=dict(it,normalConvention='OpenGL +Y; RGB=(normal*0.5+0.5)',jpegQuality=85,
                 imageSize=[1024,1024],provenance='original',maps={})
        for suffix in maps:
            data=np.asarray(Image.open(target/f'{it["key"]}_{suffix}.jpg'),dtype=float)
            edgeX=np.abs(data[:,0]-data[:,-1]);edgeY=np.abs(data[0]-data[-1])
            rec['maps'][suffix]=dict(edgeMean=float((edgeX.mean()+edgeY.mean())/2),edgeMax=float(max(edgeX.max(),edgeY.max())))
        reports.append(rec)
        print(it['key'],rec['maps'],flush=True)
    sheet.save(evidence/'textures-tile4-sheet.jpg',quality=88)
    (out/'tools/blender/kominka/texture-validation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
