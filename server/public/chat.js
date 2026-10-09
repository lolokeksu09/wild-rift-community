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
      if (item && typeof item.clientId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(item.clientId) && typeof item.body === 'string' && item.body.trim().length > 0 && item.body.length <= 2000) pending.set(item.clientId, { clientId:item.clientId, body:item.body, replyId:Number.isSafeInteger(item.replyId)?item.replyId:null, status:'Не подтверждено. Можно повторить.' });
    }
  } catch { /* Storage may be unavailable; in-memory retries still work. */ }
  let loadedLast = 0, blockVersion = null, canSend = false, draftLoaded = false, revision=null, replyId=null, replyLoaded=false, renderCanSend=null;
  const mutations=new Map(), mutationKey=storageKey+':actions', editDraftKey=draftKey+':edit',replyDraftKey=draftKey+':reply';
  try{for(const m of JSON.parse(sessionStorage.getItem(mutationKey)||'[]').slice(0,20)){if(m&&['edit','delete','reaction'].includes(m.action)&&Number.isSafeInteger(m.id)&&typeof m.payload?.clientId==='string')mutations.set(m.payload.clientId,{...m,busy:false,status:'Действие не подтверждено. Можно повторить.'});}}catch{}
  const clubChat = endpoint.startsWith('/api/clubs/') || endpoint.startsWith('/api/lfg/') || endpoint.startsWith('/api/events/');
  const canReport = !endpoint.startsWith('/api/lfg/') && !endpoint.startsWith('/api/events/');
  root.classList.add('editorial-chat');root.classList.remove('chat-unavailable');
  root.innerHTML = `<header class="chat-heading"><h3>${encode(title)}</h3><details class="chat-tools"><summary>Действия</summary><button type="button" class="btn quiet" data-chat-refresh>Обновить</button>${readEndpoint?'<button type="button" class="btn quiet" data-chat-read disabled>Отметить загруженное прочитанным</button>':''}</details></header><p class="note" data-chat-status role="status">Подключение…</p><button type="button" class="btn quiet hidden" data-chat-older>Ранние сообщения</button><div class="server-chat-log" data-chat-log role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions text"></div><div class="chat-outbox" data-chat-pending aria-label="Неподтверждённые сообщения"></div><form class="chat-composer" data-chat-form><label class="field"><span class="sr-only">Сообщение</span><textarea name="body" required maxlength="2000" rows="2" placeholder="Напиши сообщение…" ${readOnly?'disabled':''}></textarea></label><button class="btn primary" ${readOnly?'disabled':''}>Отправить</button><p class="error" data-chat-error role="alert"></p></form>`;
  const find = selector => root.querySelector(selector);
  const draftNote = document.createElement('small');
  draftNote.className='chat-draft-status';draftNote.setAttribute('role','status');draftNote.hidden=true;
  find('[data-chat-form]').append(draftNote);
  const replyBox=document.createElement('div');replyBox.className='chat-reply-context';replyBox.hidden=true;find('[data-chat-form]').prepend(replyBox);
  const actionBox=document.createElement('div');actionBox.className='chat-action-outbox';actionBox.setAttribute('data-chat-actions','');find('[data-chat-pending]').after(actionBox);
  const dialog=document.createElement('dialog');dialog.className='chat-action-dialog';root.append(dialog);let dialogReturn=null,dialogEditId=null;
  const closeDialog=()=>{if(dialog.open&&typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');dialog.innerHTML='';dialogEditId=null;(dialogReturn?.isConnected?dialogReturn:find('[data-chat-form] textarea'))?.focus();};
  const showDialog=html=>{dialog.innerHTML=html;if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');dialog.querySelector('textarea,button')?.focus();};
  function drawReply(){const m=messages.get(replyId);if(!m||m.deleted||m.removed){replyId=null;replyBox.hidden=true;replyBox.textContent='';return;}replyBox.hidden=false;replyBox.innerHTML=`<div><small>Ответ · ${encode(m.sender_name)}</small><p>${encode(m.body.slice(0,160))}</p></div><button type="button" class="btn quiet" data-chat-reply-cancel>Отмена ответа</button>`;}
  function persistMutations(){try{if(mutations.size)sessionStorage.setItem(mutationKey,JSON.stringify([...mutations.values()].map(({id,action,payload})=>({id,action,payload}))));else sessionStorage.removeItem(mutationKey);}catch{status('Действие не сохранено в этой вкладке. Не закрывай страницу.');}}
  function drawMutations(){if(!active)return;actionBox.innerHTML=[...mutations.values()].map(m=>`<div class="chat-pending"><p>${encode({edit:'Изменение',delete:'Удаление',reaction:'Реакция'}[m.action])} сообщения · ${encode(m.status)}</p>${m.action==='edit'?`<p class="content">${encode(m.payload.body)}</p>`:''}<button type="button" class="btn quiet" data-mutation-retry="${encode(m.payload.clientId)}" ${m.busy||!canSend?'disabled':''}>Повторить</button><button type="button" class="btn quiet" data-mutation-discard="${encode(m.payload.clientId)}" ${m.busy?'disabled':''}>Убрать попытку</button></div>`).join('');}
  async function mutate(key){const m=mutations.get(key);if(!active||!canSend||!m||m.busy)return;m.busy=true;m.status='Отправляется…';drawMutations();try{const data=await request(`${endpoint}/${m.id}/${m.action}`,'POST',m.payload);if(!active)return;mutations.delete(key);persistMutations();merge([data.message]);if(m.action==='edit'){try{const saved=JSON.parse(sessionStorage.getItem(editDraftKey)||'null');if(saved?.clientId===key)sessionStorage.removeItem(editDraftKey);}catch{}}status('Действие сохранено');}catch(error){if(!active)return;if(error.status===401){revoke();return;}m.busy=false;m.status=[403,404,409,422,429].includes(error.status)?error.message:'Действие не подтверждено. Повтори ту же попытку.';drawMutations();if(error.status===403||error.status===404)poll();}}
  function queueMutation(id,action,payload){if(mutations.size>=20){status('Сначала повтори или убери неподтверждённые действия.');return false;}mutations.set(payload.clientId,{id,action,payload,status:'Ожидает отправки'});persistMutations();drawMutations();mutate(payload.clientId);return true;}
  function openAction(id,action,button){const m=messages.get(id);if(!m||m.deleted||!canSend)return;dialogReturn=button;dialogEditId=id;const title=action==='edit'?'Изменить сообщение':'Удалить сообщение?';let draft=null;try{const saved=JSON.parse(sessionStorage.getItem(editDraftKey)||'null');if(saved?.id===id)draft=saved;}catch{}
    showDialog(`<form data-chat-action-form data-action="${action}" data-id="${id}" data-version="${draft?.version||m.version||1}" data-client="${encode(draft?.clientId||crypto.randomUUID())}"><h3 id="chat-action-title">${title}</h3>${action==='edit'?`<label class="field"><span>Текст сообщения</span><textarea name="editBody" required maxlength="2000" rows="5">${encode(draft?.body??m.body)}</textarea></label>`:`<p>Текст и реакции будут удалены у всех участников. На его месте останется отметка об удалении.</p><blockquote>${encode(m.body.slice(0,240))}</blockquote>`}<p class="error" data-action-error role="alert"></p>${action==='edit'?'<button type="button" class="btn quiet" data-chat-edit-current>Проверить актуальный текст</button><div data-chat-current-text></div>':''}<div class="row wrap"><button class="btn ${action==='edit'?'primary':'danger'}">${action==='edit'?'Сохранить':'Удалить'}</button><button type="button" class="btn quiet" data-chat-dialog-cancel>Отмена</button></div></form>`);dialog.setAttribute('aria-labelledby','chat-action-title');
  }
  function draftStatus(text) { if(active){draftNote.textContent=text;draftNote.hidden=!text;} }
  function saveReply(){try{if(replyId)sessionStorage.setItem(replyDraftKey,String(replyId));else sessionStorage.removeItem(replyDraftKey);}catch{status('Адресат ответа не сохранён в этой вкладке.');}}
  function saveDraft() {
    try {
      const body=find('[data-chat-form] textarea').value;
      if(body)sessionStorage.setItem(draftKey,body.slice(0,2000));else sessionStorage.removeItem(draftKey);
      draftStatus(body?'Черновик сохранён в этой вкладке':'');
    } catch { draftStatus('Черновик не сохранён. Не закрывай страницу.'); }
  }
  function clearDraft() {
    try { sessionStorage.removeItem(draftKey);sessionStorage.removeItem(replyDraftKey);draftStatus(''); }
    catch { draftStatus('Не удалось очистить сохранённый черновик.'); }
  }
  const status = text => { if (active) find('[data-chat-status]').textContent = text; };
  function persist() {
    try { if (pending.size) sessionStorage.setItem(storageKey,JSON.stringify([...pending.values()].map(({clientId,body,replyId})=>({clientId,body,replyId:replyId??null})))); else sessionStorage.removeItem(storageKey); }
    catch { if (active) find('[data-chat-error]').textContent = 'Черновики не сохраняются в этом браузере. Не закрывай страницу до подтверждения отправки.'; }
  }
  function drawPending() {
    if (!active) return;
    find('[data-chat-pending]').innerHTML = [...pending.values()].map(m=>`<div class="chat-pending"><small>${encode(m.status)}</small><p class="content">${encode(m.body)}</p><div class="row wrap"><button type="button" class="btn quiet" data-chat-retry="${m.clientId}" ${m.busy||!canSend?'disabled':''}>Повторить</button><button type="button" class="btn quiet" data-chat-discard="${m.clientId}" ${m.busy?'disabled':''}>Убрать из очереди</button></div></div>`).join('');
  }
  function merge(list) {
    for (const m of list) {
      const previous=messages.get(m.id);if(previous&&((previous.version||1)>(m.version||1)||(previous.changeRevision||0)>(m.changeRevision||0)))continue;if(m.removed){messages.set(m.id,m);continue;}messages.set(m.id,m); loadedLast=Math.max(loadedLast,m.id);
      if (m.sender_id===userId) pending.delete(m.client_id);
    }
    persist();
    if (!active) return;
    const log=find('[data-chat-log]');
    if (!list.length && messages.size && log.childNodes.length && renderCanSend===canSend) { drawPending(); return; }
    const nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<50;
    const openMenus=new Set([...log.querySelectorAll('.chat-message-tools[open]')].map(el=>el.closest('[data-message-id]').dataset.messageId));
    renderCanSend=canSend;let day='';
    log.innerHTML=[...messages.values()].filter(m=>!m.removed).sort((a,b)=>a.id-b.id).map(m=>{
      const date=new Date(m.created_at),key=date.toDateString();
      const divider=key!==day?`<p class="chat-day">${encode(date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}))}</p>`:'';day=key;
      const reactions=(m.reactions||[]).map(r=>`<button type="button" class="chat-reaction ${r.mine?'selected':''}" aria-pressed="${!!r.mine}" aria-label="Реакция ${encode(r.emoji)}, ${r.count}" data-chat-reaction="${m.id}" data-emoji="${encode(r.emoji)}" ${!canSend?'disabled':''}>${encode(r.emoji)} ${r.count}</button>`).join('');
      return `${divider}<div class="bubble ${m.sender_id===userId?'self':''}" data-message-id="${m.id}"><small>${encode(m.sender_name)} · <time datetime="${encode(date.toISOString())}">${encode(date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}</time></small>${m.edited_at&&!m.deleted?'<small class="chat-edited">Изменено</small>':''}${m.replyId?`<blockquote class="chat-quote"><small>${encode(m.reply?.sender_name||'Исходное сообщение недоступно')}</small>${m.reply?`<p>${encode(m.reply.body)}</p>`:''}</blockquote>`:''}<span>${m.deleted?'Сообщение удалено':encode(m.body)}</span>${!m.deleted?`<div class="chat-message-actions"><button type="button" class="chat-inline-action" data-chat-reply="${m.id}" ${!canSend?'disabled':''}>Ответить</button><details class="chat-message-tools" ${openMenus.has(String(m.id))?'open':''}><summary>Действия<span class="sr-only"> с сообщением ${m.id}</span></summary>${canSend?`<div class="chat-reaction-picker" aria-label="Добавить реакцию">${['👍','❤️','😂','🔥','🎮'].map(emoji=>`<button type="button" class="chat-reaction" data-chat-reaction="${m.id}" data-emoji="${emoji}" aria-label="Реакция ${emoji}">${emoji}</button>`).join('')}</div>${m.sender_id===userId?`<button type="button" class="btn quiet" data-chat-edit="${m.id}">Изменить</button><button type="button" class="btn quiet danger" data-chat-delete="${m.id}">Удалить</button>`:''}`:''}${m.sender_id!==userId&&canReport?`<button type="button" class="btn quiet" data-report-message="${m.id}">Пожаловаться</button>${clubChat?`<button type="button" class="btn quiet" data-chat-block="${encode(m.sender_id)}">Блокировать игрока</button>`:''}`:''}</details></div>${reactions?`<div class="chat-reactions">${reactions}</div>`:''}`:''}</div>`;
    }).join('') || `<div class="chat-empty"><h4>${canSend?'Первое слово за тобой':'История разговора'}</h4><p class="muted">${canSend?'Сообщений пока нет. Поздоровайся и договорись об игре.':'Сообщений пока нет. Отправка в этом чате закрыта.'}</p></div>`;
    if(readEndpoint)find('[data-chat-read]').disabled=!loadedLast;
    if(nearEnd) log.scrollTop=log.scrollHeight;
    drawPending();drawMutations();drawReply();
  }
  function revoke() {
    if (!active) return;
    active=false;clearTimeout(timer);for(const c of requests)c.abort();pending.clear();messages.clear();mutations.clear();
    try { sessionStorage.removeItem(storageKey);sessionStorage.removeItem(draftKey);sessionStorage.removeItem(mutationKey);sessionStorage.removeItem(editDraftKey);sessionStorage.removeItem(replyDraftKey); } catch {}
    root.classList.add('chat-unavailable');root.innerHTML='<h3>Чат недоступен</h3><p class="note">Сеанс или членство изменились. Обнови страницу.</p>';
  }
  function resetHistory(){messages.clear();revision=null;replyId=null;saveReply();drawReply();cursor=0;oldest=null;hasOlder=false;initial=true;loadedLast=0;if(readEndpoint)find('[data-chat-read]').disabled=true;find('[data-chat-log]').textContent='Обновление истории…';find('[data-chat-older]').classList.add('hidden');}
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
    const visibilityVersion=data.visibilityVersion??data.blockVersion;
    if(clubChat&&Number.isSafeInteger(visibilityVersion)){
      if(blockVersion!==null&&visibilityVersion<blockVersion)return false;
      if(blockVersion!==null&&visibilityVersion!==blockVersion){blockVersion=visibilityVersion;resetHistory();return false;}
      blockVersion=visibilityVersion;
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
      const data=await request(`${endpoint}${initial?'':`?after=${cursor}${revision===null?'':`&revision=${revision}`}`}`);
      if (!active || !allowed(data)) return;
      if(initial){hasOlder=data.hasMore;oldest=data.messages[0]?.id??null;find('[data-chat-older]').classList.toggle('hidden',!hasOlder);}
      merge([...data.messages,...(data.changes||[])]);if(Number.isSafeInteger(data.revision))revision=data.revision;
      if(!replyLoaded&&canSend){replyLoaded=true;let saved=null;try{saved=Number(sessionStorage.getItem(replyDraftKey));}catch{}if(Number.isSafeInteger(saved)&&saved>0){try{if(!messages.has(saved)){const source=await request(`${endpoint}/${saved}`);if(!active)return;merge([source.message]);}replyId=saved;drawReply();saveReply();}catch(error){if([401,403].includes(error.status)){handleError(error);return;}replyId=null;saveReply();status('Исходное сообщение для ответа недоступно. Твой черновик сохранён.');}}}
      if(data.messages.length)cursor=Math.max(cursor,data.messages.at(-1).id);
      more=(!initial&&data.hasMore)||data.changesMore;initial=false;
      status(canSend?'Подключено · сообщения обновляются автоматически':'Подключено · история доступна только для чтения');
    }catch(error){if(active)handleError(error);}
    finally{polling=false;if(active)timer=setTimeout(poll,more?50:2000);}
  }
  async function send(clientId) {
    const item=pending.get(clientId);if(!active||!canSend||!item||item.busy)return;
    item.busy=true;item.status='Отправляется…';drawPending();
    try {
      const data=await request(`${endpoint}`,'POST',{clientId,body:item.body,replyId:item.replyId??null});
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
  const onClick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-chat-edit-current')){b.disabled=true;try{const data=await request(`${endpoint}/${dialogEditId}`);if(!active||!dialog.hasAttribute('open'))return;if(data.message.deleted){find('[data-action-error]').textContent='Сообщение удалено. Сохранение недоступно.';return;}const f=dialog.querySelector('form');f.dataset.version=data.message.version;f.dataset.client=crypto.randomUUID();dialog.querySelector('[data-chat-current-text]').textContent='Сейчас в чате: '+data.message.body;find('[data-action-error]').textContent='Актуальная версия загружена. Проверь свой текст перед сохранением.';merge([data.message]);}catch(error){if(active&&find('[data-action-error]'))find('[data-action-error]').textContent=error.message;}finally{b.disabled=false;}return;}
    if(b.hasAttribute('data-chat-dialog-cancel')){closeDialog();return;}if(b.hasAttribute('data-chat-reply-cancel')){replyId=null;saveReply();drawReply();return;}
    if(b.dataset.chatReply){replyId=Number(b.dataset.chatReply);saveReply();drawReply();find('[data-chat-form] textarea').focus();return;}
    if(b.dataset.chatEdit||b.dataset.chatDelete){openAction(Number(b.dataset.chatEdit||b.dataset.chatDelete),b.dataset.chatEdit?'edit':'delete',b);return;}
    if(b.dataset.chatReaction){const id=Number(b.dataset.chatReaction),emoji=b.dataset.emoji,m=messages.get(id);if(!m||!canSend||[...mutations.values()].some(x=>x.id===id&&x.action==='reaction'))return;queueMutation(id,'reaction',{clientId:crypto.randomUUID(),emoji,active:!m.reactions?.find(r=>r.emoji===emoji)?.mine});return;}
    if(b.dataset.mutationRetry){mutate(b.dataset.mutationRetry);return;}if(b.dataset.mutationDiscard){mutations.delete(b.dataset.mutationDiscard);persistMutations();drawMutations();status('Локальная попытка убрана. Уже выполненное действие остаётся на сервере.');return;}
if(b.dataset.chatBlock&&confirm('Скрыть сообщения этого игрока во всех общих чатах и закрыть личную переписку? Участником клуба он останется.')){b.disabled=true;try{const result=await request('/api/blocks','POST',{userId:b.dataset.chatBlock});if(active){blockVersion=Math.max(blockVersion??0,(result.visibilityVersion??result.blockVersion));resetHistory();poll();}}catch(error){if(active)status(error.message);}finally{b.disabled=false;}}if(b.dataset.reportMessage){const reason=prompt('Причина жалобы. Текст этого сообщения и пояснение будут переданы модератору сервиса.');if(reason&&reason.trim().length>=3){b.disabled=true;try{await request('/api/reports','POST',{kind:endpoint.startsWith('/api/direct/')?'direct':'club',messageId:Number(b.dataset.reportMessage),reason});if(active)status('Жалоба отправлена. Статус доступен в разделе «Жалобы».');}catch(error){if(active)status(error.message);}finally{b.disabled=false;}}}if(b.hasAttribute('data-chat-read')&&readEndpoint&&loadedLast){b.disabled=true;try{await request(readEndpoint,'POST',{lastId:loadedLast});if(active)status('Загруженные сообщения отмечены прочитанными');}catch(error){if(active)handleError(error);}finally{b.disabled=false;}}if(b.hasAttribute('data-chat-refresh'))poll();if(b.hasAttribute('data-chat-older'))older();if(b.dataset.chatRetry)send(b.dataset.chatRetry);if(b.dataset.chatDiscard&&confirm('Убрать локальную попытку? Если сообщение уже дошло до сервера, оно останется в истории.')){pending.delete(b.dataset.chatDiscard);persist();drawPending();}};
  const onSubmit=e=>{
    if(e.target.matches('[data-chat-action-form]')){e.preventDefault();const f=e.target,id=Number(f.dataset.id),action=f.dataset.action,payload={clientId:f.dataset.client,version:Number(f.dataset.version)};if(action==='edit'){payload.body=f.elements.editBody.value.trim();if(!payload.body)return;try{sessionStorage.setItem(editDraftKey,JSON.stringify({id,version:payload.version,clientId:payload.clientId,body:payload.body}));}catch{}}if(queueMutation(id,action,payload))closeDialog();return;}
    if(!e.target.matches('[data-chat-form]'))return;e.preventDefault();
    const input=e.target.elements.body,body=input.value.trim();if(!body||!active||!canSend)return;
    if(pending.size>=20){find('[data-chat-error]').textContent='Сначала отправь или убери сообщения из очереди.';return;}
    const clientId=crypto.randomUUID();pending.set(clientId,{clientId,body,replyId,status:'Ожидает отправки'});persist();input.value='';replyId=null;drawReply();clearDraft();drawPending();send(clientId);
  };
  const onInput=e=>{if(active&&canSend&&e.target.matches('[data-chat-form] textarea'))saveDraft();if(active&&e.target.matches('[name=editBody]')){const f=e.target.form;try{sessionStorage.setItem(editDraftKey,JSON.stringify({id:Number(f.dataset.id),version:Number(f.dataset.version),clientId:f.dataset.client,body:e.target.value}));}catch{find('[data-action-error]').textContent='Черновик изменения не сохранён. Не закрывай страницу.';}}};
  const onKey=e=>{if(e.key==='Escape'&&dialog.hasAttribute('open')){e.preventDefault();closeDialog();}};root.addEventListener('keydown',onKey);dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
  for(const el of root.querySelectorAll('[data-chat-form] textarea,[data-chat-form] button'))el.disabled=!canSend;
  root.addEventListener('click',onClick);root.addEventListener('submit',onSubmit);root.addEventListener('input',onInput);drawPending();drawMutations();poll();
  return { destroy(){active=false;clearTimeout(timer);for(const c of requests)c.abort();root.removeEventListener('click',onClick);root.removeEventListener('submit',onSubmit);root.removeEventListener('input',onInput);root.removeEventListener('keydown',onKey);} };
};
