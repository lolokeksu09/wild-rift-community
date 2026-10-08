import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../database.mjs';
import {seedDemoCommunity,demoId} from '../demo-seed.mjs';
import {createApp} from '../app.mjs';

test('demo seed is atomic and repeatable; public discovery respects visibility, blocks and private clubs',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-demo-')),path=join(dir,'community.sqlite');let app;t.after(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
 let db=openDatabase(path);db.prepare("INSERT INTO users(id,handle,name,password,created_at,bio) VALUES('original','original','Original','unused',1,'Keep me')").run();
 const first=await seedDemoCommunity(db);assert.equal(first.createdBots,24);assert.equal(first.createdPosts,24);assert.equal(first.createdComments,72);
 const second=await seedDemoCommunity(db);assert.equal(second.createdBots,0);assert.equal(second.createdPosts,0);assert.equal(second.createdComments,0);
 assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,25);assert.equal(db.prepare('SELECT bio FROM users WHERE id=?').get('original').bio,'Keep me');assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM direct_messages').get().n,0);
 const bot=demoId('user:0'),club=demoId('club:0'),post=db.prepare('SELECT id FROM posts WHERE club_id=? ORDER BY id LIMIT 1').get(club).id;
 db.prepare("INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES('private','original','Private','', 'request',1)").run();db.prepare("INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES('private','original','Secret title','Secret body',1)").run();db.close();
 app=await createApp({databasePath:path});const origin=await app.listen();
 let cookie='',csrf;async function req(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{Cookie:cookie,Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)csrf=data.csrf;return {status:r.status,...data};}
 const members=await req('/api/community-members');assert.equal(members.total,24);assert.equal(members.bots,24);assert.equal(members.members.length,20);assert(members.members.every(u=>u.isBot&&u.gameProfile.riotId===''));assert(!JSON.stringify(members).includes('password'));assert(!JSON.stringify(members).includes('demoBot'));
 const next=await req('/api/community-members?after='+members.next);assert.equal(next.members.length,4);assert(!next.members.some(u=>members.members.some(x=>x.id===u.id)));
 assert.equal((await req('/api/login','POST',{handle:'bot_rift_01',password:'Demo-test-password-123'})).status,401);
 const feed=await req('/api/feed');assert(feed.posts.every(p=>p.isBot));const detail=await req('/api/posts/'+post);assert.equal(detail.post.isBot,true);assert((await req('/api/posts/'+post+'/comments')).comments.every(c=>c.isBot));
 const clubs=await req('/api/clubs');assert.equal(clubs.clubs.find(c=>c.id===club).bots,12);assert.equal(clubs.clubs.find(c=>c.id==='private').lastPost,null);
 await req('/api/register','POST',{handle:'human_demo_test',name:'Human',password:'Demo-test-password-123'});await req('/api/me','PATCH',{profileVisible:true,gameProfile:{demoBot:'community-v1',roles:['mid']}});assert.equal((await req('/api/me')).user.isBot,false);
 await req('/api/blocks','POST',{userId:bot});const blocked=await req('/api/community-members');assert(!blocked.members.some(u=>u.id===bot));assert.equal(blocked.bots,23);
 for(const url of ['/clubs/'+club,'/posts/'+post,'/players/'+bot,'/players','/rules'])assert.equal((await fetch(origin+url)).status,200);
 assert.equal((await fetch(origin+'/not-an-app-route')).status,404);assert.equal((await req('/api/clubs/private/posts')).status,403);
});

test('seed refuses an existing human handle without partial insertion',async()=>{
 const db=openDatabase(':memory:');try{db.prepare("INSERT INTO users(id,handle,name,password,created_at) VALUES('human','bot_rift_04','Human','unused',1)").run();await assert.rejects(seedDemoCommunity(db),/collides/);assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM media').get().n,0);}finally{db.close();}
});
