import {pollResults} from './polls.mjs';
import { fail, text } from './security.mjs';
import { transaction } from './database.mjs';
export function unblocked(alias='p') {
  return `NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=${alias}.author_id) OR (b.target_id=:viewer AND b.blocker_id=${alias}.author_id))`;
}
export function postExtras(db,posts,user,now=Date.now) {
  const viewer=user?.id||'';
  return posts.map(p=>({...p,guide:db.prepare('SELECT topic,champion,game_version,summary FROM guides WHERE post_id=?').get(p.id)||null,poll:pollResults(db,p,user,now),reactions:db.prepare(`SELECT r.kind,count(*) AS count FROM post_reactions r WHERE r.post_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=r.user_id) OR (b.target_id=? AND b.blocker_id=r.user_id)) GROUP BY r.kind`).all(p.id,viewer,viewer),myReaction:user?db.prepare('SELECT kind FROM post_reactions WHERE post_id=? AND user_id=?').get(p.id,viewer)?.kind||null:null,saved:user?Boolean(db.prepare('SELECT 1 FROM saved_posts WHERE post_id=? AND user_id=?').get(p.id,viewer)):false}));
}
export function attemptId(body) {
  if(body.clientId==null)return null; // Legacy clients; current UI always supplies an ID.
  if(typeof body.clientId!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(body.clientId))fail(422,'Некорректный идентификатор отправки.');
  return body.clientId;
}
export function mentions(db,{post,actor,body,commentId=null,replyTo=null,now}) {
  const handles=[...new Set([...body.matchAll(/(^|[^\p{L}\p{N}_@])@([a-z0-9_]{3,24})(?![\p{L}\p{N}_])/giu)].map(m=>m[2].toLowerCase()))];
  if(handles.length>10)fail(422,'В одном тексте можно упомянуть не больше 10 игроков.');
  const recipients=new Map();
  for(const handle of handles){const target=db.prepare('SELECT id FROM users WHERE handle=?').get(handle);if(target)recipients.set(target.id,'mention');}
  if(replyTo&&!recipients.has(replyTo))recipients.set(replyTo,'reply');
  for(const [id,kind] of recipients){
    if(id===actor.id)continue;
    if(db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(post.club_id,id)?.status!=='member')continue;
    if(db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id IN (?,?)) OR (target_id=? AND blocker_id IN (?,?))').get(id,actor.id,post.author_id,id,actor.id,post.author_id))continue;
    db.prepare('INSERT OR IGNORE INTO discussion_notifications(user_id,actor_id,post_id,comment_id,kind,created_at) VALUES(?,?,?,?,?,?)').run(id,actor.id,post.id,commentId,kind,now());
  }
}
// Filter before LIMIT and before counting. Never retain private text in event snapshots.
const readable=`JOIN posts p ON p.id=n.post_id JOIN clubs c ON c.id=p.club_id LEFT JOIN memberships m ON m.club_id=p.club_id AND m.user_id=:viewer LEFT JOIN comments cm ON cm.id=n.comment_id LEFT JOIN comments parent ON parent.id=cm.parent_id WHERE n.user_id=:viewer AND (m.status IS NULL OR m.status!='banned') AND (c.access='open' OR m.status='member') AND ${unblocked()} AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=n.actor_id) OR (b.target_id=:viewer AND b.blocker_id=n.actor_id)) AND (parent.id IS NULL OR ${unblocked('parent')})`;
function cursor(url,key,fallback){const raw=url.searchParams.get(key);if(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))fail(422,'Некорректный курсор.');return raw===null?fallback:Number(raw);}
export function discussionRoutes({db,user,path,method,body,url,send,now,postFor}) {
  const saved=path==='/api/saved',notification=path.match(/^\/api\/discussions\/notifications(?:\/(summary|\d+\/read))?$/),route=path.match(/^\/api\/posts\/(\d+)\/(reaction|saved|comments)$/);
  if(!saved&&!notification&&!route)return false;
  const viewer=user?.id||'';
  if(saved||notification){
    if(!user)fail(401,'Сначала войди в аккаунт.');
    if(saved){
      if(method!=='GET')fail(405,'Метод не поддерживается.');
      const posts=db.prepare(`SELECT p.*,u.name AS author_name,CASE WHEN u.profile_visible=1 THEN u.avatar_id ELSE NULL END AS author_avatar_id,c.name AS club_name FROM saved_posts s JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.author_id JOIN clubs c ON c.id=p.club_id LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=:viewer WHERE s.user_id=:viewer AND p.id<:before AND (m.status IS NULL OR m.status!='banned') AND (c.access='open' OR m.status='member') AND ${unblocked()} ORDER BY p.id DESC LIMIT 21`).all({viewer,before:cursor(url,'before',Number.MAX_SAFE_INTEGER)});
      send(200,{viewerId:viewer,posts:postExtras(db,posts.slice(0,20),user,now),next:posts.length>20?posts[19].id:null});return true;
    }
    if(notification[1]?.endsWith('/read')){
      if(method!=='POST')fail(405,'Метод не поддерживается.');
      const id=Number(notification[1].split('/')[0]);if(!Number.isSafeInteger(id))fail(404,'Уведомление недоступно.');
      if(!db.prepare(`SELECT n.id FROM discussion_notifications n ${readable} AND n.id=:id`).get({viewer,id}))fail(404,'Уведомление недоступно.');
      db.prepare('UPDATE discussion_notifications SET seen=1 WHERE id=? AND user_id=?').run(id,viewer);send(200,{ok:true});return true;
    }
    if(method!=='GET')fail(405,'Метод не поддерживается.');
    if(notification[1]==='summary'){const count=db.prepare(`SELECT count(*) AS unread FROM discussion_notifications n ${readable} AND n.seen=0`).get({viewer});send(200,{viewerId:viewer,unread:count.unread});return true;}
    const records=db.prepare(`SELECT n.id,n.kind,n.post_id,n.comment_id,n.created_at,n.seen,p.title,u.name AS actor_name FROM discussion_notifications n JOIN users u ON u.id=n.actor_id ${readable} AND n.id<:before ORDER BY n.id DESC LIMIT 21`).all({viewer,before:cursor(url,'before',Number.MAX_SAFE_INTEGER)});
    send(200,{viewerId:viewer,notifications:records.slice(0,20),next:records.length>20?records[19].id:null});return true;
  }
  const id=Number(route[1]),action=route[2];if(!Number.isSafeInteger(id))fail(404,'Публикация недоступна.');
  if(method!=='GET'&&!user)fail(401,'Сначала войди в аккаунт.');
  const post=postFor(id,user,method!=='GET'&&action!=='saved');
  if(action==='reaction'){
    if(method==='PUT'){if(!['like','useful','fire'].includes(body.kind))fail(422,'Выбери реакцию.');db.prepare('INSERT INTO post_reactions(post_id,user_id,kind) VALUES(?,?,?) ON CONFLICT(post_id,user_id) DO UPDATE SET kind=excluded.kind').run(id,viewer,body.kind);}
    else if(method==='DELETE')db.prepare('DELETE FROM post_reactions WHERE post_id=? AND user_id=?').run(id,viewer);else fail(405,'Метод не поддерживается.');
    send(200,{post:postExtras(db,[post],user,now)[0]});return true;
  }
  if(action==='saved'){
    if(method==='PUT')db.prepare('INSERT OR IGNORE INTO saved_posts(post_id,user_id,created_at) VALUES(?,?,?)').run(id,viewer,now());else if(method==='DELETE')db.prepare('DELETE FROM saved_posts WHERE post_id=? AND user_id=?').run(id,viewer);else fail(405,'Метод не поддерживается.');
    send(200,{saved:method==='PUT'});return true;
  }
  if(method==='GET'){
    const comments=db.prepare(`SELECT cm.id,cm.author_id,cm.body,cm.created_at,cm.parent_id,u.name AS author_name,parent.body AS parent_body,pu.name AS parent_author_name FROM comments cm JOIN users u ON u.id=cm.author_id LEFT JOIN comments parent ON parent.id=cm.parent_id LEFT JOIN users pu ON pu.id=parent.author_id WHERE cm.post_id=:post AND cm.id<:before AND ${unblocked('cm')} AND (parent.id IS NULL OR ${unblocked('parent')}) ORDER BY cm.id DESC LIMIT 51`).all({post:id,viewer,before:cursor(url,'before',Number.MAX_SAFE_INTEGER)});
    send(200,{viewerId:user?.id||null,comments:comments.slice(0,50).reverse(),next:comments.length>50?comments[49].id:null});return true;
  }
  if(method!=='POST')fail(405,'Метод не поддерживается.');
  const commentBody=text(body.body,'Комментарий',1,1000),clientId=attemptId(body),parentId=body.parentId??null;
  if(parentId!==null&&(!Number.isSafeInteger(parentId)||parentId<1))fail(422,'Некорректный комментарий для ответа.');
  let parent=null;
  if(parentId!==null){parent=db.prepare('SELECT * FROM comments WHERE id=? AND post_id=?').get(parentId,id);if(!parent||db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)').get(viewer,parent.author_id,parent.author_id,viewer))fail(404,'Комментарий недоступен.');if(parent.parent_id!==null)fail(422,'Ответь на исходный комментарий ветки.');}
  const result=transaction(db,()=>{
    const old=clientId?db.prepare('SELECT id,body,parent_id FROM comments WHERE post_id=? AND author_id=? AND client_id=?').get(id,viewer,clientId):null;
    if(old){if(old.body!==commentBody||old.parent_id!==parentId)fail(409,'Этот идентификатор уже использован для другого комментария.');return {id:old.id,replayed:true};}
    const commentId=Number(db.prepare('INSERT INTO comments(post_id,author_id,body,created_at,client_id,parent_id) VALUES(?,?,?,?,?,?)').run(id,viewer,commentBody,now(),clientId,parentId).lastInsertRowid);
    mentions(db,{post,actor:user,body:commentBody,commentId,replyTo:parent?.author_id,now});return {id:commentId,replayed:false};
  });send(result.replayed?200:201,result);return true;
}
