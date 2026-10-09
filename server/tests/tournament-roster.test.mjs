import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../database.mjs';
import {createApp} from '../app.mjs';
import {restrictedWrite} from '../sanctions.mjs';
import {tournamentRoutes} from '../tournaments.mjs';
function fixture(db=openDatabase(':memory:')) {
 for(let i=0;i<16;i++)db.prepare('INSERT OR IGNORE INTO users(id,handle,name,password,created_at,profile_visible) VALUES(?,?,?,?,0,1)').run('r'+i,'roster'+i,'Private name '+i,'unused');
 const req=(action,body={},uid='r0',method='POST')=>{let response;try{tournamentRoutes({db,user:uid?{id:uid}:null,path:action.startsWith('/api/')?action:'/api/tournaments/1/'+action,method,body,send:(status,data)=>response={status,...data},now:()=>100});return response;}catch(e){return {status:e.status,message:e.message};}};
 req('/api/tournaments',{title:'Roster cup',capacity:4,clientId:'roster-fixture-stable'});
 return {db,req};
}
test('roster requires consent, five players, privacy, exclusive membership and frozen teams',()=>{
 const {db,req}=fixture();try{
  const a=req('join',{name:'Alpha'},'r1').teamId,b=req('join',{name:'Beta'},'r6').teamId;
  assert.equal(req('start').status,409);
  assert.equal(req('invite',{handle:'roster2'},'r6').status,200);
  assert.equal(req('invite',{handle:'roster2'},'r1').status,409);
  assert.equal(req('accept',{},'r2').status,200);assert.equal(req('accept',{},'r2').status,200);
  assert.equal(req('join',{name:'Duplicate'},'r2').status,409);
  assert.equal(req('invite',{handle:'roster3'},'r2').status,403);
  assert.equal(req('invite',{handle:'roster3'},'r1').status,200);
  assert.equal(req('decline',{},'r3').status,200);assert.equal(req('decline',{},'r3').status,200);
  assert.equal(req('invite',{handle:'roster3'},'r1').status,409);
  for(const [captain,players] of [['r1',[4,5,7,8]],['r6',[9,10,11]]])for(const i of players){assert.equal(req('invite',{handle:'roster'+i},captain).status,200);assert.equal(req('accept',{},'r'+i).status,200);}
  assert.equal(req('invite',{handle:'roster12'},'r1').status,409);
  const guest=req('/api/tournaments/1',{},null,'GET');assert.equal(guest.roster.length,0);assert.equal(guest.invitation,null);assert.deepEqual(guest.teams.map(t=>t.memberCount),[5,5]);assert.equal(JSON.stringify(guest).includes('Private name'),false);
  const own=req('/api/tournaments/1',{},'r7','GET');assert.equal(own.myTeam,a);assert.equal(own.roster.length,5);assert.equal(own.roster.some(x=>x.user_id==='r2'),false);
  assert.equal(req('remove',{userId:'r7'},'r6').status,404);
  assert.equal(req('member-leave',{},'r7').status,200);assert.equal(req('start').status,409);
  assert.equal(req('invite',{handle:'roster12'},'r1').status,200);
  assert.equal(req('start').status,409);assert.equal(req('accept',{},'r12').status,200);
  assert.equal(req('start').status,200);
  assert.equal(req('member-leave',{},'r12').status,409);assert.equal(req('remove',{userId:'r12'},'r1').status,409);assert.equal(req('invite',{handle:'roster13'},'r1').status,409);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
test('invitation respects blocks, private profiles, captain protection, retries and removing invitations',()=>{
 const {db,req}=fixture();try{
  req('join',{name:'Alpha'},'r1');req('join',{name:'Beta'},'r6');
  db.prepare('UPDATE users SET profile_visible=0 WHERE id=?').run('r2');assert.equal(req('invite',{handle:'roster2'},'r1').status,404);
  db.prepare('UPDATE users SET profile_visible=1 WHERE id=?').run('r2');
  db.prepare('INSERT INTO blocks(blocker_id,target_id) VALUES(?,?)').run('r2','r1');assert.equal(req('invite',{handle:'roster2'},'r1').status,404);
  db.prepare('DELETE FROM blocks').run();assert.equal(req('invite',{handle:'roster2'},'r1').status,200);assert.equal(req('invite',{handle:'roster2'},'r1').status,200);
  const detail=req('/api/tournaments/1',{},'r2','GET');assert.equal(detail.invitation.name,'Alpha');assert.equal(detail.roster.length,0);
  assert.equal(req('remove',{userId:'r1'},'r1').status,409);
  assert.equal(req('remove',{userId:'r2'},'r1').status,200);assert.equal(req('remove',{userId:'r2'},'r1').status,200);assert.equal(req('accept',{},'r2').status,409);
  req('invite',{handle:'roster3'},'r1');db.prepare('INSERT INTO blocks(blocker_id,target_id) VALUES(?,?)').run('r3','r0');assert.equal(req('accept',{},'r3').status,404);
  db.prepare('DELETE FROM blocks').run();assert.equal(req('leave',{},'r1').status,200);assert.equal(req('/api/tournaments/1',{},'r3','GET').invitation,null);
 }finally{db.close();}
});
test('schema 23 migration preserves old teams and brackets, backfills captain, and remains idempotent',()=>{
 const directory=mkdtempSync(join(tmpdir(),'wr-roster-')),file=join(directory,'community.sqlite');let db;
 try{
  ({db}=fixture(openDatabase(file)));db.prepare("INSERT INTO tournament_teams(tournament_id,captain_id,name) VALUES(1,'r1','Legacy A'),(1,'r6','Legacy B')").run();
  db.exec("INSERT INTO tournaments(owner_id,title,description,capacity,client_id,signature,created_at,state) VALUES('r0','Finished cup','',4,'old-finished','old',0,'finished'); INSERT INTO tournament_teams(tournament_id,captain_id,name) VALUES(2,'r2','Final A'),(2,'r7','Final B'); INSERT INTO tournament_matches(tournament_id,round,slot,team_a,team_b,score_a,score_b,winner) VALUES(2,1,0,3,4,2,1,3);");
  db.exec('DROP TABLE tournament_result_history; ALTER TABLE tournament_teams DROP COLUMN withdrawn_at; ALTER TABLE tournament_teams DROP COLUMN withdraw_reason; ALTER TABLE tournament_matches DROP COLUMN result_version; ALTER TABLE tournament_matches DROP COLUMN result_kind; ALTER TABLE tournament_matches DROP COLUMN result_reason; ALTER TABLE tournament_matches DROP COLUMN ready_a_at; ALTER TABLE tournament_matches DROP COLUMN ready_b_at; DROP TABLE tournament_notifications; ALTER TABLE tournament_matches DROP COLUMN starts_at; ALTER TABLE tournament_matches DROP COLUMN schedule_version; ALTER TABLE tournaments DROP COLUMN cancelled_at; ALTER TABLE tournaments DROP COLUMN cancel_reason; DROP TABLE tournament_roster; ALTER TABLE tournament_teams DROP COLUMN roster_required; PRAGMA user_version=23;');db.close();
  for(let i=0;i<2;i++){db=openDatabase(file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,28);assert.equal(db.prepare('SELECT count(*) n FROM tournament_roster').get().n,4);assert.equal(db.prepare('SELECT sum(roster_required) n FROM tournament_teams').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT winner FROM tournament_matches WHERE tournament_id=2').get().winner,3);assert.equal(db.prepare('SELECT state FROM tournaments WHERE id=2').get().state,'finished');db.close();}
  db=openDatabase(file);const {req}=fixture(db);assert.equal(req('start').status,200);assert.equal(db.prepare('SELECT count(*) n FROM tournament_matches').get().n,2);
 }finally{if(db?.isOpen)db.close();rmSync(directory,{recursive:true,force:true});}
});

test('HTTP invitations require consent and CSRF, and competing last-slot invitations stay bounded',async t=>{
 const app=await createApp(),origin=await app.listen();t.after(()=>app.close());
 function client(){return {cookie:'',csrf:'',async req(path,body,csrf=true){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':csrf?this.csrf:'bad'},body:body?JSON.stringify(body):undefined}),d=await r.json();if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(d.csrf)this.csrf=d.csrf;return {status:r.status,...d};}};}
 const clients=Array.from({length:7},client);for(let i=0;i<7;i++){assert.equal((await clients[i].req('/api/register',{handle:'roster_http'+i,name:'User '+i,password:'Roster-HTTP-test-only-123'})).status,201);}
 // Profile settings use PATCH; keep real account privacy defaults until explicitly changed.
 for(const c of clients){const r=await fetch(origin+'/api/me',{method:'PATCH',headers:{Cookie:c.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':c.csrf},body:JSON.stringify({profileVisible:true})});assert.equal(r.status,200);}
 const id=(await clients[0].req('/api/tournaments',{title:'HTTP roster',capacity:4,clientId:'roster-http-fixture'})).id,path='/api/tournaments/'+id;
 assert.equal((await clients[1].req(path+'/join',{name:'HTTP Alpha'})).status,200);
 assert.equal((await client().req(path+'/accept',{})).status,401);assert.equal((await clients[2].req(path+'/accept',{},false)).status,403);
 for(let i=2;i<5;i++)assert.equal((await clients[1].req(path+'/invite',{handle:'roster_http'+i})).status,200);
 const results=await Promise.all([clients[1].req(path+'/invite',{handle:'roster_http5'}),clients[1].req(path+'/invite',{handle:'roster_http6'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await clients[1].req(path)).roster.length,5);assert.equal((await client().req(path)).roster.length,0);
 assert.equal((await clients[3].req(path+'/invite',{handle:'roster_http0'})).status,403);
 assert.equal((await clients[2].req(path+'/accept',{})).status,200);assert.equal((await clients[2].req(path+'/accept',{})).status,200);
 assert.equal((await clients[2].req(path+'/join',{name:'Another'})).status,409);
 assert.equal((await clients[3].req(path+'/decline',{})).status,200);
 assert.equal((await clients[1].req(path+'/invite',{handle:'roster_http3'})).status,409);
 for(const action of ['invite','accept','start','join','results'])assert.equal(restrictedWrite('POST',path+'/'+action,{}),true);
 for(const action of ['decline','member-leave','leave','remove'])assert.equal(restrictedWrite('POST',path+'/'+action,{}),false);
});
