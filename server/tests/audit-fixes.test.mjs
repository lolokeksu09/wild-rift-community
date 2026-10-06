import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {createApp} from '../app.mjs';
import {openDatabase} from '../database.mjs';
import {seedDemoCommunity,demoId} from '../demo-seed.mjs';
import {demoOwnershipPlan,transferDemoOwnership} from '../demo-ownership.mjs';
import {clubSummary} from '../club-summary.mjs';

async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'wr-audit-fixes-')),file=join(dir,'db.sqlite');let app=await createApp({databasePath:file,authLimit:200}),origin=await app.listen();
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const client=()=>({cookie:'',csrf:'',async call(path,method='GET',body){
  const r=await fetch(origin+path,{method,headers:{Cookie:this.cookie,...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;
  return {status:r.status,...data};
 }});
 const clients=[];for(const handle of ['author','reporter','moderator','outsider']){const c=client();assert.equal((await c.call('/api/register','POST',{handle,name:handle,password:'Audit-test-password-123'})).status,201);clients.push(c);}
 return {file,origin,clients,client,async restart(mods=[]){await app.close();app=await createApp({databasePath:file,authLimit:200,moderatorIds:mods});origin=await app.listen();}};
}

test('public reports enforce object access, snapshot privacy, retries and independent audited actions',async t=>{
 const f=await fixture(t),[a,b,m,x]=f.clients;
 const club=(await a.call('/api/clubs','POST',{name:'Open',description:'',access:'open'})).id;
 const privateClub=(await a.call('/api/clubs','POST',{name:'Closed',description:'',access:'request'})).id;
 await b.call('/api/clubs/'+club+'/join','POST',{});
 const post=(await a.call('/api/clubs/'+club+'/posts','POST',{title:'Reported post',body:'Reported body'})).id;
 const hidden=(await a.call('/api/clubs/'+privateClub+'/posts','POST',{title:'Secret',body:'Secret content'})).id;
 const comment=(await a.call('/api/posts/'+post+'/comments','POST',{body:'Reported comment'})).id;
 for(const c of [a,f.client()])assert.notEqual((await c.call('/api/reports','POST',{kind:'post',targetId:post,reason:'Нарушение правил'})).status,201);
 assert.equal((await b.call('/api/reports','POST',{kind:'post',targetId:hidden,reason:'Нарушение правил'})).status,403);
 assert.equal((await b.call('/api/reports','POST',{kind:'profile',targetId:a.id,reason:'Нарушение правил'})).status,404);
 await a.call('/api/me','PATCH',{profileVisible:true,bio:'Public biography',gameProfile:{riotId:'SecretName#XYZ',riotVisible:false}});
 const reports=[];
 for(const [kind,targetId] of [['post',post],['comment',comment],['profile',a.id]]){
  const payload={kind,targetId,reason:'Нарушение правил'};
  const results=await Promise.all([b.call('/api/reports','POST',payload),b.call('/api/reports','POST',payload)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);reports.push(results[0].id);
 }
 await f.restart([m.id,a.id]);
 const queue=(await m.call('/api/moderation/reports')).reports;
 assert.equal(queue.length,3);assert(!queue.find(r=>r.kind==='profile').snapshot.includes('SecretName'));assert(!queue.find(r=>r.kind==='profile').snapshot.includes('demoBot'));
 const profileReport=queue.find(r=>r.kind==='profile'),action={action:'hide-profile',note:'Публичное описание нарушает правила'};
 assert.equal((await m.call(`/api/moderation/reports/${profileReport.id}/action`,'POST',action)).status,409);
 assert.equal((await a.call(`/api/moderation/reports/${profileReport.id}/decision`,'POST',{decision:'upheld',note:'Проверено нарушение'})).status,403);
 for(const r of queue)assert.equal((await m.call(`/api/moderation/reports/${r.id}/decision`,'POST',{decision:'upheld',note:'Нарушение подтверждено'})).status,200);
 for(const r of queue){const payload={action:{profile:'hide-profile',comment:'remove-comment',post:'remove-post'}[r.kind],note:'Проверено и применено'};
  assert.equal((await b.call(`/api/moderation/reports/${r.id}/action`,'POST',payload)).status,403);
  for(let i=0;i<2;i++)assert.equal((await m.call(`/api/moderation/reports/${r.id}/action`,'POST',payload)).status,200);
 }
 assert.equal((await b.call('/api/profiles/'+a.id)).status,404);assert.equal((await b.call('/api/posts/'+post)).status,404);
 const own=(await b.call('/api/reports')).reports;assert(own.every(r=>r.applied_action));assert(own.every(r=>r.sender_id===undefined));
 const db=new DatabaseSync(f.file);assert.equal(db.prepare('SELECT count(*) n FROM moderation_actions').get().n,3);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});

test('catalog searches beyond 100 clubs, lists all own memberships and keeps keyset pages stable',async t=>{
 const f=await fixture(t),[a]=f.clients,db=new DatabaseSync(f.file);
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec('BEGIN;');
 const insert=db.prepare('INSERT INTO clubs(id,owner_id,name,description,access,created_at,tags) VALUES(?,?,?,?,?,?,?)');
 for(let i=0;i<107;i++){insert.run('club-'+String(i).padStart(3,'0'),a.id,i===0?'Старый клуб':'Клуб '+i,'','open',i,JSON.stringify(i===0?['Старая тема']:[]));db.prepare("INSERT INTO memberships VALUES(?,?,'member')").run('club-'+String(i).padStart(3,'0'),a.id);}
 db.exec('COMMIT;');db.close();
 const page=await a.call('/api/clubs');assert.equal(page.total,107);assert.equal(page.clubs.length,100);assert(page.next);assert(page.tags.includes('Старая тема'));
 const search=await a.call('/api/clubs?q='+encodeURIComponent('СТАРЫЙ'));assert.equal(search.clubs[0].id,'club-000');assert.equal(search.total,1);
 const own=await a.call('/api/clubs?scope=mine'),last=await a.call('/api/clubs?scope=mine&after='+own.next);assert.equal(last.clubs.length,7);assert(last.clubs.some(c=>c.id==='club-000'));
 const newClub=(await a.call('/api/clubs','POST',{name:'Новое',description:'',access:'open'})).id;
 const next=await a.call('/api/clubs?after='+page.next);assert.equal(next.clubs.length,7);assert(!next.clubs.some(c=>c.id===newClub));assert.equal(new Set([...page.clubs,...next.clubs].map(c=>c.id)).size,107);
 assert.equal((await a.call('/api/clubs?after=bad')).status,422);assert.equal((await f.client().call('/api/clubs?scope=mine')).status,401);
});

test('compact notification summary matches full private totals and direct pages never overlap',async t=>{
 const f=await fixture(t),[a,b]=f.clients,db=new DatabaseSync(f.file);
 db.exec('PRAGMA foreign_keys=ON;BEGIN;');
 for(let i=0;i<55;i++){
  const peer='peer-'+i,id='conversation-'+i;db.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,?)').run(peer,peer,peer,'unused',1);
  const [lo,hi]=[peer,a.id].sort();db.prepare('INSERT INTO direct_conversations VALUES(?,?,?,?,?,?)').run(id,lo,hi,peer,'accepted',i);
  db.prepare('INSERT INTO direct_messages(conversation_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)').run(id,peer,'message-'+i,'Unread private body',1);
 }
 db.exec('COMMIT;');db.close();
 const summary=await a.call('/api/notifications/summary');assert.equal(summary.direct.unread,55);assert(!JSON.stringify(summary).includes('Unread private body'));
 const first=await a.call('/api/direct'),second=await a.call('/api/direct?after='+first.next);assert.equal(first.conversations.length,50);assert.equal(second.conversations.length,5);assert.equal(first.unread,55);assert.equal(new Set([...first.conversations,...second.conversations].map(c=>c.id)).size,55);
 await a.call('/api/blocks','POST',{userId:'peer-0'});assert.equal((await a.call('/api/direct/summary')).unread,54);assert.equal((await b.call('/api/notifications/summary')).direct.unread,0);
 assert.equal((await f.client().call('/api/notifications/summary')).status,401);
});

test('operator ownership transfer is atomic, repeatable and keeps demo disclosure',async()=>{
 const db=openDatabase(':memory:');
 try{
  await seedDemoCommunity(db);db.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,?)').run('human','lolokeksu','Owner','unused',1);
  assert.throws(()=>demoOwnershipPlan(db,'missing'));assert.equal(demoOwnershipPlan(db,'lolokeksu').clubs.length,6);
  assert.equal(transferDemoOwnership(db,'lolokeksu').changed,6);assert.equal(transferDemoOwnership(db,'lolokeksu').changed,0);
  assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE action='owner-operator-transfer'").get().n,6);
  for(let i=0;i<6;i++){const club=db.prepare('SELECT * FROM clubs WHERE id=?').get(demoId('club:'+i));assert.equal(club.owner_id,'human');assert.equal(db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(club.id,'human').status,'member');assert.equal(clubSummary(db,club,null).isDemoClub,true);}
  assert.equal(db.prepare("SELECT count(*) n FROM users WHERE json_extract(game_profile,'$.demoBot')='community-v1'").get().n,24);
 }finally{db.close();}
});

test('19 to 20 preserves legacy report IDs, decisions, appeals, audit and sequence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-report-migration-')),file=join(dir,'db.sqlite');let db=openDatabase(file);
 try{
  db.exec(`INSERT INTO users(id,handle,name,password,created_at) VALUES('a','aaa','Author','unused',1),('b','bbb','Reporter','unused',1),('m','mmm','Moderator','unused',1);
   INSERT INTO reports(id,reporter_id,kind,message_id,target_id,sender_id,snapshot,reason,status,decision_note,moderator_id,created_at,decision_seen) VALUES(7,'b','direct',9,'9','a','Original message','Original reason','upheld','Original decision','m',1,1);
   INSERT INTO reports(id,reporter_id,kind,message_id,target_id,sender_id,snapshot,reason,created_at) VALUES(999,'b','club',99,'99','a','Deleted report','Deleted reason',1);
   DELETE FROM reports WHERE id=999;
   INSERT INTO report_appeals(report_id,reason,created_at) VALUES(7,'Original appeal',1);
   INSERT INTO moderation_audit(report_id,actor_id,decision,note,created_at) VALUES(7,'m','upheld','Original audit',1);
   PRAGMA foreign_keys=OFF;BEGIN;
   CREATE TABLE reports_19(id INTEGER PRIMARY KEY AUTOINCREMENT,reporter_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('direct','club')),message_id INTEGER NOT NULL,sender_id TEXT NOT NULL REFERENCES users(id),snapshot TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),decision_note TEXT NOT NULL DEFAULT '',moderator_id TEXT REFERENCES users(id),created_at INTEGER NOT NULL,decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1)),UNIQUE(reporter_id,kind,message_id)) STRICT;
   INSERT INTO reports_19 SELECT id,reporter_id,kind,message_id,sender_id,snapshot,reason,status,decision_note,moderator_id,created_at,decision_seen FROM reports;
   DROP TABLE moderation_actions;DROP TABLE reports;ALTER TABLE reports_19 RENAME TO reports;
   UPDATE sqlite_sequence SET seq=999 WHERE name='reports';DROP INDEX direct_messages_unread;
   PRAGMA user_version=19;COMMIT;`);
  db.close();db=openDatabase(file);
  for(let i=0;i<2;i++){
   assert.equal(db.prepare('PRAGMA user_version').get().user_version,20);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
   const r=db.prepare('SELECT * FROM reports WHERE id=7').get();assert.equal(r.target_id,'9');assert.equal(r.snapshot,'Original message');assert.equal(r.decision_seen,1);
   assert.equal(db.prepare('SELECT reason FROM report_appeals').get().reason,'Original appeal');assert.equal(db.prepare('SELECT note FROM moderation_audit').get().note,'Original audit');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   db.close();db=openDatabase(file);
  }
  assert(db.prepare("INSERT INTO reports(reporter_id,kind,target_id,sender_id,snapshot,reason,created_at) VALUES('b','profile','a','a','Profile','Reason',1)").run().lastInsertRowid>999);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('only versioned public assets receive immutable caching; API and page HTML stay private',async t=>{
 const f=await fixture(t),[a]=f.clients;
 const html=await fetch(f.origin);assert.equal(html.headers.get('cache-control'),'no-store');
 const path=(await html.text()).match(/src="(\/app\.js\?v=[a-f0-9]+)"/)[1];
 assert.equal((await fetch(f.origin+path)).headers.get('cache-control'),'public, max-age=31536000, immutable');
 for(const path of ['/app.js','/app.js?v=old','/api/me','/api/notifications/summary'])assert.equal((await fetch(f.origin+path,{headers:{Cookie:a.cookie}})).headers.get('cache-control'),'no-store');
});

test('ownership CLI defaults to read-only, creates verified backup before apply and refuses collisions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-owner-cli-')),file=join(dir,'source.sqlite'),copy=join(dir,'before.sqlite');
 let db=openDatabase(file);
 try{
  await seedDemoCommunity(db);db.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,?)').run('human','lolokeksu','Owner','unused',1);db.close();db=null;
  const cli=new URL('../demo-ownership-cli.mjs',import.meta.url);
  const run=(...args)=>spawnSync(process.execPath,[cli.pathname.replace(/^\/([A-Z]:)/,'$1'),file,'lolokeksu',...args],{encoding:'utf8'});
  const dry=run();assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).dryRun,true);
  assert.notEqual(run('--check').status,0);
  const before=new DatabaseSync(file,{readOnly:true});assert.notEqual(before.prepare('SELECT owner_id FROM clubs LIMIT 1').get().owner_id,'human');before.close();
  const applied=run('--apply',copy);assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).changed,6);
  const verified=run('--check');assert.equal(verified.status,0,verified.stderr);assert.equal(JSON.parse(verified.stdout).verified,true);
  const backup=new DatabaseSync(copy,{readOnly:true});assert.notEqual(backup.prepare('SELECT owner_id FROM clubs LIMIT 1').get().owner_id,'human');assert.deepEqual(backup.prepare('PRAGMA foreign_key_check').all(),[]);backup.close();
  assert.notEqual(run('--apply',copy).status,0);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('blocks do not prevent reports or hide club content from its staff',async t=>{
 const f=await fixture(t),[owner,victim,mod,author]=f.clients;
 const club=(await owner.call('/api/clubs','POST',{name:'Staff',description:'',access:'open'})).id;
 for(const c of [victim,mod,author])await c.call('/api/clubs/'+club+'/join','POST',{});
 await owner.call('/api/clubs/'+club+'/moderators','PUT',{userId:mod.id});
 await author.call('/api/me','PATCH',{profileVisible:true});
 const post=(await author.call('/api/clubs/'+club+'/posts','POST',{title:'Spam',body:'Spam body',clientId:'staff-spam-post-0001'})).id;
 const parent=(await author.call('/api/posts/'+post+'/comments','POST',{body:'Spam comment',clientId:'staff-spam-comm-0001'})).id;
 const reply=(await victim.call('/api/posts/'+post+'/comments','POST',{body:'Ответ',parentId:parent,clientId:'staff-reply-comm-0001'})).id;
 const dm=await author.call('/api/direct','POST',{handle:'reporter',body:'Оскорбление',clientId:'staff-direct-msg-0001'});
 const message=(await victim.call('/api/direct')).conversations.find(c=>c.id===dm.id).first_message_id;
 // Either side may block first; the reporter keeps the right to report what they could access.
 for(const [blocker,target] of [[victim,author],[author,victim]]){
  await blocker.call('/api/blocks','POST',{userId:target.id});
  for(const [kind,targetId] of [['direct',message],['post',post],['comment',parent],['profile',author.id]])assert([200,201].includes((await victim.call('/api/reports','POST',{kind,targetId,reason:'Нарушение правил'})).status),kind);
  await blocker.call('/api/blocks','DELETE',{userId:target.id});
 }
 for(const staff of [owner,mod])await author.call('/api/blocks','POST',{userId:staff.id});
 for(const staff of [owner,mod]){
  assert((await staff.call('/api/clubs/'+club+'/posts')).posts.some(p=>p.id===post));
  assert.equal((await staff.call('/api/posts/'+post)).status,200);
  const list=await staff.call('/api/posts/'+post+'/comments');assert.equal(list.canModerate,true);assert.equal(list.clubId,club);assert(list.comments.some(c=>c.id===parent));
  // Reading is exempt for moderation; interacting with the blocker stays closed.
  assert.equal((await staff.call('/api/posts/'+post+'/comments','POST',{body:'x',clientId:'staff-blocked-comm-01'+staff.id.slice(0,3)})).status,404);
 }
 assert.equal((await victim.call('/api/posts/'+post+'/comments')).canModerate,false);
 assert.equal((await victim.call('/api/clubs/'+club+'/comments/'+parent,'DELETE',{})).status,403);
 assert.equal((await mod.call('/api/clubs/'+club+'/pins/'+post,'PUT',{})).status,200);
 assert.equal((await mod.call('/api/clubs/'+club+'/comments/'+parent,'DELETE',{})).status,200);
 assert.equal((await mod.call('/api/clubs/'+club+'/comments/'+parent,'DELETE',{})).status,404);
 const kept=(await victim.call('/api/posts/'+post+'/comments')).comments;assert(!kept.some(c=>c.id===parent));assert.equal(kept.find(c=>c.id===reply).parent_id,null);
 assert((await owner.call('/api/clubs/'+club+'/audit')).entries.some(e=>e.action==='comment-remove'&&e.target_id===String(parent)));
 assert.equal((await owner.call('/api/clubs/'+club+'/posts/'+post,'DELETE',{})).status,200);
 // A staff member's own block still hides that author's new content.
 await author.call('/api/blocks','DELETE',{userId:owner.id});await owner.call('/api/blocks','POST',{userId:author.id});
 const next=(await author.call('/api/clubs/'+club+'/posts','POST',{title:'Next',body:'Body',clientId:'staff-spam-post-0002'})).id;
 assert(!(await owner.call('/api/clubs/'+club+'/posts')).posts.some(p=>p.id===next));
});

