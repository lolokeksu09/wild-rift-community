import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../app.mjs';
import {openDatabase} from '../database.mjs';
test('HTML metadata, status and sitemap enforce privacy and escape stored text',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-pages-')),file=join(dir,'db.sqlite'),app=await createApp({databasePath:file});
 const origin=await app.listen(),db=openDatabase(file);t.after(async()=>{db.close();await app.close();rmSync(dir,{recursive:true,force:true});});
 db.prepare('INSERT INTO users(id,handle,name,bio,password,created_at,profile_visible,game_profile) VALUES(?,?,?,?,?,0,?,?)').run('author','author','<Автор>','Биография "&"','unused',1,JSON.stringify({riotId:'SECRET#XYZ',riotVisible:false}));
 db.prepare('INSERT INTO users(id,handle,name,bio,password,created_at) VALUES(?,?,?,?,?,0)').run('hidden','hidden','HIDDEN PROFILE','PRIVATE BIO','unused');
 // Explicit columns keep fixtures independent from later additive club fields.
 for(const [id,access] of [['open','open'],['closed','request']])db.prepare('INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES(?,?,?,?,?,0)').run(id,'author','Клуб '+id,'Описание клуба',access);
 db.prepare('INSERT INTO memberships VALUES(?,?,?)').run('closed','author','member');
 const insert=db.prepare('INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES(?,?,?,?,0)');
 const post=insert.run('open','author','<script> & "Заголовок"','Текст <img src=x> & обсуждение').lastInsertRowid;
 const privatePost=insert.run('closed','author','SECRET TITLE','SECRET BODY').lastInsertRowid;
 const raw='a'.repeat(64);const {digest}=await import('../security.mjs');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(raw),'author','csrf',Date.now()+60000);
 const get=async(path,cookie='',method='GET')=>{const r=await fetch(origin+path,{method,headers:{Cookie:cookie}});return {r,html:await r.text()};};
 const publicPage=await get('/posts/'+post+'?tracking=ignored');assert.equal(publicPage.r.status,200);
 assert(publicPage.html.includes('&lt;script&gt; &amp; &quot;Заголовок&quot;'));assert(!publicPage.html.includes('<script> &'));
 assert(publicPage.html.includes('property="og:type" content="article"'));assert(publicPage.html.includes(`rel="canonical" href="${origin}/posts/${post}"`));
 assert.equal((await get('/posts/'+post,'','HEAD')).html,'');
 for(const path of ['/posts/999999','/players/hidden','/clubs/missing','/not-a-route']){const {r,html}=await get(path);assert.equal(r.status,404);assert.equal(r.headers.get('content-type'),'text/html; charset=utf-8');assert(html.includes('noindex,nofollow'));}
 for(const cookie of ['',`wr_session=${raw}`]){const {r,html}=await get('/posts/'+privatePost,cookie);assert.equal(r.status,cookie?200:403);assert(!html.includes('SECRET TITLE'));assert(!html.includes('SECRET BODY'));assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');}
 const profile=await get('/players/author');assert(profile.html.includes('&lt;Автор&gt;'));assert(!profile.html.includes('SECRET#XYZ'));
 db.prepare('INSERT INTO blocks VALUES(?,?)').run('author','hidden');
 // A blocked public author is unavailable to that authenticated viewer.
 db.prepare('UPDATE users SET profile_visible=1 WHERE id=?').run('hidden');
 assert.equal((await get('/players/hidden',`wr_session=${raw}`)).r.status,404);
 const hiddenRaw='b'.repeat(64);db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(hiddenRaw),'hidden','csrf',Date.now()+60000);
 const blockedPost=await get('/posts/'+post,`wr_session=${hiddenRaw}`);assert.equal(blockedPost.r.status,404);assert(!blockedPost.html.includes('&quot;Заголовок&quot;'));
 db.prepare('INSERT INTO memberships VALUES(?,?,?)').run('open','hidden','banned');
 assert.equal((await get('/clubs/open',`wr_session=${hiddenRaw}`)).r.status,403);
 assert.equal((await get('/posts/'+post,`wr_session=${hiddenRaw}`)).r.status,403);
 const map=await get('/sitemap.xml');assert.equal(map.r.status,200);assert(map.html.includes(`/posts/${post}</loc>`));assert(!map.html.includes(`/posts/${privatePost}</loc>`));assert(!map.html.includes('/account</loc>'));
 db.prepare('UPDATE users SET profile_visible=0 WHERE id=?').run('hidden');assert(!(await get('/sitemap.xml')).html.includes('/players/hidden</loc>'));
 assert((await get('/robots.txt')).html.includes(`Sitemap: ${origin}/sitemap.xml`));assert.equal((await get('/favicon.ico')).r.headers.get('content-type'),'image/svg+xml');
 const meta=await get('/api/page-metadata?path='+encodeURIComponent('/posts/'+privatePost),`wr_session=${raw}`);assert(!meta.html.includes('SECRET'));assert.equal(JSON.parse(meta.html).index,false);
 assert.equal((await get('/account')).r.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.equal((await get('/posts/'+post)).r.headers.get('cache-control'),'no-store');
});
test('replacement patterns in stored text stay literal in server HTML',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-pages-dollar-')),file=join(dir,'db.sqlite'),app=await createApp({databasePath:file});
 const origin=await app.listen(),db=openDatabase(file);t.after(async()=>{db.close();await app.close();rmSync(dir,{recursive:true,force:true});});
 const {escapeHTML}=await import('../pages.mjs');
 const name="Имя $& $' $`",bio='Био $1 $$ $`',clubName="Клуб $' $&",description='Описание $` $<x>',title="Гайд $` $' $& $1 $$ конец",body="Текст $' $`";
 db.prepare('INSERT INTO users(id,handle,name,bio,password,created_at,profile_visible) VALUES(?,?,?,?,?,0,1)').run('author','author',name,bio,'unused');
 db.prepare('INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES(?,?,?,?,?,0)').run('open','author',clubName,description,'open');
 const post=db.prepare('INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES(?,?,?,?,0)').run('open','author',title,body).lastInsertRowid;
 const baseline=await (await fetch(origin+'/rules')).text(),count=(html,re)=>(html.match(re)||[]).length;
 const brand=/<title>Правила сообщества — ([^<]*)<\/title>/.exec(baseline)[1];
 for(const [path,heading,text] of [['/posts/'+post,title,body],['/players/author',name,bio],['/clubs/open',clubName,description],["/missing$&$'",'Страница не найдена',null]]){
  const html=await (await fetch(origin+path)).text(),full=escapeHTML(heading)+' — '+brand;
  for(const re of [/<script /g,/<title>/g,/<\/head>/g,/<!doctype/gi,/<meta name="description"/g])assert.equal(count(html,re),count(baseline,re),path+' '+re);
  assert(html.includes(`<title>${full}</title>`),path);assert(html.includes(`<meta property="og:title" content="${full}">`),path);
  if(text)assert(html.includes(`<meta name="description" content="${escapeHTML(text)}">`),path);
 }
});
test('guest search and sitemap are rate limited per reader',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wr-pages-rate-')),app=await createApp({databasePath:join(dir,'db.sqlite')});
 const origin=await app.listen();t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const statuses=async(path,n,headers={})=>{const out=[];for(let i=0;i<n;i++)out.push((await fetch(origin+path,{headers})).status);return out;};
 const search=await statuses('/api/posts/search?q=test',121);assert.deepEqual([search.filter(s=>s===200).length,search.at(-1)],[120,429]);
 assert.equal((await fetch(origin+'/api/clubs')).status,200,'catalog without a query stays unlimited');
 assert.equal((await fetch(origin+'/api/clubs?q=x')).status,429);
 const r=await fetch(origin+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Community-Request':'1'},body:JSON.stringify({handle:'reader',name:'Reader',password:'Rate-limit-password-1'})});
 assert.equal((await fetch(origin+'/api/posts/search?q=test',{headers:{Cookie:r.headers.get('set-cookie').split(';')[0]}})).status,200,'accounts have their own budget');
 const map=await statuses('/sitemap.xml',11);assert.deepEqual([map.filter(s=>s===200).length,map.at(-1)],[10,429]);
});
