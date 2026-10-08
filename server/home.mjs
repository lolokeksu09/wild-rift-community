import {fail} from './security.mjs';
import {fold} from './players.mjs';
export function homeRoutes({db,user,path,method,send,now}) {
 if(path!=='/api/home')return false;
 if(method!=='GET')fail(405,'Метод не поддерживается.');
 if(!user)fail(401,'Сначала войди в аккаунт.');
 const all=(q,p)=>db.prepare(q).all(p),get=(q,p)=>db.prepare(q).get(p);
 const params={viewer:user.id,now:now()};
 const unblocked=`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=g.owner_id) OR (b.blocker_id=g.owner_id AND b.target_id=:viewer))`;
 const myClubs=all(`SELECT c.id,c.name,c.accent,(SELECT count(*) FROM memberships x WHERE x.club_id=c.id AND x.status='member') AS members
   FROM clubs c JOIN memberships m ON m.club_id=c.id AND m.user_id=:viewer AND m.status='member' ORDER BY c.created_at DESC,c.id DESC LIMIT 6`,{viewer:user.id});
 const clubCount=get("SELECT count(*) n FROM memberships WHERE user_id=:viewer AND status='member'",{viewer:user.id}).n;
 const events=all(`SELECT e.id,e.title,e.mode,e.starts_at,e.ends_at,e.timezone,s.role AS myRole,
   (SELECT count(*) FROM event_slots x WHERE x.event_id=e.id AND x.user_id IS NOT NULL) AS members,
   (SELECT count(*) FROM event_slots x WHERE x.event_id=e.id) AS capacity
   FROM game_events e JOIN event_slots s ON s.event_id=e.id AND s.user_id=:viewer
   WHERE e.cancelled=0 AND e.ends_at>:now AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=e.owner_id) OR (b.blocker_id=e.owner_id AND b.target_id=:viewer))
   ORDER BY e.starts_at ASC,e.id ASC LIMIT 3`,params);
 const groupSelect=`SELECT g.id,g.title,g.mode,g.region,g.language,g.role,g.rank,g.voice,g.starts_at,g.expires_at,g.capacity,
   (SELECT count(*) FROM lfg_members x WHERE x.group_id=g.id AND x.status='accepted') AS members`;
 const myGroups=all(`${groupSelect},m.status AS membership FROM lfg_groups g JOIN lfg_members m ON m.group_id=g.id AND m.user_id=:viewer
   WHERE m.status IN ('accepted','pending') AND g.closed=0 AND g.expires_at>:now AND ${unblocked} ORDER BY g.starts_at ASC,g.id DESC LIMIT 3`,params);
 const profile=JSON.parse(user.game_profile||'{}'),preferences={},matchParams={...params};let where='';
 for(const f of ['region','language'])if(profile[f]?.trim()){preferences[f]=profile[f];matchParams[f]=fold(profile[f]);where+=` AND wr_fold(g.${f})=:${f}`;}
 if(profile.roles?.length){preferences.roles=profile.roles;matchParams.roles=JSON.stringify(profile.roles);where+=" AND (g.role='any' OR g.role IN (SELECT value FROM json_each(:roles)))";}
 if(profile.rank?.trim()){preferences.rank=profile.rank;matchParams.rank=fold(profile.rank);where+=" AND (g.rank='' OR wr_fold(g.rank) IN (:rank,'любой','any'))";}
 if(profile.microphone==='no'){preferences.microphone='no';where+=" AND g.voice!='required'";}
 const groups=all(`${groupSelect} FROM lfg_groups g WHERE g.owner_id<>:viewer AND g.closed=0 AND g.expires_at>:now AND ${unblocked}
   AND (SELECT count(*) FROM lfg_members x WHERE x.group_id=g.id AND x.status='accepted')<g.capacity
   AND NOT EXISTS(SELECT 1 FROM lfg_members x WHERE x.group_id=g.id AND x.user_id=:viewer AND x.status IN ('accepted','pending','rejected'))${where}
   ORDER BY g.id DESC LIMIT 4`,matchParams);
 send(200,{viewerId:user.id,generatedAt:params.now,myClubs,clubCount,events,myGroups,groups,preferences});return true;
}