test('confirmed violations escalate account sanctions; mass reports on one object count once',async t=>{
 const f=await fixture(t),[a,b,m,x]=f.clients;
 await f.restart([m.id,x.id]);
 const club=(await a.call('/api/clubs','POST',{name:'Sanctions',description:'',access:'open'})).id;
 for(const c of [b,m,x])await c.call('/api/clubs/'+club+'/join','POST',{});
 const posts=[];for(let n=1;n<=5;n++)posts[n]=(await a.call('/api/clubs/'+club+'/posts','POST',{title:'Нарушение '+n,body:'Текст',clientId:'sanction-post-'+String(n).padStart(6,'0')})).id;
 const violate=async(n,reporters=[b])=>{
  const post=posts[n];
  for(const r of reporters){const report=await r.call('/api/reports','POST',{kind:'post',targetId:post,reason:'Нарушение правил'});const mod=r===m?x:m;assert.equal((await mod.call(`/api/moderation/reports/${report.id}/decision`,'POST',{decision:'upheld',note:'Подтверждено'})).status,200);}
  return post;
 };
 await violate(1,[b,m]);
 // Two reporters on one post are one violation: a warning, no restriction.
 assert.deepEqual([(await a.call('/api/me')).sanction.level,(await a.call('/api/me')).sanction.violations],['warning',1]);
 await violate(2);
 const me=await a.call('/api/me');assert.equal(me.sanction.level,'restricted');assert(me.sanction.until>Date.now()+23*3600000);
 for(const [path,method,body] of [['/api/clubs/'+club+'/posts','POST',{title:'t',body:'b',clientId:'sanction-post-blocked1'}],['/api/clubs/'+club+'/messages','POST',{body:'x',clientId:'sanction-chat-blocked1'}],['/api/clubs','POST',{name:'New',description:'',access:'open'}],['/api/me','PATCH',{bio:'new'}]])
  assert.equal((await a.call(path,method,body)).status,403,path);
 assert.equal((await a.call('/api/me','PATCH',{profileVisible:false})).status,200,'hiding the profile stays possible');
 assert.equal((await a.call('/api/reports','POST',{kind:'profile',targetId:b.id,reason:'Проверка'})).status,404,'reports stay available (404 = unpublished profile)');
 const queue=(await m.call('/api/moderation/reports')).reports;assert.equal(queue.find(r=>r.sender_id===a.id).senderSanction.level,'restricted');
 await violate(3);await violate(4);await violate(5);
 const login=await a.call('/api/me');assert.equal(login.status,200);assert.equal(login.user,null,'suspension ends the session');
 const again=f.client();const denied=await again.call('/api/login','POST',{handle:'author',password:'Audit-test-password-123'});
 assert.equal(denied.status,403);assert.match(denied.error,/приостановлен/);
});

