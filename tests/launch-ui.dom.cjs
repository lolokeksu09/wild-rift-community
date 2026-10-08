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
  dom=new JSDOM(html,{url:origin,runScripts:'outside-only',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=async(p,opts={})=>{const headers={...opts.headers,Cookie:cookie};if(opts.method&&opts.method!=='GET')headers.Origin=origin;const res=await fetch(origin+p,{...opts,headers});const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return res;};}});
  const w=dom.window,d=w.document;w.eval(fs.readFileSync(path.join(__dirname,'../server/public/chat.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/profiles.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/discussions.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/clubs.js'),'utf8'));w.eval(code);
  async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timeout: '+d.querySelector('#main').textContent);}
  const click=s=>{assert(d.querySelector(s),s);d.querySelector(s).click();};
  const fill=(s,v)=>{d.querySelector(s).value=v;};
  const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelector('.launch')&&d.querySelector('#main').getAttribute('aria-busy')==='false');
  assert.equal(w.location.pathname,'/');assert(d.body.classList.contains('launch-mode'));
  assert.match(d.querySelector('#launch-title').textContent,/Твой Рифт/);
  click('[data-auth-mode=register]');await until(()=>d.activeElement?.closest('#register'));
  assert.equal(w.location.pathname,'/account');assert(!d.body.classList.contains('launch-mode'));
  w.history.back();await until(()=>d.body.classList.contains('launch-mode'));
  click('[data-auth-mode=login]');await until(()=>d.activeElement?.closest('#login'));
  w.history.back();await until(()=>d.body.classList.contains('launch-mode'));
  click('[data-nav=clubs]');await until(()=>w.location.pathname==='/clubs'&&d.querySelector('#main').getAttribute('aria-busy')==='false');assert.equal(w.location.pathname,'/clubs');
  w.history.back();await until(()=>d.body.classList.contains('launch-mode'));
  click('[data-nav=discover]');await until(()=>d.querySelector('.welcome-hero'));assert.equal(w.location.pathname,'/feed');
  click('#account');await until(()=>d.querySelector('#register'));
  fill('#register [name=name]','<Тестер>');fill('#register [name=handle]','launch_tester');fill('#register [name=password]','Test-password-12345');submit('#register');await until(()=>d.querySelector('#createClub'));
  w.history.pushState(null,'','/');w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>d.querySelector('.launch-greeting'));
  assert.match(d.querySelector('.launch-greeting').textContent,/<Тестер>/);assert.equal(d.querySelectorAll('.launch-greeting tester').length,0);assert.equal(d.querySelectorAll('[data-auth-mode]').length,0);
  click('[data-nav=discover]');await until(()=>d.querySelector('.home-welcome'));assert.equal(w.location.pathname,'/feed');
  for(const route of ['/','/feed']){const response=await fetch(origin+route);assert.equal(response.status,200);assert.match(await response.text(),/launch\.[a-f0-9]+\.css|launch\.css/);}
  assert.equal((await fetch(origin+'/launch.css')).status,200);
  assert.deepEqual(errors,[]);console.log('PASS: welcome, auth focus, clubs/feed, back navigation, signed session and HTML routes. DOM only.');
 }finally{dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

