const {JSDOM,VirtualConsole}=require('jsdom');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href);
 const app=await createApp();const origin=await app.listen();let dom,controller;
 try{
  function client(){return{cookie:'',csrf:'',id:null,async api(route,method='GET',body){const headers={Cookie:this.cookie};if(method!=='GET')Object.assign(headers,{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf});const r=await fetch(origin+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.headers.has('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;if(data.user)this.id=data.user.id;if(!r.ok){const e=new Error(data.error);e.status=r.status;throw e;}return data;}};}
  const owner=client(),member=client();for(const [c,handle]of [[owner,'uiowner'],[member,'uimember']])await c.api('/api/register','POST',{handle,name:handle,password:'Test-chat-ui-12345'});
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));dom=new JSDOM('<section id="root"></section>',{url:origin,runScripts:'outside-only',virtualConsole:vc});const w=dom.window,d=w.document;
  for(const file of ['chat.js','direct.js'])w.eval(fs.readFileSync(path.join(__dirname,'../server/public',file),'utf8'));
  await owner.api('/api/direct','POST',{handle:'uimember',clientId:'ui-direct-request-0001',body:'<img src=x> Привет'});
  const root=d.querySelector('#root');controller=w.createDirectInbox({root,user:{id:member.id},api:(...args)=>member.api(...args)});
  async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timeout: '+root.textContent);}
  await until(()=>d.querySelector('[data-accept]'));assert.equal(d.querySelectorAll('img').length,0);
  d.querySelector('[data-accept]').click();await until(()=>d.querySelector('[data-conversation]'));
  d.querySelector('[data-conversation]').click();await until(()=>root.textContent.includes('Подключено'));
  d.querySelector('[data-chat-form] [name=body]').value='Ответ из интерфейса';d.querySelector('[data-chat-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelectorAll('[data-message-id]').length===2);
  d.querySelector('[data-chat-read]').click();await until(()=>root.textContent.includes('отмечены прочитанными'));assert.equal((await member.api('/api/direct')).unread,0);
  const privacy=d.querySelector('[data-privacy]');privacy.checked=false;privacy.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>!privacy.disabled);assert.equal((await member.api('/api/me')).user.dmRequests,false);
  d.querySelector('[data-block]').click();await until(()=>d.querySelector('[data-unblock]'));assert.equal(d.querySelectorAll('[data-message-id]').length,0);
  d.querySelector('[data-unblock]').click();await until(()=>d.querySelector('[data-conversation]'));
  assert.deepEqual(errors,[]);console.log('PASS: direct inbox accepts request, escapes HTML, sends through real server, changes privacy, blocks and unblocks. DOM only.');
 }finally{controller?.destroy();dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
