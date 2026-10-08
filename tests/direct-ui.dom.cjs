const {JSDOM,VirtualConsole}=require('jsdom');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href);
 const app=await createApp();const origin=await app.listen();let dom,controller;
 try{
  function client(){return{cookie:'',csrf:'',id:null,async api(route,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;if(!r.ok){const e=new Error(data.error);e.status=r.status;throw e;}return data;}};}
  const owner=client(),member=client(),third=client(),fourth=client();for(const [c,handle]of [[owner,'uiowner'],[member,'uimember'],[third,'uithird'],[fourth,'uifourth']])await c.api('/api/register','POST',{handle,name:handle,password:'Test-chat-ui-12345'});
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<section id="root"></section>',{url:origin,runScripts:'outside-only',virtualConsole:vc});const w=dom.window,d=w.document;
  for(const file of ['chat.js','direct.js'])w.eval(fs.readFileSync(path.join(__dirname,'../server/public',file),'utf8'));
  await owner.api('/api/direct','POST',{handle:'uimember',clientId:'ui-direct-request-0001',body:'<img src=x> Привет'});
  const root=d.querySelector('#root');controller=w.createDirectInbox({root,user:{id:member.id},api:(...args)=>member.api(...args),initialHandle:'uiowner'});
  async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timeout: '+root.textContent);}
  await until(()=>d.querySelector('[data-accept]'));assert.equal(d.querySelectorAll('img').length,0);
  assert.equal(d.querySelector('[data-direct-compose]').open,true);assert.equal(d.activeElement,d.querySelector('[data-request] [name=body]'));assert.equal(d.querySelector('[data-request] [name=handle]').value,'uiowner');
  assert.equal((await member.api('/api/direct')).conversations[0].status,'pending','Choosing a player must not send or accept');
  assert.equal(d.querySelector('[data-direct-tab=requests]').getAttribute('aria-pressed'),'true');
  w.prompt=()=> 'Проверить первое сообщение';d.querySelector('[data-request-report]').click();await until(()=>root.textContent.includes('Жалоба отправлена'));assert.equal((await member.api('/api/direct')).conversations[0].status,'pending');
  d.querySelector('[data-request] [name=body]').value='Черновик первого приветствия';
  d.querySelector('[data-accept]').click();await until(()=>d.querySelector('[data-conversation]'));
  assert.equal(d.querySelector('[data-direct-tab=dialogs]').getAttribute('aria-pressed'),'true');
  assert.match(d.querySelector('[data-conversation]').textContent,/1 новых/);
  d.querySelector('[data-conversation]').click();await until(()=>root.textContent.includes('Подключено'));
  assert.equal(d.querySelector('[data-direct-inbox]').hidden,true);assert.equal(d.activeElement,d.querySelector('[data-direct-back]'));
  assert.equal((await member.api('/api/direct')).unread,1,'Opening must not silently mark history read');
  assert.equal(d.querySelector('[data-direct-settings]').open,false);assert.equal(d.querySelectorAll('.chat-day').length,1);
  d.querySelector('[data-chat-form] [name=body]').value='Ответ из интерфейса';d.querySelector('[data-chat-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelectorAll('[data-message-id]').length===2);
  d.querySelector('[data-chat-read]').click();await until(()=>root.textContent.includes('отмечены прочитанными'));assert.equal((await member.api('/api/direct')).unread,0);
  d.querySelector('[data-direct-back]').click();await until(()=>!d.querySelector('[data-direct-inbox]')?.hidden&&d.querySelector('[data-conversation]'));
  assert.equal(d.querySelector('[data-chat-form]'),null);assert.equal(d.querySelector('[data-request] [name=body]').value,'Черновик первого приветствия');assert(!d.querySelector('[data-conversation]').textContent.includes('новых'));assert.equal(d.activeElement,d.querySelector('[data-direct-tab=dialogs]'));
  d.querySelector('[data-direct-settings]').open=true;
  const privacy=d.querySelector('[data-privacy]');privacy.checked=false;privacy.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>!privacy.disabled);assert.equal((await member.api('/api/me')).user.dmRequests,false);
  d.querySelector('[data-block]').click();await until(()=>d.querySelector('[data-unblock]'));assert.equal(d.querySelectorAll('[data-message-id]').length,0);
  d.querySelector('[data-unblock]').click();await until(()=>d.querySelector('[data-conversation]'));
  // Real contact cooldown preserves the failed draft and idempotency key, including refresh.
  d.querySelector('.direct-heading [data-direct-compose-open]').click();assert.equal(d.activeElement,d.querySelector('[name=handle]'));
  let form=d.querySelector('[data-request]');form.elements.handle.value='uithird';form.elements.body.value='Первое знакомство';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelector('[data-direct-group="2"]')?.textContent.includes('uithird'));assert.equal(d.querySelector('[data-request] [name=body]').value,'');
  assert.equal(d.querySelector('[data-direct-tab=requests]').getAttribute('aria-pressed'),'true');
  form=d.querySelector('[data-request]');form.elements.handle.value='uifourth';form.elements.body.value='Сохранить при лимите';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>root.querySelector('[data-direct-error]').textContent.includes('Попробуй через'));const retryId=form.dataset.clientId;assert.equal(form.elements.body.value,'Сохранить при лимите');assert.equal((await member.api('/api/direct')).conversations.length,2);
  d.querySelector('[data-refresh]').click();await until(()=>d.querySelector('[data-request]')?.dataset.clientId===retryId);assert.equal(d.querySelector('[name=body]').value,'Сохранить при лимите');assert.equal(d.querySelector('[data-direct-compose]').open,true);
  controller.destroy();let failed=true;
  controller=w.createDirectInbox({root,user:{id:member.id},api:async(...args)=>{if(args[0]==='/api/direct'&&failed)throw new Error('Сеть недоступна');return member.api(...args);}});
  await until(()=>root.textContent.includes('Сеть недоступна'));assert.equal(d.querySelector('[data-group-empty]'),null,'A loading failure must not look like an empty inbox');failed=false;d.querySelector('[data-refresh]').click();await until(()=>d.querySelector('[data-conversation]'));controller.destroy();
  let release;const late=new Promise(resolve=>release=resolve);controller=w.createDirectInbox({root,user:{id:member.id},api:()=>late});controller.destroy();root.textContent='Другая страница';release({viewerId:member.id,user:{id:member.id},blocks:[],conversations:[]});await new Promise(r=>setTimeout(r,20));assert.equal(root.textContent,'Другая страница');
  assert.deepEqual(errors,[]);console.log('PASS: direct inbox keeps selection private, reports without acceptance, opens dedicated chat, explicitly reads unread history, restores draft on return, changes privacy, blocks/unblocks and preserves 429 retry. DOM only.');
 }finally{controller?.destroy();dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
