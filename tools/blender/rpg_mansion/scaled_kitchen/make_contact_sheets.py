"""Compose inspection sheets from delivered PNGs; never render or edit assets."""
from pathlib import Path
import hashlib
import json
import textwrap

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def font(size):
    try:
        return ImageFont.truetype('DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default(size=size)


def main():
    items = json.loads((HERE / 'descriptors.json').read_text())['items']
    columns, cell_width, cell_height, header = 5, 400, 430, 96
    rows = (len(items) + columns - 1) // columns
    report = {'method': 'Pillow composition of existing delivered PNG bytes; no new Blender renders',
              'itemCount': len(items), 'descriptorSha256': sha256(HERE / 'descriptors.json'), 'sheets': []}
    for view in ['front', 'top', 'rear']:
        sheet = Image.new('RGB', (columns * cell_width, rows * cell_height + header), '#f4f2ed')
        draw = ImageDraw.Draw(sheet)
        draw.text((24, 18), 'RPG mansion kitchen | FINAL ' + view.upper(), fill='#241f1b', font=font(30))
        draw.text((24, 59), '22 original static assets | dimensions: W x D x H, millimetres',
                  fill='#5b534a', font=font(18))
        inputs = []
        for index, item in enumerate(items):
            x, y = (index % columns) * cell_width, (index // columns) * cell_height + header
            draw.rounded_rectangle((x + 8, y + 8, x + cell_width - 8, y + cell_height - 8),
                                   radius=6, fill='#ffffff', outline='#d8d1c7', width=1)
            path = ROOT / item[view]
            with Image.open(path) as source:
                image = source.convert('RGBA')
                image.thumbnail((cell_width - 34, 338), Image.Resampling.LANCZOS)
                sheet.paste(image, (x + (cell_width - image.width) // 2, y + 16), image)
            short = item['id'].removeprefix('rpg-mansion-').removesuffix('-01')
            label = '\n'.join(textwrap.wrap(short, width=34))
            draw.multiline_text((x + 18, y + 354), label, fill='#241f1b', font=font(17), spacing=2)
            dims = '{} x {} x {} mm'.format(item['w'], item['d'], item['h'])
            draw.text((x + 18, y + 403), dims, fill='#655b50', font=font(14))
            inputs.append({'id': item['id'], 'path': item[view], 'bytes': path.stat().st_size,
                           'sha256': sha256(path)})
        output = HERE / ('kitchen-final-' + view + '-contact-sheet.png')
        sheet.save(output, optimize=True)
        report['sheets'].append({'view': view, 'path': str(output.relative_to(ROOT)),
                                 'bytes': output.stat().st_size, 'sha256': sha256(output), 'inputs': inputs})
    (HERE / 'contact-sheet-provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Composed three final contact sheets from 66 existing PNGs')


if __name__ == '__main__':
    main()
