import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../database.mjs';
import {tournamentRoutes} from '../tournaments.mjs';

test('captain search hides unavailable players and rechecks visibility at invitation time',()=>{
 const db=openDatabase(':memory:');
 try{
  for(let i=0;i<22;i++)db.prepare('INSERT INTO users(id,handle,name,password,created_at,profile_visible) VALUES(?,?,?,?,0,1)').run('c'+i,'candidate'+String(i).padStart(2,'0'),i===10?'Игрок <img src=x>':'Игрок '+i,'unused');
  const req=(path,uid='c1',method='GET',body={})=>{const url=new URL('https://local.test'+path);let result;try{tournamentRoutes({db,user:uid?{id:uid}:null,path:url.pathname,url,method,body,send:(status,data)=>result={status,...data},now:()=>100});return result;}catch(e){return {status:e.status};}};
  const {id}=req('/api/tournaments','c0','POST',{title:'Search cup',capacity:4,clientId:'candidate-test-stage43'}),base='/api/tournaments/'+id;
  req(base+'/join','c1','POST',{name:'Alpha'});req(base+'/join','c2','POST',{name:'Beta'});
  req(base+'/invite','c2','POST',{handle:'candidate03'});
  req(base+'/invite','c1','POST',{handle:'candidate04'});
  db.prepare('UPDATE users SET profile_visible=0 WHERE id=?').run('c5');
  db.prepare('INSERT INTO blocks VALUES(?,?)').run('c1','c6');
  db.prepare('INSERT INTO blocks VALUES(?,?)').run('c7','c0');
  db.prepare('UPDATE users SET game_profile=? WHERE id=?').run(JSON.stringify({demoBot:'community-v1'}),'c8');
  for(let i=0;i<2;i++){const report=Number(db.prepare("INSERT INTO reports(reporter_id,kind,target_id,sender_id,snapshot,reason,status,created_at) VALUES('c0','post',?,'c13','fixture','reason','upheld',1)").run('candidate-sanction-'+i).lastInsertRowid);db.prepare("INSERT INTO moderation_audit(report_id,actor_id,decision,note,created_at) VALUES(?,'c0','upheld','fixture',10)").run(report);}
  const search=base+'/invite-candidates?q=';
  assert.equal(req(search+'candidate',null).status,401);
  assert.equal(req(search+'candidate','c0').status,403);
  assert.equal(req(search+'candidate','c4').status,403);
  assert.equal(req(search+'x'.repeat(81)).status,422);
  assert.deepEqual(req(search+'c').players,[]);
  const found=req(search+'candidate');assert.equal(found.viewerId,'c1');assert.equal(found.freeSlots,3);assert.equal(found.players.length,12);
  for(const hidden of [1,2,3,4,5,6,7,8,13])assert.ok(!found.players.some(p=>p.handle==='candidate'+String(hidden).padStart(2,'0')));
  assert.deepEqual(Object.keys(found.players[0]).sort(),['avatarId','handle','name']);
  assert.equal(req(search+encodeURIComponent('ИГРОК <IMG')).players[0].handle,'candidate10');
  assert.equal(req(search+'%').players.length,0);
  assert.equal(req(search+'%40candidate10').players[0].handle,'candidate10');
  db.prepare('UPDATE users SET profile_visible=0 WHERE id=?').run('c10');
  assert.equal(req(base+'/invite','c1','POST',{handle:'candidate10',clientId:'candidate-hidden-43'}).status,404);
  assert.deepEqual(req(search+'candidate10').players,[]);
  for(const handle of ['candidate09','candidate11','candidate12'])assert.equal(req(base+'/invite','c1','POST',{handle}).status,200);
  assert.equal(req(search+'candidate').freeSlots,0);assert.deepEqual(req(search+'candidate').players,[]);
  db.prepare("UPDATE tournaments SET state='running' WHERE id=?").run(id);
  assert.equal(req(search+'candidate').status,409);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
