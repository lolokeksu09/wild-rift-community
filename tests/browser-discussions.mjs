import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
const browser=await chromium.launch();mkdirSync('ui-screenshots',{recursive:true});
try{
 for(const width of [360,390,768,1440]){
  const app=await createApp(),origin=await app.listen(),contexts=[],errors=[];
  try{
   async function actor(handle){const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);let csrf='';async function api(path,method='GET',body){const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1','X-CSRF-Token':csrf},...(body===undefined?{}:{data:body})});assert(r.ok(),`${path}: ${r.status()} ${await r.text()}`);const d=await r.json();if(d.csrf)csrf=d.csrf;return d;}const session=await api('/api/register','POST',{handle,name:handle==='disc_owner'?'Организатор':'Напарник',password:'Browser-discussion-only-123'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,api,id:session.user.id};}
   const owner=await actor('disc_owner'),member=await actor('disc_member');
   const club=await owner.api('/api/clubs','POST',{name:'Вечерние обсуждения',description:'Играем вместе и делимся опытом.',access:'request'});
   await member.api(`/api/clubs/${club.id}/join`,'POST',{});await owner.api(`/api/clubs/${club.id}/decision`,'POST',{userId:member.id,decision:'approve'});
   const post=await owner.api(`/api/clubs/${club.id}/posts`,'POST',{title:'После матча: что получилось?',body:'@disc_member Как сыграли сегодня? Обсудим решения и следующий матч.',clientId:'browser-post-attempt'});
   await member.page.goto(origin+'/feed');await member.page.locator('.welcome-hero').waitFor();
   await member.page.keyboard.press('Tab');assert.equal(await member.page.locator('.skip').evaluate(el=>document.activeElement===el),true);assert((await member.page.locator('.skip').boundingBox()).width>100);await member.page.keyboard.press('Tab');
   const headerBoxes=await member.page.locator('#notifications,#reports').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));assert.equal(headerBoxes[0].top,headerBoxes[1].top,'Header actions share one row');
   const reactions=member.page.locator(`[data-post-actions="${post.id}"]`);
   await reactions.locator('[data-kind=useful]').click();await reactions.locator('[data-kind=useful][aria-pressed=true]').waitFor();
   assert.equal((await member.api(`/api/posts/${post.id}`)).post.reactions[0].count,1);
   await reactions.locator('[data-save]').click();await reactions.locator('[data-save][aria-pressed=true]').waitFor();
   await reactions.locator('[data-comments]').click();const form=member.page.locator('[data-comment-form]');await form.waitFor();
   const longText='<img src=x> '+'ОченьДлинноеОбсуждение'.repeat(20);await form.locator('[name=body]').fill(longText);
   // Server commits, but the browser loses the response. Retry must keep clientId.
   let dropped=false;await member.page.route('**/api/posts/*/comments',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
   await form.locator('button[type=submit], button.btn.primary').click();await form.locator('.error').filter({hasText:/./}).waitFor();await form.locator('button.btn.primary').click();
   await member.page.locator('.comment .content').filter({hasText:longText}).waitFor();
   let comments=await member.api(`/api/posts/${post.id}/comments`);assert.equal(comments.comments.length,1,'Lost response must not duplicate comment');
   const root=comments.comments[0];
   await owner.api(`/api/posts/${post.id}/comments`,'POST',{body:'Хорошая мысль. @disc_member В следующий раз попробуем вместе.',parentId:root.id,clientId:'browser-owner-reply'});
   // Reload expanded discussion, then select a real reply target.
   await reactions.locator('[data-comments]').click();await member.page.locator('.comment-reply').waitFor();
   await member.page.locator(`[data-comment-id="${root.id}"] [data-reply]`).click();await form.locator('.reply-target:not(.hidden)').waitFor();
   await form.locator('[name=body]').fill('Согласен, запланируем следующую игру.');await form.locator('button.btn.primary').click();await member.page.locator('.comment-reply').filter({hasText:'Согласен'}).waitFor();
   assert.equal(await member.page.locator('#main img[src=x]').count(),0);
   async function layout(label){assert.equal(await member.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}: overflow ${label}`);assert.deepEqual(errors,[]);}
   await layout('comments');await member.page.evaluate(()=>scrollTo(0,0));await member.page.screenshot({path:`ui-screenshots/discussions-${width}.png`,fullPage:true});
   await member.page.locator('#notifications').click();await member.page.getByRole('heading',{name:'Ответы и упоминания'}).waitFor();assert.equal(await member.page.locator('[data-discussion-post]').count(),2);
   await member.page.locator('[data-discussion-read]').first().click();await member.page.getByText('Прочитано',{exact:true}).waitFor();assert.equal((await member.api('/api/discussions/notifications/summary')).unread,1);
   await layout('notifications');await member.page.evaluate(()=>scrollTo(0,0));await member.page.screenshot({path:`ui-screenshots/discussion-events-${width}.png`,fullPage:true});
   await member.page.locator('[data-discussion-post]').first().click();await member.page.locator('.comment-reply').first().waitFor();
   await member.page.locator('#account').click();await member.page.locator('[data-nav=saved]').click();await member.page.getByRole('heading',{name:'Сохранённое',exact:true}).waitFor();assert.equal(await member.page.locator('[data-save][aria-pressed=true]').count(),1);
   await layout('saved');await member.page.evaluate(()=>scrollTo(0,0));await member.page.screenshot({path:`ui-screenshots/saved-${width}.png`,fullPage:true});
   await owner.api(`/api/clubs/${club.id}/ban`,'POST',{userId:member.id});await member.page.locator('#account').click();await member.page.locator('[data-nav=saved]').click();await member.page.getByRole('heading',{name:'Сохрани то, к чему хочется вернуться'}).waitFor();
   await member.page.locator('#notifications').click();await member.page.getByRole('heading',{name:'Пока тихо'}).waitFor();assert.equal((await member.api('/api/discussions/notifications/summary')).unread,0);
   console.log(`PASS ${width}px: reactions, saved items, retry after lost response, replies, mentions, notification read, access revocation, escaped text and layout`);
  }finally{for(const c of contexts)await c.close();await app.close();}
 }
}finally{await browser.close();}

