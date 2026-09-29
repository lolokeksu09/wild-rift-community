import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.mjs';

test('message reports: access, snapshots, resolution and audit',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-direct-')),databasePath=join(dir,'db.sqlite');
 let app=await createApp({databasePath}),origin=await app.listen();
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {cookie:'',csrf:'',async request(path,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {status:r.status,data};}};}
 const a=client(),b=client(),c=client(),guest=client();for(const [u,handle] of [[a,'alice'],[b,'bravo'],[c,'charlie']])assert.equal((await u.request('/api/register','POST',{handle,name:handle,password:'local-test-password-123'})).status,201);
 const cid=(await a.request('/api/direct','POST',{handle:'bravo',clientId:'report-first-message',body:'Сообщение для жалобы'})).data.id;
 await b.request(`/api/direct/${cid}/decision`,'POST',{decision:'accept'});
 const mid=(await b.request(`/api/direct/${cid}/messages`)).data.messages[0].id;
 const payload={kind:'direct',messageId:mid,reason:'Оскорбление в сообщении'};let rid;
 await t.test('participants only; reporter cannot read moderator queue or appoint themselves',async()=>{
  assert.equal((await c.request('/api/reports','POST',payload)).status,404);
  assert.equal((await a.request('/api/reports','POST',payload)).status,404);
  assert.equal((await b.request('/api/moderation/reports')).status,403);
  await b.request('/api/me','PATCH',{name:'bravo',bio:'',isModerator:true});assert.equal((await b.request('/api/me')).data.user.isModerator,false);
  const results=await Promise.all([b.request('/api/reports','POST',payload),b.request('/api/reports','POST',payload)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);rid=results[0].data.id;
  assert.equal((await a.request('/api/reports')).data.reports.length,0);
 });
 await t.test('moderator sees submitted snapshot, not the private conversation',async()=>{
  await app.close();app=await createApp({databasePath,moderatorIds:[c.id,b.id]});origin=await app.listen();
  const q=(await c.request('/api/moderation/reports')).data;assert.equal(q.reports.length,1);assert.equal(q.reports[0].snapshot,'Сообщение для жалобы');
  assert.equal((await c.request(`/api/direct/${cid}/messages`)).status,404);
  assert.equal((await b.request(`/api/moderation/reports/${rid}/decision`,'POST',{decision:'upheld',note:'Сам себе модератор'})).status,403);
 });
 await t.test('decision is idempotent, conflicts are rejected and reporter sees explanation',async()=>{
  const route=`/api/moderation/reports/${rid}/decision`,decision={decision:'upheld',note:'Нарушение подтверждено после проверки'};
  assert.equal((await c.request(route,'POST',decision)).status,200);assert.equal((await c.request(route,'POST',decision)).status,200);
  assert.equal((await c.request(route,'POST',{...decision,decision:'dismissed'})).status,409);
  const own=(await b.request('/api/reports')).data.reports[0];assert.equal(own.status,'upheld');assert.equal(own.decision_note,decision.note);assert.equal(own.sender_id,undefined);
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(databasePath);assert.equal(db.prepare('SELECT count(*) AS n FROM moderation_audit').get().n,1);db.close();
 });
 await t.test('decision notifications are private and marking read is idempotent',async()=>{
  assert.equal((await b.request('/api/reports/summary')).data.unread,1);
  assert.equal((await a.request('/api/reports/summary')).data.unread,0);
  assert.equal((await guest.request('/api/reports/summary')).status,401);
  assert.equal((await a.request(`/api/reports/${rid}/read`,'POST',{})).status,404);
  assert.equal((await c.request(`/api/reports/${rid}/read`,'POST',{})).status,404);
  for(let i=0;i<2;i++)assert.equal((await b.request(`/api/reports/${rid}/read`,'POST',{})).status,200);
  assert.equal((await b.request('/api/reports/summary')).data.unread,0);
  assert.equal((await b.request('/api/reports?before=-1')).status,422);
 });
 await t.test('revoking moderator configuration removes access after restart',async()=>{
  await app.close();app=await createApp({databasePath});origin=await app.listen();assert.equal((await c.request('/api/moderation/reports')).status,403);
  assert.equal((await b.request('/api/reports')).data.reports[0].status,'upheld');assert.equal((await b.request('/api/reports/summary')).data.unread,0);
 });
});
