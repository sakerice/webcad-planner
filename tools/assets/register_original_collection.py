"""Register independently authored, reviewed collections without replacing legacy IDs."""
from pathlib import Path
import json,struct
R=Path(__file__).resolve().parents[2];items=[]
for source in ['original-collection.json','exterior-collection.json','entry-storage-collection.json','sanitary-collection.json']:
 items+=json.loads((R/'tools/blender'/source).read_text())['items']
for item in items:
 b=(R/item['model']).read_bytes();j=json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]])
 j['asset']['extras']=dict(j['asset'].get('extras',{}),front='+Z',up='+Y',provenance='Independently authored in Blender; no imported geometry or imagery',source=item.get('builder') or ('tools/blender/build_entry_storage.py' if item.get('mirrorOption') else 'tools/blender/build_exterior_details.py' if item.get('group')=='外構' else 'tools/blender/build_original_furniture.py'))
 raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);rest=b[20+struct.unpack_from('<I',b,12)[0]:];(R/item['model']).write_bytes(struct.pack('<III',0x46546c67,2,20+len(raw)+len(rest))+struct.pack('<II',len(raw),0x4e4f534a)+raw+rest)
 for channel in item.get('finishChannels',[]):
  m=next(m for m in j['materials'] if m.get('extras',{}).get('finishChannel')==channel['key'])
  v=m.get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1])[:3]
  channel['default']='#'+''.join(f'{round((12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055)*255):02x}' for x in v)
path=R/'assets/models/custom/manifest.json';data=json.loads(path.read_text());ids={i['id'] for i in items};data['items']=[i for i in data['items'] if i['id'] not in ids]+items
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');path.with_suffix('.js').write_text('window.CUSTOM_MODEL_MANIFEST = '+json.dumps(data,ensure_ascii=False,indent=2)+';\n')
