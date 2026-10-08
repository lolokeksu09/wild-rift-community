import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
const ROLES=['baron','jungle','mid','dragon','support'];
export function eventRoutes({db,user,path,method,body,url,send,now}) {
 if(!path.startsWith('/api/events'))return false;
 if(!user)fail(401,'Сначала войди в аккаунт.');
 const get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 const blocked=(a,b)=>!!get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',a,b,b,a);
 const slot=id=>get('SELECT role FROM event_slots WHERE event_id=? AND user_id=?',id,user.id)?.role||null;
 const event=id=>{const e=get('SELECT e.*,u.name AS owner_name FROM game_events e JOIN users u ON u.id=e.owner_id WHERE e.id=?',id);if(!e||blocked(user.id,e.owner_id))fail(404,'Событие недоступно.');return e;};
 const current=e=>{if(e.cancelled||e.starts_at<=now())fail(409,'Набор завершён.');};
 const owner=e=>{if(e.owner_id!==user.id)fail(403,'Действие доступно организатору.');};
 const member=e=>{if(!slot(e.id))fail(403,'Чат доступен только участникам состава.');};
 const key=()=>{const v=text(body.clientId,'Идентификатор отправки',16,80);if(!/^[A-Za-z0-9_-]+$/.test(v))fail(422,'Некорректный идентификатор.');return v;};
 const cursor=()=>{const raw=url.searchParams.get('before');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');return Number(raw??Number.MAX_SAFE_INTEGER);};
 const notify=(uid,id,kind)=>run('INSERT INTO event_notifications(user_id,event_id,kind,created_at) VALUES(?,?,?,?)',uid,id,kind,now());
 const card=e=>{const {signature,client_id,...safe}=e;const slots=all('SELECT role,user_id FROM event_slots WHERE event_id=? ORDER BY role',e.id);return {...safe,myRole:slot(e.id),slots:slots.map(s=>({role:s.role,taken:!!s.user_id})),state:e.cancelled?'cancelled':e.ends_at<=now()?'ended':e.starts_at<=now()?'started':slots.every(s=>s.user_id)?'full':'open'};};
 // Materialise only the current recipient's due reminders. No off-app delivery or background queue.
 const reminders=()=>run(`INSERT OR IGNORE INTO event_notifications(user_id,event_id,kind,created_at)
   SELECT ?,e.id,'reminder',? FROM game_events e JOIN event_slots s ON s.event_id=e.id AND s.user_id=?
   WHERE e.cancelled=0 AND e.starts_at>? AND e.starts_at<=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=e.owner_id) OR (b.blocker_id=e.owner_id AND b.target_id=?))`,user.id,now(),user.id,now(),now()+1800000,user.id,user.id);
 const notificationAccess=`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=e.owner_id) OR (b.blocker_id=e.owner_id AND b.target_id=:viewer)) AND (n.kind!='reminder' OR (e.cancelled=0 AND e.starts_at>:now AND EXISTS(SELECT 1 FROM event_slots s WHERE s.event_id=e.id AND s.user_id=:viewer)))`;
 if(path==='/api/events/notifications/summary'&&method==='GET') {reminders();send(200,{viewerId:user.id,unread:get(`SELECT count(*) AS n FROM event_notifications n JOIN game_events e ON e.id=n.event_id WHERE n.user_id=:viewer AND n.seen=0 AND ${notificationAccess}`,{viewer:user.id,now:now()}).n});return true;}
 if(path==='/api/events/notifications'&&method==='GET') {reminders();const r=all(`SELECT n.id,n.event_id,n.kind,n.created_at,n.seen FROM event_notifications n JOIN game_events e ON e.id=n.event_id WHERE n.user_id=:viewer AND n.id<:before AND ${notificationAccess} ORDER BY n.id DESC LIMIT 51`,{viewer:user.id,now:now(),before:cursor()}),notifications=r.slice(0,50);send(200,{viewerId:user.id,notifications,next:r.length>50?notifications.at(-1).id:null});return true;}
 const read=path.match(/^\/api\/events\/notifications\/(\d+)\/read$/);
 if(read&&method==='POST'){if(!get('SELECT 1 FROM event_notifications WHERE id=? AND user_id=?',Number(read[1]),user.id))fail(404,'Уведомление недоступно.');run('UPDATE event_notifications SET seen=1 WHERE id=? AND user_id=?',Number(read[1]),user.id);send(200,{ok:true});return true;}
 if(path==='/api/events'&&method==='POST') {
  const input={title:text(body.title,'Название',3,80),description:text(body.description??'','Описание',0,1000),mode:text(body.mode,'Режим',1,24),region:text(body.region,'Регион',1,40),language:text(body.language,'Язык',1,40),timezone:text(body.timezone,'Часовой пояс',1,80),startsAt:body.startsAt,durationHours:body.durationHours,roles:body.roles,ownerRole:body.ownerRole};
  if(!['ranked','normal','aram','custom'].includes(input.mode)||!Array.isArray(input.roles)||input.roles.length<2||input.roles.length>5||new Set(input.roles).size!==input.roles.length||input.roles.some(r=>!ROLES.includes(r))||!input.roles.includes(input.ownerRole)||![1,2,3,4,6].includes(input.durationHours))fail(422,'Проверь режим, длительность и роли.');
  try{new Intl.DateTimeFormat('ru-RU',{timeZone:input.timezone});}catch{fail(422,'Неизвестный часовой пояс.');}
  input.roles=[...input.roles].sort();const clientId=key(),signature=JSON.stringify(input);
  const result=transaction(db,()=>{
   const old=get('SELECT id,signature FROM game_events WHERE owner_id=? AND client_id=?',user.id,clientId);if(old){if(old.signature!==signature)fail(409,'Идентификатор занят другим событием.');return {id:old.id,replayed:true};}
   if(!Number.isSafeInteger(input.startsAt)||input.startsAt<now()+300000||input.startsAt>now()+30*86400000)fail(422,'Начало: через 5 минут или позже, в ближайшие 30 дней.');
   if(get('SELECT count(*) AS n FROM game_events WHERE owner_id=? AND cancelled=0 AND ends_at>?',user.id,now()).n>=5)fail(409,'Можно организовать до пяти активных событий.');
   const id=Number(run('INSERT INTO game_events(owner_id,client_id,signature,title,description,mode,region,language,timezone,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',user.id,clientId,signature,input.title,input.description,input.mode,input.region,input.language,input.timezone,input.startsAt,input.startsAt+input.durationHours*3600000,now()).lastInsertRowid);
   for(const role of input.roles)run('INSERT INTO event_slots VALUES(?,?,?)',id,role,role===input.ownerRole?user.id:null);return {id,replayed:false};
  });send(result.replayed?200:201,result);return true;
 }
 if(path==='/api/events'&&method==='GET') {
  const mine=url.searchParams.get('mine')==='1',role=url.searchParams.get('role');if(role&&!ROLES.includes(role))fail(422,'Неизвестная роль.');
  const params={viewer:user.id,before:cursor(),now:now()};let filter=mine?'EXISTS(SELECT 1 FROM event_slots s WHERE s.event_id=e.id AND s.user_id=:viewer)':'e.cancelled=0 AND e.starts_at>:now';
  if(mine)delete params.now;
  if(role){filter+=' AND EXISTS(SELECT 1 FROM event_slots s WHERE s.event_id=e.id AND s.role=:role AND s.user_id IS NULL)';params.role=role;}
  const r=all(`SELECT e.*,u.name AS owner_name FROM game_events e JOIN users u ON u.id=e.owner_id WHERE e.id<:before AND ${filter} AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=e.owner_id) OR (b.blocker_id=e.owner_id AND b.target_id=:viewer)) ORDER BY e.id DESC LIMIT 21`,params),events=r.slice(0,20).map(card);send(200,{viewerId:user.id,events,next:r.length>20?events.at(-1).id:null});return true;
 }
 const m=path.match(/^\/api\/events\/(\d+)(?:\/(join|leave|remove|cancel|messages))?$/);if(!m)fail(404,'Маршрут не найден.');
 const id=Number(m[1]);if(!Number.isSafeInteger(id))fail(404,'Событие недоступно.');const action=m[2],e=event(id);
 if(!action&&method==='GET') {const members=slot(id)?all('SELECT s.role,u.id,u.name,u.handle FROM event_slots s JOIN users u ON u.id=s.user_id WHERE s.event_id=? ORDER BY s.role',id):[];send(200,{viewerId:user.id,event:card(e),members});return true;}
 if(action==='join'&&method==='POST') {
  if(!ROLES.includes(body.role))fail(422,'Выбери игровую роль.');
  transaction(db,()=>{current(e);if(get('SELECT 1 FROM event_exclusions WHERE event_id=? AND user_id=?',id,user.id))fail(403,'Организатор исключил тебя из события.');const old=slot(id);if(old===body.role)return;if(old)fail(409,'Сначала освободи прежнее место.');const r=run('UPDATE event_slots SET user_id=? WHERE event_id=? AND role=? AND user_id IS NULL',user.id,id,body.role);if(!r.changes)fail(409,'Место уже занято или роль не предусмотрена.');notify(e.owner_id,id,'joined');});send(200,{ok:true});return true;
 }
 if(action==='leave'&&method==='POST') {if(e.owner_id===user.id)fail(409,'Организатор может отменить событие.');transaction(db,()=>{if(run('UPDATE event_slots SET user_id=NULL WHERE event_id=? AND user_id=?',id,user.id).changes)notify(e.owner_id,id,'left');});send(200,{ok:true});return true;}
 if(action==='remove'&&method==='POST') {owner(e);const target=text(body.userId,'Участник',1,80);if(target===user.id)fail(409,'Организатор не может исключить себя.');transaction(db,()=>{if(run('UPDATE event_slots SET user_id=NULL WHERE event_id=? AND user_id=?',id,target).changes){run('INSERT OR IGNORE INTO event_exclusions VALUES(?,?)',id,target);notify(target,id,'removed');}else if(!get('SELECT 1 FROM event_exclusions WHERE event_id=? AND user_id=?',id,target))fail(409,'Игрок не в составе.');});send(200,{ok:true});return true;}
 if(action==='cancel'&&method==='POST') {owner(e);transaction(db,()=>{if(run('UPDATE game_events SET cancelled=1 WHERE id=? AND cancelled=0',id).changes)for(const s of all('SELECT user_id FROM event_slots WHERE event_id=? AND user_id IS NOT NULL AND user_id<>?',id,user.id))notify(s.user_id,id,'cancelled');});send(200,{ok:true});return true;}
 if(action==='messages') {
  member(e);const canSend=!e.cancelled&&e.ends_at>now();
  if(method==='GET') {const before=url.searchParams.get('before'),after=url.searchParams.get('after'),raw=before??after;if((before!==null&&after!==null)||(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))))fail(422,'Некорректный курсор.');const newer=after!==null,r=all(`SELECT m.*,u.name AS sender_name FROM event_messages m JOIN users u ON u.id=m.sender_id WHERE m.event_id=? AND m.id${newer?'>':'<'}? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=m.sender_id) OR (b.blocker_id=m.sender_id AND b.target_id=?)) ORDER BY m.id ${newer?'ASC':'DESC'} LIMIT 51`,id,Number(raw??Number.MAX_SAFE_INTEGER),user.id,user.id);const messages=r.slice(0,50),hasMore=r.length>50;if(!newer)messages.reverse();send(200,{viewerId:user.id,canSend,blockVersion:get('SELECT block_version FROM users WHERE id=?',user.id).block_version,messages,hasMore,next:hasMore?(newer?messages.at(-1).id:messages[0].id):null});return true;}
  if(method==='POST') {if(!canSend)fail(409,'Событие завершено или отменено.');const clientId=key(),content=text(body.body,'Сообщение',1,2000);const result=transaction(db,()=>{const old=get('SELECT id,body FROM event_messages WHERE event_id=? AND sender_id=? AND client_id=?',id,user.id,clientId);if(old){if(old.body!==content)fail(409,'Идентификатор занят другим текстом.');return {id:old.id,replayed:true};}return {id:Number(run('INSERT INTO event_messages(event_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)',id,user.id,clientId,content,now()).lastInsertRowid),replayed:false};});send(result.replayed?200:201,{message:get('SELECT m.*,u.name AS sender_name FROM event_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?',result.id),replayed:result.replayed});return true;}
 }
 fail(405,'Метод не поддерживается.');
}
