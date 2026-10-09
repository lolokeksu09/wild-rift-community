import {fail} from './security.mjs';
export function agendaRoutes({db,user,path,method,url,send,now}){
 if(path!=='/api/agenda')return false;if(!user)fail(401,'Сначала войди в аккаунт.');if(method!=='GET')fail(405,'Метод не поддерживается.');const viewer=user.id,time=now(),type=url.searchParams.get('type')||'all',status=url.searchParams.get('status')||'all';if(!['all','events','tournaments'].includes(type)||!['all','upcoming','completed','cancelled'].includes(status))fail(422,'Некорректный фильтр расписания.');
 let after={rank:-1,sortAt:0,key:''};const cursor=url.searchParams.get('cursor');if(cursor){try{if(cursor.length>3000||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();const c=JSON.parse(Buffer.from(cursor,'base64url'));if(c.viewer!==viewer||c.type!==type||c.status!==status||![0,1,2].includes(c.after?.rank)||!Number.isSafeInteger(c.after.sortAt)||typeof c.after.key!=='string'||c.after.key.length>100)throw Error();after=c.after;}catch{fail(422,'Некорректная страница расписания.');}}
 const cte=`WITH games AS (
 SELECT 'event:'||e.id AS key,'events' AS type,e.id AS destinationId,NULL AS round,NULL AS slot,e.title,e.starts_at AS startsAt,e.ends_at AS endsAt,e.created_at AS createdAt,
 CASE WHEN e.cancelled=1 THEN 'cancelled' WHEN e.ends_at<=:time THEN 'completed' ELSE 'upcoming' END AS state,
 CASE WHEN e.owner_id=:viewer THEN 'Организатор' ELSE 'Участник' END AS participation,
 NULL AS teamA,NULL AS teamB,NULL AS scoreA,NULL AS scoreB,NULL AS ownReady,NULL AS bothReady,CASE WHEN e.starts_at<=:time AND e.ends_at>:time AND e.cancelled=0 THEN 1 ELSE 0 END AS ongoing
 FROM game_events e WHERE (e.owner_id=:viewer OR EXISTS(SELECT 1 FROM event_slots s WHERE s.event_id=e.id AND s.user_id=:viewer)) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=e.owner_id) OR (b.blocker_id=e.owner_id AND b.target_id=:viewer))
 UNION ALL
 SELECT 'match:'||t.id||':'||m.round||':'||m.slot,'tournaments',t.id,m.round,m.slot,t.title,m.starts_at,NULL,t.created_at,
 CASE WHEN t.cancelled_at IS NOT NULL THEN 'cancelled' WHEN m.winner IS NOT NULL THEN 'completed' ELSE 'upcoming' END,
 CASE WHEN t.owner_id=:viewer THEN 'Организатор' WHEN a.captain_id=:viewer OR bteam.captain_id=:viewer THEN 'Капитан' ELSE 'Участник' END,
 a.name,bteam.name,m.score_a,m.score_b,CASE WHEN r.team_id=m.team_a THEN m.ready_a_at IS NOT NULL WHEN r.team_id=m.team_b THEN m.ready_b_at IS NOT NULL ELSE NULL END,m.ready_a_at IS NOT NULL AND m.ready_b_at IS NOT NULL,0
 FROM tournaments t JOIN tournament_matches m ON m.tournament_id=t.id LEFT JOIN tournament_teams a ON a.id=m.team_a LEFT JOIN tournament_teams bteam ON bteam.id=m.team_b LEFT JOIN tournament_roster r ON r.tournament_id=t.id AND r.user_id=:viewer AND r.status='accepted'
 WHERE (t.owner_id=:viewer OR r.team_id IN (m.team_a,m.team_b)) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id IN (t.owner_id,a.captain_id,bteam.captain_id)) OR (b.target_id=:viewer AND b.blocker_id IN (t.owner_id,a.captain_id,bteam.captain_id)))
 ),visible AS (SELECT *,CASE state WHEN 'upcoming' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END AS rank,CASE WHEN state='upcoming' THEN COALESCE(startsAt,9007199254740991) ELSE -COALESCE(startsAt,createdAt) END AS sortAt FROM games)
 `;
 const filter="(:type='all' OR type=:type) AND (:status='all' OR state=:status)",bindings={viewer,time,type,status},records=db.prepare(cte+`SELECT * FROM visible WHERE ${filter} AND (rank>:rank OR (rank=:rank AND sortAt>:sortAt) OR (rank=:rank AND sortAt=:sortAt AND key>:key)) ORDER BY rank,sortAt,key LIMIT 51`).all({...bindings,...after}),more=records.length>50;records.splice(50);
 const safe=n=>{if(!n)return null;const {rank,sortAt,createdAt,...item}=n;return {...item,href:item.type==='events'?'/events?id='+item.destinationId:'/tournaments?id='+item.destinationId+'&round='+item.round+'&slot='+item.slot};};
 const nearest=db.prepare(cte+`SELECT * FROM visible WHERE ${filter} AND state='upcoming' AND startsAt>=:time ORDER BY startsAt,key LIMIT 1`).get(bindings),last=records.at(-1);send(200,{viewerId:viewer,items:records.map(safe),nearest:safe(nearest),next:more?Buffer.from(JSON.stringify({viewer,type,status,after:{rank:last.rank,sortAt:last.sortAt,key:last.key}})).toString('base64url'):null});return true;
}
