#!/usr/bin/env python3
"""Build a reproducible stage ZIP from a clean Git commit; never deploy."""
import argparse
import hashlib
import io
import re
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def build(repo, stage, output, description):
    if stage < 1:
        raise ValueError('Stage must be positive.')
    if git(repo, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Commit tracked changes before packaging.')
    release = git(repo, 'rev-parse', 'HEAD').decode().strip()
    prefix = 'wild-rift-community/'
    exported = git(repo, 'archive', '--format=tar', '--prefix=' + prefix, release)
    sha = lambda data: hashlib.sha256(data).hexdigest()
    with tarfile.open(fileobj=io.BytesIO(exported)) as original:
        members = original.getmembers()
        for member in members:
            name = Path(member.name)
            if name.name != '.env.example' and name.name.startswith('.env') or member.issym() or member.islnk():
                raise ValueError('Unsafe release entry: ' + member.name)
            if any(part in ('node_modules', '.git', 'data', 'uploads') for part in name.parts) or name.suffix in ('.sqlite', '.apk', '.aab', '.zip') or name.name.endswith(('.tar.gz', '.sqlite-wal', '.sqlite-shm', '.key', '.pem')):
                raise ValueError('Generated or private release entry: ' + member.name)
        # Gzip timestamp is fixed, so repeating the build produces identical bytes.
        import gzip
        buffer = io.BytesIO()
        with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as source:
            for member in members:
                source.addfile(member, original.extractfile(member) if member.isfile() else None)
            data = (release + '\n').encode()
            marker = tarfile.TarInfo(prefix + 'RELEASE_SHA');marker.size = len(data);marker.mode = 0o644
            source.addfile(marker, io.BytesIO(data))
        archive = buffer.getvalue()
    template = git(repo, 'show', release + ':deploy/deploy-from-termux.template.sh').decode()
    installer = template.replace('__RELEASE_SHA__', release).replace('__SOURCE_SHA256__', sha(archive)).replace('__STAGE__', str(stage))
    if re.search(r'__[A-Z_]+__', installer):
        raise ValueError('Unresolved installer placeholder.')
    subprocess.run(['bash', '-n'], input=installer, text=True, check=True)
    schema = max(map(int, re.findall(r'PRAGMA user_version\s*=\s*(\d+)', git(repo, 'show', release + ':server/database.mjs').decode())))
    notes = git(repo, 'show', release + ':' + description).decode()
    readme = f'''Этап {stage}. Коммит: {release}. Схема SQLite {schema}.
Скачай ZIP целиком в /storage/emulated/0/Download. Не распаковывай вручную.
В Termux:
bash "$HOME/wr-deploy/wr-deploy-latest.sh"

Исходники проверяются по SHA-256, Docker собирается и проверяется на VDS.
Установщик сохраняет копию перед миграцией и переключением сайта.
Старое приложение не открывает новую схему; не заменяй базу старой копией после новых записей.
Установка на VDS не подтверждена фактом выдачи ZIP.

{notes}
'''
    files = {'source.tar.gz': archive, 'deploy-from-termux.sh': installer.encode(),
             'README.txt': readme.encode(), 'TOURNAMENTS.md': git(repo, 'show', release + ':docs/TOURNAMENTS.md')}
    files['SHA256SUMS.txt'] = ''.join(f'{sha(data)}  {name}\n' for name, data in files.items()).encode()
    output.mkdir(parents=True, exist_ok=True)
    target = output / f'wr-community-design-stage{stage}.zip'
    if target.exists():
        raise FileExistsError('Refusing to overwrite: ' + str(target))
    with tempfile.TemporaryDirectory(dir=output) as directory:
        temporary = Path(directory) / target.name
        with zipfile.ZipFile(temporary, 'w') as zipped:
            for name, data in files.items():
                info = zipfile.ZipInfo(f'wr-community-design-stage{stage}/{name}')
                info.external_attr = (0o755 if name.endswith('.sh') else 0o644) << 16
                zipped.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(temporary) as zipped:
            if zipped.testzip() is not None:
                raise ValueError('Corrupt ZIP.')
            for name, data in files.items():
                if zipped.read(f'wr-community-design-stage{stage}/{name}') != data:
                    raise ValueError('ZIP content mismatch.')
        # Exclusive create also protects against concurrent builds of the same stage.
        with target.open('xb') as destination:
            destination.write(temporary.read_bytes())
    return dict(file=str(target.resolve()), commit=release, schema=schema, sha256=sha(target.read_bytes()))


if __name__ == '__main__':
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, type=int)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--description', required=True, help='Committed Markdown path with release changes and check status')
    args = parser.parse_args()
    repo = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel']).decode().strip())
    print(json.dumps(build(repo, args.stage, args.output_dir, args.description), ensure_ascii=False))
