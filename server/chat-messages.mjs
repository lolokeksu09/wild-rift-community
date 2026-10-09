import {createHash} from 'node:crypto';
import {fail,text} from './security.mjs';
import {transaction} from './database.mjs';
const SOURCES={club:['messages','club_id'],direct:['direct_messages','conversation_id'],lfg:['lfg_messages','group_id'],event:['event_messages','event_id']};
export const CHAT_REACTIONS=['👍','❤️','😂','🔥','🎮'];
const signature=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Called only after the parent route has checked current membership/conversation access.
export function chatMessages({db,kind,chatId,user,method,body,url,send,now,canSend=true}){
 const [table,column]=SOURCES[kind],chat=String(chatId);
 const get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p),run=(q,...p)=>db.prepare(q).run(...p);
 const blocked=sender=>!!get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',user.id,sender,sender,user.id);
 const record=id=>get(`SELECT m.*,u.name AS sender_name FROM ${table} m JOIN users u ON u.id=m.sender_id WHERE m.${column}=? AND m.id=?`,chatId,id);
 const meta=id=>get('SELECT * FROM chat_message_state WHERE kind=? AND message_id=?',kind,id);
 const visible=m=>!!m&&!blocked(m.sender_id);
 const decorate=m=>{
  const state=meta(m.id),deleted=!!state?.deleted_at;
  const reply=state?.reply_id?record(state.reply_id):null,replyState=reply?meta(reply.id):null;
  const quote=visible(reply)&&!replyState?.deleted_at?{id:reply.id,sender_name:reply.sender_name,body:reply.body.slice(0,240)}:null;
  const reactions=deleted?[]:all(`SELECT r.emoji,count(*) AS count,max(r.user_id=?) AS mine FROM chat_message_reactions r WHERE r.kind=? AND r.message_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=r.user_id) OR (b.blocker_id=r.user_id AND b.target_id=?)) GROUP BY r.emoji ORDER BY r.emoji`,user.id,kind,m.id,user.id,user.id).map(r=>({...r,mine:!!r.mine}));
  return {...m,changeRevision:get('SELECT coalesce(max(id),0) n FROM chat_message_changes WHERE kind=? AND chat_id=? AND message_id=?',kind,chat,m.id).n,body:deleted?'':m.body,version:state?.version||1,edited_at:state?.edited_at||null,deleted,replyId:state?.reply_id||null,reply:quote,reactions};
 };
 const emit=id=>{const m=record(id);if(!visible(m))fail(404,'Сообщение недоступно.');return decorate(m);};
 const change=id=>{run('INSERT INTO chat_message_changes(kind,chat_id,message_id) VALUES(?,?,?)',kind,chat,id);run('INSERT INTO chat_message_changes(kind,chat_id,message_id) SELECT kind,chat_id,message_id FROM chat_message_state WHERE kind=? AND chat_id=? AND reply_id=?',kind,chat,id);};
 const latest=()=>get('SELECT coalesce(max(id),0) n FROM chat_message_changes WHERE kind=? AND chat_id=?',kind,chat).n;
 const key=()=>{const k=text(body.clientId,'Идентификатор',16,80);if(!/^[A-Za-z0-9_-]+$/.test(k))fail(422,'Некорректный идентификатор.');return k;};
 const suffix=url.pathname.slice(url.pathname.indexOf('/messages')+9),target=suffix.match(/^\/(\d+)(?:\/(edit|delete|reaction))?$/);
 if(suffix&&!target)fail(404,'Маршрут не найден.');
 if(target){
  const id=Number(target[1]),action=target[2];if(!Number.isSafeInteger(id)||id<1)fail(422,'Некорректное сообщение.');
  const message=record(id);if(!visible(message))fail(404,'Сообщение недоступно.');
  if(method==='GET'&&!action){send(200,{viewerId:user.id,message:decorate(message)});return true;}
  if(method!=='POST'||!action)fail(405,'Метод не поддерживается.');
  if(!canSend)fail(409,'Отправка и изменения в этом чате закрыты.');
  if(action!=='reaction'&&message.sender_id!==user.id)fail(403,'Изменять сообщение может только автор.');
  const clientId=key();let payload;
  if(action==='reaction'){
   if(!CHAT_REACTIONS.includes(body.emoji)||typeof body.active!=='boolean')fail(422,'Выбери доступную реакцию.');
   payload={id,action,emoji:body.emoji,active:body.active};
  }else{
   if(!Number.isSafeInteger(body.version)||body.version<1)fail(422,'Некорректная версия сообщения.');
   payload={id,action,version:body.version,...(action==='edit'?{body:text(body.body,'Сообщение',1,2000)}:{})};
  }
  const hash=signature(payload);
  const replayed=transaction(db,()=>{
   const old=get('SELECT signature FROM chat_message_operations WHERE kind=? AND chat_id=? AND user_id=? AND client_id=?',kind,chat,user.id,clientId);
   if(old){if(old.signature!==hash)fail(409,'Идентификатор занят другим действием.');return true;}
   const state=meta(id);if(state?.deleted_at)fail(409,'Сообщение уже удалено.');
   if(action!=='reaction'&&(state?.version||1)!==body.version)fail(409,'Сообщение изменилось. Обнови его перед сохранением.');
   if(!state)run('INSERT INTO chat_message_state(kind,message_id,chat_id,original_signature) VALUES(?,?,?,?)',kind,id,chat,signature({body:message.body,replyId:null}));
   if(action==='reaction'){
    if(body.active)run('INSERT OR IGNORE INTO chat_message_reactions VALUES(?,?,?,?)',kind,id,user.id,body.emoji);
    else run('DELETE FROM chat_message_reactions WHERE kind=? AND message_id=? AND user_id=? AND emoji=?',kind,id,user.id,body.emoji);
   }else{
    run(`UPDATE ${table} SET body=? WHERE id=? AND ${column}=?`,action==='edit'?payload.body:'',id,chatId);
    run(`UPDATE chat_message_state SET version=version+1,${action==='edit'?'edited_at':'deleted_at'}=? WHERE kind=? AND message_id=?`,Math.max(1,now()),kind,id);
    if(action==='delete')run('DELETE FROM chat_message_reactions WHERE kind=? AND message_id=?',kind,id);
   }
   change(id);run('INSERT INTO chat_message_operations VALUES(?,?,?,?,?)',kind,chat,user.id,clientId,hash);return false;
  });
  send(200,{viewerId:user.id,message:emit(id),replayed});return true;
 }
 if(method==='GET'){
  const before=url.searchParams.get('before'),after=url.searchParams.get('after'),raw=before??after;
  if((before!==null&&after!==null)||(raw!==null&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))))fail(422,'Некорректный курсор.');
  const revision=url.searchParams.get('revision');if(revision!==null&&(!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))))fail(422,'Некорректная версия истории.');
  const newer=after!==null;
  const result=all(`SELECT m.*,u.name AS sender_name FROM ${table} m JOIN users u ON u.id=m.sender_id WHERE m.${column}=? AND m.id${newer?'>':'<'}? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=m.sender_id) OR (b.blocker_id=m.sender_id AND b.target_id=?)) ORDER BY m.id ${newer?'ASC':'DESC'} LIMIT 51`,chatId,Number(raw??Number.MAX_SAFE_INTEGER),user.id,user.id);
  const messages=result.slice(0,50),hasMore=result.length>50;if(!newer)messages.reverse();
  const updates=revision===null?[]:all('SELECT id,message_id FROM chat_message_changes WHERE kind=? AND chat_id=? AND id>? ORDER BY id LIMIT 51',kind,chat,Number(revision));
  const page=updates.slice(0,50),changes=page.map(c=>{const m=record(c.message_id);return visible(m)?decorate(m):{id:c.message_id,removed:true,changeRevision:c.id};});
  send(200,{viewerId:user.id,canSend,blockVersion:get('SELECT block_version FROM users WHERE id=?',user.id).block_version,visibilityVersion:get('SELECT coalesce(sum(block_version),0) n FROM users').n,messages:messages.map(decorate),hasMore,next:hasMore?(newer?messages.at(-1).id:messages[0].id):null,changes,revision:updates.length>50?page.at(-1).id:latest(),changesMore:updates.length>50});return true;
 }
 if(method==='POST'){
  if(!canSend)fail(409,'Отправка в этом чате закрыта.');
  const clientId=key(),content=text(body.body,'Сообщение',1,2000),replyId=body.replyId??null;
  if(replyId!==null&&(!Number.isSafeInteger(replyId)||replyId<1))fail(422,'Некорректный адресат ответа.');
  const hash=signature({body:content,replyId});
  const result=transaction(db,()=>{
   const old=get(`SELECT * FROM ${table} WHERE ${column}=? AND sender_id=? AND client_id=?`,chatId,user.id,clientId);
   if(old){if((meta(old.id)?.original_signature||signature({body:old.body,replyId:null}))!==hash)fail(409,'Идентификатор занят другим сообщением.');return {id:old.id,replayed:true};}
   if(replyId!==null){const m=record(replyId);if(!visible(m)||meta(replyId)?.deleted_at)fail(404,'Сообщение для ответа недоступно.');}
   const id=Number(run(`INSERT INTO ${table}(${column},sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)`,chatId,user.id,clientId,content,now()).lastInsertRowid);
   run('INSERT INTO chat_message_state(kind,message_id,chat_id,reply_id,original_signature) VALUES(?,?,?,?,?)',kind,id,chat,replyId,hash);
   return {id,replayed:false};
  });send(result.replayed?200:201,{message:emit(result.id),replayed:result.replayed});return true;
 }
 fail(405,'Метод не поддерживается.');
}
