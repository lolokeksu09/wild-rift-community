import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
import {unblocked,postExtras,attemptId} from './discussions.mjs';
import {fold} from './players.mjs';
export function postManagementRoutes({db,user,path,method,body,url,send,now,postFor,clubFor}){
 if(path==='/api/posts/search'){
  if(method!=='GET')fail(405,'Метод не поддерживается.');
  const query=text(url.searchParams.get('q')||'','Поиск',1,100),club=url.searchParams.get('club')||'',raw=url.searchParams.get('before')||String(Number.MAX_SAFE_INTEGER);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail(422,'Некорректный курсор.');
  if(club)clubFor(club,user);
  const posts=db.prepare(`SELECT p.*,u.name AS author_name,CASE WHEN u.profile_visible=1 THEN u.avatar_id ELSE NULL END AS author_avatar_id,c.name AS club_name FROM posts p JOIN users u ON u.id=p.author_id JOIN clubs c ON c.id=p.club_id LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=:viewer WHERE p.id<:before AND (:club='' OR c.id=:club) AND (m.status IS NULL OR m.status!='banned') AND (c.access='open' OR m.status='member') AND ${unblocked()} AND (instr(wr_fold(p.title),:q)>0 OR instr(wr_fold(p.body),:q)>0) ORDER BY p.id DESC LIMIT 21`).all({viewer:user?.id||'',before:Number(raw),club,q:fold(query)});
  send(200,{viewerId:user?.id||null,query,posts:postExtras(db,posts.slice(0,20),user),next:posts.length>20?posts[19].id:null});return true;
 }
 const match=path.match(/^\/api\/posts\/(\d+)$/);if(!match||method!=='PATCH')return false;
 if(!user)fail(401,'Сначала войди в аккаунт.');const id=Number(match[1]);if(!Number.isSafeInteger(id))fail(404,'Публикация недоступна.');
 const post=postFor(id,user,true);if(post.author_id!==user.id)fail(403,'Изменить публикацию может только автор.');
 const title=text(body.title,'Заголовок',1,100),content=text(body.body,'Текст',1,4000),clientId=attemptId(body);
 if(!clientId||!Number.isSafeInteger(body.version)||body.version<1)fail(422,'Некорректная версия изменения.');
 if('imageId' in body||'image_id' in body)fail(422,'Здесь можно изменить только заголовок и текст.');
 const result=transaction(db,()=>{
  const current=db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  if(current.edit_client_id===clientId){if(current.title!==title||current.body!==content)fail(409,'Эта попытка уже использована для другого текста.');return {version:current.edit_version,editedAt:current.edited_at,replayed:true};}
  if(current.edit_version!==body.version)fail(409,'Публикация изменена в другой вкладке. Твой текст остаётся здесь. Загрузи сохранённую версию.');
  if(current.title===title&&current.body===content)return {version:current.edit_version,editedAt:current.edited_at,replayed:false};
  const time=now();db.prepare('UPDATE posts SET title=?,body=?,edit_version=edit_version+1,edited_at=?,edit_client_id=? WHERE id=?').run(title,content,time,clientId,id);
  return {version:current.edit_version+1,editedAt:time,replayed:false};
 });send(200,result);return true;
}
