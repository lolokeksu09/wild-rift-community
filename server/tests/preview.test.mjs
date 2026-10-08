import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';

test('guest previews expose only active announcements; membership and chat stay private',async t=>{
 const app=await createApp(),origin=await app.listen();t.after(()=>app.close());
 function actor(){let cookie='',csrf;return {async request(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{Cookie:cookie,Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;return {status:r.status,...data};}};}
 const owner=actor(),viewer=actor(),guest=actor();
 const a=await owner.request('/api/register','POST',{handle:'preview_owner',name:'Owner',password:'Preview-password-123'});
 await viewer.request('/api/register','POST',{handle:'preview_viewer',name:'Viewer',password:'Preview-password-123'});
 const group=await owner.request('/api/lfg','POST',{clientId:'preview-group-test-001',title:'Company tonight',mode:'normal',region:'eu',language:'ru',role:'jungle',rank:'',voice:'optional',description:'not-in-preview',capacity:2,durationHours:1});
 const event=await owner.request('/api/events','POST',{clientId:'preview-event-test-001',title:'Evening together',description:'not-in-preview',mode:'normal',region:'eu',language:'ru',timezone:'UTC',startsAt:Date.now()+3600000,durationHours:1,roles:['mid','jungle'],ownerRole:'mid'});
 let data=await guest.request('/api/community-preview');assert.equal(data.status,200);
 assert.deepEqual(Object.keys(data.groups[0]).sort(),['available','id','language','mode','region','role','starts_at','title']);
 assert.deepEqual(Object.keys(data.events[0]).sort(),['available','id','language','mode','region','starts_at','title']);
 assert.equal(data.groups[0].available,1);assert.equal(data.events[0].available,1);
 assert(!JSON.stringify(data).includes('not-in-preview'));
 for(const path of ['/api/lfg','/api/lfg/'+group.id,'/api/lfg/'+group.id+'/messages','/api/events','/api/events/'+event.id,'/api/events/'+event.id+'/messages'])assert.equal((await guest.request(path)).status,401);
 await viewer.request('/api/blocks','POST',{userId:a.user.id});data=await viewer.request('/api/community-preview');assert.deepEqual(data.groups,[]);assert.deepEqual(data.events,[]);
 await owner.request('/api/lfg/'+group.id+'/close','POST',{});await owner.request('/api/events/'+event.id+'/cancel','POST',{});
 data=await guest.request('/api/community-preview');assert.deepEqual(data.groups,[]);assert.deepEqual(data.events,[]);
});
