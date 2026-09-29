'use strict';
// One controller per mounted club. It never trusts a previous membership check.
window.createClubChat = function ({ root, clubId, userId, api, endpoint = `/api/clubs/${clubId}/messages`, title = 'Чат клуба', readEndpoint = null }) {
  const encode = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const storageKey = `wr-chat-pending:${userId}:${clubId}`;
  let active = true, timer, polling = false, cursor = 0, oldest = null, hasOlder = false, initial = true;
  const messages = new Map(), pending = new Map(), requests = new Set();
  async function request(path, method = 'GET', body) {
    const controller = new AbortController(); requests.add(controller);
    const deadline = setTimeout(() => controller.abort(), 10000);
    try { return await api(path, method, body, { signal: controller.signal }); }
    finally { clearTimeout(deadline); requests.delete(controller); }
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) for (const item of stored.slice(0,20)) {
      if (item && typeof item.clientId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(item.clientId) && typeof item.body === 'string' && item.body.trim().length > 0 && item.body.length <= 2000) pending.set(item.clientId, { clientId:item.clientId, body:item.body, status:'Не подтверждено. Можно повторить.' });
    }
  } catch { /* Storage may be unavailable; in-memory retries still work. */ }
  let loadedLast = 0;
  root.innerHTML = `<div class="row between wrap"><h3>${encode(title)}</h3><button type="button" class="btn quiet" data-chat-refresh>Обновить</button></div>${readEndpoint?'<button type="button" class="btn quiet" data-chat-read>Отметить загруженное прочитанным</button>':''}<p class="note" data-chat-status role="status">Подключение…</p><button type="button" class="btn quiet hidden" data-chat-older>Ранние сообщения</button><div class="server-chat-log" data-chat-log role="log" aria-label="Сообщения"></div><div data-chat-pending></div><form data-chat-form><label class="field">Сообщение<textarea name="body" required maxlength="2000" rows="2" placeholder="Напиши сообщение…"></textarea></label><p class="error" data-chat-error role="alert"></p><button class="btn primary">Отправить</button></form>`;
  const find = selector => root.querySelector(selector);
  const status = text => { if (active) find('[data-chat-status]').textContent = text; };
  function persist() {
    try { if (pending.size) sessionStorage.setItem(storageKey,JSON.stringify([...pending.values()].map(({clientId,body})=>({clientId,body})))); else sessionStorage.removeItem(storageKey); }
    catch { if (active) find('[data-chat-error]').textContent = 'Черновики не сохраняются в этом браузере. Не закрывай страницу до подтверждения отправки.'; }
  }
  function drawPending() {
    if (!active) return;
    find('[data-chat-pending]').innerHTML = [...pending.values()].map(m=>`<div class="chat-pending"><p class="content">${encode(m.body)}</p><small>${encode(m.status)}</small><div class="row wrap"><button type="button" class="btn quiet" data-chat-retry="${m.clientId}" ${m.busy?'disabled':''}>Повторить</button><button type="button" class="btn quiet" data-chat-discard="${m.clientId}" ${m.busy?'disabled':''}>Убрать из очереди</button></div></div>`).join('');
  }
  function merge(list) {
    for (const m of list) {
      messages.set(m.id,m); loadedLast=Math.max(loadedLast,m.id);
      if (m.sender_id===userId) pending.delete(m.client_id);
    }
    persist();
    if (!active) return;
    const log=find('[data-chat-log]');
    if (!list.length && log.childNodes.length) { drawPending(); return; }
    const nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<50;
    log.innerHTML=[...messages.values()].sort((a,b)=>a.id-b.id).map(m=>`<div class="bubble ${m.sender_id===userId?'self':''}" data-message-id="${m.id}"><small>${encode(m.sender_name)} · ${encode(new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}</small><span>${encode(m.body)}</span></div>`).join('') || '<p class="muted">Начни разговор — сообщений пока нет.</p>';
    if(nearEnd) log.scrollTop=log.scrollHeight;
    drawPending();
  }
  function revoke() {
    if (!active) return;
    active=false;clearTimeout(timer);for(const c of requests)c.abort();pending.clear();messages.clear();
    try { sessionStorage.removeItem(storageKey); } catch {}
    root.innerHTML='<h3>Чат недоступен</h3><p class="note">Сеанс или членство изменились. Обнови страницу клуба.</p>';
  }
  function allowed(data) { if(data.viewerId!==userId){revoke();return false;}return true; }
  function handleError(error) {
    if ([401,403,404].includes(error.status)) { revoke(); return; }
    status('Нет подтверждения связи. Повторим обновление автоматически.');
  }
  async function poll() {
    if (!active || polling) return;
    clearTimeout(timer);polling=true;let more=false;
    try {
      const data=await request(`${endpoint}${initial?'':`?after=${cursor}`}`);
      if (!active || !allowed(data)) return;
      if(initial){hasOlder=data.hasMore;oldest=data.messages[0]?.id??null;find('[data-chat-older]').classList.toggle('hidden',!hasOlder);}
      merge(data.messages);
      if(data.messages.length)cursor=Math.max(cursor,data.messages.at(-1).id);
      more=!initial&&data.hasMore;initial=false;
      status('Подключено · новые сообщения проверяются каждые 2 секунды');
    }catch(error){if(active)handleError(error);}
    finally{polling=false;if(active)timer=setTimeout(poll,more?50:2000);}
  }
  async function send(clientId) {
    const item=pending.get(clientId);if(!active||!item||item.busy)return;
    item.busy=true;item.status='Отправляется…';drawPending();
    try {
      const data=await request(`${endpoint}`,'POST',{clientId,body:item.body});
      if(!active)return;
      if(data.message.sender_id!==userId){revoke();return;}
      // Do not advance the read cursor: other messages may precede this one.
      merge([data.message]);
    }catch(error){
      if(!active)return;
      if([401,403,404].includes(error.status)){revoke();return;}
      item.busy=false;item.status=error.status===409?'Конфликт идентификатора. Удали запись из очереди и создай новую.':'Отправка не подтверждена. Повтори с тем же идентификатором.';drawPending();
    }
  }
  async function older() {
    if(!active||!hasOlder||oldest===null)return;
    const button=find('[data-chat-older]');button.disabled=true;
    try{
      const data=await request(`${endpoint}?before=${oldest}`);
      if(!active||!allowed(data))return;
      const log=find('[data-chat-log]'),height=log.scrollHeight,top=log.scrollTop;
      merge(data.messages);oldest=data.messages[0]?.id??oldest;hasOlder=data.hasMore;
      button.classList.toggle('hidden',!hasOlder);log.scrollTop=top+log.scrollHeight-height;
    }catch(error){if(active)handleError(error);}
    finally{if(active)button.disabled=false;}
  }
  const onClick=async e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-chat-read')&&readEndpoint&&loadedLast){b.disabled=true;try{await request(readEndpoint,'POST',{lastId:loadedLast});if(active)status('Загруженные сообщения отмечены прочитанными');}catch(error){if(active)handleError(error);}finally{b.disabled=false;}}if(b.hasAttribute('data-chat-refresh'))poll();if(b.hasAttribute('data-chat-older'))older();if(b.dataset.chatRetry)send(b.dataset.chatRetry);if(b.dataset.chatDiscard&&confirm('Убрать локальную попытку? Если сообщение уже дошло до сервера, оно останется в истории.')){pending.delete(b.dataset.chatDiscard);persist();drawPending();}};
  const onSubmit=e=>{
    if(!e.target.matches('[data-chat-form]'))return;e.preventDefault();
    const input=e.target.elements.body,body=input.value.trim();if(!body||!active)return;
    if(pending.size>=20){find('[data-chat-error]').textContent='Сначала отправь или убери сообщения из очереди.';return;}
    const clientId=crypto.randomUUID();pending.set(clientId,{clientId,body,status:'Ожидает отправки'});persist();input.value='';drawPending();send(clientId);
  };
  root.addEventListener('click',onClick);root.addEventListener('submit',onSubmit);drawPending();poll();
  return { destroy(){active=false;clearTimeout(timer);for(const c of requests)c.abort();root.removeEventListener('click',onClick);root.removeEventListener('submit',onSubmit);} };
};
