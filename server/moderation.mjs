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
 const appealRoute=path.match(/^\/api\/reports\/(\d+)\/appeal(\/read)?$/);
 if(appealRoute&&method==='POST'){
  const id=Number(appealRoute[1]);
  const report=get('SELECT * FROM reports WHERE id=? AND reporter_id=?',id,user.id);
  if(!report)fail(404,'Жалоба недоступна.');
  if(report.status==='pending')fail(409,'Сначала дождись первого решения.');
  if(appealRoute[2]){
   const appeal=get('SELECT status FROM report_appeals WHERE report_id=?',id);
   if(!appeal||appeal.status==='pending')fail(409,'Результат пересмотра ещё не готов.');
   run('UPDATE report_appeals SET decision_seen=1 WHERE report_id=?',id);send(200,{ok:true});return true;
  }
  const reason=text(body.reason,'Обоснование апелляции',3,1000);
  const result=transaction(db,()=>{
   const old=get('SELECT reason FROM report_appeals WHERE report_id=?',id);
   if(old){if(old.reason!==reason)fail(409,'Апелляция уже подана. Изменить её нельзя.');return {replayed:true};}
   run('INSERT INTO report_appeals(report_id,reason,created_at) VALUES(?,?,?)',id,reason,now());return {replayed:false};
  });send(result.replayed?200:201,result);return true;
 }
 if(path==='/api/reports/summary' &&method==='GET'){
  send(200,{viewerId:user.id,unread:get("SELECT count(*) AS n FROM reports WHERE reporter_id=? AND status!='pending' AND decision_seen=0",user.id).n + get("SELECT count(*) AS n FROM report_appeals a JOIN reports r ON r.id=a.report_id WHERE r.reporter_id=? AND a.status!='pending' AND a.decision_seen=0",user.id).n});return true;
 }
 const seen=path.match(/^\/api\/reports\/(\d+)\/read$/);
 if(seen&&method==='POST'){
  const report=get('SELECT id,status FROM reports WHERE id=? AND reporter_id=?',Number(seen[1]),user.id);
  if(!report)fail(404,'Жалоба недоступна.');
  if(report.status==='pending')fail(409,'Решение ещё не принято.');
  run('UPDATE reports SET decision_seen=1 WHERE id=?',report.id);send(200,{ok:true});return true;
 }
 if(path==='/api/reports'&&method==='GET'){
  const raw=url.searchParams.get('before');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');
  const rows=all('SELECT r.id,r.kind,r.message_id,r.reason,r.status,r.decision_note,r.decision_seen,r.created_at,a.reason AS appeal_reason,a.status AS appeal_status,a.note AS appeal_note,a.decision_seen AS appeal_seen FROM reports r LEFT JOIN report_appeals a ON a.report_id=r.id WHERE r.reporter_id=? AND r.id<? ORDER BY r.id DESC LIMIT 101',user.id,Number(raw??Number.MAX_SAFE_INTEGER));const reports=rows.slice(0,100);
  send(200,{viewerId:user.id,reports,next:rows.length>100?reports.at(-1).id:null});return true;
 }
 if(!moderatorIds.includes(user.id))fail(403,'Доступ только модератору сервиса.');
 if(path==='/api/moderation/reports'&&method==='GET'){
  const raw=url.searchParams.get('before');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');
  const reports=all('SELECT r.*,a.reason AS appeal_reason,a.status AS appeal_status,a.note AS appeal_note FROM reports r LEFT JOIN report_appeals a ON a.report_id=r.id WHERE r.id<? ORDER BY r.id DESC LIMIT 51',Number(raw??Number.MAX_SAFE_INTEGER));
  const page=reports.slice(0,50);send(200,{reports:page,next:reports.length>50?page.at(-1).id:null});return true;
 }
 const appealDecision=path.match(/^\/api\/moderation\/reports\/(\d+)\/appeal-decision$/);
 if(appealDecision&&method==='POST'){
  const id=Number(appealDecision[1]),note=text(body.note,'Объяснение пересмотра',3,1000);
  if(!['upheld','dismissed'].includes(body.decision))fail(422,'Выбери итог по жалобе.');
  transaction(db,()=>{
   const r=get('SELECT * FROM reports WHERE id=?',id),a=get('SELECT * FROM report_appeals WHERE report_id=?',id);
   if(!r||!a)fail(404,'Апелляция не найдена.');
   if([r.reporter_id,r.sender_id,r.moderator_id].includes(user.id))fail(403,'Пересмотр проводит другой независимый модератор.');
   if(a.status!=='pending'){if(a.status===body.decision&&a.note===note&&a.moderator_id===user.id)return;fail(409,'Пересмотр уже завершён.');}
   run('UPDATE report_appeals SET status=?,note=?,moderator_id=? WHERE report_id=?',body.decision,note,user.id,id);
   run("INSERT INTO moderation_audit(report_id,actor_id,decision,note,created_at,stage) VALUES(?,?,?,?,?,'appeal')",id,user.id,body.decision,note,now());
  });send(200,{ok:true});return true;
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
