"""Independent RPG study pack. Never registers models in the editor.

blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/build.py
Uses the repository's model_kit.run checks, UVs, exports and thumbnail renderer.
"""
import sys, json, math, struct, hashlib
from pathlib import Path
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
import model_kit as kit
from model_kit import bpy
from build_decor import lathe, loop, mesh_part

PACK = ROOT / 'assets/models/packs/rpg-mansion'
kit.GLB_DIR = PACK / 'models'
kit.PREVIEW_DIR = PACK / 'previews'
kit.WORK_DIR = HERE / 'work'

def palette():
    def m(name, color, channel, rough=.55, metal=0):
        mat = kit.matp('RPG '+name, color, rough, metal)
        if channel: mat['finishChannel'] = channel
        return mat
    return dict(wood=m('Walnut','#493025','wood'), trim=m('Walnut edge','#704b32','wood'),
                brass=m('Antique brass','#b29455','metal',.32,.72),
                cloth=m('Oxblood velvet','#672e37','fabric',.88),
                teal=m('Teal leather','#25494b','fabric',.7),
                paper=m('Parchment','#ddc9a1',None,.94), ink=m('Ink','#292c32',None),
                wax=m('Wax','#f0dfb9',None,.65), seal=m('Seal','#853c40',None),
                glass=m('Stylized pale glass','#8eaaa8',None,.22,.2))

P = {}
def block(name, pos, size, mat, bevel=.002):
    return kit.box(name, [a-b/2 for a,b in zip(pos,size)], [a+b/2 for a,b in zip(pos,size)], P[mat], min(bevel,min(size)/4), 1)

def leg(x,y,height):
    lathe('Turned walnut leg',[(.023,0),(.027,.025),(.020,.06),(.016,height*.52),(.030,height*.69),(.022,height*.82),(.025,height)],P['wood'],x,y,12)

def chair():
    for x in [-.21,.21]:
        for y in [-.21,.21]: leg(x,y,.44)
    block('Seat carved frame',(0,0,.44),(.52,.52,.06),'wood',.01)
    block('Velvet seat',(0,-.015,.486),(.46,.46,.055),'cloth',.015)
    for x in [-.225,.225]:
        block('Back stile',(x,.217,.76),(.043,.055,.55),'wood',.006)
        lathe('Brass finial',[(.014,1.01),(.024,1.025),(.008,1.05)],P['brass'],x,.217,12)
    block('Back upholstered panel',(0,.23,.80),(.40,.04,.31),'cloth',.018)
    block('Crest rail',(0,.23,.99),(.48,.065,.06),'trim',.012)
    for x in [-.165,0,.165]:
        kit.cylinder('Front brass button',(x,.203,.83),.009,.007,P['brass'],'Y',12)

def desk():
    for x in [-.62,.62]:
        for y in [-.29,.29]: leg(x,y,.73)
    block('Moulded desktop',(0,0,.756),(1.40,.74,.048),'trim',.008)
    block('Leather writing inset',(0,-.015,.782),(1.15,.54,.004),'teal',.01)
    block('Drawer apron',(0,0,.661),(1.27,.62,.14),'wood',.004)
    for x in [-.425,0,.425]:
        block('Inset drawer front',(x,-.319,.66),(.404,.025,.115),'trim',.003)
        kit.cylinder('Drawer brass pull',(x,-.34,.66),.017,.025,P['brass'],'Y',12)

def bookcase():
    block('Plinth',(0,0,.055),(1.1,.38,.11),'trim',.004)
    block('Top cornice',(0,0,1.955),(1.1,.38,.09),'trim',.004)
    for x in [-.508,.508]: block('Side pilaster',(x,0,1.03),(.06,.34,1.85),'wood')
    block('Solid back',(0,.16,1.01),(1.0,.024,1.85),'wood')
    for z in [.16,.60,1.04,1.48,1.89]: block('Shelf',(0,-.005,z),(1,.33,.03),'trim')
    for row in range(4):
        for col in range(7):
            x=-.426+col*.135; z=.177+row*.44; h=.26+(col%3)*.025
            mat=['cloth','teal','wood'][col%3]
            block('Book binding',(x,.015,z+h/2),(.086,.245,h),mat,.002)
            block('Book pages',(x,.006,z+h/2),(.079,.222,h-.025),'paper',.001)
            for dz in [.035,h-.035]: block('Spine gold band',(x,-.112,z+dz),(.086,.004,.005),'brass',0)

