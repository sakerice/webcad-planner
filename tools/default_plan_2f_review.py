"""Keep review 23's design, then resolve exact joints and usable openings."""
from default_plan_review import apply_patch_file, finish_raised_floors
from default_plan_site import consolidate_site


def apply_review_23(plan):
    apply_patch_file(plan, 'default_plan_2f_review_23.json')
    items={i['id']:i for i in plan['items']}
    walls={i['id']:i for i in plan['walls']}
    rooms={i['id']:i for i in plan['rooms']}
    walls[1068]['y2']=7280
    walls[1069].update(x1=7280,x2=7280,y1=5460,y2=7280)
    walls[1070]['y2']=4550
    walls[1074].update(x1=6370,x2=8190,y1=5460,y2=5460)
    walls[1075].update(x1=7280,x2=8190,y1=4550,y2=4550)
    rooms['r1080'].update(x=6370,y=3640,w=910,d=1820)
    rooms['r1082'].update(x=7280,y=5460,w=910,d=1820,n='トイレ')
    rooms['r1083'].update(x=7280,y=3640,w=910,d=910)
    rooms['rm1239'].update(x=6370,y=5460,w=910,d=1820,texture='wood_oak')
    rooms['rm1242'].update(x=7280,y=4550,w=910,d=910)
    def center(i,x,y,**kw):
        it=items[i];it.update(x=x-it['w']/2,y=y-it['d']/2,**kw)
    center(1087,7735,5460)
    center(1241,7280,4100)
    # Reach-in closet: two fronts on the bedroom wall. Preserve the user's
    # south-facing headboard, give its east side a usable 650 mm aisle.
    center(1240,6370,5950)
    center(1088,6370,6830)
    items[1178]['x']=4060
    items[1181].update(type="fmp-Table37",w=304,d=304)
    center(1181,3860,6920,rot=180)
    center(1182,3860,6920,elev=384)
    # Four deck modules meet exactly; the user's doubled depth stays.
    items[1122]['x']=3050
    items[1228].update(x=3050,y=8180)
    items[1229].update(x=450,y=8180)
    center(1123,150,8230)
    # Inspection access beside the car, outside its parking footprint.
    items[1139].update(x=4620,y=10500)
    # Use the north setback already within this parcel to gain a usable
    # parking-side aisle; preserve every interior relation and the 1.8m deck.
    for wall in plan['walls']:
        wall['y1']-=600;wall['y2']-=600
    for room in plan['rooms']:
        room['y']-=600
    fixed_types={'site-rect','fence','tree','car','bicycle','bicycle-fold',
                 'road','neighbor-house','neighbor-building','note','ruler'}
    fixed_ids={1112,1113,1117,1120,1138,1139,1230,1233,1234,1235,1236,1237}
    for item in plan['items']:
        if item['type'] not in fixed_types and item['id'] not in fixed_ids:
            item['y']-=600
    items[1120]['y']-=600
    items[1120]['d']+=600
    # West-facing parallel parking: the house-side aisle is the driver side.
    items[1124]['rot']=90
    consolidate_site(plan)
    finish_raised_floors(plan)
    return plan


def apply_joint_fixes(plan):
    """受領した plan 25 に残っていた、手で置いた跡の3か所を通り芯へ戻す。

    間取り(部屋の並び・家具・仕上げ)は一切変えない。動かすのは、モジュール線
    y=3040 と壁芯 x=6370 から数十mmだけ外れていた点。ずれの量と向きが
    ドラッグの取りこぼしと一致し、設計判断ではないと見て直す。

    描画側は建具を最寄りの壁へ寄せて描くので画面には出ていなかったが、
    データとしては壁が開口を横切ったままで、ユーザーがこの建具に触れた
    瞬間に壁との関係が崩れる。
    """
    walls={w['id']:w for w in plan['walls']}
    rooms={r['id']:r for r in plan['rooms']}
    items={i['id']:i for i in plan['items']}

    # 壁1014(x=7280)の南端が、直交する壁1016の芯(y=3040)を厚みの半分
    # 行き過ぎていた。交差部は芯で止めれば出隅の延長が埋めるので、
    # 60mm 伸ばすとかえって段差になる。
    walls[1014]['y2']=3040

    # 階段室(-600..3090)とホール(3070..4860)が 910×20mm 重なっていた。
    # 階段アイテム1056の下端が y=3040 なので、ここが本来の境界線。
    # 揃えると階段室は4モジュール(3640)、ホールは2モジュール(1820)になる。
    rooms['r1027']['d']=3640
    rooms['r1030']['y']=3040
    rooms['r1030']['d']=1820

    # ダイニングとホールをつなぐ開き戸1243が、壁1013の芯(x=6370)から
    # 136mm東にあり、しかも開口が東西向きだったため、壁が開口を254mm
    # 横切っていた。芯に乗せ、縦壁の開き戸の規約(rot=90)に合わせる。
    # この家と3階建てプランにある縦壁の door-swing は全て rot=90。
    # 他の座標と同じく整数で持つ(実数にすると差分が読みにくくなる)。
    door=items[1243]
    half=door['w']/2.0
    door['x']=int(6370-half) if float(6370-half).is_integer() else 6370-half
    door['rot']=90
    return plan
