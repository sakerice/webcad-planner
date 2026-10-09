"""Saved installation scenes using byte-identical accepted host GLBs.
Only rigid transforms are applied. Narrow/wide fixtures are explicitly excluded QA geometry.
"""
from pathlib import Path
import sys,json,shutil,math
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import *
import forms
ACCEPTED=Path('/workspace/scratch/a6c8080223a8/mansion-integration-20261008T0553/repo')
HOSTS={'raised-sill':'rpg-mansion-raised-sill-fixed-window-bay-01','french':'rpg-mansion-tall-fixed-french-window-bay-01','existing-curtain':'rpg-mansion-curtain-01'}

def inputs():
    directory=HERE/'proofs'/'inputs';directory.mkdir(exist_ok=True)
    saved=directory/'accepted-input-manifest.json'
    if saved.exists():
        records=json.loads(saved.read_text())
        for rec in records.values():assert sha(HERE/rec['file'])==rec['sha256']
        return records
    m={it['id']:it for it in json.loads((ACCEPTED/'assets/models/packs/rpg-mansion/manifest.json').read_text())['items']}
    records={}
    for label,stem in HOSTS.items():
        it=m[stem];src=ACCEPTED/it['model'];dst=directory/(stem+'.glb')
        if not dst.exists():shutil.copyfile(src,dst)
        assert sha(src)==sha(dst)
        records[label]=dict(id=stem,file=str(dst.relative_to(HERE)),sha256=sha(dst),source='Accepted integrated240 snapshot; copied unchanged',moduleContract=it.get('moduleContract'),w=it['w'],d=it['d'],h=it['h'])
    (directory/'accepted-input-manifest.json').write_text(json.dumps(records,indent=2)+'\n');return records

def load(path,label,transform=Matrix.Identity(4)):
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));obs=[o for o in bpy.data.objects if o not in before and o.type=='MESH'];assert obs
    for o in obs:
        o.matrix_world=transform@o.matrix_world;o.name=label+' | '+o.name;o['proofRole']=label
    bpy.context.view_layer.update();return obs

def fixture(width,bottom,top,label):
    forms.setup();M['plaster']=kit.matp('QA neutral plaster','#e6e0d0',.8,0);M['plaster']['finishChannel']='qa-fixture';M['glass']=kit.matp('QA opaque comparison glazing','#b6c2bb',.8,0);M['glass']['finishChannel']='qa-fixture'
    outer=width+.36
    for x in [-(width+.18)/2,(width+.18)/2]:box(label+' plaster jamb',(x,0,1.5),(.18,.24,3),'plaster',0)
    if bottom>0:box(label+' lower spandrel',(0,0,bottom/2),(width,.24,bottom),'plaster',0)
    box(label+' upper lintel',(0,0,(top+3)/2),(width,.24,3-top),'plaster',0)
    for x in [-width/2+.025,width/2-.025]:box(label+' timber jamb',(x,0,(bottom+top)/2),(.05,.20,top-bottom),'oak',.001)
    for z in [bottom+.025,top-.025]:box(label+' timber rail',(0,0,z),(width,.20,.05),'oak',.001)
    box(label+' pane',(0,0,(bottom+top)/2),(width-.10,.008,top-bottom-.10),'glass',0)
    for ob in PARTS:ob['excludedQAOnly']=True;ob['notAProduct']=True;ob['proofRole']='Excluded aperture fixture';author_uv(ob)
    return list(PARTS)

def bounds(obs):
    p=[o.matrix_world@v.co for o in obs for v in o.data.vertices];return [[min(q[i]for q in p)for i in range(3)],[max(q[i]for q in p)for i in range(3)]]

def save(scene,name,objects):
    scene['proofIsStatic']=True;scene['nativeOpeningOrAutomaticFollowing']=False
    path=HERE/'proofs'/(name+'.blend');bpy.context.preferences.filepaths.save_version=0;sanitize(name);bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    for view in ['interior-front','interior-side']:render(objects,HERE/'evidence'/(name+'-'+view+'.png'),view,768)
    return str(path.relative_to(HERE))

