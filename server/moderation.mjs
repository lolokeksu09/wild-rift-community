import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
import {imageAttached} from './media.mjs';
import {sanctionFor} from './sanctions.mjs';
export function moderationRoutes({db,user,path,method,body,url,send,now,moderatorIds,postFor}){
 if(!path.startsWith('/api/reports')&&!path.startsWith('/api/moderation'))return false;
 if(!user)fail(401,'Войди в аккаунт.');
 const get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 const profileSnapshot=p=>{
  const {riotId,riotVisible,demoBot,...game}=JSON.parse(p.game_profile||'{}');
  return JSON.stringify({name:p.name,handle:p.handle,bio:p.bio,gameProfile:{...game,...(riotVisible?{riotId}: {})}});
 };
 if(path==='/api/reports'&&method==='POST'){
  const kind=body.kind,id=body.targetId??body.messageId,reason=text(body.reason,'Причина',3,1000);
  if(!['direct','club','post','comment','profile'].includes(kind)||(kind==='profile'?typeof id!=='string'||!id||id.length>80:!Number.isSafeInteger(id)||id<1))fail(422,'Некорректный объект жалобы.');
  let message;
  if(kind==='direct')message=get(`SELECT m.* FROM direct_messages m JOIN direct_conversations c ON c.id=m.conversation_id WHERE m.id=? AND (c.user_low=? OR c.user_high=?)`,id,user.id,user.id);
  else if(kind==='club')message=get(`SELECT m.* FROM messages m JOIN memberships s ON s.club_id=m.club_id WHERE m.id=? AND s.user_id=? AND s.status='member'`,id,user.id);
  else if(kind==='post'){
   const p=postFor(id,user,false,true);message={sender_id:p.author_id,body:p.title+'\n'+p.body};
  }else if(kind==='comment'){
   const c=get('SELECT * FROM comments WHERE id=?',id);if(c){postFor(c.post_id,user,false,true);message={sender_id:c.author_id,body:c.body};}
  }else{
   const p=get('SELECT * FROM users WHERE id=? AND profile_visible=1',id);
   if(p)message={sender_id:p.id,body:profileSnapshot(p)};
  }
  // Blocking either way must not prevent reporting content the reporter could access.
  if(!message||message.sender_id===user.id)fail(404,'Объект недоступен для жалобы.');
  const result=transaction(db,()=>{
   const old=get('SELECT id FROM reports WHERE reporter_id=? AND kind=? AND target_id=?',user.id,kind,String(id));
   if(old)return {id:old.id,replayed:true};
   const r=run(`INSERT INTO reports(reporter_id,kind,message_id,target_id,sender_id,snapshot,reason,created_at) VALUES(?,?,?,?,?,?,?,?)`,user.id,kind,kind==='profile'?null:id,String(id),message.sender_id,message.body,reason,now());return {id:Number(r.lastInsertRowid),replayed:false};
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
  const rows=all('SELECT r.id,r.kind,r.message_id,r.target_id,r.reason,r.status,r.decision_note,r.decision_seen,r.created_at,a.reason AS appeal_reason,a.status AS appeal_status,a.note AS appeal_note,a.decision_seen AS appeal_seen,x.action AS applied_action,x.note AS action_note FROM reports r LEFT JOIN report_appeals a ON a.report_id=r.id LEFT JOIN moderation_actions x ON x.report_id=r.id WHERE r.reporter_id=? AND r.id<? ORDER BY r.id DESC LIMIT 101',user.id,Number(raw??Number.MAX_SAFE_INTEGER));const reports=rows.slice(0,100);
  send(200,{viewerId:user.id,reports,next:rows.length>100?reports.at(-1).id:null});return true;
 }
 if(!moderatorIds.includes(user.id))fail(403,'Доступ только модератору сервиса.');
 const actionRoute=path.match(/^\/api\/moderation\/reports\/(\d+)\/action$/);
 if(actionRoute&&method==='POST'){
  const id=Number(actionRoute[1]),note=text(body.note,'Объяснение действия',3,1000);
  transaction(db,()=>{
   const r=get('SELECT * FROM reports WHERE id=?',id),a=get('SELECT * FROM report_appeals WHERE report_id=?',id);
   if(!r)fail(404,'Жалоба не найдена.');
   if([r.reporter_id,r.sender_id].includes(user.id))fail(403,'Нужно независимое рассмотрение.');
   if((a?.status||r.status)!=='upheld')fail(409,'Нужно окончательное решение о подтверждённом нарушении.');
   const action={post:'remove-post',comment:'remove-comment',profile:'hide-profile'}[r.kind];
   if(!action||body.action!==action)fail(422,'Действие недоступно для этой жалобы.');
   const old=get('SELECT * FROM moderation_actions WHERE report_id=?',id);
   if(old){if(old.actor_id===user.id&&old.action===action&&old.note===note)return;fail(409,'Действие уже выполнено.');}
   if(r.kind==='post'){
    const p=get('SELECT * FROM posts WHERE id=?',Number(r.target_id));
    if(p&&p.title+'\n'+p.body!==r.snapshot)fail(409,'Публикация изменилась после жалобы. Проверь актуальный материал через управление клубом.');
    run('DELETE FROM posts WHERE id=?',Number(r.target_id));
    if(p?.image_id&&!imageAttached(db,p.image_id))run('DELETE FROM media WHERE id=?',p.image_id);
   }else if(r.kind==='comment'){
    const c=get('SELECT body FROM comments WHERE id=?',Number(r.target_id));
    if(c&&c.body!==r.snapshot)fail(409,'Комментарий изменился после жалобы.');
    // Keep replies, but remove references to the deleted parent and its context.
    run('UPDATE comments SET parent_id=NULL WHERE parent_id=?',Number(r.target_id));
    run('DELETE FROM comments WHERE id=?',Number(r.target_id));
   }else{
    const p=get('SELECT * FROM users WHERE id=?',r.target_id);
    if(p?.profile_visible&&profileSnapshot(p)!==r.snapshot)fail(409,'Профиль изменился после жалобы. Проверь актуальное описание.');
    run('UPDATE users SET profile_visible=0 WHERE id=?',r.target_id);
   }
   run('INSERT INTO moderation_actions VALUES(?,?,?,?,?)',id,user.id,action,note,now());
  });send(200,{ok:true});return true;
 }
 if(path==='/api/moderation/reports'&&method==='GET'){
  const raw=url.searchParams.get('before');if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');
  const reports=all('SELECT r.*,a.reason AS appeal_reason,a.status AS appeal_status,a.note AS appeal_note,x.action AS applied_action,x.note AS action_note FROM reports r LEFT JOIN report_appeals a ON a.report_id=r.id LEFT JOIN moderation_actions x ON x.report_id=r.id WHERE r.id<? ORDER BY r.id DESC LIMIT 51',Number(raw??Number.MAX_SAFE_INTEGER));
  // Moderators see the author's current escalation before upholding another violation.
  const page=reports.slice(0,50).map(r=>({...r,senderSanction:sanctionFor(db,r.sender_id,now())}));send(200,{reports:page,next:reports.length>50?page.at(-1).id:null});return true;
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
