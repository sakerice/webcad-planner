"""Produce auditable explicit ID pairs from the resolved catalogue and existing tags.
No runtime fuzzy matching; uncertain/unsupported classes remain unchanged.
"""
import json,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'assets/models/packs/rpg-mansion'
legacy={}
for folder in ['furniture_mega','interior_model_0_26_1','custom']:
 for item in json.loads((ROOT/'assets/models'/folder/'manifest.json').read_text())['items']:legacy[item['id']]=item
tags=json.loads((ROOT/'assets/models/tags.json').read_text());rpg=json.loads((OUT/'manifest.json').read_text());targets={i['id']:i for i in rpg['items']}
def target(item,tag):
 kind=tag.get('kind');w,d,h=[item.get(k,0) for k in ['w','d','h']]
 if tag.get('confidence',{}).get('kind',0)<.8:return None
 if kind=='chair':return 'stool' if h<650 else 'wing-chair' if w>650 else 'chair'
 if kind=='sofa':return 'sofa' if w>=1350 else 'wing-chair'
 if kind=='bed':return 'canopy-bed' if w>=1300 else 'single-bed'
 if kind=='dining-table':return 'round-table' if abs(w-d)<150 else 'dining-table'
 if kind=='low-table':return 'coffee-table' if h<650 else 'desk'
 if kind=='desk':return 'desk'
 if kind=='counter-table':return 'console'
 if kind=='closet':return 'linen-cabinet' if w<900 else 'wardrobe'
 if kind=='chest':return 'nightstand' if w<700 and h<800 else 'dresser'
 if kind=='cabinet':return 'linen-cabinet' if h>1400 else 'dresser'
 if kind=='shelf':return 'bookcase' if h>1200 else None
 if kind=='kitchen-storage':return 'kitchen-hutch' if h>=1400 else None
 if kind=='kitchen-sink':return 'butler-sink' if h>=600 else None
 if kind=='refrigerator':return 'icebox'
 if kind=='bathtub':return 'bathtub'
 if kind=='vanity':return 'washstand' if h>=600 else None
 if kind=='toilet':return 'toilet'
 if kind=='rug':return 'rug'
 if kind=='curtain':return 'curtain' if h>=1800 and w>=1200 else None
 if kind=='plant':return 'planter' if h>=800 else None
 if kind=='mirror':return 'mirror' if h>=700 else None
 return None
pairs=[];retained=[];coverage=collections.defaultdict(lambda:{'standardCount':0,'mappedCount':0,'rpgTargets':set()})
for i in legacy.values():
 tag=tags['items'].get(i['id'],{});kind=tag.get('kind','unclassified');cat=coverage[kind];cat['standardCount']+=1;slug=target(i,tag);tid='rpg-mansion-'+str(slug)+'-01'
 reason=None
 if tag.get('mount') not in ['floor',None] and kind not in ['mirror','curtain','rug']:reason='壁付・天井付など設置方法が異なるため保持'
 if kind=='sofa' and (i.get('d',0)>1050 or i.get('w',0)>2600 or i.get('h',0)<550):reason='L字・寝椅子・低い腰掛けなどの形状を確定できないため保持'
 if kind=='chair' and (i.get('w',0)>700 or i.get('d',0)>750 or i.get('h',0)<650):reason='ベンチ・腰掛け・肘掛けの形状差を確定できないため保持'
 if kind=='bed' and i.get('h',0)>1400:reason='多段・収納一体型などの形状を確定できないため保持'
 if kind=='refrigerator':reason='冷蔵設備の機能を保冷庫へ置換しないため保持'
 if kind in ['closet','cabinet','chest','kitchen-storage'] and (i.get('w',0)>1800 or i.get('d',0)>850):reason='複合・コーナー収納などの形状を確定できないため保持'
 if reason:retained.append({'sourceId':i['id'],'reason':reason});continue
 if not slug or tid not in targets:continue
 # Source nominal geometry must also remain plausible at retained dimensions.
 dst=targets[tid]
 if any(i.get(k,0)/dst[k]<.25 or i.get(k,0)/dst[k]>4 for k in ['w','d','h']):continue
 pairs.append({'sourceId':i['id'],'targetId':tid,'kind':kind,'basis':'existing catalogue kind + dimensional role; preview required','orientation':'preserve stored rotation; visual front must be reviewed','reviewRequired':kind not in ['rug','mirror','curtain','plant'],'reviewReason':'座面・天板・寝面・棚位置や個別機能は一致未確認。初期状態では保持。'})
 cat['mappedCount']+=1;cat['rpgTargets'].add(tid)
