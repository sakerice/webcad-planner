"""Original modular kitchen; standard-sized equipment never stretched to fit a plan.
Run with Blender --background --python tools/blender/build_kitchen_system.py.
Authoring front -Y becomes glTF +Z. Dimensions in meters.
"""
import sys, math, json, struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import bpy
from build_island_kitchen import mat, box, pipe, ROOT, OUT, SRC

PLANS=[
 ('i2100','I型キッチン 2100', [('sink',.9),('drawer',.45),('hob',.75)],.65),
 ('i2400','I型キッチン 2400', [('sink',.9),('drawer',.75),('hob',.75)],.65),
 ('i2550','I型キッチン 2550・食洗機', [('sink',.9),('dishwasher',.45),('drawer',.45),('hob',.75)],.65),
 ('i2700','I型キッチン 2700・食洗機', [('sink',.9),('dishwasher',.45),('drawer',.6),('hob',.75)],.65),
 ('gas2550','I型ガスキッチン 2550・食洗機', [('sink',.9),('dishwasher',.45),('drawer',.45),('gas',.75)],.65),
 ('p2550-750','対面キッチン 2550・奥行750', [('sink',.9),('dishwasher',.45),('drawer',.45),('hob',.75)],.75),
 ('p2550-970','対面キッチン 2550・奥行970', [('sink',.9),('dishwasher',.45),('drawer',.45),('hob',.75)],.97),
 ('box-sink900','シンクBOX 900', [('sink',.9)],.65),
 ('box-hob750','IHコンロBOX 750', [('hob',.75)],.65),
 *[(f'box-drawer{w}',f'引出しBOX {w}', [('drawer',w/1000)],.65) for w in (450,600,750,900)],
 ('box-dishwasher450','食洗機BOX 450', [('dishwasher',.45)],.65),
]

def ring(name,x,y,z,r,material):
 pipe(name,[(x+r*math.cos(i*math.tau/48),y+r*math.sin(i*math.tau/48),z) for i in range(49)],.0012,material)

# 色替えの口は「実際にその素材が入っているか」で決める。3つを決め打ちで書くと、
# シンクもコンロも食洗機も無い引出しBOXに「金物」の色見本が出るのに、押しても
# 何も変わらない(Blender は使われていないマテリアルを glTF に書き出さない)。
# 検査 tools/tests/original-models.test.cjs が、宣言した口がモデルに在ることを見る。
FINISH_CHANNELS=[('wood','扉・側板','#B59F86'),('stone','天板','#E4E1DA'),('metal','金物','#A6ADB0')]
def finish_channels(obj):
 used={m['finishChannel'] for m in obj.data.materials if m is not None and 'finishChannel' in m}
 return [dict(key=k,label=l,default=c) for k,l,c in FINISH_CHANNELS if k in used]

