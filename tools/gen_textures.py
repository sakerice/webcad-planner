#!/usr/bin/env python3
"""Generate PBR textures for WebCAD floor/wall/roof surfaces."""
import os, math
import numpy as np
try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("pip install Pillow"); exit(1)

OUT = "assets/textures"
os.makedirs(OUT, exist_ok=True)
SZ = 512

def save(img, name):
    img.save(os.path.join(OUT, name), quality=92)
    print(f"  {name}")

def wood_floor_diffuse():
    img = Image.new("RGB", (SZ, SZ), (200, 158, 105))
    draw = ImageDraw.Draw(img)
    pw = SZ // 4
    plank_colors = [(195,152,100),(210,168,115),(192,149,97),(205,161,108)]
    for i in range(4):
        x = i * pw
        draw.rectangle([x, 0, x+pw-2, SZ], fill=plank_colors[i])
        for y in range(0, SZ, 10):
            c = plank_colors[i]
            dark = tuple(max(0, v-25) for v in c)
            draw.line([(x+3, y), (x+pw-5, y+4)], fill=dark, width=1)
    return img.filter(ImageFilter.GaussianBlur(0.7))

def wood_floor_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    pw = SZ // 4
    for i in range(4):
        x = i * pw
        draw.line([(x, 0), (x, SZ)], fill=(90, 128, 200), width=2)
        for y in range(0, SZ, 14):
            draw.line([(x+4, y), (x+pw-4, y+3)], fill=(148, 128, 255), width=1)
    return img

def wood_floor_roughness():
    arr = np.random.normal(185, 18, (SZ, SZ, 3)).clip(155, 210).astype(np.uint8)
    return Image.fromarray(arr)

def tile_floor_diffuse():
    img = Image.new("RGB", (SZ, SZ), (242, 240, 236))
    draw = ImageDraw.Draw(img)
    tp = SZ // 4
    for x in range(0, SZ, tp):
        draw.line([(x, 0),(x, SZ)], fill=(195,193,190), width=3)
    for y in range(0, SZ, tp):
        draw.line([(0, y),(SZ, y)], fill=(195,193,190), width=3)
    return img

def tile_floor_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    tp = SZ // 4
    for x in range(0, SZ, tp):
        draw.line([(x, 0),(x, SZ)], fill=(80, 80, 200), width=4)
    for y in range(0, SZ, tp):
        draw.line([(0, y),(SZ, y)], fill=(80, 80, 200), width=4)
    return img

def tile_floor_roughness():
    arr = np.random.normal(75, 8, (SZ, SZ, 3)).clip(55, 95).astype(np.uint8)
    return Image.fromarray(arr)

def wall_siding_diffuse():
    # 明るめのガルバリウム系サイディング
    img = Image.new("RGB", (SZ, SZ), (175, 155, 130))
    draw = ImageDraw.Draw(img)
    ph = SZ // 14
    for i in range(15):
        y = i * ph
        shade = 170 + (i % 2) * 18
        draw.rectangle([0, y, SZ, y+ph-3], fill=(shade, shade-18, shade-35))
        draw.line([(0, y+ph-2),(SZ, y+ph-2)], fill=(120, 105, 85), width=2)
        draw.line([(0, y),(SZ, y)], fill=(shade+20, shade+5, shade-15), width=1)
    return img

def wall_siding_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    ph = SZ // 14
    for i in range(15):
        y = i * ph
        draw.line([(0, y),(SZ, y)], fill=(165, 128, 255), width=2)
        draw.line([(0, y+ph-3),(SZ, y+ph-3)], fill=(85, 128, 200), width=2)
    return img

def wall_plaster_diffuse():
    arr = np.random.normal(238, 3, (SZ, SZ, 3)).astype(np.float32)
    arr[:,:,0] = arr[:,:,0].clip(231, 246)
    arr[:,:,1] = (arr[:,:,1] - 2).clip(228, 244)
    arr[:,:,2] = (arr[:,:,2] - 5).clip(225, 241)
    img = Image.fromarray(arr.astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(0.4))

def roof_tile_diffuse():
    img = Image.new("RGB", (SZ, SZ), (40, 40, 45))
    draw = ImageDraw.Draw(img)
    tw, th = SZ//7, SZ//5
    for row in range(6):
        for col in range(8):
            ox = col*tw + (row % 2)*(tw//2) - tw//4
            oy = row*th
            shade = 38 + (row*col) % 10
            draw.ellipse([ox, oy, ox+tw, oy+th], fill=(shade, shade, shade+5),
                         outline=(58, 58, 65), width=1)
    return img

def roof_tile_normal():
    img = Image.new("RGB", (SZ, SZ), (128, 128, 255))
    draw = ImageDraw.Draw(img)
    tw, th = SZ//7, SZ//5
    for row in range(6):
        for col in range(8):
            ox = col*tw + (row % 2)*(tw//2) - tw//4
            oy = row*th
            for dy in range(th):
                t = dy / th
                r = int(115 + 40*(1 - abs(2*t - 1)))
                draw.line([(ox, oy+dy),(ox+tw, oy+dy)], fill=(r, 128, 210), width=1)
    return img

if __name__ == "__main__":
    items = [
        ("floor_wood_diffuse.jpg",   wood_floor_diffuse()),
        ("floor_wood_normal.jpg",    wood_floor_normal()),
        ("floor_wood_roughness.jpg", wood_floor_roughness()),
        ("floor_tile_diffuse.jpg",   tile_floor_diffuse()),
        ("floor_tile_normal.jpg",    tile_floor_normal()),
        ("floor_tile_roughness.jpg", tile_floor_roughness()),
        ("wall_siding_diffuse.jpg",  wall_siding_diffuse()),
        ("wall_siding_normal.jpg",   wall_siding_normal()),
        ("wall_plaster_diffuse.jpg", wall_plaster_diffuse()),
        ("roof_tile_diffuse.jpg",    roof_tile_diffuse()),
        ("roof_tile_normal.jpg",     roof_tile_normal()),
    ]
    print(f"Generating {len(items)} textures → {OUT}/")
    for name, img in items:
        save(img, name)
    print("Done.")
