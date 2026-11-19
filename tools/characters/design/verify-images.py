#!/usr/bin/env python3
"""Inspect the delivered PNGs without modifying artwork (requires Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
IDS = ('walker-male-01', 'walker-female-01')
VIEWS = ('front', 'side', 'back', 'turnaround')


def inspect():
    records = []
    expected = {f'{ident}-{view}.png' for ident in IDS for view in VIEWS}
    assert {p.name for p in ROOT.glob('*.png')} == expected, 'Unexpected/missing selected PNG'
    for name in sorted(expected):
        path = ROOT / name
        with Image.open(path) as probe:
            assert probe.format == 'PNG', name
            probe.verify()
        with Image.open(path) as image:
            image.load()
            assert image.mode in ('RGB', 'RGBA'), name
            if image.mode == 'RGBA':
                assert image.getchannel('A').getextrema() == (255, 255), name
            rgb = image.convert('RGB')
            width, height = rgb.size
            is_single = not name.endswith('-turnaround.png')
            if is_single:
                assert width >= 1024 and height >= 1024, name
            red, green, blue = rgb.split()
            spread = ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(red, green), blue),
                                         ImageChops.darker(ImageChops.darker(red, green), blue))
            colored = spread.point(lambda v: 255 if v > 18 else 0)
            dark = rgb.convert('L').point(lambda v: 255 if v < 200 else 0)
            mask = ImageChops.lighter(colored, dark)
            box = mask.getbbox()
            assert box, name
            left, top, right, bottom = box
            margins = (left, top, width - right, height - bottom)
            min_margin = 10 if is_single else 5
            assert min(margins) >= min_margin, f'Figure approaches/clips edge: {name} {margins}'
            occupancy = (bottom - top) / height
            assert occupancy >= 0.85, f'Figure too small: {name}'
            records.append({
                'file': name,
                'width': width,
                'height': height,
                'mode': image.mode,
                'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'foreground_bbox_approx': list(box),
                'edge_margins_px': list(margins),
                'figure_height_fraction_approx': round(occupancy, 4),
            })
    return {'method': 'PNG decode, minimum single-view dimensions, approximate color/luminance mask for clipping and scale; does not replace visual semantic review',
            'images': records}


if __name__ == '__main__':
    print(json.dumps(inspect(), indent=2))
