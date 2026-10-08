// Public announcement previews use an explicit field allowlist. Membership and
// chat routes retain their existing authentication and access checks.
export function previewRoutes({db,user,path,method,send,now}) {
  if(path!=='/api/community-preview'||method!=='GET')return false;
  const viewer=user?.id||'',time=now();
  const blocked=`NOT EXISTS(SELECT 1 FROM blocks b WHERE
    (b.blocker_id=:viewer AND b.target_id=g.owner_id) OR
    (b.blocker_id=g.owner_id AND b.target_id=:viewer))`;
  const groups=db.prepare(`SELECT g.id,g.title,g.mode,g.region,g.language,g.role,g.starts_at,
    g.capacity-(SELECT count(*) FROM lfg_members m WHERE m.group_id=g.id AND m.status='accepted') AS available
    FROM lfg_groups g WHERE g.closed=0 AND g.expires_at>:time AND ${blocked}
    AND (SELECT count(*) FROM lfg_members m WHERE m.group_id=g.id AND m.status='accepted')<g.capacity
    ORDER BY g.id DESC LIMIT 6`).all({viewer,time});
  const events=db.prepare(`SELECT g.id,g.title,g.mode,g.region,g.language,g.starts_at,
    (SELECT count(*) FROM event_slots s WHERE s.event_id=g.id AND s.user_id IS NULL) AS available
    FROM game_events g WHERE g.cancelled=0 AND g.starts_at>:time AND ${blocked}
    ORDER BY g.starts_at,g.id LIMIT 6`).all({viewer,time});
  send(200,{groups,events});return true;
}
