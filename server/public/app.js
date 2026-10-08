'use strict';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let chatController = null;
let user = null, csrf = null, clubs = [], selectedClub = null, view = 'clubs', requestVersion = 0, pendingDelete = null;
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
  return `<div class="pagehead"><div><h1>Найди своих</h1><p class="muted">Создай локальный аккаунт и начни свой клуб.</p></div></div><div class="auth-grid"><form id="login" class="panel"><h2>Вход</h2><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" autocomplete="username"></label><label class="field">Пароль<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label>${errorLine}<button class="btn primary">Войти</button></form><form id="register" class="panel"><h2>Регистрация</h2><label class="field">Имя<input name="name" required maxlength="40" autocomplete="nickname"></label><label class="field">Логин<input name="handle" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username"></label><label class="field">Пароль · от 12 символов<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>${errorLine}<button class="btn primary">Создать аккаунт</button><p class="form-note">Email и восстановление доступа ещё не подключены. Не используй пароль от игры.</p></form></div>`;
}
function clubCards() {
  return `<div class="pagehead"><div><h1>Клубы</h1><p class="muted">${user ? `Привет, ${esc(user.name)}. Найди компанию по интересам.` : 'Открытые пространства сообщества.'}</p></div></div>` + (clubs.length ? `<div class="club-grid">${clubs.map(c => `<article class="club-card"><div class="club-cover ${c.access === 'request' ? 'purple' : ''}"><span>${c.access === 'request' ? 'ПО ЗАЯВКАМ' : 'ОТКРЫТЫЙ КЛУБ'}</span><span class="club-symbol">✳</span></div><div class="club-content"><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><div class="member-line">Участников: ${c.members}${c.membership ? ' · ' + ({member:'Ты участник',pending:'Заявка отправлена',banned:'Доступ ограничен'}[c.membership]) : ''}</div><button class="btn quiet" data-open="${esc(c.id)}">Открыть клуб →</button></div></article>`).join('')}</div>` : '<div class="empty-state"><h3>Первый клуб может быть твоим</h3><p>Здесь появятся настоящие клубы. Демонстрационные участники не создаются.</p></div>') + (user ? `<form id="createClub" class="panel spaced"><h2>Создать клуб</h2><label class="field">Название<input name="name" required minlength="2" maxlength="80"></label><label class="field">Описание<textarea name="description" maxlength="1000"></textarea></label><label class="field">Доступ<select name="access"><option value="open">Открытый — вступление сразу</option><option value="request">По заявкам — посты только участникам</option></select></label>${errorLine}<button class="btn primary">Создать</button></form>` : '<p class="note">Войди в аккаунт, чтобы создать клуб или присоединиться.</p>');
}
function profile() {
  return `<h1>Аккаунт</h1><form id="profile" class="panel spaced"><h2>${esc(user.handle)}</h2><label class="field">Имя<input name="name" value="${esc(user.name)}" required maxlength="40"></label><label class="field">О себе<textarea name="bio" maxlength="300">${esc(user.bio)}</textarea></label>${errorLine}<button class="btn primary">Сохранить</button></form><section class="panel"><h3>Сеансы</h3><p class="note">Выход со всех устройств отзывает все текущие сеансы аккаунта.</p><div class="row wrap"><button class="btn quiet" data-logout="/api/logout">Выйти здесь</button><button class="btn quiet" data-logout="/api/logout-all">Выйти везде</button></div></section>`;
}
function postHTML(p) {
  return `<article class="panel"><small>${esc(p.author_name)} · ${esc(new Date(p.created_at).toLocaleString('ru-RU'))}</small><h3 class="post-title">${esc(p.title)}</h3><p class="content">${esc(p.body)}</p><div class="post-actions"><button data-comments="${p.id}">Обсудить</button>${p.author_id === user?.id ? `<button data-delete="${p.id}">Удалить</button>` : ''}</div><div id="comments-${p.id}"></div></article>`;
}
async function render() {
  chatController?.destroy(); chatController = null;
  const version = ++requestVersion;
  try {
    const session = await api('/api/me');
    if (version !== requestVersion) return;
    user = session.user; csrf = session.csrf;
    const result = await api('/api/clubs');
    if (version !== requestVersion) return;
    clubs = result.clubs;
    $('#account').textContent = user ? user.name : 'Вход';
    if (view === 'direct') { $('#main').innerHTML = user ? '<section id=directRoot></section>' : auth(); if(user) chatController = window.createDirectInbox({root:$('#directRoot'),user,api}); return; }
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
      $('#main').innerHTML = `<div class="pagehead"><div><h1>${esc(club.name)}</h1><p class="muted">${esc(club.description)}</p></div></div><section class="panel"><div class="row wrap"><span class="pill">${club.access === 'open' ? 'Открытый клуб' : 'По заявкам'}</span><small>Участников: ${club.members}</small>${user && !owner && club.membership !== 'banned' ? `<button class="btn primary" data-membership="${member || club.membership === 'pending' ? 'leave' : 'join'}">${member ? 'Выйти из клуба' : club.membership === 'pending' ? 'Отменить заявку' : club.access === 'open' ? 'Вступить' : 'Подать заявку'}</button>` : ''}</div>${!user ? '<p class="note">Для участия войди в аккаунт.</p>' : ''}${!canRead ? '<p class="note">Содержимое доступно только принятым участникам.</p>' : ''}</section>${owner ? `<section class="panel"><h3>Участники и заявки</h3>${members.map(m => `<div class="row between wrap comment"><span>${esc(m.name)} · ${esc(m.status)}</span>${m.id !== user.id ? `<div class="row">${m.status === 'pending' ? `<button class="btn quiet" data-decision="approve" data-user="${m.id}">Принять</button><button class="btn quiet" data-decision="reject" data-user="${m.id}">Отклонить</button>` : m.status === 'member' ? `<button class="btn quiet" data-ban="${m.id}">Блокировать</button>` : ''}</div>` : '<small>Владелец</small>'}</div>`).join('')}</section>` : ''}${member ? '<section class="panel" id="clubChat"></section>' : ''}${member ? `<form id="post" class="panel"><h3>Новая публикация</h3><label class="field">Заголовок<input name="title" required maxlength="100"></label><label class="field">Текст<textarea name="body" required maxlength="4000"></textarea></label>${errorLine}<button class="btn primary">Опубликовать</button></form>` : ''}<div id="posts">${posts.posts.map(postHTML).join('') || (canRead ? '<div class="empty-state"><h3>Обсуждение начинается здесь</h3><p>Публикаций пока нет.</p></div>' : '')}</div>${posts.next ? `<button class="btn quiet" data-more="${posts.next}">Показать ещё</button>` : ''}`;
      if (member) chatController = window.createClubChat({ root: $('#clubChat'), clubId: club.id, userId: user.id, api });
      return;
    }
    $('#main').innerHTML = clubCards();
  } catch (e) { if (version === requestVersion) { $('#main').innerHTML = `<section class="panel"><h2>Не удалось загрузить</h2><p class="error">${esc(e.message)}</p><button class="btn quiet" id="retry">Повторить</button></section>`; } }
}
async function comments(id) {
  const { comments } = await api(`/api/posts/${id}/comments`);
  const el = $(`#comments-${id}`); if (!el) return;
  const club = clubs.find(c => c.id === selectedClub);
  el.innerHTML = comments.map(c => `<div class="comment"><small>${esc(c.author_name)}</small><p class="content">${esc(c.body)}</p></div>`).join('') + (club?.membership === 'member' ? `<form data-comment-form="${id}"><label class="field">Комментарий<textarea name="body" maxlength="1000" required></textarea></label>${errorLine}<button class="btn primary">Ответить</button></form>` : '<p class="note">Для ответа нужно вступить в клуб.</p>');
}
$('#direct').onclick = () => { view = 'direct'; render(); };
$('#home').onclick = () => { view = 'clubs'; render(); };
$('#account').onclick = () => { view = 'account'; render(); };
$('#cancelDelete').onclick = () => { pendingDelete = null; $('#confirmDialog').close(); };
$('#confirmDelete').onclick = async () => { if (!pendingDelete) return; const id = pendingDelete; pendingDelete = null; $('#confirmDialog').close(); try { await api(`/api/posts/${id}`, 'DELETE', {}); await render(); } catch (e) { notify(e.message); } };
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if (b.id === 'retry') return render();
    if (b.dataset.open) { selectedClub = b.dataset.open; view = 'club'; await render(); }
    if (b.dataset.logout) { await api(b.dataset.logout, 'POST', {}); try { const prefix = `wr-chat-pending:${user.id}:`; for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch {} user = csrf = null; view = 'account'; await render(); }
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
  if (!['login', 'register', 'profile', 'createClub', 'post'].includes(form.id) && !form.dataset.commentForm) return;
  event.preventDefault(); if (!form.reportValidity()) return;
  const button = form.querySelector('button'); button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'register' || form.id === 'login') { const result = await api('/api/' + form.id, 'POST', data); user = result.user; csrf = result.csrf; view = 'clubs'; }
    if (form.id === 'profile') await api('/api/me', 'PATCH', data);
    if (form.id === 'createClub') { const result = await api('/api/clubs', 'POST', data); selectedClub = result.id; view = 'club'; }
    if (form.id === 'post') await api(`/api/clubs/${selectedClub}/posts`, 'POST', data);
    if (form.dataset.commentForm) { await api(`/api/posts/${form.dataset.commentForm}/comments`, 'POST', data); await comments(form.dataset.commentForm); return; }
    await render();
  } catch (e) { formError(form, e); }
  finally { button.disabled = false; }
});
render();
