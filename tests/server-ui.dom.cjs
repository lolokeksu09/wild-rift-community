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
  const errors=[];let cookie='',failPreview=false;const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM(html,{url:origin+'/feed?tab=conversations',runScripts:'outside-only',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=async(p,opts={})=>{if(p==='/api/community-preview'&&failPreview)throw Error('Preview connection failed');const headers={...opts.headers,Cookie:cookie};if(opts.method&&opts.method!=='GET')headers.Origin=origin;const res=await fetch(origin+p,{...opts,headers});const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return res;};}});
  const w=dom.window,d=w.document;w.eval(fs.readFileSync(path.join(__dirname,'../server/public/chat.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/profiles.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/discussions.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../server/public/clubs.js'),'utf8'));w.eval(code);
  async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timeout: '+d.querySelector('#main').textContent);}
  const click=s=>{assert(d.querySelector(s),s);d.querySelector(s).click();};
  const fill=(s,v)=>{d.querySelector(s).value=v;};
  const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelector('.conversation-feed'));
  assert.equal(d.querySelector('.home-navigation [aria-current=page]').textContent,'Разговоры');
  click('#discover');await until(()=>d.querySelector('.welcome-hero'));
  const cover=await fetch(origin+d.querySelector('.editorial-cover-image').getAttribute('src'));
  assert.equal(cover.status,200);assert.equal(cover.headers.get('content-type'),'image/webp');assert.match(cover.headers.get('cache-control'),/immutable/);
  assert.equal(d.querySelector('.home-people'),null);assert.equal(d.querySelector('.home-clubs'),null);
  click('.home-navigation a[href="/feed?tab=conversations"]');await until(()=>d.querySelector('.conversation-feed'));
  assert.equal(w.location.search,'?tab=conversations');assert.equal(d.querySelector('.editorial-cover'),null);
  click('.home-navigation a[href="/feed?tab=play"]');await until(()=>d.querySelector('.play-invitation'));
  assert.equal(w.location.search,'?tab=play');assert.equal(d.querySelectorAll('.compact-empty').length,1);
  w.history.back();await until(()=>w.location.search==='?tab=conversations'&&d.querySelector('.conversation-feed'));
  click('.home-navigation a[href="/feed"]');await until(()=>d.querySelector('.editorial-cover'));
  failPreview=true;click('#discover');await until(()=>d.querySelector('.home-status'));assert(d.querySelector('.home-stories'));failPreview=false;click('#discover');await until(()=>d.querySelector('.home-stories')&&!d.querySelector('.home-status'));
  const menu=d.querySelector('.section-menu');
  menu.open=true;menu.querySelector('summary').focus();menu.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(menu.open,false);assert.equal(d.activeElement,menu.querySelector('summary'));
  menu.open=true;d.querySelector('#main').click();assert.equal(menu.open,false);
  menu.open=true;click('.section-menu [data-nav=members]');await until(()=>d.querySelector('[data-members-filter]'));
  assert.equal(menu.open,false);assert.equal(w.location.pathname,'/players');assert.equal(d.querySelector('.section-menu [data-nav=members]').getAttribute('aria-current'),'page');
  click('#discover');await until(()=>d.querySelector('.welcome-hero'));assert.equal(d.querySelector('.section-menu [data-nav=members]').hasAttribute('aria-current'),false);
  menu.open=true;click('.section-menu [data-nav=saved]');await until(()=>d.querySelector('#register'));assert.equal(menu.open,false);assert.equal(w.location.pathname,'/saved');
  click('#account');await until(()=>w.location.pathname==='/account'&&d.querySelector('#register'));
  fill('#register [name=name]','Тестер');fill('#register [name=handle]','uitester');fill('#register [name=password]','Test-password-12345');submit('#register');await until(()=>d.querySelector('#createClub'));
  assert.equal(d.querySelector('#createClub').closest('details').open,false);click('[data-club-create-open]');assert.equal(d.querySelector('#createClub').closest('details').open,true);assert.equal(d.activeElement,d.querySelector('#createClub input'));
  fill('#createClub [name=name]','Клуб интерфейса');fill('#createClub [name=description]','Тест');submit('#createClub');await until(()=>d.querySelector('#post'));
  fill('#post [name=title]','Пост интерфейса');fill('#post [name=body]','<img src=x onerror=alert(1)>');submit('#post');await until(()=>d.querySelector('.post-title'));
  click('#discover');await until(()=>d.querySelector('.story-row'));
  assert.equal(d.querySelector('.story-row h3').textContent,'Пост интерфейса');assert.equal(d.querySelector('.story-row img[src=x]'),null);
  click('.home-navigation a[href="/feed?tab=conversations"]');await until(()=>d.querySelector('.conversation-feed .post-title'));
  assert.equal(d.querySelector('.conversation-feed [data-comments]').dataset.commentClub,d.querySelector('[data-home-compose]').dataset.homeCompose);
  assert.equal(d.querySelectorAll('.content img').length,0);click('[data-comments]');await until(()=>d.querySelector('[data-comment-form]'));fill('[data-comment-form] [name=body]','Комментарий');submit('[data-comment-form]');await until(()=>d.querySelector('.comment .content')?.textContent==='Комментарий');
  click('#account');await until(()=>d.querySelector('#profile'));fill('#profile [name=name]','Новое имя');submit('#profile');await until(()=>d.querySelector('.profile-identity h2')?.textContent==='Новое имя');
  click('[data-logout="/api/logout"]');await until(()=>d.querySelector('#login'));fill('#login [name=handle]','uitester');fill('#login [name=password]','Test-password-12345');submit('#login');await until(()=>d.querySelector('[data-open]'));click('[data-open]');await until(()=>d.querySelector('[data-delete]'));click('[data-delete]');assert.equal(d.querySelector('#confirmDialog').open,true);click('#confirmDelete');await until(()=>!d.querySelector('.post-title'));
  click('#home');await until(()=>d.querySelector('[data-club-card]')&&d.querySelector('#clubResultCount')?.textContent.includes('1 из 1'));assert(d.querySelector('[data-club-card]').classList.contains('no-cover'));assert.equal(d.querySelector('[data-club-card] img'),null);
  fill('#clubSearch','не существующий клуб');d.querySelector('#clubSearch').dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>d.querySelector('#clubResultCount').textContent.includes('0 из 0'));assert.equal(d.querySelector('#noClubResults').classList.contains('hidden'),false);assert.equal(d.querySelector('#noClubResults h2').textContent,'Пока нет совпадений');click('#noClubResults [data-club-reset]');await until(()=>d.querySelectorAll('[data-club-card]').length===1);assert.equal(d.querySelector('#clubSearch').value,'');
  assert.deepEqual(errors,[]);console.log('PASS: catalog search/reset, compact club creation/focus and real covers; client forms ↔ real HTTP/SQLite (register, club, post, escaped content, comment, profile, logout/login, delete confirmation). DOM only.');
 }finally{dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

