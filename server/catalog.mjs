import {fail} from './security.mjs';
import {clubSummary} from './club-summary.mjs';
import {clubRole} from './clubs.mjs';
import {fold} from './players.mjs';

export function catalogRoutes({db,user,path,method,url,send}){
 if(path!=='/api/clubs'||method!=='GET')return false;
 const q=fold(url.searchParams.get('q')||'').trim(),tag=url.searchParams.get('tag')||'',scope=url.searchParams.get('scope')||'all',sort=url.searchParams.get('sort')||'new';
 if(q.length>100||tag.length>40||!['all','open','mine'].includes(scope)||!['new','name','discussion'].includes(sort))fail(422,'Проверь фильтры клубов.');
 if(scope==='mine'&&!user)fail(401,'Сначала войди в аккаунт.');
 const params={viewer:user?.id||'',q,tag};
 const conditions=`(:q='' OR instr(wr_fold(c.name||' '||c.description),:q)>0 OR EXISTS(SELECT 1 FROM json_each(c.tags) WHERE instr(wr_fold(value),:q)>0))
   AND (:tag='' OR EXISTS(SELECT 1 FROM json_each(c.tags) WHERE value=:tag))
   ${scope==='mine'?"AND m.status='member'":scope==='open'?"AND c.access='open'":''}`;
 // The discussion order observes the same access and block rules as the cards.
 const order=sort==='new'?'c.created_at':sort==='name'?"(CASE WHEN wr_fold(c.name) GLOB '[а-яё]*' THEN '0' ELSE '1' END)||wr_fold(c.name)":`COALESCE((SELECT p.created_at FROM posts p WHERE p.club_id=c.id
   AND (m.status IS NULL OR m.status!='banned') AND (c.access='open' OR m.status='member')
   AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=p.author_id) OR (b.target_id=:viewer AND b.blocker_id=p.author_id)) ORDER BY p.id DESC LIMIT 1),0)`;
 const from=`FROM clubs c LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=:viewer WHERE ${conditions}`;
 const direction=sort==='name'?'ASC':'DESC',op=sort==='name'?'>':'<';
 let cursor='';
 if(url.searchParams.has('after')){
  let value;try{value=JSON.parse(Buffer.from(url.searchParams.get('after'),'base64url').toString('utf8'));}catch{fail(422,'Некорректный курсор.');}
  if(!Array.isArray(value)||value.length!==3||value[0]!==sort||typeof value[2]!=='string'||value[2].length>80||(sort==='name'?typeof value[1]!=='string'||value[1].length>161:!Number.isSafeInteger(value[1])||value[1]<0))fail(422,'Некорректный курсор.');
  params.value=value[1];params.id=value[2];cursor=`WHERE (sort_key${op}:value OR (sort_key=:value AND id${op}:id))`;
 }
 const rows=db.prepare(`WITH catalog AS (SELECT c.*,m.status AS membership,${order} AS sort_key,
   (SELECT count(*) FROM memberships WHERE club_id=c.id AND status='member') AS members ${from})
   SELECT * FROM catalog ${cursor} ORDER BY sort_key ${direction},id ${direction} LIMIT 101`).all(params);
 const page=rows.slice(0,100),last=page.at(-1);
 const total=db.prepare(`SELECT count(*) n ${from}`).get({viewer:params.viewer,q,tag}).n;
 const tags=db.prepare('SELECT DISTINCT j.value tag FROM clubs c,json_each(c.tags) j ORDER BY tag').all().map(r=>r.tag);
 send(200,{viewerId:user?.id||null,total,tags,clubs:page.map(({sort_key,...c})=>({...c,...clubSummary(db,c,user),tags:JSON.parse(c.tags),myRole:clubRole(db,c,user)})),next:rows.length>100?Buffer.from(JSON.stringify([sort,last.sort_key,last.id])).toString('base64url'):null});return true;
}
