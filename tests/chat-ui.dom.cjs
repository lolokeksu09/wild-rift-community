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
  async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timeout: '+root.textContent);}
  await until(()=>root.textContent.includes('Подключено'));
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
  // Membership revocation clears rendered history and pending data.
  await owner.api(`/api/clubs/${club}/ban`,'POST',{userId:member.id});d.querySelector('[data-chat-refresh]').click();await until(()=>root.textContent.includes('Чат недоступен'));assert.equal(d.querySelectorAll('[data-message-id]').length,0);
  controller.destroy();
  // A late response from a previously mounted club must not populate the next page.
  let release;const delayed=new Promise(resolve=>release=resolve);controller=w.createClubChat({root,clubId:club,userId:member.id,api:()=>delayed});controller.destroy();root.textContent='Другая страница';release({viewerId:member.id,messages:[{id:900,sender_id:member.id,body:'stale',sender_name:'old',created_at:1}],hasMore:false});await new Promise(r=>setTimeout(r,20));assert.equal(root.textContent,'Другая страница');
  assert.deepEqual(errors,[]);console.log('PASS: chat UI lost-response retry creates no duplicate; intervening message not skipped; HTML escaped; ban clears history; destroyed controller ignores late response. DOM only.');
 }finally{controller?.destroy();dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
