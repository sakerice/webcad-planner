"""Asset-only adapters for the production asset-set catalogue.

The legacy builders still expose their original procedural geometry functions.
This module keeps their command-line output compatible with PR81's normalized
set/name/items schema and never restores the previous application code.
"""
import json
from pathlib import Path

FIELDS = (
    'id', 'name', 'group', 'category', 'kind', 'model', 'thumb', 'top', 'w', 'd', 'h',
    'defaultElevation', 'provenance', 'assetSet', 'previewVersion',
    'finishChannels', 'sourceBlend', 'validation', 'builder', 'front', 'rear',
    'placementNotes',
)


def is_normalized(manifest):
    return manifest.get('set') == 'rpg-mansion' and isinstance(manifest.get('items'), list)


def production_item(descriptor, previous=None):
    """Retain production fields and existing information without legacy schema."""
    item = dict(previous or {})
    item.update({key: descriptor[key] for key in FIELDS if key in descriptor})
    item['assetSet'] = 'rpg-mansion'
    if descriptor.get('defaultElevation') == 0 and 'defaultElevation' not in (previous or {}):
        item.pop('defaultElevation', None)
    return item


def merge_items(manifest, descriptors):
    """Merge only successfully generated assets, preserving ordering and others."""
    items = {item['id']: item for item in manifest['items']}
    for descriptor in descriptors:
        items[descriptor['id']] = production_item(descriptor, items.get(descriptor['id']))
    manifest['items'] = list(items.values())
    return manifest


def write_catalogue(path, manifest):
    path = Path(path)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    temporary.replace(path)


def source_fields(item):
    """Resolve native source/QA paths from current production metadata."""
    result = dict(item)
    validation = Path(result['validation']) if result.get('validation') else None
    if not result.get('sourceBlend') and validation:
        result['sourceBlend'] = str(validation.with_name(item['id'] + '.blend'))
    if result.get('sourceBlend'):
        directory = Path(result['sourceBlend']).parent
        result.setdefault('front', str(directory / (item['id'] + '-front.png')))
        result.setdefault('rear', str(directory / (item['id'] + '-rear.png')))
    return result
