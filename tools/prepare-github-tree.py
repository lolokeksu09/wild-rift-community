#!/usr/bin/env python3
"""Prepare staged changes for GitHub Git API; never update a remote or stage files."""
import argparse
import base64
import json
import subprocess
from pathlib import Path


def git(*args):
    return subprocess.check_output(['git', *args])


def prepare():
    if git('ls-files', '-u'):
        raise ValueError('Resolve index conflicts first.')
    paths = [p.decode() for p in git('diff', '--cached', '--name-only', '--no-renames', '-z').split(b'\0') if p]
    if not paths:
        raise ValueError('No staged changes.')
    entries, blobs = [], []
    for path in paths:
        record = git('ls-files', '--stage', '-z', '--', path)
        if not record:
            entries.append(dict(path=path, mode='100644', type='blob', sha=None))
            continue
        mode, sha, stage = record.split(b'\t', 1)[0].decode().split()
        if mode not in ('100644', '100755') or stage != '0':
            raise ValueError('Unsupported index entry: ' + path)
        data = git('cat-file', 'blob', sha)
        try:
            content = data.decode('utf-8') if len(data) <= 65536 else None
        except UnicodeDecodeError:
            content = None
        entry = dict(path=path, mode=mode, type='blob')
        if content is not None:
            entry['content'] = content
        else:
            entry['sha'] = sha
            blobs.append(dict(path=path, sha=sha, encoding='base64', content=base64.b64encode(data).decode()))
        entries.append(entry)
    return dict(parent_sha=git('rev-parse', 'HEAD').decode().strip(),
                base_tree_sha=git('rev-parse', 'HEAD^{tree}').decode().strip(),
                tree_sha=git('write-tree').decode().strip(), tree_elements=entries, blobs=blobs)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    plan = prepare()
    with args.output.open('x', encoding='utf-8') as file:
        json.dump(plan, file, ensure_ascii=False)
    print(json.dumps(dict(file=str(args.output.resolve()), files=len(plan['tree_elements']),
                          separate_blobs=len(plan['blobs']), parent_sha=plan['parent_sha'],
                          base_tree_sha=plan['base_tree_sha'], tree_sha=plan['tree_sha'])))
