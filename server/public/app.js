'use strict';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mediaUI=window.WRProfiles;
let selectedPlayer=null,playerReturnView='discover',directDraftHandle='';
let lfgState={};
let chatController = null;
let user = null, csrf = null, clubs = [], selectedClub = null, view = 'discover', requestVersion = 0, pendingDelete = null;
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
  return `<div class="pagehead"><div><h1>Найди своих</h1><p class="muted">Создай аккаунт и начни свой клуб.</p></div></div><div class="auth-grid"><form id="login" class="panel"><h2>Вход</h2><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" autocomplete="username"></label><label class="field">Пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label>${errorLine}<button class="btn primary">Войти</button></form><form id="register" class="panel"><h2>Регистрация</h2><label class="field">Имя<input name="name" required maxlength="40" autocomplete="nickname"></label><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username"></label><label class="field">Пароль · от 12 символов<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Создать аккаунт</button><p class="form-note">Email и восстановление доступа ещё не подключены. Не используй пароль от игры.</p></form></div>`;
}
const initials = name => esc(String(name || 'WR').trim().split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]).join('').toUpperCase());
function clubCard(c) {
  const tone = [...c.id].reduce((sum,x)=>sum+x.charCodeAt(0),0)%4;
  return `<article class="club-card tone-${tone}" data-club-card data-search="${esc((c.name+' '+c.description).toLowerCase())}"><div class="club-cover">${c.cover_id?`<img src="/api/media/${esc(c.cover_id)}" alt="Обложка ${esc(c.name)}" loading="lazy">`: ''}<span class="cover-label">${c.access==='request'?'ПО ЗАЯВКАМ':'ОТКРЫТЫЙ КЛУБ'}</span><span class="club-emblem" aria-hidden="true">${initials(c.name)}</span></div><div class="club-content"><h3>${esc(c.name)}</h3><p>${esc(c.description)||'Место для общения и совместных игр.'}</p><div class="member-line"><span>${c.members} участников</span>${c.membership?`<span class="membership">${({member:'Ты в клубе',pending:'Заявка отправлена',banned:'Доступ ограничен'})[c.membership]||''}</span>`:''}</div><button class="btn quiet" data-open="${esc(c.id)}">Открыть клуб <span aria-hidden="true">↗</span></button></div></article>`;
}
function clubCards() {
  return `<div class="pagehead"><div><span class="tiny-label">НАЙДИ СВОЙ КРУГ</span><h1>Клубы</h1><p class="muted">Для тех, с кем совпадает настроение на игру.</p></div><span class="count-tag">${clubs.length} клубов</span></div>${clubs.length?`<label class="club-search">Поиск по загруженным клубам<input type="search" id="clubSearch" placeholder="Название или интересы" autocomplete="off"></label><div class="club-grid">${clubs.map(clubCard).join('')}</div><p id="noClubResults" class="empty-state hidden">Ничего не найдено. Попробуй другое название.</p>`:'<div class="empty-state"><span class="empty-mark" aria-hidden="true">＋</span><h3>Первый клуб может быть твоим</h3><p>Собери друзей или создай место для новых знакомств.</p></div>'}${user?`<form id="createClub" class="panel spaced"><span class="tiny-label">НАЧНИ СВОЮ ИСТОРИЮ</span><h2>Создать клуб</h2><label class="field">Название<input name="name" required minlength="2" maxlength="80" placeholder="Как назовём вашу компанию?"></label><label class="field">Описание<textarea name="description" maxlength="1000" placeholder="Кого ждёте и во что любите играть?"></textarea></label><label class="field">Доступ<select name="access"><option value="open">Открытый — вступление сразу</option><option value="request">По заявкам — посты только участникам</option></select></label>${errorLine}<button class="btn primary">Создать</button></form>`:'<div class="join-strip"><p>Твоя компания может начаться здесь.</p><button class="btn primary" data-nav="account">Присоединиться</button></div>'}`;
}
function profile() {
  const mine=clubs.filter(c=>c.membership==='member');
  return `<div class="pagehead"><div><span class="tiny-label">ТВОЯ ИСТОРИЯ В СООБЩЕСТВЕ</span><h1>Аккаунт</h1></div></div>${mediaUI.showcase(user,true)}<div class="profile-columns">${mediaUI.editor(user,errorLine)}<section class="panel"><span class="tiny-label">ТВОИ ЛЮДИ</span><h2>Мои клубы</h2>${mine.length?mine.map(c=>`<button class="profile-club" data-open="${esc(c.id)}"><span class="avatar">${initials(c.name)}</span><span>${esc(c.name)}</span><span aria-hidden="true">↗</span></button>`).join(''):'<p class="note">Ты ещё не вступил в клуб.</p><button class="btn quiet" data-nav="clubs">Найти клуб</button>'}</section></div><section class="panel"><h3>Сеансы</h3><p class="note">Выход со всех устройств отзывает все текущие сеансы аккаунта.</p><div class="row wrap"><button class="btn quiet" data-logout="/api/logout">Выйти здесь</button><button class="btn quiet" data-logout="/api/logout-all">Выйти везде</button></div></section>`;
}
function feedCard(p) {
  return `<div class="feed-entry"><button class="feed-club" data-open="${esc(p.club_id)}">${esc(p.club_name)} <span aria-hidden="true">↗</span></button>${postHTML(p).replace('data-comments=',`data-comment-club="${esc(p.club_id)}" data-comments=`)}</div>`;
}
function discoverPage(feed) {
  return `<section class="welcome-hero"><div class="hero-copy"><span class="tiny-label">ИГРА ОБЪЕДИНЯЕТ. ЛЮДИ ОСТАЮТСЯ.</span><h1>Твой Рифт.<br>Твои люди.</h1><p>Найди напарников на вечер,<br>свой клуб и разговоры после матча.</p><div class="row wrap"><button class="btn primary" data-nav="lfg">Найти команду <span aria-hidden="true">↗</span></button><button class="btn quiet" data-nav="clubs">Открыть клубы</button></div></div><div class="rift-art" aria-hidden="true"><i></i><i></i><i></i><span>WR</span></div><span class="hero-index" aria-hidden="true">MEET / PLAY / BELONG</span></section><div class="discovery-grid"><section><div class="section-head"><div><span class="tiny-label">ЧЕМ ЖИВЁТ СООБЩЕСТВО</span><h2>Свежие обсуждения</h2></div><span class="live-label">По времени</span></div><div id="feedPosts">${feed.posts.map(feedCard).join('')||'<div class="empty-state feed-empty"><span class="empty-mark" aria-hidden="true">✦</span><h3>Здесь начнётся разговор</h3><p>Публикации из доступных тебе клубов появятся в этой ленте. Можно обсудить матч, попросить совет или просто познакомиться.</p><button class="btn quiet" data-nav="clubs">Выбрать клуб</button></div>'}</div>${feed.next?`<button class="btn quiet wide" data-feed-more="${feed.next}">Ещё обсуждения</button>`:''}</section><aside class="discovery-aside"><section class="panel gathering"><span class="tiny-label">ОДНА ЦЕЛЬ. ОДНА КОМАНДА.</span><h2>Следующий матч — вместе</h2><p>Выбери режим, нужную роль и время. Собери группу из 2–5 игроков.</p><button class="btn primary wide" data-nav="lfg">Собрать команду</button></section><section class="panel"><div class="section-head"><h3>Открой для себя</h3></div>${clubs.slice(0,3).map(c=>`<button class="profile-club" data-open="${esc(c.id)}"><span class="avatar">${initials(c.name)}</span><span>${esc(c.name)}<small>${c.members} участников</small></span><span aria-hidden="true">↗</span></button>`).join('')||'<p class="note">Новые клубы появятся здесь. Создай первый и пригласи друзей.</p>'}<button class="text-link" data-nav="clubs">Все клубы →</button></section><p class="community-note">За каждым ником — человек.<br>Уважай чужой опыт и играй в свою игру.</p></aside></div>`;
}
function postHTML(p) {
  return `<article class="panel"><div class="post-author">${mediaUI.avatar(p.author_avatar_id,p.author_name)}<div><button type="button" class="author-link" data-player="${esc(p.author_id)}">${esc(p.author_name)}</button><small>${esc(new Date(p.created_at).toLocaleString('ru-RU'))}</small></div></div><h3 class="post-title">${esc(p.title)}</h3><p class="content">${esc(p.body)}</p>${mediaUI.image(p.image_id,'Изображение к публикации: '+p.title)}<div class="post-actions"><button data-comments="${p.id}">Обсудить</button>${p.author_id === user?.id ? `<button data-delete="${p.id}">Удалить</button>` : ''}</div><div id="comments-${p.id}"></div></article>`;
}
async function render() {
  mediaUI.cleanup();
  chatController?.destroy(); chatController = null;
  const version = ++requestVersion;
  const activeNav={discover:'discover',clubs:'home',club:'home',player:'account',account:'account',direct:'direct',reports:'reports',lfg:'lfg'}[view];
  for(const button of document.querySelectorAll('.primary-nav button, #reports')){if(button.id===activeNav)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  $('#main').setAttribute('aria-busy','true');
  $('#main').innerHTML='<div class=loading-state role=status>Загружаем…</div>';
  try {
    const session = await api('/api/me');
    if (version !== requestVersion) return;
    if(user?.id!==session.user?.id){lfgState={};directDraftHandle='';}
    user = session.user; csrf = session.csrf;
    const result = await api('/api/clubs');
    if (version !== requestVersion) return;
    clubs = result.clubs;
    $('#account').textContent = user ? 'Профиль' : 'Вход';
    $('#account').dataset.handle=user?.handle||'';
    $('#account').title=user?user.name:'Вход и регистрация';
    if(view==='discover'){const feed=await api('/api/feed');if(version!==requestVersion)return;$('#main').innerHTML=discoverPage(feed);return;}
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
    if(view==='player'){const data=await api('/api/profiles/'+selectedPlayer);if(version!==requestVersion)return;$('#main').innerHTML=`<button class="back-link" data-nav="${playerReturnView}">← ${playerReturnView==='lfg'?'К поиску напарников':'К обсуждениям'}</button><h1>Профиль игрока</h1>${mediaUI.showcase(data.profile)}`;return;}
    if (view === 'account') { $('#main').innerHTML = user ? profile() : auth(); return; }
    if (view === 'club') {
      const club = clubs.find(c => c.id === selectedClub);
      if (!club) { view = 'clubs'; $('#main').innerHTML = clubCards(); return; }
      const member = club.membership === 'member';
      const canRead = club.membership !== 'banned' && (club.access === 'open' || member);
      const posts = canRead ? await api(`/api/clubs/${club.id}/posts`) : { posts: [], next: null };
      const owner = club.owner_id === user?.id;
      const members = owner ? (await api(`/api/clubs/${club.id}/members`)).members : [];
      if (version !== requestVersion) return;
      $('#main').innerHTML = `<div class="club-banner"><button class="back-link" data-nav="clubs">← Все клубы</button>${club.cover_id?`<img class="club-banner-image" src="/api/media/${esc(club.cover_id)}" alt="Обложка клуба">`:''}<div class="club-banner-content"><span class="identity-avatar">${initials(club.name)}</span><div><span class="tiny-label">ТВОЁ МЕСТО В СООБЩЕСТВЕ</span><h1>${esc(club.name)}</h1><p>${esc(club.description)}</p></div></div></div><section class="panel"><div class="row wrap"><span class="pill">${club.access === 'open' ? 'Открытый клуб' : 'По заявкам'}</span><small>Участников: ${club.members}</small>${user && !owner && club.membership !== 'banned' ? `<button class="btn primary" data-membership="${member || club.membership === 'pending' ? 'leave' : 'join'}">${member ? 'Выйти из клуба' : club.membership === 'pending' ? 'Отменить заявку' : club.access === 'open' ? 'Вступить' : 'Подать заявку'}</button>` : ''}</div>${!user ? '<p class="note">Для участия войди в аккаунт.</p>' : ''}${!canRead ? '<p class="note">Содержимое доступно только принятым участникам.</p>' : ''}</section>${owner?`<form id="clubCover" class="panel"><h3>Обложка клуба</h3><p class="note">Обложка видна в публичной карточке, даже у клуба по заявкам.</p>${mediaUI.picker('coverFile','Выбрать обложку')}${errorLine}<button class="btn primary" type="submit">Сохранить обложку</button>${club.cover_id?'<button type="button" class="btn quiet" data-clear-club-cover>Убрать обложку</button>':''}</form>`:''}${owner ? `<section class="panel"><h3>Участники и заявки</h3>${members.map(m => `<div class="row between wrap comment"><span>${esc(m.name)} · ${({member:'Участник',pending:'Заявка',banned:'Заблокирован'})[m.status]||esc(m.status)}</span>${m.id !== user.id ? `<div class="row">${m.status === 'pending' ? `<button class="btn quiet" data-decision="approve" data-user="${m.id}">Принять</button><button class="btn quiet" data-decision="reject" data-user="${m.id}">Отклонить</button>` : m.status === 'member' ? `<button class="btn quiet" data-ban="${m.id}">Блокировать</button>` : ''}</div>` : '<small>Владелец</small>'}</div>`).join('')}</section>` : ''}${member ? '<section class="panel" id="clubChat"></section>' : ''}${member ? `<form id="post" class="panel"><h3>Новая публикация</h3><label class="field">Заголовок<input name="title" required maxlength="100"></label><label class="field">Текст<textarea name="body" required maxlength="4000"></textarea></label>${mediaUI.picker('imageFile','Изображение к публикации')}${errorLine}<button class="btn primary">Опубликовать</button></form>` : ''}<div id="posts">${posts.posts.map(postHTML).join('') || (canRead ? '<div class="empty-state"><h3>Обсуждение начинается здесь</h3><p>Публикаций пока нет.</p></div>' : '')}</div>${posts.next ? `<button class="btn quiet" data-more="${posts.next}">Показать ещё</button>` : ''}`;
      if (member) chatController = window.createClubChat({ root: $('#clubChat'), clubId: club.id, userId: user.id, api });
      return;
    }
    $('#main').innerHTML = clubCards();
  } catch (e) { if (version === requestVersion) { $('#main').innerHTML = `<section class="panel"><h2>Не удалось загрузить</h2><p class="error">${esc(e.message)}</p><button class="btn quiet" id="retry">Повторить</button></section>`; } } finally { if(version===requestVersion)$('#main').setAttribute('aria-busy','false'); }
}
async function comments(id) {
  const { comments } = await api(`/api/posts/${id}/comments`);
  const el = $(`#comments-${id}`); if (!el) return;
  const club = clubs.find(c => c.id === selectedClub);
  el.innerHTML = comments.map(c => `<div class="comment"><small>${esc(c.author_name)}</small><p class="content">${esc(c.body)}</p></div>`).join('') + (club?.membership === 'member' ? `<form data-comment-form="${id}"><label class="field">Комментарий<textarea name="body" maxlength="1000" required></textarea></label>${errorLine}<button class="btn primary">Ответить</button></form>` : '<p class="note">Для ответа нужно вступить в клуб.</p>');
}
$('#discover').onclick=()=>{view='discover';render();};
$('#lfg').onclick=()=>{view='lfg';render();};
$('#reports').onclick=()=>{view='reports';render();};
$('#direct').onclick = () => { view = 'direct'; render(); };
$('#home').onclick = () => { view = 'clubs'; render(); };
$('#account').onclick = () => { view = 'account'; render(); };
$('#cancelDelete').onclick = () => { pendingDelete = null; $('#confirmDialog').close(); };
$('#confirmDelete').onclick = async () => { if (!pendingDelete) return; const id = pendingDelete; pendingDelete = null; $('#confirmDialog').close(); try { await api(`/api/posts/${id}`, 'DELETE', {}); await render(); } catch (e) { notify(e.message); } };
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
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
    if (b.dataset.open) { selectedClub = b.dataset.open; view = 'club'; await render(); }
    if (b.dataset.logout) { await api(b.dataset.logout, 'POST', {}); try { const prefix = `wr-chat-pending:${user.id}:`; for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch {} user = csrf = null;lfgState={};directDraftHandle=''; view = 'account'; await render(); }
    if (b.dataset.membership) { b.disabled = true; await api(`/api/clubs/${selectedClub}/${b.dataset.membership}`, 'POST', {}); await render(); }
    if (b.dataset.decision) { b.disabled = true; await api(`/api/clubs/${selectedClub}/decision`, 'POST', { userId: b.dataset.user, decision: b.dataset.decision }); await render(); }
    if (b.dataset.ban && confirm('Участник потеряет доступ к содержимому клуба и не сможет вступить снова. Продолжить?')) { await api(`/api/clubs/${selectedClub}/ban`, 'POST', { userId: b.dataset.ban }); await render(); }
    if (b.dataset.comments) await comments(b.dataset.comments);
    if (b.dataset.delete) { pendingDelete = b.dataset.delete; $('#confirmDialog').showModal(); }
    if (b.dataset.more) { b.disabled = true; const data = await api(`/api/clubs/${selectedClub}/posts?before=${b.dataset.more}`); if (!b.isConnected) return; $('#posts').insertAdjacentHTML('beforeend', data.posts.map(postHTML).join('')); if (data.next) { b.dataset.more = data.next; b.disabled = false; } else b.remove(); }
  } catch (e) { b.disabled = false; notify(e.message); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if(form.dataset.appeal||form.dataset.appealDecision){event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;try{const route=form.dataset.appeal?`/api/reports/${form.dataset.appeal}/appeal`:`/api/moderation/reports/${form.dataset.appealDecision}/appeal-decision`;await api(route,'POST',Object.fromEntries(new FormData(form)));await render();}catch(e){formError(form,e);}finally{button.disabled=false;}return;}
  if(form.dataset.reportDecision){event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button');button.disabled=true;try{await api(`/api/moderation/reports/${form.dataset.reportDecision}/decision`,'POST',Object.fromEntries(new FormData(form)));await render();}catch(e){formError(form,e);}finally{button.disabled=false;}return;}
  if (!['login' , 'register', 'profile', 'createClub', 'post', 'clubCover'].includes(form.id) && !form.dataset.commentForm) return;
  event.preventDefault(); if (!form.reportValidity()) return;
  const button = form.querySelector('button'); button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'register' || form.id === 'login') { const result = await api('/api/' + form.id, 'POST', data); user = result.user; csrf = result.csrf; view = 'clubs'; }
    if (form.id === 'profile') await mediaUI.save(form,api,csrf);
    if(form.id==='clubCover'){const id=await mediaUI.upload(form.elements.coverFile.files[0],csrf);if(!id)throw Error('Выбери изображение.');await api(`/api/clubs/${selectedClub}/cover`,'PATCH',{coverId:id});}
    if (form.id === 'createClub') { const result = await api('/api/clubs', 'POST', data); selectedClub = result.id; view = 'club'; }
    if (form.id === 'post'){const id=await mediaUI.upload(form.elements.imageFile.files[0],csrf);await api(`/api/clubs/${selectedClub}/posts`, 'POST',{title:data.title,body:data.body,imageId:id});}
    if (form.dataset.commentForm) { await api(`/api/posts/${form.dataset.commentForm}/comments`, 'POST', data); await comments(form.dataset.commentForm); return; }
    await render();
  } catch (e) { formError(form, e); }
  finally { button.disabled = false; }
});
render();