# Native IDs are explicit contracts, not aliases that modify existing IDs.
native={'chair':'chair','sofa':'sofa','loveseat_2p':'sofa','low_table':'coffee-table','dining-table':'dining-table','dining_6':'dining-table','round_table_4':'round-table','bed-d':'canopy-bed','bed-s':'single-bed','semi_double_bed':'single-bed','desk':'desk','closet':'wardrobe','shoe_cabinet':'dresser','toilet':'toilet','sink':'washstand'}
for src,slug in native.items():pairs.append({'sourceId':src,'targetId':'rpg-mansion-'+slug+'-01','kind':'native-explicit','basis':'explicit native furniture ID','orientation':'preserve stored rotation; visual front must be reviewed','reviewRequired':True,'reviewReason':'nativeモデルの支持高さ・個別機能は一致未確認。初期状態では保持。'})
retained.append({'sourceId':'fridge','reason':'冷蔵設備の機能を保冷庫へ置換しないため保持'})
contract={'version':1,'revision':'rpg-mansion-0.2.0-v1','targetPack':'rpg-mansion','policy':{'operation':'preview then duplicate only','preserve':['object IDs','coordinates','width/depth/height','rotation','floor','elevation','flip','colour','all custom and finish fields'],'unsupported':'unchanged','finish':'matching channels render; unmatched keys remain in JSON','structure':'walls/rooms/openings unchanged','units':'millimetres','runtimeMatching':'exact source ID only','extremeScale':'retain if any axis ratio below 0.25 or above 4'},'mappings':pairs,'retained':retained}
(OUT/'conversion-map.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n')
result={'base':'2ca9d766390bb89979c4e8202145a09cde10eb95','standardModels':len(legacy),'rpgModels':len(targets),'mappedStandardIDs':len(pairs)-len(native),'nativeMappings':len(native),'automaticMappings':sum(not p['reviewRequired'] for p in pairs),'reviewRequiredMappings':sum(p['reviewRequired'] for p in pairs),'explicitRetainedReasons':len(retained),'categories':{k:{**v,'rpgTargets':sorted(v['rpgTargets'])} for k,v in sorted(coverage.items())},'notEquivalent':'ID coverage is not one-to-one visual equivalence; preview and manual review required.'}
(ROOT/'tools/assets/rpg-pack-contract/expansion-evidence').mkdir(parents=True,exist_ok=True)
(ROOT/'tools/assets/rpg-pack-contract/expansion-evidence/catalogue-inventory.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='categories'}))

# Synchronous trusted allow-list: validates imported height metadata before first render.
runtime={'revision':contract['revision'],'mappings':[{'sourceId':r['sourceId'],'targetId':r['targetId'],'native':r['kind']=='native-explicit'} for r in pairs]}
(ROOT/'assets/js/asset-pack-conversion-contract.js').write_text('/* Generated from conversion-map.json by build_conversion_map.py. */\n(function(root){const contract='+json.dumps(runtime,separators=(',',':'))+';for(const row of contract.mappings)Object.freeze(row);Object.freeze(contract.mappings);Object.freeze(contract);if(typeof module!=="undefined")module.exports=contract;root.AssetPackConversionContract=contract;})(typeof window==="undefined"?globalThis:window);\n')
