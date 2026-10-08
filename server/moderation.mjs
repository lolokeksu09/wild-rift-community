import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
export function moderationRoutes({db,user,path,method,body,url,send,now,moderatorIds}){
 if(!path.startsWith('/api/reports')&&!path.startsWith('/api/moderation'))return false;
 if(!user)fail(401,'Войди в аккаунт.');
 const get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 if(path==='/api/reports'&&method==='POST'){
  const kind=body.kind,id=body.messageId,reason=text(body.reason,'Причина',3,1000);
  if(!['direct','club'].includes(kind)||!Number.isSafeInteger(id)||id<1)fail(422,'Некорректное сообщение.');
  let message;
  if(kind==='direct')message=get(`SELECT m.* FROM direct_messages m JOIN direct_conversations c ON c.id=m.conversation_id WHERE m.id=? AND (c.user_low=? OR c.user_high=?)`,id,user.id,user.id);
  else message=get(`SELECT m.* FROM messages m JOIN memberships s ON s.club_id=m.club_id WHERE m.id=? AND s.user_id=? AND s.status='member'`,id,user.id);
  if(!message||message.sender_id===user.id)fail(404,'Сообщение недоступно для жалобы.');
  const result=transaction(db,()=>{
   const old=get('SELECT id FROM reports WHERE reporter_id=? AND kind=? AND message_id=?',user.id,kind,id);
   if(old)return {id:old.id,replayed:true};
   const r=run(`INSERT INTO reports(reporter_id,kind,message_id,sender_id,snapshot,reason,created_at) VALUES(?,?,?,?,?,?,?)`,user.id,kind,id,message.sender_id,message.body,reason,now());return {id:Number(r.lastInsertRowid),replayed:false};
  });send(result.replayed?200:201,result);return true;
 }
 if(path==='/api/reports'&&method==='GET'){
  send(200,{reports:all('SELECT id,kind,message_id,reason,status,decision_note,created_at FROM reports WHERE reporter_id=? ORDER BY id DESC LIMIT 100',user.id)});return true;
 }
 if(!moderatorIds.includes(user.id))fail(403,'Доступ только модератору сервиса.');
 if(path==='/api/moderation/reports'&&method==='GET'){
  const raw=url.searchParams.get('before');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');
  const reports=all('SELECT * FROM reports WHERE id<? ORDER BY id DESC LIMIT 51',Number(raw??Number.MAX_SAFE_INTEGER));
  const page=reports.slice(0,50);send(200,{reports:page,next:reports.length>50?page.at(-1).id:null});return true;
 }
 const match=path.match(/^\/api\/moderation\/reports\/(\d+)\/decision$/);
 if(match&&method==='POST'){
  if(!['upheld','dismissed'].includes(body.decision))fail(422,'Выбери решение.');
  const note=text(body.note,'Объяснение решения',3,1000),id=Number(match[1]);
  transaction(db,()=>{
   const report=get('SELECT * FROM reports WHERE id=?',id);if(!report)fail(404,'Жалоба не найдена.');
   if(report.reporter_id===user.id||report.sender_id===user.id)fail(403,'Свою жалобу или жалобу на себя рассматривает другой модератор.');
   if(report.status!=='pending'){if(report.status===body.decision&&report.decision_note===note&&report.moderator_id===user.id)return;fail(409,'Решение уже принято.');}
   run('UPDATE reports SET status=?,decision_note=?,moderator_id=? WHERE id=?',body.decision,note,user.id,id);
   run('INSERT INTO moderation_audit(report_id,actor_id,decision,note,created_at) VALUES(?,?,?,?,?)',id,user.id,body.decision,note,now());
  });send(200,{ok:true});return true;
 }
 fail(404,'Маршрут не найден.');
}
