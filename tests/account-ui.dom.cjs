const {JSDOM,VirtualConsole}=require('jsdom');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href);
 const app=await createApp();const origin=await app.listen();let dom;
 try{
  let cookie='',failSessions=false;const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../server/public/index.html'),'utf8'),{url:origin+'/account',runScripts:'outside-only',virtualConsole:vc,beforeParse(w){w.AbortController=AbortController;w.scrollTo=()=>{};w.confirm=()=>true;w.fetch=async(p,options={})=>{if(p==='/api/sessions'&&failSessions)throw Error('Не удалось загрузить сеансы');const headers={...options.headers,Cookie:cookie};if(options.method&&options.method!=='GET')headers.Origin=origin;const r=await fetch(origin+p,{...options,headers});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};}});
  const w=dom.window,d=w.document;
  for(const f of ['profiles.js','chat.js','direct.js','discussions.js','clubs.js','guides.js','app.js'])w.eval(fs.readFileSync(path.join(__dirname,'../server/public',f),'utf8'));
  const until=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout: '+d.querySelector('#main').textContent);};
  const click=s=>{assert(d.querySelector(s),s);d.querySelector(s).click();};const fill=(s,v)=>d.querySelector(s).value=v;const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelector('#login'));assert.equal(d.querySelector('#login').hidden,false);assert.equal(d.querySelector('#register').hidden,true);
  fill('#login [name=handle]','remember_this');click('[data-auth-switch=register]');assert.equal(d.querySelector('#login').hidden,true);assert.equal(d.activeElement,d.querySelector('#register input'));
  click('[data-auth-switch=login]');assert.equal(d.querySelector('#login [name=handle]').value,'remember_this');click('[data-auth-switch=register]');
  const oldPassword='Account-DOM-password-12345',newPassword='Account-DOM-password-67890';
  for(const [key,value]of Object.entries({handle:'account_dom',name:'Игрок <img src=x>',password:oldPassword}))fill('#register [name='+key+']',value);
  submit('#register');await until(()=>d.querySelector('#createClub'));click('#account');await until(()=>d.querySelector('[data-account-editor]'));
  assert.equal(d.querySelector('[data-account-editor]').open,false);assert.equal(d.querySelector('[data-account-security]').open,false);assert.equal(d.querySelector('[data-player]'),null,'Hidden profile has no public-page action');assert.equal(d.querySelector('img[src=x]'),null);
  click('[data-account-section=editor]');assert.equal(d.querySelector('[data-account-editor]').open,true);assert.equal(d.activeElement,d.querySelector('#profile [name=name]'));
  fill('#profile [name=bio]','Описание <script>без HTML</script>');fill('#profile [name=rank]','Мастер');fill('#profile [name=riotId]','Private#ABCD');d.querySelector('#profile [name=profileVisible]').checked=true;d.querySelector('#profile [name=riotVisible]').checked=false;
  submit('#profile');await until(()=>d.querySelector('.profile-bio')?.textContent==='Описание <script>без HTML</script>');assert.equal(d.querySelector('[data-account-editor]').open,true);assert(d.querySelector('.game-card').textContent.includes('Private#ABCD'));
  const session=await (await w.fetch('/api/me')).json();const viewer=session.user.id;
  const publicData=await (await fetch(origin+'/api/profiles/'+viewer)).json();assert(!JSON.stringify(publicData).includes('Private#ABCD'));assert.equal(publicData.profile.gameProfile.rank,'Мастер');
  click('[data-profile-public-actions] [data-player]');await until(()=>d.querySelector('#main').dataset.view==='player'&&d.querySelector('.profile-bio'));assert(!d.querySelector('.game-card').textContent.includes('Private#ABCD'));assert.equal(d.querySelector('#profile'),null);assert.equal(d.querySelector('[data-revoke-session]'),null);assert.equal(d.querySelector('script:not([src])'),null);
  click('.back-link[data-nav=account]');await until(()=>d.querySelector('#profile'));
  failSessions=true;click('#account');await until(()=>d.querySelector('[data-account-security-retry]'));assert(d.querySelector('.profile-identity').textContent.includes('Игрок'));assert(d.querySelector('#profile'));
  click('[data-account-section=editor]');fill('#profile [name=bio]','Не потерять этот черновик');failSessions=false;click('[data-account-security-retry]');await until(()=>d.querySelector('[data-session-row]'));assert.equal(d.querySelector('#profile [name=bio]').value,'Не потерять этот черновик');
  click('[data-account-section=security]');assert.equal(d.querySelector('[data-account-security]').open,true);assert.equal(d.activeElement,d.querySelector('#changePassword input'));
  fill('#recoveryCodes [name=password]',oldPassword);submit('#recoveryCodes');await until(()=>d.querySelector('[data-recovery-result] textarea'));const codes=d.querySelector('[data-recovery-result] textarea').value.split('\n');assert.equal(codes.length,8);assert.equal(d.querySelector('#recoveryCodes [name=password]').value,'');
  for(const [key,value]of Object.entries({currentPassword:oldPassword,newPassword,repeatPassword:'Mismatched-password-000'}))fill('#changePassword [name='+key+']',value);
  submit('#changePassword');await until(()=>d.querySelector('#changePassword .error').textContent.includes('не совпадают'));fill('#changePassword [name=repeatPassword]',newPassword);w.confirm=()=>false;submit('#changePassword');await new Promise(r=>setTimeout(r,20));assert.equal(d.querySelector('#changePassword [name=currentPassword]').value,oldPassword);
  w.confirm=()=>true;submit('#changePassword');await until(()=>d.querySelector('#toast').textContent.startsWith('Пароль изменён'));assert.equal(d.querySelector('#changePassword [name=currentPassword]').value,'');assert.equal(d.querySelector('[data-recovery-result] textarea'),null);assert.equal(d.querySelector('[data-recovery-count]').textContent,'0');
  const stored=JSON.stringify([w.localStorage,w.sessionStorage]);for(const secret of [oldPassword,newPassword,...codes])assert(!stored.includes(secret));
  w.sessionStorage.setItem(`wr-chat-draft:${viewer}:direct:1`,'Личный текст перед отзывом сеанса');w.sessionStorage.setItem(`wr-chat-pending:${viewer}:1`,'[]');
  click('[data-current-session="1"]');await until(()=>d.querySelector('#login'));assert.equal((await(await w.fetch('/api/me')).json()).user,null);assert.equal(d.querySelector('.profile-showcase'),null);assert.equal(w.sessionStorage.getItem(`wr-chat-draft:${viewer}:direct:1`),null);assert.equal(w.sessionStorage.getItem(`wr-chat-pending:${viewer}:1`),null);
  // Guest sign-in returns to the selected public profile; contact only opens a draft.
  const registration=await fetch(origin+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1'},body:JSON.stringify({handle:'public_peer',name:'Напарник',password:oldPassword})});const peer=await registration.json();const peerCookie=registration.headers.get('set-cookie').split(';')[0];
  const publication=await fetch(origin+'/api/me',{method:'PATCH',headers:{Cookie:peerCookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':peer.csrf},body:JSON.stringify({profileVisible:true})});assert.equal(publication.status,200);
  w.history.pushState(null,'','/players/'+peer.user.id);w.dispatchEvent(new w.PopStateEvent('popstate'));await until(()=>d.querySelector('[data-profile-signin]'));click('[data-profile-signin]');await until(()=>d.querySelector('#login'));
  fill('#login [name=handle]','account_dom');fill('#login [name=password]',newPassword);submit('#login');await until(()=>d.querySelector('[data-contact]'));assert.equal(w.location.pathname,'/players/'+peer.user.id);assert.equal((await(await w.fetch('/api/direct')).json()).conversations.length,0);
  click('[data-contact]');await until(()=>d.querySelector('[data-request] [name=handle]')?.value==='public_peer');assert.equal(d.querySelector('[data-direct-compose]').open,true);assert.equal(d.activeElement,d.querySelector('[data-request] [name=body]'));assert.equal((await(await w.fetch('/api/direct')).json()).conversations.length,0);
  assert.deepEqual(errors,[]);console.log('PASS: mobile auth modes/focus, private/public profile and Riot ID, edit separation, independent settings retry preserving draft, recovery codes, password mismatch/cancel/rotation and current-session logout. DOM only.');
 }finally{dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
