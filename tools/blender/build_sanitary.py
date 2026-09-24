"""水まわりの設備(浴槽・便器・洗面化粧台)を組み立てる。

作る約束(座標・原点・正面・UV・面数・登録)は tools/blender/README.md の
「カタログのモデルを作るときの約束」。検査は model_kit.run() が全点に掛ける。

  Blender --background --factory-startup --python tools/blender/build_sanitary.py [-- --no-icons]

■ なぜ作り直したのか
  カタログの浴槽12点・便器7点・洗面化粧台15点は、**寸法が日本の住宅の
  ものではない**。便器は7点とも実寸から外れ(最大 371x572、標準は 380x680)、
  1坪UBの 1600x750 の湯船は1点も無かった。詳細は docs/catalogue-gap.md。

■ 寸法(mm。manifest の w/d/h と一対一)
  original-bathtub 1600x750x600   1坪ユニットバス(1616)の湯船
  original-toilet   390x700x800   タンク付き洋風便器(コンパクト)
  original-vanity   750x505x1850  洗面化粧台 + 三面鏡(間口750)

  陶器は「接地部→膨らみ→丸い縁→内鉢」まで頂点を共有した1枚の殻で作る。
  **箱の上面を開けただけでは、厚みゼロの紙に見える。**
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403


def build_bathtub():
    clear_scene()
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0
    ceramic = matp('White glazed ceramic', '#f5f5f2', rough=0.19)
    apron = matp('White satin apron', '#eeefed', rough=0.29)
    chrome = matp('Brushed chrome drain', '#bdc3c9', rough=0.23, metal=0.92)
    seal = matp('Drain seal', '#454b50', rough=0.48)

    # Width, depth, corner radius, height in metres. 10 segments per corner.
    # Cardinal endpoints really reach +/- .800, +/- .375; bottom is exactly 0.
    profile = [
        (1.464, .614, .142, .000),
        (1.476, .626, .148, .004),
        (1.482, .632, .151, .012),
        (1.486, .636, .153, .026),
        (1.564, .714, .170, .536),
        (1.568, .718, .172, .548),
        # Rounded underside of the substantial 40 mm lip.
        (1.584, .734, .172, .552),
        (1.596, .746, .178, .558),
        (1.600, .750, .180, .566),
        (1.600, .750, .180, .586),
        (1.596, .746, .178, .594),
        (1.588, .738, .174, .598),
        (1.580, .730, .170, .600),
        # 95 mm overall rim on all four sides; flat sitting surface.
        (1.438, .588, .113, .600),
        (1.424, .574, .106, .598),
        (1.414, .564, .101, .593),
        (1.410, .560, .100, .585),
        (1.404, .554, .103, .565),
        (1.374, .524, .117, .490),
        (1.228, .414, .142, .192),
        (1.202, .394, .142, .165),
        (1.176, .368, .137, .148),
        (1.150, .342, .128, .140),
        (1.130, .322, .120, .138),
    ]
    rings = [rounded_rect(0, 0, w, d, r, z, n=10) for w,d,r,z in profile]
    obj = shell('original-bathtub', rings, [ceramic, apron],
                [1 if i < 5 else 0 for i in range(len(rings)-1)])

    # Low pop-up waste fitting: bevel, thin dark gasket, flat metal top.
    drain_rings = []
    for radius, z in ((.030,.1382), (.032,.139), (.032,.141),
                      (.029,.142), (.028,.145), (.025,.147)):
        drain_rings.append([(0.43+radius*math.cos(i*math.tau/32),
                             -.025+radius*math.sin(i*math.tau/32), z)
                            for i in range(32)])
    drain = shell('Pop up waste fitting', drain_rings, [chrome, seal], [1,1,0,0,0])
    join(obj, [drain])
    obj.location = (0,0,0)
    bpy.context.view_layer.update()
    return obj


def build_toilet():
    ceramic = matp('Toilet ceramic', '#f7f7f5', rough=.14)
    seat = matp('Toilet seat', '#f2f1ee', rough=.30)
    metal = matp('Toilet fitting', '#b9bcc0', rough=.25, metal=.9)
    # One continuous ceramic shell: foot -> belly -> rolled lip -> inner well.
    parts = [profile('Toilet ceramic shell', [
        (.210,.290,.090,0), (.222,.302,.096,.008),
        (.226,.310,.100,.025), (.222,.310,.100,.100),
        (.260,.365,.120,.210), (.340,.435,.150,.310),
        (.380,.474,.165,.365), (.390,.480,.170,.390),
        (.386,.476,.169,.400), (.338,.426,.146,.400),
        (.326,.414,.142,.393), (.300,.390,.132,.365),
        (.190,.265,.088,.258), (.164,.230,.078,.245),
    ], ceramic, cy=-.110)]
    parts.append(profile('Toilet tank', [
        (.326,.184,.028,.380), (.350,.210,.040,.392),
        (.360,.220,.045,.416), (.360,.220,.045,.756),
        (.352,.212,.041,.770),
    ], ceramic, cy=.240))
    parts.append(profile('Toilet tank lid', [
        (.350,.210,.038,.772), (.360,.220,.043,.780),
        (.356,.216,.041,.793), (.342,.202,.036,.800),
    ], ceramic, cy=.240))
    # Separate rounded seat and closed lid, with a visible 3 mm shadow gap.
    parts.append(profile('Toilet seat', [
        (.358,.448,.157,.403), (.378,.468,.167,.409),
        (.378,.468,.167,.421), (.366,.456,.161,.427),
    ], seat, cy=-.110))
    parts.append(profile('Toilet closed lid', [
        (.362,.452,.159,.430), (.378,.468,.167,.435),
        (.374,.464,.165,.444), (.350,.440,.153,.450),
    ], seat, cy=-.110))
    parts.append(box('Toilet flush lever', (.110,.109,.692), (.169,.131,.708), metal, .006))
    return combine(parts)


def build_vanity():
    counter = matp('Vanity counter', '#f2f1ee', rough=.20)
    door = matp('Vanity door', '#e7e2d9', rough=.55)
    door['finishChannel'] = 'door'
    mirror = matp('Vanity mirror', '#dfe4e6', rough=.05, metal=.95)
    metal = matp('Vanity fitting', '#b9bcc0', rough=.25, metal=.9)
    parts = [box('Vanity toe kick', (-.355,-.1395,0), (.355,.2525,.08), door),
             # Hollow cabinet: a solid old cabinet would fill the basin cavity.
             box('Vanity left side', (-.375,-.2195,.08), (-.357,.2525,.778), door),
             box('Vanity right side', (.357,-.2195,.08), (.375,.2525,.778), door),
             box('Vanity back', (-.357,.2345,.08), (.357,.2525,.778), door),
             box('Vanity floor', (-.357,-.2195,.08), (.357,.2345,.10), door)]
    for a, b in ((-.363,-.004), (.004,.363)):
        parts.append(box('Vanity door', (a,-.2365,.10), (b,-.2195,.760), door, .003))
        x = -.055 if b < 0 else .055
        parts.append(box('Vanity handle', (x-.006,-.2505,.20), (x+.006,-.2365,.52), metal, .005))
    # Underside is below the bowl floor; no coplanar closing cap across the bowl.
    parts.append(profile('Vanity integral basin', [
        (.714,.469,.035,.630), (.730,.485,.030,.650),
        (.744,.499,.032,.778), (.750,.505,.035,.786),
        (.750,.505,.035,.792), (.742,.497,.031,.800),
        (.464,.334,.110,.800), (.446,.316,.101,.795),
        (.438,.308,.098,.783), (.412,.282,.094,.748),
        (.324,.210,.078,.670), (.300,.190,.070,.660),
    ], counter))
    parts.append(cylinder('Vanity drain', (0,0,.662), .022,.004, metal))
    parts.append(cylinder('Vanity faucet base', (0,.1825,.811), .026,.022, metal))
    parts.append(box('Vanity faucet stem', (-.017,.165,.817), (.017,.200,.987), metal, .012))
    parts.append(box('Vanity faucet spout', (-.017,-.004,.962), (.017,.199,1.000), metal, .013))
    parts.append(box('Vanity mixer lever', (-.011,.100,1.005), (.011,.192,1.015), metal, .004))
    parts.append(box('Vanity mirror case', (-.375,.1025,.950), (.375,.2525,1.850), counter, .008))
    edges = (-.375,-.125,.125,.375)
    for a, b in zip(edges, edges[1:]):
        parts.append(box('Vanity mirror panel', (a+.008,.0905,.980), (b-.008,.0965,1.820), mirror, .002, 2))
    return combine(parts)


if __name__ == '__main__':
    run([('original-bathtub', (1600, 750, 600), build_bathtub),
         ('original-toilet', (390, 700, 800), build_toilet),
         ('original-vanity', (750, 505, 1850), build_vanity, 'door')])
