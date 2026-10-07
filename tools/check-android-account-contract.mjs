import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/database.mjs';
import { createApp } from '../server/app.mjs';

// Isolated in-memory server. This never sends credentials or mutations to production.
const dir=mkdtempSync(join(tmpdir(),'wr-android-contract-')),databasePath=join(dir,'db.sqlite');
const app = await createApp({authLimit:100,databasePath});
const db=openDatabase(databasePath);
assert.equal(db.prepare('PRAGMA user_version').get().user_version,22);
const origin = await app.listen();
let cookie = '', csrf = '';
async function request(path, method='GET', payload, expected=200, override={}) {
  const headers={...override};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:origin,'X-Community-Request':'1','X-CSRF-Token':csrf},override);
  const response=await fetch(origin+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
  assert.equal(response.status,expected,`${method} ${path}`);
  const data=await response.json();
  const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  if(data.csrf)csrf=data.csrf;
  return data;
}
try {
  const password='android-test-password-123';
  const registered=await request('/api/register','POST',{handle:'android_contract',name:'Android test',password},201);
  assert.equal(registered.user.handle,'android_contract');assert.ok(csrf);assert.ok(cookie.startsWith('wr_session='));
  const restored=await request('/api/me');assert.equal(restored.user.id,registered.user.id);assert.equal(restored.sanction,null);
  await request('/api/me','PATCH',{name:'Updated',bio:'Android draft',profileVisible:false,gameProfile:{riotId:'Player#TEST',region:'EU',rank:'Gold',language:'Русский'}});
  assert.equal((await request('/api/me')).user.name,'Updated');
  await request('/api/me','PATCH',{name:'Forbidden'},403,{Origin:'https://foreign.invalid'});
  await request('/api/me','PATCH',{name:'Forbidden'},403,{'X-CSRF-Token':'wrong'});
  const generated=await request('/api/recovery-codes','POST',{password});assert.ok(generated.codes.length>0);
  const active=await request('/api/sessions');assert.equal(active.sessions.filter(s=>s.current).length,1);
  await request('/api/logout','POST',{});assert.equal((await request('/api/me')).user,null);
  await request('/api/login','POST',{handle:'android_contract',password});
  const newer='android-new-password-123';
  const changed=await request('/api/me/password','POST',{currentPassword:password,newPassword:newer});
  assert.equal(changed.recoveryCodesRevoked,true);
  const codes=await request('/api/recovery-codes','POST',{password:newer});
  await request('/api/logout-all','POST',{});assert.equal((await request('/api/me')).user,null);
  await request('/api/recover','POST',{handle:'android_contract',code:codes.codes[0],password});
  await request('/api/login','POST',{handle:'android_contract',password});
  const current=(await request('/api/sessions')).sessions.find(s=>s.current);
  assert.equal((await request(`/api/sessions/${current.id}`,'DELETE',{})).loggedOut,true);
  assert.equal((await request('/api/me')).user,null);
  await request('/api/login','POST',{handle:'android_contract',password});
  for(const id of ['reporter','moderator'])db.prepare('INSERT INTO users(id,handle,name,bio,password,created_at) VALUES(?,?,?,?,?,?)').run(id,id,id,'','unused',Date.now());
  const violation=n=>{
    const result=db.prepare("INSERT INTO reports(reporter_id,kind,target_id,sender_id,snapshot,reason,status,moderator_id,created_at) VALUES('reporter','post',?,?,'fixture','fixture','upheld','moderator',?)").run(String(n),registered.user.id,Date.now());
    db.prepare("INSERT INTO moderation_audit(report_id,actor_id,decision,note,created_at) VALUES(?,'moderator','upheld','fixture',?)").run(result.lastInsertRowid,Date.now());
  };
  violation(1);assert.deepEqual((await request('/api/me')).sanction,{level:'warning',violations:1,until:null});
  violation(2);const restricted=(await request('/api/me')).sanction;
  assert.equal(restricted.level,'restricted');assert.equal(restricted.violations,2);assert(restricted.until>Date.now());
  const forbidden=await request('/api/me','PATCH',{bio:'Keep draft'},403);assert.match(forbidden.error,/огранич/);
  await request('/api/me','PATCH',{profileVisible:false});
  violation(3);violation(4);violation(5);
  await request('/api/sessions','GET',undefined,401);
  assert.equal((await request('/api/me')).user,null);assert.equal(cookie,'wr_session=');
  assert.match((await request('/api/login','POST',{handle:'android_contract',password},403)).error,/приостановлен/);
  for(let i=0;i<120;i++)await request('/api/clubs?q=rate_fixture');
  await request('/api/clubs?q=rate_fixture','GET',undefined,429);
  console.log('Android account contract: register, restore, profile, Origin/CSRF, codes, password rotation, recovery, session revoke/logout, schema22, sanctions, suspension and search 429 passed (isolated DB).');
} finally { db.close();await app.close();rmSync(dir,{recursive:true,force:true}); }
