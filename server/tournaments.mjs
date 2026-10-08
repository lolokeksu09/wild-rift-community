import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
export function tournamentRoutes({db,user,path,method,body,send,now}) {
 if(!/^\/api\/tournaments(?:\/|$)/.test(path))return false;
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const signed=()=>{if(!user)fail(401,'Сначала войди в аккаунт.');};
 const owner=t=>{signed();if(t.owner_id!==user.id)fail(403,'Действие доступно организатору.');};
 const blocked=id=>user&&get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',user.id,id,id,user.id);
 const safe=t=>({id:t.id,title:t.title,description:t.description,capacity:t.capacity,state:t.state,owner_id:t.owner_id,created_at:t.created_at});
 if(path==='/api/tournaments'&&method==='GET'){send(200,{tournaments:all('SELECT * FROM tournaments ORDER BY id DESC LIMIT 50').filter(t=>!blocked(t.owner_id)).map(t=>({...safe(t),teamCount:get('SELECT count(*) n FROM tournament_teams WHERE tournament_id=?',t.id).n}))});return true;}
 if(path==='/api/tournaments'&&method==='POST'){
  signed();const title=text(body.title,'Название',3,80),description=text(body.description??'','Описание',0,1000),capacity=body.capacity,clientId=text(body.clientId,'Идентификатор',16,80);
  if(![4,8,16].includes(capacity))fail(422,'Выбери лимит 4, 8 или 16 команд.');
  const signature=JSON.stringify({title,description,capacity});
  const id=transaction(db,()=>{const old=get('SELECT id,signature FROM tournaments WHERE owner_id=? AND client_id=?',user.id,clientId);if(old){if(old.signature!==signature)fail(409,'Запрос уже использован для другого турнира.');return old.id;}
   if(get("SELECT count(*) n FROM tournaments WHERE owner_id=? AND state!='finished'",user.id).n>=5)fail(409,'Можно организовать до пяти незавершённых турниров.');
   return Number(run('INSERT INTO tournaments(owner_id,title,description,capacity,client_id,signature,created_at) VALUES(?,?,?,?,?,?,?)',user.id,title,description,capacity,clientId,signature,now()).lastInsertRowid);});send(200,{id});return true;
 }
 const m=path.match(/^\/api\/tournaments\/(\d+)(?:\/(join|leave|start|results))?$/);if(!m)fail(404,'Маршрут не найден.');
 const id=Number(m[1]),t=get('SELECT * FROM tournaments WHERE id=?',id);if(!t||blocked(t.owner_id))fail(404,'Турнир недоступен.');
 if(!m[2]&&method==='GET'){const teams=all('SELECT id,name,captain_id FROM tournament_teams WHERE tournament_id=? ORDER BY id',id);send(200,{tournament:safe(t),teams,matches:all('SELECT round,slot,team_a,team_b,score_a,score_b,winner FROM tournament_matches WHERE tournament_id=? ORDER BY round,slot',id),myTeam:teams.find(x=>x.captain_id===user?.id)?.id||null});return true;}
 if(method!=='POST')fail(405,'Метод не поддерживается.');signed();
 const open=()=>{if(t.state!=='open')fail(409,'Набор команд завершён.');};
 if(m[2]==='join'){
  const name=text(body.name,'Название команды',2,40);
  const teamId=transaction(db,()=>{open();const old=get('SELECT id,name FROM tournament_teams WHERE tournament_id=? AND captain_id=?',id,user.id);if(old){if(old.name!==name)fail(409,'Ты уже зарегистрировал другую команду.');return old.id;}
   if(get('SELECT count(*) n FROM tournament_teams WHERE tournament_id=?',id).n>=t.capacity)fail(409,'Все места заняты.');
   if(get('SELECT 1 FROM tournament_teams WHERE tournament_id=? AND name=? COLLATE NOCASE',id,name))fail(409,'Название команды уже занято.');
   return Number(run('INSERT INTO tournament_teams(tournament_id,captain_id,name) VALUES(?,?,?)',id,user.id,name).lastInsertRowid);});send(200,{teamId});return true;
 }
 if(m[2]==='leave'){transaction(db,()=>{open();run('DELETE FROM tournament_teams WHERE tournament_id=? AND captain_id=?',id,user.id);});send(200,{ok:true});return true;}
 if(m[2]==='start'){
  owner(t);transaction(db,()=>{if(t.state!=='open')return;const teams=all('SELECT id FROM tournament_teams WHERE tournament_id=? ORDER BY id',id);if(teams.length<2)fail(409,'Нужны хотя бы две команды.');
   const size=2**Math.ceil(Math.log2(teams.length)),rounds=Math.log2(size);
   for(let round=1;round<=rounds;round++)for(let slot=0;slot<size/2**round;slot++)run('INSERT INTO tournament_matches(tournament_id,round,slot) VALUES(?,?,?)',id,round,slot);
   // Distribute byes across matches; never create a match with two empty teams.
   const byes=size-teams.length;let next=0;
   for(let slot=0;slot<size/2;slot++){const a=teams[next++].id,b=slot<byes?null:teams[next++].id;run('UPDATE tournament_matches SET team_a=?,team_b=?,winner=? WHERE tournament_id=? AND round=1 AND slot=?',a,b,b?null:a,id,slot);if(!b)run(`UPDATE tournament_matches SET ${slot%2?'team_b':'team_a'}=? WHERE tournament_id=? AND round=2 AND slot=?`,a,id,Math.floor(slot/2));}
   run("UPDATE tournaments SET state='running' WHERE id=?",id);});send(200,{ok:true});return true;
 }
 if(m[2]==='results'){
  owner(t);const {round,slot,scoreA,scoreB}=body;if(![round,slot,scoreA,scoreB].every(Number.isSafeInteger)||round<1||slot<0||scoreA<0||scoreB<0||scoreA>9||scoreB>9||scoreA===scoreB)fail(422,'Введи счёт 0–9 без ничьей.');
  transaction(db,()=>{const match=get('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND slot=?',id,round,slot);if(!match||!match.team_a||!match.team_b)fail(409,'Матч ещё не готов.');if(match.winner){if(match.score_a===scoreA&&match.score_b===scoreB)return;fail(409,'Результат уже зафиксирован.');}if(t.state!=='running')fail(409,'Турнир не идёт.');const winner=scoreA>scoreB?match.team_a:match.team_b;
   run('UPDATE tournament_matches SET score_a=?,score_b=?,winner=? WHERE tournament_id=? AND round=? AND slot=?',scoreA,scoreB,winner,id,round,slot);
   const next=get('SELECT 1 FROM tournament_matches WHERE tournament_id=? AND round=? AND slot=?',id,round+1,Math.floor(slot/2));if(next)run(`UPDATE tournament_matches SET ${slot%2?'team_b':'team_a'}=? WHERE tournament_id=? AND round=? AND slot=?`,winner,id,round+1,Math.floor(slot/2));else run("UPDATE tournaments SET state='finished' WHERE id=?",id);
  });send(200,{ok:true});return true;
 }
 fail(405,'Метод не поддерживается.');
}
