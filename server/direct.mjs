import { randomUUID } from 'node:crypto';
import { fail, text } from './security.mjs';
import { transaction } from './database.mjs';
import {contactBudget,contactPolicy} from './contact-budget.mjs';

export function directRoutes({db,user,path,method,body,url,send,now,contactLimits=contactPolicy()}) {
  if (!/^\/api\/(direct(?:\/|$)|blocks$|me\/privacy$)/.test(path)) return false;
  if (!user) fail(401,'Сначала войди в аккаунт.');
  const get=(q,...p)=>db.prepare(q).get(...p), all=(q,...p)=>db.prepare(q).all(...p), run=(q,...p)=>db.prepare(q).run(...p);
  const blocked=(a,b)=>get('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',a,b,b,a);
  if(path==='/api/direct/contact-budget'&&method==='GET'){send(200,{viewerId:user.id,contactBudget:contactBudget(db,user,now(),contactLimits)});return true;}
  const messageInput=()=>{
    const clientId=text(body.clientId,'Идентификатор',16,80);
    if(!/^[A-Za-z0-9_-]+$/.test(clientId))fail(422,'Некорректный идентификатор.');
    return {clientId,content:text(body.body,'Сообщение',1,2000)};
  };
  const conversation=id=>{
    const c=get('SELECT * FROM direct_conversations WHERE id=? AND (user_low=? OR user_high=?)',id,user.id,user.id);
    if(!c)fail(404,'Беседа недоступна.');
    if(blocked(c.user_low,c.user_high))fail(403,'Беседа заблокирована.');
    return c;
  };
  if(path==='/api/direct/summary' && method==='GET'){
    const visible=`(c.user_low=:viewer OR c.user_high=:viewer) AND NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=c.user_low AND b.target_id=c.user_high) OR (b.blocker_id=c.user_high AND b.target_id=c.user_low))`;
    const params={viewer:user.id};
    const unread=db.prepare(`SELECT count(*) n FROM direct_messages m JOIN direct_conversations c ON c.id=m.conversation_id
      LEFT JOIN direct_reads r ON r.conversation_id=c.id AND r.user_id=:viewer
      WHERE ${visible} AND c.status='accepted' AND m.sender_id<>:viewer AND m.id>COALESCE(r.last_id,0)`).get(params).n;
    const requests=db.prepare(`SELECT count(*) n FROM direct_conversations c WHERE ${visible} AND c.status='pending' AND c.requester_id<>:viewer`).get(params).n;
    send(200,{viewerId:user.id,unread,requests});return true;
  }
  if(path==='/api/me/privacy' && method==='PATCH'){
    if(typeof body.dmRequests!=='boolean')fail(422,'Укажи настройку запросов.');
    run('UPDATE users SET dm_requests=? WHERE id=?',Number(body.dmRequests),user.id);send(200,{ok:true});return true;
  }
  if(path==='/api/blocks'){
    if(method==='GET'){send(200,{blocks:all('SELECT u.id,u.handle,u.name FROM blocks b JOIN users u ON u.id=b.target_id WHERE b.blocker_id=? ORDER BY u.handle',user.id)});return true;}
    if(method==='POST'||method==='DELETE'){
      const target=text(body.userId,'Пользователь',1,80);
      if(target===user.id||!get('SELECT id FROM users WHERE id=?',target))fail(422,'Недопустимый пользователь.');
      const blockVersion=transaction(db,()=>{
        const result=method==='POST'?run('INSERT OR IGNORE INTO blocks VALUES(?,?)',user.id,target):run('DELETE FROM blocks WHERE blocker_id=? AND target_id=?',user.id,target);
        if(result.changes)run('UPDATE users SET block_version=block_version+1 WHERE id=?',user.id);
        return get('SELECT block_version FROM users WHERE id=?',user.id).block_version;
      });
      send(200,{ok:true,blockVersion});return true;
    }
  }
  if(path==='/api/direct' && method==='GET'){
    const raw=url.searchParams.get('after');let cursor=null;
    if(raw!==null){try{cursor=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));}catch{fail(422,'Некорректный курсор.');}
      if(!Array.isArray(cursor)||cursor.length!==2||!Number.isSafeInteger(cursor[0])||cursor[0]<0||typeof cursor[1]!=='string'||cursor[1].length>80)fail(422,'Некорректный курсор.');}
    const rows=all(`SELECT c.*,u.id AS peer_id,u.name AS peer_name,u.handle AS peer_handle,
      (SELECT body FROM direct_messages WHERE conversation_id=c.id ORDER BY id LIMIT 1) AS first_body,
      (SELECT id FROM direct_messages WHERE conversation_id=c.id ORDER BY id LIMIT 1) AS first_message_id,
      CASE WHEN c.status='accepted' THEN (SELECT count(*) FROM direct_messages dm WHERE dm.conversation_id=c.id AND dm.sender_id<>?
        AND dm.id>COALESCE((SELECT last_id FROM direct_reads WHERE conversation_id=c.id AND user_id=?),0)) ELSE 0 END AS unread
      FROM direct_conversations c JOIN users u ON u.id=CASE WHEN c.user_low=? THEN c.user_high ELSE c.user_low END
      WHERE (c.user_low=? OR c.user_high=?) AND NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=c.user_low AND b.target_id=c.user_high) OR (b.blocker_id=c.user_high AND b.target_id=c.user_low))
      ${cursor?'AND (c.created_at<? OR (c.created_at=? AND c.id>?))':''}
      ORDER BY c.created_at DESC,c.id ASC LIMIT 51`,user.id,user.id,user.id,user.id,user.id,...(cursor?[cursor[0],cursor[0],cursor[1]]:[]));
    const conversations=rows.slice(0,50),last=conversations.at(-1);let summary;
    directRoutes({db,user,path:'/api/direct/summary',method:'GET',body,url,now,send:(_status,data)=>{summary=data;}});
    send(200,{...summary,contactBudget:contactBudget(db,user,now(),contactLimits),conversations,next:rows.length>50?Buffer.from(JSON.stringify([last.created_at,last.id])).toString('base64url'):null});return true;
  }
  if(path==='/api/direct' && method==='POST'){
    const handle=text(body.handle,'Логин',3,24).toLowerCase(),{clientId,content}=messageInput();
    const result=transaction(db,()=>{
      const peer=get('SELECT id,dm_requests FROM users WHERE handle=?',handle);
      if(!peer||peer.id===user.id||blocked(user.id,peer.id))fail(403,'Запрос этому игроку недоступен.');
      const [low,high]=[user.id,peer.id].sort();
      const old=get('SELECT * FROM direct_conversations WHERE user_low=? AND user_high=?',low,high);
      if(old){
        const m=get('SELECT body FROM direct_messages WHERE conversation_id=? AND sender_id=? AND client_id=?',old.id,user.id,clientId);
        if(old.status!=='rejected'&&m?.body===content)return {id:old.id,replayed:true};
        fail(409,'Беседа или запрос уже существует. Открой список сообщений.');
      }
      if(!peer.dm_requests)fail(403,'Запрос этому игроку недоступен.');
      const time=now(),budget=contactBudget(db,user,time,contactLimits);
      if(budget.retryAfterSeconds)return {limited:true,budget};
      const id=randomUUID();run('INSERT INTO direct_conversations VALUES(?,?,?,?,?,?)',id,low,high,user.id,'pending',time);
      run('INSERT INTO direct_messages(conversation_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)',id,user.id,clientId,content,time);
      return {id,replayed:false};
    });
    if(result.limited){const retryAfterSeconds=result.budget.retryAfterSeconds;send(429,{error:`Новые знакомства временно ограничены. Попробуй через ${Math.ceil(retryAfterSeconds/60)} мин. Существующие беседы доступны.`,retryAfterSeconds,contactBudget:result.budget});return true;}
    send(result.replayed?200:201,result);return true;
  }
  const match=path.match(/^\/api\/direct\/([\w-]+)\/(decision|messages|read)$/);
  if(match){
    const [,id,action]=match,c=conversation(id);
    if(action==='read'&&method==='POST'){
      if(c.status!=='accepted')fail(403,'Беседа ещё не принята.');
      if(!Number.isSafeInteger(body.lastId)||body.lastId<1||!get('SELECT id FROM direct_messages WHERE conversation_id=? AND id=?',id,body.lastId))fail(422,'Некорректная отметка прочтения.');
      run(`INSERT INTO direct_reads VALUES(?,?,?) ON CONFLICT(conversation_id,user_id)
        DO UPDATE SET last_id=MAX(last_id,excluded.last_id)`,id,user.id,body.lastId);
      send(200,{ok:true});return true;
    }
    if(action==='decision' &&method==='POST'){
      if(c.requester_id===user.id)fail(403,'Решение принимает получатель.');
      const status={accept:'accepted',reject:'rejected'}[body.decision];
      if(!['accept','reject'].includes(body.decision))fail(422,'Выбери решение.');
      if(c.status!=='pending'&&c.status!==status)fail(409,'Решение уже принято.');
      run('UPDATE direct_conversations SET status=? WHERE id=?',status,id);send(200,{status});return true;
    }
    if(action==='messages'){
      if(c.status!=='accepted')fail(403,'Сначала получатель должен принять запрос.');
      if(method==='GET'){
        const before=url.searchParams.get('before'),after=url.searchParams.get('after'),cursor=before??after;
        if((before!==null&&after!==null)||(cursor!==null&&(!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))))fail(422,'Некорректный курсор.');
        const newer=after!==null;
        const result=all(`SELECT m.*,u.name AS sender_name FROM direct_messages m JOIN users u ON u.id=m.sender_id
          WHERE conversation_id=? AND m.id${newer?'>':'<'}? ORDER BY m.id ${newer?'ASC':'DESC'} LIMIT 51`,id,Number(cursor??Number.MAX_SAFE_INTEGER));
        const messages=result.slice(0,50),hasMore=result.length>50;if(!newer)messages.reverse();
        send(200,{viewerId:user.id,messages,hasMore,next:hasMore?(newer?messages.at(-1).id:messages[0].id):null});return true;
      }
      if(method==='POST'){
        const {clientId,content}=messageInput();
        const result=transaction(db,()=>{
          const old=get('SELECT * FROM direct_messages WHERE conversation_id=? AND sender_id=? AND client_id=?',id,user.id,clientId);
          if(old){if(old.body!==content)fail(409,'Идентификатор занят другим текстом.');return {id:old.id,replayed:true};}
          const r=run('INSERT INTO direct_messages(conversation_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)',id,user.id,clientId,content,now());return {id:Number(r.lastInsertRowid),replayed:false};
        });send(result.replayed?200:201,{message:get('SELECT m.*,u.name AS sender_name FROM direct_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?',result.id),replayed:result.replayed});return true;
      }
    }
  }
  fail(405,'Метод не поддерживается.');
}
