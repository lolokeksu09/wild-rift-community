import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
const output='ui-screenshots/populated/';mkdirSync(output,{recursive:true});
const browser=await chromium.launch();
const app=await createApp({authLimit:200}),origin=await app.listen(),actors=[],checks=[],errors=[];
try {
 async function actor(i){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});let csrf;
  async function api(path,method='GET',data){const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{})},...(data===undefined?{}:{data})});assert(r.ok(),`${path}: ${r.status()} ${await r.text()}`);const v=await r.json();if(v.csrf)csrf=v.csrf;return v;}
  const name=i===0?'ОченьДлинноеИмяИгрокаБезПробелов123456789'.slice(0,40):['','Марк','Лена','Саша','Дима','Аня','Олег','Ника','Илья','Маша','Тимур','Вера'][i];
  const session=await api('/api/register','POST',{handle:'filled_player_'+i,name,password:'Local-populated-test-12345'});
  await api('/api/me','PATCH',{profileVisible:true,bio:'Тестовый профиль для проверки наполненного интерфейса.',gameProfile:{roles:['jungle','mid'],region:'EU',language:'ru'}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const a={context,page,api,id:session.user.id,csrf};actors.push(a);return a;
 }
 for(let i=0;i<12;i++)await actor(i);
 const owner=actors[0],member=actors[1],rootClub=await owner.api('/api/clubs','POST',{name:'КлубВечернихОбсужденийОченьДлинноеНазвание'.slice(0,60),description:'Локальная проверка: играем вместе и обсуждаем матчи. '.repeat(4),access:'open'}),root='/api/clubs/'+rootClub.id;
 for(const a of actors.slice(1))await a.api(root+'/join','POST',{});
 async function upload(key){const media=await owner.context.request.post(origin+'/api/media',{headers:{Origin:origin,'X-Community-Request':'1','X-CSRF-Token':owner.csrf,'X-Upload-ID':key,'Content-Type':'image/webp'},data:readFileSync(new URL('../server/public/community-cover.webp',import.meta.url))});assert(media.ok(),await media.text());return (await media.json()).image.id;}
 await owner.api(root+'/cover','PATCH',{coverId:await upload('filled-local-cover-0001')});
 const imageId=await upload('filled-local-post-image-0001');
 const posts=[];
 for(let i=0;i<8;i++)posts.push(await actors[i%3].api(root+'/posts','POST',{clientId:'filled-post-attempt-'+i,title:i===7?'ОченьДлинныйЗаголовокПубликацииБезПробелов'.repeat(2):['Как прошёл ваш последний матч?','Ищем компанию на выходные','Что помогло договориться с командой?'][i%3],body:i===7?'https://example.invalid/'+('ДлинныйАдресБезПробелов'.repeat(60))+'\n\n'+('Обсуждаем решения после матча. '.repeat(45)):'Пример публикации на тестовой копии. Расскажите о своём матче, роли или игровом вечере.\n\n'+('Делимся впечатлениями и отвечаем друг другу. '.repeat(i+1)),...(i===0?{imageId}: {})}));
 const longPost=posts.at(-1),imagePost=posts[0];
 const poll=await owner.api(root+'/polls','POST',{clientId:'filled-poll-attempt-0001',title:'Какой игровой вечер устроим?',body:'Опрос на тестовой копии. Выбираем вместе.',options:['Обычные матчи, чтобы познакомиться и спокойно сыграть','ARAM и разговоры после каждого матча','Свой режим: очень длинное описание выбранного формата вечера'],durationHours:24});
 for(let i=0;i<6;i++)await actors[i].api('/api/posts/'+poll.id+'/poll/vote','PUT',{optionId:i%3});
 const guide=await owner.api(root+'/guides','POST',{clientId:'filled-guide-attempt-0001',title:'Как обсуждать матч и готовиться к следующему',body:('Тестовый текст руководства. Обсудите один момент, выслушайте друг друга и договоритесь о следующем матче.\n\n'.repeat(45)),topic:'macro',champion:'',gameVersion:'7.3',summary:'Длинное руководство для проверки чтения и переносов.'});
 const first=await owner.api('/api/posts/'+longPost.id+'/comments','POST',{clientId:'filled-comment-root-0001',body:'ОченьДлинныйКомментарийБезПробелов'.repeat(20)});
 const initial=(await owner.api('/api/posts/'+longPost.id+'/comments')).comments[0];
 for(let i=0;i<24;i++)await actors[i%12].api('/api/posts/'+longPost.id+'/comments','POST',{clientId:'filled-comment-attempt-'+i,body:'Комментарий на тестовой копии. '+('Обсудим следующий матч и найдём компанию. '.repeat(i%4+1)),...(i%3===0?{parentId:initial.id}:{})});
 for(let i=0;i<60;i++)await actors[i%12].api(root+'/messages','POST',{clientId:'filled-message-attempt-'+i,body:i===59?'ДлинноеСообщениеБезПробелов'.repeat(30):'Тестовая переписка: '+i+'. '+('Сыграем вместе вечером? '.repeat(i%5+1))});
 await owner.api('/api/direct','POST',{handle:'filled_player_1',body:'Привет! Проверяем наполненную переписку.',clientId:'filled-direct-request-0001'});
 const conversation=(await member.api('/api/direct')).conversations[0].id;await member.api('/api/direct/'+conversation+'/decision','POST',{decision:'accept'});
 for(let i=0;i<24;i++)await actors[i%2].api('/api/direct/'+conversation+'/messages','POST',{clientId:'filled-direct-message-'+i,body:'Сообщение '+i+'. '+('Обсуждаем время следующего матча. '.repeat(i%3+1))});
 async function settled(page){await page.waitForFunction(()=>document.querySelector('#main')?.getAttribute('aria-busy')==='false');await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});}
 async function inspect(page,label,width){
  await settled(page);
  const metrics=await page.evaluate(()=>{
   const shown=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
   const outside=[...document.querySelectorAll('#main *,dialog[open] *')].filter(shown).filter(e=>{if(e.closest('.club-tabs,.interest-filters,.server-chat-log'))return false;const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left < -1;}).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.trim().slice(0,45)})).slice(0,12);
   const clipped=[...document.querySelectorAll('.post-author .author-link,.post-title,.poll-label,.club-member strong')].filter(shown).filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,text:e.textContent.slice(0,45)}));
   const touching=[...document.querySelectorAll('.comment[data-comment-id]')].flatMap(e=>{const buttons=[...e.querySelectorAll(':scope>.text-link')].map(b=>b.getBoundingClientRect());return buttons.slice(1).filter((r,i)=>Math.abs(r.y-buttons[i].y)<2&&r.x-buttons[i].right<4).map(()=>e.dataset.commentId);});
   return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,outside,clipped,touching};
  });
  const problems=[];if(metrics.scrollWidth>width)problems.push('page overflow');if(metrics.outside.length)problems.push('content outside viewport');if(metrics.clipped.length)problems.push('unwrapped text');if(metrics.touching.length)problems.push('adjacent comment actions');
  await page.screenshot({path:output+label+'-'+width+'.png'});checks.push({label,width,metrics,problems});console.log(JSON.stringify({label,width,problems,outside:metrics.outside,clipped:metrics.clipped,touching:metrics.touching.slice(0,4)}));
 }
 for(const width of [320,360,390,430,1440]){
  const p=owner.page;await p.setViewportSize({width,height:844});
  for(const [label,route]of [['overview','/feed'],['feed','/feed?tab=conversations'],['long-post','/posts/'+longPost.id],['image-post','/posts/'+imagePost.id],['poll','/posts/'+poll.id],['guide','/posts/'+guide.id],['clubs','/clubs'],['club-posts','/clubs/'+rootClub.id],['people','/players']]){await p.goto(origin+route);await inspect(p,label,width);}
  await p.goto(origin+'/posts/'+longPost.id);await settled(p);await p.locator('.comment-reply').first().scrollIntoViewIfNeeded();await inspect(p,'comments',width);
  await p.locator('[data-reply]').first().click();await p.locator('.reply-target:not(.hidden)').waitFor();await inspect(p,'reply-editor',width);
  await p.goto(origin+'/posts/'+imagePost.id);await settled(p);await p.locator('[data-image]').first().click();await p.locator('#imageViewer[open]').waitFor();await inspect(p,'image-viewer',width);await p.locator('#imageViewer button').click();
  await p.goto(origin+'/clubs/'+rootClub.id);await settled(p);await p.locator('[data-club-tab=members]').click();await p.locator('.club-member').first().waitFor();await inspect(p,'club-members',width);
  await p.locator('[data-club-tab=chat]').click();await p.locator('[data-message-id]').first().waitFor();await inspect(p,'club-chat',width);
  await p.goto(origin+'/messages');await settled(p);await inspect(p,'chat-list',width);await p.locator(`[data-conversation="${conversation}"]`).click();await p.locator('[data-message-id]').first().waitFor();await inspect(p,'direct-chat',width);
 }
 const interactions=[],viewer=actors[11],p=viewer.page;await p.setViewportSize({width:320,height:844});
 await p.goto(origin+'/posts/'+poll.id);await settled(p);await p.locator(`[data-poll-vote="${poll.id}"][data-option="1"]`).click();await p.locator(`[data-poll="${poll.id}"] [aria-pressed=true]`).waitFor();
 assert.equal((await viewer.api('/api/posts/'+poll.id+'/poll')).poll.total,7);interactions.push('vote updates counts once');
 await p.goto(origin+'/posts/'+imagePost.id);await settled(p);const actions=p.locator(`[data-post-actions="${imagePost.id}"]`);
 await actions.locator('[data-kind=useful]').click();await actions.locator('[data-kind=useful][aria-pressed=true]').waitFor();assert.equal((await viewer.api('/api/posts/'+imagePost.id)).post.reactions.find(r=>r.kind==='useful').count,1);interactions.push('reaction persists');
 await actions.locator('[data-save]').click();await actions.locator('[data-save][aria-pressed=true]').waitFor();assert.equal((await viewer.api('/api/posts/'+imagePost.id)).post.saved,true);interactions.push('saved post persists');
 await p.goto(origin+'/posts/'+longPost.id);await settled(p);await p.locator(`[data-comment-id="${initial.id}"] [data-reply]`).click();const form=p.locator('[data-comment-form]');await form.locator('[name=body]').fill('Новый ответ через редактор на 320 px.');await form.locator('.btn.primary').click();await p.locator('.comment-reply').filter({hasText:'Новый ответ через редактор на 320 px.'}).waitFor();
 const reply=(await viewer.api('/api/posts/'+longPost.id+'/comments')).comments.find(c=>c.body==='Новый ответ через редактор на 320 px.');assert.equal(reply.parent_id,initial.id);interactions.push('reply keeps parent and clears editor');assert.equal(await form.locator('[name=body]').inputValue(),'');
 await p.goto(origin+'/clubs/'+rootClub.id);await settled(p);await p.locator('[data-club-tab=chat]').click();await p.locator('[data-message-id]').first().waitFor();await p.locator('[data-chat-older]').click();await p.waitForFunction(()=>document.querySelectorAll('[data-message-id]').length===60);interactions.push('loads all 60 club messages');
 await p.locator('[data-chat-form] textarea').fill('Новое сообщение через интерфейс.');await p.locator('[data-chat-form] button').click();await p.locator('[data-chat-log]').getByText('Новое сообщение через интерфейс.',{exact:true}).waitFor();assert.equal((await viewer.api(root+'/messages')).messages.filter(m=>m.body==='Новое сообщение через интерфейс.').length,1);interactions.push('sends into populated club chat once');
 writeFileSync(output+'results.json',JSON.stringify({browser:browser.version(),scope:'Isolated local HTTP/SQLite: 12 users, 10 posts/poll/guide, 25 comments, 60 club messages and 25 direct messages. No production writes.',checks,interactions,errors},null,2));
 console.log('INTERACTIONS',interactions.length,interactions);
 assert.equal(checks.filter(c=>c.problems.length).length,0,'Populated layout failures');assert.deepEqual(errors,[]);
 console.log('TOTAL',checks.length,'FAILED',checks.filter(c=>c.problems.length).length,'JS_ERRORS',errors.length);
}finally{for(const a of actors)await a.context.close();await browser.close();await app.close();}
