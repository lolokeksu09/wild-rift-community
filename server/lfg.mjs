import {chatMessages} from './chat-messages.mjs';
import {fold} from './players.mjs';
import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
export function lfgRoutes({db,user,path,method,body,url,send,now}){
 if(!path.startsWith('/api/lfg'))return false;
 if(!user)fail(401,'Сначала войди в аккаунт.');
 const get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 const notify=(recipient,groupId,kind)=>run('INSERT INTO lfg_notifications(user_id,group_id,kind,created_at) VALUES(?,?,?,?)',recipient,groupId,kind,now());
 const blocked=(a,b)=>!!get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',a,b,b,a);
 const count=id=>get("SELECT count(*) AS n FROM lfg_members WHERE group_id=? AND status='accepted'",id).n;
 const state=g=>g.closed?'closed':g.expires_at<=now()?'expired':count(g.id)>=g.capacity?'full':'open';
 const group=id=>{const g=get('SELECT * FROM lfg_groups WHERE id=?',id);if(!g)fail(404,'Группа не найдена.');return g;};
 const membership=id=>get('SELECT status FROM lfg_members WHERE group_id=? AND user_id=?',id,user.id)?.status||null;
 const member=g=>{if(membership(g.id)!=='accepted')fail(403,'Чат доступен только принятым участникам.');};
 const current=g=>{if(g.closed||g.expires_at<=now())fail(409,'Группа закрыта или срок объявления истёк.');};
 const clientId=()=>{const id=text(body.clientId,'Идентификатор отправки',16,80);if(!/^[A-Za-z0-9_-]+$/.test(id))fail(422,'Некорректный идентификатор.');return id;};
 const cursor=()=>{const raw=url.searchParams.get('before');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');return Number(raw??Number.MAX_SAFE_INTEGER);};
 const notificationAccess=`FROM lfg_notifications n JOIN lfg_groups g ON g.id=n.group_id WHERE n.user_id=:viewer AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=g.owner_id) OR (b.blocker_id=g.owner_id AND b.target_id=:viewer))`;
 const card=g=>{const {create_signature,client_id,...safe}=g;return {...safe,members:count(g.id),state:state(g),membership:membership(g.id)};};
 if(path==='/api/lfg/notifications/summary'&&method==='GET'){
  send(200,{viewerId:user.id,unread:get(`SELECT count(*) AS n ${notificationAccess} AND n.seen=0`,{viewer:user.id}).n});return true;
 }
 if(path==='/api/lfg/notifications'&&method==='GET'){
  const result=all(`SELECT n.id,n.group_id,n.kind,n.created_at,n.seen,g.title ${notificationAccess} AND n.id<:before ${url.searchParams.get('unread')==='1'?'AND n.seen=0':''} ORDER BY n.id DESC LIMIT 51`,{viewer:user.id,before:cursor()});const notifications=result.slice(0,50);
  send(200,{viewerId:user.id,notifications,next:result.length>50?notifications.at(-1).id:null});return true;
 }
 const readNotification=path.match(/^\/api\/lfg\/notifications\/(\d+)\/read$/);
 if(readNotification&&method==='POST'){
  const id=Number(readNotification[1]);if(!get('SELECT id FROM lfg_notifications WHERE id=? AND user_id=?',id,user.id))fail(404,'Уведомление недоступно.');
  run('UPDATE lfg_notifications SET seen=1 WHERE id=? AND user_id=?',id,user.id);send(200,{ok:true});return true;
 }
 if(path==='/api/lfg'&&method==='POST'){
  const input={title:text(body.title,'Название',3,80),mode:text(body.mode,'Режим',1,24),region:text(body.region,'Регион',1,40).toLowerCase(),language:text(body.language,'Язык',1,40).toLowerCase(),role:text(body.role,'Роль',1,24),rank:text(body.rank??'','Желаемый ранг',0,40),voice:text(body.voice,'Голос',1,24),description:text(body.description??'','Описание',0,1000),capacity:body.capacity,startsAt:body.startsAt??null,durationHours:body.durationHours};
  if(!['ranked','normal','aram','custom'].includes(input.mode)||!['any','baron','jungle','mid','dragon','support'].includes(input.role)||!['optional','required','none'].includes(input.voice)||!Number.isInteger(input.capacity)||input.capacity<2||input.capacity>5||![1,2,4,8,24].includes(input.durationHours))fail(422,'Проверь параметры группы.');
  const key=clientId(),signature=JSON.stringify(input);
  const result=transaction(db,()=>{
   const old=get('SELECT id,create_signature FROM lfg_groups WHERE owner_id=? AND client_id=?',user.id,key);
   if(old){if(old.create_signature!==signature)fail(409,'Идентификатор использован для другого объявления.');return {id:old.id,replayed:true};}
   const start=input.startsAt??now();if(!Number.isSafeInteger(start)||start<now()-60000||start>now()+7*86400000)fail(422,'Начало: сейчас или в ближайшие 7 дней.');
   if(get('SELECT count(*) AS n FROM lfg_groups WHERE owner_id=? AND closed=0 AND expires_at>?',user.id,now()).n>=5)fail(409,'Сначала закрой одно из пяти активных объявлений.');
   const r=run(`INSERT INTO lfg_groups(owner_id,client_id,create_signature,title,mode,region,language,role,rank,voice,description,capacity,starts_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,user.id,key,signature,input.title,input.mode,input.region,input.language,input.role,input.rank,input.voice,input.description,input.capacity,start,start+input.durationHours*3600000,now());
   const id=Number(r.lastInsertRowid);run("INSERT INTO lfg_members VALUES(?,?,'accepted')",id,user.id);return {id,replayed:false};
  });send(result.replayed?200:201,result);return true;
 }
 if(path==='/api/lfg'&&method==='GET'){
  const mine=url.searchParams.get('mine')==='1',params=[cursor()];let where='g.id<?';
  if(mine){where+=' AND EXISTS(SELECT 1 FROM lfg_members m WHERE m.group_id=g.id AND m.user_id=?)';params.push(user.id);}
  else{where+=' AND g.closed=0 AND g.expires_at>? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=g.owner_id) OR (b.blocker_id=g.owner_id AND b.target_id=?))';params.push(now(),user.id,user.id);}
  const filters={mode:['ranked','normal','aram','custom'],role:['any','baron','jungle','mid','dragon','support'],voice:['none','optional','required']};
  for(const field of ['mode','region','language','role','rank','voice']){
   const value=url.searchParams.get(field);
   if(value){const normalized=fold(text(value,field,1,40));if(filters[field]&&!filters[field].includes(normalized))fail(422,'Проверь фильтры группы.');where+=` AND wr_fold(g.${field})=?`;params.push(normalized);}
  }
  const result=all(`SELECT g.* FROM lfg_groups g WHERE ${where} ORDER BY g.id DESC LIMIT 51`,...params),groups=result.slice(0,50).map(card);
  send(200,{viewerId:user.id,groups,next:result.length>50?groups.at(-1).id:null});return true;
 }
 const match=path.match(/^\/api\/lfg\/(\d+)(?:\/(apply|leave|decision|close|messages(?:\/\d+(?:\/(?:edit|delete|reaction))?)?))?$/);
 if(!match)fail(404,'Маршрут не найден.');
 const id=Number(match[1]),action=match[2],g=group(id);
 if(!action&&method==='GET'){
  const status=membership(id),owner=g.owner_id===user.id;
  if(blocked(user.id,g.owner_id)&&!status)fail(404,'Группа недоступна.');
  const members=owner?all('SELECT u.id,u.name,u.handle,m.status FROM lfg_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY u.handle',id):status==='accepted'?all("SELECT u.id,u.name,u.handle,m.status FROM lfg_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.status='accepted' ORDER BY u.handle",id):[];
  send(200,{viewerId:user.id,group:card(g),members});return true;
 }
 if(action==='apply'&&method==='POST'){
  const status=transaction(db,()=>{
   current(g);if(blocked(user.id,g.owner_id))fail(403,'Заявка недоступна.');
   const old=membership(id);if(['accepted','pending'].includes(old))return old;
   if(old==='rejected')fail(403,'Заявка отклонена владельцем.');
   if(count(id)>=g.capacity)fail(409,'Свободных мест нет.');
   run("INSERT INTO lfg_members VALUES(?,?,'pending') ON CONFLICT(group_id,user_id) DO UPDATE SET status='pending'",id,user.id);notify(g.owner_id,id,'application');return 'pending';
  });send(200,{status});return true;
 }
 if(action==='leave'&&method==='POST'){
  if(g.owner_id===user.id)fail(409,'Автор может закрыть группу.');
  transaction(db,()=>{const old=membership(id);const result=run("UPDATE lfg_members SET status='cancelled' WHERE group_id=? AND user_id=? AND status IN ('accepted','pending')",id,user.id);if(result.changes)notify(g.owner_id,id,old==='accepted'?'left':'cancelled');});send(200,{ok:true});return true;
 }
 if(action==='close'&&method==='POST'){
  if(g.owner_id!==user.id)fail(403,'Закрыть группу может автор.');transaction(db,()=>{const result=run('UPDATE lfg_groups SET closed=1 WHERE id=? AND closed=0',id);if(result.changes)for(const m of all("SELECT user_id FROM lfg_members WHERE group_id=? AND user_id<>? AND status IN ('accepted','pending')",id,user.id))notify(m.user_id,id,'closed');});send(200,{ok:true});return true;
 }
 if(action==='decision'&&method==='POST'){
  if(g.owner_id!==user.id)fail(403,'Заявки рассматривает автор.');
  const target=text(body.userId,'Участник',1,80);if(target===user.id||!['accept','reject'].includes(body.decision))fail(422,'Некорректное решение.');
  transaction(db,()=>{
   current(g);const old=get('SELECT status FROM lfg_members WHERE group_id=? AND user_id=?',id,target)?.status;
   const next=body.decision==='accept'?'accepted':'rejected';if(old===next)return;
   if(old!=='pending'&&!(old==='accepted'&&next==='rejected'))fail(409,'Нет подходящей заявки.');
   if(next==='accepted'){if(blocked(g.owner_id,target))fail(403,'Участник заблокирован.');if(count(id)>=g.capacity)fail(409,'Последнее место уже занято.');}
   run('UPDATE lfg_members SET status=? WHERE group_id=? AND user_id=?',next,id,target);notify(target,id,next==='accepted'?'accepted':old==='accepted'?'removed':'rejected');
  });send(200,{ok:true});return true;
 }
 if(action?.startsWith('messages')){member(g);return chatMessages({db,kind:'lfg',chatId:id,user,method,body,url,send,now,canSend:!g.closed&&g.expires_at>now()});}

 fail(405,'Метод не поддерживается.');
}
