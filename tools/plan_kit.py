#!/usr/bin/env python3
"""既定間取りを組み立てるための共通部品。

既定間取りは今後も増える/作り替える。同じ helper を各生成器へ写すと、
天井高の式のような **合っていないと不良になる値** が静かに食い違う
(実際、照明の取付高さは3か所で基準がずれて全灯が浮いていた)。
組み立ての決まりごとはここ1か所に置く。

■ 座標の約束(index.html の実装とレビューによる実証)
  - 単位は mm。+x が東、+y が南
  - アイテムの rot は「正面が向く方角」: 0=北(-y) / 90=東(+x) /
    180=南(+y) / -90=西(-x)。壁付け家具は壁に背を向ける向きにする
  - 直進階段 rot=0 は北端が最下段。rot=180 で南から北へ上る
  - 廻りコーナー rot=0 は右回り東抜け(西抜けは flipX)
  - 外階段/スロープ rot=0 は北端が低い
  - 建具の flipY=False は +y(南)側へ開く
  - window-door は doorOpenState 未指定だと「開」で描画される

■ 高さの基準(取り違えると必ず浮くか埋まる)
  部屋の天井高 … 床スラブ**下端**から / アイテムの elev … 床**仕上げ面**から
  天井面のメッシュ … さらに仕上げ厚ぶん下
  → 天井付けの器具は ceiling_elev() を通すこと
"""
import json


M = 910             # 1モジュール(半間=455 / 1間=910)
WALL_T = 120
FLOOR_H_MM = 2700       # 階高
SLAB_MM = 180           # 2階以上の床スラブ
CEILING_FINISH_MM = 12  # 天井仕上げ面の厚み(index.html の CEILING_FINISH_M)

# サッシの呼称 → 開口幅(mm)。頭の F は FIX。
WIN_W = {"02607": 260, "03613": 405, "06905": 690, "07409": 780,
         "11909": 1235, "16509": 1690, "16511": 1690, "16513": 1690,
         "16520": 1690, "25620": 2600,
         "F03613": 405, "F06013": 600, "F11913": 1235, "F16503": 1690}

DOOR_DEPTH = {"door-swing": None, "door-swing-s": None, "door-fold": 420,
              "door-fold-w": 420, "door-slide": 150, "door-slide-s": 150,
              "door-pocket": 150, "door-front": 200, "door-opening": 160,
              "door-opening-arch": 160}

LIGHT_SPEC = {"ceiling": (450, 0.56, 5600), "down": (180, 0.72, 4400)}


def load_catalog(root, rels=None):
    """{モデルID: (w, d, h)}。家具の寸法はカタログが持ち主。"""
    import os
    rels = rels or ("assets/models/furniture_mega/manifest.json",
                    "assets/models/interior_model_0_26_1/manifest.json",
                    "assets/models/custom/manifest.json")
    cat = {}
    for rel in rels:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
        for i in (m.get("items") or m):
            cat[i["id"]] = (i.get("w"), i.get("d"), i.get("h"))
    return cat


