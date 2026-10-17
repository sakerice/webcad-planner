"""Saved static-room proofs importing exact accepted and new GLB bytes."""
from pathlib import Path
import sys,json,shutil,math
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import *
from mathutils import Matrix,Vector
R=Path('/workspace/scratch/a6c8080223a8/mansion-recovery-20261008T0401/repo')
HOSTS=['rpg-mansion-kitchen-cast-iron-range-750-01','rpg-mansion-scullery-sink-900-01','rpg-mansion-kitchen-draining-stand-900-01','rpg-mansion-console-01','rpg-mansion-mirror-01','rpg-mansion-narrow-servants-bed-01','rpg-mansion-rug-01']

def inputs():
    q=HERE/'proofs/inputs';q.mkdir(exist_ok=True);saved=q/'accepted-input-manifest.json'
    if saved.exists():
        out=json.loads(saved.read_text())
        for rec in out.values():assert sha(HERE/rec['file'])==rec['sha256']
        return out
    m={i['id']:i for i in json.loads((R/'assets/models/packs/rpg-mansion/manifest.json').read_text())['items']};out={}
    for stem in HOSTS:
        it=m[stem];src=R/it['model'];dst=q/(stem+'.glb')
        if not dst.exists():shutil.copyfile(src,dst)
        assert sha(src)==sha(dst);out[stem]=dict(id=stem,file=str(dst.relative_to(HERE)),sha256=sha(dst),sourceModel=it['model'],sourceRootLabel='Immutable accepted project original snapshot',w=it['w'],d=it['d'],h=it['h'],countedAsNew=False)
    (q/'accepted-input-manifest.json').write_text(json.dumps(out,indent=2)+'\n');return out

def load(path,label,T=Matrix.Identity(4)):
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];assert obs
    for o in obs:o.matrix_world=T@o.matrix_world;o.name=label+' | '+o.name;o['proofRole']=label;o['inputSha256']=sha(path)
    bpy.context.view_layer.update();return obs

def bb(obs):return[list(v)for v in bounds(obs)]
def tr(x=0,y=0,z=0):return Matrix.Translation((x,y,z))
def fixtures(width,y0,y1,height=2.8,hall=False):
    forms.setup();M['floor']=kit.matp('Excluded warm room floor','#a59677',.95,0);M['wall']=kit.matp('Excluded pale room wall','#d5ccb9',.95,0)
    box('Excluded proof floor',(0,(y0+y1)/2,-.045),(width,y1-y0,.09),'floor',0)
    box('Excluded proof back wall',(0,y1+.06,height/2),(width+.12,.12,height),'wall',0)
    if hall:
        for x in [-width/2-.03,width/2+.03]:box('Excluded cutaway hall sidewall',(x,(y0+y1)/2,.14),(.06,y1-y0,.28),'wall',0)
    else:box('Excluded cutaway left room wall',(-width/2-.04,(y0+y1)/2,.375),(.08,y1-y0,.75),'wall',0)
    for o in PARTS:o['excludedQAOnly']=True;o['notAProduct']=True;o['proofRole']='Excluded room fixture';author_uv(o)
    return list(PARTS)

def save(name,obs,report):
    sc=bpy.context.scene;sc.name=name;sc['staticInstallationProof']=True;sc['notNativeRoomProgram']=True;sc['proofJson']=json.dumps(report)
    path=HERE/'proofs'/(name+'.blend');bpy.context.preferences.filepaths.save_version=0;sanitize(name);bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    report['scene']=str(path.relative_to(HERE));report['sceneSha256']=sha(path)
    return report

