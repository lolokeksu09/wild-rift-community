import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';

mkdirSync('ui-screenshots',{recursive:true});
const app=await createApp(),origin=await app.listen(),browser=await chromium.launch();
try {
 const owner=await browser.newContext();let csrf;
 async function api(path,method='GET',body){const r=await owner.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{data:body}:{})});assert(r.ok(),await r.text());const d=await r.json();if(d.csrf)csrf=d.csrf;return d;}
 const errors=[];
 // Empty community must remain useful without invented activity.
 const empty=await browser.newContext({viewport:{width:390,height:844}}),ep=await empty.newPage();
 await ep.goto(origin+'/feed');await ep.locator('.community-hero').waitFor();await ep.screenshot({path:'ui-screenshots/premium-empty-390.png',fullPage:true});
 await ep.locator('#lfg').click();await ep.getByRole('heading',{name:'Сейчас нет открытых команд'}).waitFor();assert.equal(await ep.locator('#login').count(),0);await empty.close();
 await api('/api/register','POST',{handle:'premium_fixture',name:'Игрок',password:'Premium-local-test-123'});
 const names=['После матча','Школа Рифта','ARAM и разговоры'];
 const descriptions=['Разбираем игры, делимся моментами и знакомимся.','Советы по ролям и чемпионам. Учимся вместе.','Играем ради хорошего вечера и своей компании.'];
 for(let i=0;i<3;i++){const club=await api('/api/clubs','POST',{name:names[i],description:descriptions[i],access:i===2?'request':'open'});if(i===0)await api('/api/clubs/'+club.id+'/posts','POST',{clientId:'premium-post-fixture-001',title:'Какой момент из последнего матча ты запомнишь?',body:'Красивая комбинация, спасение союзника или неожиданный камбэк — расскажи свою историю. Интересно, что остаётся с нами после игры.'});}
 const group=await api('/api/lfg','POST',{clientId:'premium-group-fixture-001',title:'Спокойный вечер в Рифте',mode:'normal',region:'EU',language:'Русский',role:'jungle',rank:'',voice:'optional',description:'Без спешки',capacity:3,durationHours:2});
 await api('/api/events','POST',{clientId:'premium-event-fixture-001',title:'Вечер ARAM с компанией',description:'Играем вместе',mode:'aram',region:'EU',language:'Русский',timezone:'UTC',startsAt:Date.now()+3600000,durationHours:1,roles:['mid','jungle'],ownerRole:'mid'});
 for(const width of [360,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:width<700?844:1000}}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.goto(origin+'/feed');await p.locator('.story-row').first().waitFor();assert.equal(await p.locator('#notifications').isVisible(),false);assert.equal(await p.locator('#reports').isVisible(),false);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await p.locator('.story-row').count(),3);
   // A phone should expose a real conversation without scrolling past club promotion.
   if(width<700){const author=await p.locator('.story-byline').first().boundingBox();assert(author&&author.y>=0&&author.y+author.height<844,'Conversation author must be visible on the initial phone viewport');}
   else {await p.locator('.story-row h3 a').first().click();await p.locator('.post-title').waitFor();assert.match(new URL(p.url()).pathname,/^\/posts\/\d+$/);await p.goto(origin+'/feed');await p.locator('.story-row').first().waitFor();}
   await p.screenshot({path:`ui-screenshots/premium-home-${width}.png`,fullPage:true});
   await p.locator('.home-shortcuts [data-nav=guides]').click();await p.locator('[data-guide-filters]').waitFor();assert.equal(await p.locator('.guide-more-filters').getAttribute('open'),null);await p.getByRole('heading',{name:'Здесь будет опыт сообщества'}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await p.locator('.section-menu summary').click();await p.locator('.section-menu [data-nav=events]').click();await p.getByRole('heading',{name:'Вечер ARAM с компанией'}).waitFor();assert.equal(await p.locator('#login').count(),0);
   await p.locator('#lfg').click();await p.getByRole('heading',{name:'Спокойный вечер в Рифте'}).waitFor();await p.screenshot({path:`ui-screenshots/premium-groups-${width}.png`,fullPage:true});
   await p.locator(`[data-preview-join="${group.id}"]`).click();await p.locator('#register').waitFor({state:'attached'});await p.locator('[data-auth-switch=register]').click();assert.match(await p.locator('.pagehead').textContent(),/подать заявку в команду/);
   await p.locator('#register [name=name]').fill('Новый игрок');await p.locator('#register [name=handle]').fill('premium_new_'+width);await p.locator('#register [name=password]').fill('Premium-local-test-123');await p.locator('#register button').click();
   await p.locator('#lfgRoot').getByRole('heading',{name:'Спокойный вечер в Рифте',exact:true}).waitFor();assert.equal(await p.locator('[data-chat-form]').count(),0);
   await context.close();console.log(`PASS ${width}px: community layout, guest controls, clubs, compact guides, public announcements, signup returns to selected team, private chat`);
 }
 assert.deepEqual(errors,[]);await owner.close();
}finally{await browser.close();await app.close();}