class Plan(object):
    def __init__(self, catalog=None, wall_color="#888888",
                 interior_color="#EFEDE7", interior_texture="wall_int",
                 first_id=1000):
        self.catalog = catalog or {}
        self.walls, self.rooms, self.items = [], [], []
        self._id = first_id
        self.wall_color = wall_color
        self.interior_color = interior_color
        self.interior_texture = interior_texture

    def nid(self):
        self._id += 1
        return self._id

    # ── 躯体 ────────────────────────────────────────────────
    def wall(self, x1, y1, x2, y2, floor, **kw):
        # 内装は壁1枚ごとに持たせる。interiorWallSettings の whole/floor を
        # linked にすると全部の壁が同じ仕上げに固定され、アクセント壁を1枚も
        # 作れなくなる(解決順が linked → wall.interiorColor だから)。
        w = {"id": self.nid(), "x1": x1, "y1": y1, "x2": x2, "y2": y2,
             "floor": floor, "thick": WALL_T, "color": self.wall_color,
             "texture": None, "texScale": 1,
             "interiorColor": self.interior_color,
             "interiorTexture": self.interior_texture, "locked": False}
        w.update(kw)
        self.walls.append(w)
        return w

    def room(self, n, x, y, w, d, floor, texture=None, **kw):
        r = {"id": "r%d" % self.nid(), "type": "room", "x": x, "y": y,
             "w": w, "d": d, "floor": floor, "n": n,
             "sScale": 1, "sX": 0, "sY": 0, "locked": False}
        if texture:
            r["texture"] = texture
        r.update(kw)
        self.rooms.append(r)
        return r

    def item(self, t, cx, cy, w, d, floor, rot=0, color=None, locked=False, **kw):
        """中心座標で配置する。家具モデルの w,d はカタログ値で上書きする。

        3D側は高さをカタログ固定のまま w,d だけ引き伸ばすので、カタログと違う
        寸法を書くと「背は同じで横に太った家具」になる。引数は配置意図の記録用。
        """
        if t in self.catalog and (t.startswith("fmp-") or t.startswith("im0261-")):
            cw, cd, _h = self.catalog[t]
            if cw and cd:
                if abs(w - cd) + abs(d - cw) < abs(w - cw) + abs(d - cd):
                    cw, cd = cd, cw
                w, d = cw, cd
        it = {"id": self.nid(), "type": t,
              "x": round(cx - w / 2, 2), "y": round(cy - d / 2, 2),
              "w": w, "d": d, "rot": rot, "floor": floor,
              "flipX": False, "flipY": False, "sScale": 1, "sX": 0, "sY": 0}
        if color is not None:
            it["color"] = color
            it["colorCustom"] = True
        else:
            it["color"] = None
            it["colorCustom"] = False
        if locked:
            it["locked"] = True
        it.update(kw)
        self.items.append(it)
        return it

    # ── 建具 ────────────────────────────────────────────────
    def win(self, cx, cy, floor, std, sill, height, vertical=False,
            kind="sliding", sash_color="#1c1c1c"):
        ww = WIN_W[std]
        t = "window-door" if std in ("16520", "25620") else "window"
        dd = 180 if t == "window-door" else 150
        kw = {}
        if t == "window-door":
            kw["doorOpenState"] = "closed"   # 未指定だと開いた状態で描画される
        return self.item(t, cx, cy, ww, dd, floor, rot=90 if vertical else 0,
                         color="#000000", windowStd=std, windowKind=kind,
                         windowSill=sill, windowHeight=height,
                         sashColor=sash_color, **kw)

    def door(self, t, cx, cy, w, floor, vertical=False, color=None,
             flipY=False, **kw):
        depth = DOOR_DEPTH[t]
        if depth is None:
            depth = w                       # 開き戸は開口幅ぶんの円弧を持つ
        base = {"doorHeight": 2330 if t == "door-front" else 2000,
                "doorOpenState": "closed"}
        base.update(kw)
        it = self.item(t, cx, cy, w, depth, floor, rot=90 if vertical else 0,
                       color=color or ("#f8d0a0" if t == "door-front" else "#f8e8c0"),
                       **base)
        it["flipY"] = flipY
        return it

    # ── 高さ ────────────────────────────────────────────────
    def ceiling_elev(self, floor, cx, cy):
        """天井仕上げ面の高さ(mm)。**その階の床仕上げ面から測る** = elev と同じ基準。

        天井付けの器具はここに合わせる。基準がずれていたのが「天井から浮く/
        天井裏に埋まる」原因だった。index.html の ceilingFinishElevationMm と
        同じ値になること。食い違いは lint の check33 が止める。
        """
        slab = 0 if floor <= 1 else SLAB_MM
        h = FLOOR_H_MM
        for r in self.rooms:
            if r["floor"] != floor:
                continue
            if not (r["x"] <= cx <= r["x"] + r["w"]
                    and r["y"] <= cy <= r["y"] + r["d"]):
                continue
            c = r.get("ceiling") or {}
            if c.get("type") == "void":
                to = max(floor + 1, int(c.get("toFloor") or floor + 1))
                h = (to - floor + 1) * FLOOR_H_MM
            break
        return h - slab - CEILING_FINISH_MM

    def ceiling_mounted(self, t, cx, cy, floor, **kw):
        """天井に付ける器具(モデル)を、上端が天井面に来る高さで置く。

        モデルは「原点から上へ h」で作ってあるので、アプリはその **底面** を
        floorTopY+elev に置く。よって elev は 天井面 - モデル高。
        """
        h = (self.catalog.get(t) or (None, None, None))[2] or 0
        return self.item(t, cx, cy, kw.pop("w", 0), kw.pop("d", 0), floor,
                         elev=self.ceiling_elev(floor, cx, cy) - h, **kw)

    def light(self, kind, cx, cy, floor, elev=None, shadow=False,
              color="#fff6dd"):
        if elev is None:
            elev = self.ceiling_elev(floor, cx, cy)  # 既定は天井面(直付け/埋込)
        size, inten, rng = LIGHT_SPEC[kind]
        return self.item("light-%s" % kind, cx, cy, size, size, floor,
                         elev=elev, color=color, lightKind=kind,
                         lightShape="point", lightColor=color,
                         lightIntensity=inten, lightRange=rng,
                         lightAngle=64, lightCastShadow=shadow)

    # ── 書き出し ────────────────────────────────────────────
    def dump(self, path, **plan_fields):
        plan = {"walls": self.walls, "rooms": self.rooms, "items": self.items}
        plan.update(plan_fields)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=1)
        print("wrote %s  walls=%d rooms=%d items=%d"
              % (path, len(self.walls), len(self.rooms), len(self.items)))
        return plan


def wall_setting(color, texture):
    return {"color": color, "texture": texture,
            "textureFlipX": False, "textureFlipY": False}


def finish_cascade(base_color, base_texture, floors=(1, 2, 3, 4), walls=None):
    """外装/内装のカスケード。whole と floors は linked=False で持つ。

    linked=True にすると全部の壁が同じ仕上げに固定され、アクセント壁を
    1枚も作れなくなる(解決順が linked → wall.interiorColor だから)。
    """
    one = wall_setting(base_color, base_texture)
    return {"whole": dict(one, linked=False),
            "floors": {str(f): dict(one, linked=False) for f in floors},
            "walls": walls or {},
            "faces": {}}
