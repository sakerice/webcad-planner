import json
import sys
from pathlib import Path

sys.path.insert(0, "/private/tmp/pdfdeps")
from PIL import Image, ImageChops


SOURCE = Path("/private/tmp/generated_floorplan_sprite_keyed.png")
ASSETS = Path("/Users/nariiwa/Documents/GitHub/webcad-planner/assets")
OUT = ASSETS / "japanese_floorplan_parts_sprite_gpt.png"
PREVIEW = ASSETS / "japanese_floorplan_parts_sprite_gpt_preview.png"
META = ASSETS / "japanese_floorplan_parts_sprite_gpt.json"

COLS = 5
ROWS = 3
CELL = 512

NAMES = [
    ("toilet", "fixture"),
    ("bed", "furniture"),
    ("sink", "fixture"),
    ("tv", "furniture"),
    ("bathtub", "fixture"),
    ("car", "exterior"),
    ("sofa", "furniture"),
    ("kitchen", "fixture"),
    ("fridge", "appliance"),
    ("dining", "furniture"),
    ("wood_floor", "texture"),
    ("stone", "texture"),
    ("tree", "exterior"),
    ("tile_floor", "texture"),
    ("grass", "texture"),
]


def chroma_to_alpha(img):
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > 160 and b > 145 and g < 120 and abs(r - b) < 95:
                px[x, y] = (255, 0, 255, 0)
            elif r > 105 and b > 95 and g < 110 and abs(r - b) < 90:
                # Feather antialiased magenta edges and despill the keyed color.
                alpha = max(0, min(210, int((g / 110) * 210)))
                neutral = max(g, min(120, int((r + b + g) / 4)))
                px[x, y] = (neutral, g, neutral, alpha)
    return img


def trim_transparent(img, pad=20):
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


def fit_cell(img):
    img = trim_transparent(img)
    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    scale = min((CELL - 56) / img.width, (CELL - 56) / img.height)
    nw = max(1, int(img.width * scale))
    nh = max(1, int(img.height * scale))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((CELL - nw) // 2, (CELL - nh) // 2))
    return canvas


def main():
    src = Image.open(SOURCE).convert("RGBA")
    sw, sh = src.size
    sheet = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    preview = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (248, 248, 244, 255))

    meta = {
        "image": OUT.name,
        "source": SOURCE.name,
        "cell": CELL,
        "columns": COLS,
        "rows": ROWS,
        "sprites": {},
        "style": {
            "description": "AI-generated polished top-down Japanese residential floor-plan parts",
            "transparentBackground": True,
        },
    }

    for idx, (name, kind) in enumerate(NAMES):
        col = idx % COLS
        row = idx // COLS
        x1 = round(col * sw / COLS) + 4
        x2 = round((col + 1) * sw / COLS) - 4
        y1 = round(row * sh / ROWS) + 4
        y2 = round((row + 1) * sh / ROWS) - 4
        crop = src.crop((x1, y1, x2, y2))
        cleaned = fit_cell(chroma_to_alpha(crop))
        dx = col * CELL
        dy = row * CELL
        sheet.alpha_composite(cleaned, (dx, dy))
        preview.alpha_composite(cleaned, (dx, dy))
        meta["sprites"][name] = {
            "x": dx,
            "y": dy,
            "w": CELL,
            "h": CELL,
            "kind": kind,
            "pivot": [CELL / 2, CELL / 2],
        }

    sheet.save(OUT)
    preview.save(PREVIEW)
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUT)
    print(PREVIEW)
    print(META)


if __name__ == "__main__":
    main()