def build(key,name,modules,depth):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 ident='original-kitchen-'+key;w=sum(a[1] for a in modules);front=-depth/2
 wood=mat('wood_SatinOak',(.46,.35,.24),.52)
 stone=mat('stone_WarmQuartz',(.78,.76,.70),.36)
 steel=mat('metal_SatinSteel',(.38,.41,.43),.27,.85)
 dark=mat('accent_Shadow',(.018,.022,.025),.6)
 glass=mat('glass_Ceramic',(.008,.012,.016),.14,.12)
 # Only exposed finish channels are recolourable; burner and glass remain functional materials.
 for m in (dark,glass): del m['finishChannel']
 box('Recessed continuous plinth',(0,front+.34,.0525),(w-.06,.53,.105),dark)
 for x in (-w/2+.009,w/2-.009): box('Finished end panel',(x,0,.466),(.018,depth-.02,.722),wood)
 box('Back finished panel',(0,depth/2-.014,.463),(w-.036,.018,.716),wood)
 top=box('Continuous quartz worktop',(0,0,.835),(w,depth,.030),stone,.0015)
 cursor=-w/2
 for kind,bw in modules:
  x=cursor+bw/2;cursor+=bw
  for edge in (x-bw/2+.019,x+bw/2-.019):box('Cabinet divider',(edge,front+.327,.47),(.018,.59,.70),wood)
  box('Cabinet base',(x,front+.325,.124),(bw-.042,.59,.024),wood)
  levels=[(.314,.378),(.619,.222),(.779,.082)] if kind=='drawer' else [(.302,.35),(.663,.354)]
  if kind in ('hob','gas'):levels=[(.302,.35),(.568,.16)]
  if kind=='dishwasher':levels=[(.204,.158),(.551,.49)]
  for z,h in levels:
   box(kind+' drawer front',(x,front+.018,z),(bw-.006,.022,h),wood,.002)
   box('Handle grip rail',(x,front+.032,z+h/2+.004),(bw-.026,.024,.013),dark,.001)
  if kind in ('hob','gas'):
   box('Grill recessed surround',(x,front+.026,.735),(bw-.01,.018,.173),dark,.001)
   side=(bw-.59)/2
   for sign in (-1,1):box('Grill flanking panel',(x+sign*(bw/2-side/2-.003),front+.018,.735),(side-.006,.022,.17),wood,.002)
  if kind=='dishwasher':
   box('Dishwasher control strip',(x,front+.022,.801),(bw-.008,.027,.040),steel,.002)
   box('Dishwasher inset display',(x+.065,front+.002,.801),(.085,.002,.018),glass,.001)
   for dx in (-.14,-.09):box('Dishwasher button',(x+dx,front+.003,.801),(.014,.003,.010),dark,.001)
  if kind=='sink':
   sx=x;sy=front+.285;sw=.68;sd=.40
   # Rounded single-piece countertop with a real through-opening.
   cutter=box('Temporary basin opening',(sx,sy,.84),(sw,sd,.14),steel,.035)
   bpy.context.view_layer.objects.active=top;b=top.modifiers.new('Undermount opening','BOOLEAN');b.operation='DIFFERENCE';b.object=cutter;bpy.ops.object.modifier_apply(modifier=b.name);bpy.data.objects.remove(cutter,do_unlink=True)
   # Watertight basin shell with rounded corners and an open top, no solid metal slab.
   outer=box('Rounded stainless basin',(sx,sy,.751),(sw+.016,sd+.016,.178),steel,.040)
   cut=box('Temporary basin inner',(sx,sy,.785),(sw,sd,.226),steel,.035)
   bpy.context.view_layer.objects.active=outer;b=outer.modifiers.new('Hollow bowl','BOOLEAN');b.operation='DIFFERENCE';b.object=cut;bpy.ops.object.modifier_apply(modifier=b.name);bpy.data.objects.remove(cut,do_unlink=True)
   ring('Drain rim',sx+.19,sy+.06,.673,.035,steel)
   box('Drain strainer',(sx+.19,sy+.06,.672),(.048,.048,.002),dark,.01)
   for dx in (-.012,0,.012):box('Strainer slots',(sx+.19+dx,sy+.06,.674),(.003,.035,.001),steel,.0004)
   fy=front+.55
   pts=[(sx,fy,.85),(sx,fy,1.06)]+[(sx,fy-.09+.09*math.cos(i*math.pi/24),1.06+.09*math.sin(i*math.pi/24)) for i in range(25)]+[(sx,fy-.18,1.035)]
   pipe('Curved mixer faucet',pts,.013,steel)
   box('Mixer escutcheon',(sx,fy,.856),(.055,.055,.012),steel,.012)
   box('Mixer lever',(sx+.045,fy,.948),(.08,.012,.012),steel)
   ring('Aerator',sx,fy-.18,1.035,.010,dark)
  if kind in ('hob','gas'):
   hy=front+.325
   box('Appliance steel rim',(x,hy,.853),(.604,.504,.008),steel,.012)
   box('Black cooking plate',(x,hy,.858),(.596,.496,.006),glass,.011)
   for dx,dy,r in ((-.145,-.08,.094),(.15,-.075,.077),(0,.135,.060)):
    if kind=='hob':ring('Induction cooking zone',x+dx,hy+dy,.862,r,steel)
    else:
     bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r*.70,depth=.018,location=(x+dx,hy+dy,.875));bpy.context.object.data.materials.append(dark)
     ring('Gas burner rim',x+dx,hy+dy,.879,r*.62,steel)
     for a in range(4):
      t=a*math.pi/2;pipe('Cast pan support',[(x+dx+math.cos(t)*r*.45,hy+dy+math.sin(t)*r*.45,.906),(x+dx+math.cos(t)*r,hy+dy+math.sin(t)*r,.906),(x+dx+math.cos(t)*r,hy+dy+math.sin(t)*r,.866)],.004,dark)
   for dx in (-.08,-.025,.03,.085):box('Cooktop touch marking',(x+dx,hy-.21,.863),(.015,.007,.001),steel,.0004)
   # Integrated grill front, vent slots, and controls under the hob.
   box('Grill fascia',(x,front+.024,.733),(.57,.022,.13),steel)
   box('Grill viewing glass',(x-.035,front+.002,.733),(.35,.002,.076),glass)
   box('Grill pull',(x-.035,front+.004,.759),(.33,.007,.013),steel)
   for dx in (.205,.245):box('Grill controls',(x+dx,front+.005,.745),(.027,.009,.023),dark)
 # Preserve assembled design and dimensions, bake bevels and merge by material on export.
 bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=next(o for o in bpy.context.scene.objects if o.type=='MESH');bpy.ops.object.join();o=bpy.context.object;o.name=ident
 bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
 bpy.ops.wm.save_as_mainfile(filepath=str(SRC/f'{ident}.blend'))
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{ident}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True)
 p=OUT/f'{ident}.glb';b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);j['asset']['extras']={'front':'+Z','up':'+Y','provenance':'Independently authored Blender geometry','source':'tools/blender/build_kitchen_system.py'};raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=b[20+n:];p.write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
 height=max(v.co.z for v in o.data.vertices) # origin moved to world zero
 return dict(id=ident,name=name,group='住設',category='キッチン',w=round(w*1000),d=round(depth*1000),h=round(height*1000,2),model=f'assets/models/original/{ident}.glb',thumb=f'assets/models/previews-v2/{ident}-thumb.png',top=f'assets/models/previews-v2/{ident}-top.png',previewVersion=2,provenance='original',sourceBlend=f'tools/blender/work/original/{ident}.blend',frontAxis='+Z',kitchenModules=[dict(kind=k,width=round(v*1000)) for k,v in modules],worktopHeight=850,kitchenFamily=('wall-ih' if key.startswith('i') else 'peninsula' if key.startswith('p') else 'drawer' if key.startswith('box-drawer') else ''),finishChannels=finish_channels(o))