// In-app badge only: no browser permission or external push service.
let badgeBusy=false;
async function updateMessageBadge(){
  if(badgeBusy)return;
  const id=user?.id;
  if(!id){$('#direct').textContent='Сообщения';return;}
  badgeBusy=true;const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),10000);
  try{const data=await api('/api/direct','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;
    if(data.viewerId!==id){$('#direct').textContent='Сообщения · обнови сеанс';return;}
    $('#direct').textContent=`Сообщения${data.unread?' · '+data.unread:''}${data.requests?' · запросы: '+data.requests:''}`;
  }catch{if(user?.id===id)$('#direct').textContent='Сообщения · нет связи';}
  finally{clearTimeout(deadline);badgeBusy=false;}
}
setInterval(updateMessageBadge,5000);

function reportStatus(status){return ({pending:'Ожидает рассмотрения',upheld:'Нарушение подтверждено',dismissed:'Отклонено'})[status]||status;}
function reportCard(r){return `<article class="panel"><h3>№${r.id} · ${esc(reportStatus(r.status))}</h3><p class="note">${r.kind==='direct'?'Личное сообщение':'Сообщение клуба'}</p><blockquote class="content">${esc(r.snapshot)}</blockquote><p>${esc(r.reason)}</p>${r.status==='pending'?`<form data-report-decision="${r.id}"><label class="field">Решение<select name="decision"><option value="upheld">Нарушение подтверждено</option><option value="dismissed">Отклонено</option></select></label><label class="field">Объяснение для заявителя<textarea name="note" required minlength="3" maxlength="1000"></textarea></label>${errorLine}<button class="btn primary">Сохранить решение</button></form>`:`<p>${esc(r.decision_note)}</p>`}${appealCard(r,true)}</article>`;}

