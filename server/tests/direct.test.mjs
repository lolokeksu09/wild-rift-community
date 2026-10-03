import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.mjs';

test('direct conversations: consent, privacy, persistence and authorization',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-direct-')),databasePath=join(dir,'db.sqlite');
 let app=await createApp({databasePath}),origin=await app.listen();
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {cookie:'',csrf:'',async request(path,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {status:r.status,data};}};}
 const a=client(),b=client(),c=client(),guest=client();for(const [u,handle] of [[a,'alice'],[b,'bravo'],[c,'charlie']])assert.equal((await u.request('/api/register','POST',{handle,name:handle,password:'local-test-password-123'})).status,201);
 const payload={handle:'bravo',clientId:'first-direct-message-0001',body:'Привет <script>'};let id,route;
 await t.test('concurrent request retries keep one first message; no self acceptance',async()=>{
  const results=await Promise.all(Array.from({length:4},()=>a.request('/api/direct','POST',payload)));assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(new Set(results.map(r=>r.data.id)).size,1);assert.equal((await b.request('/api/direct')).data.requests,1);assert.equal((await a.request('/api/direct')).data.requests,0);id=results[0].data.id;route=`/api/direct/${id}/messages`;
  assert.equal((await a.request(`/api/direct/${id}/decision`,'POST',{decision:'accept'})).status,403);
  assert.equal((await a.request(route,'POST',{clientId:'pending-extra-message',body:'again'})).status,403);
  assert.equal((await b.request('/api/direct','POST',{...payload,handle:'alice'})).status,409);
  assert.equal((await a.request('/api/direct','POST',{...payload,body:'changed'})).status,409);
 });
 await t.test('outsider cannot discover, read, write or decide; guest denied',async()=>{
  assert.equal((await c.request('/api/direct')).data.conversations.length,0);
  assert.equal((await guest.request('/api/direct')).status,401);
  assert.equal((await c.request(route)).status,404);
  assert.equal((await c.request(route,'POST',{clientId:'outsider-message-id',body:'no'})).status,404);
  assert.equal((await c.request(`/api/direct/${id}/decision`,'POST',{decision:'accept'})).status,404);
 });
 await t.test('accept, idempotent sends and restart preserve history',async()=>{
  assert.equal((await b.request(`/api/direct/${id}/decision`,'POST',{decision:'accept'})).status,200);
  const p={clientId:'accepted-message-id-0001',body:'Ответ'};
  assert.equal((await b.request(route,'POST',p)).status,201);assert.equal((await b.request(route,'POST',p)).status,200);
  assert.equal((await b.request(route,'POST',{...p,body:'changed'})).status,409);
  await app.close();app=await createApp({databasePath});origin=await app.listen();
  assert.equal((await a.request(route)).data.messages.length,2);assert.equal((await b.request(route,'POST',p)).status,200);
  assert.equal((await a.request(route+'?after=-1')).status,422);
 });
 await t.test('unread counts, monotonic read cursors and authorization',async()=>{
  assert.equal((await a.request('/api/direct')).data.unread,1);
  assert.equal((await b.request('/api/direct')).data.unread,1);
  const history=(await a.request(route)).data.messages,last=history.at(-1).id;
  assert.equal((await c.request(`/api/direct/${id}/read`,'POST',{lastId:last})).status,404);
  assert.equal((await a.request(`/api/direct/${id}/read`,'POST',{lastId:last+1000})).status,422);
  await a.request(`/api/direct/${id}/read`,'POST',{lastId:last});
  await b.request(route,'POST',{clientId:'new-after-read-message',body:'New unread'});
  await a.request(`/api/direct/${id}/read`,'POST',{lastId:history[0].id});
  assert.equal((await a.request('/api/direct')).data.unread,1);
  assert.equal((await c.request('/api/direct')).data.unread,0);
  await app.close();app=await createApp({databasePath});origin=await app.listen();
  assert.equal((await a.request('/api/direct')).data.unread,1);
 });
 await t.test('privacy blocks new requests but keeps accepted conversations',async()=>{
  assert.equal((await b.request('/api/me/privacy','PATCH',{dmRequests:false})).status,200);
  assert.equal((await c.request('/api/direct','POST',payload)).status,403);
  assert.equal((await a.request(route,'POST',{clientId:'privacy-existing-chat',body:'still accepted'})).status,201);
 });
 await t.test('blocking denies both directions and retries; only blocker can remove it',async()=>{
  await b.request('/api/blocks','POST',{userId:a.id});
  for(const u of [a,b]){assert.equal((await u.request(route)).status,403);assert.equal((await u.request(route,'POST',{clientId:'blocked-message-test',body:'no'})).status,403);assert.equal((await u.request('/api/direct')).data.conversations.length,0);assert.equal((await u.request('/api/direct')).data.unread,0);assert.equal((await u.request(`/api/direct/${id}/read`,'POST',{lastId:1})).status,403);}
  assert.equal((await a.request('/api/direct','POST',payload)).status,403);
  await a.request('/api/blocks','DELETE',{userId:b.id});assert.equal((await a.request(route)).status,403);
  assert.equal((await c.request('/api/blocks')).data.blocks.length,0);
  await b.request('/api/blocks','DELETE',{userId:a.id});assert.equal((await a.request(route)).status,200);
 });
 await t.test('rejection cannot be bypassed with another request or reversed decision',async()=>{
  const r=await a.request('/api/direct','POST',{...payload,handle:'charlie'}),rid=r.data.id;
  assert.equal((await c.request(`/api/direct/${rid}/decision`,'POST',{decision:'reject'})).status,200);
  assert.equal((await a.request('/api/direct','POST',{...payload,handle:'charlie',clientId:'another-request-test'})).status,409);
  assert.equal((await c.request(`/api/direct/${rid}/decision`,'POST',{decision:'accept'})).status,409);
  assert.equal((await c.request(`/api/direct/${rid}/messages`)).status,403);
 });
});

test('v2 migration preserves club messages and adds request defaults',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync}=await import('node:fs');const {openDatabase}=await import('../database.mjs');
 const dir=mkdtempSync(join(tmpdir(),'wr-v2-')),file=join(dir,'db.sqlite');let db;
 try{
  db=new DatabaseSync(file);db.exec(readFileSync(new URL('./fixtures/schema-v1.sql',import.meta.url),'utf8'));
  db.exec(`INSERT INTO users VALUES('u','user','User','','hash',1);
   INSERT INTO clubs VALUES('c','u','Club','','open',1);
   CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,sender_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(club_id,sender_id,client_id)) STRICT;
   CREATE INDEX messages_club ON messages(club_id,id);
   INSERT INTO messages(club_id,sender_id,client_id,body,created_at) VALUES('c','u','old-message','Keep me',1);PRAGMA user_version=2;`);db.close();
  db=openDatabase(file);assert.equal(db.prepare('SELECT body FROM messages').get().body,'Keep me');assert.equal(db.prepare('SELECT dm_requests FROM users').get().dm_requests,1);assert.equal(db.prepare('PRAGMA user_version').get().user_version,12);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