def main():
    host=inputs();items=json.loads((HERE/'descriptors.json').read_text())['items'];reports=[]
    for it in items:
        bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene;sc.name='Static installation | '+it['name'];dt=it['installationDatums'];h=dt['host'];fixture_only=h=='narrow-qa-fixture'
        if fixture_only:
            hostobs=fixture(.640,1.100,2.200,'Excluded narrow 640mm QA aperture');ap=dict(width=640,bottom=1100,top=2200);clear=dict(width=540,bottom=1150,top=2150);hostinfo=dict(label='Excluded640mm narrow utility-window fixture',countedAsProduct=False)
        else:
            hc=host[h]['moduleContract'];shift=hc['constructionToAssetTranslationM'];hostobs=load(HERE/host[h]['file'],'Accepted window host',Matrix.Translation(Vector(shift)*-1));ap=hc['wallApertureMm'];clear=hc['frameClearOpeningMm'];hostinfo=host[h]
        sh=Vector(dt['bottomCenterTranslationBlenderM']);T=Matrix.Translation((0,.12,0))@Matrix.Rotation(math.pi,4,'Z')@Matrix.Translation(-sh)
        product=load(HERE/it['model'],'Window dressing under test',T);pb=bounds(product)
        # Origin transform places the physical plate rear faces on the accepted interior plaster plane.
        contact_y=(T@Vector((0,dt['installation']['wallContactPlaneCanonicalBlenderY'],0))).y
        width=it['w'];surplus=width-ap['width'];limit=300 if it['kind']=='curtain' else 200;allowed=[100,400]if it['kind']=='curtain'else[0,100]
        forward_mm=(pb[1][1]-.12)*1000
        report=dict(id=it['id'],scene='proofs/'+it['id']+'-installed.blend',host=hostinfo,hostExcludedFromProductCount=fixture_only,wallApertureMm=ap,frameClearOpeningMm=clear,outerDressingWidthMm=width,widthSurplusToWallApertureMm=round(surplus,3),widthSurplusToVisibleFrameClearMm=round(width-clear['width'],3),sourceWidthAllowanceMm=allowed,physicalWallContactPlaneM=contact_y,actualWallPlaneM=.12,wallContactErrorMm=abs(contact_y-.12)*1000,maximumRoomSideProjectionMm=forward_mm,projectAttachmentLimitMm=limit,attachmentAboveApertureMm=dt['installation']['attachmentAboveApertureMm'],defaultBottomElevationMm=it['defaultElevation'],actualInstalledBoundsM=pb,rigidTransformBlenderM=[list(row)for row in T],modelSha256=sha(HERE/it['model']),static=True,manualPlacement=True,complianceClaim=False)
        report['checks']=dict(widthFit=allowed[0]<=surplus<=allowed[1],wallContact=report['wallContactErrorMm']<.001,interiorSide=pb[0][1]>=.12-1e-6,attachmentDistance=forward_mm<=limit and report['attachmentAboveApertureMm']<=limit,apertureVerticalEnvelopeCoverage=pb[0][2]<=ap['bottom']/1000 and pb[1][2]>=ap['top']/1000)
        if h=='french':report['checks']['apertureVerticalEnvelopeCoverage']=pb[0][2]<=clear['bottom']/1000 and pb[1][2]>=ap['top']/1000;report['coverageNote']='Intentional floor clearance; coverage starts below the90mm clear-glazing bottom, not at the zero-height structural aperture bottom.'
        sc['installationProofJson']=json.dumps(report);save(sc,it['id']+'-installed',hostobs+product);report['sceneSha256']=sha(HERE/report['scene']);reports.append(report)
    # Existing full-length pair reused unchanged; not a sixth product or new construction.
    bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene;sc.name='Existing curtain reuse | excluded1900mm QA fixture';hostobs=fixture(1.9,.0,2.30,'Excluded1900mm full-height QA aperture')
    existing=load(HERE/host['existing-curtain']['file'],'Existing accepted curtain reused',Matrix.Translation((0,.295,.040))@Matrix.Rotation(math.pi,4,'Z'));eb=bounds(existing)
    reuse=dict(id='existing-curtain-reuse',existingInput=host['existing-curtain'],newProductCount=0,newConstructionCount=0,fixtureExcluded=True,fixtureApertureMm=dict(width=1900,bottom=0,top=2300),widthSurplusMm=250,sourceWidthAllowanceMm=[100,400],note='Visual reuse example only; existing geometry remains byte-identical. This fixture is not a certified asset and does not expand the catalog. Existing curtain hardware/contact is not retroactively certified.',actualInstalledBoundsM=eb)
    sc['installationProofJson']=json.dumps(reuse);reuse['scene']=save(sc,'existing-curtain-reuse',hostobs+existing);reuse['sceneSha256']=sha(HERE/reuse['scene']);reports.append(reuse)
    for label,rec in host.items():assert sha(HERE/rec['file'])==rec['sha256']
    (HERE/'reports'/'installation-proofs.json').write_text(json.dumps(dict(newProductCount=5,newConstructionCount=5,excludedFixtureCount=2,existingReusedProductCount=1,items=reports),indent=2)+'\n')
if __name__=='__main__':main()
