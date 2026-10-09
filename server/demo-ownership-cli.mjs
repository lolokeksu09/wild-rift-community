import {DatabaseSync,backup} from 'node:sqlite';
import {resolve} from 'node:path';
import {existsSync,chmodSync} from 'node:fs';
import {demoOwnershipPlan,transferDemoOwnership} from './demo-ownership.mjs';

const [file,handle,flag,copy]=process.argv.slice(2);
if(!file||!handle||(flag&&!['--apply','--check'].includes(flag))||(flag==='--apply'&&!copy)||process.argv.length>(flag==='--apply'?6:flag==='--check'?5:4))throw Error('Usage: node server/demo-ownership-cli.mjs DATABASE HANDLE [--check | --apply NEW_BACKUP_PATH]');
process.umask(0o077);
const path=resolve(file);if(!existsSync(path))throw Error('Database must exist.');
if(flag==='--apply'&&existsSync(resolve(copy)))throw Error('Backup destination must be a new file.');
const db=new DatabaseSync(path,{readOnly:flag!=='--apply'});
try{
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
 if(db.prepare('PRAGMA user_version').get().user_version!==28)throw Error('Run with the published schema-28 release after its cold migration.');
 const plan=demoOwnershipPlan(db,handle);
 if(flag!=='--apply'){
  const verified=plan.clubs.every(c=>!c.changed&&db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(c.id,plan.target.id)?.status==='member');
  if(flag==='--check'&&!verified)throw Error('Expected real ownership and accepted memberships were not confirmed.');
  console.log(JSON.stringify({dryRun:true,verified,owner:plan.target.handle,clubs:plan.clubs}));
 }
 else{
  await backup(db,resolve(copy));chmodSync(resolve(copy),0o600);
  const check=new DatabaseSync(resolve(copy),{readOnly:true});
  try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup validation failed.');}finally{check.close();}
  console.log(JSON.stringify(transferDemoOwnership(db,handle)));
 }
}finally{db.close();}
