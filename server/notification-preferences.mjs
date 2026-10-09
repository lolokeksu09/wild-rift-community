import {fail} from './security.mjs';
const categories=['discussions','events','lfg','tournaments','clubs'];
export function notificationPreferences(db,id){const preferences=Object.fromEntries(categories.map(k=>[k,true]));for(const row of db.prepare('SELECT category,enabled FROM notification_preferences WHERE user_id=?').all(id))preferences[row.category]=!!row.enabled;return preferences;}
export const notificationCategory=source=>['matches','invitations'].includes(source)?'tournaments':source;
export function notificationTotal(s,p){return (p.discussions?s.discussions.unread:0)+(p.events?s.events.unread:0)+(p.lfg?s.lfg.unread:0)+(p.clubs?s.clubs.unread:0)+(p.tournaments?s.matches.unread+s.tournaments.pending:0);}
export function notificationPreferenceRoutes({db,user,path,method,body,send}){
 if(path!=='/api/notifications/preferences')return false;if(!user)fail(401,'Сначала войди в аккаунт.');
 if(method==='PUT'){if(!body||Object.keys(body).some(k=>!['category','enabled'].includes(k))||!categories.includes(body.category)||typeof body.enabled!=='boolean')fail(422,'Некорректные настройки уведомлений.');db.prepare('INSERT INTO notification_preferences(user_id,category,enabled) VALUES(?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET enabled=excluded.enabled').run(user.id,body.category,Number(body.enabled));}
 else if(method!=='GET')fail(405,'Метод не поддерживается.');
 send(200,{viewerId:user.id,preferences:notificationPreferences(db,user.id)});return true;
}
