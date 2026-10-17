"""Inspect the actual hollow bowl without changing its source or geometry."""
from pathlib import Path
import sys,json,math
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
FAMILY=HERE.parent
ROOT=HERE.parents[3]
sys.path[:0]=[str(FAMILY),str(FAMILY.parent)]
import exterior_build
from png_metadata import strip_metadata
stem='rpg-mansion-scullery-sink-900-01'
bpy.ops.wm.open_mainfile(filepath=str(HERE/'work'/(stem+'.blend')))
scene=bpy.context.scene;obj=next(o for o in scene.objects if o.type=='MESH')
scene=exterior_build._icon_scene(obj,1024);scene.cycles.use_denoising=False;scene.cycles.samples=64
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.2
scene.view_settings.view_transform='AgX'
target=Vector((0,-.025,.85))
for name,location,power in [('Key',(-1,-1,2.2),240),('Fill',(1,0,2.5),80)]:
 bpy.ops.object.light_add(type='AREA',location=location);ob=bpy.context.object;ob.name=name;ob.data.energy=power;ob.data.size=1.8;ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.45,-.94,1.73));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=1.0;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
path=HERE/'evidence'/'sink-basin-depth-closeup.png';scene.render.filepath=str(path)
if '--measure-only' not in sys.argv:bpy.ops.render.render(write_still=True);strip_metadata(path)
author=next(s for s in bpy.data.scenes if s.name.startswith('Native authoring parts'))
basin=next(o for o in author.objects if o.name.startswith('Continuous glazed bowl'))
points=[basin.matrix_world@v.co for v in basin.data.vertices];zs=sorted(set(round(p.z*1000,3) for p in points))
worktop=[o for o in author.objects if o.name.startswith('Continuous stone counter')];top=max((o.matrix_world@v.co).z*1000 for o in worktop for v in o.data.vertices)
drain=next(o for o in author.objects if o.name.startswith('Brass basin drain'));dp=[drain.matrix_world@v.co for v in drain.data.vertices]
n=len(points)//7;floor=sum(p.z*1000 for p in points[-n:])/n;rim=max(p.z*1000 for p in points)
result=dict(method='Vertices of reopened named native authoring components, measured in metres converted to mm',basin_vertical_ring_levels_mm=zs,worktop_top_mm=top,inner_bowl_floor_mm=floor,inner_rolled_rim_mm=rim,usable_depth_mm=rim-floor,drain_bounds_mm=[[min(p[i]*1000 for p in dp) for i in range(3)],[max(p[i]*1000 for p in dp) for i in range(3)]],functional_contract='Static bowl and tap geometry; no water simulation',image=str(path.relative_to(ROOT)))
(HERE/'sink-basin-depth-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
