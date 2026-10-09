"""One-time wider laundry access refinement; product geometry remains byte-identical."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_proofs import *
p=HERE/'reports/installation-proofs.json';D=json.loads(p.read_text());r=next(x for x in D['items']if x['id']=='manual-laundry-installed');bpy.ops.wm.open_mainfile(filepath=str(HERE/r['scene']));obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];rack=[o for o in obs if'Candidate rpg-mansion-hinged-timber-drying-frame'in o.name];tub=[o for o in obs if'Candidate rpg-mansion-manual-wash-tub'in o.name];drain=[o for o in obs if'Accepted unchanged rpg-mansion-kitchen-draining-stand'in o.name]
assert len(rack)==1
rack[0].location.x=.9;bpy.context.view_layer.update();tb=bb(tub);db=bb(rack);r['dryingFrameBoundsM']=db;r['interEquipmentGapMm']=(db[0][0]-tb[1][0])*1000;r['frameToRearDrainerClearanceMm']=(bb(drain)[0][1]-db[1][1])*1000;r['checks']['interEquipmentAccessAtLeast750mm']=r['interEquipmentGapMm']>=750;r['checks']['rackInsideRoom']=db[1][0]<1.8;assert all(r['checks'].values());bpy.context.scene['proofJson']=json.dumps({k:v for k,v in r.items()if k not in ['scene','sceneSha256']});sanitize(r['id']);bpy.ops.wm.save_as_mainfile(filepath=str(HERE/r['scene']),compress=True);r['sceneSha256']=sha(HERE/r['scene']);p.write_text(json.dumps(D,indent=2)+'\n')
for view in ['scene','scene-top','front']:render(obs,HERE/'evidence'/(r['id']+'-'+view+'.png'),view,900)
print('LAUNDRY_ACCESS_REFINED',r['interEquipmentGapMm'])
