import { fail, text } from './security.mjs';
import { profileView, roles } from './profiles.mjs';
export const fold = value => typeof value==='string' ? value.normalize('NFKC').trim().toLowerCase() : '';
export function playerRoutes({db,user,path,method,url,send}) {
  if(path!=='/api/players')return false;
  if(!user)fail(401,'Сначала войди в аккаунт.');
  if(method!=='GET')fail(405,'Метод не поддерживается.');
  const params=[user.id,user.id,user.id];
  let where=`u.profile_visible=1 AND u.id!=? AND NOT EXISTS (
    SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=u.id) OR (b.blocker_id=u.id AND b.target_id=?))`;
  const after=url.searchParams.get('after');
  if(after!==null){if(!/^[a-z0-9_]{3,24}$/.test(after))fail(422,'Некорректный курсор.');where+=' AND u.handle>?';params.push(after);}
  const q=url.searchParams.get('q');
  if(q){where+=" AND (instr(wr_fold(u.name),?)>0 OR instr(u.handle,?)>0)";const value=fold(text(q,'Имя или логин',1,80));params.push(value,value);}
  for(const field of ['rank','region','language']){
    const value=url.searchParams.get(field);
    if(value){where+=` AND wr_fold(json_extract(u.game_profile,'$.${field}'))=?`;params.push(fold(text(value,field,1,40)));}
  }
  const role=url.searchParams.get('role');
  if(role){if(!roles.includes(role))fail(422,'Выбери игровую роль.');where+=" AND EXISTS(SELECT 1 FROM json_each(u.game_profile,'$.roles') r WHERE r.value=?)";params.push(role);}
  const microphone=url.searchParams.get('microphone');
  if(microphone){if(!['yes','no'].includes(microphone))fail(422,'Выбери наличие микрофона.');where+=" AND json_extract(u.game_profile,'$.microphone')=?";params.push(microphone);}
  const rows=db.prepare(`SELECT u.id,u.handle,u.name,u.bio,u.game_profile,u.profile_visible,u.avatar_id,u.cover_id,u.dm_requests
    FROM users u WHERE ${where} ORDER BY u.handle ASC LIMIT 21`).all(...params);
  const players=rows.slice(0,20).map(row=>({...profileView(row),acceptsRequests:row.dm_requests===1}));
  const blockVersion=db.prepare('SELECT block_version FROM users WHERE id=?').get(user.id).block_version;
  send(200,{viewerId:user.id,blockVersion,players,next:rows.length>20?players.at(-1).handle:null});return true;
}
