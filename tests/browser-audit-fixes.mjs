import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';

const dir=mkdtempSync(join(tmpdir(),'wr-audit-ui-')),databasePath=join(dir,'db.sqlite');
let app=await createApp({databasePath,authLimit:200}),origin=await app.listen();const browser=await chromium.launch();
try{
 for(const width of [360,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));let csrf;
  const api=async(path,method='GET',body)=>{
   const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{data:body}:{})});assert(r.ok(),await r.text());const d=await r.json();if(d.csrf)csrf=d.csrf;return d;
  };
  const me=await api('/api/register','POST',{handle:'audit_'+width,name:'Проверка',password:'Audit-browser-password-123'});
  const club=await api('/api/clubs','POST',{name:'Проверка '+width,description:'',access:'open'});
  await page.goto(origin+'/account');await page.locator('#profile').waitFor();
  const dialogResult=async(accept,click)=>{
   const dialog=page.waitForEvent('dialog');const action=click();const d=await dialog;assert.equal(d.type(),'confirm');await (accept?d.accept():d.dismiss());await action;
  };
  await page.locator('#profile [name=bio]').fill('Не терять описание');
  await dialogResult(false,()=>page.locator('#people').click());assert.equal(new URL(page.url()).pathname,'/account');assert.equal(await page.locator('#profile [name=bio]').inputValue(),'Не терять описание');
  // Cancelling a browser-history transition restores URL and the same form.
  await page.evaluate(()=>history.pushState(null,'','/account?check=1'));
  await dialogResult(false,()=>page.evaluate(()=>history.back()));assert.equal(new URL(page.url()).pathname,'/account');assert.equal(await page.locator('#profile [name=bio]').inputValue(),'Не терять описание');
  await page.locator('#profile button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#profile [name=bio]')?.defaultValue==='Не терять описание');
  await page.locator('#people').click();await page.locator('#communityMembers').waitFor();await page.locator('#account').click();await page.locator('#profile').waitFor();
  await page.locator('#profile [name=profileVisible]').check();await dialogResult(false,()=>page.locator('.top-search').click());assert(await page.locator('#profile [name=profileVisible]').isChecked());
  await page.locator('#profile [name=profileVisible]').uncheck();
  await page.locator('#profile [name=avatarFile]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);
  await dialogResult(false,()=>page.locator('#home').click());assert.equal(await page.locator('#profile [name=avatarFile]').evaluate(e=>e.files.length),1);
  await dialogResult(true,()=>page.locator('#home').click());await page.locator('.club-browser').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Reporting from a visible post, comment and public profile uses the same actual queue.
  const peerContext=await browser.newContext();let peerCsrf;
  const peerApi=async(path,method='GET',body)=>{const r=await peerContext.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(peerCsrf?{'X-CSRF-Token':peerCsrf}:{})},...(body?{data:body}:{})});assert(r.ok(),await r.text());const d=await r.json();if(d.csrf)peerCsrf=d.csrf;return d;};
  const peer=await peerApi('/api/register','POST',{handle:'peer_'+width,name:'Другой игрок',password:'Audit-browser-password-123'});
  await peerApi('/api/me','PATCH',{profileVisible:true});await peerApi('/api/clubs/'+club.id+'/join','POST',{});
  const post=await peerApi('/api/clubs/'+club.id+'/posts','POST',{title:'Материал для проверки',body:'Проверка обращения',clientId:crypto.randomUUID()});
  await peerApi('/api/posts/'+post.id+'/comments','POST',{body:'Комментарий для проверки',clientId:crypto.randomUUID()});
  await page.goto(origin+'/posts/'+post.id);await page.locator('[data-report-object=post]').waitFor();assert.equal(await page.locator('#main h1.post-title').count(),1);
  const report=async(selector)=>{page.once('dialog',d=>d.accept('Проверка нарушения правил'));await page.locator(selector).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Жалоба отправлена'));};
  await report('[data-report-object=post]');await page.locator('[data-comments]').click();await page.locator('[data-report-object=comment]').waitFor();await report('[data-report-object=comment]');
  await page.goto(origin+'/players/'+peer.user.id);await page.locator('[data-report-object=profile]').waitFor();assert.equal(await page.locator('#people').getAttribute('aria-current'),'page');await report('[data-report-object=profile]');
  assert.equal((await api('/api/reports')).reports.length,3);
  if(width===390){
   let summaries=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/notifications/summary')summaries++;});
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForResponse(r=>r.url().includes('/api/notifications/summary')&&r.status()===200);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   const before=summaries;await new Promise(r=>setTimeout(r,6000));assert.equal(summaries,before);
   const resumed=page.waitForResponse(r=>r.url().includes('/api/notifications/summary')&&r.status()===200);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await resumed;assert.equal(summaries,before+1);
  }
  assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await peerContext.close();await context.close();console.log('PASS '+width+'px: profile text/checkbox/file guards, history cancellation, save, public report buttons and layout'+(width===390?', hidden polling pause/resume':''));
 }
}finally{await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}
