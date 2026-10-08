'use strict';
window.createDirectInbox = function({root,user,api,initialHandle=''}) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active=true,chat=null,generation=0,nextPage=null,selected=null,draft={handle:'',body:''},draftId='',draftSignature='',composeOpen=false,settingsOpen=false;
  root.classList.add('editorial-direct');
  const groups=[['Беседы',c=>c.status==='accepted'],['Входящие',c=>c.status==='pending'&&c.requester_id!==user.id],['Отправленные',c=>c.status==='pending'&&c.requester_id===user.id],['Отклонённые',c=>c.status==='rejected']];
  const stamp=value=>{
    const n=Number(value);if(!Number.isFinite(n)||n<=0)return '';
    const date=new Date(n);if(Number.isNaN(date.getTime()))return '';
    const today=new Date(),yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
    const label=date.toDateString()===today.toDateString()?date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):date.toDateString()===yesterday.toDateString()?'Вчера':date.toLocaleDateString('ru-RU',{day:'numeric',month:'short',...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{})});
    return `<time datetime="${date.toISOString()}" title="${esc(date.toLocaleString('ru-RU'))}">${esc(label)}</time>`;
  };
  const preview=c=>{const body=c.last_body??c.first_body??'',prefix=c.last_sender_id===user.id?'Ты: ':'';return esc(prefix+Array.from(body).slice(0,140).join('')+(Array.from(body).length>140?'…':''));};
  const card=c=>`<article class="direct-row ${c.unread?'has-unread':''}" data-direct-row="${esc(c.id)}"><span class="direct-initial" aria-hidden="true">${esc(Array.from(c.peer_name||c.peer_handle).slice(0,1).join('').toUpperCase())}${c.peer_avatar_id?`<img src="/api/media/${encodeURIComponent(c.peer_avatar_id)}" alt="" loading="lazy">`:''}</span><div class="direct-copy">${c.status==='accepted'?`<button type="button" class="direct-open" data-conversation="${esc(c.id)}" data-title="${esc(c.peer_name)}"><span class="direct-person"><strong>${esc(c.peer_name)}${c.peer_is_bot?' <span class="bot-badge">Бот</span>':''}</strong><small>@${esc(c.peer_handle)}</small><span class="direct-preview">${preview(c)}</span></span><span class="direct-meta">${stamp(c.last_created_at)}${c.unread?`<span class="direct-unread">${c.unread} новых</span>`:'<span class="direct-chevron" aria-hidden="true">›</span>'}</span></button>`:`<h3>${esc(c.peer_name)}${c.peer_is_bot?' <span class="bot-badge">Бот</span>':''}<small>@${esc(c.peer_handle)}</small></h3><p class="content">${esc(c.first_body)}</p>`}<div class="direct-actions">${c.status==='pending'&&c.requester_id!==user.id?`<button type="button" class="btn primary" data-accept="${esc(c.id)}">Принять</button><button type="button" class="btn quiet" data-reject="${esc(c.id)}">Отклонить</button>`:''}${c.status!=='accepted'&&c.requester_id!==user.id?`<button type="button" class="btn quiet" data-request-report="${c.first_message_id}">Пожаловаться</button>`:''}<details class="direct-row-menu"><summary>Ещё<span class="sr-only">: ${esc(c.peer_name)}</span></summary><button type="button" class="btn quiet" data-block="${esc(c.peer_id)}">Блокировать</button></details></div></div></article>`;
  const imageError=e=>{if(e.target.matches?.('.direct-initial img'))e.target.remove();};
  root.addEventListener('error',imageError,true);
  const requests=new Set();
  async function request(path,method='GET',body){const c=new AbortController();requests.add(c);const timer=setTimeout(()=>c.abort(),10000);try{return await api(path,method,body,{signal:c.signal});}finally{clearTimeout(timer);requests.delete(c);}}
  const error=e=>{if(active){const el=root.querySelector('[data-direct-error]');if(el)el.textContent=e.message;}};
  const budgetNote=budget=>budget?`Новых адресатов за 24 часа: осталось ${budget.remaining} из ${budget.limit}. Пауза между знакомствами — ${Math.ceil(budget.cooldownSeconds/60)} мин.${budget.newAccount?' Для нового аккаунта действует меньший лимит.':''} Существующие беседы не расходуют этот лимит.`:'';
  function remember(){const f=root.querySelector('[data-request]');if(f){draft={handle:f.elements.handle.value,body:f.elements.body.value};draftId=f.dataset.clientId||'';draftSignature=f.dataset.signature||'';composeOpen=root.querySelector('[data-direct-compose]').open;settingsOpen=root.querySelector('[data-direct-settings]').open;}}
  function select(tab){selected=tab;for(const b of root.querySelectorAll('[data-direct-tab]'))b.setAttribute('aria-pressed',String(b.dataset.directTab===tab));root.querySelector('[data-direct-dialogs]').hidden=tab!=='dialogs';root.querySelector('[data-direct-requests]').hidden=tab!=='requests';}
  function openCompose(){const el=root.querySelector('[data-direct-compose]');if(el){el.open=true;el.querySelector('[name=handle]').focus();}}
  async function refresh(){
    remember();chat?.destroy();chat=null;const version=++generation;
    root.innerHTML='<header class="direct-heading"><h1>Чаты</h1><button type="button" class="btn quiet" data-refresh>Обновить</button></header><p data-direct-error class="error" role="alert"></p><p role="status">Загружаем беседы…</p>';
    try{
      const [data,blocked,session]=await Promise.all([request('/api/direct'),request('/api/blocks'),request('/api/me')]);
      if(!active||version!==generation)return;
      if(data.viewerId!==user.id||session.user?.id!==user.id){root.textContent='Сеанс изменился. Обнови страницу.';return;}
      if(selected===null)selected=!data.conversations.some(groups[0][1])&&data.requests?'requests':'dialogs';
      root.innerHTML=`<p class="error" data-direct-error role="alert"></p><div data-direct-inbox><header class="direct-heading"><div><h1>Разговор продолжается</h1></div><button type="button" class="btn primary" data-direct-compose-open>Написать</button></header><p class="direct-intro">Личные беседы между матчами. <a href="/clubs">Клубы и их чаты</a></p>
        <div class="direct-tabs" role="group" aria-label="Разделы чатов"><button type="button" data-direct-tab="dialogs">Беседы${data.unread?` <span class="pill">${data.unread} новых</span>`:''}</button><button type="button" data-direct-tab="requests">Запросы${data.requests?` <span class="pill">${data.requests} входящих</span>`:''}</button></div>
        <div data-direct-dialogs><section data-direct-group="0">${data.conversations.filter(groups[0][1]).map(card).join('')||'<div class="compact-empty" data-group-empty><h2>Разговор начинается с приветствия</h2><p>Принятые беседы появятся здесь. Найди игрока или напиши знакомому по логину.</p><button type="button" class="btn quiet" data-direct-compose-open>Написать игроку</button> <a class="text-link" href="/teams">Найти компанию →</a></div>'}</section></div>
        <div data-direct-requests><p class="note">Принятие открывает переписку. До этого доступно только первое сообщение.</p>${groups.slice(1).map(([title,filter],j)=>`<section class="direct-request-group" data-direct-group="${j+1}"><h2>${title}</h2>${data.conversations.filter(filter).map(card).join('')||'<p class="muted" data-group-empty>Запросов пока нет.</p>'}</section>`).join('')}</div>
        <div class="direct-list-footer"><button type="button" class="btn quiet" data-refresh>Обновить список</button><button type="button" class="btn quiet" data-direct-more ${data.next?'':'hidden'}>Ещё беседы и запросы</button></div>
        <details class="catalog-create" data-direct-compose ${composeOpen?'open':''}><summary>Написать игроку</summary><form data-request><h2>Первое приветствие</h2><p class="note">До принятия запроса можно отправить одно сообщение.</p><label class="field">Точный логин<input name="handle" required minlength="3" maxlength="24" autocapitalize="none" spellcheck="false"></label><label class="field">Первое сообщение<textarea name="body" required maxlength="2000" rows="3" placeholder="Предложи сыграть или познакомиться…"></textarea></label><p class="note" data-contact-budget>${esc(budgetNote(data.contactBudget))}</p><button class="btn primary">Отправить запрос</button></form></details>
        <details class="direct-settings" data-direct-settings ${settingsOpen?'open':''}><summary>Приватность и блокировки</summary><label class="direct-privacy"><input type="checkbox" data-privacy ${session.user.dmRequests?'checked':''}> Принимать новые запросы</label><p class="note">Настройка не закрывает существующие беседы.</p><h2>Заблокированные</h2>${blocked.blocks.map(b=>`<div class="direct-blocked"><span>${esc(b.name)} <small>@${esc(b.handle)}</small></span><button type="button" class="btn quiet" data-unblock="${esc(b.id)}">Разблокировать</button></div>`).join('')||'<p class="muted">Список пуст.</p>'}<p class="note">Блокировка закрывает личную беседу с обеих сторон. История сохраняется и снова доступна после снятия всех блокировок. Отклонённый запрос не открывается повторно. В общих чатах сообщения заблокированных тобой игроков скрыты; членство в клубе не меняется.</p></details></div>
        <section class="direct-conversation" data-direct-conversation hidden><button type="button" class="btn quiet direct-back" data-direct-back>← Все чаты</button><div data-direct-chat></div></section>`;
      nextPage=data.next;select(selected);
      const form=root.querySelector('[data-request]');form.elements.handle.value=draft.handle;form.elements.body.value=draft.body;form.dataset.clientId=draftId;form.dataset.signature=draftSignature;
      if(initialHandle){openCompose();form.elements.handle.value=initialHandle;initialHandle='';form.elements.body.focus();}
    }catch(e){if(version===generation){const note=root.querySelector('[role=status]');if(note)note.textContent='Не удалось загрузить беседы. Повтори обновление.';error(e);}}
  }
  async function click(e){const b=e.target.closest('button');if(!b)return;
    try{
      if(b.dataset.directTab){select(b.dataset.directTab);return;}
      if(b.hasAttribute('data-direct-compose-open')){openCompose();return;}
      if(b.hasAttribute('data-direct-back')){await refresh();root.querySelector(`[data-direct-tab="${selected}"]`)?.focus();return;}
      if(b.dataset.requestReport){const reason=prompt('Причина жалобы. Первое сообщение и пояснение будут переданы модератору сервиса.');if(reason&&reason.trim().length>=3){b.disabled=true;await request('/api/reports','POST',{kind:'direct',messageId:Number(b.dataset.requestReport),reason});if(active){root.querySelector('[data-direct-error]').textContent='Жалоба отправлена. Запрос не принят.';b.disabled=false;}}return;}
      if(b.hasAttribute('data-direct-more')){
        b.disabled=true;const version=generation;
        const data=await request('/api/direct?after='+encodeURIComponent(nextPage));if(!active||version!==generation||data.viewerId!==user.id)return;
        groups.forEach(([_,filter],i)=>{const rows=data.conversations.filter(filter);if(rows.length){const group=root.querySelector('[data-direct-group="'+i+'"]');group.querySelector('[data-group-empty]')?.remove();group.insertAdjacentHTML('beforeend',rows.map(card).join(''));}});
        nextPage=data.next;b.hidden=!nextPage;b.disabled=false;return;
      }
      if(b.hasAttribute('data-refresh'))return refresh();
      if(b.dataset.conversation){chat?.destroy();remember();root.querySelector('[data-direct-inbox]').hidden=true;root.querySelector('[data-direct-conversation]').hidden=false;const el=root.querySelector('[data-direct-chat]');chat=window.createClubChat({root:el,clubId:`direct:${b.dataset.conversation}`,userId:user.id,api,endpoint:`/api/direct/${b.dataset.conversation}/messages`,title:b.dataset.title,readEndpoint:`/api/direct/${b.dataset.conversation}/read`});root.querySelector('[data-direct-back]').focus();return;}
      if(b.dataset.accept||b.dataset.reject){b.disabled=true;if(b.dataset.accept)selected='dialogs';await request(`/api/direct/${b.dataset.accept||b.dataset.reject}/decision`,'POST',{decision:b.dataset.accept?'accept':'reject'});if(active)await refresh();}
      if(b.dataset.block||b.dataset.unblock){b.disabled=true;await request('/api/blocks',b.dataset.block?'POST':'DELETE',{userId:b.dataset.block||b.dataset.unblock});if(active)await refresh();}
    }catch(e){b.disabled=false;error(e);}
  }
  async function submit(e){if(!e.target.matches('[data-request]'))return;e.preventDefault();const f=e.target,b=f.querySelector('button');if(!f.reportValidity())return;
    const payload={handle:f.elements.handle.value,body:f.elements.body.value};const signature=JSON.stringify(payload);
    if(f.dataset.signature!==signature){f.dataset.signature=signature;f.dataset.clientId=crypto.randomUUID();}
    b.disabled=true;try{await request('/api/direct','POST',{...payload,clientId:f.dataset.clientId});if(active){f.reset();delete f.dataset.signature;delete f.dataset.clientId;selected='requests';await refresh();}}catch(e){error(e);if(e.status===429){try{const d=await request('/api/direct/contact-budget');if(active&&d.viewerId===user.id)root.querySelector('[data-contact-budget]').textContent=budgetNote(d.contactBudget);}catch{}}}finally{b.disabled=false;}
  }
  async function change(e){if(!e.target.matches('[data-privacy]'))return;const el=e.target;el.disabled=true;try{await request('/api/me/privacy','PATCH',{dmRequests:el.checked});}catch(e){el.checked=!el.checked;error(e);}finally{el.disabled=false;}}
  root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('change',change);refresh();
  return {destroy(){active=false;generation++;chat?.destroy();for(const c of requests)c.abort();root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('change',change);root.removeEventListener('error',imageError,true);}};
};
