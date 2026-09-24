#!/usr/bin/env python3
"""アプリから書き出した手直し版を、生成器に載せる「受領版」の差分にする。

    python3 tools/make_review_patch.py \
        assets/default_plan.json ~/Downloads/plan_2.json \
        tools/default_plan_2f_review_27.json

■ なぜ在るのか
  既定プランは生成器(make_default_plan_2f.py / _3f.py)が作る。ユーザーが
  アプリ上で手直ししたぶんは、**出来上がったJSONを差し替えるのではなく、
  生成結果の上に載せる差分として残す。** そうしないと、生成器を直したときに
  手直しが消えるか、手直しを残すために生成器を直せなくなる。

  差分の形は既存の受領版(default_plan_*_review_*.json)と同じ。

      collections  walls/rooms/items ごとの {before, after} の並び
                   before が null なら追加、after が null なら削除
      metadata     プラン全体の設定(壁の色・屋根・視点など)
      order        並び順。**これが無いと2Dの重なりが変わる**

  `apply_patch_file` は before が現在の中身と一致しなければ止まる。
  土台が変わったのに気づかず載せると、別の場所を壊すため。

■ 使うときの注意
  第1引数は「**その差分を載せる直前の**生成結果」でなければならない。
  いまの出荷物(assets/default_plan.json)を渡してよいのは、差分を生成器の
  いちばん最後に足すときだけ。途中に差し込むなら、そこまで実行した結果を
  渡すこと。
"""
import json
import sys
from pathlib import Path

# プラン全体の設定のうち、受領版が持ち越すもの。heightDefaults と floors は
# **生成器が手直しの取り込みより後に上書きする**ので、ここには入れない。
METADATA_KEYS = ('exteriorDetail', 'exteriorWallSettings', 'floorMetadata',
                 'interiorWallSettings', 'planFixes', 'roofAppearance', 'viewState')
COLLECTIONS = ('walls', 'rooms', 'items')


def build(base, user):
    collections = {}
    for name in COLLECTIONS:
        before = {obj['id']: obj for obj in base.get(name, [])}
        after = {obj['id']: obj for obj in user.get(name, [])}
        changes = []
        # 順番は user 側の並びに合わせる(読んだときに追いやすい)
        for obj in user.get(name, []):
            old = before.get(obj['id'])
            if old != obj:
                changes.append({'before': old, 'after': obj})
        for object_id, old in before.items():
            if object_id not in after:
                changes.append({'before': old, 'after': None})
        collections[name] = changes
    metadata = {k: user[k] for k in METADATA_KEYS if k in user}
    order = {name: [obj['id'] for obj in user.get(name, [])] for name in COLLECTIONS}
    return {'collections': collections, 'metadata': metadata, 'order': order}


def main(argv):
    if len(argv) != 4:
        raise SystemExit(__doc__)
    base = json.loads(Path(argv[1]).read_text())
    user = json.loads(Path(argv[2]).read_text())
    patch = build(base, user)
    Path(argv[3]).write_text(json.dumps(patch, ensure_ascii=False, indent=1) + '\n')
    for name in COLLECTIONS:
        changes = patch['collections'][name]
        added = sum(1 for c in changes if c['before'] is None)
        removed = sum(1 for c in changes if c['after'] is None)
        print('  %-6s 追加%d 削除%d 変更%d' % (name, added, removed,
                                              len(changes) - added - removed))
    print('  metadata %s' % sorted(patch['metadata']))
    print('書き出し: %s' % argv[3])


if __name__ == '__main__':
    main(sys.argv)
