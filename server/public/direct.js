'use strict';
window.createDirectInbox = function({root,user,api}) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active=true,chat=null,generation=0;
  const requests=new Set();
  async function request(path,method='GET',body){const c=new AbortController();requests.add(c);const timer=setTimeout(()=>c.abort(),10000);try{return await api(path,method,body,{signal:c.signal});}finally{clearTimeout(timer);requests.delete(c);}}
  const error=e=>{if(active){const el=root.querySelector('[data-direct-error]');if(el)el.textContent=e.message;}};
  async function refresh(){
    chat?.destroy();chat=null;const version=++generation;
    root.innerHTML='<h1>Сообщения</h1><p data-direct-error role="alert"></p><button class="btn quiet" data-refresh>Обновить</button>';
    try{
      const [data,blocked,session]=await Promise.all([request('/api/direct'),request('/api/blocks'),request('/api/me')]);
      if(!active||version!==generation)return;
      if(data.viewerId!==user.id||session.user?.id!==user.id){root.textContent='Сеанс изменился. Обнови страницу.';return;}
      const groups=[['Беседы',c=>c.status==='accepted'],['Входящие запросы',c=>c.status==='pending'&&c.requester_id!==user.id],['Отправленные запросы',c=>c.status==='pending'&&c.requester_id===user.id],['Отклонённые',c=>c.status==='rejected']];
      root.innerHTML=`<h1>Сообщения</h1><p class="error" data-direct-error role="alert"></p><button class="btn quiet" data-refresh>Обновить список</button>
        <form data-request class="panel"><h2>Написать игроку</h2><p class="note">До принятия запроса можно отправить одно сообщение.</p><label class="field">Точный логин<input name="handle" required minlength="3" maxlength="24"></label><label class="field">Первое сообщение<textarea name="body" required maxlength="2000"></textarea></label><button class="btn primary">Отправить запрос</button></form>
        <section class="panel"><label><input type="checkbox" data-privacy ${session.user.dmRequests?'checked':''}> Принимать новые запросы</label><p class="note">Настройка не закрывает существующие беседы.</p></section>
        ${groups.map(([title,filter])=>`<section class="panel"><h2>${title}</h2>${data.conversations.filter(filter).map(c=>`<article class="comment"><h3>${esc(c.peer_name)} · @${esc(c.peer_handle)}</h3>${c.status!=='accepted'?`<p class="content">${esc(c.first_body)}</p>`:''}<div class="row wrap">${c.status==='accepted'?`<button class="btn primary" data-conversation="${c.id}" data-title="${esc(c.peer_name)}">Открыть${c.unread?` · ${c.unread} новых`: ''}</button>`:c.status==='pending'&&c.requester_id!==user.id?`<button class="btn primary" data-accept="${c.id}">Принять</button><button class="btn quiet" data-reject="${c.id}">Отклонить</button>`:''}<button class="btn quiet" data-block="${c.peer_id}">Блокировать</button></div></article>`).join('')||'<p class="muted">Пока пусто.</p>'}</section>`).join('')}
        <section class="panel"><h2>Заблокированные</h2>${blocked.blocks.map(b=>`<p>${esc(b.name)} · @${esc(b.handle)} <button class="btn quiet" data-unblock="${b.id}">Разблокировать</button></p>`).join('')||'<p>Список пуст.</p>'}<p class="note">Блокировка закрывает доступ к личной беседе с обеих сторон. История сохраняется и снова доступна после снятия всех блокировок. Отклонённый запрос не открывается повторно.</p></section><section class="panel hidden" data-direct-chat></section>`;
    }catch(e){if(version===generation)error(e);}
  }
  async function click(e){const b=e.target.closest('button');if(!b)return;
    try{
      if(b.hasAttribute('data-refresh'))return refresh();
      if(b.dataset.conversation){chat?.destroy();const el=root.querySelector('[data-direct-chat]');el.classList.remove('hidden');chat=window.createClubChat({root:el,clubId:`direct:${b.dataset.conversation}`,userId:user.id,api,endpoint:`/api/direct/${b.dataset.conversation}/messages`,title:b.dataset.title,readEndpoint:`/api/direct/${b.dataset.conversation}/read`});return;}
      if(b.dataset.accept||b.dataset.reject){b.disabled=true;await request(`/api/direct/${b.dataset.accept||b.dataset.reject}/decision`,'POST',{decision:b.dataset.accept?'accept':'reject'});if(active)await refresh();}
      if(b.dataset.block||b.dataset.unblock){b.disabled=true;await request('/api/blocks',b.dataset.block?'POST':'DELETE',{userId:b.dataset.block||b.dataset.unblock});if(active)await refresh();}
    }catch(e){b.disabled=false;error(e);}
  }
  async function submit(e){if(!e.target.matches('[data-request]'))return;e.preventDefault();const f=e.target,b=f.querySelector('button');if(!f.reportValidity())return;
    const payload={handle:f.elements.handle.value,body:f.elements.body.value};const signature=JSON.stringify(payload);
    if(f.dataset.signature!==signature){f.dataset.signature=signature;f.dataset.clientId=crypto.randomUUID();}
    b.disabled=true;try{await request('/api/direct','POST',{...payload,clientId:f.dataset.clientId});if(active)await refresh();}catch(e){error(e);}finally{b.disabled=false;}
  }
  async function change(e){if(!e.target.matches('[data-privacy]'))return;const el=e.target;el.disabled=true;try{await request('/api/me/privacy','PATCH',{dmRequests:el.checked});}catch(e){el.checked=!el.checked;error(e);}finally{el.disabled=false;}}
  root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('change',change);refresh();
  return {destroy(){active=false;generation++;chat?.destroy();for(const c of requests)c.abort();root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('change',change);}};
};
