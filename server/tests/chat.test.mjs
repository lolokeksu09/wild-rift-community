import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.mjs';
import { openDatabase } from '../database.mjs';
const PASSWORD='Chat-test-password-123';

test('club chat: retries, history, restart and access revocation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-chat-')),databasePath=join(dir,'chat.sqlite');
 let app=await createApp({databasePath}),origin=await app.listen();
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {cookie:'',csrf:'',id:null,async request(path,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {status:r.status,data};}};}
 const owner=client(),member=client(),other=client(),guest=client();
 for(const [c,handle] of [[owner,'chatowner'],[member,'chatmember'],[other,'chatother']])assert.equal((await c.request('/api/register','POST',{handle,name:handle,password:PASSWORD})).status,201);
 const club=(await owner.request('/api/clubs','POST',{name:'Чат клуба',description:'',access:'open'})).data.id;
 const route=`/api/clubs/${club}/messages`;
 await member.request(`/api/clubs/${club}/join`,'POST',{});
 let first;
 await t.test('only members read and send, including open clubs',async()=>{
  assert.equal((await guest.request(route)).status,401);
  assert.equal((await other.request(route)).status,403);
  assert.equal((await other.request(route,'POST',{clientId:'outsider-message-1234',body:'no'})).status,403);
  assert.equal((await member.request(route)).data.viewerId,member.id);
 });
 await t.test('concurrent retries create one message; changed payload conflicts',async()=>{
  const requests=await Promise.all(Array.from({length:6},()=>member.request(route,'POST',{clientId:'stable-message-id-0001',body:'Привет',sender_id:owner.id})));
  assert.equal(requests.filter(r=>r.status===201).length,1);assert.equal(requests.filter(r=>r.status===200).length,5);
  assert.equal(new Set(requests.map(r=>r.data.message.id)).size,1);first=requests[0].data.message.id;
  assert.equal(requests[0].data.message.sender_id,member.id);
  assert.equal((await member.request(route,'POST',{clientId:'stable-message-id-0001',body:'Другой текст'})).status,409);
  assert.equal((await owner.request(route)).data.messages.length,1);
  assert.equal((await owner.request(route,'POST',{clientId:'stable-message-id-0001',body:'Другой автор'})).status,201);
 });
 await t.test('validates text and client identifiers',async()=>{
  for(const body of [{clientId:'tiny',body:'x'},{clientId:'valid-message-id-0000',body:' '},{clientId:'valid-message-id-0000',body:'x'.repeat(2001)},{clientId:'<invalid-message-id>',body:'x'}])assert.equal((await member.request(route,'POST',body)).status,422);
  assert.equal((await member.request(route+'?after=-1')).status,422);
  assert.equal((await member.request(route+'?before=2&after=1')).status,422);
 });
 await t.test('history and reconnect cursors have no gaps or duplicates',async()=>{
  for(let i=0;i<65;i++)assert.equal((await member.request(route,'POST',{clientId:`history-message-${i.toString().padStart(8,'0')}`,body:`Сообщение ${i}`})).status,201);
  const latest=(await member.request(route)).data;assert.equal(latest.messages.length,50);assert.equal(latest.hasMore,true);
  const old=(await member.request(route+`?before=${latest.next}`)).data;
  const combined=[...old.messages,...latest.messages];assert.equal(combined.length,67);assert.equal(new Set(combined.map(m=>m.id)).size,67);assert.equal(old.hasMore,false);
  const catchup=(await member.request(route+'?after=0')).data;assert.equal(catchup.messages.length,50);assert(catchup.hasMore);
  const tail=(await member.request(route+`?after=${catchup.next}`)).data;assert.equal(tail.messages.length,17);assert.equal(tail.hasMore,false);
  assert.deepEqual([...catchup.messages,...tail.messages].map(m=>m.id),combined.map(m=>m.id));
 });
 await t.test('personal blocking filters every history page without changing club membership',async()=>{
  const first=(await owner.request('/api/blocks','POST',{userId:member.id})).data.blockVersion;
  assert.equal((await owner.request('/api/blocks','POST',{userId:member.id})).data.blockVersion,first);
  for(const suffix of ['', '?after=0','?before=999999']){
   const response=await owner.request(route+suffix);assert.equal(response.status,200);assert.equal(response.data.blockVersion,first);assert(response.data.messages.every(m=>m.sender_id!==member.id));assert.equal(response.data.messages.length,1);
  }
  assert.equal((await member.request(route)).data.messages.length,50);
  assert.equal((await owner.request(`/api/clubs/${club}/members`)).data.members.find(m=>m.id===member.id).status,'member');
  const next=(await owner.request('/api/blocks','DELETE',{userId:member.id})).data.blockVersion;assert(next>first);
  assert.equal((await owner.request(route)).data.messages.length,50);
 });
 await t.test('restart keeps messages and retry identity',async()=>{
  await app.close();app=await createApp({databasePath});origin=await app.listen();
  const retry=await member.request(route,'POST',{clientId:'stable-message-id-0001',body:'Привет'});
  assert.equal(retry.status,200);assert.equal(retry.data.message.id,first);
 });
 await t.test('leaving revokes reads and retries; pending request cannot read',async()=>{
  await member.request(`/api/clubs/${club}/leave`,'POST',{});
  assert.equal((await member.request(route)).status,403);
  assert.equal((await member.request(route,'POST',{clientId:'stable-message-id-0001',body:'Привет'})).status,403);
  const privateClub=(await owner.request('/api/clubs','POST',{name:'По заявкам',description:'',access:'request'})).data.id;
  await other.request(`/api/clubs/${privateClub}/join`,'POST',{});
  assert.equal((await other.request(`/api/clubs/${privateClub}/messages`)).status,403);
 });
 await t.test('ban and logout revoke future reads and sends',async()=>{
  await member.request(`/api/clubs/${club}/join`,'POST',{});
  await owner.request(`/api/clubs/${club}/ban`,'POST',{userId:member.id});
  assert.equal((await member.request(route+'?after=0')).status,403);
  assert.equal((await member.request(route,'POST',{clientId:'blocked-message-1234',body:'Нет'})).status,403);
  await owner.request('/api/logout','POST',{});
  assert.equal((await owner.request(route)).status,401);
 });
});

test('v1 migration preserves existing records and v10 opens repeatedly',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-migration-')),file=join(dir,'db.sqlite');let db;
 try{
  db=new DatabaseSync(file);db.exec(readFileSync(new URL('./fixtures/schema-v1.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,?)').run('user1','user1','Старый пользователь','fixture-hash',1);
  db.prepare('INSERT INTO clubs VALUES(?,?,?,?,?,?)').run('club1','user1','Старый клуб','Описание','open',1);
  db.prepare('INSERT INTO memberships VALUES(?,?,?)').run('club1','user1','member');
  db.prepare('INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES(?,?,?,?,?)').run('club1','user1','Заголовок','Старый текст',1);db.close();
  for(let i=0;i<2;i++){db=openDatabase(file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,10);assert.equal(db.prepare('SELECT body FROM posts').get().body,'Старый текст');assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n,0);db.close();db=null;}
 }finally{if(db?.isOpen)db.close();rmSync(dir,{recursive:true,force:true});}
});
