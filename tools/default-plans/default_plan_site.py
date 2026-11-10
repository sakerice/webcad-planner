"""One parcel, with named surface finishes inside it (local millimetres)."""
def consolidate_site(plan):
    sites = [i for i in plan['items'] if i['type'] == 'site-rect']
    if len(sites) < 2:
        return
    x0=min(i['x'] for i in sites); y0=min(i['y'] for i in sites)
    x1=max(i['x']+i['w'] for i in sites); y1=max(i['y']+i['d'] for i in sites)
    site=sites[0]
    site.update(x=x0,y=y0,w=x1-x0,d=y1-y0,siteSurface='gravel',
                name='敷地境界（土地全体）',siteBoundary=True)
    def zone(name,x,y,w,d,surface):
        return dict(name=name,x=x-x0,y=y-y0,w=w,d=d,surface=surface)
    if x1 > 10000:
        zones=[zone('プライベートテラス・植栽',-790,6680,7160,1890,'grass'),
               zone('駐車スペース',-790,8570,7160,2805,'concrete'),
               zone('玄関アプローチ・駐輪',6370,6680,3975,4695,'concrete')]
    else:
        zones=[zone('前庭・アプローチ',-790,8190,7040,2275,'concrete')]
    site['siteZones']=zones
    plan['items']=[i for i in plan['items'] if i not in sites[1:]]
