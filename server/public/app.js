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
let selectedTournamentId=null,selectedLfgId=null,selectedTournamentMatch=null;
let clubTab='posts',clubPins=new Set(),postReturnView='notifications';
let inviteToken=/^#invite=([a-f0-9]{64})$/.exec(location.hash)?.[1]||null;
if(inviteToken)history.replaceState(null,'',location.pathname);
let selectedPost=null,selectedComment=null;
let selectedPlayer=null,playerReturnView='discover',directDraftHandle='';
let lfgState={},eventState={};
let chatController = null;
let authReturn=null,authMode='login',accountUI={editor:false,security:false};
let sanction = null;
let user = null, csrf = null, clubs = [], selectedClub = null, view = inviteToken?'invite':'welcome', requestVersion = 0, pendingDelete = null;

let memberState={q:'',role:''};
let homeTab='overview';
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
function parseRoute(path,search=''){
 const routes={'/':'welcome','/feed':'discover','/clubs':'clubs','/players':'members','/guides':'guides','/teams':'lfg','/games':'games','/events':'events','/tournaments':'tournaments','/account':'account','/messages':'direct','/notifications':'notifications','/reports':'reports','/saved':'saved','/drafts':'drafts','/search':'search','/rules':'rules'};
 const clean=path==='/'?path:path.replace(/\/$/,'');if(routes[clean]){const tab=new URLSearchParams(search).get('tab');return {view:routes[clean],...(routes[clean]==='tournaments'?{tournamentMatch:(()=>{const q=new URLSearchParams(search),round=Number(q.get('round')),slot=Number(q.get('slot'));return q.has('slot')&&Number.isSafeInteger(round)&&round>=1&&round<=4&&Number.isSafeInteger(slot)&&slot>=0&&slot<=7?{round,slot}:null;})(),tournamentId:(()=>{const id=Number(new URLSearchParams(search).get('id'));return Number.isSafeInteger(id)&&id>0?id:null;})()}:{}),...(['events','lfg'].includes(routes[clean])?{destinationId:(()=>{const id=Number(new URLSearchParams(search).get('id'));return Number.isSafeInteger(id)&&id>0?id:null;})()}:{}),...(routes[clean]==='discover'?{homeTab:['conversations','play'].includes(tab)?tab:'overview'}:{})};}
 const m=/^\/(clubs|posts|players)\/([\w-]{1,80})$/.exec(clean);
 if(!m||(m[1]==='posts'&&!/^\d{1,16}$/.test(m[2])))return null;
 return {view:{clubs:'club',posts:'post',players:'player'}[m[1]],id:m[2]};
}
function applyRoute(route){
 if(!route)return;view=route.view;
 if(view==='events')eventState.id=route.destinationId||null;
 if(view==='lfg'){selectedLfgId=route.destinationId||null;lfgState.initialGroup=selectedLfgId;}
 if(view==='tournaments'){selectedTournamentId=route.tournamentId||null;selectedTournamentMatch=route.tournamentMatch||null;}
 if(view==='discover')homeTab=route.homeTab||'overview';
 if(view==='club'){selectedClub=route.id;clubTab='posts';}
 if(view==='post'){selectedPost=Number(route.id);selectedComment=null;postReturnView='discover';}
 if(view==='player'){selectedPlayer=route.id;playerReturnView='members';}
}
function routePath(){
 if(view==='notfound')return location.pathname;
 if(view==='club')return '/clubs/'+encodeURIComponent(selectedClub);
 if(view==='post'||view==='editPost')return '/posts/'+selectedPost;
 if(view==='player')return '/players/'+encodeURIComponent(selectedPlayer);
 const paths={welcome:'/',discover:'/feed',clubs:'/clubs',members:'/players',guides:'/guides',lfg:'/teams',games:'/games',events:'/events',tournaments:'/tournaments',account:'/account',direct:'/messages',notifications:'/notifications',reports:'/reports',saved:'/saved',drafts:'/drafts',search:'/search',rules:'/rules'};
 let path=paths[view]||'/';
 if(view==='tournaments'&&selectedTournamentId){path+='?id='+selectedTournamentId;if(selectedTournamentMatch)path+='&round='+selectedTournamentMatch.round+'&slot='+selectedTournamentMatch.slot;}
 if(view==='events'&&eventState.id)path+='?id='+eventState.id;
 if(view==='lfg'&&selectedLfgId)path+='?id='+selectedLfgId;
 if(view==='discover'&&homeTab!=='overview')path+='?tab='+homeTab;
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
 const labels=window.WRProfiles.roles;
 return '<article class="panel member-card"><div class="member-card-head">'+mediaUI.avatar(m.avatarId,m.name,true)+'<div><h2><a data-route href="/players/'+esc(m.id)+'">'+esc(m.name)+'</a></h2><small>@'+esc(m.handle)+'</small></div></div>'+(m.isBot?'<span class="bot-badge">Бот · демо</span>':'<span class="pill">Участник сообщества</span>')+'<p>'+esc(m.bio||'Игрок Wild Rift')+'</p><div class="role-chips">'+(m.gameProfile?.roles||[]).map(r=>'<span class="pill">'+window.WRProfiles.roleLabel(r)+'</span>').join('')+'</div><a class="btn quiet" data-route href="/players/'+esc(m.id)+'">Посмотреть профиль ↗</a></article>';
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
  return `<div class="auth-shell"><div class="pagehead"><div><h1>Добро пожаловать</h1><p class="muted">${authReturn?.view==='events'?'Войди, чтобы занять роль на игровом вечере и общаться с составом.':authReturn?.view==='lfg'?'Войди, чтобы подать заявку в команду и познакомиться с игроками.':'Вступай в клубы, делись опытом и знакомься с игроками.'}</p></div></div><div class="auth-switch" role="group" aria-label="Вход или регистрация"><button type="button" data-auth-switch="login" aria-pressed="${authMode==='login'}">Вход</button><button type="button" data-auth-switch="register" aria-pressed="${authMode==='register'}">Регистрация</button></div><div class="auth-grid"><form id="login" class="panel" ${authMode==='login'?'':'hidden'}><h2>Вход</h2><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false"></label><label class="field">Пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label>${errorLine}<button class="btn primary">Войти</button></form><form id="register" class="panel" ${authMode==='register'?'':'hidden'}><h2>Регистрация</h2><label class="field">Имя<input name="name" required maxlength="40" autocomplete="nickname"></label><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username" autocapitalize="none" spellcheck="false"></label><label class="field">Пароль — минимум 12 символов<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Создать аккаунт</button><p class="form-note">После регистрации сохрани резервные коды в профиле. Без заранее сохранённого кода восстановить забытый пароль нельзя. Не используй пароль от игры.</p></form></div><details class="auth-recovery"><summary>Восстановить доступ</summary><form id="recover"><h2>Восстановление доступа</h2><p class="note">Нужен один из резервных кодов, сохранённых заранее. После смены пароля все прежние сеансы завершатся.</p><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false"></label><label class="field">Резервный код<input name="code" required maxlength="40" autocomplete="off" spellcheck="false"></label><label class="field">Новый пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Сменить пароль</button></form></details><p class="auth-footnote">Независимое сообщество Wild Rift. Пароль от игрового аккаунта не нужен.</p></div>`;
}
function recoverySettings(remaining) {
  return `<section class="panel"><h2>Восстановление доступа</h2><p class="note">Осталось резервных кодов: <span data-recovery-count>${remaining}</span>. Каждый код заменяет забытый пароль один раз. Сохрани их отдельно от пароля и никому не передавай.</p><form id="recoveryCodes"><label class="field">Текущий пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label><p class="note">Новый набор отменяет все прежние коды. Коды показываются только один раз; сохрани их до ухода с этой страницы. Если ответ потерялся, создай новый набор.</p>${errorLine}<button class="btn primary">Создать новый набор</button><div data-recovery-result></div></form></section>`;
}
function sessionCard(s){return `<article class="comment" data-session-row="${esc(s.id)}"><strong>${s.current?'Текущий сеанс':'Другой сеанс'}</strong><p class="note">Действует до ${esc(new Date(s.expiresAt).toLocaleString('ru-RU'))}</p><button class="btn quiet" data-revoke-session="${esc(s.id)}" data-current-session="${s.current?'1':'0'}">Завершить ${s.current?'этот':'сеанс'}</button></article>`;}
function accountSecurity(data){return `<section class="panel"><h2>Сменить пароль</h2><form id="changePassword"><p class="note">Все прежние сеансы и резервные коды будут отозваны. Этот браузер получит новый сеанс. После смены создай новые резервные коды.</p><label class="field">Текущий пароль<input name="currentPassword" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label><label class="field">Новый пароль<input name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label class="field">Повтори новый пароль<input name="repeatPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Сменить пароль</button></form></section><section class="panel"><h2>Активные сеансы</h2><p class="note">Сервис пока не сохраняет названия устройств. Завершение сеанса отзывает его доступ к аккаунту.</p><div data-session-list>${data.sessions.map(sessionCard).join('')}</div>${data.next?`<button class="btn quiet" data-session-more="${esc(data.next)}">Ещё сеансы</button>`:''}</section>`;}
const initials = name => esc(String(name || 'WR').trim().split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]).join('').toUpperCase());
function clubCard(c) {
  const tone = [...c.id].reduce((sum,x)=>sum+x.charCodeAt(0),0)%4;
  return `<article class="club-card editorial-club ${c.cover_id?'has-cover':'no-cover'} tone-${tone} accent-${esc(c.accent||'azure')}" data-club-card data-search="${esc((c.name+' '+c.description+' '+(c.tags||[]).join(' ')).toLowerCase())}"><div class="club-cover">${c.cover_id?`<img src="/api/media/${esc(c.cover_id)}" alt="Обложка ${esc(c.name)}" loading="lazy">`: ''}<span class="cover-label">${c.isDemoClub?'ДЕМО · ':''}${c.access==='request'?'ПО ЗАЯВКАМ':'ОТКРЫТЫЙ КЛУБ'}</span><span class="club-emblem" aria-hidden="true">${initials(c.name)}</span></div><div class="club-content"><h3>${esc(c.name)}</h3><p>${esc(c.description)||'Место для общения и совместных игр.'}</p><div class="club-card-tags">${(c.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</div><div class="club-activity">${c.lastPost?`<a data-route href="/posts/${c.lastPost.id}">Последнее обсуждение: ${esc(c.lastPost.title)}</a><small>${esc(new Date(c.lastPost.created_at).toLocaleDateString('ru-RU'))}</small>`:c.access==='open'?'<span>Первые обсуждения ещё впереди</span>':'<span>Обсуждения доступны участникам</span>'}</div><div class="member-line"><span>${memberCount(c)}</span>${c.membership?`<span class="membership">${({member:'Ты в клубе',pending:'Заявка отправлена',banned:'Доступ ограничен'})[c.membership]||''}</span>`:''}</div><button class="btn quiet" data-open="${esc(c.id)}">Открыть клуб <span aria-hidden="true">↗</span></button></div></article>`;
}