def candle():
    lathe('Turned candlestick',[(.08,0),(.09,.012),(.08,.03),(.038,.045),(.024,.08),(.018,.21),(.036,.225),(.057,.239),(.057,.25),(.028,.255)],P['brass'],sides=20)
    lathe('Ivory candle',[(.021,.25),(.023,.26),(.023,.395),(.019,.40)],P['wax'],sides=16)
    block('Unlit wick',(0,0,.406),(.0036,.0036,.012),'ink',0)

def frame():
    block('Frame backing',(0,0,.45),(.66,.052,.90),'wood')
    block('Original abstract print',(0,-.03,.45),(.535,.01,.775),'teal')
    for x in [-.305,.305]: block('Gilded stile',(x,-.035,.45),(.05,.036,.90),'brass',.004)
    for z in [.025,.875]: block('Gilded rail',(0,-.035,z),(.56,.036,.05),'brass',.004)
    # Entirely original geometric moon and landscape, not an external artwork.
    kit.cylinder('Moon',( .12,-.043,.66),.064,.006,P['paper'],'Y',24)
    block('Landscape horizon',(0,-.041,.3),(.52,.006,.035),'trim',0)
    for i,(x,z,h) in enumerate([(-.13,.37,.22),(-.02,.33,.14),(.11,.35,.18)]):
        y=-.048-i*.003
        mesh_part('Abstract hill',[(x-.10,y,z-h/2),(x+.10,y,z-h/2),(x,y,z+h/2),(x-.10,y+.002,z-h/2),(x+.10,y+.002,z-h/2),(x,y+.002,z+h/2)],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],P['wood'])

def chest():
    block('Chest body',(0,0,.25),(.8,.45,.48),'wood',.006)
    block('Raised lid',(0,0,.50),(.82,.47,.06),'trim',.008)
    for x in [-.27,.27]:
        block('Lid brass strap',(x,0,.532),(.032,.465,.006),'brass',.001)
        block('Front brass strap',(x,-.229,.25),(.032,.007,.46),'brass',.001)
    block('Front lock plate',(0,-.239,.40),(.07,.012,.09),'brass')
    kit.cylinder('Keyhole',(0,-.247,.40),.008,.004,P['ink'],'Y',12)
    for x in [-.33,.33]:
        for y in [-.16,.16]:block('Chest foot',(x,y,.025),(.09,.09,.05),'wood')

def rug():
    block('Woven rug',(0,0,.004),(1.4,2,.008),'cloth',.003)
    for x in [-.64,.64]:block('Ivory border',(x,0,.0085),(.025,1.9,.001),'paper',0)
    for y in [-.94,.94]:block('Ivory end border',(0,y,.0085),(1.30,.025,.001),'paper',0)
    for x,y,s in [(0,0,.36),(0,-.55,.16),(0,.55,.16)]:
        o=block('Diamond medallion',(x,y,.009),(s,s,.001),'brass',0)
        # Vertices are in world coordinates; rotate about medallion centre.
        for v in o.data.vertices:
            q=v.co-Vector((x,y,0));q=Matrix.Rotation(math.pi/4,4,'Z')@q;v.co=q+Vector((x,y,0))

def side_table():
    lathe('Pedestal base',[(.27,0),(.28,.025),(.20,.055),(.05,.09),(.035,.46),(.07,.54),(.24,.57)],P['wood'],sides=20)
    lathe('Round top',[(.31,.57),(.32,.585),(.32,.62),(.30,.635)],P['trim'],sides=32)
    loop('Brass top inlay',(0,0,.636),.24,.24,.001,P['brass'],steps=32)

