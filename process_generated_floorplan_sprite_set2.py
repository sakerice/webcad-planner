import json
import sys
from pathlib import Path

sys.path.insert(0, "/private/tmp/pdfdeps")
from PIL import Image, ImageDraw, ImageFilter


SOURCE = Path("/private/tmp/floorplan_parts_set2_keyed.png")
ASSETS = Path("/Users/nariiwa/Documents/GitHub/webcad-planner/assets")
OUT = ASSETS / "japanese_floorplan_parts_sprite_gpt_2.png"
PREVIEW = ASSETS / "japanese_floorplan_parts_sprite_gpt_2_preview.png"
META = ASSETS / "japanese_floorplan_parts_sprite_gpt.json"

COLS = 5
ROWS = 3
CELL = 512

NAMES = [
    ("loveseat_2p", "furniture"),
    ("low_table", "furniture"),
    ("armchair_1p", "furniture"),
    ("dining_6", "furniture"),
    ("round_table_4", "furniture"),
    ("desk", "furniture"),
    ("closet_pole", "storage"),
    ("double_bed_alt", "furniture"),
    ("semi_double_bed", "furniture"),
    ("shoe_cabinet", "storage"),
    ("washer", "appliance"),
    ("desk_chair", "furniture"),
    ("chest_drawers", "storage"),
    ("futon_set", "furniture"),
    ("storage_boxes", "storage"),
]

INK = (42, 45, 43, 255)
SOFT = (92, 88, 78, 255)
WOOD = (185, 122, 61, 255)
WOOD_LIGHT = (219, 162, 91, 255)
CERAMIC = (245, 248, 247, 255)


def scaled_canvas():
    return Image.new("RGBA", (CELL * 3, CELL * 3), (0, 0, 0, 0))


def S(v):
    return int(round(v * 3))


def line(d, pts, fill=INK, width=4):
    d.line([(S(x), S(y)) for x, y in pts], fill=fill, width=S(width), joint="curve")


def rect(d, box, fill=None, outline=INK, width=4, radius=0):
    box = tuple(S(v) for v in box)
    if radius:
        d.rounded_rectangle(box, radius=S(radius), fill=fill, outline=outline, width=S(width))
    else:
        d.rectangle(box, fill=fill, outline=outline, width=S(width))


def ellipse(d, box, fill=None, outline=INK, width=4):
    d.ellipse(tuple(S(v) for v in box), fill=fill, outline=outline, width=S(width))


def woodgrain(d, box, seed=1, count=32):
    import math
    import random

    random.seed(seed)
    x1, y1, x2, y2 = box
    for _ in range(count):
        y = random.uniform(y1, y2)
        phase = random.uniform(0, math.tau)
        pts = []
        for i in range(18):
            x = x1 + (x2 - x1) * i / 17
            pts.append((x, y + math.sin(i * 0.9 + phase) * random.uniform(1.0, 4.0)))
        line(d, pts, (125, 76, 35, 55), 1)


def custom_closet_pole():
    img = scaled_canvas()
    d = ImageDraw.Draw(img, "RGBA")
    rect(d, (56, 142, 456, 370), fill=(248, 244, 232, 255), width=5, radius=8)
    rect(d, (76, 162, 436, 350), fill=(230, 216, 188, 255), outline=(135, 112, 80, 255), width=3, radius=5)
    line(d, [(106, 216), (406, 216)], (88, 84, 77, 255), 7)
    for x in range(128, 392, 38):
        line(d, [(x, 216), (x - 18, 274), (x + 18, 274), (x, 216)], (64, 66, 62, 220), 3)
        rect(d, (x - 22, 274, x + 22, 320), fill=(210, 205, 194, 210), outline=(87, 84, 76, 210), width=2, radius=6)
    rect(d, (92, 176, 420, 198), fill=(190, 145, 86, 170), outline=(105, 78, 44, 180), width=2, radius=3)
    woodgrain(d, (92, 176, 420, 198), seed=25, count=10)
    return img.resize((CELL, CELL), Image.Resampling.LANCZOS)


def custom_shoe_cabinet():
    img = scaled_canvas()
    d = ImageDraw.Draw(img, "RGBA")
    rect(d, (74, 168, 438, 344), fill=WOOD_LIGHT, width=5, radius=6)
    rect(d, (92, 184, 420, 328), fill=(198, 132, 70, 255), outline=(98, 64, 35, 255), width=3, radius=4)
    line(d, [(256, 184), (256, 328)], (92, 62, 36, 190), 4)
    for y in [224, 270]:
        line(d, [(102, y), (410, y)], (92, 62, 36, 120), 2)
    for x in [236, 276]:
        ellipse(d, (x - 5, 252, x + 5, 262), fill=(70, 55, 42, 255), outline=None, width=0)
    woodgrain(d, (92, 184, 420, 328), seed=33, count=32)
    return img.resize((CELL, CELL), Image.Resampling.LANCZOS)


