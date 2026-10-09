import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../app.mjs';
import {openDatabase} from '../database.mjs';
const key=()=>randomUUID();
test('chat actions across club/direct/company/event: privacy, versions, retries and live changes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-chat-actions-')),databasePath=join(dir,'db');let app=await createApp({databasePath}),origin=await app.listen();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const client=()=>({cookie:'',csrf:'',async req(path,method='GET',body,csrf=this.csrf){const r=await fetch(origin+path,{method,headers:{Cookie:this.cookie,...(method!=='GET'?{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {...data,status:r.status};}});
 const a=client(),b=client(),x=client();for(const [c,handle]of[[a,'action_owner'],[b,'action_peer'],[x,'action_other']])assert.equal((await c.req('/api/register','POST',{handle,name:handle,password:'Chat-actions-pass-123'})).status,201);
 const club=(await a.req('/api/clubs','POST',{name:'Actions',description:'',access:'open'})).id;await b.req(`/api/clubs/${club}/join`,'POST',{});
 const direct=(await a.req('/api/direct','POST',{handle:'action_peer',clientId:key(),body:'Первое сообщение'})).id;await b.req(`/api/direct/${direct}/decision`,'POST',{decision:'accept'});
 const event=(await a.req('/api/events','POST',{clientId:key(),title:'Actions event',description:'',mode:'ranked',region:'EU',language:'ru',timezone:'UTC',startsAt:Date.now()+3600000,durationHours:2,roles:['mid','jungle'],ownerRole:'mid'})).id;await b.req(`/api/events/${event}/join`,'POST',{role:'jungle'});
 const lfg=(await a.req('/api/lfg','POST',{clientId:key(),title:'Actions group',mode:'ranked',region:'EU',language:'ru',role:'mid',rank:'any',voice:'optional',durationHours:1,description:'',capacity:5,startsAt:Date.now()+60000})).id;
 assert.ok(lfg,'company created');await b.req(`/api/lfg/${lfg}/apply`,'POST',{});await a.req(`/api/lfg/${lfg}/decision`,'POST',{userId:b.id,decision:'accept'});
 const routes=[`/api/clubs/${club}/messages`,`/api/direct/${direct}/messages`,`/api/lfg/${lfg}/messages`,`/api/events/${event}/messages`];
 for(const route of routes)await t.test(route,async()=>{
  const original={clientId:key(),body:'Исходное <img src=x>'},first=await a.req(route,'POST',original);assert.equal(first.status,201);const id=first.message.id;
  const outsider=await x.req(route+'/'+id);assert.ok([403,404].includes(outsider.status));assert.ok(!JSON.stringify(outsider).includes('Исходное'));
  assert.equal((await b.req(route+'/'+id+'/edit','POST',{clientId:key(),body:'Чужой текст',version:1})).status,403);
  assert.equal((await a.req(route+'/'+id+'/delete','POST',{clientId:key(),version:1},'bad-csrf')).status,403);
  const otherClub=(await a.req('/api/clubs','POST',{name:'Other actions',description:'',access:'open'})).id;
  const alien=(await a.req(`/api/clubs/${otherClub}/messages`,'POST',{clientId:key(),body:'Другой чат'})).message.id;
  if(route.includes('/clubs/'))assert.equal((await a.req(route,'POST',{clientId:key(),body:'Нельзя',replyId:alien})).status,404);
  const response=await b.req(route,'POST',{clientId:key(),body:'Ответ',replyId:id});assert.equal(response.status,201);assert.equal(response.message.reply.body,original.body);
  const initial=await b.req(route),cursor=initial.messages.at(-1).id,revision=initial.revision;
  const edit={clientId:key(),body:'Изменено',version:1};const edits=await Promise.all([a.req(route+'/'+id+'/edit','POST',edit),a.req(route+'/'+id+'/edit','POST',edit)]);assert(edits.every(r=>r.status===200));assert.equal(edits.filter(r=>r.replayed).length,1);assert.equal(edits[0].message.version,2);
  assert.equal((await a.req(route,'POST',original)).status,200,'original send retry survives edit');
  assert.equal((await a.req(route+'/'+id+'/edit','POST',{...edit,body:'Different'})).status,409);
  assert.equal((await a.req(route+'/'+id+'/edit','POST',{clientId:key(),version:1,body:'Stale'})).status,409);
  let updates=await b.req(route+`?after=${cursor}&revision=${revision}`);assert.equal(updates.messages.length,0);assert(updates.changes.some(m=>m.id===id&&m.body==='Изменено'));assert(updates.changes.some(m=>m.id===response.message.id&&m.reply.body==='Изменено'));
  const reaction={clientId:key(),emoji:'👍',active:true};await b.req(route+'/'+id+'/reaction','POST',reaction);const again=await b.req(route+'/'+id+'/reaction','POST',reaction);assert.equal(again.replayed,true);assert.deepEqual(again.message.reactions,[{emoji:'👍',count:1,mine:true}]);
  assert.equal((await b.req(route+'/'+id+'/reaction','POST',{clientId:key(),emoji:'oops',active:true})).status,422);
  await b.req(route+'/'+id+'/reaction','POST',{clientId:key(),emoji:'👍',active:false});assert.equal((await b.req(route+'/'+id)).message.reactions.length,0);
  const deletion={clientId:key(),version:2};await a.req(route+'/'+id+'/delete','POST',deletion);assert.equal((await a.req(route+'/'+id+'/delete','POST',deletion)).replayed,true);
  const gone=(await b.req(route+'/'+id)).message;assert.equal(gone.deleted,true);assert.equal(gone.body,'');assert.equal(gone.reactions.length,0);
  assert.equal((await b.req(route+'/'+response.message.id)).message.reply,null);assert.equal((await a.req(route,'POST',original)).status,200,'original send retry survives deletion');
  assert.equal((await b.req(route,'POST',{clientId:key(),body:'Late',replyId:id})).status,404);
  assert.equal((await a.req(route+'/'+id+'/edit','POST',{clientId:key(),version:3,body:'Revive'})).status,409);
 });
 await t.test('blocked source cannot leak through a quote or reaction; access is checked on replay',async()=>{
  const route=routes[0],m=(await a.req(route,'POST',{clientId:key(),body:'Private source'})).message;
  const reply=(await b.req(route,'POST',{clientId:key(),body:'Visible response',replyId:m.id})).message;
  await b.req('/api/blocks','POST',{userId:a.id});const history=await b.req(route);assert(!JSON.stringify(history).includes('Private source'));assert.equal(history.messages.find(v=>v.id===reply.id).reply,null);
  assert.equal((await b.req(route+'/'+m.id+'/reaction','POST',{clientId:key(),emoji:'❤️',active:true})).status,404);
  await b.req('/api/blocks','DELETE',{userId:a.id});const op={clientId:key(),emoji:'❤️',active:true};await b.req(route+'/'+m.id+'/reaction','POST',op);
  await b.req(`/api/clubs/${club}/leave`,'POST',{});assert.equal((await b.req(route+'/'+m.id+'/reaction','POST',op)).status,403);
 });
 await t.test('moderation removal is synced and removes a quoted body',async()=>{
  const route=routes[0],m=(await a.req(route,'POST',{clientId:key(),body:'Moderated source'})).message,r=(await a.req(route,'POST',{clientId:key(),body:'Reply',replyId:m.id})).message,rev=(await a.req(route)).revision;
  const db=openDatabase(databasePath);db.prepare('DELETE FROM messages WHERE id=?').run(m.id);db.close();const changed=await a.req(route+'?after=999999&revision='+rev);assert(changed.changes.some(x=>x.id===m.id&&x.removed));assert(changed.changes.some(x=>x.id===r.id&&x.reply===null));
 });
 await app.close();app=await createApp({databasePath});origin=await app.listen();assert.equal((await a.req(routes[1])).status,200);
});
test('schema32→33 preserves four message tables, IDs, snapshots and a cold backup; reopens',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-chat33-')),p=join(dir,'db');try{let d=openDatabase(p);d.exec("INSERT INTO users(id,handle,name,password,created_at) VALUES('u','keep','Keep','hash',1);INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES('c','u','Keep','','open',1);INSERT INTO messages(id,club_id,sender_id,client_id,body,created_at) VALUES(42,'c','u','original-stable-id','Keep text',1);INSERT INTO users(id,handle,name,password,created_at) VALUES('v','peer','Peer','hash',1);INSERT INTO direct_conversations VALUES('dc','u','v','u','accepted',1);INSERT INTO direct_messages(id,conversation_id,sender_id,client_id,body,created_at) VALUES(42,'dc','u','direct-stable-id','Keep direct',1);INSERT INTO lfg_groups(id,owner_id,client_id,create_signature,title,mode,region,language,role,rank,voice,description,capacity,starts_at,expires_at,created_at) VALUES(1,'u','group-stable-id','s','Group','ranked','EU','ru','mid','any','optional','',2,1,9999999999999,1);INSERT INTO lfg_messages VALUES(42,1,'u','group-message-id','Keep group',1);INSERT INTO game_events(id,owner_id,client_id,signature,title,description,mode,region,language,timezone,starts_at,ends_at,created_at) VALUES(1,'u','event-stable-id','s','Event','','ranked','EU','ru','UTC',1,9999999999999,1);INSERT INTO event_messages VALUES(42,1,'u','event-message-id','Keep event',1);DROP TRIGGER chat_club_removed;DROP TABLE chat_message_reactions;DROP TABLE chat_message_state;DROP TABLE chat_message_changes;DROP TABLE chat_message_operations;PRAGMA user_version=32;");d.close();copyFileSync(p,join(dir,'backup'));for(let i=0;i<2;i++){d=openDatabase(p);assert.equal(d.prepare('PRAGMA user_version').get().user_version,33);assert.equal(d.prepare('SELECT id,body FROM messages').get().id,42);assert.equal(d.prepare('SELECT body FROM messages').get().body,'Keep text');for(const [table,body]of[['direct_messages','Keep direct'],['lfg_messages','Keep group'],['event_messages','Keep event']]){assert.equal(d.prepare('SELECT id,body FROM '+table).get().id,42);assert.equal(d.prepare('SELECT body FROM '+table).get().body,body);}assert.equal(d.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);d.close();}d=new DatabaseSync(join(dir,'backup'),{readOnly:true});assert.equal(d.prepare('PRAGMA user_version').get().user_version,32);assert.equal(d.prepare('SELECT body FROM messages').get().body,'Keep text');d.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
