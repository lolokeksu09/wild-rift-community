import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createApp } from '../app.mjs';
import { openDatabase } from '../database.mjs';
const password='Media-test-only-123456';
test('profiles and media: privacy, spoofed files, attachment access, retries and restoration',async t=>{
 const dir=mkdtempSync(tmpdir()+'/wr-media-');let app=await createApp({databasePath:dir+'/source/community.sqlite'}),origin=await app.listen();
 t.after(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {cookie:'',csrf:'',id:'',async req(path,method='GET',body,extra={}){
  const binary=Buffer.isBuffer(body),headers={Cookie:this.cookie,...(method==='GET'?{}:{Origin:origin,'X-Community-Request':'1','X-CSRF-Token':this.csrf,'Content-Type':binary?'image/png':'application/json'}),...extra};
  const res=await fetch(origin+path,{method,headers,body:body===undefined?undefined:binary?body:JSON.stringify(body)});
  const data=res.headers.get('content-type')==='image/webp'?Buffer.from(await res.arrayBuffer()):await res.json();
  if(res.headers.get('set-cookie'))this.cookie=res.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;
  return {status:res.status,data,headers:res.headers};
 }};}
 const owner=client(),member=client(),outside=client(),guest=client();
 for(const [c,handle] of [[owner,'mediaowner'],[member,'mediamember'],[outside,'mediaoutside']])assert.equal((await c.req('/api/register','POST',{handle,name:handle,password})).status,201);
 const input=await sharp({create:{width:40,height:30,channels:3,background:'#5c86b8'}}).png().withMetadata({exif:{IFD0:{Copyright:'Private metadata'}}}).toBuffer();
 async function upload(c,bytes=input,key=randomUUID()){return c.req('/api/media','POST',bytes,{'X-Upload-ID':key});}
 const bad=await upload(owner,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));assert.equal(bad.status,422);
 assert.equal((await upload(owner,input,randomUUID()).then(r=>r.status)),201);
 assert.equal((await guest.req('/api/media','POST',input,{'X-Upload-ID':randomUUID()})).status,401);
 assert.equal((await owner.req('/api/media','POST',input,{'X-Upload-ID':randomUUID(),'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await owner.req('/api/media','POST',input,{'X-Upload-ID':randomUUID(),'Content-Type':'image/jpeg'})).status,422);
 const key=randomUUID();const avatar=await upload(owner,input,key);assert.equal(avatar.status,201);
 const avatarId=avatar.data.image.id;assert.equal((await upload(owner,input,key)).data.image.id,avatarId);
 assert.equal((await upload(owner,await sharp(input).resize(20,20).png().toBuffer(),key)).status,409);
 assert.equal((await outside.req('/api/media/'+avatarId)).status,404);
 const downloaded=await owner.req('/api/media/'+avatarId);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('cache-control'),'no-store');
 const info=await sharp(downloaded.data).metadata();assert.equal(info.format,'webp');assert.equal(info.exif,undefined);assert.equal(info.width,40);
 assert.equal((await outside.req('/api/me','PATCH',{avatarId})).status,403);
 const fields={riotId:'Player#ABC',rank:'Мастер',roles:['jungle','mid'],champions:['Ренгар','Ахри'],region:'Европа',language:'Русский',playTime:'20:00–23:00 МСК',riotVisible:false};
 assert.equal((await owner.req('/api/me','PATCH',{avatarId,gameProfile:fields})).status,200);
 assert.equal((await guest.req('/api/profiles/'+owner.id)).status,404);assert.equal((await guest.req('/api/media/'+avatarId)).status,404);
 assert.equal((await owner.req('/api/me','PATCH',{profileVisible:true})).status,200);
 const shared=await guest.req('/api/profiles/'+owner.id);assert.equal(shared.status,200);assert.equal(shared.data.profile.gameProfile.riotId,'');assert.equal(shared.data.profile.gameProfile.rankVerified,false);assert(!JSON.stringify(shared.data).includes(password));
 assert.equal((await guest.req('/api/media/'+avatarId)).status,200);
 assert.equal((await owner.req('/api/me','PATCH',{gameProfile:{roles:['mid','mid']}})).status,422);
 assert.equal((await owner.req('/api/me','PATCH',{gameProfile:{riotVisible:true}})).status,200);
 assert.equal((await guest.req('/api/profiles/'+owner.id)).data.profile.gameProfile.riotId,fields.riotId);
 assert.equal((await outside.req('/api/blocks','POST',{userId:owner.id})).status,200);
 assert.equal((await outside.req('/api/profiles/'+owner.id)).status,404);assert.equal((await outside.req('/api/media/'+avatarId)).status,404);
 const club=(await owner.req('/api/clubs','POST',{name:'Закрытый медиа-клуб',description:'',access:'request'})).data.id;
 const pic=(await upload(owner)).data.image.id;
 const post=(await owner.req(`/api/clubs/${club}/posts`,'POST',{title:'Скриншот',body:'Приватный пост',imageId:pic,clientId:'image-post-attempt'})).data.id;
 assert.equal((await owner.req(`/api/clubs/${club}/posts`,'POST',{title:'Скриншот',body:'Приватный пост',imageId:pic,clientId:'image-post-attempt'})).data.id,post);
 assert.equal((await owner.req('/api/me','PATCH',{coverId:pic})).status,409);
 assert.equal((await owner.req(`/api/clubs/${club}/cover`,'PATCH',{coverId:pic})).status,409);
 assert.equal((await guest.req('/api/media/'+pic)).status,403);
 await member.req(`/api/clubs/${club}/join`,'POST',{});assert.equal((await member.req('/api/media/'+pic)).status,403);
 await owner.req(`/api/clubs/${club}/decision`,'POST',{userId:member.id,decision:'approve'});assert.equal((await member.req('/api/media/'+pic)).status,200);
 await member.req(`/api/clubs/${club}/leave`,'POST',{});assert.equal((await member.req('/api/media/'+pic)).status,403);
 await member.req(`/api/clubs/${club}/join`,'POST',{});await owner.req(`/api/clubs/${club}/decision`,'POST',{userId:member.id,decision:'approve'});
 await owner.req(`/api/clubs/${club}/ban`,'POST',{userId:member.id});assert.equal((await member.req('/api/media/'+pic)).status,403);
 await app.close();app=null;cpSync(dir+'/source',dir+'/backup',{recursive:true});cpSync(dir+'/backup',dir+'/restore',{recursive:true});
 app=await createApp({databasePath:dir+'/restore/community.sqlite'});origin=await app.listen();
 assert.equal((await owner.req('/api/me')).data.user.gameProfile.rank,fields.rank);assert.equal((await owner.req('/api/media/'+pic)).status,200);assert.equal((await outside.req('/api/media/'+pic)).status,403);
 const db=openDatabase(dir+'/restore/community.sqlite');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
 assert.equal((await owner.req('/api/posts/'+post,'DELETE',{})).status,200);assert.equal((await owner.req('/api/media/'+pic)).status,404);
 assert.equal((await owner.req('/api/me','PATCH',{profileVisible:false})).status,200);assert.equal((await guest.req('/api/media/'+avatarId)).status,404);
});

test('migration 10 to current schema preserves accounts, content and supports repeated opening',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync}=await import('node:fs');const dir=mkdtempSync(tmpdir()+'/wr-migration11-'),path=dir+'/community.sqlite';
 try {
  let db=new DatabaseSync(path);db.exec(readFileSync(new URL('./fixtures/schema-v10.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO users(id,handle,name,bio,password,created_at) VALUES('u','old','Old','Bio','unchanged',1); INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES('c','u','Club','','request',1); INSERT INTO memberships VALUES('c','u','member'); INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES('c','u','Title','Keep text',1); INSERT INTO sessions VALUES('session','u','csrf',9999999999999);");db.close();
  cpSync(path,dir+'/pre-migration.sqlite');
  for(let i=0;i<2;i++){db=openDatabase(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,25);assert.equal(db.prepare('SELECT body FROM posts').get().body,'Keep text');assert.equal(db.prepare('SELECT password FROM users').get().password,'unchanged');assert.equal(db.prepare('SELECT profile_visible FROM users').get().profile_visible,0);assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();}
  const old=new DatabaseSync(dir+'/pre-migration.sqlite');assert.equal(old.prepare('PRAGMA user_version').get().user_version,10);assert.equal(old.prepare('SELECT body FROM posts').get().body,'Keep text');old.close();
 } finally{rmSync(dir,{recursive:true,force:true});}
});
