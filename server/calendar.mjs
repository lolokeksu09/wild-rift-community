import {agendaRoutes} from './agenda.mjs';
import {fail} from './security.mjs';

const text=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const date=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
// Fold at UTF-8 character boundaries; the continuation space counts toward 75 octets.
function fold(line){let out='',length=0;for(const char of line){const size=Buffer.byteLength(char);if(length+size>75){out+='\r\n ';length=1;}out+=char;length+=size;}return out;}
export function calendarRoutes({db,user,path,method,url,now,origin,sendCalendar}){
 if(path!=='/api/agenda/calendar')return false;
 if(!user)fail(401,'Сначала войди в аккаунт.');
 if(method!=='GET')fail(405,'Метод не поддерживается.');
 const type=url.searchParams.get('type')||'all',key=url.searchParams.get('key');
 if(!['all','events','tournaments'].includes(type)||[...url.searchParams.keys()].some(k=>!['type','key'].includes(k))||(key!==null&&!/^(event:[1-9]\d*|match:[1-9]\d*:[1-9]\d*:\d+)$/.test(key)))fail(422,'Некорректная выгрузка календаря.');
 const time=now(),items=[];let cursor=null,selected=null;
 // Reuse the agenda's membership/block checks and pagination. All pages use one time snapshot.
 do{let page;const query=new URL('/api/agenda',origin);query.search=new URLSearchParams({type,status:'upcoming',...(cursor?{cursor}:{})}).toString();agendaRoutes({db,user,path:'/api/agenda',method:'GET',url:query,now:()=>time,send:(_,data)=>{page=data;}});for(const n of page.items){if(key){if(n.key===key)selected=n;}else if(n.startsAt!==null&&(n.startsAt>=time||n.ongoing))items.push(n);}cursor=page.next;}while(cursor&&!selected);
 if(key){if(!selected)fail(404,'Игра недоступна или уже завершена.');if(selected.startsAt===null)fail(422,'Время игры пока не назначено.');if(selected.startsAt<time&&!selected.ongoing)fail(422,'Время матча прошло. Проверь расписание на сайте.');items.push(selected);}
 if(!items.length)fail(422,'Нет предстоящих игр с назначенным временем.');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//wild-rift-community//Personal games//RU','CALSCALE:GREGORIAN'];
 for(const n of items){const href=new URL(n.href,origin).href,description=[n.type==='events'?'Игровое событие':'Турнирный матч',n.participation,...(n.type==='tournaments'?[`${n.teamA||'Ожидаем команду'} — ${n.teamB||'Ожидаем команду'}`,`Раунд ${n.round}, матч ${n.slot+1}`,'Время окончания матча не назначено.']:[]),'Проверь актуальное время и статус на сайте. Импорт файла не обновляется автоматически.',href].join('\n');lines.push('BEGIN:VEVENT','UID:'+n.key.replace(/:/g,'-')+'@'+new URL(origin).host,'DTSTAMP:'+date(time),'DTSTART:'+date(n.startsAt));if(n.endsAt!==null&&n.endsAt>n.startsAt)lines.push('DTEND:'+date(n.endsAt));lines.push('SUMMARY:'+text(n.title),'DESCRIPTION:'+text(description),'URL:'+href,'STATUS:CONFIRMED','TRANSP:TRANSPARENT','BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT30M','DESCRIPTION:'+text('Игра начнётся через 30 минут: '+n.title),'END:VALARM','END:VEVENT');}
 lines.push('END:VCALENDAR');sendCalendar(lines.map(fold).join('\r\n')+'\r\n',key?'wr-game.ics':'wr-my-games.ics');return true;
}
