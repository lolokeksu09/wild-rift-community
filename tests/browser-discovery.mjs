import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {openDatabase} from '../server/database.mjs';
import {seedDemoCommunity,demoId} from '../server/demo-seed.mjs';
import {createApp} from '../server/app.mjs';
const dir=mkdtempSync(join(tmpdir(),'wr-discovery-')),databasePath=join(dir,'community.sqlite');let db=openDatabase(databasePath);await seedDemoCommunity(db);const post=db.prepare('SELECT id FROM posts ORDER BY id DESC LIMIT 1').get().id;db.close();
const app=await createApp({databasePath}),origin=await app.listen(),browser=await chromium.launch();mkdirSync('ui-screenshots',{recursive:true});
try{for(const [round,width] of [360,390,768,1440].entries()){
 const c=await browser.newContext({viewport:{width,height:900}}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const club=demoId('club:0'),bot=demoId('user:0');
 await p.goto(origin+'/feed');await p.locator('.people-panel').waitFor();assert.match(await p.locator('.people-panel').textContent(),/24 демонстрационных бота/);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:`ui-screenshots/discovery-home-${width}.png`,fullPage:false});
 await p.locator('#people').click();await p.locator('.member-card').first().waitFor();assert.equal(new URL(p.url()).pathname,'/players');assert.equal(await p.locator('.member-card').count(),20);await p.locator('[data-members-more]').click();await p.waitForFunction(()=>document.querySelectorAll('.member-card').length===24);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:`ui-screenshots/discovery-people-${width}.png`,fullPage:false});
 await p.goto(origin+'/players/'+bot);await p.locator('.bot-explanation').waitFor();assert.match(await p.locator('.profile-showcase').textContent(),/Бот · демо/);await p.reload();await p.locator('.bot-explanation').waitFor();
 await p.goto(origin+'/posts/'+post);await p.locator('.post-title').waitFor();await p.locator('[data-comments]').click();await p.locator('.comment .bot-badge').first().waitFor();assert.equal(await p.locator('.comment .bot-badge').count(),3);
 await p.locator('#home').click();await p.locator('.club-card').first().waitFor();assert.equal(new URL(p.url()).pathname,'/clubs');await p.goBack();await p.locator('.post-title').waitFor();assert.equal(new URL(p.url()).pathname,'/posts/'+post);await p.goForward();await p.locator('.club-card').first().waitFor();
 await p.goto(origin+'/clubs/'+club);await p.locator('[data-club-signin]').waitFor();await p.locator('[data-club-signin]').click();await p.locator('#register').waitFor();assert.match(p.url(),/account\?return=/);await p.reload();await p.locator('#register').waitFor();await p.locator('#register [name=name]').fill('Настоящий участник');await p.locator('#register [name=handle]').fill('discovery_human_'+width);await p.locator('#register [name=password]').fill('Discovery-test-only-123');await p.locator('#register button').click();await p.locator('[data-membership=join]').waitFor();assert.equal(new URL(p.url()).pathname,'/clubs/'+club);await p.locator('[data-membership=join]').click();await p.locator('[data-membership=leave]').waitFor();assert.match(await p.locator('.club-overview').textContent(),new RegExp((13+round)+' участников · 12 ботов'));
 await p.locator('#people').click();await p.locator('.member-card').first().waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await c.close();console.log(`PASS ${width}px: labelled demo community, member pagination, public deep links, refresh/back/forward, club signin return through reload, real membership and bot counts`);
}}finally{await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}

