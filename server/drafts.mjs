import {fail,text} from './security.mjs';import {transaction} from './database.mjs';import {ownedImage} from './media.mjs';import {mentions} from './discussions.mjs';
export function draftRoutes({db,user,path,method,body,send,now,clubFor}){
 if(path!=='/api/drafts'&&!/^\/api\/clubs\/[\w-]+\/draft(?:\/publish)?$/.test(path))return false;
 if(!user)fail(401,'Сначала войди в аккаунт.');
 const get=(q,...p)=>db.prepare(q).get(...p),run=(q,...p)=>db.prepare(q).run(...p);
 if(path==='/api/drafts'){if(method!=='GET')fail(405,'Метод не поддерживается.');const drafts=db.prepare(`SELECT d.club_id,c.name AS club_name,d.title,d.version,d.updated_at FROM post_drafts d JOIN clubs c ON c.id=d.club_id JOIN memberships m ON m.club_id=d.club_id AND m.user_id=d.user_id WHERE d.user_id=? AND m.status='member' ORDER BY d.updated_at DESC,d.club_id LIMIT 100`).all(user.id);send(200,{viewerId:user.id,drafts});return true;}
 const [,clubId,publish]=path.match(/^\/api\/clubs\/([\w-]+)\/draft(\/publish)?$/);clubFor(clubId,user,true);
 const draft=()=>get('SELECT title,body,image_id,version,updated_at FROM post_drafts WHERE club_id=? AND user_id=?',clubId,user.id);
 const version=()=>{if(!Number.isSafeInteger(body.version)||body.version<0)fail(422,'Некорректная версия черновика.');return body.version;};
 if(publish){if(method!=='POST')fail(405,'Метод не поддерживается.');const clientId=text(body.clientId,'Идентификатор публикации',16,80);if(!/^[A-Za-z0-9_-]+$/.test(clientId))fail(422,'Некорректный идентификатор.');const expected=version();const result=transaction(db,()=>{
  const current=draft(),old=get('SELECT id FROM posts WHERE club_id=? AND author_id=? AND client_id=?',clubId,user.id,clientId);
  if(old){if(current)fail(409,'Публикация уже отправлена. Новый черновик оставлен без изменений.');return {id:old.id,replayed:true};}
  if(!current||current.version!==expected)fail(409,'Черновик изменился. Загрузи сохранённую версию перед публикацией.');
  const title=text(current.title,'Заголовок',1,100),content=text(current.body,'Текст',1,4000);
  if(current.image_id&&!get('SELECT id FROM media WHERE id=? AND owner_id=?',current.image_id,user.id))fail(403,'Изображение недоступно.');
  const id=Number(run('INSERT INTO posts(club_id,author_id,title,body,created_at,image_id,client_id) VALUES(?,?,?,?,?,?,?)',clubId,user.id,title,content,now(),current.image_id,clientId).lastInsertRowid);
  mentions(db,{post:{id,club_id:clubId,author_id:user.id},actor:user,body:title+'\n'+content,now});
  run('DELETE FROM post_drafts WHERE club_id=? AND user_id=?',clubId,user.id);return {id,replayed:false};
 });send(result.replayed?200:201,result);return true;}
 if(method==='GET'){send(200,{viewerId:user.id,draft:draft()||null});return true;}
 if(method==='PUT'){
  const expected=version(),title=text(body.title,'Заголовок',0,100),content=text(body.body,'Текст',0,4000),image=body.imageId??null;
  const result=transaction(db,()=>{const old=draft();if(old&&old.title===title&&old.body===content&&old.image_id===image&&(expected===old.version||expected===old.version-1))return old;
   if((old?.version||0)!==expected)fail(409,'Черновик изменён в другой вкладке. Твой текст остаётся в редакторе.');
   const imageId=old?.image_id===image?image:ownedImage(db,image,user);
   if(!old&&get('SELECT count(*) n FROM post_drafts WHERE user_id=?',user.id).n>=100)fail(409,'Сначала удали один из 100 черновиков.');
   run('INSERT INTO post_drafts VALUES(?,?,?,?,?,?,?) ON CONFLICT(club_id,user_id) DO UPDATE SET title=excluded.title,body=excluded.body,image_id=excluded.image_id,version=excluded.version,updated_at=excluded.updated_at',clubId,user.id,title,content,imageId,expected+1,now());return draft();
  });send(200,{viewerId:user.id,draft:result});return true;
 }
 if(method==='DELETE'){const expected=version();transaction(db,()=>{const old=draft();if(!old)return;if(old.version!==expected)fail(409,'Черновик изменён в другой вкладке. Обнови редактор.');run('DELETE FROM post_drafts WHERE club_id=? AND user_id=?',clubId,user.id);});send(200,{ok:true});return true;}
 fail(405,'Метод не поддерживается.');
}
