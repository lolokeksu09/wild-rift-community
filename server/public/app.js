'use strict';
const $ = s => document.querySelector(s);
function navBadge(id,label,detail='',count=0){
 const button=$('#'+id);
 button.replaceChildren(document.createTextNode(label));
 if(count>0){const badge=document.createElement('span');badge.className='nav-count';badge.setAttribute('aria-hidden','true');badge.textContent=count>99?'99+':String(count);button.append(badge);}
 button.setAttribute('aria-label',detail?label+' · '+detail:label);
 button.title=detail||label;
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mediaUI=window.WRProfiles;
const guideUI=window.WRGuides;let guideState={};
const composerUI=window.WRComposer;const pollUI=window.WRPolls;
let composerController=null;
let welcomeController=null;
const postManagement=window.WRPostManagement;let searchState={query:'',club:''};
const discussionUI=window.WRDiscussions;
const clubUI=window.WRClubs;
let clubTab='posts',clubPins=new Set(),postReturnView='notifications';
let inviteToken=/^#invite=([a-f0-9]{64})$/.exec(location.hash)?.[1]||null;
if(inviteToken)history.replaceState(null,'',location.pathname);
let selectedPost=null,selectedComment=null;
let selectedPlayer=null,playerReturnView='discover',directDraftHandle='';
let lfgState={},eventState={};
let chatController = null;
let authReturn=null;
let sanction = null;
let user = null, csrf = null, clubs = [], selectedClub = null, view = inviteToken?'invite':'welcome', requestVersion = 0, pendingDelete = null;

let memberState={q:'',role:''};
let clubFilter={q:'',tag:'',scope:'all',sort:'new'};
let renderedRoute=null;let clubCatalog={clubs:[],total:0,tags:[],next:null},catalogRequest=0,catalogTimer=null;
function unsavedEditor(){
 const form=document.querySelector('#profile,[data-post-edit-form],[data-guide-edit],[data-guide-create]');
 return form&&[...form.querySelectorAll('input,textarea,select')].some(el=>{
  if(el.type==='file')return el.files.length>0;
  if(el.type==='checkbox'||el.type==='radio')return el.checked!==el.defaultChecked;
  if(el.tagName==='SELECT')return el.value!==([...el.options].find(o=>o.defaultSelected)||el.options[0])?.value;
  return el.value!==el.defaultValue;
 });
}
function plural(n,one,few,many){const x=Math.abs(n)%100,y=x%10;return n+' '+(x>=11&&x<=14?many:y===1?one:y>=2&&y<=4?few:many);}
function memberCount(c){const bots=c.bots??clubs.find(x=>x.id===c.id)?.bots??0;return plural(c.members,'участник','участника','участников')+(bots?' · '+plural(bots,'бот','бота','ботов'):'');}
function parseRoute(path){
 const routes={'/':'welcome','/feed':'discover','/clubs':'clubs','/players':'members','/guides':'guides','/teams':'lfg','/events':'events','/account':'account','/messages':'direct','/notifications':'notifications','/reports':'reports','/saved':'saved','/drafts':'drafts','/search':'search','/rules':'rules'};
 const clean=path==='/'?path:path.replace(/\/$/,'');if(routes[clean])return {view:routes[clean]};
 const m=/^\/(clubs|posts|players)\/([\w-]{1,80})$/.exec(clean);
 if(!m||(m[1]==='posts'&&!/^\d{1,16}$/.test(m[2])))return null;
 return {view:{clubs:'club',posts:'post',players:'player'}[m[1]],id:m[2]};
}
function applyRoute(route){
 if(!route)return;view=route.view;
 if(view==='club'){selectedClub=route.id;clubTab='posts';}
 if(view==='post'){selectedPost=Number(route.id);selectedComment=null;postReturnView='discover';}
 if(view==='player'){selectedPlayer=route.id;playerReturnView='members';}
}
function routePath(){
 if(view==='notfound')return location.pathname;
 if(view==='club')return '/clubs/'+encodeURIComponent(selectedClub);
 if(view==='post'||view==='editPost')return '/posts/'+selectedPost;
 if(view==='player')return '/players/'+encodeURIComponent(selectedPlayer);
 const paths={welcome:'/',discover:'/feed',clubs:'/clubs',members:'/players',guides:'/guides',lfg:'/teams',events:'/events',account:'/account',direct:'/messages',notifications:'/notifications',reports:'/reports',saved:'/saved',drafts:'/drafts',search:'/search',rules:'/rules'};
 let path=paths[view]||'/';
 if(view==='account'&&authReturn?.view==='club')path+='?return='+encodeURIComponent('/clubs/'+authReturn.id);
 return path;
}
async function beforeRouteChange(){
 const form=document.querySelector('#profile,[data-post-edit-form],[data-guide-edit],[data-guide-create]');
 if(unsavedEditor()&&!confirm('Уйти из редактора? Несохранённые изменения будут потеряны.'))return false;
 try{await composerController?.flush();return true;}catch(e){notify(e.message);return false;}
}
function syncRoute(push=true){
 if(view==='invite')return;const path=routePath();if(path!==location.pathname+location.search){if(push)history.pushState(null,'',path);else history.replaceState(null,'',path);}
}
let metadataRequest=0;
async function updatePageMetadata(){
 const version=++metadataRequest,path=location.pathname;
 try{
  const meta=await api('/api/page-metadata?path='+encodeURIComponent(path));
  if(version!==metadataRequest||path!==location.pathname)return;
  document.title=meta.title+' — Wild Rift Community';
  for(const [selector,value,attribute] of [
   ['meta[name="description"]',meta.description,'content'],['meta[name="robots"]',meta.index?'index,follow':'noindex,nofollow','content'],
   ['meta[property="og:title"]',document.title,'content'],['meta[property="og:description"]',meta.description,'content'],
   ['meta[property="og:url"]',meta.url,'content'],['meta[property="og:type"]',meta.type||'website','content'],['link[rel="canonical"]',meta.url,'href']
  ])document.querySelector(selector)?.setAttribute(attribute,value);
 }catch{}
}
function memberCard(m){
 const labels={baron:'Барон',jungle:'Лес',mid:'Центр',dragon:'Дракон',support:'Поддержка'};
 return '<article class="panel member-card"><div class="member-card-head">'+mediaUI.avatar(m.avatarId,m.name,true)+'<div><h2><a data-route href="/players/'+esc(m.id)+'">'+esc(m.name)+'</a></h2><small>@'+esc(m.handle)+'</small></div></div>'+(m.isBot?'<span class="bot-badge">Бот · демо</span>':'<span class="pill">Участник сообщества</span>')+'<p>'+esc(m.bio||'Игрок Wild Rift')+'</p><div class="role-chips">'+(m.gameProfile?.roles||[]).map(r=>'<span class="pill">'+esc(labels[r])+'</span>').join('')+'</div><a class="btn quiet" data-route href="/players/'+esc(m.id)+'">Посмотреть профиль ↗</a></article>';
}
function peoplePanel(data){
 if(!data)return '';return '<section class="panel people-panel"><div class="section-head"><h2>Люди сообщества</h2><button class="text-link" data-nav="members">Все →</button></div><div class="people-faces">'+data.members.slice(0,6).map(m=>'<a data-route href="/players/'+esc(m.id)+'" class="people-face">'+mediaUI.avatar(m.avatarId,m.name)+'<strong>'+esc(m.name)+'</strong>'+(m.isBot?'<span class="bot-badge">Бот</span>':'')+'</a>').join('')+'</div><p class="note">'+plural(data.total,'открытый профиль','открытых профиля','открытых профилей')+(data.bots?' · '+plural(data.bots,'демонстрационный бот','демонстрационных бота','демонстрационных ботов'):'')+'</p>'+(data.bots?'<p class="demo-disclosure">Боты помогают показать сообщество. Они не участвуют в матчах и не отвечают на сообщения.</p>':'')+'</section>';
}
function rulesPage(){return '<div class="pagehead"><div><span class="tiny-label">НАША КУЛЬТУРА</span><h1>Правила сообщества</h1><p class="muted">За каждым ником — человек. Сохраним место, в которое приятно возвращаться.</p></div></div><section class="panel community-rules"><h2>Уважай свою компанию</h2><p>Обсуждай действия в игре, а не оскорбляй игроков. Травля, угрозы и дискриминация недопустимы.</p><h2>Делись опытом честно</h2><p>Не выдавай себя за другого человека или сотрудника Riot. Указывай, когда материал устарел или содержит личное мнение. Ранг и игровые поля заполняются участниками и не проверяются по данным игры.</p><h2>Береги личные данные</h2><p>Не публикуй чужие контакты, пароли, резервные коды и личную переписку без разрешения. Соблюдай правила своего клуба и избегай спама.</p><h2>Демонстрационные боты</h2><p>Профили с отметкой «Бот» и их публикации созданы для наполнения ранней версии. Это не живые игроки, они не собирают реальные команды и не ведут личные беседы.</p><h2>Сообщить о нарушении</h2><p>Используй кнопку жалобы у сообщения, публикации, комментария или в профиле игрока. Своё обращение и результат можно посмотреть в разделе «Жалобы» после входа.</p><button class="btn quiet" data-nav="reports">Мои обращения →</button></section>';}

async function api(path, method = 'GET', body, options = {}) {
  const headers = {};
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-Community-Request'] = '1'; if (csrf) headers['X-CSRF-Token'] = csrf; }
  const response = await fetch(path, { method, headers, signal: options.signal, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Не удалось выполнить запрос.'); error.status = response.status; throw error; }
  return data;
}
function notify(message) { $('#toast').textContent = message; clearTimeout(window.noticeTimer); window.noticeTimer = setTimeout(() => $('#toast').textContent = '', 5000); }
function formError(form, error) { form.querySelector('.error').textContent = error.message; }
const errorLine = '<p class="error" role="alert"></p>';
function auth() {
  return `<div class="pagehead"><div><h1>Найди своих</h1><p class="muted">${authReturn?.view==='events'?'Войди, чтобы занять роль на игровом вечере и общаться с составом.':authReturn?.view==='lfg'?'Войди, чтобы подать заявку в команду и познакомиться с игроками.':'Вступай в клубы, делись опытом и знакомься с игроками.'}</p></div></div><div class="auth-grid"><form id="login" class="panel"><h2>Вход</h2><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" autocomplete="username"></label><label class="field">Пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label>${errorLine}<button class="btn primary">Войти</button></form><form id="register" class="panel"><h2>Регистрация</h2><label class="field">Имя<input name="name" required maxlength="40" autocomplete="nickname"></label><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username"></label><label class="field">Пароль · от 12 символов<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Создать аккаунт</button><p class="form-note">После регистрации сохрани резервные коды в профиле. Без заранее сохранённого кода восстановить забытый пароль нельзя. Не используй пароль от игры.</p></form></div><details class="panel"><summary>Забыл пароль?</summary><form id="recover"><h2>Восстановление доступа</h2><p class="note">Нужен один из резервных кодов, сохранённых заранее. После смены пароля все прежние сеансы завершатся.</p><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" autocomplete="username"></label><label class="field">Резервный код<input name="code" required maxlength="40" autocomplete="off" spellcheck="false"></label><label class="field">Новый пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Сменить пароль</button></form></details>`;
}
function recoverySettings(remaining) {
  return `<section class="panel"><h2>Восстановление доступа</h2><p class="note">Осталось резервных кодов: <span data-recovery-count>${remaining}</span>. Каждый код заменяет забытый пароль один раз. Сохрани их отдельно от пароля и никому не передавай.</p><form id="recoveryCodes"><label class="field">Текущий пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label><p class="note">Новый набор отменяет все прежние коды. Коды показываются только один раз; сохрани их до ухода с этой страницы. Если ответ потерялся, создай новый набор.</p>${errorLine}<button class="btn primary">Создать новый набор</button><div data-recovery-result></div></form></section>`;
}
function sessionCard(s){return `<article class="comment" data-session-row="${esc(s.id)}"><strong>${s.current?'Текущий сеанс':'Другой сеанс'}</strong><p class="note">Действует до ${esc(new Date(s.expiresAt).toLocaleString('ru-RU'))}</p><button class="btn quiet" data-revoke-session="${esc(s.id)}" data-current-session="${s.current?'1':'0'}">Завершить ${s.current?'этот':'сеанс'}</button></article>`;}
function accountSecurity(data){return `<section class="panel"><h2>Сменить пароль</h2><form id="changePassword"><p class="note">Все прежние сеансы и резервные коды будут отозваны. Этот браузер получит новый сеанс. После смены создай новые резервные коды.</p><label class="field">Текущий пароль<input name="currentPassword" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label><label class="field">Новый пароль<input name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label class="field">Повтори новый пароль<input name="repeatPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Сменить пароль</button></form></section><section class="panel"><h2>Активные сеансы</h2><p class="note">Сервис пока не сохраняет названия устройств. Завершение сеанса отзывает его доступ к аккаунту.</p><div data-session-list>${data.sessions.map(sessionCard).join('')}</div>${data.next?`<button class="btn quiet" data-session-more="${esc(data.next)}">Ещё сеансы</button>`:''}</section>`;}
const initials = name => esc(String(name || 'WR').trim().split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]).join('').toUpperCase());
function clubCard(c) {
  const tone = [...c.id].reduce((sum,x)=>sum+x.charCodeAt(0),0)%4;
  return `<article class="club-card tone-${tone} accent-${esc(c.accent||'azure')}" data-club-card data-search="${esc((c.name+' '+c.description+' '+(c.tags||[]).join(' ')).toLowerCase())}"><div class="club-cover">${c.cover_id?`<img src="/api/media/${esc(c.cover_id)}" alt="Обложка ${esc(c.name)}" loading="lazy">`: ''}<span class="cover-label">${c.isDemoClub?'ДЕМО · ':''}${c.access==='request'?'ПО ЗАЯВКАМ':'ОТКРЫТЫЙ КЛУБ'}</span><span class="club-emblem" aria-hidden="true">${initials(c.name)}</span></div><div class="club-content"><h3>${esc(c.name)}</h3><p>${esc(c.description)||'Место для общения и совместных игр.'}</p><div class="club-card-tags">${(c.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</div><div class="club-activity">${c.lastPost?`<a data-route href="/posts/${c.lastPost.id}">Последнее обсуждение: ${esc(c.lastPost.title)}</a><small>${esc(new Date(c.lastPost.created_at).toLocaleDateString('ru-RU'))}</small>`:c.access==='open'?'<span>Первые обсуждения ещё впереди</span>':'<span>Обсуждения доступны участникам</span>'}</div><div class="member-line"><span>${memberCount(c)}</span>${c.membership?`<span class="membership">${({member:'Ты в клубе',pending:'Заявка отправлена',banned:'Доступ ограничен'})[c.membership]||''}</span>`:''}</div><button class="btn quiet" data-open="${esc(c.id)}">Открыть клуб <span aria-hidden="true">↗</span></button></div></article>`;
}

function shareButton(path,label='Скопировать ссылку'){return '<button type="button" class="text-link share-link" data-share="'+esc(path)+'" aria-label="'+esc(label)+'">↗ Ссылка</button>';}
function postText(p){const chars=Array.from(p.body||''),short=view!=='post'&&chars.length>360;return '<p class="content">'+esc(short?chars.slice(0,360).join('').trimEnd()+'…':p.body)+'</p>'+(short&&!p.guide?'<a class="text-link read-story" data-route href="/posts/'+p.id+'">Читать полностью →</a>':'');}
function starterSteps(){
 if(!user)return '';const ready=Boolean(user.bio?.trim()&&user.gameProfile?.roles?.length),joined=clubs.some(c=>c.membership==='member');if(ready&&joined)return '';
 return '<section class="starter-panel"><div><span class="tiny-label">ПЕРВЫЕ ШАГИ</span><h2>Обустраивайся</h2><p>Пара деталей — и найти свою компанию станет проще.</p></div><div class="starter-steps"><button data-nav="account" class="starter-step '+(ready?'complete':'')+'"><span>'+ (ready?'✓':'01')+'</span><div><strong>Расскажи о себе</strong><small>Описание и любимые роли. Публичность — на твой выбор.</small></div><b aria-hidden="true">↗</b></button><button data-nav="clubs" class="starter-step '+(joined?'complete':'')+'"><span>'+(joined?'✓':'02')+'</span><div><strong>Найди свой клуб</strong><small>Выбери тему и присоединяйся к разговору.</small></div><b aria-hidden="true">↗</b></button></div></section>';
}
function clubSpotlight(){
 const items=clubs.filter(c=>c.access==='open'&&c.membership!=='banned').slice(0,3);if(!items.length)return '';
 return '<section class="club-spotlight"><div class="section-head"><div><span class="tiny-label">ОБЩИЕ ИНТЕРЕСЫ. СВОЯ АТМОСФЕРА.</span><h2>С чего начнётся твоя история?</h2></div><button class="text-link" data-nav="clubs">Все клубы →</button></div><div class="spotlight-rail">'+items.map((c,i)=>'<a data-route href="/clubs/'+esc(c.id)+'" class="spotlight-card accent-'+esc(c.accent||'azure')+'">'+(c.cover_id?'<img src="/api/media/'+esc(c.cover_id)+'" alt="" loading="lazy">':'')+'<span class="spotlight-number">0'+(i+1)+'</span><div class="spotlight-copy"><span class="spotlight-topic">'+esc(c.tags?.[0]||'Общение')+(c.isDemoClub?' · Демо':'')+'</span><h3>'+esc(c.name)+'</h3><p>'+esc(c.description)+'</p><span class="spotlight-bottom">'+memberCount(c)+' <b aria-hidden="true">↗</b></span></div></a>').join('')+'</div></section>';
}
function clubFilterHTML(){
 const tags=clubCatalog.tags;
 return '<section class="club-browser"><div class="club-browser-top"><label class="club-search">Название или интересы<input type="search" id="clubSearch" placeholder="Найди своих" autocomplete="off" value="'+esc(clubFilter.q)+'"></label><label class="field club-sort">Порядок<select id="clubSort"><option value="new" '+(clubFilter.sort==='new'?'selected':'')+'>Сначала новые</option><option value="discussion" '+(clubFilter.sort==='discussion'?'selected':'')+'>По свежим обсуждениям</option><option value="name" '+(clubFilter.sort==='name'?'selected':'')+'>По названию</option></select></label></div><div class="club-scopes" role="group" aria-label="Доступ к клубу">'+[['all','Все клубы'],['open','Открытые'],...(user?[['mine','Мои клубы']]:[])].map(([key,label])=>'<button class="filter-chip" data-club-scope="'+key+'" aria-pressed="'+(clubFilter.scope===key)+'">'+label+'</button>').join('')+'</div><div class="interest-filters" role="group" aria-label="Интересы"><button class="filter-chip" data-club-tag="" aria-pressed="'+!clubFilter.tag+'">Все темы</button>'+tags.map(tag=>'<button class="filter-chip" data-club-tag="'+esc(tag)+'" aria-pressed="'+(clubFilter.tag===tag)+'">'+esc(tag)+'</button>').join('')+'</div><div class="club-filter-summary"><span id="clubResultCount" role="status"></span><button class="text-link" data-club-reset>Сбросить фильтры</button></div></section>';
}
async function applyClubFilters(more=false){
 const grid=document.querySelector('.club-grid');if(!grid||view!=='clubs')return;
 const version=requestVersion,request=++catalogRequest;
 const params=new URLSearchParams(clubFilter);if(more&&clubCatalog.next)params.set('after',clubCatalog.next);
 const button=$('#clubMore');if(button)button.disabled=true;
 try{
  const data=await api('/api/clubs?'+params);if(version!==requestVersion||request!==catalogRequest||view!=='clubs')return;
  clubCatalog={...data,clubs:more?[...clubCatalog.clubs,...data.clubs]:data.clubs};
  for(const c of data.clubs){const i=clubs.findIndex(x=>x.id===c.id);if(i<0)clubs.push(c);else clubs[i]=c;}
  const items=clubCatalog.clubs;
  grid.innerHTML=items.map(clubCard).join('');$('#noClubResults').classList.toggle('hidden',items.length>0);
  $('#clubResultCount').textContent='Показано '+items.length+' из '+data.total+' клубов';
  if(button){button.hidden=!data.next;button.disabled=false;}
  document.querySelectorAll('[data-club-tag]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.clubTag===clubFilter.tag)));
  document.querySelectorAll('[data-club-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.clubScope===clubFilter.scope)));
 }catch(e){if(version===requestVersion&&request===catalogRequest){notify(e.message);if(button)button.disabled=false;}}
}

function clubCards() {
  return `<div class="pagehead"><div><span class="tiny-label">НАЙДИ СВОЙ КРУГ</span><h1>Клубы</h1><p class="muted">Для тех, с кем совпадает настроение на игру.</p></div><span class="count-tag">${plural(clubCatalog.total,'клуб','клуба','клубов')}</span></div>${clubCatalog.total?`${clubFilterHTML()}<div class="club-grid">${clubs.map(clubCard).join('')}</div><button id="clubMore" class="btn quiet wide" data-clubs-more hidden>Ещё клубы</button><div id="noClubResults" class="empty-state hidden"><h2>Пока нет совпадений</h2><p>Попробуй другую тему или название.</p><button class="btn quiet" data-club-reset>Показать все клубы</button></div>`:'<div class="empty-state"><span class="empty-mark" aria-hidden="true">＋</span><h3>Первый клуб может быть твоим</h3><p>Собери друзей или создай место для новых знакомств.</p></div>'}${user?`<form id="createClub" class="panel spaced"><span class="tiny-label">НАЧНИ СВОЮ ИСТОРИЮ</span><h2>Создать клуб</h2><label class="field">Название<input name="name" required minlength="2" maxlength="80" placeholder="Как назовём вашу компанию?"></label><label class="field">Описание<textarea name="description" maxlength="1000" placeholder="Кого ждёте и во что любите играть?"></textarea></label><label class="field">Доступ<select name="access"><option value="open">Открытый — вступление сразу</option><option value="request">По заявкам — посты только участникам</option></select></label>${errorLine}<button class="btn primary">Создать</button></form>`:'<div class="join-strip"><p>Твоя компания может начаться здесь.</p><button class="btn primary" data-nav="account">Присоединиться</button></div>'}`;
}
function profile() {
  const mine=clubs.filter(c=>c.membership==='member');
  return `<div class="pagehead"><div><span class="tiny-label">ТВОЯ ИСТОРИЯ В СООБЩЕСТВЕ</span><h1>Аккаунт</h1></div></div>${sanctionNotice()}${user.profileVisible?shareButton('/players/'+user.id,'Скопировать ссылку на профиль'):''}${mediaUI.showcase(user,true)}<div class="profile-columns">${mediaUI.editor(user,errorLine)}<section class="panel"><span class="tiny-label">ТВОИ ЛЮДИ</span><h2>Мои клубы</h2><button class="btn quiet wide" data-nav="saved">Сохранённые публикации</button><button class="btn quiet wide" data-nav="drafts">Мои черновики</button>${mine.length?mine.map(c=>`<button class="profile-club" data-open="${esc(c.id)}"><span class="avatar">${initials(c.name)}</span><span>${esc(c.name)}</span><span aria-hidden="true">↗</span></button>`).join(''):'<p class="note">Ты ещё не вступил в клуб.</p><button class="btn quiet" data-nav="clubs">Найти клуб</button>'}</section></div><section class="panel"><h3>Сеансы</h3><p class="note">Выход со всех устройств отзывает все текущие сеансы аккаунта.</p><div class="row wrap"><button class="btn quiet" data-logout="/api/logout">Выйти здесь</button><button class="btn quiet" data-logout="/api/logout-all">Выйти везде</button></div></section>`;
}
function feedCard(p) {
  return `<div class="feed-entry"><button class="feed-club" data-open="${esc(p.club_id)}">${esc(p.club_name)} <span aria-hidden="true">↗</span></button>${postHTML(p).replace(`data-comments="${p.id}"`,()=>`data-comment-club="${esc(p.club_id)}" data-comments="${p.id}"`)}</div>`;
}
function feedSection(feed) {
 return `<section class="community-feed"><div class="section-head"><div><span class="tiny-label">РАЗГОВОРЫ МЕЖДУ МАТЧАМИ</span><h2>Свежие обсуждения</h2></div><div class="feed-tools"><button class="text-link" data-search-open aria-label="Поиск обсуждений">Поиск ↗</button><button class="text-link" data-guide-catalog>Руководства →</button></div></div><div id="feedPosts">${feed.posts.map(feedCard).join('')||'<div class="empty-state feed-empty"><span class="empty-mark" aria-hidden="true">✦</span><h3>Как прошёл твой последний матч?</h3><p>Расскажи о красивом моменте, спроси совет или познакомься с игроками в клубе.</p><button class="btn quiet" data-nav="clubs">Найти свой клуб</button></div>'}</div>${feed.next?`<button class="btn quiet wide" data-feed-more="${feed.next}">Ещё обсуждения</button>`:''}</section>`;
}
function discoverPage(feed,home,homeError,people) {
 if(user)return personalHome(feed,home,homeError,people);
 const featured=feed.posts[0];
 const featuredHTML=featured?`<a class="hero-conversation" data-route href="/posts/${esc(featured.id)}"><span class="hero-conversation-label">Из свежих обсуждений</span><div class="hero-conversation-author">${mediaUI.avatar(featured.author_avatar_id,featured.author_name)}<span><strong>${esc(featured.author_name)}</strong><small>${esc(featured.club_name)}</small></span>${featured.isBot?'<span class="bot-badge">Бот · демо</span>':''}</div><h2>${esc(featured.title)}</h2><span class="hero-conversation-action">Читать обсуждение</span></a>`:'';
 return `<section class="welcome-hero community-hero community-home-header"><div class="hero-copy"><span class="tiny-label"><span class="gold-dot" aria-hidden="true"></span> Сообщество Wild Rift</span><h1>Своя компания.<br>Твоя игра.</h1><p>Люди, разговоры и вечера в Рифте.</p><div class="row wrap"><button class="btn primary" data-nav="clubs">Найти свой клуб <span aria-hidden="true">↗</span></button><button class="text-link hero-link" data-nav="account">Войти в сообщество</button></div></div>${featuredHTML}</section><div class="community-paths"><button data-nav="clubs"><span class="path-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/></svg></span><span><strong>Свой круг</strong><small>Клубы по интересам</small></span><span aria-hidden="true">↗</span></button><button data-nav="guides"><span class="path-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/></svg></span><span><strong>Опыт игроков</strong><small>Руководства и советы</small></span><span aria-hidden="true">↗</span></button><button data-nav="lfg"><span class="path-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 6h8c3 0 4 3 5 8l1 4c0 2-2 3-4 1l-3-3H9l-3 3c-2 2-4 1-4-1l1-4c1-5 2-8 5-8Z"/><path d="M7 9v5m-2-2h5"/><circle cx="17" cy="11" r="1"/></svg></span><span><strong>Игра вместе</strong><small>Компания на следующий матч</small></span><span aria-hidden="true">↗</span></button></div><div class="discovery-grid">${feedSection(feed)}<aside class="discovery-aside">${peoplePanel(people)}<section class="panel discovery-clubs"><div class="section-head"><div><span class="tiny-label">МЕСТО ДЛЯ СВОИХ</span><h2>Открой для себя</h2></div></div>${clubs.slice(0,3).map(c=>`<button class="discovery-club accent-${esc(c.accent||'azure')}" data-open="${esc(c.id)}"><span class="discovery-cover">${c.cover_id?`<img src="/api/media/${esc(c.cover_id)}" alt="" loading="lazy">`:initials(c.name)}</span><span class="discovery-club-copy"><strong>${esc(c.name)} ${c.isDemoClub?'<span class="bot-badge">Демо</span>':''}</strong><small>${esc(c.description)||'Общение и совместные игры'}</small><span>${memberCount(c)} · ${c.access==='open'?'Открытый клуб':'По заявкам'}</span></span><span aria-hidden="true">↗</span></button>`).join('')||'<div class="home-empty"><p>Здесь появятся клубы игроков. Твой может стать первым.</p></div>'}<button class="text-link" data-nav="clubs">Посмотреть все клубы →</button></section><section class="panel gathering"><span class="tiny-label">ВСТРЕЧАЕМСЯ В РИФТЕ</span><h3>Есть место для тебя</h3><p>Найди компанию на матч или запланируй игровой вечер.</p><div class="row wrap"><button class="btn quiet" data-nav="lfg">Команды ↗</button><button class="text-link" data-nav="events">События →</button></div></section><p class="community-note">Хороший матч заканчивается.<br>Хорошая компания остаётся.</p></aside></div>${clubSpotlight()}`;
}
function announcementPreview(data,kind) {
 const events=kind==='events',items=events?data.events:data.groups;
 const modes={ranked:'Ранкед',normal:'Обычная',aram:'ARAM',custom:'Своя игра'},roles={any:'Любая роль',baron:'Барон',jungle:'Лес',mid:'Центр',dragon:'Дракон',support:'Поддержка'};
 return `<div class="pagehead"><div><span class="tiny-label">ИГРАЕМ ВМЕСТЕ</span><h1>${events?'Игровые вечера':'Найти команду'}</h1><p class="muted">${events?'Выбери встречу и проведи вечер со своими.':'Найди компанию под свой режим и настроение.'}</p></div></div><div class="preview-grid">${items.map(g=>`<article class="panel announcement-card"><div class="row wrap"><span class="pill">${esc(modes[g.mode])}</span><span class="preview-spaces">${g.available?'Свободных мест: '+g.available:'Состав собран'}</span></div><h2>${esc(g.title)}</h2><p class="note">${esc(g.region)} · ${esc(g.language)}${g.role?' · '+esc(roles[g.role]):''}</p><p class="announcement-date">${esc(new Date(g.starts_at).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}))}</p><button class="btn primary" data-preview-join="${g.id}" data-preview-kind="${kind}">Войти и посмотреть →</button></article>`).join('')||`<section class="empty-state"><span class="empty-mark" aria-hidden="true">✦</span><h2>${events?'Первый вечер может быть твоим':'Сейчас нет открытых команд'}</h2><p>${events?'Запланируй игру, выбери роли и пригласи компанию.':'Создай свою группу или познакомься с игроками в клубах.'}</p><div class="row wrap"><button class="btn primary" data-preview-start="${kind}">${events?'Организовать вечер':'Собрать команду'}</button><button class="btn quiet" data-nav="clubs">К клубам</button></div></section>`}</div><p class="preview-note">Объявления доступны для просмотра. Для участия нужен аккаунт; чаты доступны участникам команды.</p>`;
}
function personalHome(feed,home,homeError,people){
 const modes={ranked:'Ранкед',normal:'Обычная',aram:'ARAM',custom:'Своя игра'},roles={baron:'Барон',jungle:'Лес',mid:'Центр',dragon:'Дракон',support:'Поддержка',any:'Любая роль'};
 const date=ms=>esc(new Date(ms).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
 const p=home?.preferences||{},reasons=[p.region&&'регион: '+p.region,p.language&&'язык: '+p.language,p.roles?.length&&'роли: '+p.roles.map(r=>roles[r]).join(', '),p.rank&&'ранг: '+p.rank,p.microphone==='no'&&'без обязательного голоса'].filter(Boolean);
 const groupCard=(g,mine=false)=>`<article class="home-game"><div class="row wrap"><span class="pill">${esc(modes[g.mode])}</span><span class="pill">${mine?(g.membership==='pending'?'Заявка отправлена':'Ты в группе'):g.capacity-g.members+' свободных мест'}</span></div><h3>${esc(g.title)}</h3><p class="note">${esc(g.region)} · ${esc(g.language)} · ${esc(roles[g.role])}</p><p class="note">${date(g.starts_at)} · ${esc(g.rank||'Любой ранг')}</p><button class="btn quiet wide" data-home-group="${g.id}">${mine?'Открыть группу':'Посмотреть группу'} →</button></article>`;
 return `<section class="welcome-hero home-welcome community-home-header"><div class="hero-copy"><span class="tiny-label">ТВОЁ ПРОСТРАНСТВО</span><h1>С возвращением,<br>${esc(user.name)}</h1><p>Ваши встречи, команды и разговоры — здесь.</p><div class="row wrap">${home?.myClubs.length?`<button class="btn primary" data-home-compose="${esc(home.myClubs[0].id)}">Написать публикацию</button>`:'<button class="btn primary" data-nav="clubs">Найти свой клуб</button>'}<button class="btn quiet" data-home-create-event>Запланировать вечер</button><button class="btn quiet" data-home-create-group>Собрать группу</button></div></div><div class="rift-art" aria-hidden="true"><i></i><i></i><i></i><span>WR</span></div></section>${starterSteps()}${feedSection(feed)}${peoplePanel(people)}${homeError?`<section class="panel" role="alert"><p>Личные разделы сейчас не загрузились. Обсуждения доступны ниже.</p><button class="btn quiet" data-nav="discover">Повторить загрузку</button></section>`:''}${home?`<section class="home-clubs"><div class="section-head"><h2>Мои клубы <span class="count-tag">${home.clubCount}</span></h2><button class="text-link" data-nav="account">Все мои клубы →</button></div><div class="home-club-grid">${home.myClubs.map(c=>`<button class="profile-club panel accent-${esc(c.accent)}" data-open="${esc(c.id)}"><span class="avatar">${initials(c.name)}</span><span>${esc(c.name)}<small>${memberCount(c)}</small></span><span aria-hidden="true">↗</span></button>`).join('')||'<div class="empty-state"><p>Вступи в клуб, чтобы его обсуждения и быстрый редактор появились здесь.</p><button class="btn quiet" data-nav="clubs">Выбрать клуб</button></div>'}</div></section><section class="home-plans panel"><div class="section-head"><div><span class="tiny-label">ВАШ СЛЕДУЮЩИЙ МАТЧ</span><h2>Мои игровые вечера</h2></div><button class="text-link" data-nav="events">Все события →</button></div><div class="home-game-grid">${home.events.map(e=>`<article class="home-game"><span class="pill">${e.starts_at<=home.generatedAt?'Уже началось':'Запланировано'} · ${esc(modes[e.mode])}</span><h3>${esc(e.title)}</h3><p class="home-date">${date(e.starts_at)}</p><p class="note">Твоё время · ${esc(roles[e.myRole])} · состав ${e.members}/${e.capacity}</p><button class="btn quiet wide" data-home-event="${e.id}">К составу и чату →</button></article>`).join('')||'<div class="home-empty"><p>Пока нет запланированных игр. Организуй вечер и выбери роли для состава.</p><button class="btn quiet" data-home-create-event>Создать событие</button></div>'}</div></section>${home.myGroups.length?`<section class="panel"><div class="section-head"><h2>Мои группы и заявки</h2><button class="text-link" data-nav="lfg">Все группы →</button></div><div class="home-game-grid">${home.myGroups.map(g=>groupCard(g,true)).join('')}</div></section>`:''}<section class="panel home-matches"><div class="section-head"><div><span class="tiny-label">ИГРОКИ ИЩУТ КОМПАНИЮ</span><h2>${reasons.length?'Подходящие группы':'Свободные группы'}</h2></div><button class="text-link" data-nav="lfg">Весь поиск →</button></div><p class="note">${reasons.length?'По твоему профилю — '+esc(reasons.join(' · '))+'.':'Заполни игровой профиль, чтобы подбирать группы по региону, языку и ролям.'} Поля указаны игроками; совместимость очереди не проверяется.</p><div class="home-game-grid">${home.groups.map(g=>groupCard(g)).join('')||'<div class="home-empty"><p>Сейчас нет подходящих групп со свободными местами.</p><div class="row wrap"><button class="btn quiet" data-nav="lfg">Искать вручную</button><button class="btn quiet" data-home-create-group>Создать свою</button></div></div>'}</div><button class="text-link" data-nav="account">Изменить игровой профиль →</button></section>`:''}`;
}
function postHTML(p) {
  const member=clubs.some(c=>c.id===p.club_id&&c.membership==='member');
  return `<article class="panel ${p.guide?`guide-post ${view==='post'?'guide-expanded':''}`:''}"><div class="post-author">${mediaUI.avatar(p.author_avatar_id,p.author_name)}<div><button type="button" class="author-link" data-player="${esc(p.author_id)}">${esc(p.author_name)}</button> ${p.isBot?'<span class="bot-badge">Бот</span>':''}<small>${esc(new Date(p.created_at).toLocaleString('ru-RU'))}${p.edited_at?` · <span title="${esc(new Date(p.edited_at).toLocaleString('ru-RU'))}">Изменено</span>`:''}</small></div></div>${guideUI?.badge(p.guide)||''}<${view==='post'?'h1':'h3'} class="post-title"><a data-route href="/posts/${p.id}">${esc(p.title)}</a></${view==='post'?'h1':'h3'}>${p.isBot?'<p class="demo-disclosure">Демонстрационная публикация бота. Обсуждение открыто участникам клуба.</p>':''}${postText(p)}${p.guide&&view!=='post'?`<button class="btn quiet" data-guide-open="${p.id}">Читать руководство →</button>`:''}${mediaUI.image(p.image_id,'Изображение к публикации: '+p.title)}${pollUI?.card(p,user,member)||''}<div class="post-utilities">${shareButton('/posts/'+p.id,'Скопировать ссылку на публикацию')}${p.body.length>600?`<span class="reading-time">~${Math.max(1,Math.ceil(p.body.trim().split(/\s+/).length/180))} мин чтения</span>`:''}</div>${discussionUI.actions(p,user,member)}${view==='club'?clubUI.postTools(p,clubs.find(c=>c.id===p.club_id),clubPins.has(p.id),user):''}<div id="comments-${p.id}"></div></article>`;
}
function welcomeEntry(){return (user?'<p class="launch-greeting">С возвращением, <strong>'+esc(user.name)+'</strong></p><div class="launch-actions"><button class="launch-primary" data-nav="discover">Продолжить <span aria-hidden="true">↗</span></button><button class="launch-secondary" data-nav="clubs">Посмотреть клубы</button></div>':'<div class="launch-actions"><button class="launch-primary" data-auth-mode="register">Создать аккаунт <span aria-hidden="true">↗</span></button><button class="launch-secondary" data-auth-mode="login">Уже есть аккаунт? Войти</button></div><div class="launch-browse-row"><button class="launch-browse" data-nav="discover">Посмотреть без регистрации</button><button class="launch-browse" data-nav="clubs">Открытые клубы</button></div>');}
function welcomePage(){
 const art = [
  '<div class="launch-visual launch-visual-community"><div class="launch-ticket"><span class="launch-ticket-label">WILD RIFT</span><strong>Здесь игра<br>объединяет.</strong><span class="launch-ticket-foot">ТВОЁ СООБЩЕСТВО</span></div><div class="launch-mini launch-mini-a"><span class="launch-mini-icon">↗</span><span>Игра вместе</span></div><div class="launch-mini launch-mini-b"><span class="launch-mini-icon">≋</span><span>Свои люди</span></div></div>',
  '<div class="launch-visual launch-visual-team"><div class="launch-team-board"><span class="launch-ticket-label">НАЙДИ СВОЮ РОЛЬ</span><div class="launch-role-map"><span>Барон</span><span>Лес</span><span>Центр</span><span>Дракон</span><span>Поддержка</span></div><div class="launch-board-foot"><span>Регион</span><span>Язык</span><span>Роли</span></div></div><span class="launch-art-caption">КОМПАНИЯ ДЛЯ СЛЕДУЮЩЕГО МАТЧА</span></div>',
  '<div class="launch-visual launch-visual-clubs"><div class="launch-club-sheet launch-club-sheet-back"><span>ОБСУЖДЕНИЯ</span></div><div class="launch-club-sheet"><span class="launch-ticket-label">ТВОИ ИНТЕРЕСЫ</span><strong>Один клуб.<br>Много общего.</strong><div class="launch-sheet-lines"><span>Публикации</span><span>Общий чат</span><span>Правила клуба</span></div></div></div>',
  '<div class="launch-visual launch-visual-join"><span class="launch-join-symbol">W</span><div class="launch-join-word">Играй.<br>Общайся.<br><em>Оставайся.</em></div><span class="launch-art-caption">ТВОЁ МЕСТО МЕЖДУ МАТЧАМИ</span></div>'
 ];
 const cards = [
  ['ЗНАКОМИМСЯ','Твой Рифт.<br><em>Твои люди.</em>','Независимое сообщество игроков Wild Rift. Здесь находят напарников, вступают в клубы и обсуждают игру.'],
  ['ИГРАЕМ ВМЕСТЕ','Следующий матч.<br><em>Своя команда.</em>','Ищи компанию по региону, языку и игровым ролям. Создавай группу или подавай заявку в подходящую.'],
  ['НАХОДИМ СВОИХ','Твои интересы.<br><em>Твой клуб.</em>','Вступай в клубы, читай публикации и общайся в общем чате. Делись опытом и знакомься с другими игроками.'],
  ['ОСТАЁМСЯ НА СВЯЗИ','Больше, чем<br><em>один матч.</em>','Создай аккаунт, чтобы участвовать в сообществе. Или сначала посмотри открытые клубы и обсуждения без регистрации.']
 ];
 return '<section class="launch" aria-labelledby="launch-title"><header class="launch-header"><a class="launch-brand" href="/" aria-label="Wild Rift Community — начало"><span class="launch-brand-mark" aria-hidden="true">W</span><span>WILD RIFT<small>COMMUNITY</small></span></a><span class="launch-status">ИГРА ОБЪЕДИНЯЕТ</span></header><div class="launch-intro"><span>Твоё место между матчами</span><span class="launch-swipe-hint">Листай и знакомься <span aria-hidden="true">→</span></span></div><div class="launch-track" data-launch-track tabindex="0" role="region" aria-roledescription="карусель" aria-label="Знакомство с сообществом">'+cards.map((c,i)=>'<article class="launch-card launch-card-'+i+'" data-launch-card="'+i+'" role="group" aria-roledescription="карточка" aria-label="'+(i+1)+' из 4"'+(i?' aria-hidden="true"':'')+'><div class="launch-art" aria-hidden="true">'+art[i]+'</div><div class="launch-copy"><span class="launch-eyebrow">'+c[0]+'</span><'+(i?'h2':'h1 id="launch-title"')+'>'+c[1]+'</'+(i?'h2':'h1')+'><p class="launch-description">'+c[2]+'</p><span class="launch-card-number" aria-hidden="true">0'+(i+1)+' / 04</span></div></article>').join('')+'</div><div class="launch-controls"><button class="launch-arrow" data-launch-prev aria-label="Предыдущая карточка" disabled>←</button><div class="launch-steps" aria-label="Выбрать карточку">'+cards.map((c,i)=>'<button data-launch-step="'+i+'" aria-label="Карточка '+(i+1)+': '+['О сообществе','Поиск команды','Клубы','Присоединение'][i]+'"'+(i?'':' aria-current="step"')+'><span></span></button>').join('')+'</div><button class="launch-next" data-launch-next>Далее <span aria-hidden="true">→</span></button></div><p class="launch-progress" data-launch-progress role="status" aria-live="polite" aria-atomic="true">Карточка 1 из 4: О сообществе</p><div class="launch-entry">'+welcomeEntry()+'</div><footer class="launch-footer"><span>Независимое сообщество. Не связано с Riot Games.</span><button data-nav="rules">Правила сообщества ↗</button></footer></section>';
}
function createWelcomeCarousel(){
 const root=document.querySelector('.launch'),track=root?.querySelector('[data-launch-track]');
 if(!track)return null;
 const cards=[...root.querySelectorAll('[data-launch-card]')],steps=[...root.querySelectorAll('[data-launch-step]')];
 const previous=root.querySelector('[data-launch-prev]'),next=root.querySelector('[data-launch-next]');
 const names=['О сообществе','Поиск команды','Клубы','Присоединение'];
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 let current=0,frame=null,destination=null,settleTimer=null;
 function select(index,scroll=true){
  current=Math.max(0,Math.min(cards.length-1,index));
  steps.forEach((step,i)=>{if(i===current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
  cards.forEach((card,i)=>{if(i===current)card.removeAttribute('aria-hidden');else card.setAttribute('aria-hidden','true');});
  const nextFocused=document.activeElement===next;
  previous.disabled=current===0;next.hidden=current===cards.length-1;
  if(next.hidden&&nextFocused)track.focus({preventScroll:true});
  root.querySelector('[data-launch-progress]').textContent='Карточка '+(current+1)+' из '+cards.length+': '+names[current];
  if(scroll){
   destination=current;
   const padding=parseFloat(window.getComputedStyle(track).paddingLeft)||0;
   const left=track.scrollLeft+cards[current].getBoundingClientRect().left-track.getBoundingClientRect().left-padding;
   track.scrollTo?.({left,behavior:reduced()?'instant':'smooth'});
  }
 }
 function click(event){
  const step=event.target.closest('[data-launch-step]');if(step){select(Number(step.dataset.launchStep));return;}
  if(event.target.closest('[data-launch-next]'))select(current+1);
  if(event.target.closest('[data-launch-prev]'))select(current-1);
 }
 function key(event){
  const directions={ArrowRight:current+1,ArrowLeft:current-1,Home:0,End:cards.length-1};
  if(!(event.key in directions))return;event.preventDefault();select(directions[event.key]);
 }
 function syncPosition(){
  const edge=track.getBoundingClientRect().left+(parseFloat(window.getComputedStyle(track).paddingLeft)||0);
  let nearest=0;cards.forEach((card,i)=>{if(Math.abs(card.getBoundingClientRect().left-edge)<Math.abs(cards[nearest].getBoundingClientRect().left-edge))nearest=i;});
  if(destination!==null&&nearest!==destination)return;
  destination=null;if(nearest!==current)select(nearest,false);
 }
 function scrolled(){
  clearTimeout(settleTimer);settleTimer=setTimeout(()=>{destination=null;syncPosition();},150);
  if(frame!==null)return;
  frame=window.requestAnimationFrame(()=>{
   frame=null;
   syncPosition();
  });
 }
 root.addEventListener('click',click);track.addEventListener('keydown',key);track.addEventListener('scroll',scrolled,{passive:true});
 select(0,false);
 return {destroy(){root.removeEventListener('click',click);track.removeEventListener('keydown',key);track.removeEventListener('scroll',scrolled);clearTimeout(settleTimer);if(frame!==null)window.cancelAnimationFrame(frame);}};
}
async function render(options={}) {
  const menu=$('.section-menu');if(menu)menu.open=false;
  const nextRoute=routePath(),routeChanged=renderedRoute!==null&&renderedRoute!==nextRoute;
  document.body.classList.toggle('launch-mode',view==='welcome');
  syncRoute(options.history!==false);
  updatePageMetadata();
  welcomeController?.destroy();welcomeController=null;
  composerController?.destroy();composerController=null;
  mediaUI.cleanup();
  chatController?.destroy(); chatController = null;
  const version = ++requestVersion;
  const activeNav={discover:'discover',clubs:'home',members:'people',club:'home',player:'people',account:'account',direct:'direct',reports:'reports',lfg:'lfg',events:'events',drafts:'account',saved:'account',notifications:'notifications',post:'discover',editPost:'discover',search:'discover',guides:'discover',invite:'home'}[view];
  for(const button of document.querySelectorAll('.primary-nav button, #reports, #notifications')){if(button.id===activeNav)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  for(const button of document.querySelectorAll('.section-menu [data-nav]')){if(button.dataset.nav===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  $('#main').setAttribute('aria-busy','true');
  if(view==='notfound'){
    $('#main').innerHTML='<section class="panel"><h1>Страница не найдена</h1><p>Проверь ссылку или вернись на главную.</p><button class="btn quiet" data-nav="discover">На главную</button></section>';
    $('#main').setAttribute('aria-busy','false');renderedRoute=nextRoute;return;
  }
  if(view==='welcome'){$('#main').innerHTML=welcomePage();welcomeController=createWelcomeCarousel();}
  else $('#main').innerHTML='<div class=loading-state role=status>Загружаем сообщество…<div class=skeleton-page aria-hidden=true><div></div><div></div><div></div></div></div>';
  try {
    const session = await api('/api/me');
    if (version !== requestVersion) return;
    if(user?.id!==session.user?.id){lfgState={};eventState={};clubFilter={q:'',tag:'',scope:'all',sort:'new'};directDraftHandle='';composerUI?.reset();searchState={query:'',club:''};guideState={};}
    user = session.user; csrf = session.csrf; sanction = session.sanction || null;
    if(view==='welcome'){document.body.classList.toggle('guest',!user);const entry=$('.launch-entry'),markup=welcomeEntry();if(entry.innerHTML!==markup)entry.innerHTML=markup;return;}
    const result = await api('/api/clubs');
    if (version !== requestVersion) return;
    clubCatalog=result;clubs=result.clubs;
    if(user){let after=null;do{const mine=await api('/api/clubs?scope=mine'+(after?'&after='+encodeURIComponent(after):''));if(version!==requestVersion)return;
      for(const c of mine.clubs){const i=clubs.findIndex(x=>x.id===c.id);if(i<0)clubs.push(c);else clubs[i]=c;}after=mine.next;
    }while(after);}
    $('#account').textContent = 'Профиль';
    $('#account').setAttribute('aria-label',user?'Профиль':'Профиль · вход и регистрация');
    document.body.classList.toggle('guest',!user);
    $('#notifications').hidden=!user;$('#reports').hidden=!user;
    $('#guestJoin').hidden=!!user;
    const quick=document.querySelector('#quickCreate');if(quick){quick.hidden=!user;const mine=clubs.find(c=>c.id===selectedClub&&c.membership==='member')||clubs.find(c=>c.membership==='member');delete quick.dataset.homeCompose;delete quick.dataset.nav;if(mine)quick.dataset.homeCompose=mine.id;else quick.dataset.nav='clubs';}
    $('#account').dataset.handle=user?.handle||'';
    $('#account').title=user?user.name:'Вход и регистрация';
    if(view==='invite'){
      if(!user){$('#main').innerHTML=`<section class="panel"><h2>Тебя пригласили в клуб</h2><p>Войди или зарегистрируйся, чтобы проверить приглашение и правила клуба.</p><button class="text-link" data-invite-dismiss>К клубам</button></section>${auth()}`;return;}
      const data=await api('/api/club-invites/preview','POST',{token:inviteToken});if(version!==requestVersion)return;const c=data.club;
      $('#main').innerHTML=`<section class="panel invite-preview accent-${esc(c.accent)}"><span class="tiny-label">ИГРАЙТЕ ВМЕСТЕ</span><h1>${esc(c.name)}</h1><p>${esc(c.description)}</p>${clubUI.about(c,user?.id)}<p class="note">${c.access==='request'?'После заявки нужно дождаться принятия. Ссылка не открывает содержимое клуба.':'Вступление сразу.'}</p><div class="row wrap"><button class="btn primary" data-invite-accept>${c.membership==='member'?'Открыть клуб':c.membership==='pending'?'Открыть заявку':c.access==='request'?'Подать заявку':'Вступить в клуб'}</button><button class="btn quiet" data-invite-dismiss>К клубам</button></div></section>`;return;
    }
    if(view==='drafts'){
      if(!user){$('#main').innerHTML=auth();return;}const data=await api('/api/drafts');if(version!==requestVersion||data.viewerId!==user.id)return;
      $('#main').innerHTML=`<div class="pagehead"><div><h1>Мои черновики</h1><p class="note">Видны только тебе. Для публикации нужно оставаться участником клуба.</p></div></div>${data.drafts.map(d=>`<article class="panel"><span class="tiny-label">${esc(d.club_name)}</span><h3>${esc(d.title)||'Без заголовка'}</h3><p class="note">${esc(new Date(d.updated_at).toLocaleString('ru-RU'))}</p><button class="btn quiet" data-home-compose="${esc(d.club_id)}">Продолжить публикацию →</button></article>`).join('')||'<div class="empty-state"><h3>Черновиков пока нет</h3><p>Начни публикацию в своём клубе — редактор сохранит её для продолжения.</p><button class="btn quiet" data-nav="clubs">К клубам</button></div>'}`;return;
    }
    if(view==='saved'){
      if(!user){$('#main').innerHTML=auth();return;}
      const data=await api('/api/saved');if(version!==requestVersion||data.viewerId!==user.id)return;
      $('#main').innerHTML=`<div class="pagehead"><div><span class="tiny-label">ВЕРНУТЬСЯ К ВАЖНОМУ</span><h1>Сохранённое</h1><p class="muted">Доступные тебе публикации, от новых к старым.</p></div></div><div id="savedPosts">${data.posts.map(feedCard).join('')||'<div class="empty-state"><h3>Сохрани то, к чему хочется вернуться</h3><p>Нажми «Сохранить» под публикацией. Закрытый контент появляется здесь только пока у тебя есть доступ.</p><button class="btn quiet" data-nav="discover">К обсуждениям</button></div>'}</div>${data.next?`<button class="btn quiet wide" data-saved-more="${data.next}">Ещё сохранённые</button>`:''}`;return;
    }
    if(view==='notifications'){
      if(!user){$('#main').innerHTML=auth();return;}
      const data=await api('/api/discussions/notifications');if(version!==requestVersion||data.viewerId!==user.id)return;
      $('#main').innerHTML=`<div class="pagehead"><div><span class="tiny-label">РАЗГОВОР ПРОДОЛЖАЕТСЯ</span><h1>Ответы и упоминания</h1><p class="muted">События в доступных обсуждениях.</p></div></div><div id="discussionEvents">${data.notifications.map(discussionUI.notification).join('')||'<div class="empty-state"><h3>Пока тихо</h3><p>Здесь появятся ответы на твои комментарии и упоминания через @логин.</p></div>'}</div>${data.next?`<button class="btn quiet" data-discussion-more="${data.next}">Ранее</button>`:''}`;return;
    }
    if(view==='members'){
      const data=await api('/api/community-members?'+new URLSearchParams(memberState));if(version!==requestVersion||data.viewerId!==(user?.id||null))return;
      $('#main').innerHTML='<div class="pagehead"><div><span class="tiny-label">НАЙДИ СВОЙ КРУГ</span><h1>Люди сообщества</h1><p class="muted">Знакомься с участниками через их открытые профили и интересы.</p></div></div><form class="panel members-filter" data-members-filter><label class="field">Имя или логин<input type="search" name="q" maxlength="80" value="'+esc(memberState.q)+'" placeholder="Кого ищешь?"></label><label class="field">Роль<select name="role"><option value="">Все роли</option>'+Object.entries({baron:'Барон',jungle:'Лес',mid:'Центр',dragon:'Дракон',support:'Поддержка'}).map(([k,v])=>'<option value="'+k+'" '+(memberState.role===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><button class="btn primary">Найти</button></form><p class="note">'+plural(data.total,'открытый профиль','открытых профиля','открытых профилей')+(data.bots?' · '+plural(data.bots,'бот','бота','ботов'):'')+'</p>'+(data.bots?'<p class="demo-disclosure">Демонстрационные профили отмечены как боты. Они не играют матчи и не отвечают на сообщения.</p>':'')+'<div class="members-grid" id="communityMembers">'+(data.members.map(memberCard).join('')||'<div class="empty-state"><h2>Пока никого не нашли</h2><p>Попробуй другое имя или роль. В каталоге появляются только опубликованные профили.</p></div>')+'</div>'+(data.next?'<button class="btn quiet wide" data-members-more="'+esc(data.next)+'">Ещё участники</button>':'');return;
    }
    if(view==='rules'){$('#main').innerHTML=rulesPage();return;}
    if(view==='guides'){
      const params=new URLSearchParams(guideState),data=await api('/api/guides?'+params);if(version!==requestVersion||data.viewerId!==(user?.id||null))return;
      $('#main').innerHTML=`<button class="back-link" data-nav="discover">← На главную</button><div class="pagehead"><div><span class="tiny-label">ОПЫТ СООБЩЕСТВА</span><h1>Руководства игроков</h1><p class="note">Версии и игровые сведения указаны авторами. Выбирай материал под свою версию игры.</p></div></div>${guideUI.filters(guideState,clubs.filter(c=>c.membership!=='banned'&&(c.access==='open'||c.membership==='member')))}<div id="guidePosts">${data.posts.map(feedCard).join('')||`<section class="empty-state"><h3>${Object.values(guideState).some(Boolean)?'По этим условиям ничего не найдено':'Здесь будет опыт сообщества'}</h3><p>${Object.values(guideState).some(Boolean)?'Попробуй другую тему или сбрось фильтры.':'Поделись своим знанием чемпиона, роли или игры в руководстве для своего клуба.'}</p><button class="btn quiet" data-nav="clubs">К клубам</button></section>`}</div>${data.next?`<button class="btn quiet wide" data-guide-more="${data.next}">Ещё руководства</button>`:''}`;return;
    }
    if(view==='search'){
      const club=clubs.find(c=>c.id===searchState.club),params=new URLSearchParams({q:searchState.query});if(searchState.club)params.set('club',searchState.club);
      const data=searchState.query?await api('/api/posts/search?'+params):null;if(version!==requestVersion||data&&data.viewerId!==(user?.id||null))return;
      $('#main').innerHTML=`<button class="back-link" data-nav="discover">← На главную</button><div class="pagehead"><h1>Найди обсуждение</h1></div>${postManagement.searchForm(searchState.query,club,clubs.filter(c=>c.membership!=='banned'&&(c.access==='open'||c.membership==='member')))}<p role="status">${data?data.posts.length?'Найденные обсуждения, от новых к старым.':'Ничего не найдено. Попробуй другую фразу.':'Введи фразу для поиска.'}</p><div id="searchPosts">${data?.posts.map(feedCard).join('')||''}</div>${data?.next?`<button class="btn quiet wide" data-search-more="${data.next}">Ещё результаты</button>`:''}`;return;
    }
    if(view==='editPost'){
      const data=await api('/api/posts/'+selectedPost);if(version!==requestVersion)return;
      if(data.post.author_id!==user?.id||!clubs.some(c=>c.id===data.post.club_id&&c.membership==='member'))throw Error('Редактирование недоступно.');
      $('#main').innerHTML=data.post.guide?guideUI.editor(null,data.post):postManagement.editor(data.post);$('[data-post-edit-form] input,[data-guide-edit] input')?.focus();return;
    }
    if(view==='post'){
      const data=await api('/api/posts/'+selectedPost);if(version!==requestVersion)return;
      selectedClub=data.post.club_id;$('#main').innerHTML=`<button class="back-link" data-nav="${postReturnView}">← ${({club:'К клубу',search:'К результатам поиска',discover:'На главную',saved:'К сохранённому',guides:'К руководствам'})[postReturnView]||'Ответы и упоминания'}</button>${postHTML(data.post)}`;await comments(selectedPost,selectedComment);return;
    }
    if(view==='discover'){
      const [feed,home,people]=await Promise.all([api('/api/feed'),user?api('/api/home').then(data=>({data})).catch(error=>({error})):null,api('/api/community-members')]);
      if(version!==requestVersion)return;if(home?.data&&home.data.viewerId!==user.id)throw Error('Сеанс изменился. Обнови страницу.');
      $('#main').innerHTML=discoverPage(feed,home?.data,home?.error,people);return;
    }
    if(!user&&['events','lfg'].includes(view)){const data=await api('/api/community-preview');if(version!==requestVersion)return;$('#main').innerHTML=announcementPreview(data,view);return;}
    if(view==='events'){$('#main').innerHTML=user?'<section id=eventsRoot></section>':auth();if(user)chatController=window.createEvents({root:$('#eventsRoot'),user,api,state:eventState});return;}
    if(view==='lfg'){$('#main').innerHTML=user?'<section id=lfgRoot></section>':auth();if(user)chatController=window.createLfg({root:$('#lfgRoot'),user,api,state:lfgState});return;}
    if (view === 'reports') {
      if(!user){$('#main').innerHTML=auth();return;}
      const mine=await api('/api/reports');
      const queue=user.isModerator?await api('/api/moderation/reports'):null;
      if(version!==requestVersion)return;
      $('#main').innerHTML=`<h1>Жалобы</h1><p class="note">Решение по жалобе не удаляет сообщение и не блокирует аккаунт автоматически.</p><h2>Мои обращения</h2><div id=ownReports>${mine.reports.map(ownReportCard).join('')||'<p>Обращений нет.</p>'}</div>${mine.next?`<button class="btn quiet" data-own-reports-more="${mine.next}">Ранее</button>`:''}${queue?`<h2>Очередь модерации</h2><div id="reportQueue">${queue.reports.map(reportCard).join('')}</div>${queue.next?`<button class="btn quiet" data-reports-more="${queue.next}">Ранее</button>`:''}`:''}`;
      return;
    }
    if (view === 'direct') { $('#main').innerHTML = user ? '<section id=directRoot></section>' : auth(); if(user){chatController = window.createDirectInbox({root:$('#directRoot'),user,api,initialHandle:directDraftHandle});directDraftHandle='';} return; }
    if(view==='player'){const data=await api('/api/profiles/'+selectedPlayer);if(version!==requestVersion)return;$('#main').innerHTML=`<button class="back-link" data-nav="${playerReturnView}">← ${playerReturnView==='lfg'?'К поиску напарников':playerReturnView==='members'?'К участникам':'К обсуждениям'}</button><div class="section-head"><h1>Профиль игрока</h1>${shareButton('/players/'+data.profile.id,'Скопировать ссылку на профиль')}</div>${mediaUI.showcase(data.profile)}${user&&user.id!==data.profile.id?`<button type="button" class="btn quiet" data-report-object="profile" data-target-id="${esc(data.profile.id)}">Пожаловаться на профиль</button>`:''}`;return;}
    if (view === 'account') {
      if (!user) { $('#main').innerHTML = auth(); return; }
      const viewer=user.id,[data,sessions]=await Promise.all([api('/api/recovery-codes'),api('/api/sessions')]);
      if(version!==requestVersion || user?.id!==viewer)return;
      if(sessions.viewerId!==viewer)throw Error('Сеанс изменился. Обнови страницу.');
      $('#main').innerHTML = profile() + accountSecurity(sessions) + recoverySettings(data.remaining); return;
    }
    if (view === 'club') {
      const detail=await api(`/api/clubs/${selectedClub}/detail`);if(version!==requestVersion)return;const club=detail.club;
      const ci=clubs.findIndex(c=>c.id===club.id);if(ci>=0)clubs[ci]=club;else clubs.push(club);
      const member=club.membership==='member',owner=club.myRole==='owner',staff=['owner','moderator'].includes(club.myRole),canRead=club.membership!=='banned'&&(club.access==='open'||member);
      if((!member&&['chat','members'].includes(clubTab))||(!owner&&clubTab==='settings'))clubTab='posts';
      let content='';clubPins=new Set();
      if(clubTab==='posts'){
        const posts=canRead?await api(`/api/clubs/${club.id}/posts`):{posts:[],next:null},pins=canRead?await api(`/api/clubs/${club.id}/pins`):{posts:[]};
        clubPins=new Set(pins.posts.map(p=>p.id));
        content=`${canRead?`<button class="btn quiet wide search-entry" data-search-open="${esc(club.id)}">Поиск в этом клубе →</button>`:''}${clubUI.pins(pins.posts)}${member?`<details class="club-compose panel"><summary>Написать публикацию</summary><form id="post"><h3>Новая публикация</h3><label class="field">Заголовок<input name="title" required maxlength="100"></label><label class="field">Текст<textarea name="body" required maxlength="4000"></textarea></label>${mediaUI.picker('imageFile','Изображение к публикации')}${errorLine}<button class="btn primary">Опубликовать</button></form></details>${pollUI?.editor(club)||''}${guideUI?.editor(club)||''}`:''}<div id="posts">${posts.posts.map(postHTML).join('')||(canRead?'<div class="empty-state"><h3>Обсуждение начинается здесь</h3><p>Публикаций пока нет.</p></div>':'')}</div>${posts.next?`<button class="btn quiet" data-more="${posts.next}">Показать ещё</button>`:''}`;
      }else if(clubTab==='chat')content='<section class="panel" id="clubChat"></section>';
      else if(clubTab==='members'){
        const members=await api(`/api/clubs/${club.id}/members`);content=clubUI.members(club,members,user);if(staff)content+=clubUI.journal(await api(`/api/clubs/${club.id}/audit`));
      }else{
        content=clubUI.settings(club,errorLine,mediaUI)+clubUI.invites(await api(`/api/clubs/${club.id}/invites`),errorLine)+clubUI.journal(await api(`/api/clubs/${club.id}/audit`));
      }
      if(version!==requestVersion)return;
      $('#main').innerHTML=`<div class="club-banner accent-${esc(club.accent)}"><button class="back-link" data-nav="clubs">← Все клубы</button>${club.cover_id?`<img class="club-banner-image" src="/api/media/${esc(club.cover_id)}" alt="Обложка клуба">`:''}<div class="club-banner-content"><span class="identity-avatar">${initials(club.name)}</span><div><span class="tiny-label">ТВОЁ МЕСТО В СООБЩЕСТВЕ</span><h1>${esc(club.name)}</h1><p>${esc(club.description)}</p></div></div></div><section class="panel club-overview"><div class="row wrap">${shareButton('/clubs/'+club.id,'Скопировать ссылку на клуб')}<span class="pill">${club.access==='open'?'Открытый клуб':'По заявкам'}</span><small>${memberCount(club)}</small>${club.isDemoClub?'<span class="bot-badge">Демо-клуб</span>':''}${club.myRole?`<span class="pill">${({owner:'Владелец',moderator:'Модератор',member:'Участник'})[club.myRole]}</span>`:''}${user&&!owner&&club.membership!=='banned'?`<button class="btn primary" data-membership="${member||club.membership==='pending'?'leave':'join'}">${member?'Выйти из клуба':club.membership==='pending'?'Отменить заявку':club.access==='open'?'Вступить':'Подать заявку'}</button>`:''}</div>${clubUI.about(club,user?.id)}${!user?`<div class="club-join-cta"><p>Присоединись, чтобы отвечать и общаться в клубе.</p><button class="btn primary" data-club-signin="${esc(club.id)}">Войти, чтобы ${club.access==='open'?'вступить':'подать заявку'} →</button></div>`:''}${!canRead?'<p class="note">Содержимое доступно только принятым участникам.</p>':''}</section>${clubUI.transfer(detail.transfer,user)}${clubUI.tabs(club,clubTab)}${content}`;
      if(clubTab==='posts'&&member&&composerUI)composerController=composerUI.mount({form:$('#post'),user,club,api,csrf,getUserId:()=>user?.id,onPublished:()=>render()});
      if(member&&clubTab==='chat')chatController=window.createClubChat({root:$('#clubChat'),clubId:club.id,userId:user.id,api});return;
    }
    $('#main').innerHTML = clubCards();
  } catch (e) { if (version === requestVersion) { $('#main').innerHTML = `<section class="panel"><h2>${view==='player'&&[403,404].includes(e.status)?'Профиль недоступен':'Не удалось загрузить'}</h2><p class="error">${esc(e.message)}</p><button class="btn quiet" id="retry">Повторить</button><button class="text-link" data-nav="${view==='player'?'members':'discover'}">Вернуться ${view==='player'?'к участникам':'на главную'} →</button></section>`; } } finally { if(version===requestVersion){$('#main').setAttribute('aria-busy','false');applyClubFilters();renderedRoute=nextRoute;if(routeChanged&&!(view==='post'&&selectedComment)){$('#main').focus({preventScroll:true});window.scrollTo?.({top:0,left:0,behavior:'instant'});}} }
}
async function comments(id,focus=null) {
  const version=requestVersion,viewer=user?.id,el=$(`#comments-${id}`);if(!el)return;
  el.innerHTML='<p class="note" role="status">Загружаем обсуждение…</p>';
  try{
    let data=await api(`/api/posts/${id}/comments`),focusedPage=false;
    if(focus&&!data.comments.some(c=>c.id===Number(focus))){data=await api(`/api/posts/${id}/comments?before=${Number(focus)+1}`);focusedPage=true;}
    if(version!==requestVersion||viewer!==user?.id||!el.isConnected)return;
    const post=await api('/api/posts/'+id);if(version!==requestVersion||viewer!==user?.id||!el.isConnected)return;
    const member=clubs.some(c=>c.id===post.post.club_id&&c.membership==='member');
    el.innerHTML=`${focusedPage?`<p class="note">Комментарии до выбранного ответа. <button class="text-link" data-comments="${id}">Показать последние</button></p>`:''}<div data-comment-list="${id}">${data.comments.map(c=>discussionUI.comment({...c,post_id:id},member,user,data)).join('')||'<p class="note">Первый ответ может быть твоим.</p>'}</div>${data.next?`<button class="btn quiet" data-comments-more="${id}" data-after="${data.next}">Ранее</button>`:''}${member?discussionUI.editor(id,errorLine):'<p class="note">Для ответа нужно вступить в клуб.</p>'}`;
    if(focus){const target=el.querySelector(`[data-comment-id="${Number(focus)}"]`);target?.classList.add('comment-focused');target?.scrollIntoView?.({block:'center'});}
  }catch(e){if(version===requestVersion&&el.isConnected)el.innerHTML=`<p class="error">${esc(e.message)}</p><button class="btn quiet" data-comments="${id}">Повторить</button>`;}
}
function sendingAttempt(form,signature){
  if(form.dataset.sendSignature!==signature){form.dataset.sendSignature=signature;form.dataset.sendId=crypto.randomUUID();}
  return form.dataset.sendId;
}
$('#people').onclick=()=>{view='members';render();};
$('#discover').onclick=()=>{view='discover';render();};
if($('#events'))$('#events').onclick=()=>{view='events';render();};
$('#lfg').onclick=()=>{view='lfg';render();};
$('#notifications').onclick=()=>{view='notifications';render();};
$('#reports').onclick=()=>{view='reports';render();};
$('#direct').onclick = () => { view = 'direct'; render(); };
$('#home').onclick = () => { view = 'clubs'; render(); };
$('#guestJoin').onclick=()=>{authReturn=null;view='account';render();};
$('#account').onclick = () => { view = 'account'; render(); };
$('#cancelDelete').onclick = () => { pendingDelete = null; $('#confirmDialog').close(); };
$('#confirmDelete').onclick = async () => { if (!pendingDelete) return; const id = pendingDelete; pendingDelete = null; $('#confirmDialog').close(); try { await api(`/api/posts/${id}`, 'DELETE', {}); await render(); } catch (e) { notify(e.message); } };
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if(b.dataset.authMode){authReturn=null;view='account';await render();const form=$('#'+b.dataset.authMode);form?.scrollIntoView?.({block:'center'});form?.querySelector('input')?.focus();return;}
    if(b.dataset.reportObject){
 const reason=prompt('Опиши нарушение (от 3 до 1000 символов).');if(reason===null)return;
 if(reason.trim().length<3||reason.trim().length>1000){notify('Причина должна содержать от 3 до 1000 символов.');return;}
 b.disabled=true;try{await api('/api/reports','POST',{kind:b.dataset.reportObject,targetId:['profile','club_page'].includes(b.dataset.reportObject)?b.dataset.targetId:Number(b.dataset.targetId),reason});notify('Жалоба отправлена. Результат появится в разделе «Жалобы».');}finally{b.disabled=false;}return;
 }
 if(b.hasAttribute('data-clubs-more')){await applyClubFilters(true);return;}
    if(b.hasAttribute('data-guide-catalog')){view='guides';await render();return;}
    if(b.hasAttribute('data-guide-reset')){guideState={};view='guides';await render();return;}
    if(b.dataset.guideOpen){if(view!=='post')postReturnView=view;selectedPost=b.dataset.guideOpen;selectedComment=null;view='post';await render();return;}
    if(b.hasAttribute('data-guide-preview')){const form=b.closest('form');guideUI.draw(form);form.querySelector('[data-guide-preview-pane]').classList.toggle('hidden');return;}
    if(b.dataset.guideMore){b.disabled=true;const data=await api('/api/guides?'+new URLSearchParams({...guideState,before:b.dataset.guideMore}));if(!b.isConnected||data.viewerId!==(user?.id||null))return;$('#guidePosts').insertAdjacentHTML('beforeend',data.posts.map(feedCard).join(''));if(data.next){b.dataset.guideMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.hasAttribute('data-poll-add')||b.hasAttribute('data-poll-remove')){pollUI.manage(b);return;}
    if(b.dataset.pollVote||b.dataset.pollRefresh){await pollUI.vote(b,{api,user,version:requestVersion,currentVersion:()=>requestVersion,currentUser:()=>user?.id});return;}
    if(b.hasAttribute('data-search-open')){searchState={query:'',club:b.dataset.searchOpen||''};view='search';await render();return;}
    if(b.dataset.searchMore){b.disabled=true;const params=new URLSearchParams({q:searchState.query,before:b.dataset.searchMore});if(searchState.club)params.set('club',searchState.club);const data=await api('/api/posts/search?'+params);if(!b.isConnected||data.viewerId!==(user?.id||null))return;$('#searchPosts').insertAdjacentHTML('beforeend',data.posts.map(feedCard).join(''));if(data.next){b.dataset.searchMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.editPost){selectedPost=b.dataset.editPost;if(view!=='post')if(view!=='post')if(view!=='post')postReturnView=view;view='editPost';await render();return;}
    if(b.dataset.editCancel){if(!confirm('Закрыть редактор? Несохранённые изменения будут потеряны.'))return;view=postReturnView;await render();return;}
    if(b.dataset.editReload){if(!confirm('Заменить текст сохранённой версией? Несохранённые изменения будут потеряны.'))return;await render();return;}
    if(b.dataset.membersMore){b.disabled=true;const data=await api('/api/community-members?'+new URLSearchParams({...memberState,after:b.dataset.membersMore}));if(!b.isConnected||data.viewerId!==(user?.id||null))return;$('#communityMembers').insertAdjacentHTML('beforeend',data.members.map(memberCard).join(''));if(data.next){b.dataset.membersMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.clubSignin){authReturn={view:'club',id:b.dataset.clubSignin};view='account';await render();return;}
    if(b.dataset.previewJoin||b.dataset.previewStart){const kind=b.dataset.previewKind||b.dataset.previewStart;authReturn={view:kind,id:b.dataset.previewJoin?Number(b.dataset.previewJoin):null};view='account';await render();return;}
    if(b.dataset.homeEvent){eventState.id=Number(b.dataset.homeEvent);view='events';await render();return;}
    if(b.dataset.homeGroup){lfgState.tab='groups';lfgState.initialGroup=Number(b.dataset.homeGroup);view='lfg';await render();return;}
    if(b.hasAttribute('data-home-create-event')){eventState.id=null;eventState.create=true;view='events';await render();return;}
    if(b.hasAttribute('data-home-create-group')){lfgState.tab='groups';lfgState.initialGroup=null;lfgState.create=true;view='lfg';await render();return;}
    if(b.dataset.homeCompose){selectedClub=b.dataset.homeCompose;clubTab='posts';view='club';await render();if(view==='club'&&selectedClub===b.dataset.homeCompose){const composer=$('.club-compose');if(composer){composer.open=true;composer.querySelector('input')?.focus();}}return;}
    if(b.dataset.clubTab){clubTab=b.dataset.clubTab;await render();return;}
    if(b.hasAttribute('data-invite-dismiss')){inviteToken=null;view='clubs';await render();return;}
    if(b.hasAttribute('data-invite-accept')){b.disabled=true;const data=await api('/api/club-invites/accept','POST',{token:inviteToken});inviteToken=null;selectedClub=data.clubId;clubTab='posts';view='club';await render();return;}
    if(b.dataset.clubMembersMore){b.disabled=true;const data=await api(`/api/clubs/${selectedClub}/members?after=${b.dataset.clubMembersMore}`);if(!b.isConnected)return;$('#clubMembers').insertAdjacentHTML('beforeend',data.members.map(m=>clubUI.member(clubs.find(c=>c.id===selectedClub),m,user)).join(''));if(data.next){b.dataset.clubMembersMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.clubAuditMore){b.disabled=true;const data=await api(`/api/clubs/${selectedClub}/audit?before=${b.dataset.clubAuditMore}`);if(!b.isConnected)return;$('#clubAudit').insertAdjacentHTML('beforeend',data.entries.map(clubUI.entry).join(''));if(data.next){b.dataset.clubAuditMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.clubRole){b.disabled=true;await api(`/api/clubs/${selectedClub}/moderators`,b.dataset.roleMethod,{userId:b.dataset.clubRole});await render();return;}
    if(b.dataset.clubKick&&confirm('Участник потеряет доступ к закрытым постам и чату. Он сможет подать заявку снова. Исключить?')){b.disabled=true;await api(`/api/clubs/${selectedClub}/kick`,'POST',{userId:b.dataset.clubKick});await render();return;}
    if(b.dataset.clubUnban){b.disabled=true;await api(`/api/clubs/${selectedClub}/unban`,'POST',{userId:b.dataset.clubUnban});await render();return;}
    if(b.dataset.clubPin){b.disabled=true;await api(`/api/clubs/${selectedClub}/pins/${b.dataset.clubPin}`,b.dataset.pinMethod,{});await render();return;}
    if(b.dataset.removeComment&&confirm('Комментарий будет удалён без отмены. Ответы останутся без цитаты. Удалить?')){b.disabled=true;await api(`/api/clubs/${encodeURIComponent(b.dataset.removeCommentClub)}/comments/${Number(b.dataset.removeComment)}`,'DELETE',{});await comments(b.dataset.commentPost);return;}
    if(b.dataset.clubRemovePost&&confirm('Публикация, комментарии, реакции и сохранения будут удалены без отмены. Удалить?')){b.disabled=true;await api(`/api/clubs/${selectedClub}/posts/${b.dataset.clubRemovePost}`,'DELETE',{});await render();return;}
    if(b.dataset.clubRevokeInvite&&confirm('Ссылка перестанет работать. Уже принятые участники останутся в клубе. Отозвать?')){b.disabled=true;await api(`/api/clubs/${selectedClub}/invites/${b.dataset.clubRevokeInvite}`,'DELETE',{});await render();return;}
    if(b.dataset.clubTransfer&&confirm('После согласия участника он станет владельцем, а ты обычным участником. Прежние приглашения будут отозваны. Предложить передачу?')){b.disabled=true;b.dataset.attemptId ||= crypto.randomUUID();await api(`/api/clubs/${selectedClub}/transfer`,'POST',{userId:b.dataset.clubTransfer,clientId:b.dataset.attemptId});await render();return;}
    if(b.dataset.clubAcceptTransfer&&confirm('Ты станешь владельцем и получишь управление клубом. Принять?')){b.disabled=true;await api(`/api/clubs/${selectedClub}/transfer/accept`,'POST',{offerId:b.dataset.clubAcceptTransfer});await render();return;}
    if(b.dataset.clubCancelTransfer){b.disabled=true;await api(`/api/clubs/${selectedClub}/transfer/cancel`,'POST',{offerId:b.dataset.clubCancelTransfer});await render();return;}
    if(b.dataset.clubPinnedPost){selectedPost=b.dataset.clubPinnedPost;selectedComment=null;postReturnView='club';view='post';await render();return;}
    if(b.dataset.react){
      b.disabled=true;b.closest('[data-post-actions]').querySelectorAll('button').forEach(button=>button.disabled=true);const id=b.dataset.react,kind=b.dataset.kind,selected=b.getAttribute('aria-pressed')==='true',version=requestVersion;
      const data=await api(`/api/posts/${id}/reaction`,selected?'DELETE':'PUT',selected?{}:{kind});
      if(version!==requestVersion||!b.isConnected)return;
      const member=clubs.some(c=>c.id===data.post.club_id&&c.membership==='member');
      b.closest('[data-post-actions]').outerHTML=discussionUI.actions(data.post,user,member);return;
    }
    if(b.dataset.save){b.disabled=true;const saved=b.getAttribute('aria-pressed')==='true',version=requestVersion;await api(`/api/posts/${b.dataset.save}/saved`,saved?'DELETE':'PUT',{});if(version!==requestVersion||!b.isConnected)return;if(view==='saved'&&saved){await render();return;}b.setAttribute('aria-pressed',String(!saved));b.textContent=saved?'Сохранить':'В сохранённом';b.disabled=false;return;}
    if(b.dataset.reply){const form=$(`[data-comment-form="${b.dataset.replyPost}"]`);if(!form)return;form.dataset.parentId=b.dataset.reply;form.querySelector('.reply-target').classList.remove('hidden');form.querySelector('.reply-target span').textContent='Ответ '+b.dataset.replyName;form.elements.body.focus();return;}
    if(b.dataset.cancelReply){const form=$(`[data-comment-form="${b.dataset.cancelReply}"]`);delete form.dataset.parentId;form.querySelector('.reply-target').classList.add('hidden');return;}
    if(b.dataset.commentsMore){b.disabled=true;const id=b.dataset.commentsMore,version=requestVersion;const data=await api(`/api/posts/${id}/comments?before=${b.dataset.after}`);if(version!==requestVersion||!b.isConnected)return;const member=Boolean($(`[data-comment-form="${id}"]`));$(`[data-comment-list="${id}"]`).insertAdjacentHTML('afterbegin',data.comments.map(c=>discussionUI.comment({...c,post_id:id},member,user,data)).join(''));if(data.next){b.dataset.after=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.savedMore){b.disabled=true;const data=await api('/api/saved?before='+b.dataset.savedMore);if(!b.isConnected||data.viewerId!==user?.id)return;$('#savedPosts').insertAdjacentHTML('beforeend',data.posts.map(feedCard).join(''));if(data.next){b.dataset.savedMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.discussionMore){b.disabled=true;const data=await api('/api/discussions/notifications?before='+b.dataset.discussionMore);if(!b.isConnected||data.viewerId!==user?.id)return;$('#discussionEvents').insertAdjacentHTML('beforeend',data.notifications.map(discussionUI.notification).join(''));if(data.next){b.dataset.discussionMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.discussionRead){b.disabled=true;await api(`/api/discussions/notifications/${b.dataset.discussionRead}/read`,'POST',{});await render();updateDiscussionBadge();return;}
    if(b.dataset.discussionPost){postReturnView='notifications';selectedPost=b.dataset.discussionPost;selectedComment=b.dataset.discussionComment||null;view='post';await render();return;}
    if(b.dataset.contact){directDraftHandle=b.dataset.contact;view='direct';await render();return;}
    if(b.dataset.player){playerReturnView=view==='lfg'?'lfg':'discover';selectedPlayer=b.dataset.player;view='player';await render();return;}
    if(b.dataset.clearImage){await api('/api/me','PATCH',{[b.dataset.clearImage]:null});await render();return;}
    if(b.hasAttribute('data-clear-club-cover')){await api(`/api/clubs/${selectedClub}/cover`,'PATCH',{coverId:null});await render();return;}
    if(b.dataset.nav){view=b.dataset.nav;await render();return;}
    if(b.dataset.commentClub)selectedClub=b.dataset.commentClub;
    if(b.dataset.feedMore){b.disabled=true;const data=await api('/api/feed?before='+b.dataset.feedMore);if(!b.isConnected)return;$('#feedPosts').insertAdjacentHTML('beforeend',data.posts.map(feedCard).join(''));if(data.next){b.dataset.feedMore=data.next;b.disabled=false;}else b.remove();}
    if(b.dataset.appealRead){b.disabled=true;await api(`/api/reports/${b.dataset.appealRead}/appeal/read`,'POST',{});await render();updateReportBadge();}
    if(b.dataset.reportRead){b.disabled=true;await api(`/api/reports/${b.dataset.reportRead}/read`,'POST',{});await render();updateReportBadge();}
    if(b.dataset.ownReportsMore){b.disabled=true;const result=await api('/api/reports?before='+b.dataset.ownReportsMore);if(!b.isConnected)return;$('#ownReports').insertAdjacentHTML('beforeend',result.reports.map(ownReportCard).join(''));if(result.next){b.dataset.ownReportsMore=result.next;b.disabled=false;}else b.remove();}
    if(b.dataset.reportsMore){b.disabled=true;const result=await api('/api/moderation/reports?before='+b.dataset.reportsMore);if(!b.isConnected)return;$('#reportQueue').insertAdjacentHTML('beforeend',result.reports.map(reportCard).join(''));if(result.next){b.dataset.reportsMore=result.next;b.disabled=false;}else b.remove();}
    if (b.id === 'retry') return render();
    if (b.dataset.open) { selectedClub = b.dataset.open;clubTab='posts'; view = 'club'; await render(); }
    if (b.dataset.logout) { if(composerController)await composerController.flush();composerUI?.reset();await api(b.dataset.logout, 'POST', {}); try { const prefix = `wr-chat-pending:${user.id}:`; for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch {} user = csrf = null;lfgState={};eventState={};directDraftHandle='';inviteToken=null;clubTab='posts'; view = 'account'; await render(); }
    if (b.dataset.membership) { b.disabled = true; await api(`/api/clubs/${selectedClub}/${b.dataset.membership}`, 'POST', {}); await render(); }
    if (b.dataset.decision) { b.disabled = true; await api(`/api/clubs/${selectedClub}/decision`, 'POST', { userId: b.dataset.user, decision: b.dataset.decision }); await render(); }
    if (b.dataset.ban && confirm('Участник потеряет доступ к содержимому клуба и не сможет вступить снова. Продолжить?')) { await api(`/api/clubs/${selectedClub}/ban`, 'POST', { userId: b.dataset.ban }); await render(); }
    if (b.dataset.comments) await comments(b.dataset.comments);
    if (b.dataset.delete) { pendingDelete = b.dataset.delete; $('#confirmDialog').showModal(); }
    if (b.dataset.more) { b.disabled = true; const data = await api(`/api/clubs/${selectedClub}/posts?before=${b.dataset.more}`); if (!b.isConnected) return; $('#posts').insertAdjacentHTML('beforeend', data.posts.map(postHTML).join('')); if (data.next) { b.dataset.more = data.next; b.disabled = false; } else b.remove(); }
  } catch (e) { b.disabled = false;if(b.dataset.react&&b.isConnected)b.closest('[data-post-actions]').querySelectorAll('button').forEach(button=>button.disabled=false);notify(e.message); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if(form.id==='changePassword'){
    event.preventDefault();if(!form.reportValidity())return;
    if(form.elements.newPassword.value!==form.elements.repeatPassword.value){formError(form,{message:'Новые пароли не совпадают.'});return;}
    if(!await beforeRouteChange())return;
    const button=form.querySelector('button'),version=requestVersion,viewer=user?.id;button.disabled=true;
    try{const result=await api('/api/me/password','POST',{currentPassword:form.elements.currentPassword.value,newPassword:form.elements.newPassword.value});
      form.reset();if(version!==requestVersion||viewer!==user?.id)return;user=result.user;csrf=result.csrf;await render();notify('Пароль изменён. Старые сеансы и коды отозваны. Создай новые резервные коды.');
    }catch(e){if(form.isConnected)formError(form,e);}finally{button.disabled=false;}return;
  }
  if(form.hasAttribute('data-members-filter')){event.preventDefault();memberState=Object.fromEntries(new FormData(form));await render();return;}
  if(form.hasAttribute('data-guide-filters')){event.preventDefault();guideState=Object.fromEntries(new FormData(form));view='guides';await render();return;}
  if(form.dataset.guideCreate||form.dataset.guideEdit){event.preventDefault();if(!form.reportValidity())return;const version=requestVersion,viewer=user?.id;try{const d=await guideUI.save(form,api);if(version!==requestVersion||viewer!==user?.id||!form.isConnected)return;selectedPost=d.id;if(form.dataset.guideCreate)postReturnView='club';view='post';await render();notify('Руководство сохранено.');}catch{}return;}
  if(form.dataset.pollCreate){event.preventDefault();if(!form.reportValidity())return;const version=requestVersion,viewer=user?.id;try{await pollUI.create(form,api);if(version!==requestVersion||viewer!==user?.id||!form.isConnected)return;await render();notify('Опрос опубликован.');}catch{}return;}
  if(form.hasAttribute('data-post-search')){event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form);searchState={query:String(data.get('query')).trim(),club:String(data.get('club'))};view='search';await render();return;}
  if(form.dataset.postEditForm){event.preventDefault();if(!form.reportValidity())return;const version=requestVersion,viewer=user?.id;try{await postManagement.save(form,api);if(version!==requestVersion||viewer!==user?.id||!form.isConnected)return;view='post';await render();notify('Изменения сохранены.');}catch{}return;}
  if(form.hasAttribute('data-club-settings')||form.hasAttribute('data-club-invite')){
    event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;const data=Object.fromEntries(new FormData(form));
    try{
      if(form.hasAttribute('data-club-settings')){await api(`/api/clubs/${selectedClub}/settings`,'PATCH',{...data,version:Number(data.version),tags:data.tags.split(',').map(t=>t.trim()).filter(Boolean)});await render();}
      else{const payload={durationHours:Number(data.durationHours),maxUses:Number(data.maxUses)};const result=await api(`/api/clubs/${selectedClub}/invites`,'POST',{...payload,clientId:sendingAttempt(form,JSON.stringify(payload))});if(!form.isConnected)return;const link=location.origin+'/#invite='+result.token;form.querySelector('[data-invite-share]').innerHTML=`<label class="field">Ссылка приглашения<input readonly value="${esc(link)}" aria-label="Ссылка приглашения"></label><p class="note">Скопируй и передай тем, кого ждёшь. Ссылка доступна в этой форме; список приглашений хранит только сведения об использовании.</p>`;button.textContent='Ссылка создана';}
    }catch(e){formError(form,e);}finally{button.disabled=false;}return;
  }
  if(form.dataset.appeal||form.dataset.appealDecision){event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;try{const route=form.dataset.appeal?`/api/reports/${form.dataset.appeal}/appeal`:`/api/moderation/reports/${form.dataset.appealDecision}/appeal-decision`;await api(route,'POST',Object.fromEntries(new FormData(form)));await render();}catch(e){formError(form,e);}finally{button.disabled=false;}return;}
  if(form.dataset.moderationAction){event.preventDefault();if(!form.reportValidity())return;if(!confirm('Применить действие к материалу? Удаление публикации или комментария нельзя отменить. Скрытие профиля уберёт его из каталога.'))return;const b=form.querySelector('button');b.disabled=true;try{await api('/api/moderation/reports/'+form.dataset.moderationAction+'/action','POST',Object.fromEntries(new FormData(form)));await render();}catch(e){formError(form,e);}finally{b.disabled=false;}return;}
  if(form.dataset.reportDecision){event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;try{await api(`/api/moderation/reports/${form.dataset.reportDecision}/decision`,'POST',Object.fromEntries(new FormData(form)));await render();}catch(e){formError(form,e);}finally{button.disabled=false;}return;}
  if (['recover','recoveryCodes'].includes(form.id)) {
    event.preventDefault(); if(!form.reportValidity())return;
    const button=form.querySelector('button'),version=requestVersion,viewer=user?.id;
    button.disabled=true; formError(form,{message:''});
    try {
      const data=Object.fromEntries(new FormData(form));
      if(form.id==='recover') {
        await api('/api/recover','POST',data);
        if(version!==requestVersion || !form.isConnected)return;
        user=csrf=null;view='account';await render();notify('Пароль изменён. Войди с новым паролем.');
      } else {
        // Remove any previous visible codes before generating replacements.
        form.querySelector('[data-recovery-result]').replaceChildren();
        const result=await api('/api/recovery-codes','POST',data);
        if(version!==requestVersion || user?.id!==viewer || !form.isConnected)return;
        form.reset();
        form.closest('section').querySelector('[data-recovery-count]').textContent=String(result.codes.length);
        form.querySelector('[data-recovery-result]').innerHTML=`<p class="note">Сохрани все восемь кодов. Прежние коды больше не работают.</p><label class="field">Резервные коды<textarea readonly rows="8" autocomplete="off" spellcheck="false">${result.codes.map(esc).join('\n')}</textarea></label>`;
      }
    } catch(e) { if(form.isConnected)formError(form,e); }
    finally { button.disabled=false; }
    return;
  }
  if(form.dataset.composerMounted)return;
  if (!['login' , 'register', 'profile', 'createClub', 'post', 'clubCover'].includes(form.id) && !form.dataset.commentForm) return;
  event.preventDefault(); if (!form.reportValidity()) return;
  const button = form.querySelector('button'); button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'register' || form.id === 'login') { const result = await api('/api/' + form.id, 'POST', data); user = result.user; csrf = result.csrf; view = inviteToken?'invite':authReturn?.view||'clubs';if(authReturn){if(authReturn.view==='events')eventState={id:authReturn.id,create:!authReturn.id};else if(authReturn.view==='lfg')lfgState={tab:'groups',initialGroup:authReturn.id,create:!authReturn.id};else if(authReturn.view==='club'){selectedClub=authReturn.id;clubTab='posts';}authReturn=null;} }
    if (form.id === 'profile') await mediaUI.save(form,api,csrf);
    if(form.id==='clubCover'){const id=await mediaUI.upload(form.elements.coverFile.files[0],csrf);if(!id)throw Error('Выбери изображение.');await api(`/api/clubs/${selectedClub}/cover`,'PATCH',{coverId:id});}
    if (form.id === 'createClub') { const result = await api('/api/clubs', 'POST', data); selectedClub = result.id;clubTab='posts'; view = 'club'; }
    if (form.id === 'post'){const file=form.elements.imageFile.files[0];const imageSignature=file?JSON.stringify([file.name,file.size,file.lastModified]):'';if(form.dataset.imageSignature!==imageSignature){delete form.dataset.imageId;form.dataset.imageSignature=imageSignature;}const id=form.dataset.imageId||await mediaUI.upload(file,csrf);if(id)form.dataset.imageId=id;await api(`/api/clubs/${selectedClub}/posts`, 'POST',{title:data.title,body:data.body,imageId:id,clientId:sendingAttempt(form,JSON.stringify([data.title,data.body,id]))});}
    if (form.dataset.commentForm) { const parentId=form.dataset.parentId?Number(form.dataset.parentId):null;await api(`/api/posts/${form.dataset.commentForm}/comments`, 'POST',{body:data.body,parentId,clientId:sendingAttempt(form,JSON.stringify([data.body,parentId]))});if(form.isConnected)await comments(form.dataset.commentForm);updateDiscussionBadge();return; }
    await render();
  } catch (e) { formError(form, e); }
  finally { button.disabled = false; }
});

document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-revoke-session],[data-session-more]');if(!b)return;
 const version=requestVersion,viewer=user?.id;
 if(b.dataset.revokeSession){
   if(!confirm(b.dataset.currentSession==='1'?'Завершить текущий сеанс и выйти из аккаунта?':'Завершить выбранный сеанс?'))return;
   if(b.dataset.currentSession==='1'&&!await beforeRouteChange())return;
 }
 b.disabled=true;
 try{
  if(b.dataset.sessionMore){const data=await api('/api/sessions?after='+encodeURIComponent(b.dataset.sessionMore));if(version!==requestVersion||viewer!==user?.id||data.viewerId!==viewer)return;
   $('[data-session-list]').insertAdjacentHTML('beforeend',data.sessions.map(sessionCard).join(''));if(data.next)b.dataset.sessionMore=data.next;else b.remove();
  }else{
   const result=await api('/api/sessions/'+b.dataset.revokeSession,'DELETE',{});if(version!==requestVersion||viewer!==user?.id)return;
   if(result.loggedOut){try{const prefix=`wr-chat-pending:${viewer}:`;for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix))sessionStorage.removeItem(key);}catch{}user=csrf=null;view='account';await render();}
   else{b.closest('[data-session-row]').remove();notify('Сеанс завершён.');}
  }
 }catch(e){notify(e.message);}finally{b.disabled=false;}
});
if(!inviteToken){applyRoute(parseRoute(location.pathname)||{view:'notfound'});const returnPath=new URLSearchParams(location.search).get('return');const target=returnPath&&parseRoute(returnPath);if(view==='account'&&target?.view==='club')authReturn=target;}
window.addEventListener('popstate',async()=>{const version=requestVersion;if(!await beforeRouteChange()){syncRoute(false);return;}if(version!==requestVersion)return;applyRoute(parseRoute(location.pathname)||{view:'notfound'});render({history:false});});
document.addEventListener('click',async event=>{const a=event.target.closest('a[data-route]');if(!a||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const target=parseRoute(new URL(a.href).pathname);if(!target)return;event.preventDefault();const version=requestVersion;if(!await beforeRouteChange()||version!==requestVersion)return;applyRoute(target);render();});
render({history:false});

// In-app badge only: no browser permission or external push service.
let badgeBusy=false;
async function updateMessageBadge(){
  if(badgeBusy)return;
  const id=user?.id;
  if(!id){navBadge('direct','Чаты');return;}
  badgeBusy=true;const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
  try{const data=await api('/api/direct/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;
    if(data.viewerId!==id){navBadge('direct','Чаты','обнови сеанс');return;}
    navBadge('direct','Чаты',`непрочитанных: ${data.unread}, запросов: ${data.requests}`,data.unread+data.requests);
  }catch{if(user?.id===id)navBadge('direct','Чаты','нет связи');}
  finally{clearTimeout(deadline);badgeBusy=false;}
}


function reportStatus(status){return ({pending:'Ожидает рассмотрения',upheld:'Нарушение подтверждено',dismissed:'Отклонено'})[status]||status;}
function actionResult(r){return '<p class="note">Выполнено: '+esc(({'remove-post':'публикация удалена','remove-comment':'комментарий удалён','hide-profile':'публичный профиль скрыт','remove-club':'клуб удалён','close-group':'объявление закрыто, чат очищен','cancel-event':'событие отменено, чат очищен','remove-chat-message':'сообщение удалено'})[r.applied_action])+'. '+esc(r.action_note)+'</p>';}
function moderationActionCard(r){
 if(r.applied_action)return actionResult(r);
 const action={post:'remove-post',comment:'remove-comment',profile:'hide-profile',club_page:'remove-club',lfg:'close-group',event:'cancel-event',club:'remove-chat-message'}[r.kind];
 if(!action||(r.appeal_status||r.status)!=='upheld'||[r.reporter_id,r.sender_id].includes(user.id))return '';
 return '<form data-moderation-action="'+r.id+'"><input type="hidden" name="action" value="'+action+'"><label class="field">Объяснение действия<textarea name="note" required minlength="3" maxlength="1000"></textarea></label>'+errorLine+'<button class="btn quiet">'+({post:'Удалить публикацию и обсуждение',comment:'Удалить комментарий',profile:'Скрыть публичный профиль',club_page:'Удалить клуб со всем содержимым',lfg:'Закрыть объявление и очистить чат',event:'Отменить событие и очистить чат',club:'Удалить сообщение'})[r.kind]+'</button><p class="note">Отдельное действие после решения. Удаление не отменяется апелляцией. Скрытие профиля не блокирует аккаунт. Удаление клуба необратимо: участники теряют доступ без уведомления, снимок жалобы сохраняется.</p></form>';
}
function sanctionText(s){return s?({warning:'предупреждение',restricted:'ограничение публикаций',suspended:'приостановка'})[s.level]+' · подтверждённых нарушений за 30 дней: '+s.violations:'подтверждённых нарушений за 30 дней нет';}
function sanctionNotice(){if(!sanction)return '';const until=sanction.until?' до '+new Date(sanction.until).toLocaleString('ru-RU'):'';return `<section class="panel" role="status"><h2>${sanction.level==='restricted'?'Публикации временно ограничены'+esc(until):'Предупреждение модерации'}</h2><p class="note">Модераторы подтвердили нарушения правил в твоих материалах: ${esc(String(sanction.violations))} за 30 дней. Повторные нарушения ведут к ограничению публикаций, затем к приостановке аккаунта. Правила — внизу страницы.</p></section>`;}
function reportCard(r){return `<article class="panel"><h3>№${r.id} · ${esc(reportStatus(r.status))}</h3><p class="note">${esc(({direct:'Личное сообщение',club:'Сообщение клуба',post:'Публикация',comment:'Комментарий',profile:'Профиль',lfg:'Объявление о группе',event:'Игровой вечер',club_page:'Клуб'})[r.kind])} · автор: ${esc(sanctionText(r.senderSanction))}</p><blockquote class="content">${esc(r.snapshot)}</blockquote><p>${esc(r.reason)}</p>${r.status==='pending'?`<form data-report-decision="${r.id}"><label class="field">Решение<select name="decision"><option value="upheld">Нарушение подтверждено</option><option value="dismissed">Отклонено</option></select></label><label class="field">Объяснение для заявителя<textarea name="note" required minlength="3" maxlength="1000"></textarea></label>${errorLine}<button class="btn primary">Сохранить решение</button></form>`:`<p>${esc(r.decision_note)}</p>`}${moderationActionCard(r)}${appealCard(r,true)}</article>`;}

function ownReportCard(r){return `<article class="panel"><h3>№${r.id} · ${esc(reportStatus(r.status))}</h3><p>${esc(r.reason)}</p><p>${esc(r.decision_note)}</p>${r.status!=='pending'&&!r.decision_seen?`<button class="btn quiet" data-report-read="${r.id}">Новое решение · отметить прочитанным</button>`:''}${r.applied_action?actionResult(r):''}${appealCard(r,false)}</article>`;}
let reportBadgeBusy=false;
async function updateReportBadge(){
 if(reportBadgeBusy)return;const id=user?.id;if(!id){$('#reports').textContent='Жалобы';return;}
 reportBadgeBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const data=await api('/api/reports/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;$('#reports').textContent=data.viewerId===id?`Жалобы${data.unread?' · решений: '+data.unread:''}`:'Жалобы · обнови сеанс';}
 catch{if(user?.id===id)$('#reports').textContent='Жалобы · нет связи';}
 finally{clearTimeout(timer);reportBadgeBusy=false;}
}


function appealCard(r,moderator){
 if(r.status==='pending')return '';
 if(!r.appeal_status)return moderator?'':`<details><summary>Оспорить решение</summary><p class="note">Одна апелляция. Её рассмотрит другой модератор. После отправки текст нельзя изменить.</p><form data-appeal="${r.id}"><label class="field">Почему решение нужно пересмотреть<textarea name="reason" required minlength="3" maxlength="1000"></textarea></label>${errorLine}<button class="btn primary">Подать апелляцию</button></form></details>`;
 const heading=`<h4>Пересмотр: ${esc(reportStatus(r.appeal_status))}</h4><p>${esc(r.appeal_reason)}</p>`;
 if(r.appeal_status==='pending')return heading+(moderator&&!([r.reporter_id,r.sender_id,r.moderator_id].includes(user.id))?`<form data-appeal-decision="${r.id}"><label class="field">Итог по жалобе<select name="decision"><option value="upheld">Нарушение подтверждено</option><option value="dismissed">Нарушение не подтверждено</option></select></label><label class="field">Объяснение пересмотра<textarea name="note" required minlength="3" maxlength="1000"></textarea></label>${errorLine}<button class="btn primary">Завершить пересмотр</button></form>`:'<p class="note">Ожидается другой независимый модератор.</p>');
 return heading+`<p>${esc(r.appeal_note)}</p>`+(!moderator&&!r.appeal_seen?`<button class="btn quiet" data-appeal-read="${r.id}">Результат пересмотра · отметить прочитанным</button>`:'');
}

let lfgBadgeBusy=false;
async function updateLfgBadge(){
 if(lfgBadgeBusy)return;const id=user?.id;if(!id){navBadge('lfg','Найти');return;}
 lfgBadgeBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const data=await api('/api/lfg/notifications/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;navBadge('lfg','Найти',data.viewerId===id?`уведомлений: ${data.unread}`:'обнови сеанс',data.viewerId===id?data.unread:0);}
 catch{if(user?.id===id)navBadge('lfg','Найти','нет связи');}
 finally{clearTimeout(timer);lfgBadgeBusy=false;}
}


document.addEventListener('input',event=>{if(event.target.id==='clubSearch'){clubFilter.q=event.target.value;clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>applyClubFilters(),150);}});
document.addEventListener('change',event=>{if(event.target.id==='clubSort'){clubFilter.sort=event.target.value;applyClubFilters();}});

let discussionBadgeBusy=false;
async function updateDiscussionBadge(){
 if(discussionBadgeBusy)return;const id=user?.id;if(!id){$('#notifications').textContent='Ответы';return;}
 discussionBadgeBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const data=await api('/api/discussions/notifications/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;$('#notifications').textContent=data.viewerId===id?`Ответы${data.unread?' · '+data.unread:''}`:'Ответы · обнови сеанс';}
 catch{if(user?.id===id)$('#notifications').textContent='Ответы · нет связи';}
 finally{clearTimeout(timer);discussionBadgeBusy=false;}
}
async function updateEventBadge(){const button=$('#events'),id=user?.id;if(!button)return;if(!id){button.textContent='События';return;}try{const data=await api('/api/events/notifications/summary');if(user?.id===id)button.textContent='События'+(data.unread?' · '+data.unread:'');}catch{}}
let badgeTimer=null,badgePolling=false,badgeInterval=5000,badgeSignature='';
async function pollBadges(){
 clearTimeout(badgeTimer);
 if(document.hidden||!user||badgePolling){badgeTimer=setTimeout(pollBadges,5000);return;}
 badgePolling=true;const id=user.id,controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
 try{
  const d=await api('/api/notifications/summary','GET',undefined,{signal:controller.signal});
  if(user?.id!==id||d.viewerId!==id)return;
  const signature=JSON.stringify([d.direct.unread,d.direct.requests,d.reports.unread,d.lfg.unread,d.discussions.unread,d.events.unread]);
  badgeInterval=signature===badgeSignature?Math.min(badgeInterval*2,30000):5000;badgeSignature=signature;
  navBadge('direct','Чаты',`непрочитанных: ${d.direct.unread}, запросов: ${d.direct.requests}`,d.direct.unread+d.direct.requests);
  $('#reports').textContent='Жалобы'+(d.reports.unread?' · решений: '+d.reports.unread:'');
  navBadge('lfg','Найти',`уведомлений: ${d.lfg.unread}`,d.lfg.unread);
  $('#notifications').textContent='Ответы'+(d.discussions.unread?' · '+d.discussions.unread:'');
  $('#events').textContent='События'+(d.events.unread?' · '+d.events.unread:'');
 }catch{badgeInterval=Math.min(badgeInterval*2,60000);}
 finally{clearTimeout(deadline);badgePolling=false;badgeTimer=setTimeout(pollBadges,badgeInterval);}
}
document.addEventListener('visibilitychange',()=>{clearTimeout(badgeTimer);if(!document.hidden){badgeInterval=5000;pollBadges();}});
badgeTimer=setTimeout(pollBadges,5000);

document.addEventListener('click',event=>{const menu=$('.section-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;});
document.addEventListener('keydown',event=>{const menu=$('.section-menu');if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});




document.addEventListener('click',event=>{
 const form=document.querySelector('#profile,[data-post-edit-form],[data-guide-edit],[data-guide-create]'),button=event.target.closest('button');
 if(!form||!button||form.contains(button))return;
 if(form.id==='profile'&&!button.matches('.primary-nav button,#reports,#notifications,#guestJoin,[data-nav],[data-open],[data-player],[data-home-compose],[data-search-open],[data-home-create-event],[data-home-create-group],[data-home-event],[data-home-group],[data-clear-image],[data-logout]'))return;
 if(unsavedEditor()&&!confirm('Уйти из редактора? Несохранённые изменения будут потеряны.')){event.preventDefault();event.stopImmediatePropagation();}
},true);

window.addEventListener('beforeunload',event=>{if(unsavedEditor()){event.preventDefault();event.returnValue='';}});
document.addEventListener('input',event=>{const form=event.target.closest('[data-guide-create],[data-guide-edit]');if(form)guideUI.draw(form);});

document.addEventListener('click',async event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-club-tag')){clubFilter.tag=b.dataset.clubTag;applyClubFilters();}
 if(b.hasAttribute('data-club-scope')){clubFilter.scope=b.dataset.clubScope;applyClubFilters();}
 if(b.hasAttribute('data-club-reset')){clubFilter={q:'',tag:'',scope:'all',sort:'new'};$('#clubSearch').value='';$('#clubSort').value='new';document.querySelector('.interest-filters').scrollLeft=0;applyClubFilters();}
 if(b.dataset.share){
   const url=new URL(b.dataset.share,location.origin).href;
   try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(url);notify('Ссылка скопирована');}
   catch{let dialog=$('#shareDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='shareDialog';dialog.className='share-dialog';dialog.setAttribute('aria-labelledby','shareTitle');dialog.innerHTML='<h2 id="shareTitle">Ссылка на страницу</h2><p class="note">Скопируй ссылку. Закрытое содержимое доступно только участникам.</p><label class="field">Ссылка<input readonly aria-label="Ссылка на страницу"></label><button class="btn quiet" data-share-close>Закрыть</button>';dialog.querySelector('button').onclick=()=>dialog.close();document.body.append(dialog);}dialog.querySelector('input').value=url;dialog.showModal();dialog.querySelector('input').select();}
 }
});
