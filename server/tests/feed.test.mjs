import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.mjs';
test('feed filters private and banned clubs, paginates and revokes access immediately',async t=>{
 const app=await createApp();const origin=await app.listen();t.after(()=>app.close());
 function client(){return {cookie:'',csrf:'',async call(path,data){const r=await fetch(origin+path,{method:data?'POST':'GET',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf},body:data?JSON.stringify(data):undefined});const body=await r.json();if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(body.csrf)this.csrf=body.csrf;return {status:r.status,...body};}};}
 const owner=client(),member=client(),guest=client();
 await owner.call('/api/register',{handle:'feed_owner',name:'Owner',password:'Feed-tests-only-123'});
 const registered=await member.call('/api/register',{handle:'feed_member',name:'Member',password:'Feed-tests-only-123'});
 const open=await owner.call('/api/clubs',{name:'Open',description:'',access:'open'});
 const closed=await owner.call('/api/clubs',{name:'Private',description:'',access:'request'});
 const secret=await owner.call(`/api/clubs/${closed.id}/posts`,{title:'Secret',body:'private body'});
 for(let i=0;i<22;i++)assert.equal((await owner.call(`/api/clubs/${open.id}/posts`,{title:'Public '+i,body:'hello'})).status,201);
 const first=await guest.call('/api/feed');assert.equal(first.posts.length,20);assert(first.next);assert(first.posts.every(p=>p.club_id===open.id));
 const next=await guest.call('/api/feed?before='+first.next);assert.equal(next.posts.length,2);assert.equal(next.next,null);assert(next.posts.every(p=>!first.posts.some(x=>x.id===p.id)));
 assert.equal((await guest.call('/api/feed?before=bad')).status,422);
 await member.call(`/api/clubs/${closed.id}/join`,{});
 assert(!(await member.call('/api/feed?before='+first.next)).posts.some(p=>p.id===secret.id));
 await owner.call(`/api/clubs/${closed.id}/decision`,{userId:registered.user.id,decision:'approve'});
 const tail=await member.call('/api/feed?before='+first.next);assert(tail.posts.some(p=>p.id===secret.id));
 await member.call(`/api/clubs/${closed.id}/leave`,{});
 assert(!(await member.call('/api/feed?before='+first.next)).posts.some(p=>p.id===secret.id));
 await member.call(`/api/clubs/${open.id}/join`,{});
 await owner.call(`/api/clubs/${open.id}/ban`,{userId:registered.user.id});
 assert.equal((await member.call('/api/feed')).posts.length,0);
 assert((await guest.call('/api/feed')).posts.length>0);
});