test('authors delete own posts after leaving but not while banned; stale unattached uploads expire',async t=>{
 const f=await fixture(t),[owner,author]=f.clients;
 const club=(await owner.call('/api/clubs','POST',{name:'Leave',description:'',access:'request'})).id;
 await author.call('/api/clubs/'+club+'/join','POST',{});await owner.call('/api/clubs/'+club+'/decision','POST',{userId:author.id,decision:'approve'});
 const [kept,removed]=[1,2].map(n=>'leave-post-00000'+n);const posts=[];for(const id of [kept,removed])posts.push((await author.call('/api/clubs/'+club+'/posts','POST',{title:id,body:'Текст',clientId:id})).id);
 await author.call('/api/clubs/'+club+'/leave','POST',{});
 assert.equal((await author.call('/api/posts/'+posts[1])).status,403,'a private club stays unreadable after leaving');
 assert.equal((await author.call('/api/posts/'+posts[1],'DELETE',{})).status,200);
 assert.equal((await owner.call('/api/posts/'+posts[1])).status,404);
 assert.equal((await owner.call('/api/posts/'+posts[0],'DELETE',{})).status,403,'only the author removes through this route');
 await author.call('/api/clubs/'+club+'/join','POST',{});await owner.call('/api/clubs/'+club+'/ban','POST',{userId:author.id});
 assert.equal((await author.call('/api/posts/'+posts[0],'DELETE',{})).status,403);
 const {openDatabase}=await import('../database.mjs'),{saveImage}=await import('../media.mjs');
 const db=openDatabase(':memory:');t.after(()=>db.close());
 db.prepare("INSERT INTO users(id,handle,name,password,created_at) VALUES('u','u','U','x',0)").run();
 const image=(key,time)=>saveImage(db,{id:'u'},key.padEnd(16,'0'),Buffer.from(key),{bytes:Buffer.from('webp'),width:1,height:1,size:4},()=>time).image.id;
 const day=86400000,orphan=image('orphan',0),avatar=image('avatar',0);db.prepare('UPDATE users SET avatar_id=? WHERE id=?').run(avatar,'u');
 image('fresh',day-1);assert(db.prepare('SELECT 1 FROM media WHERE id=?').get(orphan),'younger than a day stays');
 image('later',day+1);assert(!db.prepare('SELECT 1 FROM media WHERE id=?').get(orphan));assert(db.prepare('SELECT 1 FROM media WHERE id=?').get(avatar),'attached images stay');
});
