import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
const dir=mkdtempSync(join(tmpdir(),'wr-browser-contacts-')),app=await createApp({databasePath:join(dir,'db.sqlite'),authLimit:200}),origin=await app.listen(),browser=await chromium.launch();
try{for(const width of [360,390,768,1440]){
 const c=await browser.newContext({viewport:{width,height:900}}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));let csrf;
 const api=async(path,method='GET',body)=>{const r=await c.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{data:body}:{})});assert(r.ok(),await r.text());const d=await r.json();if(d.csrf)csrf=d.csrf;return d;};
 // Targets are real local fixtures, never live accounts.
 for(const n of [1,2]){const other=await browser.newContext();const r=await other.request.post(origin+'/api/register',{headers:{Origin:origin,'X-Community-Request':'1'},data:{handle:'peer'+width+'_'+n,name:'Игрок',password:'Contact-ui-test-123'}});assert(r.ok());await other.close();}
 await api('/api/register','POST',{handle:'sender'+width,name:'Отправитель',password:'Contact-ui-test-123'});
 await p.goto(origin+'/messages');await p.locator('[data-request]').waitFor();assert.match(await p.locator('[data-contact-budget]').textContent(),/осталось 3 из 3/);
 await p.locator('[name=handle]').fill('peer'+width+'_1');await p.locator('[name=body]').fill('Первое знакомство');await p.locator('[data-request] button').click();await p.waitForFunction(()=>document.querySelector('[data-contact-budget]')?.textContent.includes('осталось 2 из 3'));
 await p.locator('[name=handle]').fill('peer'+width+'_2');await p.locator('[name=body]').fill('Текст сохранится после отказа');await p.locator('[data-request] button').click();await p.waitForFunction(()=>document.querySelector('[data-direct-error]')?.textContent.includes('Попробуй через 5 мин'));
 assert.equal(await p.locator('[name=body]').inputValue(),'Текст сохранится после отказа');assert.equal(await p.locator('[name=handle]').inputValue(),'peer'+width+'_2');assert.match(await p.locator('[data-contact-budget]').textContent(),/осталось 2 из 3/);assert.equal(await p.locator('[data-request] button').isEnabled(),true);
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await c.close();console.log(`PASS ${width}px: live contact budget and preserved request after 429`);
}}finally{await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}

