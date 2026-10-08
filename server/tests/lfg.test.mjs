import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.mjs';

test('looking for group: capacity, lifecycle, private chat',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-direct-')),databasePath=join(dir,'db.sqlite');
 let clock=Date.now();const options={databasePath,now:()=>clock};let app=await createApp(options),origin=await app.listen();
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {cookie:'',csrf:'',async request(path,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {status:r.status,data};}};}
 const a=client(),b=client(),c=client(),guest=client();for(const [u,handle] of [[a,'alice'],[b,'bravo'],[c,'charlie']])assert.equal((await u.request('/api/register','POST',{handle,name:handle,password:'local-test-password-123'})).status,201);
 const input={clientId:'lfg-create-stable-0001',title:'Ищем лесника',mode:'ranked',region:'eu',language:'ru',role:'jungle',rank:'Любой',voice:'optional',description:'Играем вместе',capacity:2,durationHours:1};let id,route,winner,loser;
 await t.test('creation retries are unique, filters work, capacity includes owner',async()=>{
  const results=await Promise.all([a.request('/api/lfg','POST',input),a.request('/api/lfg','POST',input)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);id=results[0].data.id;route=`/api/lfg/${id}`;
  assert.equal((await a.request('/api/lfg','POST',{...input,title:'Изменено'})).status,409);
  assert.equal((await a.request(route)).data.group.members,1);
  assert.equal((await b.request('/api/lfg?role=jungle&region=eu')).data.groups.length,1);
  assert.equal((await b.request('/api/lfg?region=other')).data.groups.length,0);
  assert.equal((await guest.request('/api/lfg')).status,401);
  assert.equal((await b.request(route)).data.members.length,0);
 });
 await t.test('pending requests have no chat; competing accepts cannot overfill',async()=>{
  for(const u of [b,c]){await u.request(route+'/apply','POST',{});await u.request(route+'/apply','POST',{});assert.equal((await u.request(route+'/messages')).status,403);}
  assert.equal((await b.request(route+'/decision','POST',{userId:c.id,decision:'accept'})).status,403);
  const results=await Promise.all([a.request(route+'/decision','POST',{userId:b.id,decision:'accept'}),a.request(route+'/decision','POST',{userId:c.id,decision:'accept'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);winner=results[0].status===200?b:c;loser=winner===b?c:b;
  const group=(await a.request(route)).data.group;assert.equal(group.members,2);assert.equal(group.state,'full');
  assert.equal((await loser.request(route+'/messages')).status,403);
  assert.equal((await a.request(route+'/leave','POST',{})).status,409);
 });
 await t.test('group chat retries, page cursors and server restart',async()=>{
  const payload={clientId:'lfg-message-stable-001',body:'Готов играть'};
  assert.equal((await winner.request(route+'/messages','POST',payload)).status,201);assert.equal((await winner.request(route+'/messages','POST',payload)).status,200);
  assert.equal((await winner.request(route+'/messages','POST',{...payload,body:'Другой текст'})).status,409);
  for(let i=0;i<51;i++)await a.request(route+'/messages','POST',{clientId:`lfg-history-message-${i}`,body:'История '+i});
  const latest=(await winner.request(route+'/messages')).data;assert.equal(latest.messages.length,50);assert(latest.hasMore);
  const older=(await winner.request(route+'/messages?before='+latest.next)).data;assert.equal(older.messages.length,2);assert.equal(new Set([...older.messages,...latest.messages].map(m=>m.id)).size,52);
  await app.close();app=await createApp(options);origin=await app.listen();assert.equal((await winner.request(route+'/messages','POST',payload)).status,200);
 });
 await t.test('leaving releases a slot and revokes reads, exclusion prevents reapply',async()=>{
  await winner.request(route+'/leave','POST',{});assert.equal((await winner.request(route+'/messages')).status,403);assert.equal((await a.request(route)).data.group.state,'open');
  await a.request(route+'/decision','POST',{userId:loser.id,decision:'accept'});assert.equal((await loser.request(route+'/messages')).status,200);
  await a.request(route+'/decision','POST',{userId:loser.id,decision:'reject'});assert.equal((await loser.request(route+'/messages')).status,403);assert.equal((await loser.request(route+'/apply','POST',{})).status,403);
 });
 await t.test('blocked owner cannot receive application; accepted chat filters blocked authors',async()=>{
  await a.request('/api/blocks','POST',{userId:winner.id});assert.equal((await winner.request(route+'/apply','POST',{})).status,403);assert.equal((await winner.request('/api/lfg')).data.groups.length,0);
  await a.request('/api/blocks','DELETE',{userId:winner.id});await winner.request(route+'/apply','POST',{});await a.request(route+'/decision','POST',{userId:winner.id,decision:'accept'});
  await winner.request('/api/blocks','POST',{userId:a.id});const history=(await winner.request(route+'/messages')).data;assert(history.messages.every(m=>m.sender_id!==a.id));
 });
 await t.test('close and expiry stop recruitment/sending, retained members may read history',async()=>{
  assert.equal((await winner.request(route+'/close','POST',{})).status,403);
  await a.request(route+'/close','POST',{});assert.equal((await a.request(route)).data.group.state,'closed');
  assert.equal((await winner.request(route+'/messages','POST',{clientId:'closed-group-message',body:'Нет'})).status,409);assert.equal((await winner.request(route+'/messages')).status,200);
  const second=(await a.request('/api/lfg','POST',{...input,clientId:'lfg-second-group-0002'})).data.id;clock+=3600001;
  assert.equal((await a.request('/api/lfg/'+second)).data.group.state,'expired');assert.equal((await c.request(`/api/lfg/${second}/apply`,'POST',{})).status,409);
  assert.equal((await a.request(`/api/lfg/${second}/messages`,'POST',{clientId:'expired-group-message',body:'Нет'})).status,409);
  assert.equal((await a.request('/api/lfg')).data.groups.length,0);assert.equal((await a.request('/api/lfg?mine=1')).data.groups.length,2);
 });
 await t.test('notifications are private, transactional, repeat-safe and persistent',async()=>{
  const countEvents=async(u)=>(await u.request('/api/lfg/notifications')).data.notifications.length;
  const fresh=(await a.request('/api/lfg','POST',{...input,clientId:'notification-group-01'})).data.id,p=`/api/lfg/${fresh}`;
  const ownerBefore=await countEvents(a),playerBefore=await countEvents(loser);
  await loser.request(p+'/apply','POST',{});await loser.request(p+'/apply','POST',{});assert.equal(await countEvents(a),ownerBefore+1);
  await a.request(p+'/decision','POST',{userId:loser.id,decision:'accept'});await a.request(p+'/decision','POST',{userId:loser.id,decision:'accept'});assert.equal(await countEvents(loser),playerBefore+1);
  await loser.request(p+'/leave','POST',{});await loser.request(p+'/leave','POST',{});assert.equal(await countEvents(a),ownerBefore+2);
  await loser.request(p+'/apply','POST',{});await a.request(p+'/close','POST',{});await a.request(p+'/close','POST',{});assert.equal(await countEvents(loser),playerBefore+2);
  const events=(await loser.request('/api/lfg/notifications')).data;assert.equal(events.viewerId,loser.id);assert.equal(events.notifications[0].kind,'closed');assert.equal(events.notifications[0].body,undefined);assert.equal(events.notifications[0].user_id,undefined);
  const note=events.notifications[0].id;assert.equal((await winner.request(`/api/lfg/notifications/${note}/read`,'POST',{})).status,404);
  assert.equal((await guest.request('/api/lfg/notifications')).status,401);assert.equal((await loser.request('/api/lfg/notifications?before=-1')).status,422);
  const before=(await loser.request('/api/lfg/notifications/summary')).data.unread;
  for(let i=0;i<2;i++)assert.equal((await loser.request(`/api/lfg/notifications/${note}/read`,'POST',{})).status,200);
  assert.equal((await loser.request('/api/lfg/notifications/summary')).data.unread,before-1);
  await app.close();app=await createApp(options);origin=await app.listen();assert.equal((await loser.request('/api/lfg/notifications/summary')).data.unread,before-1);
  const page=(await loser.request('/api/lfg/notifications?before='+note)).data;assert(page.notifications.every(n=>n.id<note));
 });

});
