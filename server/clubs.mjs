import {imageAttached} from './media.mjs';
import {randomUUID,createHmac} from 'node:crypto';
import {fail,text,digest} from './security.mjs';
import {transaction} from './database.mjs';
import {clubSummary} from './club-summary.mjs';
import {unblocked,postExtras,attemptId} from './discussions.mjs';

export function clubRole(db,club,user){
 if(!user||db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(club.id,user.id)?.status!=='member')return null;
 if(club.owner_id===user.id)return 'owner';
 return db.prepare('SELECT 1 FROM club_moderators WHERE club_id=? AND user_id=?').get(club.id,user.id)?'moderator':'member';
}
export function clubStaff(db,id,user,ownerOnly=false){
 if(!user)fail(401,'Сначала войди в аккаунт.');
 const club=db.prepare('SELECT * FROM clubs WHERE id=?').get(id),role=club&&clubRole(db,club,user);
 if(!club||!(ownerOnly?role==='owner':['owner','moderator'].includes(role)))fail(403,ownerOnly?'Действие доступно владельцу клуба.':'Нет полномочий управления этим клубом.');
 return club;
}
export function audit(db,user,club,target,action,now){db.prepare('INSERT INTO audit(actor_id,club_id,target_id,action,created_at) VALUES(?,?,?,?,?)').run(user.id,club,target,action,now());}
function number(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)fail(422,'Проверь '+label+'.');return value;}
function before(url){const v=url.searchParams.get('before');if(v!==null&&(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))))fail(422,'Некорректный курсор.');return v===null?Number.MAX_SAFE_INTEGER:Number(v);}
function inviteToken(user,id,clientId){return createHmac('sha256',user.csrf).update('club-invite\0'+id+'\0'+clientId).digest('hex');}
function publicClub(db,club,user){
 return {...club,...clubSummary(db,{...club,membership:user?db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(club.id,user.id)?.status:null},user),tags:JSON.parse(club.tags),membership:user?db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(club.id,user.id)?.status||null:null,myRole:clubRole(db,club,user),members:db.prepare("SELECT count(*) n FROM memberships WHERE club_id=? AND status='member'").get(club.id).n};
}
export function clubRoutes({db,user,path,method,body,url,send,now,clubFor,postFor}){
 const removePost=path.match(/^\/api\/clubs\/([\w-]+)\/posts\/(\d+)$/);
 if(removePost){
  if(method!=='DELETE')fail(405,'Метод не поддерживается.');const club=clubStaff(db,removePost[1],user),postId=number(Number(removePost[2]),1,Number.MAX_SAFE_INTEGER,'публикацию');if(db.prepare('SELECT club_id FROM posts WHERE id=?').get(postId)?.club_id!==club.id)fail(404,'Публикация не из этого клуба.');const post=postFor(postId,user,true);
  transaction(db,()=>{db.prepare('DELETE FROM posts WHERE id=?').run(post.id);if(post.image_id&&!imageAttached(db,post.image_id))db.prepare('DELETE FROM media WHERE id=?').run(post.image_id);audit(db,user,club.id,String(post.id),'post-remove',now);});send(200,{ok:true});return true;
 }
 const inviteAction=path.match(/^\/api\/club-invites\/(preview|accept)$/);
 const match=path.match(/^\/api\/clubs\/([\w-]+)\/(detail|settings|members|join|leave|decision|ban|kick|unban|moderators|pins|audit|invites|transfer)(?:\/([\w-]+))?$/);
 if(!inviteAction&&!match)return false;
 const get=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 if(inviteAction){
  if(!user)fail(401,'Для приглашения войди в аккаунт.');if(method!=='POST')fail(405,'Метод не поддерживается.');
  if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))fail(404,'Приглашение недоступно.');
  const invite=get('SELECT * FROM club_invites WHERE token_hash=?',digest(body.token)),club=invite&&get('SELECT * FROM clubs WHERE id=?',invite.club_id);
  if(!invite||!club||invite.revoked||invite.expires_at<=now())fail(404,'Приглашение истекло или отозвано.');
  const old=get('SELECT status FROM memberships WHERE club_id=? AND user_id=?',club.id,user.id),receipt=get('SELECT 1 FROM club_invite_uses WHERE invite_id=? AND user_id=?',invite.id,user.id);
  if(old?.status==='banned')fail(403,'Вступление в клуб ограничено.');
  if(get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id IN (?,?)) OR (target_id=? AND blocker_id IN (?,?))',user.id,invite.creator_id,club.owner_id,user.id,invite.creator_id,club.owner_id))fail(404,'Приглашение недоступно.');
  if(invite.uses>=invite.max_uses&&!receipt&&!old)fail(409,'Все места по приглашению уже использованы.');
  if(inviteAction[1]==='preview'){send(200,{club:publicClub(db,club,user),expiresAt:invite.expires_at});return true;}
  const status=transaction(db,()=>{
   if(old)return old.status;
   if(receipt)fail(409,'Приглашение уже использовано этим аккаунтом. Вступи через карточку клуба.');
   if(invite.uses>=invite.max_uses)fail(409,'Все места по приглашению уже использованы.');
   const status=club.access==='open'?'member':'pending';run('INSERT INTO memberships(club_id,user_id,status) VALUES(?,?,?)',club.id,user.id,status);
   run('INSERT INTO club_invite_uses VALUES(?,?,?)',invite.id,user.id,now());run('UPDATE club_invites SET uses=uses+1 WHERE id=?',invite.id);audit(db,user,club.id,user.id,'invite-'+status,now);return status;
  });send(200,{clubId:club.id,status});return true;
 }
 const [,id,action,extra]=match;
 const club=get('SELECT * FROM clubs WHERE id=?',id);if(!club)fail(404,'Клуб не найден.');
 if(action==='detail'&&!extra){
  if(method!=='GET')fail(405,'Метод не поддерживается.');
  const transfer=user?get("SELECT id,owner_id,target_id,expires_at FROM club_transfers WHERE club_id=? AND status='pending' AND expires_at>? AND (owner_id=? OR target_id=?)",id,now(),user.id,user.id):null;
  send(200,{club:publicClub(db,club,user),transfer:transfer||null});return true;
 }
 if(action==='pins'&&!extra&&method==='GET'){
  clubFor(id,user,false);const posts=db.prepare(`SELECT p.*,u.name AS author_name,CASE WHEN u.profile_visible=1 THEN u.avatar_id ELSE NULL END AS author_avatar_id FROM club_pins cp JOIN posts p ON p.id=cp.post_id JOIN users u ON u.id=p.author_id WHERE cp.club_id=:club AND ${unblocked()} ORDER BY cp.created_at DESC,p.id DESC LIMIT 3`).all({club:id,viewer:user?.id||''});send(200,{posts:postExtras(db,posts,user,now)});return true;
 }
 if(!user)fail(401,'Сначала войди в аккаунт.');
 if(action==='join'||action==='leave'){
  if(method!=='POST'||extra)fail(405,'Метод не поддерживается.');
  if(action==='join'){
   const old=get('SELECT status FROM memberships WHERE club_id=? AND user_id=?',id,user.id);if(old?.status==='banned')fail(403,'Вступление в клуб ограничено.');
   const status=old?.status||(club.access==='open'?'member':'pending');run('INSERT OR IGNORE INTO memberships(club_id,user_id,status) VALUES(?,?,?)',id,user.id,status);send(200,{status});return true;
  }
  if(club.owner_id===user.id)fail(409,'Сначала передай владение принятому участнику.');
  transaction(db,()=>{const removed=run("DELETE FROM memberships WHERE club_id=? AND user_id=? AND status!='banned'",id,user.id);if(removed.changes)audit(db,user,id,user.id,'leave',now);});send(200,{ok:true});return true;
 }
 if(action==='members'&&!extra){
  if(method!=='GET')fail(405,'Метод не поддерживается.');clubFor(id,user,true);
  const staff=['owner','moderator'].includes(clubRole(db,club,user)),after=url.searchParams.get('after')||'';
  if(after&&!/^[a-z0-9_]{3,24}$/.test(after))fail(422,'Некорректный курсор.');
  const records=db.prepare(`SELECT u.id,u.handle,u.name,json_extract(u.game_profile,'$.demoBot')='community-v1' AS isBot,m.status,CASE WHEN u.id=:owner THEN 'owner' WHEN cm.user_id IS NOT NULL AND m.status='member' THEN 'moderator' ELSE 'member' END AS role FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN club_moderators cm ON cm.club_id=m.club_id AND cm.user_id=m.user_id WHERE m.club_id=:club AND u.handle>:after ${staff?'':"AND m.status='member'"} ORDER BY u.handle LIMIT 101`).all({owner:club.owner_id,club:id,after});
  send(200,{members:records.slice(0,100),next:records.length>100?records[99].handle:null});return true;
 }
 if(action==='transfer'&&['accept','cancel'].includes(extra))return transferRoute({db,user,club,extra,method,body,send,now});
 // All remaining operations need live scoped powers, including GET of admin data.
 clubStaff(db,id,user,['settings','moderators','invites'].includes(action)||(action==='transfer'&&extra!=='accept'&&extra!=='cancel'));
 if(action==='settings'&&!extra){
  if(method!=='PATCH')fail(405,'Метод не поддерживается.');
  const version=number(body.version,0,Number.MAX_SAFE_INTEGER,'версию настроек');
  const name=text(body.name??club.name,'Название',2,80),description=text(body.description??club.description,'Описание',0,1000),rules=text(body.rules??club.rules,'Правила',0,2000),accent=body.accent??club.accent;
  if(!['azure','emerald','violet','coral'].includes(accent))fail(422,'Выбери акцент клуба.');
  const tags=body.tags??JSON.parse(club.tags);if(!Array.isArray(tags)||tags.length>5)fail(422,'Можно указать до 5 меток.');
  const normalized=[...new Set(tags.map(v=>text(text(v,'Метка',1,24).normalize('NFKC').toLowerCase(),'Метка',1,24)))];if(normalized.some(v=>!/^[-\p{L}\p{N} ]+$/u.test(v)))fail(422,'Метки: буквы, цифры, пробел и дефис.');
  transaction(db,()=>{if(version!==club.settings_version)fail(409,'Настройки изменились. Обнови страницу перед сохранением.');if(name===club.name&&description===club.description&&rules===club.rules&&accent===club.accent&&JSON.stringify(normalized)===club.tags)return;run('UPDATE clubs SET name=?,description=?,rules=?,tags=?,accent=?,settings_version=settings_version+1 WHERE id=?',name,description,rules,JSON.stringify(normalized),accent,id);audit(db,user,id,id,'settings',now);});send(200,{ok:true});return true;
 }
 if(['decision','ban','kick','unban','moderators'].includes(action)&&!extra){
  if(!['POST','PUT','DELETE'].includes(method)||((action!=='moderators')&&method!=='POST'))fail(405,'Метод не поддерживается.');
  const target=text(body.userId,'Участник',1,80),membership=get('SELECT status FROM memberships WHERE club_id=? AND user_id=?',id,target);
  if(!membership)fail(404,'Участник не найден.');if(target===club.owner_id)fail(409,'Нельзя изменить членство владельца.');
  const role=clubRole(db,club,user),targetMod=get('SELECT 1 FROM club_moderators WHERE club_id=? AND user_id=?',id,target);
  if(action==='moderators'){
   if(!['PUT','DELETE'].includes(method))fail(405,'Метод не поддерживается.');if(membership.status!=='member')fail(409,'Модератором может быть принятый участник.');
   transaction(db,()=>{const result=method==='PUT'?run('INSERT OR IGNORE INTO club_moderators VALUES(?,?)',id,target):run('DELETE FROM club_moderators WHERE club_id=? AND user_id=?',id,target);if(result.changes)audit(db,user,id,target,method==='PUT'?'moderator-grant':'moderator-revoke',now);});
  }else{
   if(targetMod)fail(409,'Сначала владелец должен снять полномочия модератора.');
   if(action==='unban'&&role!=='owner')fail(403,'Снять бан может владелец.');
   transaction(db,()=>{
    if(action==='decision'){
     if(!['approve','reject'].includes(body.decision))fail(422,'Выбери решение.');
     if(membership.status==='member'&&body.decision==='approve')return;
     if(membership.status!=='pending')fail(409,'Нет подходящей заявки.');
     if(body.decision==='approve')run("UPDATE memberships SET status='member' WHERE club_id=? AND user_id=?",id,target);else run('DELETE FROM memberships WHERE club_id=? AND user_id=?',id,target);audit(db,user,id,target,body.decision,now);
    }else if(action==='ban'){
     if(membership.status==='banned')return;run("UPDATE memberships SET status='banned' WHERE club_id=? AND user_id=?",id,target);audit(db,user,id,target,'ban',now);
    }else if(action==='kick'){
     if(membership.status!=='member')fail(409,'Участник уже вышел или доступ ограничен.');run('DELETE FROM memberships WHERE club_id=? AND user_id=?',id,target);audit(db,user,id,target,'kick',now);
    }else{if(membership.status!=='banned')fail(409,'Бан уже снят.');run('DELETE FROM memberships WHERE club_id=? AND user_id=?',id,target);audit(db,user,id,target,'unban',now);}
   });
  }send(200,{ok:true});return true;
 }
 if(action==='pins'&&extra){
  const postId=number(Number(extra),1,Number.MAX_SAFE_INTEGER,'публикацию');if(get('SELECT club_id FROM posts WHERE id=?',postId)?.club_id!==id)fail(404,'Публикация не из этого клуба.');postFor(postId,user,true);
  if(!['PUT','DELETE'].includes(method))fail(405,'Метод не поддерживается.');
  transaction(db,()=>{if(method==='PUT'){if(get('SELECT 1 FROM club_pins WHERE post_id=?',postId))return;if(get('SELECT count(*) n FROM club_pins WHERE club_id=?',id).n>=3)fail(409,'Можно закрепить до 3 публикаций.');run('INSERT INTO club_pins VALUES(?,?,?,?)',postId,id,user.id,now());audit(db,user,id,String(postId),'pin',now);}else{if(run('DELETE FROM club_pins WHERE post_id=? AND club_id=?',postId,id).changes)audit(db,user,id,String(postId),'unpin',now);}});send(200,{ok:true});return true;
 }
 if(action==='audit'&&!extra){
  if(method!=='GET')fail(405,'Метод не поддерживается.');const records=db.prepare('SELECT a.id,a.target_id,a.action,a.created_at,u.name AS actor_name,t.name AS target_name FROM audit a JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_id WHERE a.club_id=? AND a.id<? ORDER BY a.id DESC LIMIT 51').all(id,before(url));send(200,{entries:records.slice(0,50),next:records.length>50?records[49].id:null});return true;
 }
 if(action==='invites'){
  if(!extra&&method==='GET'){send(200,{invites:db.prepare('SELECT id,max_uses,uses,expires_at,created_at,revoked FROM club_invites WHERE club_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(id)});return true;}
  if(extra&&method==='DELETE'){transaction(db,()=>{const found=get('SELECT id,revoked FROM club_invites WHERE id=? AND club_id=?',extra,id);if(!found)fail(404,'Приглашение недоступно.');if(!found.revoked){run('UPDATE club_invites SET revoked=1 WHERE id=?',extra);audit(db,user,id,extra,'invite-revoke',now);}});send(200,{ok:true});return true;}
  if(extra||method!=='POST')fail(405,'Метод не поддерживается.');
  const clientId=attemptId(body);if(!clientId)fail(422,'Нужен идентификатор отправки.');const maxUses=number(body.maxUses??10,1,50,'число использований'),hours=number(body.durationHours??24,1,168,'срок приглашения');
  const token=inviteToken(user,id,clientId),hash=digest(token);
  const result=transaction(db,()=>{
   const old=get('SELECT * FROM club_invites WHERE club_id=? AND creator_id=? AND client_id=?',id,user.id,clientId);
   if(old){if(old.token_hash!==hash||old.max_uses!==maxUses||old.expires_at-old.created_at!==hours*3600000)fail(409,'Отправка уже использована. Обнови форму приглашения.');if(old.revoked||old.expires_at<=now())fail(409,'Приглашение уже отозвано или истекло. Создай новое.');return {id:old.id,expiresAt:old.expires_at,replayed:true};}
   if(get('SELECT count(*) n FROM club_invites WHERE club_id=? AND revoked=0 AND expires_at>?',id,now()).n>=10)fail(409,'Отзови старое приглашение перед созданием нового.');
   const inviteId=randomUUID(),created=now(),expires=created+hours*3600000;run('INSERT INTO club_invites(id,club_id,creator_id,client_id,token_hash,max_uses,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)',inviteId,id,user.id,clientId,hash,maxUses,expires,created);audit(db,user,id,inviteId,'invite-create',now);return {id:inviteId,expiresAt:expires,replayed:false};
  });send(result.replayed?200:201,{...result,token});return true;
 }
 if(action==='transfer')return transferRoute({db,user,club,extra,method,body,send,now});
 fail(405,'Метод не поддерживается.');
}
function transferRoute({db,user,club,extra,method,body,send,now}){
 const get=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 if(method!=='POST')fail(405,'Метод не поддерживается.');
 if(!extra){
  const target=text(body.userId,'Получатель',1,80),clientId=attemptId(body);if(!clientId)fail(422,'Нужен идентификатор отправки.');
  if(target===user.id||get('SELECT status FROM memberships WHERE club_id=? AND user_id=?',club.id,target)?.status!=='member')fail(409,'Выбери другого принятого участника.');
  const result=transaction(db,()=>{
   const old=get('SELECT * FROM club_transfers WHERE club_id=? AND owner_id=? AND client_id=?',club.id,user.id,clientId);if(old){if(old.target_id!==target)fail(409,'Отправка уже использована.');return {id:old.id,status:old.status,replayed:true};}
   run("UPDATE club_transfers SET status='cancelled' WHERE club_id=? AND status='pending' AND expires_at<=?",club.id,now());if(get("SELECT 1 FROM club_transfers WHERE club_id=? AND status='pending'",club.id))fail(409,'Сначала отмени текущее предложение.');
   const id=randomUUID();run("INSERT INTO club_transfers VALUES(?,?,?,?,?,?,?,'pending')",id,club.id,user.id,target,clientId,now()+86400000,now());audit(db,user,club.id,target,'transfer-offer',now);return {id,status:'pending',replayed:false};
  });send(result.replayed?200:201,result);return true;
 }
 const id=text(body.offerId,'Предложение',1,80),offer=get('SELECT * FROM club_transfers WHERE id=? AND club_id=?',id,club.id);if(!offer)fail(404,'Предложение недоступно.');
 if(extra==='cancel'){
  if(user.id!==offer.target_id && !(user.id===offer.owner_id&&club.owner_id===user.id))fail(403,'Предложение недоступно.');
  transaction(db,()=>{if(offer.status==='cancelled')return;if(offer.status!=='pending')fail(409,'Предложение уже завершено.');run("UPDATE club_transfers SET status='cancelled' WHERE id=?",id);audit(db,user,club.id,offer.target_id,'transfer-cancel',now);});send(200,{ok:true});return true;
 }
 if(extra!=='accept')fail(405,'Метод не поддерживается.');
 if(user.id!==offer.target_id)fail(403,'Предложение предназначено другому участнику.');
 transaction(db,()=>{
  if(offer.status==='accepted'&&club.owner_id===user.id)return;
  if(offer.status!=='pending'||offer.expires_at<=now()||club.owner_id!==offer.owner_id)fail(409,'Предложение истекло или завершено.');
  if(get('SELECT status FROM memberships WHERE club_id=? AND user_id=?',club.id,user.id)?.status!=='member')fail(403,'Для передачи нужно оставаться участником клуба.');
  run('UPDATE clubs SET owner_id=?,settings_version=settings_version+1 WHERE id=?',user.id,club.id);run('DELETE FROM club_moderators WHERE club_id=? AND user_id IN (?,?)',club.id,user.id,offer.owner_id);run('UPDATE club_invites SET revoked=1 WHERE club_id=?',club.id);run("UPDATE club_transfers SET status='accepted' WHERE id=?",id);audit(db,user,club.id,user.id,'transfer-accept',now);
 });send(200,{ok:true});return true;
}
