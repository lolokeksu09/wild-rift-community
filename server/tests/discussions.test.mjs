import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {openDatabase} from '../database.mjs';
import {createApp} from '../app.mjs';

test('schema 11 → current preserves posts, legacy comments, sessions and media; migration is repeatable',t=>{
 const dir=mkdtempSync(tmpdir()+'/wr-discussion-migrate-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=dir+'/community.sqlite';let db=new DatabaseSync(path);db.exec(readFileSync(new URL('./fixtures/schema-v11.sql',import.meta.url),'utf8'));
 db.exec(`INSERT INTO users(id,handle,name,password,created_at) VALUES('u','keep','Keep','samehash',1);INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES('c','u','Club','','request',1);INSERT INTO memberships VALUES('c','u','member');INSERT INTO posts(id,club_id,author_id,title,body,created_at) VALUES(1,'c','u','Original','Keep text',1);INSERT INTO comments(id,post_id,author_id,body,created_at) VALUES(1,1,'u','Old reply',1);INSERT INTO sessions VALUES('hash','u','csrf',9999999999999);INSERT INTO media VALUES('image','u','attempt','signature',X'010203',1,1,3,1);UPDATE posts SET image_id='image';`);db.close();cpSync(path,dir+'/backup.sqlite');
 for(let i=0;i<2;i++){db=openDatabase(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,22);assert.equal(db.prepare('SELECT body FROM posts').get().body,'Keep text');assert.equal(db.prepare('SELECT parent_id FROM comments').get().parent_id,null);assert.equal(db.prepare('SELECT password FROM users').get().password,'samehash');assert.equal(db.prepare('SELECT csrf FROM sessions').get().csrf,'csrf');assert.equal(db.prepare('SELECT hex(bytes) bytes FROM media').get().bytes,'010203');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();}
 db=new DatabaseSync(dir+'/backup.sqlite');assert.equal(db.prepare('PRAGMA user_version').get().user_version,11);db.close();
});

test('discussions: idempotence, threads, permissions, filtered saved items/events and restart',async t=>{
 const dir=mkdtempSync(tmpdir()+'/wr-discussions-');let app=await createApp({databasePath:dir+'/community.sqlite'}),origin=await app.listen();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {id:null,cookie:'',csrf:'',async req(path,method='GET',body){const res=await fetch(origin+path,{method,headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();if(res.headers.has('set-cookie'))this.cookie=res.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {status:res.status,...data};}};}
 const owner=client(),member=client(),outsider=client(),guest=client();
 for(const [c,handle] of [[owner,'disc_owner'],[member,'disc_member'],[outsider,'disc_outside']])assert.equal((await c.req('/api/register','POST',{handle,name:handle,password:'Discussion-tests-only-123'})).status,201);
 const club=await owner.req('/api/clubs','POST',{name:'Private',description:'',access:'request'}),open=await owner.req('/api/clubs','POST',{name:'Public',description:'',access:'open'});
 await member.req(`/api/clubs/${club.id}/join`,'POST',{});await owner.req(`/api/clubs/${club.id}/decision`,'POST',{userId:member.id,decision:'approve'});
 const payload={title:'Discussion',body:'Hello @DISC_MEMBER @disc_member @disc_outside @doesnotexist',clientId:'discussion-post-attempt'};
 const post=await owner.req(`/api/clubs/${club.id}/posts`,'POST',payload),path='/api/posts/'+post.id;
 await t.test('post retry and repeated mentions create one post and one private event',async()=>{
  assert.equal(post.status,201);const retry=await owner.req(`/api/clubs/${club.id}/posts`,'POST',payload);assert.equal(retry.id,post.id);assert.equal(retry.replayed,true);
  assert.equal((await owner.req(`/api/clubs/${club.id}/posts`,'POST',{...payload,body:'Changed'})).status,409);
  assert.equal((await member.req('/api/discussions/notifications/summary')).unread,1);assert.equal((await outsider.req('/api/discussions/notifications/summary')).unread,0);
  const event=(await member.req('/api/discussions/notifications')).notifications[0];assert.equal(event.title,'Discussion');assert.equal((await outsider.req(`/api/discussions/notifications/${event.id}/read`,'POST',{})).status,404);
  for(let i=0;i<2;i++)assert.equal((await member.req(`/api/discussions/notifications/${event.id}/read`,'POST',{})).status,200);assert.equal((await member.req('/api/discussions/notifications/summary')).unread,0);
 });
 await t.test('reaction replacement and repeated PUT/DELETE cannot inflate totals; members only',async()=>{
  for(let i=0;i<3;i++)assert.equal((await member.req(path+'/reaction','PUT',{kind:'useful'})).status,200);
  let data=await member.req(path);assert.deepEqual(data.post.reactions,[{kind:'useful',count:1}]);assert.equal(data.post.myReaction,'useful');
  await member.req(path+'/reaction','PUT',{kind:'fire'});assert.deepEqual((await member.req(path)).post.reactions,[{kind:'fire',count:1}]);
  assert.equal((await member.req(path+'/reaction','PUT',{kind:'bad'})).status,422);assert.equal((await outsider.req(path+'/reaction','PUT',{kind:'like'})).status,403);assert.equal((await guest.req(path+'/reaction','PUT',{kind:'like'})).status,401);
  for(let i=0;i<2;i++)assert.equal((await member.req(path+'/reaction','DELETE',{})).status,200);assert.deepEqual((await owner.req(path)).post.reactions,[]);
 });
 const root=await member.req(path+'/comments','POST',{body:'Root comment',clientId:'discussion-root-attempt'});
 const replyBody={body:'Reply @disc_member',parentId:root.id,clientId:'discussion-reply-attempt'};
 let reply;
 await t.test('replies stay in their post, deduplicate sends and notify once; bounded depth',async()=>{
  reply=await owner.req(path+'/comments','POST',replyBody);assert.equal(reply.status,201);assert.equal((await owner.req(path+'/comments','POST',replyBody)).id,reply.id);
  assert.equal((await owner.req(path+'/comments','POST',{...replyBody,body:'Changed'})).status,409);
  assert.equal((await owner.req(path+'/comments','POST',{body:'Nested',parentId:reply.id})).status,422);
  const other=await owner.req(`/api/clubs/${club.id}/posts`,'POST',{title:'Other',body:'Other'});assert.equal((await owner.req(`/api/posts/${other.id}/comments`,'POST',{body:'Wrong post',parentId:root.id})).status,404);
  const comments=(await member.req(path+'/comments')).comments;assert.equal(comments[1].parent_id,root.id);assert.equal(comments[1].parent_body,'Root comment');assert.equal((await member.req('/api/discussions/notifications/summary')).unread,1);
  assert.equal((await owner.req(path+'/comments','POST',{body:Array.from({length:11},(_,i)=>'@user'+i).join(' '),clientId:'too-many-mentions'})).status,422);assert.equal((await member.req(path+'/comments')).comments.length,2);
 });
 await t.test('saving does not grant access; private revocation hides content and event counts immediately',async()=>{
  for(let i=0;i<2;i++)assert.equal((await member.req(path+'/saved','PUT',{})).status,200);assert.equal((await member.req('/api/saved')).posts.length,1);assert.equal((await outsider.req(path+'/saved','PUT',{})).status,403);
  await member.req(`/api/clubs/${club.id}/leave`,'POST',{});assert.equal((await member.req('/api/saved')).posts.length,0);assert.equal((await member.req('/api/discussions/notifications')).notifications.length,0);assert.equal((await member.req('/api/discussions/notifications/summary')).unread,0);assert.equal((await member.req(path+'/comments')).status,403);
  await member.req(`/api/clubs/${club.id}/join`,'POST',{});await owner.req(`/api/clubs/${club.id}/decision`,'POST',{userId:member.id,decision:'approve'});assert.equal((await member.req('/api/saved')).posts.length,1);
 });
 await t.test('bilateral blocks hide post, comment context, saves and events; public reader can save but not react',async()=>{
  const pub=await owner.req(`/api/clubs/${open.id}/posts`,'POST',{title:'Public',body:'Read'});assert.equal((await outsider.req(`/api/posts/${pub.id}/saved`,'PUT',{})).status,200);assert.equal((await outsider.req(`/api/posts/${pub.id}/reaction`,'PUT',{kind:'like'})).status,403);
  await member.req('/api/blocks','POST',{userId:owner.id});assert.equal((await member.req(path)).status,404);assert.equal((await member.req('/api/saved')).posts.length,0);assert.equal((await member.req('/api/discussions/notifications')).notifications.length,0);assert(!(await member.req('/api/feed')).posts.some(p=>p.author_id===owner.id));
  assert.equal((await member.req('/api/blocks','DELETE',{userId:owner.id})).status,200);await owner.req('/api/blocks','POST',{userId:member.id});assert.equal((await member.req(path)).status,404);assert.equal((await member.req('/api/discussions/notifications/summary')).unread,0);assert.equal((await owner.req('/api/blocks','DELETE',{userId:member.id})).status,200);
 });
 await t.test('saved posts and notifications exclude inaccessible entries before pagination',async()=>{
  const db=new DatabaseSync(dir+'/community.sqlite');
  for(let i=0;i<48;i++){
   const id=1000+i,allowed=i<23;
   db.prepare('INSERT INTO posts(id,club_id,author_id,title,body,created_at) VALUES(?,?,?,?,?,?)').run(id,allowed?open.id:club.id,owner.id,allowed?'Allowed '+i:'Never reveal',allowed?'Public':'Private',1);
   db.prepare('INSERT INTO saved_posts VALUES(?,?,?)').run(id,outsider.id,1);
   db.prepare('INSERT INTO discussion_notifications(user_id,actor_id,post_id,kind,created_at) VALUES(?,?,?,?,?)').run(outsider.id,owner.id,id,'mention',1);
  }db.close();
  const first=await outsider.req('/api/saved'),second=await outsider.req('/api/saved?before='+first.next);assert.equal(first.posts.length,20);assert.equal(second.posts.length,4);assert(!JSON.stringify([first,second]).includes('Never reveal'));assert.equal(new Set([...first.posts,...second.posts].map(p=>p.id)).size,24);
  const events=await outsider.req('/api/discussions/notifications'),tail=await outsider.req('/api/discussions/notifications?before='+events.next);assert.equal(events.notifications.length,20);assert.equal(tail.notifications.length,3);assert.equal((await outsider.req('/api/discussions/notifications/summary')).unread,23);assert(!JSON.stringify([events,tail]).includes('Never reveal'));
  const cleanup=new DatabaseSync(dir+'/community.sqlite');cleanup.exec('PRAGMA foreign_keys=ON;DELETE FROM posts WHERE id>=1000;');cleanup.close();
 });
 await t.test('comment pagination, filters before LIMIT, persistent reactions/bookmarks/events and deletion cascade',async()=>{
  await member.req(path+'/reaction','PUT',{kind:'like'});
  // Fixture bulk insert avoids spending write-limit budget on pagination setup.
  let db=new DatabaseSync(dir+'/community.sqlite');for(let i=0;i<53;i++)db.prepare('INSERT INTO comments(post_id,author_id,body,created_at) VALUES(?,?,?,?)').run(post.id,owner.id,'page '+i,i);db.close();
  const first=await owner.req(path+'/comments'),second=await owner.req(path+'/comments?before='+first.next);assert.equal(first.comments.length,50);assert.equal(second.comments.length,5);assert.equal(new Set([...first.comments,...second.comments].map(c=>c.id)).size,55);assert.equal((await owner.req(path+'/comments?before=bad')).status,422);
  await app.close();app=await createApp({databasePath:dir+'/community.sqlite'});origin=await app.listen();assert.equal((await member.req(path)).post.myReaction,'like');assert.equal((await member.req('/api/saved')).posts.length,1);assert.equal((await member.req('/api/discussions/notifications/summary')).unread,1);
  assert.equal((await owner.req(path,'DELETE',{})).status,200);assert.equal((await member.req('/api/saved')).posts.length,0);assert.equal((await member.req('/api/discussions/notifications')).notifications.length,0);
  db=new DatabaseSync(dir+'/community.sqlite');for(const table of ['comments','post_reactions','saved_posts','discussion_notifications'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE post_id=?`).get(post.id).n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
 });
});
