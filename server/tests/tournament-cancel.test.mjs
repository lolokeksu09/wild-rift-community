import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../database.mjs';import {tournamentRoutes} from '../tournaments.mjs';import {createApp} from '../app.mjs';
function fixture(){const db=openDatabase(':memory:');for(let i=0;i<4;i++)db.prepare('INSERT INTO users(id,handle,name,password,created_at,profile_visible) VALUES(?,?,?,?,0,1)').run('c'+i,'cancel'+i,'User','unused');
 const req=(path,body={},uid='c0',method='POST')=>{let result;try{tournamentRoutes({db,user:uid?{id:uid}:null,path,method,body,send:(status,data)=>result={status,...data},now:()=>123});return result;}catch(e){return {status:e.status,message:e.message};}};
 const create=n=>req('/api/tournaments',{title:'Cancel cup '+n,capacity:4,clientId:'cancel-stable-id-'+n});return {db,req,create};}
test('organizer cancellation freezes actions, preserves history, invalidates invitations and frees owner limit',()=>{
 const {db,req,create}=fixture();try{
  const id=create(1).id,path='/api/tournaments/'+id;
  req(path+'/join',{name:'Alpha'},'c1');req(path+'/invite',{handle:'cancel2'},'c1');
  for(let i=2;i<=5;i++)assert.equal(create(i).status,200);assert.equal(create(6).status,409);
  assert.equal(req(path+'/cancel',{reason:'Not enough players'},'c1').status,403);assert.equal(req(path+'/cancel',{reason:'x'}).status,422);
  assert.equal(req(path+'/cancel',{reason:'Not enough players'}).status,200);assert.equal(req(path+'/cancel',{reason:'Not enough players'}).status,200);assert.equal(req(path+'/cancel',{reason:'Different reason'}).status,409);
  const guest=req(path,{},null,'GET');assert.equal(guest.tournament.state,'cancelled');assert.equal(guest.tournament.cancel_reason,'Not enough players');assert.equal(guest.tournament.cancelled_at,123);assert.equal(guest.teams.length,1);assert.equal(guest.roster.length,0);
  assert.equal(req(path,{},'c2','GET').invitation,null);assert.equal(req('/api/tournaments',{},'c2','GET').tournaments.find(t=>t.id===id).invited,false);
  for(const action of ['join','leave','start','results','invite','accept','decline','remove','member-leave'])assert.equal(req(path+'/'+action,{name:'Late',handle:'cancel3',userId:'c2'}).status,409,action);
  assert.equal(db.prepare('SELECT count(*) n FROM tournament_roster').get().n,2);assert.equal(create(6).status,200);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
test('running and finished tournaments cannot be cancelled',()=>{const {db,req,create}=fixture();try{const path='/api/tournaments/'+create(1).id;for(const state of ['running','finished']){db.prepare('UPDATE tournaments SET state=?').run(state);assert.equal(req(path+'/cancel',{reason:'Cannot cancel now'}).status,409);assert.equal(db.prepare('SELECT cancelled_at FROM tournaments').get().cancelled_at,null);}}finally{db.close();}});
test('HTTP cancellation requires owner, session and CSRF and repeated simultaneous requests agree',async t=>{
 const app=await createApp(),origin=await app.listen();t.after(()=>app.close());
 function client(){return {cookie:'',csrf:'',async req(path,body,valid=true){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':valid?this.csrf:'bad'},body:body?JSON.stringify(body):undefined}),d=await r.json();if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(d.csrf)this.csrf=d.csrf;return {status:r.status,...d};}};}
 const owner=client(),other=client();for(const [c,handle] of [[owner,'cancel_owner'],[other,'cancel_other']])assert.equal((await c.req('/api/register',{handle,name:handle,password:'Cancellation-test-only-123'})).status,201);
 const id=(await owner.req('/api/tournaments',{title:'HTTP cancel cup',capacity:4,clientId:'cancel-http-stable'})).id,path='/api/tournaments/'+id,body={reason:'Not enough players <img>'};
 assert.equal((await client().req(path+'/cancel',body)).status,401);assert.equal((await other.req(path+'/cancel',body)).status,403);assert.equal((await owner.req(path+'/cancel',body,false)).status,403);
 assert.deepEqual((await Promise.all([owner.req(path+'/cancel',body),owner.req(path+'/cancel',body)])).map(r=>r.status),[200,200]);assert.equal((await client().req(path)).tournament.state,'cancelled');
});

test('migration 24 to 25 preserves teams, consent and completed results on repeated opens',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-cancel-migration-')),file=join(dir,'db.sqlite');let db=openDatabase(file);
 try{
  db.exec("INSERT INTO users(id,handle,name,password,created_at) VALUES('u','uuu','User','unused',0); INSERT INTO tournaments(owner_id,title,description,capacity,client_id,signature,created_at,state) VALUES('u','Old cup','',4,'old-stable','old',0,'finished'); INSERT INTO tournament_teams(tournament_id,captain_id,name) VALUES(1,'u','Legacy'); INSERT INTO tournament_roster VALUES(1,1,'u','accepted'); INSERT INTO tournament_matches(tournament_id,round,slot,team_a,team_b,score_a,score_b,winner) VALUES(1,1,0,1,1,2,1,1); DROP TABLE tournament_notifications; ALTER TABLE tournament_matches DROP COLUMN starts_at; ALTER TABLE tournament_matches DROP COLUMN schedule_version; ALTER TABLE tournaments DROP COLUMN cancelled_at; ALTER TABLE tournaments DROP COLUMN cancel_reason; PRAGMA user_version=24;");db.close();
  for(let i=0;i<2;i++){db=openDatabase(file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,26);assert.equal(db.prepare('SELECT state,cancelled_at FROM tournaments').get().state,'finished');assert.equal(db.prepare('SELECT cancelled_at FROM tournaments').get().cancelled_at,null);assert.equal(db.prepare('SELECT status FROM tournament_roster').get().status,'accepted');assert.equal(db.prepare('SELECT winner,score_a FROM tournament_matches').get().score_a,2);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();}
 }finally{if(db.isOpen)db.close();rmSync(dir,{recursive:true,force:true});}
});
