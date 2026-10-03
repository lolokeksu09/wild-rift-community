import {fail,text} from './security.mjs';import {transaction} from './database.mjs';
export function pollResults(db,post,user,now=Date.now){
 const poll=db.prepare('SELECT ends_at,duration_hours FROM polls WHERE post_id=?').get(post.id);if(!poll)return null;
 const viewer=user?.id||'',counts=db.prepare(`SELECT v.option_id,count(*) n FROM poll_votes v JOIN memberships m ON m.club_id=v.club_id AND m.user_id=v.user_id WHERE v.post_id=:post AND m.status='member' AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=v.user_id) OR (b.target_id=:viewer AND b.blocker_id=v.user_id)) GROUP BY v.option_id`).all({post:post.id,viewer});
 const options=db.prepare('SELECT option_id,label FROM poll_options WHERE post_id=? ORDER BY option_id').all(post.id).map(o=>({...o,votes:counts.find(c=>c.option_id===o.option_id)?.n||0}));
 const member=Boolean(user&&db.prepare("SELECT 1 FROM memberships WHERE club_id=? AND user_id=? AND status='member'").get(post.club_id,viewer));
 const myOption=member?db.prepare('SELECT option_id FROM poll_votes WHERE post_id=? AND user_id=?').get(post.id,viewer)?.option_id??null:null;
 return {endsAt:poll.ends_at,closed:now()>=poll.ends_at,member,options,total:options.reduce((n,o)=>n+o.votes,0),myOption};
}
export function pollRoutes({db,user,path,method,body,send,now,clubFor,postFor,mentions}){
 const create=path.match(/^\/api\/clubs\/([\w-]+)\/polls$/),vote=path.match(/^\/api\/posts\/(\d+)\/poll(?:\/(vote))?$/);if(!create&&!vote)return false;
 if(create){
  if(method!=='POST')fail(405,'Метод не поддерживается.');if(!user)fail(401,'Сначала войди в аккаунт.');const clubId=create[1];clubFor(clubId,user,true);
  const title=text(body.title,'Вопрос',1,100),content=text(body.body??'','Описание',0,4000),hours=body.durationHours,clientId=body.clientId;
  if(!Number.isSafeInteger(hours)||hours<1||hours>168)fail(422,'Выбери срок от 1 часа до 7 дней.');
  if(typeof clientId!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(clientId))fail(422,'Некорректная попытка создания.');
  if(!Array.isArray(body.options)||body.options.length<2||body.options.length>6)fail(422,'Нужно от 2 до 6 вариантов.');const options=body.options.map(v=>text(v,'Вариант',1,100));if(new Set(options.map(v=>v.normalize('NFKC').toLowerCase())).size!==options.length)fail(422,'Варианты должны различаться.');
  const result=transaction(db,()=>{
   const old=db.prepare('SELECT id,title,body FROM posts WHERE club_id=? AND author_id=? AND client_id=?').get(clubId,user.id,clientId);
   if(old){const poll=db.prepare('SELECT duration_hours FROM polls WHERE post_id=?').get(old.id),labels=db.prepare('SELECT label FROM poll_options WHERE post_id=? ORDER BY option_id').all(old.id).map(o=>o.label);if(!poll||old.title!==title||old.body!==content||poll.duration_hours!==hours||JSON.stringify(labels)!==JSON.stringify(options))fail(409,'Эта попытка уже использована для другой публикации.');return {id:old.id,replayed:true};}
   const time=now(),id=Number(db.prepare('INSERT INTO posts(club_id,author_id,title,body,created_at,client_id) VALUES(?,?,?,?,?,?)').run(clubId,user.id,title,content,time,clientId).lastInsertRowid);
   db.prepare('INSERT INTO polls VALUES(?,?,?,?)').run(id,clubId,time+hours*3600000,hours);options.forEach((label,i)=>db.prepare('INSERT INTO poll_options VALUES(?,?,?)').run(id,i,label));
   mentions(db,{post:{id,club_id:clubId,author_id:user.id},actor:user,body:title+'\n'+content,now});return {id,replayed:false};
  });send(result.replayed?200:201,result);return true;
 }
 const id=Number(vote[1]);if(!Number.isSafeInteger(id))fail(404,'Опрос недоступен.');if(vote[2]&&!user)fail(401,'Сначала войди в аккаунт.');
 if(method!==(vote[2]?'PUT':'GET'))fail(405,'Метод не поддерживается.');const post=postFor(id,user,Boolean(vote[2]));if(!db.prepare('SELECT 1 FROM polls WHERE post_id=?').get(id))fail(404,'Опрос недоступен.');
 let replayed=false;if(vote[2]){if(!Number.isSafeInteger(body.optionId))fail(422,'Выбери вариант.');transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM poll_options WHERE post_id=? AND option_id=?').get(id,body.optionId))fail(422,'Такого варианта нет.');const old=db.prepare('SELECT option_id FROM poll_votes WHERE post_id=? AND user_id=?').get(id,user.id);
  if(old){if(old.option_id!==body.optionId)fail(409,'Ты уже проголосовал. Изменить выбор нельзя.');replayed=true;return;}
  if(now()>=db.prepare('SELECT ends_at FROM polls WHERE post_id=?').get(id).ends_at)fail(409,'Опрос завершён.');
  db.prepare('INSERT INTO poll_votes VALUES(?,?,?,?,?)').run(id,user.id,post.club_id,body.optionId,now());
 });}
 send(200,{viewerId:user?.id||null,poll:pollResults(db,post,user,now),replayed});return true;
}
