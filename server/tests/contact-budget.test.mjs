import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.mjs';
import {contactPolicy} from '../contact-budget.mjs';
test('new contact budget is atomic, durable, rolling and independent of existing messages',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-contacts-')),databasePath=join(dir,'db.sqlite');let time=Date.now(),app=await createApp({databasePath,now:()=>time,authLimit:200}),origin=await app.listen();
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const client=()=>({cookie:'',csrf:'',async call(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{Cookie:this.cookie,...(method==='GET'?{}:{Origin:origin,'X-Community-Request':'1','X-CSRF-Token':this.csrf,'Content-Type':'application/json'})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;return {status:r.status,retry:r.headers.get('retry-after'),...data};}});
 const a=client(),peers=[];await a.call('/api/register','POST',{handle:'sender',name:'Sender',password:'Contact-budget-test-123'});
 for(let n=0;n<7;n++){const p=client();await p.call('/api/register','POST',{handle:'target'+n,name:'Target',password:'Contact-budget-test-123'});peers.push(p);}
 const payload=n=>({handle:'target'+n,clientId:'contact-attempt-id-'+n,body:'Привет'});
 const first=await a.call('/api/direct','POST',payload(0));assert.equal(first.status,201);
 await peers[0].call('/api/direct/'+first.id+'/decision','POST',{decision:'accept'});
 const cooldown=await a.call('/api/direct','POST',payload(1));assert.equal(cooldown.status,429);assert.equal(cooldown.retry,'300');assert.equal(cooldown.contactBudget.used,1);
 assert.equal((await a.call('/api/direct','POST',payload(0))).status,200);
 assert.equal((await a.call('/api/direct','POST',{...payload(6),handle:'not-existing'})).status,403);
 await peers[6].call('/api/me/privacy','PATCH',{dmRequests:false});assert.equal((await a.call('/api/direct','POST',payload(6))).status,403);
 assert.equal((await a.call('/api/direct/contact-budget')).contactBudget.used,1);
 time+=300000;
 const race=await Promise.all([a.call('/api/direct','POST',payload(1)),a.call('/api/direct','POST',payload(2))]);assert.deepEqual(race.map(r=>r.status).sort(),[201,429]);
 const won=race.findIndex(r=>r.status===201)+1;await peers[won].call('/api/direct/'+race[won-1].id+'/decision','POST',{decision:'reject'});
 time+=300000;assert.equal((await a.call('/api/direct','POST',payload(3))).status,201);
 await app.close();app=await createApp({databasePath,now:()=>time,authLimit:200});origin=await app.listen();
 const exhausted=await a.call('/api/direct','POST',payload(4));assert.equal(exhausted.status,429);assert.equal(exhausted.contactBudget.used,3);assert.equal(exhausted.contactBudget.remaining,0);
 assert.equal((await a.call('/api/direct','POST',payload(0))).status,200);
 assert.equal((await a.call('/api/direct/'+first.id+'/messages','POST',{clientId:'existing-chat-message-id',body:'Продолжаем беседу'})).status,201);
 assert.equal((await a.call('/api/direct/contact-budget')).contactBudget.used,3);
 // At exactly 24 hours the oldest contact leaves the window and the account matures.
 time+=86400000-600000;const mature=await a.call('/api/direct/contact-budget');assert.equal(mature.contactBudget.used,2);assert.equal(mature.contactBudget.limit,10);assert.equal(mature.contactBudget.cooldownSeconds,60);assert.equal(mature.contactBudget.newAccount,false);
 assert.equal((await a.call('/api/direct','POST',payload(4))).status,201);
 assert.equal((await a.call('/api/direct','POST',payload(5))).retry,'60');time+=60000;assert.equal((await a.call('/api/direct','POST',payload(5))).status,201);
 assert.equal((await client().call('/api/direct/contact-budget')).status,401);
 assert.equal((await peers[5].call('/api/direct/contact-budget')).contactBudget.used,0);
});
test('contact policy rejects invalid or less restrictive new-account configuration',()=>{
 for(const p of [{daily:0},{daily:1.5},{daily:101},{newDaily:11},{newCooldownSeconds:1},{unknown:2},{newAccountHours:NaN}])assert.throws(()=>contactPolicy(p));
 assert.equal(contactPolicy({daily:20,newDaily:4}).daily,20);
});
