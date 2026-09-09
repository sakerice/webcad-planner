"""Original daytime window treatments. Front +Z / up +Y in exported GLB.
Run with Blender --background --factory-startup --python this_file.
"""
import sys
import math
import json
import struct
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
import window_treatment_build as wt

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'assets/models/original'
SOURCE = ROOT/'tools/blender/work/original'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)


def curtain(width, height):
    cloth = wt.make_material('fabric_Linen', (.76, .72, .64, 1), .94)
    metal = wt.make_material('accent_BronzeRail', (.10, .085, .07, 1), .38, .55)
    bm = bmesh.new()
    stack = .25 if width < 1 else .30
    # +Y in Blender will be flipped below to satisfy GLB +Z front.
    def surface(u, v):
        x = width/2-stack + stack*u
        y = .055 + .045*math.sin(u*math.pi*16)
        z = .012 + v*(height-.065) + .004*math.sin(u*math.pi*6)*(1-v)
        return Vector((x,y,z))
    wt._grid_surface(bm, 96, 18, surface)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=.0015)
    wt.add_box(bm, 0, .012, height-.013, width, .025, .026, 1)
    for i in range(9):
        wt.add_box(bm, width/2-stack+stack*i/8, .015, height-.040, .010,.012,.030,1)
    ob=wt.new_object('OpenLinenCurtain',bm,[cloth,metal])
    wt.smooth_shade(ob,math.radians(55))
    return ob


def laundry_rail():
    steel=wt.make_material('accent_SatinSteel',(.42,.44,.44,1),.30,.8)
    bm=bmesh.new()
    wt.add_cylinder_x(bm,0,0,.012,.012,1.1,24)
    for x in (-.44,.44):
        wt.add_box(bm,x,0,.25,.012,.012,.48)
        wt.add_box(bm,x,0,.492,.065,.08,.016)
    ob=wt.new_object('CeilingLaundryRail',bm,[steel])
    wt.smooth_shade(ob,math.radians(45))
    return ob

def laundry_cabinet():
    wood=wt.make_material('wood_Oak',(.47,.36,.25,1),.62)
    top=wt.make_material('body_WarmStone',(.72,.70,.65,1),.46)
    metal=wt.make_material('accent_Bronze',(.10,.085,.07,1),.40,.5)
    bm=bmesh.new()
    wt.add_box(bm,0,0,.455,.9,.48,.85,0)
    wt.add_box(bm,0,0,.885,.9,.5,.03,1)
    wt.add_box(bm,0,0,.025,.82,.40,.05,2)
    for x in (-.224,.224):
        wt.add_box(bm,x,.248,.46,.444,.004,.80,0)
        wt.add_box(bm,x/8,.25,.67,.10,.004,.008,2)
    ob=wt.new_object('LaundryFoldingCabinet',bm,[wood,top,metal])
    wt.smooth_shade(ob,math.radians(40))
    return ob

specs=[]
for width in (.9,1.3):
    for height,label in ((1.35,'short'),(2.04,'long')):
        specs.append((f'original-curtain-open-{int(width*1000)}-{label}',width,.15,height,'curtain'))
for width in (.78,1.235,1.69):
    specs.append((f'original-roller-open-{int(width*1000)}',width,.05,.25,'roller'))
specs.append(('original-laundry-rail',1.1,.08,.5,'rail'))
specs.append(('original-laundry-cabinet',.9,.5,.9,'cabinet'))
manifest_path=ROOT/'assets/models/custom/manifest.json'
manifest=json.loads(manifest_path.read_text())
new=[]
for ident,w,d,h,kind in specs:
    wt.clear_scene()
    ob=curtain(w,h) if kind=='curtain' else laundry_rail() if kind=='rail' else laundry_cabinet() if kind=='cabinet' else wt.build_roller_screen(w,ident,h)
    # Rotate geometry about vertical: Blender -Y becomes glTF +Z.
    for v in ob.data.vertices:
        v.co.x=-v.co.x
        v.co.y=-v.co.y
    wt.normalize_to(ob,w,d,h)
    for material in ob.data.materials:
        channel = material.name.split('_')[0]
        if kind == 'roller':
            channel = 'fabric' if material.name.startswith('ScreenCloth') else 'accent'
        material['finishChannel'] = channel
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f'{ident}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{ident}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
    path=OUT/f'{ident}.glb'
    data=path.read_bytes()
    length=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+length])
    doc['asset']['extras']={'provenance':'Independently authored in Blender; no imported geometry or imagery','front':'+Z','up':'+Y','source':'tools/blender/build_open_window_treatments.py'}
    raw=json.dumps(doc,separators=(',',':')).encode()
    raw+=b' '*((-len(raw))%4)
    rest=data[20+length:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
    new.append({'id':ident,'name':('リネンカーテン 開き' if kind=='curtain' else '天井吊り物干し' if kind=='rail' else 'ランドリー作業収納' if kind=='cabinet' else 'ロールスクリーン 巻上げ')+f' {int(w*1000)}',
        'group':'家具','category':('収納' if kind in ('rail','cabinet') else 'カーテン'),'w':round(w*1000),'d':round(d*1000),'h':round(h*1000),
        'model':f'assets/models/original/{ident}.glb','thumb':f'assets/models/previews-v2/{ident}-thumb.png',
        'top':f'assets/models/previews-v2/{ident}-top.png','previewVersion':2,'provenance':'original',
        'sourceBlend':f'tools/blender/work/original/{ident}.blend','frontAxis':'+Z',
        'finishChannels':[{'key':'fabric','label':'生地','default':'#c6bead'},{'key':'accent','label':'レール','default':'#50473e'}]})
    if kind == 'cabinet':
        new[-1]['finishChannels']=[{'key':'wood','label':'木部','default':'#a08568'}, {'key':'body','label':'天板','default':'#d8d2c6'}, {'key':'accent','label':'金物','default':'#50473e'}]
    elif kind == 'rail':
        new[-1]['finishChannels']=[{'key':'accent','label':'金物','default':'#b0b5b5'}]
ids={i['id'] for i in new}
manifest['items']=[i for i in manifest['items'] if i['id'] not in ids]+new
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Created',len(new),'original open window treatments')