def main():
    hosts=inputs();it={i['id']:i for i in json.loads((HERE/'descriptors.json').read_text())['items']};reports=[]
    def old(stem,T=Matrix.Identity(4)):return load(HERE/hosts[stem]['file'],'Accepted unchanged '+stem,T)
    def new(stem,T=Matrix.Identity(4)):return load(HERE/it[stem]['model'],'Candidate '+stem,T)
    # Kitchen: unchanged cast-iron range and scullery modules, fitted to a physical wall.
    bpy.ops.wm.read_factory_settings(use_empty=True);obs=fixtures(3.2,-1.7,.36)
    rangeobs=old(HOSTS[0]);sinkobs=old(HOSTS[1],tr(-.85,0,0));drainobs=old(HOSTS[2],tr(.9,0,0));obs+=rangeobs+sinkobs+drainobs
    hoodid='rpg-mansion-period-range-canopy-01';shift=Vector(it[hoodid]['installationDatums']['bottomCenterTranslationBlenderM']);hoodobs=new(hoodid,Matrix.Translation(-shift));obs+=hoodobs
    rb=bb(rangeobs);hb=bb(hoodobs);hoodclear=(hb[0][2]-rb[1][2])*1000;frontclear=(rb[0][1]+1.7)*1000
    report=dict(id='kitchen-scullery-installed',newProducts=[hoodid],acceptedInputs=[hosts[x]for x in HOSTS[:3]],rangeBoundsM=rb,canopyBoundsM=hb,actualHobClearanceMm=hoodclear,rangeBackToWallMm=(.36-rb[1][1])*1000,wallContactPlaneBlenderY=.36,hoodBracketRearPlaneBlenderY=.36,minimumWorkingAisleMm=frontclear,checks=dict(hobClearanceAtLeast700mm=hoodclear>=700,workingAisleAtLeast1000mm=frontclear>=1000,rangeFitsUnderCanopy=hb[0][0]<rb[0][0]and hb[1][0]>rb[1][0],rangeBackDoesNotPenetrateWall=rb[1][1]<=.36+.0001),limitations='Static visual service assembly. Canopy is not a ventilation system; accepted range is not physically operable. Room fixtures are excluded from catalogue count.')
    reports.append(save(report['id'],obs,report))
    # Laundry: original open washing tub and drying frame with exact accepted sink/drainer.
    bpy.ops.wm.read_factory_settings(use_empty=True);obs=fixtures(3.6,-1.8,1.8)
    sink=old(HOSTS[1],tr(-.85,1.475,0));drain=old(HOSTS[2],tr(.75,1.475,0));obs+=sink+drain
    tubid='rpg-mansion-manual-wash-tub-board-01';rackid='rpg-mansion-hinged-timber-drying-frame-01'
    tub=new(tubid,tr(-.85,-.3,0));rack=new(rackid,tr(.9,-.1,0));obs+=tub+rack;tb=bb(tub);db=bb(rack)
    report=dict(id='manual-laundry-installed',newProducts=[tubid,rackid],acceptedInputs=[hosts[x]for x in HOSTS[1:3]],tubBoundsM=tb,dryingFrameBoundsM=db,frontWorkingAisleMm=(min(tb[0][1],db[0][1])+1.8)*1000,interEquipmentGapMm=(db[0][0]-tb[1][0])*1000,frameToRearDrainerClearanceMm=(bb(drain)[0][1]-db[1][1])*1000,checks=dict(clearFrontWorkingAisleAtLeast1000mm=(min(tb[0][1],db[0][1])+1.8)>=1,partsRestOnFloor=abs(tb[0][2])<1e-5 and abs(db[0][2])<1e-5,distinctFloorFootprints=tb[1][0]<db[0][0],interEquipmentAccessAtLeast750mm=(db[0][0]-tb[1][0])*1000>=750,rackInsideRoom=db[1][0]<1.8,noDrainerFrameOverlap=bb(drain)[0][1]>db[1][1]),limitations='Empty basin, washboard and deployed drying frame are static. No powered washer/pan, water, cloth or folding behavior. Source contact measurements accompany this room arrangement.')
    reports.append(save(report['id'],obs,report))
    # Narrow hall: accepted rug cannot fit at full size in either rotation; accepted console/mirror reused.
    bpy.ops.wm.read_factory_settings(use_empty=True);obs=fixtures(1.25,-2.8,2.8,hall=True)
    console=old(HOSTS[3],tr(0,2.6,0));mirror=old(HOSTS[4],tr(0,2.75,1.10));obs+=console+mirror
    runnerid='rpg-mansion-narrow-hall-runner-01';runnerobs=new(runnerid);obs+=runnerobs;rr=bb(runnerobs);cb=bb(console)
    report=dict(id='narrow-hall-installed',newProducts=[runnerid],acceptedInputs=[hosts[x]for x in HOSTS[3:5]],comparisonInput=hosts[HOSTS[6]],hallClearWidthMm=1250,existingRugFullFootprintMm=[1400,2000],existingRugFitsAtEitherRightAngle=False,runnerBoundsM=rr,runnerFloorContactMm=rr[0][2]*1000,walkingPlaneMaxMm=rr[1][2]*1000,sideFloorMarginsMm=[(rr[0][0]+.625)*1000,(.625-rr[1][0])*1000],consoleFrontClearanceMm=(cb[0][1]-rr[1][1])*1000,thresholdToRunnerStartMm=(rr[0][1]+2.8)*1000,checks=dict(existingRugCannotFit=min(1400,2000)>1250,runnerFits=rr[0][0]>=-.625 and rr[1][0]<=.625,runnerRestingOnFloor=abs(rr[0][2])<1e-6,walkingPlaneBelow10mm=rr[1][2]<.010,consoleClearanceAtLeast900mm=(cb[0][1]-rr[1][1])*1000>=899.99,hallClearWidthAtLeast750mm=1250>=750),counting='One useful functional-footprint variant, zero new core constructions. No geometry copied or detached from the older rug.',limitations='Hall is an excluded static proof fixture. No native room/wall/door connection or walking collision behavior.')
    reports.append(save(report['id'],obs,report))
    # Reuse proof for sleeping scene: source audit, unchanged accepted bed and its existing bedding.
    bpy.ops.wm.read_factory_settings(use_empty=True);obs=fixtures(3.0,-1.8,1.8)
    bed=old(HOSTS[5],tr(0,.775,0));obs+=bed;bbd=bb(bed)
    report=dict(id='existing-bedroom-bedding-reuse',newProducts=[],acceptedInputs=[hosts[HOSTS[5]]],bedBoundsM=bbd,sideClearancesMm=[(bbd[0][0]+1.5)*1000,(1.5-bbd[1][0])*1000],footClearanceMm=(bbd[0][1]+1.8)*1000,newBeddingCount=0,checks=dict(sideClearancesAtLeast750mm=bbd[0][0]+1.5>=.75 and 1.5-bbd[1][0]>=.75,footClearanceAtLeast900mm=bbd[0][1]+1.8>=.9),limitations='Accepted mattress, pillow and cover reused unchanged in the bed GLB. This is not a new standalone bedding item.')
    reports.append(save(report['id'],obs,report))
    for r in reports:assert all(r['checks'].values()),(r['id'],r['checks'])
    (HERE/'reports/installation-proofs.json').write_text(json.dumps(dict(newProductCount=4,newConstructionCount=3,functionalFootprintVariantCount=1,items=reports),indent=2)+'\n')
    for rec in hosts.values():assert sha(HERE/rec['file'])==rec['sha256']
    if '--no-render' not in sys.argv:
      only=sys.argv[sys.argv.index('--render-scenes')+1].split(',')if '--render-scenes'in sys.argv else None
      for r in reports:
        if only and r['id']not in only:continue
        bpy.ops.wm.open_mainfile(filepath=str(HERE/r['scene']));obs=[o for o in bpy.context.scene.objects if o.type=='MESH']
        for view in ['scene','scene-top','front']:render(obs,HERE/'evidence'/(r['id']+'-'+view+'.png'),view,900)
if __name__=='__main__':main()
