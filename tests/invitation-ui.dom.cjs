const {JSDOM,VirtualConsole}=require('jsdom'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const {createApp}=await import(pathToFileURL(path.join(__dirname,'../server/app.mjs')).href),app=await createApp(),origin=await app.listen();let dom;
 const client=()=>({cookie:'',csrf:'',async req(url,method='GET',body){const r=await fetch(origin+url,{method,headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':this.csrf},body:body?JSON.stringify(body):undefined}),data=await r.json();if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)this.csrf=data.csrf;assert.equal(r.ok,true,JSON.stringify(data));return data;}});
 try{
  const owner=client(),captain=client(),player=client();for(const [c,handle] of [[owner,'ui_notice_owner'],[captain,'ui_notice_captain'],[player,'ui_notice_player']])await c.req('/api/register','POST',{handle,name:handle,password:'Notice-UI-test-only-123'});
  await player.req('/api/me','PATCH',{profileVisible:true});
  async function invite(clientId){const {id}=await owner.req('/api/tournaments','POST',{title:'Cup <img src=x>',capacity:4,clientId});await captain.req('/api/tournaments/'+id+'/join','POST',{name:'Team <svg>'});await captain.req('/api/tournaments/'+id+'/invite','POST',{handle:'ui_notice_player'});return id;}
  const id=await invite('notice-ui-first-fixture'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../server/public/index.html'),'utf8'),{url:origin+'/notifications',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.AbortController=AbortController;w.scrollTo=()=>{};w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async(p,opts={})=>fetch(origin+p,{...opts,headers:{...opts.headers,Cookie:player.cookie,...(opts.method&&opts.method!=='GET'?{Origin:origin}:{})}});}});
  const w=dom.window,d=w.document;for(const file of ['profiles.js','discussions.js','clubs.js','tournaments.js','app.js'])w.eval(fs.readFileSync(path.join(__dirname,'../server/public',file),'utf8'));
  async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout: '+d.querySelector('#main').textContent);}
  await until(()=>d.querySelector('[data-tournament-invitation]'));assert.equal(d.querySelector('#main img'),null);assert.equal(d.querySelector('#main svg'),null);
  d.dispatchEvent(new w.Event('visibilitychange'));await until(()=>d.querySelector('#notifications').title.includes('приглашений: 1'));assert.equal(d.querySelector('[data-notification-total]').hidden,false);
  d.querySelector('[data-tournament-invitation] a').click();await until(()=>d.querySelector('[data-tournament-accept]'));
  assert.equal(w.location.pathname,'/tournaments');assert.equal(w.location.search,'?id='+id);assert.match(d.querySelector('#main').textContent,/Приглашение в Team/);
  d.querySelector('[data-tournament-accept]').click();await until(()=>d.querySelector('[data-tournament-member-leave]'));await until(()=>d.querySelector('#notifications').title.includes('приглашений: 0'));assert.equal(d.querySelector('[data-notification-total]').hidden,true);
  const next=await invite('notice-ui-second-fixture');d.querySelector('#notifications').click();await until(()=>d.querySelector('[data-tournament-invitation="'+next+'"]'));
  await owner.req('/api/tournaments/'+next+'/cancel','POST',{reason:'Not enough players'});d.querySelector('#notifications').click();await until(()=>!d.querySelector('[data-tournament-invitation]')&&d.querySelector('#discussionEvents'));
  assert.deepEqual(errors,[]);console.log('PASS invitation center with real HTTP: private list, escaped content, exact tournament deep link, consent, combined badge reset and cancelled invitation removal. DOM only.');
 }finally{dom?.window.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
