import os
import glob
from PIL import Image

def clean_image(path):
    try:
        img = Image.open(path).convert("RGBA")
        data = img.getdata()
        
        new_data = []
        for item in data:
            r, g, b, a = item
            # Detect checkerboard: light gray ~204 or white ~255
            # In the JS: Math.abs(r-g)<8 && Math.abs(g-b)<8 && r>180 && r<220 -> white out. Wait, the JS replaced it with white, not transparent!
            # Let's make it transparent instead! Much better.
            if abs(r-g) < 15 and abs(g-b) < 15 and r > 180:
                new_data.append((255, 255, 255, 0)) # transparent
            else:
                new_data.append(item)
                
        img.putdata(new_data)
        img.save(path, "PNG")
        print(f"Cleaned {path}")
    except Exception as e:
        print(f"Error on {path}: {e}")

assets = glob.glob("assets/*.png")
for asset in assets:
    # don't touch textures that should be opaque
    if "floor" in asset or "grass" in asset or "stone" in asset:
        continue
    clean_image(asset)
