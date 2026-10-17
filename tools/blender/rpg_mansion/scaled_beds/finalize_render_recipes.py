"""Bind actual final image hashes to the recipe used for each completed render."""
from pathlib import Path
import json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];items=json.loads((H/'bed-items.json').read_text())['items'];scope=json.loads((H/'coplanar-repair-scope.json').read_text());old=json.loads((H/'superseded-core18-coplanar-qa/qa-render-recipes.json').read_text());by={(r['id'],r['view']):r for r in old['items']};sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();rows=[]
for i in items:
 for k in ['thumb','top','front','rear']:
  recipe='projected-fit-v2'if i['id']in scope['ids']else by[(i['id'],k)]['recipe']
  if i['id']not in scope['ids']:assert sha(R/i[k])==by[(i['id'],k)]['imageSha256']
  rows.append(dict(id=i['id'],view=k,recipe=recipe,imageSha256=sha(R/i[k]),modelSha256=sha(R/i['model'])))
report=dict(method='All four views were freshly rendered from canonical sources for all 13 coplanar-repaired models. Five unchanged assets retain their byte-verified earlier views. Independent QA must confirm pixel replay.',sourceRecipe='tools/blender/rpg_mansion/scaled_beds/build.py:render',originalRecipeDifference='Skip the projected-fit code block after scene.camera=ob; retain original target and view-specific ortho_scale.',imageCount=72,projectedFitViews=sum(i['recipe']=='projected-fit-v2'for i in rows),items=rows,errors=[]);(H/'qa-render-recipes.json').write_text(json.dumps(report,indent=2)+'\n');print('BED_RENDER_RECIPES',report['projectedFitViews'])
