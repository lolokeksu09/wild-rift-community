const {JSDOM,VirtualConsole}=require('jsdom');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href);
 let clock=Date.now();const app=await createApp({now:()=>clock}),origin=await app.listen(),windows=[],errors=[];
 const html=fs.readFileSync(path.join(__dirname,'../server/public/index.html'),'utf8');
 async function request(c,p,method='GET',body){
  const r=await fetch(origin+p,{method,headers:{Cookie:c.cookie||'',...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':c.csrf||''})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(r.headers.has('set-cookie'))c.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)c.csrf=data.csrf;return {...data,status:r.status};
 }
 async function actor(handle,name=handle){const c={};const me=await request(c,'/api/register','POST',{handle,name,password:'Events-ui-test-12345'});assert.equal(me.status,201);c.id=me.user.id;return c;}
 function mount(c){
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(html,{url:origin+'/events',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
  w.scrollTo=()=>{};w.confirm=()=>true;w.AbortController=AbortController;
  w.fetch=async(p,o={})=>{
   if(c.failNotices&&p==='/api/events/notifications')throw Error('Notification connection lost');
   if(c.failEvents&&p.startsWith('/api/events?'))throw Error('Events connection lost');
   const r=await fetch(origin+p,{...o,headers:{...o.headers,Cookie:c.cookie||'',...(o.method&&o.method!=='GET'?{Origin:origin}:{})}});if(r.headers.has('set-cookie'))c.cookie=r.headers.get('set-cookie').split(';')[0];return r;
  };
  for(const f of ['clubs.js','discussions.js','chat.js','profiles.js','events.js','app.js'])w.eval(fs.readFileSync(path.join(__dirname,'../server/public',f),'utf8'));
  windows.push(w);return w;
 }
 async function until(fn){for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error(windows.map(w=>w.document.querySelector('#main').textContent).join(' | '));}
 const click=(w,s)=>{assert(w.document.querySelector(s),s);w.document.querySelector(s).click();};
 const submit=(w,s)=>w.document.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 try{
  const owner=await actor('event_ui_owner','Организатор <img src=x>'),player=await actor('event_ui_player','Игрок <img src=x>'),outside=await actor('event_ui_outside');
  const a=mount(owner),ad=a.document,guestClient={},guest=mount(guestClient),gd=guest.document;
  await until(()=>ad.querySelector('[data-event-create]')&&gd.querySelector('.public-events'));
  assert.equal(ad.querySelector('.event-create').open,false);assert.equal(ad.querySelector('.event-notifications').open,false);
  assert(gd.querySelector('.event-empty'));assert.equal(gd.querySelector('[data-event-create]'),null);
  click(a,'[data-event-create-open]');assert.equal(ad.querySelector('.event-create').open,true);assert.equal(ad.activeElement,ad.querySelector('[data-event-create] [name=title]'));
  const start=new Date(clock+3600000).toISOString().slice(0,16),f=ad.querySelector('[data-event-create]');
  for(const [key,value]of Object.entries({title:'Вечер <img src=x>',date:start,timezone:'UTC',description:'Текст <img src=x onerror=alert(1)>',ownerRole:'baron'}))f.elements[key].value=value;
  for(const input of f.querySelectorAll('[name=roles]'))input.checked=['baron','jungle'].includes(input.value);
  submit(a,'[data-event-create]');await until(()=>ad.querySelector('#eventChat [data-chat-form]'));
  const myEvents=await request(owner,'/api/events?mine=1'),id=myEvents.events[0].id,p='/api/events/'+id;
  assert.equal(myEvents.events[0].starts_at,Date.parse(start+'Z'));assert.equal(myEvents.events[0].timezone,'UTC');
  assert.equal(ad.querySelectorAll('img[src=x]').length,0);assert(ad.querySelector('.event-detail h1').textContent.includes('<img src=x>'));
  assert(ad.querySelector('[data-event-slot=baron]').classList.contains('event-slot-mine'));
  assert.equal(a.WREvents.toInstant('2026-10-08T21:00','Europe/Moscow'),Date.parse('2026-10-08T18:00:00Z'));
  assert.throws(()=>a.WREvents.toInstant('2026-03-29T02:30','Europe/Berlin'));assert.throws(()=>a.WREvents.toInstant('2026-10-25T02:30','Europe/Berlin'));
  click(guest,'#events');await until(()=>gd.querySelector('[data-preview-join]'));
  assert.equal(gd.querySelectorAll('.editorial-event-row').length,1);assert(gd.querySelector('.event-spaces').textContent.includes('1'));
  assert.equal(gd.querySelector('.event-calendar').getAttribute('datetime'),new Date(Date.parse(start+'Z')).toISOString());assert.equal(gd.querySelector('#eventChat'),null);
  click(guest,'[data-preview-join]');await until(()=>gd.querySelector('#login'));
  gd.querySelector('#login [name=handle]').value='event_ui_player';gd.querySelector('#login [name=password]').value='Events-ui-test-12345';submit(guest,'#login');await until(()=>gd.querySelector('[data-event-join=jungle]'));
  assert.equal(gd.querySelector('#eventChat'),null);assert.equal(gd.querySelector('[data-event-slot=baron]>span').textContent,'Занято');assert.equal((await request(player,p)).members.length,0,'opening a public event does not join it');
  click(guest,'[data-event-join=jungle]');await until(()=>gd.querySelector('#eventChat [data-chat-form]'));
  assert(gd.querySelector('[data-event-slot=baron]>span').textContent.includes('Организатор <img src=x>'));assert(gd.querySelector('[data-event-slot=jungle]').classList.contains('event-slot-mine'));
  await until(()=>gd.querySelector('[data-chat-form] [name=body]')&&!gd.querySelector('[data-chat-form] [name=body]').disabled);gd.querySelector('[data-chat-form] [name=body]').value='До встречи <img src=x>';submit(guest,'[data-chat-form]');await until(()=>gd.querySelector('[data-message-id]'));assert.equal(gd.querySelector('img[src=x]'),null);
  const b=mount(outside),bd=b.document;await until(()=>bd.querySelector('[data-event-card]'));assert(bd.querySelector('.event-spaces').textContent.includes('Состав собран'));assert.equal(bd.querySelector('.event-roles'),null);
  bd.querySelector('[data-event-filter] [name=role]').value='jungle';submit(b,'[data-event-filter]');await until(()=>bd.querySelector('.event-empty'));assert.equal(bd.querySelectorAll('[data-event-card]').length,0);click(b,'[data-event-filter-reset]');await until(()=>bd.querySelector('[data-event-card]'));
  click(guest,'[data-event-leave]');await until(()=>gd.querySelector('[data-event-join=jungle]'));assert.equal(gd.querySelector('#eventChat'),null);assert.equal(gd.querySelector('[data-event-slot=baron]>span').textContent,'Занято');
  click(b,'[data-event-open]');await until(()=>bd.querySelector('[data-event-join=jungle]'));click(b,'[data-event-join=jungle]');await until(()=>bd.querySelector('#eventChat [data-chat-form]'));
  click(a,'[data-event-refresh]');await until(()=>ad.querySelector('[data-event-remove]'));click(a,'[data-event-remove]');await until(()=>!ad.querySelector('[data-event-remove]'));
  click(b,'#eventChat [data-chat-refresh]');await until(()=>bd.querySelector('#eventChat h3')?.textContent==='Чат недоступен');assert.equal(bd.querySelector('[data-message-id]'),null);assert.equal((await request(outside,p+'/join','POST',{role:'jungle'})).status,403);
  click(guest,'[data-event-refresh]');await until(()=>gd.querySelector('[data-event-join=jungle]'));click(guest,'[data-event-join=jungle]');await until(()=>gd.querySelector('#eventChat [data-chat-form]'));
  click(a,'[data-event-cancel]');await until(()=>ad.querySelector('.event-detail-title')?.textContent.includes('Отменено'));click(guest,'[data-event-refresh]');await until(()=>gd.querySelector('#eventChat [name=body]')?.disabled);assert.equal(gd.querySelector('[data-event-join]'),null);
  click(guest,'[data-event-back]');await until(()=>gd.querySelector('[data-event-filter]'));gd.querySelector('[data-event-filter] [name=mine]').value='1';submit(guest,'[data-event-filter]');await until(()=>gd.querySelector('[data-event-card]'));assert(gd.querySelector('[data-event-card]').textContent.includes('Отменено'));assert(gd.querySelector('.event-spaces').textContent.includes('В составе'));
  assert.equal(gd.querySelector('.event-notifications').open,false);assert(gd.querySelector('.event-notifications summary').textContent.includes('непрочитанные'));click(guest,'.event-notifications summary');
  const read=gd.querySelector('[data-event-read]');read.click();await until(()=>!read.isConnected);assert(gd.querySelector('#eventNotices').textContent.includes('Прочитано'));
  outside.failNotices=true;click(b,'[data-event-back]');await until(()=>bd.querySelector('#eventNotices .error'));assert(bd.querySelector('[data-event-create]'));assert(bd.querySelector('[data-event-filter]'));assert(bd.querySelector('#main').textContent.includes('Уведомления не загрузились'));
  outside.failNotices=false;outside.failEvents=true;click(b,'[data-event-refresh]');await until(()=>bd.querySelector('.event-load-error'));assert.equal(bd.querySelector('.event-empty'),null);
  outside.failEvents=false;click(b,'.event-load-error [data-event-refresh]');await until(()=>bd.querySelector('[data-event-filter]'));
  click(guest,'[data-event-open]');await until(()=>gd.querySelector('.event-detail'));click(guest,'[data-event-back]');await until(()=>gd.querySelector('[data-event-filter]'));assert.equal(gd.querySelector('[data-event-filter] [name=mine]').value,'1');
  assert.deepEqual(errors,[]);console.log('PASS: event creation/focus, timezone/DST, guest preview/auth return, private roster/chat, role filters, join/leave/remove, cancellation/read-only, mine filter return, read markers and independent load errors. DOM only.');
 }finally{for(const w of windows)w.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
