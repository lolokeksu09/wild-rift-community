import {profileView} from './profiles.mjs';
import {fail,text} from './security.mjs';
import {fold} from './players.mjs';
export function communityMemberRoutes({db,user,path,method,url,send}) {
  if(path!=='/api/community-members')return false;
  if(method!=='GET')fail(405,'Метод не поддерживается.');
  const viewer=user?.id||'',params={viewer};
  let where=`u.profile_visible=1 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
    (b.blocker_id=:viewer AND b.target_id=u.id) OR (b.target_id=:viewer AND b.blocker_id=u.id))`;
  const after=url.searchParams.get('after');
  if(after!==null){if(!/^[a-z0-9_]{3,24}$/.test(after))fail(422,'Некорректный курсор.');where+=' AND u.handle>:after';params.after=after;}
  const query=url.searchParams.get('q');
  if(query){params.q=fold(text(query,'Имя или логин',1,80));where+=' AND (instr(wr_fold(u.name),:q)>0 OR instr(u.handle,:q)>0)';}
  const role=url.searchParams.get('role');
  if(role){if(!['baron','jungle','mid','dragon','support'].includes(role))fail(422,'Выбери роль.');params.role=role;where+=" AND EXISTS(SELECT 1 FROM json_each(u.game_profile,'$.roles') r WHERE r.value=:role)";}
  const list=db.prepare(`SELECT u.id,u.name,u.handle,u.bio,u.game_profile,u.avatar_id,u.cover_id,u.profile_visible,u.dm_requests FROM users u WHERE ${where} ORDER BY u.handle LIMIT 21`).all(params);
  const members=list.slice(0,20).map(u=>({...profileView(u),acceptsRequests:u.dm_requests===1}));
  const counts=db.prepare(`SELECT count(*) total,coalesce(sum(json_extract(u.game_profile,'$.demoBot')='community-v1'),0) bots FROM users u WHERE u.profile_visible=1 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=u.id) OR (b.target_id=:viewer AND b.blocker_id=u.id))`).get({viewer});
  send(200,{viewerId:user?.id||null,members,next:list.length>20?members.at(-1).handle:null,...counts});return true;
}
