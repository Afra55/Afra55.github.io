#!/usr/bin/env python3
"""Verify Eternum ch2-9 Chinese posts against wiki + image manifests."""
import json, re, sys
from pathlib import Path

ROOT = Path('/workspace')
TMP = Path('/workspace/tmp/eternum-ch')

def main(chapters=range(2, 10)):
    all_ok = True
    for chap in chapters:
        post = ROOT / f'_posts/Life/2026-8-5-eternum-chapter-{chap}-chinese-plot.markdown'
        man = json.loads((TMP / f'manifest_ch{chap}.json').read_text())
        wiki = (TMP / f'chapter_{chap}.wiki').read_text()
        print(f'\n=== Chapter {chap} ===')
        if not post.exists():
            print('FAIL: post missing', post)
            all_ok = False
            continue
        text = post.read_text()
        # front matter
        if not text.startswith('---'):
            print('FAIL: no front matter'); all_ok = False
        # images
        refs = re.findall(rf'eternum-ch{chap}\.resources/([^"\']+)', text)
        local_dir = ROOT / f'blog_picture/eternum-ch{chap}.resources'
        missing_files = [r for r in refs if not (local_dir / r).exists()]
        expected = {x['local'] for x in man['images'] if x.get('local')}
        unused = sorted(expected - set(refs))
        print(f'chars={len(text)} img_refs={len(refs)} unique={len(set(refs))} expected={len(expected)}')
        if missing_files:
            print('FAIL missing files:', missing_files[:10]); all_ok = False
        else:
            print('OK all referenced files exist')
        if unused:
            print('WARN unused manifest images:', unused); all_ok = False
        else:
            print('OK all manifest images referenced')
        # wiki section coverage: count == headings in wiki (top-level-ish)
        wiki_secs = re.findall(r'^==+\s*(.+?)\s*==+', wiki, re.M)
        zh_secs = re.findall(r'^##\s+(.+)', text, re.M)
        print(f'wiki_headings={len(wiki_secs)} zh_h2={len(zh_secs)}')
        if len(zh_secs) < max(3, len([s for s in wiki_secs if not s.startswith('=')]) * 0.5):
            print('WARN: zh sections look few vs wiki'); all_ok = False
        # length sanity vs wiki (Chinese denser; ch1 ratio ~0.34 was ok for complete coverage)
        # require at least ~0.20 of wiki chars for long chapters
        ratio = len(text) / max(len(wiki), 1)
        print(f'zh/en_char_ratio={ratio:.2f}')
        min_ratio = 0.18 if chap == 9 else 0.22
        if ratio < min_ratio:
            print(f'FAIL: translation too short (ratio<{min_ratio})'); all_ok = False
        else:
            print('OK length ratio')
        # must mention Orion / Eternum
        for key in ['奥赖恩', 'Eternum']:
            if key not in text:
                print('FAIL missing key', key); all_ok = False
    print('\nOVERALL', 'PASS' if all_ok else 'FAIL')
    return 0 if all_ok else 1

if __name__ == '__main__':
    chaps = [int(x) for x in sys.argv[1:]] or list(range(2, 10))
    raise SystemExit(main(chaps))