def clock():
    block('Clock plinth',(0,0,.035),(.36,.18,.07),'trim',.005)
    block('Clock case',(0,0,.245),(.29,.13,.37),'wood',.025)
    kit.cylinder('Dial rim',(0,-.075,.28),.119,.035,P['brass'],'Y',32)
    kit.cylinder('Ivory dial',(0,-.095,.28),.106,.008,P['paper'],'Y',32)
    for i in range(12):
        a=math.tau*i/12
        block('Hour marker',(.09*math.sin(a),-.101,.28+.09*math.cos(a)),(.009,.003,.012),'ink',0)
    block('Minute hand',(0,-.105,.315),(.005,.004,.075),'ink',0)
    block('Hour hand',(.023,-.108,.28),(.05,.004,.006),'ink',0)
    kit.cylinder('Clock pin',(0,-.113,.28),.008,.005,P['brass'],'Y',12)

def letter():
    block('Envelope',(0,0,.002),(.22,.145,.004),'paper',.001)
    # Closed triangular flap is slightly raised, avoiding coplanar faces.
    mesh_part('Envelope flap',[(-.107,.069,.005),(.107,.069,.005),(0,-.015,.005),(-.107,.069,.006),(.107,.069,.006),(0,-.015,.006)],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],P['wax'])
    kit.cylinder('Wax seal',(0,-.012,.008),.019,.006,P['seal'],sides=20)
    block('Seal impression',(0,-.012,.0115),(.013,.003,.001),'brass',0)

def key():
    loop('Key bow',(0,.037,.004),.024,.026,.004,P['brass'],steps=20)
    block('Key shaft',(0,-.022,.004),(.008,.091,.008),'brass',.001)
    block('Key bit',(.009,-.056,.004),(.023,.014,.008),'brass',.001)
    block('Key bit tooth',(.016,-.041,.004),(.009,.014,.008),'brass',.001)

def fallen():
    chair()
    for obj in [o for o in bpy.context.scene.objects if o.type=='MESH']:
        for v in obj.data.vertices:v.co=Matrix.Rotation(math.pi/2,4,'X')@v.co

def glass():
    # Opaque, bevelled pale shards: readable and non-photorealistic.
    for x,y,r,a in [(-.18,0,.13,.2),(.08,.08,.11,1.1),(.20,-.09,.09,.4),(-.04,-.16,.08,2.2),(.06,.22,.065,.8)]:
        points=[(x+r*math.cos(a+k*math.tau/3),y+r*math.sin(a+k*math.tau/3),z) for z in [0,.004] for k in range(3)]
        mesh_part('Stylized glass shard',points,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],P['glass'])

def stain():
    # Thin closed geometry, not a shader projector: portable reference decal.
    for x,y,rx,ry in [(0,0,.22,.13),(.30,-.10,.027,.036),(-.29,-.12,.022,.02)]:
        rings=[[(x+rx*(1+.09*math.sin(k*2.3))*math.cos(math.tau*k/24),y+ry*(1+.09*math.sin(k*2.3))*math.sin(math.tau*k/24),z) for k in range(24)] for z in [0,.001]]
        kit.shell('Stylized burgundy clue',rings,[P['seal']],[0])

SPECS = [
 ('chair','洋館の椅子',(520,550,1050),chair,'椅子',0),
 ('desk','革張りの書斎机',(1400,740,786),desk,'机',0),
 ('bookcase','書物入りの本棚',(1100,380,2000),bookcase,'収納',0),
 ('candlestick','真鍮の燭台',(180,180,412),candle,'小物',750),
 ('frame','月景の額',(660,75,900),frame,'壁装飾',900),
 ('chest','鍵付き木箱',(820,490,535),chest,'収納',0),
 ('rug','深紅の敷物',(1400,2000,10),rug,'敷物',0),
 ('side-table','丸い飾り台',(640,640,637),side_table,'机',0),
 ('mantel-clock','置き時計',(360,205,430),clock,'小物',750),
 ('letter','封蝋付きの手紙',(220,145,12),letter,'探索小物',750),
 ('key','古い真鍮の鍵',(56,130,8),key,'探索小物',750),
 ('fallen-chair','倒れた洋館の椅子',(520,1050,550),fallen,'事件跡',0),
 ('glass-shards','割れたガラスの跡',(570,500,4),glass,'事件跡',1),
 ('clue-stain','非写実的な血痕・手掛かり',(590,330,1),stain,'事件跡',1),
]

