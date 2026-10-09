"""New reconstruction of original mansion completion architecture. Static authoring only."""
import sys,json,hashlib,math
from pathlib import Path
H=Path(__file__).resolve().parent;sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
import completion_common as g
import completion_walls_floors as wf
import completion_details as dt
import completion_roofs as rf
import completion_roof_details as rd

def conn(label,point,normal):return dict(label=label,point=point,normal=normal)
def wallcons(w=1.2):return [conn('left',[-w/2,0,0],[-1,0,0]),conn('right',[w/2,0,0],[1,0,0]),conn('wall-top',[0,0,3],[0,0,1])]
def tilecons(top):return [conn('west',[-.6,0,0],[-1,0,0]),conn('east',[.6,0,0],[1,0,0]),conn('front',[0,-.6,0],[0,-1,0]),conn('rear',[0,.6,0],[0,1,0]),conn('bottom',[0,0,0],[0,0,-1]),conn('top',[0,0,top],[0,0,1])]
def item(key,name,builder,role,connections,**kw):return dict(key=key,name=name,builder=builder,role=role,connections=connections,**kw)
PLAN=[
 item('ashlar-wall-bay','1200mm coursed ashlar wall bay',lambda:wf.ashlar(g),'Nine staggered courses of physical bevelled stone slips on structural plaster core',wallcons(),nominalWidthMm=1200,wallHeightMm=3000,wallThicknessMm=240),
 item('rusticated-plinth-segment','1200mm rusticated foundation plinth',lambda:wf.plinth(g),'Broad 420mm foundation footing and cap support wall and installed pilaster toes',[conn('left',[-.6,0,0],[-1,0,0]),conn('right',[.6,0,0],[1,0,0]),conn('foundation-top',[0,0,.6],[0,0,1])],installationElevationMm=-600,foundationDepthMm=420,topDatumMm=0),
 item('half-timbered-infill-bay','1200mm half-timber infill wall bay',lambda:wf.half_timber(g),'Four individually clipped timber braces within full-height plaster infill',wallcons(),nominalWidthMm=1200,wallHeightMm=3000,wallThicknessMm=240),
 item('tall-fixed-french-window-bay','1200mm tall fixed French window bay',lambda:wf.french(g),'True floor-open wall aperture, fixed timber French frames and eight clear glazing panes',wallcons(),nominalWidthMm=1200,wallHeightMm=3000,wallThicknessMm=240,wallApertureMm=dict(width=1040,bottom=0,top=2750),frameClearOpeningMm=dict(width=920,bottom=90,top=2680),fixedGlazing=True,operable=False,nativeWallCutting=False,glassThicknessMm=8),
 item('octagon-cabochon-floor-tile','1200mm octagon and cabochon stone floor tile',lambda:wf.octagon_floor(g),'Sixteen stone octagons and clipped dark diamond cabochons over continuous substrate',tilecons(.075),nominalFootprintMm=[1200,1200],substrateThicknessMm=50,wearLayerMm=25,installationElevationMm=-75,finishedFloorDatumMm=0),
 item('stone-wall-pilaster','3000mm weathered-cap stone wall pilaster',lambda:dt.pilaster(g),'Profiled monolithic wall mount with raised field and level rear capital bearing tongue',[conn('mount',[0,0,1.5],[0,1,0]),conn('bottom',[0,-.09,0],[0,0,-1]),conn('capital-bearing',[0,.06,3],[0,0,1])],wallMountTranslationM=[0,-.12,0],capitalBearingAreaM2=.06),
 item('stone-newel-post','1100mm profiled stone newel post',lambda:dt.newel(g),'Monolithic cap-and-base railing newel with physical rail contact planes',[conn(side+'-'+level,[x,y,z],[nx,ny,0]) for side,x,y,nx,ny in [('west',-.15,0,-1,0),('east',.15,0,1,0),('south',0,-.15,0,-1),('north',0,.15,0,1)] for level,z in [('low',.08),('high',.97)]],newelCentreSpacingMm=1200),
 item('turned-stone-balustrade','900mm turned stone balustrade bay',lambda:dt.balustrade(g),'Three turned twenty-sided balusters bearing between continuous lower and upper rails',[conn('west-low',[-.45,0,.08],[-1,0,0]),conn('east-low',[.45,0,.08],[1,0,0]),conn('west-high',[-.45,0,.97],[-1,0,0]),conn('east-high',[.45,0,.97],[1,0,0])],clearRunMm=900,newelCentreSpacingMm=1200),
 item('wrought-iron-railing','900mm forged oval wrought-iron railing',lambda:dt.iron(g),'Six upright pickets, ten forged oval loops, offset joining tabs, handrail and ground shoes',[conn('west-low',[-.45,0,.08],[-1,0,0]),conn('east-low',[.45,0,.08],[1,0,0]),conn('west-high',[-.45,0,.97],[-1,0,0]),conn('east-high',[.45,0,.97],[1,0,0])],clearRunMm=900,newelCentreSpacingMm=1200),
 item('portico-pediment','4200mm stone portico pediment',lambda:dt.pediment(g),'Triangular framed tympanum with bronze rosette and continuous supported beam',[conn('west-column',[-1.8,0,0],[0,0,-1]),conn('east-column',[1.8,0,0],[0,0,-1])],installationElevationMm=3000,pitchSlope=4/7,weatherSealMate=False,columnContactAreaM2=.288),
]
if rf and rd:
 PLAN += [
 item('slate-gable-hipped-end','Three-sided hollow slate gable hipped end',lambda:rf.gable_hip(g),'Three true roof planes, staggered lapped slates, matching folded ridge and U-shaped bearing seats',[conn('span-join',[0,0,0],[0,1,0]),conn('west-bearing',[-1.8,-.84,.1],[0,0,-1]),conn('east-bearing',[1.8,-.84,.1],[0,0,-1]),conn('end-bearing',[0,-1.8,.1],[0,0,-1])],roofInstallationElevationMm=2900,pitchSlope=.7,deckThicknessVerticalMm=55,bearingCentreSpanMm=3600),
 item('standing-seam-conical-turret-roof','4200mm standing-seam hollow conical turret roof',lambda:rf.turret(g),'Thirty-two faceted conical metal roof, folded radial seams, hollow hood and annular bearing',[conn('annular-bearing',[1.7,0,.1],[0,0,-1])],roofInstallationElevationMm=2900,bearingRingRadiiMm=[1560,1920],facets=32,deckThicknessVerticalMm=55),
 item('flat-parapet-roof-cap','4200mm drained flat parapet roof cap',lambda:rf.flat_cap(g),'Full square sloped membrane cap, hollow underside, parapet ring with true scupper and weathered coping',[conn('bearing',[1.8,0,0],[0,0,-1])],roofInstallationElevationMm=3000,repeatable=False,fallDirection='-Y',heightIncreasesToward='+Y',fallSlope=.012,scupperWidthMm=240),
 item('standing-seam-lean-to-span','2400mm-bearing standing-seam lean-to span',lambda:rf.lean_to(g),'Repeatable single-slope thin deck on low wall bearing and tall timber riser',[conn('front-repeat',[0,-.6,0],[0,-1,0]),conn('rear-repeat',[0,.6,0],[0,1,0]),conn('low-bearing',[-1.2,0,.1],[0,0,-1]),conn('high-bearing',[1.2,0,.1],[0,0,-1])],roofInstallationElevationMm=2900,pitchSlope=.4,bearingCentreSpanMm=2400,deckInterceptM=.041,trimClearanceMm=1),
 item('flat-parapet-chimney-host','4200mm flat parapet chimney host variant',lambda:rf.flat_cap(g,True),'Flat parapet roof cap with real 400mm square aperture through deck and membrane',[conn('bearing',[1.8,0,0],[0,0,-1]),conn('chimney-shoe',[.9,.9,.242],[0,-.012/math.sqrt(1+.012**2),1/math.sqrt(1+.012**2)])],roofInstallationElevationMm=3000,variantOf='rpg-mansion-flat-parapet-roof-cap-01',distinctConstructionFamily=False,apertureMm=dict(x=[700,1100],y=[700,1100]),fallDirection='-Y',heightIncreasesToward='+Y',fallSlope=.012),
 item('hollow-brick-chimney','720mm hollow brick chimney with vented rain hood',lambda:rd.chimney(g),'One hundred physical bevelled brick slips around a real 400mm open flue and elevated hollow hood',[conn('sloped-shoe',[0,0,.00408],[0,.012/math.sqrt(1+.012**2),-1/math.sqrt(1+.012**2)])],installationElevationMm=3237.92,flueClearMm=[400,400],constructionPlacementM=[.9,.9,3.23792],pairedComponentOf='rpg-mansion-flat-parapet-chimney-host-01'),
 item('fixed-shed-dormer','1080mm fixed-glazing shed dormer',lambda:rd.dormer(g),'Open-bottom slope-fitted cheeks, two clear glazing panes and standing-seam shed roof',[conn('host-fit',[.425,0,.825],[0,.7/math.sqrt(1+.7**2),-1/math.sqrt(1+.7**2)])],installationElevationMm=3305,constructionPlacementM=[1,0,2.9],nativeRotationDegrees=90,fixedGlazing=True,operable=False,glassThicknessMm=8),
 item('gable-dormer-host','1200mm slate gable dormer host variant',lambda:rd.dormer_host(g),'Original gable span with true 1000x800mm deck opening and wider slate cutback',[conn('front-repeat',[0,-.6,0],[0,-1,0]),conn('rear-repeat',[0,.6,0],[0,1,0]),conn('west-bearing',[-1.8,0,.1],[0,0,-1]),conn('east-bearing',[1.8,0,.1],[0,0,-1])],roofInstallationElevationMm=2900,variantOf='rpg-mansion-slate-gable-span-01',distinctConstructionFamily=False,pairedComponentOf='rpg-mansion-fixed-shed-dormer-01',deckOpeningMm=dict(x=[500,1500],y=[-400,400]),slateCutbackMm=dict(x=[450,1600],y=[-450,450])),
 ]

