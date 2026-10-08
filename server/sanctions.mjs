// Escalating account sanctions derived from final moderator decisions; no separate state to drift.
// One violating object counts once however many people reported it, so mass reports cannot escalate.
const HOUR=3600000,DAY=24*HOUR,WINDOW=30*DAY;
const LADDER=[[5,'suspended',30*DAY],[3,'restricted',7*DAY],[2,'restricted',DAY],[1,'warning',0]];
export function sanctionFor(db,userId,time){
 const rows=db.prepare(`SELECT MIN(decided_at) AS decided_at FROM (
   SELECT r.kind,r.target_id,(SELECT MAX(m.created_at) FROM moderation_audit m WHERE m.report_id=r.id) AS decided_at
   FROM reports r LEFT JOIN report_appeals a ON a.report_id=r.id
   WHERE r.sender_id=? AND (CASE WHEN a.status IN ('upheld','dismissed') THEN a.status ELSE r.status END)='upheld'
 ) WHERE decided_at IS NOT NULL GROUP BY kind,target_id`).all(userId).map(r=>r.decided_at).filter(t=>t>time-WINDOW);
 if(!rows.length)return null;
 const [,level,duration]=LADDER.find(([min])=>rows.length>=min),until=Math.max(...rows)+duration;
 if(level!=='warning'&&until<=time)return {level:'warning',violations:rows.length,until:null};
 return {level,violations:rows.length,until:level==='warning'?null:until};
}
// Creating or changing public content, messages and uploads. Reading, leaving, blocking,
// reporting, appeals, read markers and removing one's own content stay available.
const RESTRICTED=[
 ['POST',/^\/api\/tournaments(?:\/(?:\d+)(?:\/(?:join|start|results|invite|accept))?)?$/],
 ['POST',/^\/api\/clubs$/],['POST',/^\/api\/clubs\/[\w-]+\/(posts|polls|guides|messages|draft\/publish)$/],
 ['PATCH',/^\/api\/clubs\/[\w-]+\/(settings|cover)$/],['PATCH',/^\/api\/posts\/\d+(\/guide)?$/],
 ['POST',/^\/api\/posts\/\d+\/comments$/],['POST',/^\/api\/direct(\/[\w-]+\/messages)?$/],
 ['POST',/^\/api\/(lfg|events)(\/\d+\/messages)?$/],['POST',/^\/api\/media$/]
];
export function restrictedWrite(method,path,body){
 if(method==='PATCH'&&path==='/api/me')return Object.keys(body).some(k=>k!=='profileVisible')||body.profileVisible!==false;
 return RESTRICTED.some(([m,re])=>m===method&&re.test(path));
}
export const sanctionDate=ms=>new Date(ms).toLocaleString('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+' UTC';
