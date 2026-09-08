"""Original Japanese entry storage. No manufacturer geometry is imported."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from original_geometry import *
items=[]
for kind,name,w in [('tall','下駄箱・トール',.8),('counter','下駄箱・カウンター付き',1.6),('bridge','下駄箱・コの字',1.8)]:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 d=.38;h=2.0
 wood=material('Oak cabinetry',(.38,.25,.135),.58);wood['finishChannel']='body'
 metal=material('Satin nickel hardware',(.34,.37,.39),.28,.8);metal['lockColor']=True
 dark=material('Shadow gaps',(.035,.032,.028),.88);dark['lockColor']=True
 def cabinet(x,width,z,height,doors=2):
  box('Recessed plinth',(x,.012,z+.04),(width-.06,d-.05,.08),dark,.003)
  box('Cabinet carcass',(x,.012,z+height/2),(width,d-.035,height-.008),wood,.002)
  for j in range(doors):
   xx=x-width/2+width*(j+.5)/doors
   box('Door shadow reveal',(xx,-d/2+.012,z+height/2+.032),(width/doors-.002,.008,height-.068),dark,.001)
   box('Individual oak door',(xx,-d/2+.001,z+height/2+.032),(width/doors-.005,.019,height-.075),wood,.0015)
   hx=xx+(1 if j%2==0 else -1)*(width/doors/2-.045)
   zz=z+min(height*.6,1.05)
   for dz in [-.064,.064]:box('Handle mounting foot',(hx,-d/2-.014,zz+dz),(.008,.019,.008),metal,.002)
   box('Slim pull handle',(hx,-d/2-.023,zz),(.009,.01,.145),metal,.003)
  # End panel joinery / recessed back and adjustable feet are separate authored parts.
  box('Top finishing cap',(x,0,z+height-.009),(width+.004,d,.018),wood,.002)
 if kind=='tall':cabinet(0,w,0,h)
 else:
  tw=.6;x=-w/2+tw/2;cabinet(x,tw,0,h,doors=1)
  rem=w-tw;cx=tw/2;cabinet(cx,rem,0,.86,doors=2)
  box('Countertop',(cx,-.004,.879),(rem+.004,d+.012,.025),wood,.003)
  if kind=='bridge':cabinet(cx,rem,1.56,.44,doors=2)
 ident='original-shoe-'+kind
 for o in list(bpy.context.scene.objects):
  bpy.context.view_layer.objects.active=o
  for mo in list(o.modifiers):
   try:bpy.ops.object.modifier_apply(modifier=mo.name)
   except RuntimeError:pass
 bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(ident+'.blend')))
 for mat in list(bpy.data.materials):
  group=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==mat]
  if len(group)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in group:o.select_set(True)
   bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
 bpy.ops.export_scene.gltf(filepath=str(OUT/(ident+'.glb')),export_format='GLB',export_extras=True)
 # Mirror sits inside the left door, clear of the handle.
 tw=.8 if kind=='tall' else .6
 items.append(dict(id=ident,name=name,group='住設',category='下駄箱',sourceFolder='BlenderOriginal',provenance='original',model='assets/models/original/'+ident+'.glb',thumb='assets/models/previews-v2/'+ident+'-thumb.png',top='assets/models/previews-v2/'+ident+'-top.png',previewVersion=2,w=round(w*1000),d=410,h=2000,front='+Z',mirrorOption=dict(x=(-w/2+tw/4-.015 if kind=='tall' else -w/2+tw/2-.015),y=1.06,w=(tw/2-.11 if kind=='tall' else tw-.13),h=1.70),finishChannels=[dict(key='body',label='収納扉・本体',default='#a68a68')]))
(R/'tools/blender/entry-storage-collection.json').write_text(json.dumps({'items':items},ensure_ascii=False,indent=2)+'\n')
