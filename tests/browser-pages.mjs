import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {openDatabase} from '../server/database.mjs';
import {seedDemoCommunity,demoId} from '../server/demo-seed.mjs';
import {createApp} from '../server/app.mjs';
const dir=mkdtempSync(join(tmpdir(),'wr-browser-pages-')),databasePath=join(dir,'db.sqlite');
const db=openDatabase(databasePath);await seedDemoCommunity(db);const post=db.prepare('SELECT id,title FROM posts ORDER BY id LIMIT 1').get();db.close();
const app=await createApp({databasePath}),origin=await app.listen(),browser=await chromium.launch();
try{for(const width of [360,390,768,1440]){
 const context=await browser.newContext({viewport:{width,height:900}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 assert.equal((await p.goto(origin+'/missing-page')).status(),404);await p.getByRole('heading',{name:'Страница не найдена'}).waitFor();assert.equal(new URL(p.url()).pathname,'/missing-page');
 await p.getByRole('button',{name:'На главную',exact:true}).click();await p.locator('.welcome-hero').waitFor();await p.waitForFunction(()=>document.title.startsWith('Твои люди'));
 await p.locator('#home').click();await p.waitForFunction(()=>document.title.startsWith('Клубы'));
 await p.goto(origin+'/clubs/'+demoId('club:0'));await p.locator('.club-overview').waitFor();await p.waitForFunction(()=>document.title.startsWith('После матча'));
 await p.goto(origin+'/posts/'+post.id);await p.locator('.post-title').waitFor();assert.equal(await p.title(),post.title+' — Wild Rift Community');
 assert.equal(await p.locator('link[rel=canonical]').getAttribute('href'),origin+'/posts/'+post.id);
 await p.locator('#people').click();await p.waitForFunction(()=>document.title.startsWith('Люди'));assert.equal(await p.locator('meta[property="og:url"]').getAttribute('content'),origin+'/players');
 await p.goBack();await p.waitForFunction(title=>document.title.startsWith(title),post.title);
 assert.equal((await p.goto(origin+'/posts/999999')).status(),404);await p.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');assert((await p.title()).includes('Страница не найдена'));
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: HTML status, public metadata, SPA navigation and history`);
}}finally{await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}