function shareButton(path,label='Скопировать ссылку'){return '<button type="button" class="text-link share-link" data-share="'+esc(path)+'" aria-label="'+esc(label)+'">↗ Ссылка</button>';}
function postText(p){const chars=Array.from(p.body||''),short=view!=='post'&&chars.length>360;return '<p class="content">'+esc(short?chars.slice(0,360).join('').trimEnd()+'…':p.body)+'</p>'+(short&&!p.guide?'<a class="text-link read-story" data-route href="/posts/'+p.id+'">Читать полностью →</a>':'');}
function starterSteps(){
 if(!user)return '';const ready=Boolean(user.bio?.trim()&&user.gameProfile?.roles?.length),joined=clubs.some(c=>c.membership==='member');if(ready&&joined)return '';
 return '<aside class="starter-panel editorial-start"><p>Чуть больше о себе — и компанию будет проще найти.</p><div class="starter-steps">'+(!ready?'<button data-nav="account" class="text-link starter-step">Заполнить профиль</button>':'')+(!joined?'<button data-nav="clubs" class="text-link starter-step">Выбрать клуб</button>':'')+'</div></aside>';
}
function clubSpotlight(){
 const items=clubs.filter(c=>c.access==='open'&&c.membership!=='banned').slice(0,3);if(!items.length)return '';
 return '<section class="club-spotlight"><div class="section-head"><div><span class="tiny-label">ОБЩИЕ ИНТЕРЕСЫ. СВОЯ АТМОСФЕРА.</span><h2>С чего начнётся твоя история?</h2></div><button class="text-link" data-nav="clubs">Все клубы →</button></div><div class="spotlight-rail">'+items.map((c,i)=>'<a data-route href="/clubs/'+esc(c.id)+'" class="spotlight-card accent-'+esc(c.accent||'azure')+'">'+(c.cover_id?'<img src="/api/media/'+esc(c.cover_id)+'" alt="" loading="lazy">':'')+'<span class="spotlight-number">0'+(i+1)+'</span><div class="spotlight-copy"><span class="spotlight-topic">'+esc(c.tags?.[0]||'Общение')+(c.isDemoClub?' · Демо':'')+'</span><h3>'+esc(c.name)+'</h3><p>'+esc(c.description)+'</p><span class="spotlight-bottom">'+memberCount(c)+' <b aria-hidden="true">↗</b></span></div></a>').join('')+'</div></section>';
}
function clubFilterHTML(){
 const tags=clubCatalog.tags,advanced=clubFilter.scope!=='all'||clubFilter.sort!=='new';
 return '<section class="club-browser"><label class="club-search">Поиск клубов<input type="search" id="clubSearch" placeholder="Название или интересы" autocomplete="off" value="'+esc(clubFilter.q)+'"></label><div class="interest-filters" role="group" aria-label="Интересы"><button class="filter-chip" data-club-tag="" aria-pressed="'+!clubFilter.tag+'">Все темы</button>'+tags.map(tag=>'<button class="filter-chip" data-club-tag="'+esc(tag)+'" aria-pressed="'+(clubFilter.tag===tag)+'">'+esc(tag)+'</button>').join('')+'</div><div class="catalog-filter-line"><details class="club-advanced" '+(advanced?'open':'')+'><summary>Фильтры и порядок</summary><div class="club-advanced-fields"><label class="field club-sort">Порядок<select id="clubSort"><option value="new" '+(clubFilter.sort==='new'?'selected':'')+'>Сначала новые</option><option value="discussion" '+(clubFilter.sort==='discussion'?'selected':'')+'>По свежим обсуждениям</option><option value="name" '+(clubFilter.sort==='name'?'selected':'')+'>По названию</option></select></label><div class="club-scopes" role="group" aria-label="Доступ к клубу">'+[['all','Все клубы'],['open','Открытые'],...(user?[['mine','Мои клубы']]:[])].map(([key,label])=>'<button class="filter-chip" data-club-scope="'+key+'" aria-pressed="'+(clubFilter.scope===key)+'">'+label+'</button>').join('')+'</div><button class="text-link" data-club-reset>Сбросить фильтры</button></div></details><span id="clubResultCount" role="status"></span></div></section>';
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
  const empty=$('#noClubResults'),filtered=Boolean(clubFilter.q||clubFilter.tag||clubFilter.scope!=='all');
  empty.querySelector('h2').textContent=filtered?'Пока нет совпадений':'Первый клуб может быть твоим';
  empty.querySelector('p').textContent=filtered?'Попробуй другую тему или название.':'Собери друзей или создай место для новых знакомств.';
  empty.querySelector('[data-club-reset]').hidden=!filtered;
  $('#clubResultCount').textContent='Показано '+items.length+' из '+data.total+' клубов';
  if(button){button.hidden=!data.next;button.disabled=false;}
  document.querySelectorAll('[data-club-tag]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.clubTag===clubFilter.tag)));
  document.querySelectorAll('[data-club-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.clubScope===clubFilter.scope)));
 }catch(e){if(version===requestVersion&&request===catalogRequest){notify(e.message);if(button)button.disabled=false;}}
}

function clubCards() {
  return `<section class="club-catalog"><header class="catalog-heading"><div><h1>Найди свой круг</h1><p class="muted">Люди и разговоры по твоим интересам.</p></div>${user?'<button class="text-link" data-club-create-open aria-label="Создать клуб">+ Создать</button>':''}</header>${clubFilterHTML()}<div class="club-grid">${clubCatalog.clubs.map(clubCard).join('')}</div><button id="clubMore" class="btn quiet wide" data-clubs-more hidden>Ещё клубы</button><div id="noClubResults" class="catalog-empty ${clubCatalog.clubs.length?'hidden':''}"><h2>${clubFilter.q||clubFilter.tag||clubFilter.scope!=='all'?'Пока нет совпадений':'Первый клуб может быть твоим'}</h2><p>${clubFilter.q||clubFilter.tag||clubFilter.scope!=='all'?'Попробуй другую тему или название.':'Собери друзей или создай место для новых знакомств.'}</p><button class="text-link" data-club-reset>Показать все клубы</button></div>${user?`<details class="catalog-create"><summary>Начать свой клуб <span aria-hidden="true">+</span></summary><form id="createClub"><h2>Создать клуб</h2><p class="note">Выбери название и реши, как принимать участников.</p><label class="field">Название<input name="name" required minlength="2" maxlength="80" placeholder="Как назовём вашу компанию?"></label><label class="field">Описание<textarea name="description" maxlength="1000" placeholder="Кого ждёте и во что любите играть?"></textarea></label><label class="field">Доступ<select name="access"><option value="open">Открытый — вступление сразу</option><option value="request">По заявкам — посты только участникам</option></select></label>${errorLine}<button class="btn primary">Создать</button></form></details>`:'<aside class="catalog-join"><p>Твоя компания может начаться здесь.</p><button class="btn primary" data-nav="account">Присоединиться</button></aside>'}</section>`;
}
function profile() {
  const mine=clubs.filter(c=>c.membership==='member');
  const clubRow=c=>`<button class="profile-club" data-open="${esc(c.id)}"><span class="profile-club-cover">${c.cover_id?`<img src="/api/media/${encodeURIComponent(c.cover_id)}" alt="" loading="lazy">`:initials(c.name)}</span><span><strong>${esc(c.name)}</strong>${c.description?`<small>${esc(Array.from(c.description).slice(0,100).join(''))}${Array.from(c.description).length>100?'…':''}</small>`:''}</span><span aria-hidden="true">↗</span></button>`;
  const actions=`<div class="account-actions"><button type="button" class="btn primary" data-account-section="editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l4-1 12-12-4-4L4 15v5Z"/></svg>Редактировать профиль</button><button type="button" class="btn quiet" data-account-section="security">Настройки</button></div>`;
  const profileLinks=`<details class="account-profile-links"><summary>Публичная страница и ссылка</summary><div data-profile-public-actions>${user.profileVisible?`<button type="button" class="text-link" data-player="${esc(user.id)}">Публичная страница</button>${shareButton('/players/'+user.id,'Скопировать ссылку на профиль')}`:'<span class="note">Твоя страница скрыта от других игроков.</span>'}</div></details>`;
  return `<section class="account-page"><h1 class="sr-only">Мой профиль</h1>${sanctionNotice()}${mediaUI.showcase(user,true,actions)}<section class="account-visibility" aria-label="Видимость профиля"><div><strong data-profile-visibility-title>${user.profileVisible?'Публичный профиль':'Профиль скрыт'}</strong><p data-profile-visibility-note>${user.profileVisible?'Другие игроки смогут найти тебя.':'Эту страницу видишь только ты.'}</p></div><label class="profile-visibility-switch"><input type="checkbox" role="switch" data-profile-visibility aria-label="Показывать профиль другим игрокам" ${user.profileVisible?'checked':''}><span aria-hidden="true"></span></label><p class="error" data-profile-visibility-error role="alert"></p></section><section class="account-clubs"><div class="section-head"><h2>Мои клубы</h2><button class="text-link" data-nav="clubs">Все клубы</button></div>${mine.length?mine.slice(0,2).map(clubRow).join('')+(mine.length>2?`<details class="account-more-clubs"><summary>Все мои клубы (${mine.length})</summary>${mine.slice(2).map(clubRow).join('')}</details>`:''):'<div class="compact-empty"><p>Клуб объединяет твои интересы и разговоры. Выбери тот, где хочется остаться.</p><button class="btn quiet" data-nav="clubs">Найти клуб</button></div>'}</section><div class="account-library"><button class="account-shortcut" data-nav="saved"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg><strong>Сохранённые публикации</strong><small>Материалы, к которым хочется вернуться.</small><span aria-hidden="true">›</span></button><button class="account-shortcut" data-nav="drafts"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7"/></svg><strong>Черновики</strong><small>Твои неопубликованные материалы.</small><span aria-hidden="true">›</span></button></div>${profileLinks}<details class="account-section" data-account-editor ${accountUI.editor?'open':''}><summary>О себе и игровой профиль</summary>${mediaUI.editor(user,errorLine)}</details><details class="account-section" data-account-security ${accountUI.security?'open':''}><summary>Пароль, сеансы и восстановление</summary><div data-account-security-content></div><section class="account-signout"><h2>Выход из аккаунта</h2><p class="note">«Выйти везде» завершит все текущие сеансы, включая этот.</p><div class="row wrap"><button class="btn quiet" data-logout="/api/logout">Выйти здесь</button><button class="btn quiet" data-logout="/api/logout-all">Выйти везде</button></div></section></details></section>`;
}
async function loadAccountSecurity(){
 const viewer=user?.id,version=requestVersion;
 const [codes,sessions]=await Promise.allSettled([api('/api/recovery-codes'),api('/api/sessions')]);
 if(version!==requestVersion||user?.id!==viewer)return;
 for(const r of [codes,sessions])if(r.status==='rejected'&&[401,403].includes(r.reason.status))throw r.reason;
 if(sessions.status==='fulfilled'&&sessions.value.viewerId!==viewer)throw Error('Сеанс изменился. Обнови страницу.');
 const failed=[codes,sessions].some(r=>r.status==='rejected');
 const unavailable=r=>`<p class="error" role="alert">${esc(r.reason.message)}</p>`;
 return (sessions.status==='fulfilled'?accountSecurity(sessions.value):`<section class="panel"><h2>Безопасность аккаунта</h2>${unavailable(sessions)}</section>`)+(codes.status==='fulfilled'?recoverySettings(codes.value.remaining):`<section class="panel"><h2>Восстановление доступа</h2>${unavailable(codes)}</section>`)+(failed?'<button type="button" class="btn quiet" data-account-security-retry>Повторить загрузку настроек</button>':'');
}

function feedCard(p) {
  return `<div class="feed-entry"><button class="feed-club" data-open="${esc(p.club_id)}">${esc(p.club_name)} <span aria-hidden="true">↗</span></button>${postHTML(p).replace(`data-comments="${p.id}"`,()=>`data-comment-club="${esc(p.club_id)}" data-comments="${p.id}"`)}</div>`;
}
function feedSection(feed) {
 const mine=clubs.find(c=>c.membership==='member');
 return `<section class="community-feed conversation-feed"><div class="section-head"><h2>Публикации</h2></div><div id="feedPosts">${feed.posts.map(feedCard).join('')||`<div class="home-empty compact-empty"><h2>Начнём разговор?</h2><p>Обсуди матч, задай вопрос или поделись находкой в своём клубе.</p>${mine?`<button class="btn primary" data-home-compose="${esc(mine.id)}">Написать публикацию</button>`:'<button class="btn quiet" data-nav="clubs">Выбрать клуб</button>'}</div>`}</div>${feed.next?`<button class="btn quiet wide" data-feed-more="${esc(feed.next)}">Ещё обсуждения</button>`:''}</section>`;
}
function homeNavigation(){
 return '<nav class="home-navigation" aria-label="Лента сообщества">'+[['overview','Обзор'],['conversations','Разговоры'],['play','Играем']].map(([tab,label])=>`<a href="/feed${tab==='overview'?'':'?tab='+tab}" data-route ${homeTab===tab?'aria-current="page"':''}>${label}</a>`).join('')+'</nav>';
}
function homeCover(home){
 const mine=home?.myClubs?.[0]||clubs.find(c=>c.membership==='member');
 return `<section class="welcome-hero community-hero editorial-cover ${user?'home-welcome':''}"><img class="editorial-cover-image" src="/community-cover.webp?v=0813b535c523848ce247" width="1774" height="887" alt="" fetchpriority="high"><div class="editorial-cover-copy"><span class="cover-kicker">Твоё сообщество Wild Rift</span><h1>Между<br>матчами</h1><p>${user?'С возвращением, '+esc(user.name)+'.':'Люди, с которыми хочется играть, разговаривать и оставаться на связи.'}</p><div class="row wrap cover-actions">${mine?`<button class="btn cover-button" data-open="${esc(mine.id)}">Открыть мой клуб <span aria-hidden="true">↗</span></button><button class="text-link cover-compose" data-home-compose="${esc(mine.id)}">Написать</button>`:'<button class="btn cover-button" data-nav="clubs">Найти свой клуб <span aria-hidden="true">↗</span></button>'}</div></div></section>`;
}
function homeStories(feed){
 const pool=feed.posts,posts=[],illustrated=pool.find(p=>p.image_id);
 // Overview mixes one recent post with an illustrated story and a discussion.
 // The full Conversations tab keeps the chronological API order.
 for(const p of [pool[0],illustrated,pool.find(p=>!p.poll&&p.id!==illustrated?.id),...pool])if(p&&!posts.some(x=>x.id===p.id)&&posts.length<3)posts.push(p);
 return `<section class="home-stories"><div class="section-head"><h2>В сообществе</h2><a href="/feed?tab=conversations" class="text-link" data-route>Все обсуждения</a></div>${posts.length?posts.map(p=>`<article class="story-row"><div class="story-copy"><div class="story-byline">${mediaUI.avatar(p.author_avatar_id,p.author_name)}<span>${esc(p.author_name)}<small>${esc(p.club_name)} · <time datetime="${esc(new Date(p.created_at).toISOString())}">${esc(new Date(p.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}))}</time></small></span>${p.isBot?'<span class="bot-badge">Бот</span>':''}</div><h3><a href="/posts/${p.id}" data-route>${esc(p.title)}</a></h3><p>${esc(Array.from(p.body||'').slice(0,140).join(''))}${Array.from(p.body||'').length>140?'…':''}</p><div class="story-actions"><a href="/posts/${p.id}" class="text-link story-read" data-route>Обсудить <span aria-hidden="true">↗</span></a><a href="/posts/${p.id}" class="story-reactions" data-route aria-label="${esc(p.title)}: ${Number((p.reactions||[]).reduce((n,r)=>n+Number(r.count||0),0))} реакций"><span aria-hidden="true">♡</span> ${(p.reactions||[]).reduce((n,r)=>n+Number(r.count||0),0)}</a></div></div>${p.image_id?`<a href="/posts/${p.id}" data-route class="story-image" aria-label="${esc(p.title)}"><img src="/api/media/${esc(p.image_id)}" alt="" loading="lazy" width="180" height="180"></a>`:''}</article>`).join(''):'<div class="home-empty compact-empty"><p>Здесь появятся разговоры игроков. Первый можно начать в своём клубе.</p><button class="text-link" data-nav="clubs">Выбрать клуб</button></div>'}</section>`;
}
function homePeople(people){
 if(!people?.members?.length)return '';
 return `<section class="home-people people-panel"><div class="section-head"><h2>Найди своих</h2><button class="text-link" data-nav="members">Все игроки</button></div><div class="people-faces">${people.members.slice(0,6).map(m=>`<a href="/players/${esc(m.id)}" data-route class="people-face">${mediaUI.avatar(m.avatarId,m.name)}<strong>${esc(m.name)}</strong>${m.isBot?'<span class="bot-badge">Бот</span>':''}</a>`).join('')}</div>${people.bots?`<p class="demo-disclosure">${plural(people.bots,'демонстрационный бот','демонстрационных бота','демонстрационных ботов')}. Они не участвуют в матчах и не отвечают на сообщения.</p>`:''}</section>`;
}
function discoverPage(feed,home,homeError,people,preview,previewError){
 const navigation=homeNavigation();
 const error=(homeError?'<p class="home-status" role="alert">Личные встречи и группы не загрузились. <button class="text-link" data-nav="discover">Повторить</button></p>':'')+(previewError?'<p class="home-status" role="alert">Открытые события не загрузились. <button class="text-link" data-nav="discover">Повторить</button></p>':'');
 if(homeTab==='conversations'){
  const mine=clubs.find(c=>c.membership==='member');
  return `${navigation}<header class="conversation-heading"><h1>Разговоры</h1><p class="muted">Публикации из доступных тебе клубов.</p></header><div class="conversation-toolbar"><button class="btn quiet" data-search-open>Поиск обсуждений</button><button class="text-link" data-guide-catalog>Руководства</button><button class="text-link" data-nav="saved">Сохранённое</button>${user?mine?`<button class="btn primary" data-home-compose="${esc(mine.id)}">Написать</button>`:'<button class="btn primary" data-nav="clubs">Выбрать клуб</button>':'<button class="btn primary" data-nav="account">Войти и ответить</button>'}</div>${feedSection(feed)}`;
 }
 if(homeTab==='play')return `${navigation}<header class="conversation-heading"><h1>Играем вместе</h1><p class="muted">Собери компанию на матч или запланируй игровой вечер.</p></header>${error}${personalHome(home,preview,false,Boolean(homeError||previewError))}`;
 return `${navigation}${homeCover(home)}${error}${homeStories(feed)}${user?starterSteps():''}${homePeople(people)}${home?.myClubs?.length?`<section class="home-clubs"><div class="section-head"><h2>Мои клубы</h2><button class="text-link" data-nav="account">Все мои клубы</button></div><div class="home-club-grid">${home.myClubs.slice(0,3).map(c=>`<button class="profile-club" data-open="${esc(c.id)}"><span class="avatar">${initials(c.name)}</span><span>${esc(c.name)}<small>${memberCount(c)}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</div></section>`:''}${personalHome(home,preview,true)}<div class="home-shortcuts"><button class="text-link" data-nav="clubs">Клубы</button><button class="text-link" data-nav="guides">Руководства игроков</button><a class="text-link" href="/feed?tab=play" data-route>Игровые вечера</a></div>`;
}
function personalHome(home,preview,compact,loadFailed=false){
 const modes={ranked:'Ранкед',normal:'Обычная',aram:'ARAM',custom:'Своя игра'},roles={...window.WRProfiles.roles,any:'Любая роль'};
 const date=ms=>esc(new Date(ms).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}));
 const events=home?.events?.length?home.events:preview?.events||[],groups=home?.groups||[],mine=home?.myGroups||[];
 const p=home?.preferences||{},reasons=[p.region&&'регион: '+p.region,p.language&&'язык: '+p.language,p.roles?.length&&'роли: '+p.roles.map(r=>roles[r]).join(', '),p.rank&&'ранг: '+p.rank,p.microphone==='no'&&'без обязательного голоса'].filter(Boolean);
 const eventCard=e=>`<article class="home-game editorial-event"><div class="event-date-block"><strong>${esc(new Date(e.starts_at).getDate())}</strong><span>${esc(new Date(e.starts_at).toLocaleDateString('ru-RU',{month:'short'}))}</span></div><div class="event-copy"><span class="note">${esc(modes[e.mode])}</span><h3>${esc(e.title)}</h3><p>${date(e.starts_at)}${e.myRole?' · твоя роль: '+window.WRProfiles.roleLabel(e.myRole):''}</p><button class="btn primary" ${user?`data-home-event="${e.id}"`:`data-preview-join="${e.id}" data-preview-kind="events"`}>${e.myRole?'К составу и чату':'Посмотреть событие'}</button></div></article>`;
 const groupCard=(g,isMine=false)=>`<article class="home-game editorial-group"><div><span class="note">${esc(modes[g.mode])} · ${isMine?(g.membership==='pending'?'Заявка отправлена':'Ты в группе'):(g.available??g.capacity-g.members)+' свободных мест'}</span><h3>${esc(g.title)}</h3><p class="note">${esc(g.region)} · ${esc(g.language)} · ${window.WRProfiles.roleLabel(g.role)} · ${esc(g.rank||'Любой ранг')}</p></div><button class="btn quiet" ${user?`data-home-group="${g.id}"`:`data-preview-join="${g.id}" data-preview-kind="lfg"`}>Открыть группу</button></article>`;
 let html=events.length?`<section class="home-plans"><div class="section-head"><h2>${home?.events?.length?'Мои игровые вечера':'Ближайшие вечера'}</h2><button class="text-link" data-nav="events">Все события</button></div>${events.slice(0,compact?1:3).map(eventCard).join('')}</section>`:'';
 if(mine.length&&!compact)html+=`<section class="home-groups"><div class="section-head"><h2>Мои группы и заявки</h2><button class="text-link" data-nav="lfg">Все группы</button></div>${mine.map(g=>groupCard(g,true)).join('')}</section>`;
 if(groups.length)html+=`<section class="home-matches"><div class="section-head"><h2>${reasons.length?'Подходящие группы':'Свободные группы'}</h2><button class="text-link" data-nav="lfg">Весь поиск</button></div><p class="note">${reasons.length?'По твоему профилю: '+esc(reasons.join(', '))+'.':'Группы со свободными местами.'} Поля указаны игроками; совместимость очереди не проверяется.</p>${groups.slice(0,compact?2:4).map(g=>groupCard(g)).join('')}</section>`;
 if(!compact){
  if(!user&&preview?.groups?.length)html+=`<section class="home-groups"><div class="section-head"><h2>Открытые группы</h2><button class="text-link" data-nav="lfg">Все группы</button></div>${preview.groups.map(g=>groupCard(g)).join('')}</section>`;
  const empty=!loadFailed&&!events.length&&!groups.length&&!mine.length&&!preview?.groups?.length;
  html+=`<section class="play-invitation ${empty?'compact-empty':''}">${empty?'<h2>Встретимся в Рифте?</h2><p>Пока нет подходящих вечеров и групп. Предложи свою игру.</p>':''}<div class="row wrap"><button class="btn primary" ${user?'data-home-create-event':'data-preview-start="events"'}>Запланировать вечер</button><button class="btn quiet" ${user?'data-home-create-group':'data-preview-start="lfg"'}>Собрать группу</button><button class="text-link" data-nav="lfg">Поиск игроков и групп</button><button class="text-link" data-nav="events">Все события</button><button class="text-link" data-nav="tournaments">Турниры</button></div></section>`;
 }
 return html;
}
function playNavigation(selected){return `<nav class="play-section-nav" aria-label="Играем вместе"><a data-route href="/games" ${selected==='games'?'aria-current="page"':''}>Мои игры</a><a data-route href="/teams" ${selected==='lfg'?'aria-current="page"':''}>Поиск компании</a><a data-route href="/events" ${selected==='events'?'aria-current="page"':''}>Игровые вечера</a><a data-route href="/tournaments" ${selected==='tournaments'?'aria-current="page"':''}>Турниры</a></nav>`;}
function announcementPreview(data,kind) {
 const events=kind==='events',items=events?data.events:data.groups;
 if(events)return `<section class="public-events"><header class="catalog-heading events-heading events-hero"><div><h1>Игровые вечера</h1><p class="muted">Выбери встречу или собери свою компанию.</p></div><button class="btn quiet" data-preview-start="events">Создать событие</button></header><p class="note">Время на твоём устройстве. Здесь показано до шести ближайших встреч.</p><div class="editorial-event-list">${items.map(e=>`<article class="event-card editorial-event-row"><time class="event-calendar" datetime="${esc(new Date(e.starts_at).toISOString())}"><strong>${new Date(e.starts_at).getDate()}</strong><span>${esc(new Date(e.starts_at).toLocaleDateString('ru-RU',{month:'short'}))}</span><small>${esc(new Date(e.starts_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}</small></time><div class="event-row-copy"><span class="tiny-label">${esc({ranked:'Ранкед',normal:'Обычная',aram:'ARAM',custom:'Своя игра'}[e.mode])}</span><h2>${esc(e.title)}</h2><p class="event-row-meta">${esc(e.region)} · ${esc(e.language)}</p><p class="event-spaces">${e.available?'Свободных мест: '+e.available:'Состав собран'}</p><button class="btn quiet" data-preview-join="${e.id}" data-preview-kind="events">Посмотреть</button></div></article>`).join('')||'<section class="finder-empty event-empty"><h2>Первый вечер может быть твоим</h2><p>Выбери время и пригласи компанию. После входа можно создать встречу или занять свободное место.</p><button class="btn primary" data-preview-start="events">Запланировать вечер</button></section>'}</div><p class="preview-note">Для записи нужен аккаунт. Имена состава и чат доступны участникам встречи.</p></section>`;
 const modes={ranked:'Ранкед',normal:'Обычная',aram:'ARAM',custom:'Своя игра'},roles={any:'Любая роль',...window.WRProfiles.roles};
 return `<div class="pagehead"><div><span class="tiny-label">ИГРАЕМ ВМЕСТЕ</span><h1>${events?'Игровые вечера':'С кем играем?'}</h1><p class="muted">${events?'Выбери встречу и проведи вечер со своими.':'Найди компанию под свой режим и настроение.'}</p></div></div>${events?'':'<nav class="guest-finder-links" aria-label="Способ поиска"><span aria-current="page">Группы</span><a data-route href="/players">Люди сообщества →</a></nav>'}<div class="preview-grid ${events?'':'editorial-preview-groups'}">${items.map(g=>`<article class="panel announcement-card"><div class="row wrap"><span class="pill">${esc(modes[g.mode])}</span><span class="preview-spaces">${g.available?'Свободных мест: '+g.available:'Состав собран'}</span></div><h2>${esc(g.title)}</h2><p class="note">${esc(g.region)} · ${esc(g.language)}${g.role?' · '+window.WRProfiles.roleLabel(g.role):''}</p><p class="announcement-date">${esc(new Date(g.starts_at).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}))}</p><button class="btn primary" data-preview-join="${g.id}" data-preview-kind="${kind}">Войти и посмотреть →</button></article>`).join('')||`<section class="empty-state"><span class="empty-mark" aria-hidden="true">✦</span><h2>${events?'Первый вечер может быть твоим':'Сейчас нет открытых команд'}</h2><p>${events?'Запланируй игру, выбери роли и пригласи компанию.':'Создай свою группу или познакомься с игроками в клубах.'}</p><div class="row wrap"><button class="btn primary" data-preview-start="${kind}">${events?'Организовать вечер':'Собрать команду'}</button><button class="btn quiet" data-nav="clubs">К клубам</button></div></section>`}</div><p class="preview-note">Объявления доступны для просмотра. Для участия нужен аккаунт; чаты доступны участникам команды.</p>`;
}
function postHTML(p) {
  const member=clubs.some(c=>c.id===p.club_id&&c.membership==='member');
  return `<article class="panel ${p.guide?`guide-post ${view==='post'?'guide-expanded':''}`:''}"><div class="post-author">${mediaUI.avatar(p.author_avatar_id,p.author_name)}<div><button type="button" class="author-link" data-player="${esc(p.author_id)}">${esc(p.author_name)}</button> ${p.isBot?'<span class="bot-badge">Бот</span>':''}<small>${esc(new Date(p.created_at).toLocaleString('ru-RU'))}${p.edited_at?` · <span title="${esc(new Date(p.edited_at).toLocaleString('ru-RU'))}">Изменено</span>`:''}</small></div></div>${guideUI?.badge(p.guide)||''}<${view==='post'?'h1':'h3'} class="post-title">${view==='post'?esc(p.title):`<a data-route href="/posts/${p.id}">${esc(p.title)}</a>`}</${view==='post'?'h1':'h3'}>${p.isBot?'<p class="demo-disclosure">Демонстрационная публикация бота. Обсуждение открыто участникам клуба.</p>':''}${postText(p)}${p.guide&&view!=='post'?`<button class="btn quiet" data-guide-open="${p.id}">Читать руководство →</button>`:''}${mediaUI.image(p.image_id,'Изображение к публикации: '+p.title)}${pollUI?.card(p,user,member)||''}<div class="post-utilities">${shareButton('/posts/'+p.id,'Скопировать ссылку на публикацию')}${p.body.length>600?`<span class="reading-time">~${Math.max(1,Math.ceil(p.body.trim().split(/\s+/).length/180))} мин чтения</span>`:''}</div>${discussionUI.actions(p,user,member)}${view==='club'?clubUI.postTools(p,clubs.find(c=>c.id===p.club_id),clubPins.has(p.id),user):''}<div id="comments-${p.id}"></div></article>`;
}
function welcomeEntry(){return (user?'<p class="launch-greeting">С возвращением, <strong>'+esc(user.name)+'</strong></p><div class="launch-actions"><button class="launch-primary" data-nav="discover">Продолжить <span aria-hidden="true">↗</span></button><button class="launch-secondary" data-nav="clubs">Посмотреть клубы</button></div>':'<div class="launch-actions"><button class="launch-primary" data-auth-mode="register">Создать аккаунт <span aria-hidden="true">↗</span></button><button class="launch-secondary" data-auth-mode="login">Уже есть аккаунт? Войти</button></div><div class="launch-browse-row"><button class="launch-browse" data-nav="discover">Посмотреть без регистрации</button><button class="launch-browse" data-nav="clubs">Открытые клубы</button></div>');}
function welcomePage(){
 const art = [
  '<img class="launch-cover-image" src="/community-cover.webp?v=0813b535c523848ce247" alt="" fetchpriority="high">',
  '<div class="launch-visual launch-visual-team"><div class="launch-team-board"><span class="launch-ticket-label">НАЙДИ СВОЮ РОЛЬ</span><div class="launch-role-map">'+Object.keys(window.WRProfiles.roles).map(r=>'<span>'+window.WRProfiles.roleLabel(r)+'</span>').join('')+'</div><div class="launch-board-foot"><span>Регион</span><span>Язык</span><span>Роли</span></div></div><span class="launch-art-caption">КОМПАНИЯ ДЛЯ СЛЕДУЮЩЕГО МАТЧА</span></div>',
  '<div class="launch-visual launch-visual-clubs"><div class="launch-club-sheet launch-club-sheet-back"><span>ОБСУЖДЕНИЯ</span></div><div class="launch-club-sheet"><span class="launch-ticket-label">ТВОИ ИНТЕРЕСЫ</span><strong>Один клуб.<br>Много общего.</strong><div class="launch-sheet-lines"><span>Публикации</span><span>Общий чат</span><span>Правила клуба</span></div></div></div>',
  '<div class="launch-visual launch-visual-join"><span class="launch-join-symbol">W</span><div class="launch-join-word">Играй.<br>Общайся.<br><em>Оставайся.</em></div><span class="launch-art-caption">ТВОЁ МЕСТО МЕЖДУ МАТЧАМИ</span></div>'
 ];
 const cards = [
  ['ЗНАКОМИМСЯ','Твой Рифт.<br><em>Твои люди.</em>','Независимое сообщество игроков Wild Rift. Здесь находят напарников, вступают в клубы и обсуждают игру.'],
  ['ИГРАЕМ ВМЕСТЕ','Следующий матч.<br><em>Своя команда.</em>','Ищи компанию по региону, языку и игровым ролям. Создавай группу или подавай заявку в подходящую.'],
  ['НАХОДИМ СВОИХ','Твои интересы.<br><em>Твой клуб.</em>','Вступай в клубы, читай публикации и общайся в общем чате. Делись опытом и знакомься с другими игроками.'],
  ['ОСТАЁМСЯ НА СВЯЗИ','Больше, чем<br><em>один матч.</em>','Создай аккаунт, чтобы участвовать в сообществе. Или сначала посмотри открытые клубы и обсуждения без регистрации.']
 ];
 return '<section class="launch" aria-labelledby="launch-title"><header class="launch-header"><a class="launch-brand" href="/" aria-label="Wild Rift Community — начало"><span class="launch-brand-mark" aria-hidden="true">W</span><span>WILD RIFT<small>COMMUNITY</small></span></a><span class="launch-status">ИГРА ОБЪЕДИНЯЕТ</span></header><div class="launch-intro"><span>Твоё место между матчами</span><span class="launch-swipe-hint">Листай и знакомься <span aria-hidden="true">→</span></span></div><div class="launch-track" data-launch-track tabindex="0" role="region" aria-roledescription="карусель" aria-label="Знакомство с сообществом">'+cards.map((c,i)=>'<article class="launch-card launch-card-'+i+'" data-launch-card="'+i+'" role="group" aria-roledescription="карточка" aria-label="'+(i+1)+' из 4"'+(i?' aria-hidden="true"':'')+'><div class="launch-art" aria-hidden="true">'+art[i]+'</div><div class="launch-copy"><span class="launch-eyebrow">'+c[0]+'</span><'+(i?'h2':'h1 id="launch-title"')+'>'+c[1]+'</'+(i?'h2':'h1')+'><p class="launch-description">'+c[2]+'</p><span class="launch-card-number" aria-hidden="true">0'+(i+1)+' / 04</span></div></article>').join('')+'</div><div class="launch-controls"><button class="launch-arrow" data-launch-prev aria-label="Предыдущая карточка" disabled>←</button><div class="launch-steps" aria-label="Выбрать карточку">'+cards.map((c,i)=>'<button data-launch-step="'+i+'" aria-label="Карточка '+(i+1)+': '+['О сообществе','Поиск команды','Клубы','Присоединение'][i]+'"'+(i?'':' aria-current="step"')+'><span></span></button>').join('')+'</div><button class="launch-next" data-launch-next aria-label="Следующая карточка"><span class="launch-next-label">Далее</span><span aria-hidden="true">→</span></button></div><p class="launch-progress" data-launch-progress role="status" aria-live="polite" aria-atomic="true">Карточка 1 из 4: О сообществе</p><div class="launch-entry">'+welcomeEntry()+'</div><footer class="launch-footer"><span>Независимое сообщество. Не связано с Riot Games.</span><button data-nav="rules">Правила сообщества ↗</button></footer></section>';
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
  const editor=$('[data-account-editor]'),security=$('[data-account-security]');if(editor)accountUI.editor=editor.open;if(security)accountUI.security=security.open;
  $('#main').dataset.view=view;
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
  const activeNav={discover:'discover',clubs:'home',members:'people',club:'home',player:'people',account:'account',direct:'direct',reports:'reports',lfg:'lfg',games:'events',events:'events',tournaments:'events',drafts:'account',saved:'account',notifications:'notifications',post:'discover',editPost:'discover',search:'discover',guides:'discover',invite:'home'}[view];
  for(const button of document.querySelectorAll('.primary-nav button, #reports, #notifications')){if(button.id===activeNav)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  for(const button of document.querySelectorAll('.section-menu [data-nav]')){if(button.dataset.nav===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  const secondaryTitle={members:'Люди',player:'Люди',games:'Мои игры',events:'События',tournaments:'Турниры',guides:'Руководства',saved:'Сохранённое',drafts:'Черновики',notifications:'Уведомления',reports:'Жалобы',rules:'Правила'}[view];
  const menuLabel=$('[data-section-menu-label]');if(menuLabel)menuLabel.textContent=secondaryTitle||'Ещё';
  if(menu){menu.dataset.sectionActive=secondaryTitle?'true':'false';menu.querySelector('summary').setAttribute('aria-label',secondaryTitle?secondaryTitle+' · открыть остальные разделы':'Открыть остальные разделы');}
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
    if(user?.id!==session.user?.id){accountUI={editor:false,security:false};lfgState={};eventState={};if(!user&&view==='events'){const initialRoute=parseRoute(location.pathname,location.search);if(initialRoute?.view==='events')eventState.id=initialRoute.destinationId;}clubFilter={q:'',tag:'',scope:'all',sort:'new'};directDraftHandle='';composerUI?.reset();searchState={query:'',club:''};guideState={};}
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
    $('#notifications').hidden=!user;$('#reports').hidden=!user;if(!user)notificationBadge();
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
      $('#main').innerHTML='<section id="notificationRoot"></section>';chatController=createNotificationCenter($('#notificationRoot'),user);return;
    }
    if(view==='members'){
      const data=await api('/api/community-members?'+new URLSearchParams(memberState));if(version!==requestVersion||data.viewerId!==(user?.id||null))return;
      $('#main').innerHTML='<div class="pagehead"><div><span class="tiny-label">НАЙДИ СВОЙ КРУГ</span><h1>Люди сообщества</h1><p class="muted">Знакомься с участниками через их открытые профили и интересы.</p></div></div><form class="panel members-filter" data-members-filter><label class="field">Имя или логин<input type="search" name="q" maxlength="80" value="'+esc(memberState.q)+'" placeholder="Кого ищешь?"></label><label class="field">Роль<select name="role"><option value="">Все роли</option>'+Object.entries(window.WRProfiles.roles).map(([k,v])=>'<option value="'+k+'" '+(memberState.role===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><button class="btn primary">Найти</button></form><p class="note">'+plural(data.total,'открытый профиль','открытых профиля','открытых профилей')+(data.bots?' · '+plural(data.bots,'бот','бота','ботов'):'')+'</p>'+(data.bots?'<p class="demo-disclosure">Демонстрационные профили отмечены как боты. Они не играют матчи и не отвечают на сообщения.</p>':'')+'<div class="members-grid" id="communityMembers">'+(data.members.map(memberCard).join('')||'<div class="empty-state"><h2>Пока никого не нашли</h2><p>Попробуй другое имя или роль. В каталоге появляются только опубликованные профили.</p></div>')+'</div>'+(data.next?'<button class="btn quiet wide" data-members-more="'+esc(data.next)+'">Ещё участники</button>':'');return;
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
      selectedClub=data.post.club_id;$('#main').innerHTML=`<button class="back-link" data-nav="${postReturnView}">← ${({club:'К клубу',search:'К результатам поиска',discover:'На главную',saved:'К сохранённому',guides:'К руководствам'})[postReturnView]||'Ответы и упоминания'}</button><button class="post-club-context text-link" data-open="${esc(data.post.club_id)}">${esc(data.post.club_name||clubs.find(c=>c.id===data.post.club_id)?.name||'Открыть клуб')}</button>${postHTML(data.post)}`;await comments(selectedPost,selectedComment);return;
    }
    if(view==='discover'){
      const [feed,home,people,preview]=await Promise.all([api('/api/feed'),user?api('/api/home').then(data=>({data})).catch(error=>({error})):null,api('/api/community-members'),api('/api/community-preview').then(data=>({data})).catch(error=>({error}))]);
      if(version!==requestVersion)return;if(home?.data&&home.data.viewerId!==user.id)throw Error('Сеанс изменился. Обнови страницу.');
      $('#main').innerHTML=discoverPage(feed,home?.data,home?.error,people,preview?.data,preview?.error);return;
    }
    if(!user&&['events','lfg'].includes(view)){const data=await api('/api/community-preview');if(version!==requestVersion)return;$('#main').innerHTML=playNavigation(view)+announcementPreview(data,view);return;}
    if(view==='games'){$('#main').innerHTML=user?playNavigation('games')+'<section id=agendaRoot></section>':auth();if(user)chatController=createAgenda($('#agendaRoot'),user);return;}
    if(view==='tournaments'){$('#main').innerHTML=playNavigation('tournaments')+'<section id=tournamentsRoot></section>';chatController=window.createTournaments({root:$('#tournamentsRoot'),user,api,initialId:selectedTournamentId,initialMatch:selectedTournamentMatch,onSelect:id=>{selectedTournamentId=id;selectedTournamentMatch=null;},onChange:()=>{badgeSignature='';pollBadges();}});return;}
    if(view==='events'){$('#main').innerHTML=user?playNavigation('events')+'<section id=eventsRoot></section>':auth();if(user)chatController=window.createEvents({root:$('#eventsRoot'),user,api,state:eventState,onSelect:()=>history.replaceState(null,'',routePath())});return;}
    if(view==='lfg'){$('#main').innerHTML=user?playNavigation('lfg')+'<section id=lfgRoot></section>':auth();if(user)chatController=window.createLfg({root:$('#lfgRoot'),user,api,state:lfgState,initialId:selectedLfgId,onSelect:id=>{selectedLfgId=id;history.replaceState(null,'',routePath());}});return;}
    if (view === 'reports') {
      if(!user){$('#main').innerHTML=auth();return;}
      const mine=await api('/api/reports');
      const queue=user.isModerator?await api('/api/moderation/reports'):null;
      if(version!==requestVersion)return;
      $('#main').innerHTML=`<h1>Жалобы</h1><p class="note">Здесь обращения, решения и апелляции. Подтверждённые нарушения учитываются при санкциях; удаление материалов оформляется отдельным действием модератора.</p><h2>Мои обращения</h2><div id=ownReports>${mine.reports.map(ownReportCard).join('')||'<p>Обращений нет.</p>'}</div>${mine.next?`<button class="btn quiet" data-own-reports-more="${mine.next}">Ранее</button>`:''}${queue?`<h2>Очередь модерации</h2><div id="reportQueue">${queue.reports.map(reportCard).join('')}</div>${queue.next?`<button class="btn quiet" data-reports-more="${queue.next}">Ранее</button>`:''}`:''}`;
      return;
    }
    if (view === 'direct') { $('#main').innerHTML = user ? '<section id=directRoot></section>' : auth(); if(user){chatController = window.createDirectInbox({root:$('#directRoot'),user,api,initialHandle:directDraftHandle});directDraftHandle='';} return; }
    if(view==='player'){
      const data=await api('/api/profiles/'+selectedPlayer);if(version!==requestVersion)return;
      const p=data.profile;
      const actions=`<div class="account-actions public-profile-actions">${user?.id===p.id?'<button type="button" class="btn primary" data-nav="account">Мой профиль</button>':user&&!p.isBot?`<button type="button" class="btn primary" data-contact="${esc(p.handle)}">Написать игроку</button>`:!user?`<button type="button" class="btn primary" data-profile-signin="${esc(p.id)}">Войти в сообщество</button>`:''}</div>`;
      const navigation=`<div class="profile-page-toolbar"><button class="back-link" data-nav="${playerReturnView}">← ${playerReturnView==='lfg'?'К поиску напарников':playerReturnView==='members'?'К участникам':playerReturnView==='account'?'К аккаунту':'К обсуждениям'}</button>${shareButton('/players/'+p.id,'Скопировать ссылку на профиль')}</div>`;
      $('#main').innerHTML=`<h1 class="profile-page-title">Профиль игрока</h1>${mediaUI.showcase(p,false,actions,navigation)}${user&&user.id!==p.id?`<details class="public-profile-menu"><summary>Действия с профилем</summary><button type="button" class="btn quiet" data-report-object="profile" data-target-id="${esc(p.id)}">Пожаловаться на профиль</button></details>`:''}`;
      return;
    }
    if (view === 'account') {
      if (!user) { $('#main').innerHTML = auth(); return; }
      const securityHTML=await loadAccountSecurity();if(version!==requestVersion)return;
      $('#main').innerHTML=profile();$('[data-account-security-content]').innerHTML=securityHTML;return;
    }
    if (view === 'club') {
      const detail=await api(`/api/clubs/${selectedClub}/detail`);if(version!==requestVersion)return;const club=detail.club;
      const ci=clubs.findIndex(c=>c.id===club.id);if(ci>=0)clubs[ci]=club;else clubs.push(club);
      const member=club.membership==='member',owner=club.myRole==='owner',staff=['owner','moderator'].includes(club.myRole),canRead=club.membership!=='banned'&&(club.access==='open'||member);
      let subscriptionControl='';if(member){let enabled=false,failed=false;try{enabled=(await api(`/api/clubs/${club.id}/subscription`)).enabled;}catch{failed=true;}
       subscriptionControl=`<section class="panel"><h2>Публикации клуба</h2><p class="note">Получай уведомления о новых публикациях в этом клубе.</p><button class="btn quiet" data-club-subscription="${esc(club.id)}" data-enabled="${enabled}" aria-pressed="${enabled}" ${failed?'data-subscription-retry':''}>${failed?'Повторить загрузку':enabled?'Отключить уведомления':'Включить уведомления'}</button><p class="error" role="alert" data-subscription-error>${failed?'Не удалось загрузить настройку. Повтори попытку.':''}</p></section>`;
      }
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
      $('#main').innerHTML=`<div class="club-banner editorial-club-banner ${club.cover_id?'has-cover':'no-cover'} accent-${esc(club.accent)}"><button class="back-link" data-nav="clubs">← Все клубы</button>${club.cover_id?`<img class="club-banner-image" src="/api/media/${esc(club.cover_id)}" alt="Обложка клуба">`:''}<div class="club-banner-content"><span class="identity-avatar">${initials(club.name)}</span><div><span class="tiny-label">ТВОЁ МЕСТО В СООБЩЕСТВЕ</span><h1>${esc(club.name)}</h1><p>${esc(club.description)}</p></div></div></div><section class="panel club-overview"><div class="row wrap">${shareButton('/clubs/'+club.id,'Скопировать ссылку на клуб')}<span class="pill">${club.access==='open'?'Открытый клуб':'По заявкам'}</span><small>${memberCount(club)}</small>${club.isDemoClub?'<span class="bot-badge">Демо-клуб</span>':''}${club.myRole?`<span class="pill">${({owner:'Владелец',moderator:'Модератор',member:'Участник'})[club.myRole]}</span>`:''}${user&&!owner&&club.membership!=='banned'?`<button class="btn primary" data-membership="${member||club.membership==='pending'?'leave':'join'}">${member?'Выйти из клуба':club.membership==='pending'?'Отменить заявку':club.access==='open'?'Вступить':'Подать заявку'}</button>`:''}</div>${clubUI.about(club,user?.id)}${subscriptionControl}${!user?`<div class="club-join-cta"><p>Присоединись, чтобы отвечать и общаться в клубе.</p><button class="btn primary" data-club-signin="${esc(club.id)}">Войти, чтобы ${club.access==='open'?'вступить':'подать заявку'} →</button></div>`:''}${!canRead?'<p class="note">Содержимое доступно только принятым участникам.</p>':''}</section>${clubUI.transfer(detail.transfer,user)}${clubUI.tabs(club,clubTab)}${content}`;
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
    el.innerHTML=`<h2 class="discussion-heading">Обсуждение</h2>${focusedPage?`<p class="note">Комментарии до выбранного ответа. <button class="text-link" data-comments="${id}">Показать последние</button></p>`:''}<div data-comment-list="${id}">${data.comments.map(c=>discussionUI.comment({...c,post_id:id},member,user,data)).join('')||'<p class="note">Первый ответ может быть твоим.</p>'}</div>${data.next?`<button class="btn quiet" data-comments-more="${id}" data-after="${data.next}">Ранее</button>`:''}${member?discussionUI.editor(id,errorLine):'<p class="note">Для ответа нужно вступить в клуб.</p>'}`;
    if(focus){const target=el.querySelector(`[data-comment-id="${Number(focus)}"]`);target?.classList.add('comment-focused');target?.scrollIntoView?.({block:'center'});}
  }catch(e){if(version===requestVersion&&el.isConnected)el.innerHTML=`<p class="error">${esc(e.message)}</p><button class="btn quiet" data-comments="${id}">Повторить</button>`;}
}
function sendingAttempt(form,signature){
  if(form.dataset.sendSignature!==signature){form.dataset.sendSignature=signature;form.dataset.sendId=crypto.randomUUID();}
  return form.dataset.sendId;
}
$('#people').onclick=()=>{view='members';render();};
$('#discover').onclick=()=>{homeTab='overview';view='discover';render();};
if($('#events'))$('#events').onclick=()=>{view='events';render();};
$('#lfg').onclick=()=>{view='lfg';render();};
$('#notifications').onclick=()=>{view='notifications';render();};
$('#reports').onclick=()=>{view='reports';render();};
$('#direct').onclick = () => { view = 'direct'; render(); };
$('#home').onclick = () => { view = 'clubs'; render(); };
$('#guestJoin').onclick=()=>{authMode='login';authReturn=null;view='account';render();};
$('#account').onclick = () => { view = 'account'; render(); };
$('#cancelDelete').onclick = () => { pendingDelete = null; $('#confirmDialog').close(); };
$('#confirmDelete').onclick = async () => { if (!pendingDelete) return; const id = pendingDelete; pendingDelete = null; $('#confirmDialog').close(); try { await api(`/api/posts/${id}`, 'DELETE', {}); await render(); } catch (e) { notify(e.message); } };
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if(b.dataset.authSwitch){authMode=b.dataset.authSwitch;const shell=b.closest('.auth-shell');for(const form of shell.querySelectorAll('#login,#register'))form.hidden=form.id!==authMode;for(const tab of shell.querySelectorAll('[data-auth-switch]'))tab.setAttribute('aria-pressed',String(tab.dataset.authSwitch===authMode));shell.querySelector('#'+authMode+' input').focus();return;}
    if(b.dataset.accountSection){const el=$('[data-account-'+b.dataset.accountSection+']');if(el){el.open=true;el.querySelector('input,button')?.focus();el.scrollIntoView?.({block:'start'});}return;}
    if(b.hasAttribute('data-account-security-retry')){b.disabled=true;const version=requestVersion,el=$('[data-account-security-content]');try{const html=await loadAccountSecurity();if(version===requestVersion&&el.isConnected)el.innerHTML=html;}finally{b.disabled=false;}return;}
    if(b.dataset.profileSignin){authReturn={view:'player',id:b.dataset.profileSignin};authMode='login';view='account';await render();return;}
    if(b.dataset.authMode){authMode=b.dataset.authMode;authReturn=null;view='account';await render();const form=$('#'+b.dataset.authMode);form?.scrollIntoView?.({block:'center'});form?.querySelector('input')?.focus();return;}
    if(b.dataset.reportObject){
 const reason=prompt('Опиши нарушение (от 3 до 1000 символов).');if(reason===null)return;
 if(reason.trim().length<3||reason.trim().length>1000){notify('Причина должна содержать от 3 до 1000 символов.');return;}
 b.disabled=true;try{await api('/api/reports','POST',{kind:b.dataset.reportObject,targetId:['profile','club_page'].includes(b.dataset.reportObject)?b.dataset.targetId:Number(b.dataset.targetId),reason});notify('Жалоба отправлена. Результат появится в разделе «Жалобы».');}finally{b.disabled=false;}return;
 }
 if(b.hasAttribute('data-club-create-open')){const form=$('#createClub');if(form){form.closest('details').open=true;form.scrollIntoView?.({block:'start'});form.querySelector('input').focus();}return;}
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
    if(b.hasAttribute('data-club-subscription')){const version=requestVersion,viewer=user?.id,error=b.parentElement.querySelector('[data-subscription-error]'),retry=b.hasAttribute('data-subscription-retry'),enabled=b.dataset.enabled!=='true',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);b.disabled=true;error.textContent='';try{const d=await api('/api/clubs/'+b.dataset.clubSubscription+'/subscription',retry?'GET':'PUT',retry?undefined:{enabled},{signal:controller.signal});if(!b.isConnected||version!==requestVersion||user?.id!==viewer||d.viewerId!==viewer)return;b.dataset.enabled=String(d.enabled);b.setAttribute('aria-pressed',String(d.enabled));b.removeAttribute('data-subscription-retry');b.textContent=d.enabled?'Отключить уведомления':'Включить уведомления';}catch(e){if(b.isConnected&&version===requestVersion)error.textContent='Не удалось обновить настройку. Повтори попытку.';}finally{clearTimeout(timer);if(b.isConnected)b.disabled=false;}return;}
    if(b.dataset.matchRead){b.disabled=true;try{await api('/api/tournaments/notifications/'+b.dataset.matchRead+'/read','POST',{});if(b.isConnected)b.remove();badgeSignature='';pollBadges();}catch(e){if(b.isConnected)b.disabled=false;notify(e.message);}return;}
    if(b.dataset.matchMore){b.disabled=true;try{const d=await api('/api/tournaments/notifications?before='+b.dataset.matchMore);if(!b.isConnected||d.viewerId!==user?.id)return;$('#matchNotifications').insertAdjacentHTML('beforeend',d.notifications.map(matchNotificationCard).join(''));if(d.next){b.dataset.matchMore=d.next;b.disabled=false;}else b.remove();}catch(e){if(b.isConnected)b.disabled=false;notify(e.message);}return;}
    if(b.dataset.tournamentInvitationMore){b.disabled=true;try{const d=await api('/api/tournaments/invitations?before='+b.dataset.tournamentInvitationMore);if(!b.isConnected||d.viewerId!==user?.id)return;$('#tournamentInvitations').insertAdjacentHTML('beforeend',d.invitations.map(tournamentInvitationCard).join(''));if(d.next){b.dataset.tournamentInvitationMore=d.next;b.disabled=false;}else b.remove();}catch(e){if(b.isConnected){b.disabled=false;notify(e.message);}}return;}
    if(b.dataset.discussionMore){b.disabled=true;const data=await api('/api/discussions/notifications?before='+b.dataset.discussionMore);if(!b.isConnected||data.viewerId!==user?.id)return;$('#discussionEvents').insertAdjacentHTML('beforeend',data.notifications.map(discussionUI.notification).join(''));if(data.next){b.dataset.discussionMore=data.next;b.disabled=false;}else b.remove();return;}
    if(b.dataset.discussionRead){b.disabled=true;await api(`/api/discussions/notifications/${b.dataset.discussionRead}/read`,'POST',{});await render();updateDiscussionBadge();return;}
    if(b.dataset.discussionPost){postReturnView='notifications';selectedPost=b.dataset.discussionPost;selectedComment=b.dataset.discussionComment||null;view='post';await render();return;}
    if(b.dataset.contact){directDraftHandle=b.dataset.contact;view='direct';await render();return;}
    if(b.dataset.player){playerReturnView=view==='lfg'?'lfg':view==='account'?'account':'discover';selectedPlayer=b.dataset.player;view='player';await render();return;}
    if(b.dataset.clearImage){if(!await beforeRouteChange())return;await api('/api/me','PATCH',{[b.dataset.clearImage]:null});await render();return;}
    if(b.hasAttribute('data-clear-club-cover')){await api(`/api/clubs/${selectedClub}/cover`,'PATCH',{coverId:null});await render();return;}
    if(b.dataset.nav){if(b.dataset.nav==='discover')homeTab='overview';view=b.dataset.nav;await render();return;}
    if(b.dataset.commentClub)selectedClub=b.dataset.commentClub;
    if(b.dataset.feedMore){b.disabled=true;const data=await api('/api/feed?before='+b.dataset.feedMore);if(!b.isConnected)return;$('#feedPosts').insertAdjacentHTML('beforeend',data.posts.map(feedCard).join(''));if(data.next){b.dataset.feedMore=data.next;b.disabled=false;}else b.remove();}
    if(b.dataset.appealRead){b.disabled=true;await api(`/api/reports/${b.dataset.appealRead}/appeal/read`,'POST',{});await render();updateReportBadge();}
    if(b.dataset.reportRead){b.disabled=true;await api(`/api/reports/${b.dataset.reportRead}/read`,'POST',{});await render();updateReportBadge();}
    if(b.dataset.ownReportsMore){b.disabled=true;const result=await api('/api/reports?before='+b.dataset.ownReportsMore);if(!b.isConnected)return;$('#ownReports').insertAdjacentHTML('beforeend',result.reports.map(ownReportCard).join(''));if(result.next){b.dataset.ownReportsMore=result.next;b.disabled=false;}else b.remove();}
    if(b.dataset.reportsMore){b.disabled=true;const result=await api('/api/moderation/reports?before='+b.dataset.reportsMore);if(!b.isConnected)return;$('#reportQueue').insertAdjacentHTML('beforeend',result.reports.map(reportCard).join(''));if(result.next){b.dataset.reportsMore=result.next;b.disabled=false;}else b.remove();}
    if (b.id === 'retry') return render();
    if (b.dataset.open) { selectedClub = b.dataset.open;clubTab='posts'; view = 'club'; await render(); }
    if (b.dataset.logout) { if(composerController)await composerController.flush();composerUI?.reset();await api(b.dataset.logout, 'POST', {}); try { const prefix = `wr-chat-pending:${user.id}:`,draftPrefix=`wr-chat-draft:${user.id}:`; for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)||key.startsWith(draftPrefix)) sessionStorage.removeItem(key); } catch {} user = csrf = null;lfgState={};eventState={};directDraftHandle='';inviteToken=null;clubTab='posts'; view = 'account'; await render(); }
    if (b.dataset.membership) { b.disabled = true; await api(`/api/clubs/${selectedClub}/${b.dataset.membership}`, 'POST', {}); await render(); }
    if (b.dataset.decision) { b.disabled = true; await api(`/api/clubs/${selectedClub}/decision`, 'POST', { userId: b.dataset.user, decision: b.dataset.decision }); await render(); }
    if (b.dataset.ban && confirm('Участник потеряет доступ к содержимому клуба и не сможет вступить снова. Продолжить?')) { await api(`/api/clubs/${selectedClub}/ban`, 'POST', { userId: b.dataset.ban }); await render(); }
    if (b.dataset.comments) {
      const list=$(`[data-comment-list="${b.dataset.comments}"]`);
      if(view==='post'&&list){const editor=$(`[data-comment-form="${b.dataset.comments}"] textarea`);(editor||list).scrollIntoView?.({block:'center'});editor?.focus({preventScroll:true});}
      else await comments(b.dataset.comments);
    }
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
        user=csrf=null;authMode='login';view='account';await render();notify('Пароль изменён. Войди с новым паролем.');
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
    if (form.id === 'register' || form.id === 'login') { const result = await api('/api/' + form.id, 'POST', data); user = result.user; csrf = result.csrf;authMode='login'; view = inviteToken?'invite':authReturn?.view||'clubs';if(authReturn){if(authReturn.view==='events')eventState={id:authReturn.id,create:!authReturn.id};else if(authReturn.view==='lfg')lfgState={tab:'groups',initialGroup:authReturn.id,create:!authReturn.id};else if(authReturn.view==='player')selectedPlayer=authReturn.id;else if(authReturn.view==='club'){selectedClub=authReturn.id;clubTab='posts';}authReturn=null;} }
    if (form.id === 'profile') {await mediaUI.save(form,api,csrf);notify('Профиль сохранён.');}
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
   if(result.loggedOut){try{const prefix=`wr-chat-pending:${viewer}:`,draftPrefix=`wr-chat-draft:${viewer}:`;for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix)||key.startsWith(draftPrefix))sessionStorage.removeItem(key);}catch{}user=csrf=null;view='account';await render();}
   else{b.closest('[data-session-row]').remove();notify('Сеанс завершён.');}
  }
 }catch(e){notify(e.message);}finally{b.disabled=false;}
});
if(!inviteToken){applyRoute(parseRoute(location.pathname,location.search)||{view:'notfound'});const returnPath=new URLSearchParams(location.search).get('return');const target=returnPath&&parseRoute(returnPath);if(view==='account'&&target?.view==='club')authReturn=target;}
window.addEventListener('popstate',async()=>{const version=requestVersion;if(!await beforeRouteChange()){syncRoute(false);return;}if(version!==requestVersion)return;applyRoute(parseRoute(location.pathname,location.search)||{view:'notfound'});render({history:false});});
document.addEventListener('click',async event=>{const a=event.target.closest('a[data-route]');if(!a||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const link=new URL(a.href);const target=parseRoute(link.pathname,link.search);if(!target)return;event.preventDefault();const version=requestVersion;if(!await beforeRouteChange()||version!==requestVersion)return;applyRoute(target);render();});
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

function createNotificationCenter(root,viewer){
 let active=true,version=0,type='all',unread=false,includeMuted=false,next=null,through=null,pendingPreference=null;const requests=new Set(),keys=new Set();
 const labels={all:'Все типы',clubs:'Публикации клубов',discussions:'Ответы и упоминания',events:'Игровые события',lfg:'Поиск компании',tournaments:'Турниры'};
 const text={events:{waitlist_offer:'Освободилось место: подтверди участие',waitlist_closed:'Предложение истекло или набор завершён',joined:'Игрок занял место',left:'Игрок освободил место',removed:'Ты исключён из состава',cancelled:'Событие отменено',reminder:'До начала осталось не больше 30 минут'},lfg:{application:'Новая заявка в группу',accepted:'Тебя приняли в группу',rejected:'Заявка отклонена',removed:'Ты исключён из группы',cancelled:'Заявка отменена',left:'Участник вышел',closed:'Группа закрыта'}};
 async function request(path,method='GET',body){const controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),10000);try{return await api(path,method,body,{signal:controller.signal});}finally{clearTimeout(timeout);requests.delete(controller);}}
 function card(n){let html;if(n.source==='clubs')html=`<article class="panel"><span class="pill">Новая публикация</span><h3>${esc(n.title)}</h3><p>${esc(n.club_name)}</p><p class="note">${esc(new Date(n.created_at).toLocaleString('ru-RU'))}</p><a class="btn quiet" data-route href="/posts/${n.post_id}">Открыть публикацию</a>${!n.seen?'<button class="btn quiet" data-center-read>Прочитано</button>':'<span class="note">Прочитано</span>'}</article>`;else if(n.source==='discussions')html=discussionUI.notification(n);else if(n.source==='matches')html=matchNotificationCard(n);else if(n.source==='invitations')html=tournamentInvitationCard(n);else {const event=n.source==='events',id=event?n.event_id:n.group_id;html=`<article class="panel"><span class="pill">${event?'Игровое событие':'Поиск компании'}</span><h3>${esc(text[n.source][n.kind]||'Обновление')}</h3>${n.title?`<p>${esc(n.title)}</p>`:''}<p class="note">${event?'Событие':'Группа'} №${id} · ${esc(new Date(n.created_at).toLocaleString('ru-RU'))}</p><a class="btn quiet" data-route href="/${event?'events':'teams'}?id=${id}">${event?'Открыть событие':'Открыть группу'}</a>${!n.seen?'<button class="btn quiet" data-center-read>Прочитано</button>':'<span class="note">Прочитано</span>'}</article>`;}return `<div data-notification-key="${esc(n.key)}" data-source="${n.source}" data-id="${n.id}">${html}</div>`;}
 function append(items){const list=root.querySelector('#discussionEvents');for(const n of items){if(keys.has(n.key))continue;keys.add(n.key);list.insertAdjacentHTML('beforeend',card(n));}}
 function pager(){root.querySelector('[data-center-more]')?.remove();if(next)root.insertAdjacentHTML('beforeend','<button class="btn quiet wide" data-center-more>Ранее</button>');}
 async function draw(){const settingsOpen=root.querySelector('[data-preference-details]')?.open||false;pendingPreference=null;const v=++version;root.innerHTML=`<header class="pagehead"><div><h1>Уведомления</h1><p class="muted">Публикации клубов, ответы, события, поиск компании и турниры.</p></div></header><div class="panel"><label class="field">Тип<select data-notification-type>${Object.entries(labels).map(([k,l])=>`<option value="${k}" ${k===type?'selected':''}>${l}</option>`).join('')}</select></label><label><input type="checkbox" data-notification-unread ${unread?'checked':''}> Только непрочитанные</label><label><input type="checkbox" data-notification-muted ${includeMuted?'checked':''}> Показать отключённые категории</label><p class="note">Приглашения сохраняются до принятия или отказа. «Прочитать всё» отмечает и отключённые категории.</p><button class="btn quiet" data-notification-read-all disabled>Прочитать всё</button><button class="btn quiet" data-center-refresh>Обновить</button></div><details class="panel" data-preference-details ${settingsOpen?'open':''}><summary>Настройки уведомлений</summary><p class="note">Выключенные категории не учитываются в счётчиках и скрыты в списке «Все типы». Их история доступна через фильтры; приглашения остаются видны. Эти настройки действуют внутри сайта.</p><fieldset data-pref-fields disabled><legend>Категории</legend>${Object.entries(labels).filter(([k])=>k!=='all').map(([k,l])=>`<label class="field"><span><input type="checkbox" data-notification-preference="${k}"> ${l}</span></label>`).join('')}</fieldset><p class="note">Публикации клубов поступают только из клубов, на которые ты подписался. Настройка здесь не меняет подписки.</p><p role="status" aria-live="polite" data-preference-message></p><button class="btn quiet" data-preference-retry hidden>Повторить сохранение</button></details><p class="error" role="alert" data-center-error></p><div id="discussionEvents" aria-live="polite"><p class="note">Загрузка…</p></div>`;
  try{const d=await request('/api/notifications?'+new URLSearchParams({type,unread:unread?'1':'0',includeMuted:includeMuted?'1':'0'}));if(!active||v!==version||d.viewerId!==viewer.id||user?.id!==viewer.id)return;next=d.next;through=d.through;for(const box of root.querySelectorAll('[data-notification-preference]'))box.checked=d.preferences[box.dataset.notificationPreference];root.querySelector('[data-pref-fields]').disabled=false;keys.clear();root.querySelector('#discussionEvents').innerHTML='';append(d.notifications);if(!d.notifications.length)root.querySelector('#discussionEvents').innerHTML='<p class="note">Здесь пока нет уведомлений для выбранного фильтра.</p>';root.querySelector('[data-notification-read-all]').disabled=false;pager();}
  catch(e){if(active&&v===version){root.querySelector('#discussionEvents').innerHTML='';root.querySelector('[data-center-error]').textContent='Не удалось загрузить уведомления. Нажми «Обновить», чтобы повторить.';}}
 }
 async function savePreference(category,enabled){
  const v=version;pendingPreference={category,enabled};const fields=root.querySelector('[data-pref-fields]'),retry=root.querySelector('[data-preference-retry]'),message=root.querySelector('[data-preference-message]');fields.disabled=true;retry.hidden=true;retry.disabled=true;message.textContent='Сохраняем…';
  try{const d=await request('/api/notifications/preferences','PUT',{category,enabled});if(!active||v!==version||user?.id!==viewer.id||d.viewerId!==viewer.id)return;pendingPreference=null;badgeSignature='';updateDiscussionBadge();draw();}
  catch{if(active&&v===version&&user?.id===viewer.id){message.textContent='Не удалось подтвердить сохранение. Повтори запрос с выбранным значением.';retry.hidden=false;}}
  finally{if(active&&v===version){fields.disabled=false;retry.disabled=false;}}
 }
 async function click(e){const b=e.target.closest('button');if(!b)return;if(b.matches('[data-preference-retry]')){if(pendingPreference)savePreference(pendingPreference.category,pendingPreference.enabled);return;}const isRead=b.matches('[data-center-read],[data-discussion-read],[data-match-read]');if(!isRead&&!b.matches('[data-notification-read-all],[data-center-more],[data-center-refresh]'))return;e.stopPropagation();if(b.hasAttribute('data-center-refresh')){draw();return;}const v=version;b.disabled=true;root.querySelector('[data-center-error]').textContent='';
  try{if(b.hasAttribute('data-center-more')){const d=await request('/api/notifications?'+new URLSearchParams({type,unread:unread?'1':'0',includeMuted:includeMuted?'1':'0',cursor:next}));if(!active||v!==version||d.viewerId!==viewer.id||user?.id!==viewer.id)return;append(d.notifications);next=d.next;pager();}
   else {if(isRead){const n=b.closest('[data-notification-key]');await request('/api/notifications/'+n.dataset.source+'/'+n.dataset.id+'/read','POST',{});}else await request('/api/notifications/read-all','POST',{through});if(!active||v!==version||user?.id!==viewer.id)return;badgeSignature='';pollBadges();draw();}}
  catch(e){if(active&&v===version){root.querySelector('[data-center-error]').textContent='Не удалось выполнить действие. Повтори попытку.';}}
  finally{if(b.isConnected)b.disabled=false;}
 }
 function change(e){if(e.target.matches('[data-notification-preference]')){savePreference(e.target.dataset.notificationPreference,e.target.checked);return;}if(e.target.matches('[data-notification-muted]'))includeMuted=e.target.checked;else if(e.target.matches('[data-notification-type]'))type=e.target.value;else if(e.target.matches('[data-notification-unread]'))unread=e.target.checked;else return;draw();}
 root.addEventListener('click',click);root.addEventListener('change',change);draw();return {destroy(){active=false;version++;for(const c of requests)c.abort();root.removeEventListener('click',click);root.removeEventListener('change',change);}};
}
function createAgenda(root,viewer){
 let active=true,version=0,type='all',status='upcoming',next=null,timer=null,busy=false,expanded=false;const requests=new Set(),keys=new Set();
 const labels={upcoming:'Предстоящая игра',completed:'Завершено',cancelled:'Отменено'};
 function card(n,nearest=false){const dated=n.startsAt!=null,time=dated?new Date(n.startsAt).toLocaleString('ru-RU')+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone:'Время пока не назначено';return `<article class="panel" ${nearest?'data-agenda-nearest':`data-agenda-key="${esc(n.key)}"`}><span class="pill">${nearest?'Ближайшая игра':n.ongoing?'Идёт сейчас':labels[n.state]}</span><h2>${esc(n.title)}</h2><p class="note">${n.type==='events'?'Игровое событие':'Турнирный матч'} · ${esc(n.participation)}</p><p>${esc(time)}</p>${n.type==='tournaments'?`<p>${esc(n.teamA||'Ожидаем команду')} — ${esc(n.teamB||'Ожидаем команду')}</p><p class="note">Раунд ${n.round} · матч ${n.slot+1}${n.state==='completed'&&n.scoreA!=null?' · счёт '+n.scoreA+' : '+n.scoreB:''}</p>${n.state==='upcoming'&&dated?`<p class="note">${n.bothReady?'Обе команды подтвердили готовность':n.ownReady?'Твоя команда готова; ожидаем соперника':'Готовность ещё не подтверждена'}${n.startsAt<Date.now()?' · время прошло, результат ещё не внесён':''}</p>`:''}`:''}<a class="btn quiet" data-route href="${esc(n.href)}">${n.type==='events'?'Открыть событие':'Открыть матч'}</a>${n.state==='upcoming'&&dated&&(n.startsAt>=Date.now()||n.ongoing)?` <button class="btn quiet" data-calendar-key="${esc(n.key)}">В календарь</button>`:''}</article>`;}
 function append(items){for(const n of items){if(keys.has(n.key))continue;keys.add(n.key);root.querySelector('[data-agenda-list]').insertAdjacentHTML('beforeend',card(n));}}
 function pager(){root.querySelector('[data-agenda-more]')?.remove();if(next)root.insertAdjacentHTML('beforeend','<button class="btn quiet wide" data-agenda-more>Показать ещё</button>');}
 async function fetchPage(cursor){const c=new AbortController();requests.add(c);const timeout=setTimeout(()=>c.abort(),10000);try{return await api('/api/agenda?'+new URLSearchParams({type,status,...(cursor?{cursor}:{})}),'GET',undefined,{signal:c.signal});}finally{clearTimeout(timeout);requests.delete(c);}}
 function schedule(){clearTimeout(timer);if(active&&!document.hidden&&!expanded)timer=setTimeout(()=>load(false),30000);}
 async function load(more=false){if(busy||!active)return;busy=true;const v=version,b=root.querySelector(more?'[data-agenda-more]':'[data-agenda-refresh]');if(b)b.disabled=true;root.querySelector('[data-agenda-error]').textContent='';try{const d=await fetchPage(more?next:null);if(!active||v!==version||user?.id!==viewer.id||d.viewerId!==viewer.id)return;expanded=more;if(!more){keys.clear();root.querySelector('[data-agenda-list]').innerHTML='';root.querySelector('[data-agenda-near]').innerHTML=d.nearest?card(d.nearest,true):'';}append(d.items);if(!keys.size)root.querySelector('[data-agenda-list]').innerHTML='<p class="note">Для выбранных фильтров игр пока нет.</p>';next=d.next;pager();}catch(e){if(active&&v===version)root.querySelector('[data-agenda-error]').textContent='Не удалось обновить расписание. Нажми «Обновить», чтобы повторить.';}finally{if(v===version){busy=false;if(b?.isConnected)b.disabled=false;schedule();}}}
 function draw(){version++;clearTimeout(timer);for(const c of requests)c.abort();busy=false;root.innerHTML=`<header class="pagehead"><div><h1>Мои игры</h1><p class="muted">События и матчи, в которых ты участвуешь или которые организуешь.</p></div></header><section class="panel"><label class="field">Тип<select data-agenda-type><option value="all">Все игры</option><option value="events">События</option><option value="tournaments">Турнирные матчи</option></select></label><label class="field">Статус<select data-agenda-status><option value="upcoming">Предстоящие</option><option value="completed">Завершённые</option><option value="cancelled">Отменённые</option><option value="all">Все статусы</option></select></label><button class="btn quiet" data-agenda-refresh>Обновить</button><p class="error" role="alert" data-agenda-error></p></section><section class="panel"><h2>Календарь телефона</h2><p class="note">Скачай файл и открой его в приложении календаря. Выгрузка включает предстоящие игры с назначенным временем выбранного типа.</p><button class="btn quiet" data-calendar-all>Скачать предстоящие (.ics)</button><p class="note">Импорт не обновляется автоматически при переносе или отмене игры. Проверяй расписание на сайте. В файле есть напоминание за 30 минут; его показ зависит от настроек календаря.</p><p role="status" aria-live="polite" data-calendar-message></p></section><div data-agenda-near></div><div data-agenda-list aria-live="polite"><p class="note">Загрузка…</p></div>`;root.querySelector('[data-agenda-type]').value=type;root.querySelector('[data-agenda-status]').value=status;load();}
 function change(e){if(e.target.matches('[data-agenda-type]'))type=e.target.value;else if(e.target.matches('[data-agenda-status]'))status=e.target.value;else return;draw();}
 async function download(button){
  if(button.disabled||!active)return;const v=version,c=new AbortController();requests.add(c);button.disabled=true;const message=root.querySelector('[data-calendar-message]');message.textContent='Готовим календарь…';const timeout=setTimeout(()=>c.abort(),10000);
  try{const key=button.dataset.calendarKey,query=new URLSearchParams({type,...(key?{key}:{})}),response=await fetch('/api/agenda/calendar?'+query,{signal:c.signal});if(!response.ok){let data;try{data=await response.json();}catch{}throw Error(data?.error||'Не удалось скачать календарь. Повтори попытку.');}const blob=await response.blob();if(!active||v!==version||user?.id!==viewer.id)return;const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download=key?'wr-game.ics':'wr-my-games.ics';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);message.textContent='Файл скачан. Открой его в приложении календаря и подтверди добавление игр.';
  }catch(e){if(active&&v===version&&user?.id===viewer.id)message.textContent=e.name==='AbortError'?'Загрузка заняла слишком долго. Повтори попытку.':e.name==='TypeError'?'Нет связи. Повтори загрузку календаря.':e.message;}
  finally{clearTimeout(timeout);requests.delete(c);if(active&&v===version&&button.isConnected)button.disabled=false;}
 }
 function click(e){const button=e.target.closest('[data-calendar-key],[data-calendar-all]');if(button){download(button);return;}if(e.target.closest('[data-agenda-refresh]'))load();else if(e.target.closest('[data-agenda-more]'))load(true);}
 function visible(){clearTimeout(timer);if(!document.hidden&&!expanded)load();}root.addEventListener('change',change);root.addEventListener('click',click);document.addEventListener('visibilitychange',visible);draw();return {destroy(){active=false;version++;clearTimeout(timer);for(const c of requests)c.abort();root.removeEventListener('change',change);root.removeEventListener('click',click);document.removeEventListener('visibilitychange',visible);}};
}
function matchNotificationCard(n){const label={scheduled:'Матч назначен',rescheduled:'Матч перенесён',reminder:'Матч начнётся в течение 30 минут',result:'Результат матча',corrected:'Результат исправлен',withdrawn:'Команда снята',changed:'Изменился соперник: расписание и готовность сброшены'};return `<article class="panel" data-match-notification="${n.id}"><span class="pill">${label[n.kind]}</span><h3>${esc(n.title)}</h3><p>Раунд ${n.round} · матч ${n.slot+1}</p>${n.starts_at?`<p>${esc(new Date(n.starts_at).toLocaleString('ru-RU'))} · ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</p>`:''}${['result','corrected','withdrawn'].includes(n.kind)?`<p>Счёт: ${n.score_a} : ${n.score_b}${n.result_kind==='forfeit'?' · техническое поражение':''}</p><p>${esc(n.result_reason)}</p>`:''}<a class="btn quiet" data-route href="/tournaments?id=${n.tournament_id}&round=${n.round}&slot=${n.slot}">Открыть турнир</a>${!n.seen?`<button class="btn quiet" data-match-read="${n.id}">Прочитано</button>`:''}</article>`;}
function tournamentInvitationCard(n){return `<article class="panel" data-tournament-invitation="${n.tournament_id}"><span class="pill">Приглашение в команду</span><h3>${esc(n.team_name)}</h3><p>${esc(n.title)}</p><a class="btn quiet" data-route href="/tournaments?id=${encodeURIComponent(n.tournament_id)}">Посмотреть приглашение</a></article>`;}
function notificationBadge(replies=0,pending=0,matches=0,events=0,lfg=0,clubs=0,preferences={}){if(preferences.discussions===false)replies=0;if(preferences.tournaments===false){pending=0;matches=0;}if(preferences.events===false)events=0;if(preferences.lfg===false)lfg=0;if(preferences.clubs===false)clubs=0;const total=replies+pending+matches+events+lfg+clubs,button=$('#notifications');button.textContent='Уведомления'+(total?' · '+total:'');button.title=`Непрочитанных ответов: ${replies}; ожидающих приглашений: ${pending}; о матчах: ${matches}; события: ${events}; поиск компании: ${lfg}; публикаций клубов: ${clubs}`;const badge=$('[data-notification-total]');if(badge){badge.hidden=!user||!total;badge.textContent=total>99?'99+':String(total);badge.setAttribute('aria-label',button.title);}}
let discussionBadgeBusy=false;
async function updateDiscussionBadge(){
 if(discussionBadgeBusy)return;const id=user?.id;if(!id){notificationBadge();return;}
 discussionBadgeBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const data=await api('/api/notifications/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;if(data.viewerId===id)notificationBadge(data.discussions.unread,data.tournaments?.pending||0,data.matches?.unread||0,data.events?.unread||0,data.lfg?.unread||0,data.clubs?.unread||0,data.preferences);else $('#notifications').textContent='Уведомления · обнови сеанс';}
 catch{if(user?.id===id)$('#notifications').textContent='Уведомления · нет связи';}
 finally{clearTimeout(timer);discussionBadgeBusy=false;}
}
async function updateEventBadge(){const button=$('#events'),id=user?.id;if(!button)return;if(!id){button.textContent='События';return;}try{const data=await api('/api/notifications/summary'),count=data.preferences?.events===false?0:data.events.unread;if(user?.id===id)button.textContent='События'+(count?' · '+count:'');}catch{}}
let badgeTimer=null,badgePolling=false,badgeInterval=5000,badgeSignature='';
async function pollBadges(){
 clearTimeout(badgeTimer);
 if(document.hidden||!user||badgePolling){badgeTimer=setTimeout(pollBadges,5000);return;}
 badgePolling=true;const id=user.id,controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
 try{
  const d=await api('/api/notifications/summary','GET',undefined,{signal:controller.signal});
  if(user?.id!==id||d.viewerId!==id)return;
  const signature=JSON.stringify([d.direct.unread,d.direct.requests,d.reports.unread,d.lfg.unread,d.discussions.unread,d.events.unread,d.tournaments?.pending||0,d.matches?.unread||0,d.clubs?.unread||0,d.preferences]);
  badgeInterval=signature===badgeSignature?Math.min(badgeInterval*2,30000):5000;badgeSignature=signature;
  navBadge('direct','Чаты',`непрочитанных: ${d.direct.unread}, запросов: ${d.direct.requests}`,d.direct.unread+d.direct.requests);
  $('#reports').textContent='Жалобы'+(d.reports.unread?' · решений: '+d.reports.unread:'');
  const visibleLfg=d.preferences?.lfg===false?0:d.lfg.unread;navBadge('lfg','Найти',`уведомлений: ${visibleLfg}`,visibleLfg);
  notificationBadge(d.discussions.unread,d.tournaments?.pending||0,d.matches?.unread||0,d.events?.unread||0,d.lfg?.unread||0,d.clubs?.unread||0,d.preferences);
  const visibleEvents=d.preferences?.events===false?0:d.events.unread;$('#events').textContent='События'+(visibleEvents?' · '+visibleEvents:'');
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

// Update only visibility controls so an open profile draft survives.
document.addEventListener('change',async event=>{
 const control=event.target;if(!control.matches('[data-profile-visibility]')||!user)return;
 const id=user.id,version=requestVersion,section=control.closest('.account-visibility'),previous=user.profileVisible;
 const save=document.querySelector('#profile button[type=submit]');
 if(save?.disabled){control.checked=previous;return;}
 if(save)save.disabled=true;
 control.disabled=true;section.querySelector('[data-profile-visibility-error]').textContent='';
 try{
  const result=await api('/api/me','PATCH',{profileVisible:control.checked});
  if(!control.isConnected||user?.id!==id||version!==requestVersion)return;
  user.profileVisible=result.user.profileVisible;control.checked=user.profileVisible;
  section.querySelector('[data-profile-visibility-title]').textContent=user.profileVisible?'Публичный профиль':'Профиль скрыт';
  section.querySelector('[data-profile-visibility-note]').textContent=user.profileVisible?'Другие игроки смогут найти тебя.':'Эту страницу видишь только ты.';
  const checkbox=document.querySelector('#profile [name=profileVisible]');if(checkbox){checkbox.checked=user.profileVisible;checkbox.defaultChecked=user.profileVisible;}
  const links=document.querySelector('[data-profile-public-actions]');if(links)links.innerHTML=user.profileVisible?`<button type="button" class="text-link" data-player="${esc(user.id)}">Публичная страница</button>${shareButton('/players/'+user.id,'Скопировать ссылку на профиль')}`:'<span class="note">Твоя страница скрыта от других игроков.</span>';
 }catch(e){if(control.isConnected){control.checked=previous;section.querySelector('[data-profile-visibility-error]').textContent=e.message;}}
 finally{if(control.isConnected)control.disabled=false;if(save?.isConnected)save.disabled=false;}
});