if __name__=='__main__':
 pairs={}
 for key,name,modules,depth in list(PLANS):
  if key.startswith('box-'):continue
  has=any(k=='dishwasher' for k,w in modules)
  alternate=[];replaced=False
  for kind,width in modules:
   if has and kind=='dishwasher':alternate.append(('drawer',width))
   elif not has and kind=='drawer' and width>=.45 and not replaced:
    alternate.append(('dishwasher',.45));replaced=True
    if width>.4501:alternate.append(('drawer',round(width-.45,3)))
   else:alternate.append((kind,width))
  other=key+('-no-dw' if has else '-dw')
  PLANS.append((other,name.replace('・食洗機','')+('・食洗機なし' if has else '・食洗機'),alternate,depth))
  pairs['original-kitchen-'+key]='original-kitchen-'+other
  pairs['original-kitchen-'+other]='original-kitchen-'+key
 pairs['original-kitchen-box-drawer450']='original-kitchen-box-dishwasher450'
 pairs['original-kitchen-box-dishwasher450']='original-kitchen-box-drawer450'
 new=[build(*plan) for plan in PLANS]
 for item in new:
  if item['id'] in pairs:
   item['kitchenDishwasherVariant']=pairs[item['id']]
   item['kitchenDishwasher']=any(m['kind']=='dishwasher' for m in item['kitchenModules'])
 p=ROOT/'assets/models/custom/manifest.json';m=json.loads(p.read_text());ids={i['id'] for i in new};m['items']=[i for i in m['items'] if i['id'] not in ids]+new;p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');p.with_suffix('.js').write_text('window.CUSTOM_MODEL_MANIFEST = '+json.dumps(m,ensure_ascii=False,indent=2)+';\n')
 (ROOT/'assets/models/original/kitchen-system-collection.json').write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n')
