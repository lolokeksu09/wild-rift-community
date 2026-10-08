import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../database.mjs';import {tournamentRoutes} from '../tournaments.mjs';import {createApp} from '../app.mjs';
test('tournament bracket advances every team count, enforces ownership and freezes results',()=>{
 for(const count of [2,3,4,5,7,8,9,15,16]){
  const db=openDatabase(':memory:');try{
   for(let i=0;i<18;i++)db.prepare('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,0)').run('u'+i,'user'+i,'User '+i,'unused');
   function req(path,body={},uid='u0',method='POST'){let result;try{tournamentRoutes({db,user:uid?{id:uid}:null,path,method,body,send:(status,data)=>{result={status,...data};},now:()=>1});return result;}catch(e){return {status:e.status,...e};}}
   const payload={title:'Турнир <img>',description:'Rules',capacity:16,clientId:'tournament-stable-id'};
   const t=req('/api/tournaments',payload);assert.equal(t.status,200);assert.equal(req('/api/tournaments',payload).id,t.id);assert.equal(req('/api/tournaments',{...payload,title:'Other'}).status,409);
   const path='/api/tournaments/'+t.id;assert.equal(req(path+'/start').status,409);
   for(let i=1;i<=count;i++){assert.equal(req(path+'/join',{name:'Team '+i},'u'+i).status,200);assert.equal(req(path+'/join',{name:'Team '+i},'u'+i).status,200);}
   assert.equal(req(path+'/start').status,409);
   for(let i=1;i<=count;i++)for(let j=0;j<4;j++){
    const uid='player'+i+'_'+j;db.prepare('INSERT INTO users(id,handle,name,password,created_at,profile_visible) VALUES(?,?,?,?,0,1)').run(uid,uid,'Player','unused');
    assert.equal(req(path+'/invite',{handle:uid},'u'+i).status,200);assert.equal(req(path+'/accept',{},uid).status,200);
   }
   assert.equal(req(path+'/start',{},'u1').status,403);assert.equal(req(path+'/start').status,200);assert.equal(req(path+'/start').status,200);
   assert.equal(req(path+'/leave',{},'u1').status,409);assert.equal(req(path+'/join',{name:'Late'},'u17').status,409);
   let results=0;
   for(const m of db.prepare('SELECT round,slot FROM tournament_matches WHERE tournament_id=? ORDER BY round,slot').all(t.id)){
    const match=db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND slot=?').get(t.id,m.round,m.slot);if(match.winner)continue;
    const score={...m,scoreA:2,scoreB:1};assert.equal(req(path+'/results',score,'u1').status,403);assert.equal(req(path+'/results',{...score,scoreB:2}).status,422);assert.equal(req(path+'/results',score).status,200);assert.equal(req(path+'/results',score).status,200);assert.equal(req(path+'/results',{...score,scoreB:0}).status,409);results++;
   }
   assert.equal(results,count-1);assert.equal(db.prepare('SELECT state FROM tournaments WHERE id=?').get(t.id).state,'finished');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
 }
});
test('HTTP registration is authenticated, CSRF protected and handles competing last-place requests',async t=>{
 const app=await createApp(),origin=await app.listen();t.after(()=>app.close());
 function client(){return {cookie:'',csrf:'',async req(path,body,csrf=true){const method=body?'POST':'GET',r=await fetch(origin+path,{method,headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':csrf?this.csrf:'bad'},body:body?JSON.stringify(body):undefined}),d=await r.json();if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(d.csrf)this.csrf=d.csrf;return {status:r.status,...d};}};}
 const clients=Array.from({length:6},client);for(let i=0;i<6;i++)await clients[i].req('/api/register',{handle:'tour_user'+i,name:'User '+i,password:'Local-test-only-password'});
 const p='/api/tournaments',payload={title:'HTTP tournament',description:'',capacity:4,clientId:'tournament-http-stable'};assert.equal((await client().req(p,payload)).status,401);assert.equal((await clients[0].req(p,payload,false)).status,403);
 const id=(await clients[0].req(p,payload)).id,path=p+'/'+id;for(let i=1;i<4;i++)assert.equal((await clients[i].req(path+'/join',{name:'Team '+i})).status,200);
 const results=await Promise.all([clients[4].req(path+'/join',{name:'Fourth'}),clients[5].req(path+'/join',{name:'Fifth'})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal((await client().req(path)).teams.length,4);assert.equal((await fetch(origin+'/tournaments')).status,200);
});