def clarify(item):
 c=item['moduleContract'];exact=[item[k] for k in ['w','d','h']];nominal=[round(x) for x in exact]
 item['measuredEnvelopeMm']=dict(zip(['w','d','h'],exact));item['nominalEnvelopeMm']=dict(zip(['w','d','h'],nominal));item['dimensionToleranceMm']=.1
 for k,v in zip(['w','d','h'],nominal):item[k]=v
 e=c.get('installationElevationMm',c.get('roofInstallationElevationMm',0));item['defaultElevation']=e;c['defaultAssetBottomElevationMm']=e;c['wallTopDatumMm']=3000
 to=lambda p:[float(p[0]),float(p[2]),float(-p[1])]
 c['constructionToAssetTranslationGltfM']=to(c['constructionToAssetTranslationM']);c['exportConnectionFrame']='glTF XYZ / +Y up / +Z front; bottom-centre origin';c['axisConversion']='glTF(x,y,z)=(Blender.x,Blender.z,-Blender.y)'
 for row in c['connections']:row['constructionPointGltfM']=to(row['point']);row['assetPointGltfM']=to(row['assetPointM']);row['normalGltf']=to(row['normal'])
 if c.get('fixedGlazing'):c['glazingMaterial']=dict(appearance='Lightly tinted fixed glazing; current exported transmission testing required',alpha=.10,roughness=.08,glassThicknessMm=8)
 item['independentConstructionCount']=0 if c.get('variantOf') else 1
 if c.get('variantOf'):item['variantOf']=c['variantOf']
 item['builder']=str((H/'build.py').relative_to(g.ROOT));item['reconstruction']=dict(newOriginalAssets=True,historicalBytesRecovered=False,priorAcceptanceInherited=False)
 return item

g.PLAN=PLAN;g.clarify=clarify
exec(compile((H/'completion_pipeline.py').read_text(),str(H/'completion_pipeline.py'),'exec'),g.__dict__)
if __name__=='__main__':g.main()