def build_one(fn,size):
    global P
    P=palette();fn()
    obj=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH'])
    # Author nominal bounds explicitly, centre at the floor. All transforms baked.
    pts=[v.co.copy() for v in obj.data.vertices]
    lo=[min(p[i] for p in pts) for i in range(3)];hi=[max(p[i] for p in pts) for i in range(3)]
    for v in obj.data.vertices:
        for i in range(3):v.co[i]=(v.co[i]-lo[i])/(hi[i]-lo[i])*size[i]/1000-(size[i]/2000 if i<2 else 0)
    obj.data.update()
    return obj

def main():
    sys.path.insert(0,str(HERE))
    from render_config import configure
    configure()
    items=[]
    selected=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
    existing=PACK/'manifest.json'
    if not selected and existing.exists() and len(json.loads(existing.read_text()).get('items',[]))>len(SPECS):
        raise RuntimeError('Expanded catalogue exists. Use --only for legacy assets; expansion/build.py preserves all existing entries.')
    for slug,name,size,fn,category,elevation in SPECS:
        if selected and slug not in selected: continue
        stem='rpg-mansion-'+slug+'-01'
        # Infer required channels from the authored material slots, then let run
        # independently check geometry, UV density, origins, budgets and export.
        kit.clear_scene();preview=build_one(fn,size)
        channels={m.get('finishChannel') for m in preview.data.materials if m.get('finishChannel')}
        obj=kit.run([(stem,size,lambda fn=fn,size=size:build_one(fn,size),channels,6000)])[0]
        from png_metadata import strip_metadata
        for image in [kit.PREVIEW_DIR/(stem+'-thumb.png'),kit.PREVIEW_DIR/(stem+'-top.png'),kit.WORK_DIR/(stem+'-rear.png')]:strip_metadata(image)
        path=kit.GLB_DIR/(stem+'.glb')
        if path.exists():
            b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n])
            j['asset']['extras']={'front':'+Z','up':'+Y','units':'metres','origin':'bottom-centre','packId':'rpg-mansion','provenance':'Original procedural Blender geometry; no imported geometry or imagery','source':'tools/blender/rpg_mansion/build.py'}
            raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=b[20+n:]
            path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
        rel=lambda p:str(p.relative_to(ROOT))
        items.append(dict(id=stem,name=name,packId='rpg-mansion',group='家具',category=category,
            sourceFolder='BlenderRpgMansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),
            top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),rear=rel(kit.WORK_DIR/(stem+'-rear.png')),
            sourceBlend=rel(kit.WORK_DIR/(stem+'.blend')),validation=rel(kit.WORK_DIR/(stem+'-validation.json')),
            w=size[0],d=size[1],h=size[2],defaultElevation=elevation,provenance='original',
            builder='tools/blender/rpg_mansion/build.py',finishChannels=[channel_descriptor(obj,k) for k in sorted(channels)],
            placementHint='wall' if slug=='frame' else 'surface' if elevation==750 else 'floor',
            previewVersion=1))
    manifest=dict(schemaVersion=1,id='rpg-mansion',name='RPGアセット',version='0.1.0',
        status='standalone-review-not-integrated',namespace='rpg-mansion-',units={'manifest':'millimetres','model':'metres'},
        axes={'front':'+Z','up':'+Y','origin':'bottom-centre'},baseCommit='6c5fe1819ba388bcfac8055cc94744bd7831d734',
        recoveryC072='not-restored',provenance={'method':'Original procedural Blender modelling','externalAssets':[],
        'sharedHelpers':['tools/blender/model_kit.py','tools/blender/build_decor.py','tools/blender/shape_kit.py','tools/blender/exterior_build.py']},items=items)
    PACK.mkdir(parents=True,exist_ok=True)
    if not selected:(PACK/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

def channel_descriptor(obj,key):
    mat=next(m for m in obj.data.materials if m.get('finishChannel')==key)
    rgb=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value[:3]
    color='#'+''.join(f'{round((12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055)*255):02x}' for x in rgb)
    return {'key':key,'label':{'wood':'木部','metal':'金属','fabric':'布・革'}[key],'default':color}

if __name__=='__main__':main()
