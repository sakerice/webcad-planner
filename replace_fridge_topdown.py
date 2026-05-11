import sys
from pathlib import Path

sys.path.insert(0, "/private/tmp/pdfdeps")
from PIL import Image


ASSETS = Path("/Users/nariiwa/Documents/GitHub/webcad-planner/assets")
FRIDGE_SOURCE = Path("/private/tmp/fridge_topdown_keyed.png")
SPRITE = ASSETS / "japanese_floorplan_parts_sprite_gpt.png"
PREVIEW = ASSETS / "japanese_floorplan_parts_sprite_gpt_preview.png"

CELL = 512
FRIDGE_X = 1536
FRIDGE_Y = 512


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
    scale = min((CELL - 72) / img.width, (CELL - 96) / img.height)
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((CELL - resized.width) // 2, (CELL - resized.height) // 2))
    return canvas


def replace_in(path, background=None):
    sheet = Image.open(path).convert("RGBA")
    if background is None:
        patch_bg = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    else:
        patch_bg = Image.new("RGBA", (CELL, CELL), background)
    patch_bg.alpha_composite(fit_cell(Image.open(FRIDGE_SOURCE)))
    sheet.paste(patch_bg, (FRIDGE_X, FRIDGE_Y))
    sheet.save(path)


def main():
    replace_in(SPRITE)
    replace_in(PREVIEW, (248, 248, 244, 255))
    print(SPRITE)
    print(PREVIEW)


if __name__ == "__main__":
    main()