def custom_drum_washer():
    img = scaled_canvas()
    d = ImageDraw.Draw(img, "RGBA")
    rect(d, (110, 92, 402, 420), fill=CERAMIC, width=7, radius=26)
    rect(d, (142, 122, 370, 176), fill=(232, 237, 235, 255), outline=(126, 132, 130, 255), width=3, radius=8)
    line(d, [(130, 196), (382, 196)], (145, 151, 148, 170), 3)
    ellipse(d, (158, 218, 354, 414), fill=(226, 240, 244, 255), outline=INK, width=7)
    ellipse(d, (204, 264, 308, 368), fill=(190, 220, 228, 255), outline=(98, 108, 106, 255), width=5)
    ellipse(d, (322, 150, 340, 168), fill=(44, 47, 46, 255), outline=None, width=0)
    for x in [162, 202, 242]:
        rect(d, (x, 150, x + 22, 166), fill=(196, 204, 202, 255), outline=(126, 130, 128, 255), width=1, radius=3)
    line(d, [(130, 396), (382, 396)], (178, 184, 181, 120), 2)
    return img.resize((CELL, CELL), Image.Resampling.LANCZOS)


def custom_chest_drawers():
    img = scaled_canvas()
    d = ImageDraw.Draw(img, "RGBA")
    rect(d, (76, 152, 436, 360), fill=WOOD_LIGHT, width=5, radius=6)
    rect(d, (94, 170, 418, 342), fill=(192, 124, 62, 255), outline=(91, 60, 35, 255), width=3, radius=3)
    for y in [214, 258, 302]:
        line(d, [(100, y), (412, y)], (86, 57, 32, 135), 3)
    for x in [206, 306]:
        for y in [192, 236, 280, 324]:
            rect(d, (x - 16, y - 4, x + 16, y + 4), fill=(91, 65, 42, 180), outline=None, width=0, radius=3)
    woodgrain(d, (96, 170, 416, 342), seed=45, count=42)
    return img.resize((CELL, CELL), Image.Resampling.LANCZOS)


def custom_storage_boxes():
    img = scaled_canvas()
    d = ImageDraw.Draw(img, "RGBA")
    colors = [(219, 211, 196, 255), (198, 214, 218, 255), (226, 205, 172, 255), (211, 222, 198, 255)]
    boxes = [(90, 126, 230, 244), (254, 126, 422, 244), (86, 270, 246, 390), (274, 270, 426, 390)]
    for i, box in enumerate(boxes):
        rect(d, box, fill=colors[i], width=5, radius=10)
        x1, y1, x2, y2 = box
        rect(d, (x1 + 16, y1 + 16, x2 - 16, y2 - 16), fill=(255, 255, 255, 32), outline=(93, 96, 91, 120), width=2, radius=7)
        line(d, [(x1 + 42, (y1 + y2) / 2), (x2 - 42, (y1 + y2) / 2)], (85, 87, 84, 120), 3)
    return img.resize((CELL, CELL), Image.Resampling.LANCZOS)


CUSTOM = {
    "closet_pole": custom_closet_pole,
    "shoe_cabinet": custom_shoe_cabinet,
    "washer": custom_drum_washer,
    "chest_drawers": custom_chest_drawers,
    "storage_boxes": custom_storage_boxes,
}


def trim_alpha(img, pad=18):
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def fit_cell(img):
    img = trim_alpha(img.convert("RGBA"))
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    scale = min((CELL - 56) / img.width, (CELL - 56) / img.height)
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((CELL - resized.width) // 2, (CELL - resized.height) // 2))
    return canvas


def main():
    src = Image.open(SOURCE).convert("RGBA")
    sw, sh = src.size
    sheet = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    preview = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (248, 248, 244, 255))

    additions = {}
    for idx, (name, kind) in enumerate(NAMES):
        col = idx % COLS
        row = idx // COLS
        x1 = round(col * sw / COLS) + 5
        x2 = round((col + 1) * sw / COLS) - 5
        y1 = round(row * sh / ROWS) + 5
        y2 = round((row + 1) * sh / ROWS) - 5
        if name in CUSTOM:
            cell = CUSTOM[name]()
        else:
            cell = fit_cell(src.crop((x1, y1, x2, y2)))
        dx = col * CELL
        dy = row * CELL
        sheet.alpha_composite(cell, (dx, dy))
        preview.alpha_composite(cell, (dx, dy))
        additions[name] = {
            "image": OUT.name,
            "x": dx,
            "y": dy,
            "w": CELL,
            "h": CELL,
            "kind": kind,
            "pivot": [CELL / 2, CELL / 2],
        }

    sheet.save(OUT)
    preview.save(PREVIEW)

    meta = json.loads(META.read_text(encoding="utf-8"))
    sheets = meta.setdefault("additionalSheets", [])
    sheet_entry = {"image": OUT.name, "cell": CELL, "columns": COLS, "rows": ROWS}
    if not any(item.get("image") == OUT.name for item in sheets):
        sheets.append(sheet_entry)
    sprites = meta.setdefault("sprites", {})
    for name, data in additions.items():
        if name in sprites:
            continue
        sprites[name] = data
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(OUT)
    print(PREVIEW)
    print(META)


if __name__ == "__main__":
    main()
