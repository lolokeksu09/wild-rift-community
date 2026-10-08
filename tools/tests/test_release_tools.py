import importlib.util
import json
import subprocess
import tempfile
import unittest
import zipfile
import io
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / (name + '.py'))
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
builder = load('build-release')
prepare = load('prepare-github-tree')

class ReleaseTools(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory();self.root = Path(self.directory.name)
        self.git('init', '-q');self.git('config', 'user.name', 'Test');self.git('config', 'user.email', 'test@example.invalid')
        for path, content in [('deploy/deploy-from-termux.template.sh', '#!/bin/bash\nrelease=__RELEASE_SHA__\nexpected_sha=__SOURCE_SHA256__\necho __STAGE__\n'), ('server/database.mjs', 'PRAGMA user_version=25;'), ('docs/TOURNAMENTS.md', 'Турниры'), ('docs/RELEASE.md', 'Tests passed; production not deployed.'), ('keep.txt', 'Привет')]:
            target=self.root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)
        self.git('add', '.');self.git('commit', '-qm', 'Fixture')
    def tearDown(self): self.directory.cleanup()
    def git(self,*args): return subprocess.check_output(['git','-C',str(self.root),*args]).decode().strip()
    def test_reproducible_archive_and_safety(self):
        (self.root/'.env').write_text('untracked secret')
        a=builder.build(self.root,28,self.root/'out-a','docs/RELEASE.md');b=builder.build(self.root,28,self.root/'out-b','docs/RELEASE.md');self.assertEqual(a['sha256'],b['sha256'])
        with zipfile.ZipFile(a['file']) as z:
            prefix='wr-community-design-stage28/'
            self.assertNotIn('__RELEASE_SHA__',z.read(prefix+'deploy-from-termux.sh').decode())
            with tarfile.open(fileobj=io.BytesIO(z.read(prefix+'source.tar.gz'))) as t:
                self.assertEqual(t.extractfile('wild-rift-community/RELEASE_SHA').read().decode().strip(),a['commit'])
                self.assertNotIn('wild-rift-community/.env', t.getnames())
        with self.assertRaises(FileExistsError):builder.build(self.root,28,self.root/'out-a','docs/RELEASE.md')
        (self.root/'keep.txt').write_text('dirty')
        with self.assertRaises(ValueError):builder.build(self.root,29,self.root/'out-c','docs/RELEASE.md')
        self.git('add','keep.txt','.env');self.git('commit','-qm','Unsafe fixture')
        with self.assertRaises(ValueError):builder.build(self.root,29,self.root/'out-c','docs/RELEASE.md')
    def test_staged_plan_preserves_modes_binary_deletion_and_unstaged_changes(self):
        (self.root/'keep.txt').write_text('staged');self.git('add','keep.txt');(self.root/'keep.txt').write_text('unstaged')
        (self.root/'binary.bin').write_bytes(b'\xff\x00');self.git('add','binary.bin');self.git('rm','-q','docs/RELEASE.md')
        script=self.root/'operator.sh';script.write_text('#!/bin/sh\n');script.chmod(0o755);self.git('add','operator.sh')
        output=self.root/'plan.json'
        subprocess.run(['python3',str(ROOT/'tools/prepare-github-tree.py'),'--output',str(output)],cwd=self.root,check=True,stdout=subprocess.DEVNULL)
        plan=json.loads(output.read_text());entries={e['path']:e for e in plan['tree_elements']}
        self.assertEqual(entries['keep.txt']['content'],'staged');self.assertIsNone(entries['docs/RELEASE.md']['sha']);self.assertEqual(entries['operator.sh']['mode'],'100755');self.assertEqual(len(plan['blobs']),1);self.assertEqual(plan['tree_sha'],self.git('write-tree'))
        self.assertEqual((self.root/'keep.txt').read_text(),'unstaged')
