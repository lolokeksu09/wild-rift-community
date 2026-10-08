import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {openDatabase} from '../database.mjs';
import {createApp} from '../app.mjs';

test('club schema 12 → 13 preserves accounts, roles source, private posts, events and media; repeatable',t=>{
 const dir=mkdtempSync(tmpdir()+'/wr-club-migrate-');t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=dir+'/community.sqlite';let d=new DatabaseSync(file);d.exec(readFileSync(new URL('./fixtures/schema-v12.sql',import.meta.url),'utf8'));
 d.exec(`INSERT INTO users(id,handle,name,password,created_at) VALUES('u','owner','Owner','samehash',1);INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES('c','u','Private','','request',1);INSERT INTO memberships VALUES('c','u','member');INSERT INTO posts(id,club_id,author_id,title,body,created_at) VALUES(1,'c','u','Old','Keep text',1);INSERT INTO comments(id,post_id,author_id,body,created_at) VALUES(1,1,'u','Root',1);INSERT INTO comments(id,post_id,author_id,body,created_at,parent_id) VALUES(2,1,'u','Reply',1,1);INSERT INTO post_reactions VALUES(1,'u','useful');INSERT INTO saved_posts VALUES(1,'u',1);INSERT INTO discussion_notifications(user_id,actor_id,post_id,comment_id,kind,created_at) VALUES('u','u',1,2,'reply',1);INSERT INTO media VALUES('pic','u','attempt','sig',X'010203',1,1,3,1);`);d.close();cpSync(file,dir+'/backup.sqlite');
 for(let i=0;i<2;i++){d=openDatabase(file);assert.equal(d.prepare('PRAGMA user_version').get().user_version,23);assert.equal(d.prepare('SELECT owner_id,rules,accent FROM clubs').get().owner_id,'u');assert.equal(d.prepare('SELECT count(*) n FROM club_moderators').get().n,0);assert.equal(d.prepare('SELECT body FROM posts').get().body,'Keep text');assert.equal(d.prepare('SELECT parent_id FROM comments WHERE id=2').get().parent_id,1);assert.equal(d.prepare('SELECT kind FROM post_reactions').get().kind,'useful');assert.equal(d.prepare('SELECT count(*) n FROM saved_posts').get().n,1);assert.equal(d.prepare('SELECT count(*) n FROM discussion_notifications').get().n,1);assert.equal(d.prepare('SELECT hex(bytes) b FROM media').get().b,'010203');assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(d.prepare('PRAGMA integrity_check').get().integrity_check,'ok');d.close();}
 d=new DatabaseSync(dir+'/backup.sqlite');assert.equal(d.prepare('PRAGMA user_version').get().user_version,12);d.close();
});
test('club management: scoped powers, pins, invite limits, audit, ownership consent and restarts',async t=>{
 const dir=mkdtempSync(tmpdir()+'/wr-clubs-');let clock=Date.now(),app=await createApp({databasePath:dir+'/community.sqlite',now:()=>clock}),origin=await app.listen();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {id:null,cookie:'',csrf:'',async req(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{Cookie:this.cookie,Origin:origin,'X-Community-Request':'1','X-CSRF-Token':this.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {...data,status:r.status};}};}
 async function account(handle){const c=client();assert.equal((await c.req('/api/register','POST',{handle,name:handle,password:'Club-management-test-123'})).status,201);return c;}
 const owner=await account('club_owner'),mod=await account('club_mod'),member=await account('club_member'),target=await account('club_target'),outside=await account('club_outside'),guest=client();
 const club=await owner.req('/api/clubs','POST',{name:'Club',description:'Private club',access:'request'}),other=await outside.req('/api/clubs','POST',{name:'Other',description:'',access:'open'}),path='/api/clubs/'+club.id;
 for(const c of [mod,member,target]){await c.req(path+'/join','POST',{});await owner.req(path+'/decision','POST',{userId:c.id,decision:'approve'});}
 assert.equal((await guest.req('/api/clubs/'+other.id+'/pins')).status,200);
 const posts=[];for(let i=0;i<4;i++)posts.push((await owner.req(path+'/posts','POST',{title:'Post '+i,body:'Secret body'})).id);
 await t.test('public rules/tags/accent and compare-and-set protect concurrent settings; owner only',async()=>{
  const settings={version:0,rules:'Правила <img src=x>',tags:['Ранкед','РАНКЕД','Лес'],accent:'violet'};assert.equal((await owner.req(path+'/settings','PATCH',settings)).status,200);const data=await guest.req(path+'/detail');assert.deepEqual(data.club.tags,['ранкед','лес']);assert.equal(data.club.rules,settings.rules);assert.equal(data.club.accent,'violet');assert.equal((await member.req(path+'/settings','PATCH',{...settings,version:1})).status,403);assert.equal((await owner.req(path+'/settings','PATCH',settings)).status,409);assert.equal((await owner.req(path+'/settings','PATCH',{version:1,tags:['<script>']})).status,422);assert.equal((await guest.req(path+'/pins')).status,403);
 });
 await t.test('moderator powers are scoped and cannot grant roles, change settings/invites or owner',async()=>{
  for(let i=0;i<2;i++)assert.equal((await owner.req(path+'/moderators','PUT',{userId:mod.id})).status,200);
  assert.equal((await mod.req(path+'/detail')).club.myRole,'moderator');assert.equal((await mod.req('/api/me')).user.isModerator,false);
  for(const [route,method,body] of [['/settings','PATCH',{version:1,rules:'No'}],['/moderators','PUT',{userId:member.id}],['/invites','POST',{clientId:'mod-invite-attempt'}],['/transfer','POST',{userId:target.id,clientId:'mod-transfer-attempt'}]])assert.equal((await mod.req(path+route,method,body)).status,403);
  assert.equal((await mod.req('/api/clubs/'+other.id+'/moderators','PUT',{userId:outside.id})).status,403);assert.equal((await mod.req(path+'/ban','POST',{userId:owner.id})).status,409);assert.equal((await owner.req(path+'/ban','POST',{userId:mod.id})).status,409);assert.equal((await member.req(path+'/audit')).status,403);
  await outside.req(path+'/join','POST',{});assert.equal((await mod.req(path+'/decision','POST',{userId:outside.id,decision:'approve'})).status,200);assert.equal((await mod.req(path+'/members')).members.length,5);
 });
 await t.test('three pins, idempotent pinning, foreign-club denial, private visibility and content moderation',async()=>{
  for(const post of posts.slice(0,3)){for(let i=0;i<2;i++)assert.equal((await mod.req(path+'/pins/'+post,'PUT',{})).status,200);}
  assert.equal((await mod.req(path+'/pins/'+posts[3],'PUT',{})).status,409);assert.equal((await member.req(path+'/pins')).posts.length,3);assert.equal((await guest.req(path+'/pins')).status,403);
  const foreign=(await outside.req('/api/clubs/'+other.id+'/posts','POST',{title:'Other',body:'Other'})).id;assert.equal((await mod.req(path+'/pins/'+foreign,'PUT',{})).status,404);assert.equal((await mod.req('/api/clubs/'+other.id+'/pins/'+foreign,'PUT',{})).status,403);assert.equal((await member.req(path+'/pins/'+posts[0],'DELETE',{})).status,403);
  const journal=await owner.req(path+'/audit');assert.equal(journal.entries.filter(e=>e.action==='pin').length,3);assert.equal(journal.entries.filter(e=>e.action==='moderator-grant').length,1);
  assert.equal((await mod.req(path+'/posts/'+posts[0],'DELETE',{})).status,200);assert.equal((await member.req(path+'/pins')).posts.length,2);assert.equal((await owner.req('/api/posts/'+posts[0])).status,404);
 });
 await t.test('revocation and departure immediately remove moderator powers',async()=>{
  await owner.req(path+'/moderators','DELETE',{userId:mod.id});assert.equal((await mod.req(path+'/audit')).status,403);assert.equal((await mod.req(path+'/ban','POST',{userId:member.id})).status,403);
  await owner.req(path+'/moderators','PUT',{userId:mod.id});await mod.req(path+'/leave','POST',{});assert.equal((await mod.req(path+'/audit')).status,403);await mod.req(path+'/join','POST',{});await owner.req(path+'/decision','POST',{userId:mod.id,decision:'approve'});assert.equal((await mod.req(path+'/detail')).club.myRole,'member');await owner.req(path+'/moderators','PUT',{userId:mod.id});
 });
 let invite,joiner;
 await t.test('invite retries store only hash; concurrent last use, approval, ban and replay are enforced',async()=>{
  const payload={clientId:'club-invite-attempt',maxUses:1,durationHours:24};invite=await owner.req(path+'/invites','POST',payload);assert.equal(invite.status,201);const retry=await owner.req(path+'/invites','POST',payload);assert.equal(retry.id,invite.id);assert.equal(retry.token,invite.token);assert.equal((await owner.req(path+'/invites','POST',{...payload,maxUses:2})).status,409);
  const d=new DatabaseSync(dir+'/community.sqlite'),row=d.prepare('SELECT * FROM club_invites WHERE id=?').get(invite.id);assert.notEqual(row.token_hash,invite.token);assert(!JSON.stringify(row).includes(invite.token));d.close();
  const a=await account('invite_one'),b=await account('invite_two');assert.equal((await a.req('/api/club-invites/preview','POST',{token:invite.token})).club.id,club.id);assert.equal((await a.req('/api/posts/'+posts[1])).status,403);
  const attempts=await Promise.all([a.req('/api/club-invites/accept','POST',{token:invite.token}),b.req('/api/club-invites/accept','POST',{token:invite.token})]);assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);joiner=attempts[0].status===200?a:b;assert.equal(attempts.find(x=>x.status===200).status===200,true);assert.equal((await joiner.req(path+'/detail')).club.membership,'pending');assert.equal((await joiner.req('/api/posts/'+posts[1])).status,403);
  assert.equal((await joiner.req('/api/club-invites/accept','POST',{token:invite.token})).status,200);assert.equal((await owner.req(path+'/invites')).invites.find(i=>i.id===invite.id).uses,1);
  await mod.req(path+'/decision','POST',{userId:joiner.id,decision:'approve'});assert.equal((await joiner.req('/api/posts/'+posts[1])).status,200);
  await mod.req(path+'/ban','POST',{userId:joiner.id});await joiner.req(path+'/leave','POST',{});assert.equal((await joiner.req('/api/club-invites/accept','POST',{token:invite.token})).status,403);assert.equal((await mod.req(path+'/unban','POST',{userId:joiner.id})).status,403);await owner.req(path+'/unban','POST',{userId:joiner.id});assert.equal((await joiner.req('/api/club-invites/accept','POST',{token:invite.token})).status,409);
 });
 await t.test('revoked, expired and blocked invites stop working without removing existing membership',async()=>{
  const invite2=await owner.req(path+'/invites','POST',{clientId:'club-invite-second',durationHours:1,maxUses:10});assert.equal((await member.req('/api/club-invites/accept','POST',{token:invite2.token})).status,200);await owner.req(path+'/invites/'+invite2.id,'DELETE',{});assert.equal((await member.req('/api/club-invites/preview','POST',{token:invite2.token})).status,404);assert.equal((await member.req(path+'/detail')).club.membership,'member');
  const blocked=await owner.req(path+'/invites','POST',{clientId:'club-invite-blocked',durationHours:1,maxUses:10});await member.req('/api/blocks','POST',{userId:owner.id});assert.equal((await member.req('/api/club-invites/preview','POST',{token:blocked.token})).status,404);await member.req('/api/blocks','DELETE',{userId:owner.id});clock+=2*3600000;assert.equal((await member.req('/api/club-invites/preview','POST',{token:blocked.token})).status,404);
 });
 await t.test('ownership offer needs recipient consent, active membership and current offer; expiry/cancel safe',async()=>{
  const offered=await owner.req(path+'/transfer','POST',{userId:target.id,clientId:'club-transfer-attempt'});assert.equal(offered.status,201);assert.equal((await owner.req(path+'/detail')).club.myRole,'owner');assert.equal((await target.req(path+'/detail')).transfer.id,offered.id);assert.equal((await member.req(path+'/detail')).transfer,null);assert.equal((await mod.req(path+'/transfer/accept','POST',{offerId:offered.id})).status,403);
  await target.req(path+'/leave','POST',{});assert.equal((await target.req(path+'/transfer/accept','POST',{offerId:offered.id})).status,403);await target.req(path+'/join','POST',{});await owner.req(path+'/decision','POST',{userId:target.id,decision:'approve'});
  clock+=25*3600000;assert.equal((await target.req(path+'/transfer/accept','POST',{offerId:offered.id})).status,409);const again=await owner.req(path+'/transfer','POST',{userId:target.id,clientId:'club-transfer-again'});assert.equal(again.status,201);for(let i=0;i<2;i++)assert.equal((await target.req(path+'/transfer/cancel','POST',{offerId:again.id})).status,200);assert.equal((await target.req(path+'/transfer/accept','POST',{offerId:again.id})).status,409);
 });
 let activeInvite;
 await t.test('accepted transfer atomically changes powers, revokes invitations and survives restart',async()=>{
  activeInvite=await owner.req(path+'/invites','POST',{clientId:'club-invite-before-transfer',maxUses:10,durationHours:24});const offer=await owner.req(path+'/transfer','POST',{userId:target.id,clientId:'club-transfer-final'});
  for(let i=0;i<2;i++)assert.equal((await target.req(path+'/transfer/accept','POST',{offerId:offer.id})).status,200);
  assert.equal((await owner.req(path+'/detail')).club.myRole,'member');assert.equal((await target.req(path+'/detail')).club.myRole,'owner');assert.equal((await owner.req(path+'/settings','PATCH',{version:2,rules:'Old owner'})).status,403);assert.equal((await owner.req(path+'/invites')).status,403);assert.equal((await member.req('/api/club-invites/preview','POST',{token:activeInvite.token})).status,404);assert.equal((await target.req(path+'/leave','POST',{})).status,409);
  await app.close();app=await createApp({databasePath:dir+'/community.sqlite',now:()=>clock});origin=await app.listen();assert.equal((await target.req(path+'/detail')).club.myRole,'owner');assert.equal((await mod.req(path+'/detail')).club.myRole,'moderator');assert.equal((await target.req(path+'/pins')).posts.length,2);assert((await target.req(path+'/audit')).entries.some(e=>e.action==='transfer-accept'));
  await owner.req(path+'/leave','POST',{});assert.equal((await owner.req(path+'/members')).status,403);const d=new DatabaseSync(dir+'/community.sqlite');assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);d.close();
 });
 await t.test('member filtering and admin journal paginate before limits without overlap',async()=>{
  const d=new DatabaseSync(dir+'/community.sqlite');
  for(let i=0;i<125;i++){const uid='fixture-'+i,handle='page'+String(i).padStart(3,'0');d.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,?)').run(uid,handle,handle,'fixture-only',1);d.prepare('INSERT INTO memberships VALUES(?,?,?)').run(club.id,uid,i<25?'pending':'member');}
  for(let i=0;i<60;i++)d.prepare('INSERT INTO audit(actor_id,club_id,target_id,action,created_at) VALUES(?,?,?,?,?)').run(target.id,club.id,club.id,'settings',clock);d.close();
  const first=await member.req(path+'/members'),tail=await member.req(path+'/members?after='+first.next);assert.equal(first.members.length,100);assert(first.members.every(m=>m.status==='member'));assert(tail.members.length>0);assert.equal(new Set([...first.members,...tail.members].map(m=>m.id)).size,first.members.length+tail.members.length);
  const staff=await target.req(path+'/members');assert(staff.members.some(m=>m.status==='pending'));assert.equal((await member.req(path+'/members?after=bad!')).status,422);
  const log=await target.req(path+'/audit'),old=await target.req(path+'/audit?before='+log.next);assert.equal(log.entries.length,50);assert(old.entries.length>0);assert(!old.entries.some(e=>log.entries.some(x=>x.id===e.id)));assert.equal((await member.req(path+'/audit')).status,403);
 });

});
