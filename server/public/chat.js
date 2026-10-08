'use strict';
// One controller per mounted club. It never trusts a previous membership check.
window.createClubChat = function ({ root, clubId, userId, api, endpoint = `/api/clubs/${clubId}/messages`, title = 'Чат клуба', readEndpoint = null, readOnly = false }) {
  const encode = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const storageKey = `wr-chat-pending:${userId}:${clubId}`;
  const draftKey = `wr-chat-draft:${userId}:${clubId}`;
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
  let loadedLast = 0, blockVersion = null, canSend = false, draftLoaded = false;
  const clubChat = endpoint.startsWith('/api/clubs/') || endpoint.startsWith('/api/lfg/') || endpoint.startsWith('/api/events/');
  const canReport = !endpoint.startsWith('/api/lfg/') && !endpoint.startsWith('/api/events/');
  root.classList.add('editorial-chat');root.classList.remove('chat-unavailable');
  root.innerHTML = `<header class="chat-heading"><h3>${encode(title)}</h3><details class="chat-tools"><summary>Действия</summary><button type="button" class="btn quiet" data-chat-refresh>Обновить</button>${readEndpoint?'<button type="button" class="btn quiet" data-chat-read disabled>Отметить загруженное прочитанным</button>':''}</details></header><p class="note" data-chat-status role="status">Подключение…</p><button type="button" class="btn quiet hidden" data-chat-older>Ранние сообщения</button><div class="server-chat-log" data-chat-log role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions text"></div><div class="chat-outbox" data-chat-pending aria-label="Неподтверждённые сообщения"></div><form class="chat-composer" data-chat-form><label class="field"><span class="sr-only">Сообщение</span><textarea name="body" required maxlength="2000" rows="2" placeholder="Напиши сообщение…" ${readOnly?'disabled':''}></textarea></label><button class="btn primary" ${readOnly?'disabled':''}>Отправить</button><p class="error" data-chat-error role="alert"></p></form>`;
  const find = selector => root.querySelector(selector);
  const draftNote = document.createElement('small');
  draftNote.className='chat-draft-status';draftNote.setAttribute('role','status');draftNote.hidden=true;
  find('[data-chat-form]').append(draftNote);
  function draftStatus(text) { if(active){draftNote.textContent=text;draftNote.hidden=!text;} }
  function saveDraft() {
    try {
      const body=find('[data-chat-form] textarea').value;
      if(body)sessionStorage.setItem(draftKey,body.slice(0,2000));else sessionStorage.removeItem(draftKey);
      draftStatus(body?'Черновик сохранён в этой вкладке':'');
    } catch { draftStatus('Черновик не сохранён. Не закрывай страницу.'); }
  }
  function clearDraft() {
    try { sessionStorage.removeItem(draftKey);draftStatus(''); }
    catch { draftStatus('Не удалось очистить сохранённый черновик.'); }
  }
  const status = text => { if (active) find('[data-chat-status]').textContent = text; };
  function persist() {
    try { if (pending.size) sessionStorage.setItem(storageKey,JSON.stringify([...pending.values()].map(({clientId,body})=>({clientId,body})))); else sessionStorage.removeItem(storageKey); }
    catch { if (active) find('[data-chat-error]').textContent = 'Черновики не сохраняются в этом браузере. Не закрывай страницу до подтверждения отправки.'; }
  }
  function drawPending() {
    if (!active) return;
    find('[data-chat-pending]').innerHTML = [...pending.values()].map(m=>`<div class="chat-pending"><small>${encode(m.status)}</small><p class="content">${encode(m.body)}</p><div class="row wrap"><button type="button" class="btn quiet" data-chat-retry="${m.clientId}" ${m.busy||!canSend?'disabled':''}>Повторить</button><button type="button" class="btn quiet" data-chat-discard="${m.clientId}" ${m.busy?'disabled':''}>Убрать из очереди</button></div></div>`).join('');
  }
  function merge(list) {
    for (const m of list) {
      messages.set(m.id,m); loadedLast=Math.max(loadedLast,m.id);
      if (m.sender_id===userId) pending.delete(m.client_id);
    }
    persist();
    if (!active) return;
    const log=find('[data-chat-log]');
    if (!list.length && messages.size && log.childNodes.length) { drawPending(); return; }
    const nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<50;
    const openMenus=new Set([...log.querySelectorAll('.chat-message-tools[open]')].map(el=>el.closest('[data-message-id]').dataset.messageId));
    let day='';
    log.innerHTML=[...messages.values()].sort((a,b)=>a.id-b.id).map(m=>{
      const date=new Date(m.created_at),key=date.toDateString();
      const divider=key!==day?`<p class="chat-day">${encode(date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}))}</p>`:'';day=key;
      return `${divider}<div class="bubble ${m.sender_id===userId?'self':''}" data-message-id="${m.id}"><small>${encode(m.sender_name)} · <time datetime="${encode(date.toISOString())}">${encode(date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}</time></small><span>${encode(m.body)}</span>${m.sender_id!==userId&&canReport?`<details class="chat-message-tools" ${openMenus.has(String(m.id))?'open':''}><summary>Действия<span class="sr-only"> с сообщением ${m.id}</span></summary><button type="button" class="btn quiet" data-report-message="${m.id}">Пожаловаться</button>${clubChat?`<button type="button" class="btn quiet" data-chat-block="${encode(m.sender_id)}">Блокировать игрока</button>`:''}</details>`:''}</div>`;
    }).join('') || `<div class="chat-empty"><h4>${canSend?'Первое слово за тобой':'История разговора'}</h4><p class="muted">${canSend?'Сообщений пока нет. Поздоровайся и договорись об игре.':'Сообщений пока нет. Отправка в этом чате закрыта.'}</p></div>`;
    if(readEndpoint)find('[data-chat-read]').disabled=!loadedLast;
    if(nearEnd) log.scrollTop=log.scrollHeight;
    drawPending();
  }
  function revoke() {
    if (!active) return;
    active=false;clearTimeout(timer);for(const c of requests)c.abort();pending.clear();messages.clear();
    try { sessionStorage.removeItem(storageKey);sessionStorage.removeItem(draftKey); } catch {}
    root.classList.add('chat-unavailable');root.innerHTML='<h3>Чат недоступен</h3><p class="note">Сеанс или членство изменились. Обнови страницу.</p>';
  }
  function resetHistory(){messages.clear();cursor=0;oldest=null;hasOlder=false;initial=true;loadedLast=0;if(readEndpoint)find('[data-chat-read]').disabled=true;find('[data-chat-log]').textContent='Обновление истории…';find('[data-chat-older]').classList.add('hidden');}
  function allowed(data) {
    if(data.viewerId!==userId){revoke();return false;}
    canSend=!readOnly&&data.canSend!==false;
    for(const el of root.querySelectorAll('[data-chat-form] textarea,[data-chat-form] button'))el.disabled=!canSend;
    // Restore private text only after the current viewer and write access agree.
    if(canSend&&!draftLoaded){
      draftLoaded=true;
      try{const body=sessionStorage.getItem(draftKey);if(body&&body.length<=2000){find('[data-chat-form] textarea').value=body;draftStatus('Черновик восстановлен');}}
      catch{draftStatus('Черновик не сохраняется в этой вкладке.');}
    }
    if(clubChat&&Number.isSafeInteger(data.blockVersion)){
      if(blockVersion!==null&&data.blockVersion<blockVersion)return false;
      if(blockVersion!==null&&data.blockVersion!==blockVersion){blockVersion=data.blockVersion;resetHistory();return false;}
      blockVersion=data.blockVersion;
    }
    return true;
  }
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
      status(canSend?'Подключено · сообщения обновляются автоматически':'Подключено · история доступна только для чтения');
    }catch(error){if(active)handleError(error);}
    finally{polling=false;if(active)timer=setTimeout(poll,more?50:2000);}
  }
  async function send(clientId) {
    const item=pending.get(clientId);if(!active||!canSend||!item||item.busy)return;
    item.busy=true;item.status='Отправляется…';drawPending();
    try {
      const data=await request(`${endpoint}`,'POST',{clientId,body:item.body});
      if(!active)return;
      if(data.message.sender_id!==userId){revoke();return;}
      // Do not advance the read cursor: other messages may precede this one.
      merge([data.message]);
    }catch(error){
      if(!active)return;
      if([401,404].includes(error.status)){revoke();return;}
      item.busy=false;item.status=[403,409,422,429].includes(error.status)?error.message:'Отправка не подтверждена. Можно повторить без нового сообщения.';drawPending();
      if(error.status===403)poll();
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
  const onClick=async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.chatBlock&&confirm('Скрыть сообщения этого игрока во всех общих чатах и закрыть личную переписку? Участником клуба он останется.')){b.disabled=true;try{const result=await request('/api/blocks','POST',{userId:b.dataset.chatBlock});if(active){blockVersion=Math.max(blockVersion??0,result.blockVersion);resetHistory();poll();}}catch(error){if(active)status(error.message);}finally{b.disabled=false;}}if(b.dataset.reportMessage){const reason=prompt('Причина жалобы. Текст этого сообщения и пояснение будут переданы модератору сервиса.');if(reason&&reason.trim().length>=3){b.disabled=true;try{await request('/api/reports','POST',{kind:endpoint.startsWith('/api/direct/')?'direct':'club',messageId:Number(b.dataset.reportMessage),reason});if(active)status('Жалоба отправлена. Статус доступен в разделе «Жалобы».');}catch(error){if(active)status(error.message);}finally{b.disabled=false;}}}if(b.hasAttribute('data-chat-read')&&readEndpoint&&loadedLast){b.disabled=true;try{await request(readEndpoint,'POST',{lastId:loadedLast});if(active)status('Загруженные сообщения отмечены прочитанными');}catch(error){if(active)handleError(error);}finally{b.disabled=false;}}if(b.hasAttribute('data-chat-refresh'))poll();if(b.hasAttribute('data-chat-older'))older();if(b.dataset.chatRetry)send(b.dataset.chatRetry);if(b.dataset.chatDiscard&&confirm('Убрать локальную попытку? Если сообщение уже дошло до сервера, оно останется в истории.')){pending.delete(b.dataset.chatDiscard);persist();drawPending();}};
  const onSubmit=e=>{
    if(!e.target.matches('[data-chat-form]'))return;e.preventDefault();
    const input=e.target.elements.body,body=input.value.trim();if(!body||!active||!canSend)return;
    if(pending.size>=20){find('[data-chat-error]').textContent='Сначала отправь или убери сообщения из очереди.';return;}
    const clientId=crypto.randomUUID();pending.set(clientId,{clientId,body,status:'Ожидает отправки'});persist();input.value='';clearDraft();drawPending();send(clientId);
  };
  const onInput=e=>{if(active&&canSend&&e.target.matches('[data-chat-form] textarea'))saveDraft();};
  for(const el of root.querySelectorAll('[data-chat-form] textarea,[data-chat-form] button'))el.disabled=!canSend;
  root.addEventListener('click',onClick);root.addEventListener('submit',onSubmit);root.addEventListener('input',onInput);drawPending();poll();
  return { destroy(){active=false;clearTimeout(timer);for(const c of requests)c.abort();root.removeEventListener('click',onClick);root.removeEventListener('submit',onSubmit);root.removeEventListener('input',onInput);} };
};
