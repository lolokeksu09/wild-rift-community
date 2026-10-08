import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createApp} from '../app.mjs';
test('player discovery filters before pagination and respects privacy, blocks and restarts',async t=>{
 const dir=mkdtempSync(tmpdir()+'/wr-players-'),options={databasePath:dir+'/community.sqlite',authLimit:200};let app=await createApp(options),origin=await app.listen();
 t.after(async()=>{if(app)await app.close();rmSync(dir,{recursive:true,force:true});});
 function client(){return {cookie:'',csrf:'',id:null,async req(path,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'X-Community-Request':'1','X-CSRF-Token':this.csrf,'Content-Type':'application/json'});const res=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),data=await res.json();if(res.headers.has('set-cookie'))this.cookie=res.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;return {status:res.status,data};}};}
 async function account(handle,visible=true){const c=client();assert.equal((await c.req('/api/register','POST',{handle,name:'Лесник '+handle,password:'Player-search-test-12345'})).status,201);assert.equal((await c.req('/api/me','PATCH',{profileVisible:visible,gameProfile:{rank:'Мастер',roles:['jungle','mid'],region:'Европа',language:'Русский',microphone:'yes',riotId:'Secret#ABC',riotVisible:false}})).status,200);return c;}
 const viewer=await account('aaa_viewer'),hidden=await account('aaa_private',false),blocked=await account('aaa_blocked');
 assert.equal((await viewer.req('/api/blocks','POST',{userId:blocked.id})).status,200);
 const people=[];for(let i=0;i<25;i++)people.push(await account('find'+String(i).padStart(2,'0')));
 assert.equal((await client().req('/api/players')).status,401);
 const first=await viewer.req('/api/players');assert.equal(first.status,200);assert.equal(first.data.viewerId,viewer.id);assert.equal(first.data.players.length,20);assert.equal(first.data.next,'find19');assert(first.data.players.every(p=>!p.gameProfile.riotId && p.gameProfile.rankVerified===false));
 assert(first.data.players.every(p=>![viewer.id,hidden.id,blocked.id].includes(p.id)));assert(!JSON.stringify(first.data).includes('password'));assert(!JSON.stringify(first.data).includes('Secret#ABC'));
 const second=await viewer.req('/api/players?after='+first.data.next);assert.equal(second.data.players.length,5);assert.equal(second.data.next,null);assert.equal(new Set([...first.data.players,...second.data.players].map(p=>p.id)).size,25);
 const filters=new URLSearchParams({role:'mid',rank:'МАСТЕР',region:'ЕВРОПА',language:'РУССКИЙ',microphone:'yes'});assert.equal((await viewer.req('/api/players?'+filters)).data.players.length,20);
 assert.equal((await viewer.req('/api/players?role=support')).data.players.length,0);assert.equal((await viewer.req('/api/players?microphone=no')).data.players.length,0);
 assert.equal((await viewer.req('/api/players?q=ЛЕСНИК%20find24')).data.players[0].handle,'find24');
 assert.equal((await viewer.req('/api/players?q=Secret')).data.players.length,0);assert.equal((await viewer.req('/api/players?q=%25')).data.players.length,0);
 for(const query of ['after=bad%20cursor','role=wrong','microphone=required','q='+ 'x'.repeat(81)])assert.equal((await viewer.req('/api/players?'+query)).status,422);
 assert.equal((await people[20].req('/api/me','PATCH',{gameProfile:{microphone:'wrong'}})).status,422);
 await viewer.req('/api/blocks','POST',{userId:people[20].id});await people[21].req('/api/me','PATCH',{profileVisible:false});await people[22].req('/api/blocks','POST',{userId:viewer.id});
 const revoked=await viewer.req('/api/players?after=find19');assert.deepEqual(revoked.data.players.map(p=>p.handle),['find23','find24']);assert(revoked.data.blockVersion>first.data.blockVersion);
 for(const c of [people[20],people[21],people[22]])assert.equal((await viewer.req('/api/profiles/'+c.id)).status,404);
 await app.close();app=await createApp(options);origin=await app.listen();
 assert.deepEqual((await viewer.req('/api/players?after=find19')).data.players.map(p=>p.handle),['find23','find24']);
 const input={clientId:'group-search-new-0001',title:'Поиск по рангу',mode:'ranked',region:'Европа',language:'Русский',role:'jungle',rank:'Мастер',voice:'required',description:'',capacity:2,durationHours:1};
 assert.equal((await viewer.req('/api/lfg','POST',input)).status,201);
 const groupFilters=new URLSearchParams({rank:'МАСТЕР',voice:'required',region:'ЕВРОПА',language:'РУССКИЙ'});assert.equal((await people[24].req('/api/lfg?'+groupFilters)).data.groups.length,1);
 assert.equal((await people[24].req('/api/lfg?voice=none')).data.groups.length,0);assert.equal((await people[24].req('/api/lfg?rank=Другой')).data.groups.length,0);assert.equal((await viewer.req('/api/lfg?voice=yes')).status,422);
});
