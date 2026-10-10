"""Seven original, deterministic, periodic roof PBR textures. No external inputs.

python generate.py   (requires numpy and Pillow)
1024px RGB JPEG, quality 85; normal/roughness numerical data stay linear.
Image top = ridge, bottom = eaves. UV +V = up; OpenGL normal green = +V.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'assets/textures/roof'
N=1024
# Sample one full period including identical endpoint samples. This supports
# exact source boundaries; post-JPEG boundaries are separately measured.
q=np.linspace(0,1,N,endpoint=True)
U,V=np.meshgrid(q,q)

SPECS=[
    dict(key='roof_kawara_ibushi',tile_mm=1060,cols=4,rows=5,width_mm=265,length_mm=212,
         nominal_mm=[265,235],kind='j',colour=[120,123,125]),
    dict(key='roof_s_tile_terracotta',tile_mm=1080,cols=4,rows=4,width_mm=270,length_mm=270,
         nominal_mm=[260,290],kind='s',colour=[152,84,58]),
    dict(key='roof_flat_tile_charcoal',tile_mm=1080,cols=4,rows=4,width_mm=270,length_mm=270,
         nominal_mm=[265,280],kind='flat',colour=[55,58,59]),
    dict(key='roof_colonial_gray',tile_mm=1000,cols=1,rows=6,width_mm=1000,length_mm=1000/6,
         nominal_mm=[910,182],kind='slate',colour=[72,76,77]),
    dict(key='roof_standing_seam_silver',tile_mm=909,cols=3,rows=1,width_mm=303,length_mm=None,
         nominal_mm=[303,None],kind='seam',colour=[160,164,163]),
    dict(key='roof_copper_patina',tile_mm=999,cols=3,rows=6,width_mm=333,length_mm=166.5,
         nominal_mm=[303,182],kind='copper',colour=[72,122,113]),
    dict(key='roof_asphalt_shingle_brown',tile_mm=1064,cols=3,rows=8,width_mm=1064/3,length_mm=133,
         nominal_mm=[333,143],kind='shingle',colour=[78,63,51]),
]


def noise(seed,low,high):
    """Periodic Fourier noise, independent from material geometry."""
    rng=np.random.default_rng(seed)
    base=rng.normal(size=(N-1,N-1))
    f=np.fft.rfft2(base)
    fy=np.fft.fftfreq(N-1)[:,None]*(N-1)
    fx=np.fft.rfftfreq(N-1)[None,:]*(N-1)
    radius=np.sqrt(fx*fx+fy*fy)
    mask=np.exp(-((radius/high)**4))*(1-np.exp(-((radius/max(low,.1))**4)))
    a=np.fft.irfft2(f*mask,s=base.shape)
    a/=max(a.std(),1e-9)
    a=np.clip(a,-2.7,2.7)/2.7
    return np.pad(a,((0,1),(0,1)),mode='wrap')


def streak_noise(seed):
    """雨の流れに沿った縦の筋。横方向は細かく、縦方向はゆっくり変わる周期的なむら。"""
    rng=np.random.default_rng(seed)
    base=rng.normal(size=(N-1,N-1))
    f=np.fft.rfft2(base)
    fy=np.fft.fftfreq(N-1)[:,None]*(N-1)
    fx=np.fft.rfftfreq(N-1)[None,:]*(N-1)
    mask=np.exp(-((fx/60)**2))*np.exp(-((fy/3)**2))*(fx>2)
    a=np.fft.irfft2(f*mask,s=base.shape)
    a/=max(a.std(),1e-9)
    a=np.clip(a,-2.5,2.5)/2.5
    return np.pad(a,((0,1),(0,1)),mode='wrap')


def shade_from_height(height,tile_mm,kind):
    """形の陰を色へ焼き込む(2026-10-10 作り直し)。屋根は遠目に見るので、法線マップだけでは
    瓦の山と谷が消えて平らな四角に見えた。谷の暗さ(高さ)と、上の段の唇が落とす影を色に入れる。"""
    core=height[:-1,:-1]
    step=(tile_mm/1000)/(N-1)
    du=(np.roll(core,-1,axis=1)-np.roll(core,1,axis=1))/(2*step)
    dv=(np.roll(core,-1,axis=0)-np.roll(core,1,axis=0))/(2*step)
    lo,hi=np.percentile(core,2),np.percentile(core,98)
    cavity=np.clip((core-lo)/max(hi-lo,1e-9),0,1)
    # 光は左上(棟の側・やや左)から。画像の行は下向き = 軒へ
    lit=np.clip(1+(-du*.45-dv*.55)*.9,.6,1.25)
    if kind=='copper':
        shade=(.94+.06*cavity)*np.clip(1+(-du*.45-dv*.55)*.6,.85,1.12)
    elif kind=='j':
        shade=(.62+.38*cavity)*lit
    else:
        shade=(.70+.30*cavity)*lit
    return np.pad(shade,((0,1),(0,1)),mode='wrap')


def smooth(a):return np.clip(a,0,1)**2*(3-2*np.clip(a,0,1))
def bell(dist,width):return np.exp(-(dist/width)**2)
def edge_distance(a):return np.minimum(a,1-a)


def generate(spec,i):
    kind=spec['kind'];cols=spec['cols'];rows=spec['rows']
    coarse=noise(31+i,1,9);fine=noise(731+i,40,260);grain=noise(431+i,200,510)
    row=np.floor(V*rows).astype(int)%rows
    py=(V*rows)%1
    stagger=kind in ('slate','copper','shingle')
    px=(U*cols+(row%2)*.5 if stagger else U*cols)%1
    col=np.floor(U*cols+(row%2)*.5 if stagger else U*cols).astype(int)%cols
    rng=np.random.default_rng(104+i)
    variations=rng.uniform(-1,1,size=(rows,cols))
    variation=variations[row,col]
    xedge=bell(edge_distance(px),.013)
    # Each course starts beneath the preceding upper course. Height falls
    # toward its top edge and rises toward the eaves-facing lower lip.
    overlap=py*.0025-bell(edge_distance(py),.015)*.0013
    joint=bell(edge_distance(py),.019)
    base=np.array(spec['colour'],float)
    colour=np.broadcast_to(base,(N,N,3)).copy()
    if kind in ('j','s'):
        # Asymmetric J profile and sinuous S profile; row lips stay horizontal.
        wave=(.5+.5*np.cos(2*np.pi*(px-.22))) if kind=='j' else (.5+.5*np.sin(2*np.pi*px))
        height=(.023 if kind=='j' else .030)*wave + overlap-xedge*.002
        # 2026-10-10 作り直し(Claude): 1枚ごとの色の差は弱く(洋瓦は4×4の繰り返しが市松に見えた)、
        # 焼きむらは1枚の中のなだらかなむらで出す。形の陰は下の shade_from_height で色に焼き込む
        colour+=variation[...,None]*(1.5 if kind=='j' else 3)
        colour+=coarse[...,None]*(3 if kind=='j' else 7)+fine[...,None]*2
        colour-=xedge[...,None]*6
        rough=.62+fine*.035+coarse*.03 if kind=='j' else .86+fine*.04
        height+=fine*.00008
    elif kind=='flat':
        height=overlap-xedge*.0017-bell(px-.80,.018)*.0007
        colour+=variation[...,None]*2.5+coarse[...,None]*2+fine[...,None]*2
        colour-=xedge[...,None]*9+joint[...,None]*7
        rough=.78+fine*.04
        height+=fine*.00005
    elif kind=='slate':
        # Three tabs with cuts in the lower half, inside each full board.
        tabs=(px*3)%1
        slit=bell(edge_distance(tabs),.018)*smooth((py-.43)/.07)
        height=overlap-xedge*.0015-slit*.0012+fine*.00016
        colour+=coarse[...,None]*4+fine[...,None]*4+variation[...,None]*3
        colour-=joint[...,None]*14+xedge[...,None]*12+slit[...,None]*17
        rough=.88+fine*.04
    elif kind=='seam':
        seam=bell(edge_distance(px),.023)
        foot=bell(edge_distance(px)-.033,.018)
        height=seam*.023+foot*.002+coarse*.00012
        # Subtle longitudinal rolling marks; keep the albedo neutral for tint.
        roll=np.cos(U*cols*2*np.pi*17)*.35
        colour+=coarse[...,None]*2+fine[...,None]*.6+roll[...,None]
        colour-=seam[...,None]*3
        rough=.39+coarse*.025+fine*.015
    elif kind=='copper':
        # 2026-10-10 作り直し(Claude): 大きな斑点(迷彩柄)をやめる。面のほとんどを均一に近い緑青にし、
        # 雨の流れに沿った縦の筋で濃淡を付ける。銅の地色は板の継ぎ目・はぜの縁に細く残すだけ
        streak=streak_noise(9001+i)
        patina=np.clip(.93+streak*.05+fine*.02-(joint*.55+xedge*.45),0,1)
        copper=np.array([118,74,48])
        green=np.array([94,142,128])
        colour=copper[None,None,:]*(1-patina[...,None])+green[None,None,:]*patina[...,None]
        colour+=streak[...,None]*7+fine[...,None]*2+grain[...,None]*1.5
        height=py*.0012+joint*.0025+xedge*.0018+fine*.00008
        rough=.55+patina*.28+fine*.03
    else:
        height=overlap-xedge*.0016+grain*.00028+fine*.00012
        colour+=grain[...,None]*14+fine[...,None]*5+coarse[...,None]*3+variation[...,None]*4
        # Granules include warm ochre and darker aggregate rather than flat noise.
        colour[:,:,0]+=grain*3
        colour-=joint[...,None]*16+xedge[...,None]*15
        rough=.93+grain*.035
    if kind in ('j','s','copper'):
        colour=colour*shade_from_height(height,spec['tile_mm'],kind)[...,None]
    if kind in ('j','s'):
        # 上の段の唇(下端)が、すぐ下の段の上端に落とす影と、唇の明るい縁。
        # これが無いと段の区切りが消えて、瓦ではなく波板に見える
        lip_shadow=bell(py,.085)
        lip_edge=bell(1-py,.025)
        colour=colour*(1-.38*lip_shadow)[...,None]*(1+.10*lip_edge)[...,None]
    # Periodic endpoint assignment (all tile-dependent properties agree there).
    for a in (height,rough,colour):
        a[-1,...]=a[0,...];a[:,-1,...]=a[:,0,...]
    core=height[:-1,:-1]
    step=(spec['tile_mm']/1000)/(N-1)
    du=(np.roll(core,-1,axis=1)-np.roll(core,1,axis=1))/(2*step)
    # Image rows run down; UV V runs up. -dh/dV = +dh/d(image rows).
    dy=(np.roll(core,-1,axis=0)-np.roll(core,1,axis=0))/(2*step)
    normal=np.stack([-du,dy,np.ones_like(du)],axis=-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    normal=np.pad(normal,((0,1),(0,1),(0,0)),mode='wrap')
    maps={'diffuse':np.clip(colour,0,255).astype(np.uint8),
          'normal':np.rint((normal*.5+.5)*255).astype(np.uint8),
          'roughness':np.repeat(np.rint(np.clip(rough,0,1)*255).astype(np.uint8)[...,None],3,axis=2)}
    report=dict(spec)
    report['adjustment_percent']=[None if n is None else 100*(a/n-1)
                                  for a,n in zip([spec['width_mm'],spec['length_mm']],spec['nominal_mm'])]
    assert all(a is None or abs(a)<=10 for a in report['adjustment_percent'])
    assert not stagger or rows%2==0,'Half-course stagger needs an even number of rows'
    report['maps']={}
    for name,array in maps.items():
        path=OUT/(spec['key']+'_'+name+'.jpg')
        Image.fromarray(array).save(path,quality=85,subsampling=0)
        decoded=np.asarray(Image.open(path)).astype(float)
        source_delta=max(np.max(abs(array[0].astype(int)-array[-1].astype(int))),
                         np.max(abs(array[:,0].astype(int)-array[:,-1].astype(int))))
        deltas=np.concatenate([abs(decoded[0]-decoded[-1]).ravel(),abs(decoded[:,0]-decoded[:,-1]).ravel()])
        report['maps'][name]=dict(path=str(path.relative_to(ROOT)),bytes=path.stat().st_size,
                                 source_edge_max=int(source_delta),jpeg_edge_mean=float(deltas.mean()),
                                 jpeg_edge_p99=float(np.percentile(deltas,99)),jpeg_edge_max=float(deltas.max()),
                                 colour_space='sRGB' if name=='diffuse' else 'linear',quality=85)
        assert source_delta==0
        assert float(np.percentile(deltas,99))<=24,(spec['key'],name,'JPEG edge artifacts')
    diffuse=Image.open(OUT/(spec['key']+'_diffuse.jpg'))
    tile=Image.new('RGB',(N*2,N*2))
    for x in range(2):
        for y in range(2):tile.paste(diffuse,(x*N,y*N))
    tile.save(HERE/'tiling'/(spec['key']+'.jpg'),quality=90,subsampling=0)
    return report


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    (HERE/'tiling').mkdir(parents=True,exist_ok=True)
    reports=[generate(s,i) for i,s in enumerate(SPECS)]
    (HERE/'validation.json').write_text(json.dumps(dict(generator='original deterministic periodic height fields',
        resolution=[N,N],normal_convention='OpenGL +Y tangent / image top is +V',
        source_seams='identical opposing edges',visual_review='pending',textures=reports),indent=2)+'\n')
    print(json.dumps([dict(key=r['key'],tile_mm=r['tile_mm'],adjustment_percent=r['adjustment_percent']) for r in reports],indent=2))
