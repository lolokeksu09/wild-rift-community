import {clubNotificationRoutes} from './club-notifications.mjs';
import {fail} from './security.mjs';
import {transaction} from './database.mjs';
import {discussionRoutes} from './discussions.mjs';
import {eventRoutes} from './events.mjs';
import {lfgRoutes} from './lfg.mjs';
import {tournamentRoutes} from './tournaments.mjs';
const sources={clubs:{route:'/api/club-notifications',handler:clubNotificationRoutes,table:'club_post_notifications'},discussions:{route:'/api/discussions/notifications',handler:discussionRoutes,table:'discussion_notifications'},events:{route:'/api/events/notifications',handler:eventRoutes,table:'event_notifications'},lfg:{route:'/api/lfg/notifications',handler:lfgRoutes,table:'lfg_notifications'},matches:{route:'/api/tournaments/notifications',handler:tournamentRoutes,table:'tournament_notifications'},invitations:{route:'/api/tournaments/invitations',handler:tournamentRoutes}};
const types=['all','clubs','discussions','events','lfg','tournaments'];
export function notificationRoutes(ctx){const {db,user,path,method,body,url,send}=ctx;if(path!=='/api/notifications'&&path!=='/api/notifications/read-all'&&!/^\/api\/notifications\/(clubs|discussions|events|lfg|matches|invitations)\/\d+\/read$/.test(path))return false;if(!user)fail(401,'Сначала войди в аккаунт.');
 const call=(source,route,method='GET',payload={})=>{let result;const target=new URL(route,'https://internal.test');sources[source].handler({...ctx,path:target.pathname,url:target,method,body:payload,send:(status,data)=>{if(status!==200)fail(status,'Не удалось загрузить уведомления.');result=data;}});if(!result||result.viewerId!==undefined&&result.viewerId!==user.id)fail(409,'Сеанс изменился.');return result;};
 const page=(source,before,unread=false)=>call(source,sources[source].route+'?before='+before+(unread?'&unread=1':''));
 const rows=(source,p)=>source==='invitations'?p.invitations.map(n=>({...n,id:n.tournament_id,seen:0})):p.notifications;
 const through=()=>Object.fromEntries(Object.entries(sources).filter(([,v])=>v.table).map(([k,v])=>[k,db.prepare(`SELECT COALESCE(max(id),0) id FROM ${v.table} WHERE user_id=?`).get(user.id).id]));
 const total=()=>Object.keys(sources).reduce((n,k)=>{const d=call(k,sources[k].route+'/summary');return n+(k==='invitations'?d.pending:d.unread);},0);
 const read=path.match(/^\/api\/notifications\/(\w+)\/(\d+)\/read$/);
 if(read&&method==='POST'){const source=read[1],id=Number(read[2]);if(!Number.isSafeInteger(id)||id<1||id===Number.MAX_SAFE_INTEGER)fail(422,'Некорректное уведомление.');if(source==='invitations')fail(409,'Приглашение нужно принять или отклонить в турнире.');if(!rows(source,page(source,id+1)).some(n=>n.id===id))fail(404,'Уведомление недоступно.');call(source,sources[source].route+'/'+id+'/read','POST',{});send(200,{ok:true});return true;}
 if(path==='/api/notifications/read-all'&&method==='POST'){
  if(!body.through||typeof body.through!=='object'||Array.isArray(body.through)||Object.keys(body.through).some(k=>!sources[k]?.table)||Object.entries(sources).some(([k,v])=>v.table&&(!Number.isSafeInteger(body.through[k])||body.through[k]<0||body.through[k]>=Number.MAX_SAFE_INTEGER)))fail(422,'Обнови уведомления перед отметкой прочитанного.');
  transaction(db,()=>{for(const [source,spec] of Object.entries(sources)){if(!spec.table)continue;let before=body.through[source]+1;while(before>1){const p=page(source,before),items=rows(source,p);const update=db.prepare(`UPDATE ${spec.table} SET seen=1 WHERE user_id=? AND id=?`);for(const n of items)update.run(user.id,n.id);if(!p.next)break;before=p.next;}}});send(200,{ok:true,viewerId:user.id,total:total()});return true;
 }
 if(path!=='/api/notifications'||method!=='GET')fail(405,'Метод не поддерживается.');
 const type=url.searchParams.get('type')||'all',unread=url.searchParams.get('unread')==='1';if(!types.includes(type)||url.searchParams.has('unread')&&!['0','1'].includes(url.searchParams.get('unread')))fail(422,'Некорректный фильтр уведомлений.');
 const selected=Object.keys(sources).filter(k=>type==='all'||type==='tournaments'&&['matches','invitations'].includes(k)||k===type);let after=Object.fromEntries(selected.map(k=>[k,Number.MAX_SAFE_INTEGER]));const cursor=url.searchParams.get('cursor');
 if(cursor){try{if(cursor.length>4000||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();const c=JSON.parse(Buffer.from(cursor,'base64url').toString());if(c.viewer!==user.id||c.type!==type||c.unread!==unread||selected.some(k=>!Number.isSafeInteger(c.after?.[k])||c.after[k]<0))throw Error();after=c.after;}catch{fail(422,'Некорректный курсор уведомлений.');}}
 const streams={};for(const source of selected){let before=after[source],items=[];while(before>0&&items.length<51){const p=page(source,before,unread),part=rows(source,p);items.push(...part);if(!p.next){before=0;break;}before=p.next;}streams[source]={items,index:0,more:before>0};}
 const notifications=[];for(let i=0;i<50;i++){const candidates=selected.filter(k=>streams[k].items[streams[k].index]);if(!candidates.length)break;candidates.sort((a,b)=>{const x=streams[a].items[streams[a].index],y=streams[b].items[streams[b].index];return (y.created_at||0)-(x.created_at||0)||b.localeCompare(a)||y.id-x.id;});const source=candidates[0],n=streams[source].items[streams[source].index++];after[source]=n.id;notifications.push({...n,source,key:source+':'+n.id});}
 for(const source of selected){const s=streams[source];if(s.index===s.items.length&&!s.more)after[source]=0;}
 const more=selected.some(k=>after[k]>0),next=more?Buffer.from(JSON.stringify({viewer:user.id,type,unread,after})).toString('base64url'):null;
 send(200,{viewerId:user.id,notifications,next,total:total(),through:through()});return true;
}
