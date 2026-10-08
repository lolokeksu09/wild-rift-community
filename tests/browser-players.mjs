import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
const app=await createApp({authLimit:200});let browser;
try{
 const origin=await app.listen();browser=await chromium.launch();mkdirSync('ui-screenshots',{recursive:true});
 async function peer(handle,visible,gameProfile){let cookie='',csrf='';async function request(path,method='GET',body){const response=await fetch(origin+path,{method,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:origin,'X-Community-Request':'1','X-CSRF-Token':csrf,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrf)csrf=data.csrf;assert(response.ok,JSON.stringify(data));return data;}const session=await request('/api/register','POST',{handle,name:handle.startsWith('mate')?'Напарник <img src=x>':'Тихий игрок',password:'Browser-player-test-12345'});await request('/api/me','PATCH',{profileVisible:visible,bio:'Играем спокойно, обсуждаем матчи.',gameProfile:{...gameProfile,riotId:'Hidden#ABC',riotVisible:false}});return {id:session.user.id,request};}
 for(const width of [360,390,768,1440]){
  const fields={rank:'Мастер',region:'Европа',language:'Русский',roles:['jungle','mid'],champions:['Ренгар'],playTime:'Вечером, МСК',microphone:'yes'};
  const candidate=await peer('mate'+width,true,fields);await peer('quiet'+width,true,{...fields,rank:'Алмаз',microphone:'no'});await peer('hidden'+width,false,fields);const blocked=await peer('blocked'+width,true,fields);
  await candidate.request('/api/lfg','POST',{clientId:'browser-player-group-'+width,title:'Вечерняя группа '+width,mode:'ranked',region:'Европа',language:'Русский',role:'jungle',rank:'Мастер',voice:'required',description:'Ищем спокойную компанию.',capacity:2,durationHours:1});
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('.welcome-hero').waitFor();await page.locator('#account').click();await page.locator('#register').waitFor();
  for(const [key,value] of Object.entries({name:'Ищем напарника',handle:'viewer'+width,password:'Browser-player-test-12345'}))await page.locator(`#register [name=${key}]`).fill(value);
  await page.locator('#register button').click();await page.locator('#createClub').waitFor();
  const blockStatus=await page.evaluate(async userId=>{const session=await (await fetch('/api/me')).json();return (await fetch('/api/blocks',{method:'POST',headers:{'Content-Type':'application/json','X-Community-Request':'1','X-CSRF-Token':session.csrf},body:JSON.stringify({userId})})).status;},blocked.id);assert.equal(blockStatus,200);
  await page.locator('#lfg').click();await page.locator('[data-lfg-tab=players]').click();await page.locator('[data-player-filter]').waitFor();
  await page.locator('[data-player-filter] [name=q]').fill(String(width));await page.locator('[data-player-filter] button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-players-list]')?.getAttribute('aria-busy')==='false');assert.equal(await page.locator('[data-player-card]').count(),2);
  for(const [key,value] of Object.entries({rank:'МАСТЕР',region:'ЕВРОПА',language:'РУССКИЙ'}))await page.locator(`[data-player-filter] [name=${key}]`).fill(value);
  await page.locator('[data-player-filter] [name=role]').selectOption('mid');await page.locator('[data-player-filter] [name=microphone]').selectOption('yes');await page.locator('[data-player-filter] button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-players-list]')?.getAttribute('aria-busy')==='false');assert.equal(await page.locator('[data-player-card]').count(),1);assert.equal(await page.locator('#main img[src=x]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}: player search overflow`);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`ui-screenshots/players-${width}.png`,fullPage:true});
  await page.locator('[data-player-card] [data-player]').click();await page.getByRole('heading',{name:'Профиль игрока'}).waitFor();assert.equal(await page.locator('.game-card').getByText('Hidden#ABC',{exact:true}).count(),0);
  await page.locator('.back-link[data-nav=lfg]').click();await page.locator('[data-player-card]').waitFor();assert.equal(await page.locator('[data-player-filter] [name=rank]').inputValue(),'МАСТЕР');
  await page.locator('[data-player-card] [data-contact]').click();await page.locator('[data-request]').waitFor();assert.equal(await page.locator('[data-request] [name=handle]').inputValue(),'mate'+width);
  const before=await page.evaluate(async()=>await (await fetch('/api/direct')).json());assert.equal(before.conversations.length,0,'Selecting player must not send a message');
  await page.locator('[data-request] [name=body]').fill('Давай сыграем вместе');await page.locator('[data-request] button').click();await page.locator(`[data-block="${candidate.id}"]`).waitFor();
  const received=await candidate.request('/api/direct');assert.equal(received.conversations.length,1);assert.equal(received.conversations[0].status,'pending');
  await page.locator('#lfg').click();await page.locator('[data-lfg-tab=groups]').click();await page.locator('[data-lfg-filter]').waitFor();
  await page.locator('[data-lfg-filter] [name=rank]').fill('МАСТЕР');await page.locator('[data-lfg-filter] [name=voice]').selectOption('required');await page.locator('[data-lfg-filter] button').click();await page.locator('[data-lfg-filter]').waitFor();
  assert((await page.locator('[data-lfg-list]').textContent()).includes('Вечерняя группа '+width));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}: group filters overflow`);
  await page.locator('[data-lfg-tab=players]').click();await page.locator('[data-player-card]').waitFor();await page.locator('[data-player-filter] [name=q]').fill('no_such_person');await page.locator('[data-player-filter] button[type=submit]').click();await page.getByRole('heading',{name:'Подходящих игроков пока нет'}).waitFor();
  assert.deepEqual(errors,[],`${width}: browser errors`);console.log(`PASS ${width}px: player filters, privacy, profile return, explicit message request and group filters`);await context.close();
 }
}finally{if(browser)await browser.close();await app.close();}
