import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../database.mjs';import {tournamentRoutes} from '../tournaments.mjs';import {createApp} from '../app.mjs';
function fixture(){const db=openDatabase(':memory:');for(let i=0;i<4;i++)db.prepare('INSERT INTO users(id,handle,name,password,created_at,profile_visible) VALUES(?,?,?,?,0,1)').run('n'+i,'notice'+i,'Private name '+i,'unused');
 const req=(path,body={},uid='n0',method='POST')=>{let response;try{tournamentRoutes({db,user:uid?{id:uid}:null,path:new URL(path,'https://example.test').pathname,method,body,url:new URL(path,'https://example.test'),send:(status,data)=>response={status,...data},now:()=>123});return response;}catch(e){return {status:e.status};}};
 const id=req('/api/tournaments',{title:'Title <img>',capacity:4,clientId:'notice-stable-fixture'}).id,path='/api/tournaments/'+id;req(path+'/join',{name:'Alpha <svg>'},'n1');req(path+'/invite',{handle:'notice2'},'n1');return {db,req,path};}
test('private pending invitations disappear on response, block, removal and cancellation without leaking profiles',()=>{const {db,req,path}=fixture();try{
 const inbox='/api/tournaments/invitations';assert.equal(req(inbox,{},null,'GET').status,401);assert.equal(req(inbox,{},'n3','GET').pending,0);
 let list=req(inbox,{},'n2','GET');assert.equal(list.viewerId,'n2');assert.equal(list.pending,1);assert.equal(list.invitations[0].tournament_id,1);assert.equal(list.invitations[0].team_name,'Alpha <svg>');assert.equal(JSON.stringify(list).includes('Private name'),false);
 req(path+'/invite',{handle:'notice2'},'n1');assert.equal(req(inbox+'/summary',{},'n2','GET').pending,1);
 for(const target of ['n0','n1']){db.prepare('INSERT INTO blocks(blocker_id,target_id) VALUES(?,?)').run(target,'n2');assert.equal(req(inbox,{},'n2','GET').pending,0);db.prepare('DELETE FROM blocks').run();}
 assert.equal(req(path+'/accept',{},'n2').status,200);assert.equal(req(inbox,{},'n2','GET').pending,0);
 req(path+'/invite',{handle:'notice3'},'n1');assert.equal(req(inbox,{},'n3','GET').pending,1);req(path+'/remove',{userId:'n3'},'n1');assert.equal(req(inbox,{},'n3','GET').pending,0);
 // Existing accepted members remain history; no invitation reappears on cancellation.
 req(path+'/cancel',{reason:'Not enough players'});assert.equal(req(inbox,{},'n2','GET').pending,0);assert.equal(req(inbox+'/summary',{},'n3','GET').pending,0);
}finally{db.close();}});
test('invitation pagination reaches older tournaments beyond public latest-50 list and rejects invalid cursors',()=>{const {db,req}=fixture();try{
 for(let i=2;i<=56;i++){db.prepare("INSERT INTO tournaments(id,owner_id,title,description,capacity,client_id,signature,created_at) VALUES(?,'n0','Older invite','',4,?,'s',0)").run(i,'page-'+i);const team=Number(db.prepare("INSERT INTO tournament_teams(tournament_id,captain_id,name) VALUES(?,'n1','Page team')").run(i).lastInsertRowid);db.prepare("INSERT INTO tournament_roster VALUES(?,?,'n2','pending')").run(i,team);}
 const inbox='/api/tournaments/invitations',page=req(inbox,{},'n2','GET');assert.equal(page.pending,56);assert.equal(page.invitations.length,50);assert.ok(page.next);
 const old=req(inbox+'?before='+page.next,{},'n2','GET');assert.equal(old.invitations.length,6);assert.equal(old.invitations.at(-1).tournament_id,1);assert.equal(old.next,null);
 assert.equal(req(inbox+'?before=invalid',{},'n2','GET').status,422);
}finally{db.close();}});
test('combined HTTP notification summary includes private invitations and invalidates them after cancellation',async t=>{
 const app=await createApp(),origin=await app.listen();t.after(()=>app.close());
 const client=()=>({cookie:'',csrf:'',async req(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf},body:body?JSON.stringify(body):undefined}),d=await r.json();if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(d.csrf)this.csrf=d.csrf;return {status:r.status,...d};}});
 const owner=client(),captain=client(),player=client();for(const [c,handle] of [[owner,'notice_owner'],[captain,'notice_captain'],[player,'notice_player']])await c.req('/api/register','POST',{handle,name:handle,password:'Invitation-test-only-123'});
 await player.req('/api/me','PATCH',{profileVisible:true});const id=(await owner.req('/api/tournaments','POST',{title:'Notice cup',capacity:4,clientId:'http-notice-stable'})).id,path='/api/tournaments/'+id;
 await captain.req(path+'/join','POST',{name:'Notice team'});await captain.req(path+'/invite','POST',{handle:'notice_player'});
 assert.equal((await client().req('/api/tournaments/invitations')).status,401);assert.equal((await owner.req('/api/notifications/summary')).tournaments.pending,0);assert.equal((await player.req('/api/notifications/summary')).tournaments.pending,1);
 await owner.req(path+'/cancel','POST',{reason:'Not enough players'});assert.equal((await player.req('/api/notifications/summary')).tournaments.pending,0);
});
