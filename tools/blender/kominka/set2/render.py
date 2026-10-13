"""Render actual saved originals using set 1's unchanged Cycles lighting.
-- --only STEM ... --samples 24; -- --compare for same-scene comparisons.
"""
import argparse,importlib.util,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parents[1]))
import model_kit as kit
spec=importlib.util.spec_from_file_location('first_render',HERE.parent/'render.py')
R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)


def main():
    p=argparse.ArgumentParser();p.add_argument('--only',nargs='+');p.add_argument('--root',type=Path,default=ROOT)
    p.add_argument('--samples',type=int,default=24);p.add_argument('--compare',action='store_true')
    p.add_argument('--views',nargs='+',default=['thumb','top','front','rear'])
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if a.compare:
        groups={
          'kitchen':['sink','sink-900','kamado','kamado-single','kitchen-counter-600'],
          'storage':['tansu','chadansu-900','chadansu-1500','oshiire','icebox'],
          'wood':['dining-table','kitchen-worktable','engawa-bench-1800','hanadai','gate-post'],
          'cloth':['sofa','curtain-long','curtain-short','sudare'],
          'bath':['hinoki-bath','washstand','washstand-small','tarai','shower','toilet'],
          'outdoor':['ishidoro','rickshaw','engawa-bench-2600','bonsai'],
          'additions':['mizuya','kitchen-counter-450','kitchen-counter-900','smoke-hood','monohoshi','ac-cover']}
        new={it['stem'] for it in json.loads((HERE/'catalogue.json').read_text())['items']}
        for group,stems in groups.items():
            kit.clear_scene();offset=0;parts=[]
            for stem in stems:
                mid='kominka-'+stem+'-01'
                source=a.root/'tools/blender/kominka'/('set2/sources' if stem in new else 'sources')/(mid+'.blend')
                with bpy.data.libraries.load(str(source),link=False) as (data_from,data_to):data_to.objects=[mid]
                o=data_to.objects[0];bpy.context.collection.objects.link(o)
                points=[v.co for v in o.data.vertices];lo=min(v.x for v in points);hi=max(v.x for v in points)
                o.location.x=offset-lo;offset+=hi-lo+.28;parts.append(o)
            o=kit.combine(parts);kit.activate(o);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
            R.render(o,a.root/'tools/blender/kominka/set2/evidence'/f'compare-{group}.jpg','thumb',a.samples)
        return
    for it in json.loads((HERE/'catalogue.json').read_text())['items']:
        if a.only and it['stem'] not in a.only:continue
        mid=it['id'];print('RENDER '+mid,flush=True)
        bpy.ops.wm.open_mainfile(filepath=str(a.root/'tools/blender/kominka/set2/sources'/f'{mid}.blend'))
        obj=bpy.data.objects[mid]
        for view in a.views:
            path=(a.root/'assets/models/packs/kominka/previews'/f'{mid}-{view}.png' if view in ('thumb','top') else
                  a.root/'tools/blender/kominka/set2/evidence'/f'{mid}-{view}.jpg')
            R.render(obj,path,view,a.samples)

if __name__=='__main__':main()