function ownReportCard(r){return `<article class="panel"><h3>№${r.id} · ${esc(reportStatus(r.status))}</h3><p>${esc(r.reason)}</p><p>${esc(r.decision_note)}</p>${r.status!=='pending'&&!r.decision_seen?`<button class="btn quiet" data-report-read="${r.id}">Новое решение · отметить прочитанным</button>`:''}${appealCard(r,false)}</article>`;}
let reportBadgeBusy=false;
async function updateReportBadge(){
 if(reportBadgeBusy)return;const id=user?.id;if(!id){$('#reports').textContent='Жалобы';return;}
 reportBadgeBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const data=await api('/api/reports/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;$('#reports').textContent=data.viewerId===id?`Жалобы${data.unread?' · решений: '+data.unread:''}`:'Жалобы · обнови сеанс';}
 catch{if(user?.id===id)$('#reports').textContent='Жалобы · нет связи';}
 finally{clearTimeout(timer);reportBadgeBusy=false;}
}
setInterval(updateReportBadge,5000);

function appealCard(r,moderator){
 if(r.status==='pending')return '';
 if(!r.appeal_status)return moderator?'':`<details><summary>Оспорить решение</summary><p class="note">Одна апелляция. Её рассмотрит другой модератор. После отправки текст нельзя изменить.</p><form data-appeal="${r.id}"><label class="field">Почему решение нужно пересмотреть<textarea name="reason" required minlength="3" maxlength="1000"></textarea></label>${errorLine}<button class="btn primary">Подать апелляцию</button></form></details>`;
 const heading=`<h4>Пересмотр: ${esc(reportStatus(r.appeal_status))}</h4><p>${esc(r.appeal_reason)}</p>`;
 if(r.appeal_status==='pending')return heading+(moderator&&!([r.reporter_id,r.sender_id,r.moderator_id].includes(user.id))?`<form data-appeal-decision="${r.id}"><label class="field">Итог по жалобе<select name="decision"><option value="upheld">Нарушение подтверждено</option><option value="dismissed">Нарушение не подтверждено</option></select></label><label class="field">Объяснение пересмотра<textarea name="note" required minlength="3" maxlength="1000"></textarea></label>${errorLine}<button class="btn primary">Завершить пересмотр</button></form>`:'<p class="note">Ожидается другой независимый модератор.</p>');
 return heading+`<p>${esc(r.appeal_note)}</p>`+(!moderator&&!r.appeal_seen?`<button class="btn quiet" data-appeal-read="${r.id}">Результат пересмотра · отметить прочитанным</button>`:'');
}

let lfgBadgeBusy=false;
async function updateLfgBadge(){
 if(lfgBadgeBusy)return;const id=user?.id;if(!id){$('#lfg').textContent='Найти команду';return;}
 lfgBadgeBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const data=await api('/api/lfg/notifications/summary','GET',undefined,{signal:controller.signal});if(user?.id!==id)return;$('#lfg').textContent=data.viewerId===id?`Найти команду${data.unread?' · '+data.unread:''}`:'Найти команду · обнови сеанс';}
 catch{if(user?.id===id)$('#lfg').textContent='Найти команду · нет связи';}
 finally{clearTimeout(timer);lfgBadgeBusy=false;}
}
setInterval(updateLfgBadge,5000);

document.addEventListener('input', event=>{if(event.target.id!=='clubSearch')return;const query=event.target.value.trim().toLowerCase();let visible=0;for(const card of document.querySelectorAll('[data-club-card]')){const show=card.dataset.search.includes(query);card.classList.toggle('hidden',!show);if(show)visible++;}$('#noClubResults').classList.toggle('hidden',visible>0);});
