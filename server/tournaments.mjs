import {sanctionFor} from './sanctions.mjs';
import {isDemo} from './demo.mjs';
import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
export function tournamentRoutes({db,user,path,method,body,send,now,url}) {
 if(!/^\/api\/tournaments(?:\/|$)/.test(path))return false;
 const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const signed=()=>{if(!user)fail(401,'Сначала войди в аккаунт.');};
 const owner=t=>{signed();if(t.owner_id!==user.id)fail(403,'Действие доступно организатору.');};
 const blocked=id=>user&&get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',user.id,id,id,user.id);
 const between=(a,b)=>get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',a,b,b,a);
 const eligible=uid=>!['restricted','suspended'].includes(sanctionFor(db,uid,now())?.level);
 const safe=t=>({id:t.id,title:t.title,description:t.description,capacity:t.capacity,state:t.cancelled_at!==null?'cancelled':t.state,cancelled_at:t.cancelled_at,cancel_reason:t.cancel_reason,owner_id:t.owner_id,created_at:t.created_at});
 if(['/api/tournaments/invitations','/api/tournaments/invitations/summary'].includes(path)&&method==='GET'){
  signed();const availability=new Map(),available=uid=>{if(!availability.has(uid))availability.set(uid,!blocked(uid)&&eligible(uid));return availability.get(uid);};
  const invitations=all(`SELECT t.id tournament_id,t.title,team.name team_name,team.captain_id,t.owner_id
    FROM tournament_roster r JOIN tournament_teams team ON team.id=r.team_id AND team.tournament_id=r.tournament_id
    JOIN tournaments t ON t.id=r.tournament_id
    WHERE r.user_id=? AND r.status='pending' AND t.state='open' AND t.cancelled_at IS NULL ORDER BY t.id DESC`,user.id).filter(x=>available(x.captain_id)&&available(x.owner_id));
  if(path.endsWith('/summary')){send(200,{viewerId:user.id,pending:invitations.length});return true;}
  const before=url?.searchParams.get('before');if(before!==undefined&&before!==null&&(!/^[1-9]\d*$/.test(before)||!Number.isSafeInteger(Number(before))))fail(422,'Некорректная граница списка.');
  const page=invitations.filter(x=>!before||x.tournament_id<Number(before)).slice(0,51),more=page.length>50;page.splice(50);
  send(200,{viewerId:user.id,pending:invitations.length,invitations:page.map(({tournament_id,title,team_name})=>({tournament_id,title,team_name})),next:more?page.at(-1).tournament_id:null});return true;
 }
 if(path==='/api/tournaments'&&method==='GET'){send(200,{tournaments:all('SELECT * FROM tournaments ORDER BY id DESC LIMIT 50').filter(t=>!blocked(t.owner_id)).map(t=>({...safe(t),teamCount:get('SELECT count(*) n FROM tournament_teams WHERE tournament_id=?',t.id).n,invited:!!(t.cancelled_at===null&&user&&get("SELECT 1 FROM tournament_roster WHERE tournament_id=? AND user_id=? AND status='pending'",t.id,user.id))}))});return true;}
 if(path==='/api/tournaments'&&method==='POST'){
  signed();const title=text(body.title,'Название',3,80),description=text(body.description??'','Описание',0,1000),capacity=body.capacity,clientId=text(body.clientId,'Идентификатор',16,80);
  if(![4,8,16].includes(capacity))fail(422,'Выбери лимит 4, 8 или 16 команд.');
  const signature=JSON.stringify({title,description,capacity});
  const id=transaction(db,()=>{const old=get('SELECT id,signature FROM tournaments WHERE owner_id=? AND client_id=?',user.id,clientId);if(old){if(old.signature!==signature)fail(409,'Запрос уже использован для другого турнира.');return old.id;}
   if(get("SELECT count(*) n FROM tournaments WHERE owner_id=? AND state!='finished' AND cancelled_at IS NULL",user.id).n>=5)fail(409,'Можно организовать до пяти незавершённых турниров.');
   return Number(run('INSERT INTO tournaments(owner_id,title,description,capacity,client_id,signature,created_at) VALUES(?,?,?,?,?,?,?)',user.id,title,description,capacity,clientId,signature,now()).lastInsertRowid);});send(200,{id});return true;
 }
 const m=path.match(/^\/api\/tournaments\/(\d+)(?:\/(join|leave|start|results|invite|accept|decline|remove|member-leave|cancel))?$/);if(!m)fail(404,'Маршрут не найден.');
 const id=Number(m[1]),t=get('SELECT * FROM tournaments WHERE id=?',id);if(!t||blocked(t.owner_id))fail(404,'Турнир недоступен.');
 if(!m[2]&&method==='GET'){
  const teams=all(`SELECT t.id,t.name,t.captain_id,t.roster_required,
    (SELECT count(*) FROM tournament_roster r WHERE r.team_id=t.id AND r.status='accepted') memberCount
    FROM tournament_teams t WHERE tournament_id=? ORDER BY id`,id);
  const membership=user&&get('SELECT * FROM tournament_roster WHERE tournament_id=? AND user_id=?',id,user.id);
  const myTeam=membership?.status==='accepted'?membership.team_id:null;
  const invitation=membership?.status==='pending'&&t.state==='open'&&t.cancelled_at===null&&!blocked(teams.find(x=>x.id===membership.team_id)?.captain_id)?teams.find(x=>x.id===membership.team_id):null;
  const roster=myTeam?all(`SELECT r.user_id,r.status,u.handle FROM tournament_roster r JOIN users u ON u.id=r.user_id WHERE r.team_id=? AND r.status!='declined' ORDER BY r.user_id`,myTeam).filter(r=>!blocked(r.user_id)):[];
  send(200,{tournament:safe(t),teams,roster,invitation,matches:all('SELECT round,slot,team_a,team_b,score_a,score_b,winner FROM tournament_matches WHERE tournament_id=? ORDER BY round,slot',id),myTeam});return true;
 }
 if(method!=='POST')fail(405,'Метод не поддерживается.');signed();
 if(m[2]==='cancel'){
  owner(t);const reason=text(body.reason,'Причина отмены',5,300);
  transaction(db,()=>{
   if(t.cancelled_at!==null){if(t.cancel_reason!==reason)fail(409,'Турнир уже отменён с другой причиной.');return;}
   if(t.state!=='open')fail(409,'Можно отменить только турнир до старта.');
   run('UPDATE tournaments SET cancelled_at=?,cancel_reason=? WHERE id=?',now(),reason,id);
  });send(200,{ok:true});return true;
 }
 if(t.cancelled_at!==null)fail(409,'Турнир отменён. Заявки и приглашения закрыты.');
 const open=()=>{if(t.state!=='open')fail(409,'Набор команд завершён.');};
 if(m[2]==='join'){
  const name=text(body.name,'Название команды',2,40);
  const teamId=transaction(db,()=>{open();const old=get('SELECT id,name FROM tournament_teams WHERE tournament_id=? AND captain_id=?',id,user.id);if(old){if(old.name!==name)fail(409,'Ты уже зарегистрировал другую команду.');return old.id;}
   if(get("SELECT 1 FROM tournament_roster WHERE tournament_id=? AND user_id=? AND status!='declined'",id,user.id))fail(409,'Ты уже в команде или получил приглашение. Сначала выйди или отклони его.');
   if(get('SELECT count(*) n FROM tournament_teams WHERE tournament_id=?',id).n>=t.capacity)fail(409,'Все места заняты.');
   if(get('SELECT 1 FROM tournament_teams WHERE tournament_id=? AND name=? COLLATE NOCASE',id,name))fail(409,'Название команды уже занято.');
   const team=Number(run('INSERT INTO tournament_teams(tournament_id,captain_id,name,roster_required) VALUES(?,?,?,1)',id,user.id,name).lastInsertRowid);
   run("INSERT INTO tournament_roster(tournament_id,team_id,user_id,status) VALUES(?,?,?,'accepted') ON CONFLICT(tournament_id,user_id) DO UPDATE SET team_id=excluded.team_id,status='accepted'",id,team,user.id);return team;});send(200,{teamId});return true;
 }
 if(['invite','accept','decline','remove','member-leave'].includes(m[2])){
  transaction(db,()=>{
   open();const team=get('SELECT * FROM tournament_teams WHERE tournament_id=? AND captain_id=?',id,user.id);
   const membership=get('SELECT * FROM tournament_roster WHERE tournament_id=? AND user_id=?',id,user.id);
   if(m[2]==='invite'){
    if(!team)fail(403,'Приглашения отправляет капитан.');
    const handle=text(body.handle,'Логин игрока',3,33).toLowerCase().replace(/^@/,'');
    const target=get('SELECT * FROM users WHERE handle=? AND profile_visible=1',handle);
    if(!target||isDemo(target)||between(user.id,target.id)||between(t.owner_id,target.id)||!eligible(target.id))fail(404,'Игрок недоступен для приглашения.');
    const old=get('SELECT * FROM tournament_roster WHERE tournament_id=? AND user_id=?',id,target.id);
    if(old?.team_id===team.id){if(old.status==='declined')fail(409,'Игрок отклонил приглашение или вышел.');return;}
    if(old&&old.status!=='declined')fail(409,'Игрок уже в другой команде или получил приглашение.');
    if(get("SELECT count(*) n FROM tournament_roster WHERE team_id=? AND status!='declined'",team.id).n>=5)fail(409,'В составе и приглашениях уже пять игроков.');
    run("INSERT INTO tournament_roster(tournament_id,team_id,user_id,status) VALUES(?,?,?,'pending') ON CONFLICT(tournament_id,user_id) DO UPDATE SET team_id=excluded.team_id,status='pending'",id,team.id,target.id);
   }else if(m[2]==='remove'){
    if(!team)fail(403,'Состав изменяет капитан.');
    const target=text(body.userId,'Игрок',1,80),member=get('SELECT * FROM tournament_roster WHERE tournament_id=? AND user_id=?',id,target);
    if(target===user.id)fail(409,'Капитан может только снять заявку всей команды.');
    if(!member||member.team_id!==team.id)fail(404,'Игрок не в твоей команде.');
    run("UPDATE tournament_roster SET status='declined' WHERE tournament_id=? AND user_id=?",id,target);
   }else{
    if(!membership)fail(409,'Приглашение или команда не найдены.');
    const captain=get('SELECT captain_id FROM tournament_teams WHERE id=?',membership.team_id).captain_id;
    if(captain===user.id)fail(409,'Капитан может только снять заявку всей команды.');
    if(m[2]==='accept'){
     if(between(user.id,captain)||!eligible(captain))fail(404,'Команда недоступна.');
     if(membership.status==='accepted')return;
     if(membership.status!=='pending')fail(409,'Приглашение уже отозвано.');
     if(get("SELECT count(*) n FROM tournament_roster WHERE team_id=? AND status='accepted'",membership.team_id).n>=5)fail(409,'Команда уже собрана.');
     run("UPDATE tournament_roster SET status='accepted' WHERE tournament_id=? AND user_id=?",id,user.id);
    }else{
     if(membership.status==='declined')return;
     if(m[2]==='decline'&&membership.status!=='pending')fail(409,'Ты уже в составе. Используй выход из команды.');
     if(m[2]==='member-leave'&&membership.status!=='accepted')fail(409,'Ты ещё не в составе.');
     run("UPDATE tournament_roster SET status='declined' WHERE tournament_id=? AND user_id=?",id,user.id);
    }
   }
  });send(200,{ok:true});return true;
 }
 if(m[2]==='leave'){transaction(db,()=>{open();run('DELETE FROM tournament_teams WHERE tournament_id=? AND captain_id=?',id,user.id);});send(200,{ok:true});return true;}
 if(m[2]==='start'){
  owner(t);transaction(db,()=>{if(t.state!=='open')return;const teams=all('SELECT id,roster_required,captain_id FROM tournament_teams WHERE tournament_id=? ORDER BY id',id);if(teams.length<2)fail(409,'Нужны хотя бы две команды.');
   for(const team of teams){const members=all("SELECT user_id FROM tournament_roster WHERE team_id=? AND status='accepted'",team.id);
    if(team.roster_required&&members.length!==5)fail(409,'В каждой новой команде нужны пять подтверждённых игроков.');
    if(members.some(r=>!eligible(r.user_id)||between(r.user_id,team.captain_id)||between(r.user_id,t.owner_id)))fail(409,'В составе есть недоступный игрок. Измени состав перед стартом.');
   }
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
