const {JSDOM,VirtualConsole}=require('jsdom');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href);
 const app=await createApp();const origin=await app.listen();let dom,controller;
 try{
  function client(){return{cookie:'',csrf:'',id:null,async api(route,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;if(!r.ok){const e=new Error(data.error);e.status=r.status;throw e;}return data;}};}
  const owner=client(),member=client();for(const [c,handle]of [[owner,'uiowner'],[member,'uimember']])await c.api('/api/register','POST',{handle,name:handle,password:'Test-chat-ui-12345'});
  const club=(await owner.api('/api/clubs','POST',{name:'UI Club',description:'',access:'open'})).id;await member.api(`/api/clubs/${club}/join`,'POST',{});const route=`/api/clubs/${club}/messages`;
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<section id="root"></section>',{url:origin,runScripts:'outside-only',virtualConsole:vc});const w=dom.window,d=w.document;w.confirm=()=>true;
  w.eval(fs.readFileSync(path.join(__dirname,'../server/public/chat.js'),'utf8'));
  let loseResponse=true;const api=async(...args)=>{const data=await member.api(...args);if(args[1]==='POST'&&loseResponse){loseResponse=false;throw new TypeError('Simulated lost response after commit');}return data;};
  const root=d.querySelector('#root');controller=w.createClubChat({root,clubId:club,userId:member.id,api});
  async function until(fn){for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timeout: '+root.textContent);}
  await until(()=>root.textContent.includes('Подключено'));
  // Leaving the chat preserves an unsent draft, never submitting it on mount.
  const draft='Несохранённое <img src=x onerror=alert(1)>\nПродолжение';
  d.querySelector('[name=body]').value=draft;d.querySelector('[name=body]').dispatchEvent(new w.Event('input',{bubbles:true}));controller.destroy();
  controller=w.createClubChat({root,clubId:club,userId:member.id,api});
  assert.equal(d.querySelector('[name=body]').value,'','Draft is not restored before the viewer check');
  await until(()=>root.textContent.includes('Подключено'));assert.equal(d.querySelector('[name=body]').value,draft);assert.equal((await member.api(route)).messages.length,0);assert.equal(root.querySelectorAll('img').length,0);
  // Another sender's message arrives between reading and sending: no cursor gap.
  await owner.api(route,'POST',{clientId:'owner-intervening-0001',body:'Сообщение другого участника'});
  d.querySelector('[name=body]').value='<img src=x onerror=alert(1)> Тест';d.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>root.textContent.includes('Отправка не подтверждена'));
  assert(w.sessionStorage.length>0);d.querySelector('[data-chat-retry]').click();
  await until(()=>d.querySelector('[data-chat-pending]').textContent==='');
  assert.equal((await member.api(route)).messages.filter(m=>m.sender_id===member.id).length,1);
  d.querySelector('[data-chat-refresh]').click();await until(()=>d.querySelectorAll('[data-message-id]').length===2);
  assert.equal(d.querySelectorAll('[data-chat-log] img').length,0);
  assert.equal(w.sessionStorage.length,0);
  w.prompt=()=> 'Жалоба из интерфейса';d.querySelector('[data-report-message]').click();await until(()=>root.textContent.includes('Жалоба отправлена'));assert.equal((await member.api('/api/reports')).reports.length,1);
  // Blocking from the open chat hides old messages; removing the block restores history.
  d.querySelector('[data-chat-block]').click();await until(()=>!root.textContent.includes('Сообщение другого участника')&&root.textContent.includes('Подключено'));
  assert.equal((await member.api(route)).messages.length,1);
  await member.api('/api/blocks','DELETE',{userId:owner.id});d.querySelector('[data-chat-refresh]').click();await until(()=>d.querySelectorAll('[data-message-id]').length===2);
  // Membership revocation clears rendered history and pending data.
  d.querySelector('[name=body]').value='Черновик до отзыва';d.querySelector('[name=body]').dispatchEvent(new w.Event('input',{bubbles:true}));
  await owner.api(`/api/clubs/${club}/ban`,'POST',{userId:member.id});d.querySelector('[data-chat-refresh]').click();await until(()=>root.textContent.includes('Чат недоступен'));assert.equal(d.querySelectorAll('[data-message-id]').length,0);assert.equal(w.sessionStorage.getItem(`wr-chat-draft:${member.id}:${club}`),null);
  controller.destroy();
  // A stale mount must not restore a private draft for a different viewer.
  w.sessionStorage.setItem(`wr-chat-draft:${member.id}:${club}`,'Приватный черновик');
  controller=w.createClubChat({root,clubId:club,userId:member.id,api:owner.api.bind(owner)});
  await until(()=>root.textContent.includes('Чат недоступен'));assert.equal(d.querySelector('[name=body]'),null);assert.equal(w.sessionStorage.getItem(`wr-chat-draft:${member.id}:${club}`),null);controller.destroy();
  // A late response from a previously mounted club must not populate the next page.
  let release;const delayed=new Promise(resolve=>release=resolve);controller=w.createClubChat({root,clubId:club,userId:member.id,api:()=>delayed});assert.equal(d.querySelector('[name=body]').disabled,true,'Do not allow sending before membership is checked');controller.destroy();root.textContent='Другая страница';release({viewerId:member.id,messages:[{id:900,sender_id:member.id,body:'stale',sender_name:'old',created_at:1}],hasMore:false});await new Promise(r=>setTimeout(r,20));assert.equal(root.textContent,'Другая страница');
  // An older page arriving after a block must never restore blocked content.
  controller.destroy();let releaseOld;let calls=0;
  controller=w.createClubChat({root,clubId:club,userId:member.id,api:async(p,method)=>{
   if(method==='POST')return {ok:true,blockVersion:2};
   calls++;
   if(calls===1)return {viewerId:member.id,blockVersion:1,messages:[{id:2,sender_id:owner.id,body:'hidden later',sender_name:'owner',created_at:1}],hasMore:true};
   if(p.includes('before='))return new Promise(resolve=>releaseOld=resolve);
   return {viewerId:member.id,blockVersion:2,messages:[],hasMore:false};
  }});
  await until(()=>d.querySelector('[data-chat-block]'));d.querySelector('[data-chat-older]').click();await until(()=>releaseOld);d.querySelector('[data-chat-block]').click();await until(()=>calls>=3);
  releaseOld({viewerId:member.id,blockVersion:1,messages:[{id:1,sender_id:owner.id,body:'stale secret',sender_name:'owner',created_at:1}],hasMore:false});await new Promise(r=>setTimeout(r,20));assert(!root.textContent.includes('stale secret'));assert(!root.textContent.includes('hidden later'));
  controller.destroy();
  // An explicitly read-only mount cannot be re-enabled by a later API response.
  const history=[{id:1,sender_id:owner.id,body:'Первый день',sender_name:'owner',created_at:Date.UTC(2026,9,7,12)},{id:2,sender_id:member.id,body:'Второй день',sender_name:'member',created_at:Date.UTC(2026,9,8,12)}];
  let readOnlyPosts=0;
  w.sessionStorage.setItem(`wr-chat-draft:${member.id}:readonly`,'Черновик закрытого чата');
  controller=w.createClubChat({root,clubId:'readonly',userId:member.id,api:async(_p,method)=>{if(method==='POST')readOnlyPosts++;return {viewerId:member.id,canSend:true,messages:history,hasMore:false};},readOnly:true});
  await until(()=>root.textContent.includes('только для чтения'));assert.equal(d.querySelector('[name=body]').disabled,true);assert.equal(d.querySelector('[name=body]').value,'');assert.equal(d.querySelectorAll('.chat-day').length,2);
  d.querySelector('[name=body]').value='Нельзя отправить';d.querySelector('[data-chat-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(readOnlyPosts,0);controller.destroy();
  // A write restriction (403) does not remove readable history or silently retry.
  let restrictedPosts=0;
  controller=w.createClubChat({root,clubId:'restricted',userId:member.id,api:async(_p,method)=>{if(method==='POST'){restrictedPosts++;const error=new Error('Создание контента ограничено до завтра.');error.status=403;throw error;}return {viewerId:member.id,messages:history,hasMore:false};}});
  await until(()=>root.textContent.includes('Подключено'));d.querySelector('[name=body]').value='Сохранить попытку';d.querySelector('[data-chat-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>root.textContent.includes('Создание контента ограничено'));assert.equal(d.querySelectorAll('[data-message-id]').length,2);assert.equal(restrictedPosts,1);assert(d.querySelector('[data-chat-retry]'));assert(w.sessionStorage.getItem(`wr-chat-pending:${member.id}:restricted`));
  assert.deepEqual(errors,[]);console.log('PASS: chat UI lost-response retry creates no duplicate; intervening message not skipped; HTML escaped; ban clears history; destroyed controller ignores late response; day boundaries, read-only state and write restriction preserve history. DOM only.');
 }finally{controller?.destroy();dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
