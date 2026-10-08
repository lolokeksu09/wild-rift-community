import {DatabaseSync,backup} from 'node:sqlite';
import {resolve} from 'node:path';
import {existsSync,chmodSync} from 'node:fs';
import {demoOwnershipPlan,transferDemoOwnership} from './demo-ownership.mjs';

const [file,handle,flag,copy]=process.argv.slice(2);
if(!file||!handle||(flag&&flag!=='--apply')||(flag&&!copy)||process.argv.length>(flag?6:4))throw Error('Usage: node server/demo-ownership-cli.mjs DATABASE HANDLE [--apply NEW_BACKUP_PATH]');
process.umask(0o077);
const path=resolve(file);if(!existsSync(path))throw Error('Database must exist.');
if(flag&&existsSync(resolve(copy)))throw Error('Backup destination must be a new file.');
const db=new DatabaseSync(path,{readOnly:!flag});
try{
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
 if(db.prepare('PRAGMA user_version').get().user_version!==20)throw Error('Run with the published schema-20 release after its cold migration.');
 const plan=demoOwnershipPlan(db,handle);
 if(!flag)console.log(JSON.stringify({dryRun:true,owner:plan.target.handle,clubs:plan.clubs}));
 else{
  await backup(db,resolve(copy));chmodSync(resolve(copy),0o600);
  const check=new DatabaseSync(resolve(copy),{readOnly:true});
  try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup validation failed.');}finally{check.close();}
  console.log(JSON.stringify(transferDemoOwnership(db,handle)));
 }
}finally{db.close();}
