const {JSDOM,VirtualConsole}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href);
 const app=await createApp();const origin=await app.listen();let dom;
 try{
  const html=fs.readFileSync(path.join(__dirname,'../server/public/index.html'),'utf8');
  const code=fs.readFileSync(path.join(__dirname,'../server/public/app.js'),'utf8');
  const errors=[];let cookie='';const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM(html,{url:origin,runScripts:'outside-only',virtualConsole:vc,beforeParse(w){w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=async(p,opts={})=>{const headers={...opts.headers,Cookie:cookie};if(opts.method&&opts.method!=='GET')headers.Origin=origin;const res=await fetch(origin+p,{...opts,headers});const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return res;};}});
  const w=dom.window,d=w.document;w.eval(fs.readFileSync(path.join(__dirname,'../server/public/chat.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/profiles.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/discussions.js'),'utf8'));w.eval(code);
  async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timeout: '+d.querySelector('#main').textContent);}
  const click=s=>{assert(d.querySelector(s),s);d.querySelector(s).click();};
  const fill=(s,v)=>{d.querySelector(s).value=v;};
  const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelector('.welcome-hero'));click('#account');await until(()=>d.querySelector('#register'));
  fill('#register [name=name]','Тестер');fill('#register [name=handle]','uitester');fill('#register [name=password]','Test-password-12345');submit('#register');await until(()=>d.querySelector('#createClub'));
  fill('#createClub [name=name]','Клуб интерфейса');fill('#createClub [name=description]','Тест');submit('#createClub');await until(()=>d.querySelector('#post'));
  fill('#post [name=title]','Пост интерфейса');fill('#post [name=body]','<img src=x onerror=alert(1)>');submit('#post');await until(()=>d.querySelector('.post-title'));
  assert.equal(d.querySelectorAll('.content img').length,0);click('[data-comments]');await until(()=>d.querySelector('[data-comment-form]'));fill('[data-comment-form] [name=body]','Комментарий');submit('[data-comment-form]');await until(()=>d.querySelector('.comment .content')?.textContent==='Комментарий');
  click('#account');await until(()=>d.querySelector('#profile'));fill('#profile [name=name]','Новое имя');submit('#profile');await until(()=>d.querySelector('.profile-identity h2')?.textContent==='Новое имя');
  click('[data-logout="/api/logout"]');await until(()=>d.querySelector('#login'));fill('#login [name=handle]','uitester');fill('#login [name=password]','Test-password-12345');submit('#login');await until(()=>d.querySelector('[data-open]'));click('[data-open]');await until(()=>d.querySelector('[data-delete]'));click('[data-delete]');assert.equal(d.querySelector('#confirmDialog').open,true);click('#confirmDelete');await until(()=>!d.querySelector('.post-title'));
  assert.deepEqual(errors,[]);console.log('PASS: client forms ↔ real HTTP/SQLite (register, club, post, escaped content, comment, profile, logout/login, delete confirmation). DOM only.');
 }finally{dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
