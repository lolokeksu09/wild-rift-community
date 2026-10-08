import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

test('actual packaged smoke expression migrates a cold copy, seeds and retries, transfers ownership and preserves source',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const directory=mkdtempSync(join(tmpdir(),'wr-runtime-smoke-')),backup=join(directory,'backup'),copy=join(directory,'check');mkdirSync(backup);
 try{
  const file=join(backup,'community.sqlite'),db=new DatabaseSync(file);
  db.exec(readFileSync(join(root,'server/tests/fixtures/schema-v18.sql'),'utf8'));
  db.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,1)').run('u','keep','Keep','unchanged');db.close();
  const line=readFileSync(join(root,'deploy/smoke-image.sh'),'utf8').split('\n').find(line=>line.includes('const seed=await seedDemoCommunity'));
  const expression=JSON.parse(line.match(/ -e ("(?:[^"\\]|\\.)*")/)[1]).replaceAll("'/backup'",JSON.stringify(backup)).replaceAll("'/tmp/check'",JSON.stringify(copy)).replaceAll("'/tmp/check/community.sqlite'",JSON.stringify(join(copy,'community.sqlite')));
  const result=spawnSync(process.execPath,['--input-type=module','-e',expression],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS: packaged image/);
  const original=new DatabaseSync(file,{readOnly:true});
  try{assert.equal(original.prepare('PRAGMA user_version').get().user_version,18);assert.equal(original.prepare('SELECT count(*) n FROM users').get().n,1);assert.equal(original.prepare('SELECT password FROM users').get().password,'unchanged');}finally{original.close();}
 }finally{rmSync(directory,{recursive:true,force:true});}
});
