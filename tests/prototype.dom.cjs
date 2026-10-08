const {JSDOM}=require('jsdom');const fs=require('node:fs');const assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../docs/prototype.html'),'utf8');
let errors=[];
function boot(data){const dom=new JSDOM(html,{url:'https://prototype.test/',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new w.Event('close'));};if(data)w.localStorage.setItem('wr-community-prototype-v2',data);w.addEventListener('error',e=>errors.push(e.message));}});return dom;}
let dom=boot();let w=dom.window,d=w.document;
function click(s){const el=d.querySelector(s);assert(el,'Missing '+s);el.click();}
function fill(s,v){const el=d.querySelector(s);assert(el);el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
function submit(s){d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
function nav(id){click('.mobile-nav [data-nav="'+id+'"]');}
click('[data-action="compose"]');fill('[name=title]','Тест заголовка');fill('[name=body]','<img src=x onerror=alert(1)>');submit('#postForm');assert.equal(d.querySelector('.post-title').textContent,'Тест заголовка');assert.equal(d.querySelectorAll('.post-body img').length,0);
click('.post-actions [data-action=like]');assert.equal(d.querySelector('.post-actions [data-action=like]').getAttribute('aria-pressed'),'true');click('.post-actions [data-action=like]');assert.equal(d.querySelector('.post-actions [data-action=like]').getAttribute('aria-pressed'),'false');click('.post-actions [data-action=bookmark]');click('[data-filter=saved]');assert.equal(d.querySelectorAll('.post-title').length,1);
click('.post-actions [data-action=comments]');fill('[name=comment]','Мой комментарий');submit('#commentForm');assert(d.querySelector('.comment').textContent.includes('Мой комментарий'));click('#closeDialog');
nav('clubs');click('.club-card [data-action=club]');click('[data-action=join]');click('[data-action=clubChat]');fill('[name=message]','Привет');submit('#chatForm');assert.equal(d.querySelectorAll('.bubble.self').length,1);
nav('play');click('[data-action=newGroup]');fill('[name=title]','Команда');fill('[name=desc]','Описание');submit('#groupForm');assert.equal(d.querySelector('.group-title').textContent,'Команда');click('[data-action=apply]');assert(d.querySelector('[data-action=apply]').textContent.includes('Отменить'));click('[data-action=apply]');assert(d.querySelector('[data-action=apply]').textContent.includes('Хочу'));
nav('profile');click('[data-action=editProfile]');fill('[name=name]','Новое имя');submit('#profileForm');assert.equal(d.querySelector('.profile-main h2').textContent,'Новое имя');
const stored=w.localStorage.getItem('wr-community-prototype-v2');dom.window.close();dom=boot(stored);w=dom.window;d=w.document;nav('profile');assert.equal(d.querySelector('.profile-main h2').textContent,'Новое имя');nav('chats');click('[data-chat=forest]');assert.equal(d.querySelectorAll('.bubble.self').length,1);
click('[data-action=search]');fill('[name=query]','лес');submit('#modalSearch');assert(d.querySelectorAll('.search-results button').length>0);click('#closeDialog');nav('clubs');click('.club-card [data-action=club]');click('[data-action=leave]');click('#closeDialog');nav('chats');assert.equal(d.querySelectorAll('[data-chat=forest]').length,0);
click('[data-action=about]');click('[data-action=reset]');assert(d.querySelector('[data-action=confirmReset]'));click('[data-action=confirmReset]');assert.equal(JSON.parse(w.localStorage.getItem('wr-community-prototype-v2')).data.posts.length,0);
assert.deepEqual(errors,[]);dom.window.close();
const corrupt=boot('{broken');assert(corrupt.window.document.querySelector('h1'));corrupt.window.close();
console.log('PASS: post/XSS escaping, reactions, bookmarks, comment, club→chat, group/application, profile, reload persistence, search, leave-club navigation, reset confirmation, corrupt storage. DOM only; no visual browser validation.');
