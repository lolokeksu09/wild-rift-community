import test from 'node:test';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.mjs';
const PASSWORD = 'Only-for-test-123456';

test('local community: accounts, permissions, data persistence', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-community-'));
  const databasePath = join(dir, 'test.sqlite');
  let app = await createApp({ databasePath }), origin = await app.listen();
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  function client() {
    return { cookie: '', csrf: '', async request(path, method='GET', data, extra={}) {
      const headers = { Cookie: this.cookie, ...extra };
      if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': 'application/json', 'X-Community-Request': '1', 'X-CSRF-Token': this.csrf }, extra);
      const response = await fetch(origin + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
      const set = response.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
      const result = await response.json(); if (result.csrf) this.csrf = result.csrf;
      return { status: response.status, data: result, headers: response.headers };
    }};
  }
  const owner = client(), member = client(), outsider = client(), guest = client();
  let ownerId, memberId, clubId, postId;
  await t.test('registers independent users with safe response and HttpOnly session', async () => {
    for (const [c, handle] of [[owner,'owner'],[member,'member'],[outsider,'outside']]) {
      const r = await c.request('/api/register','POST',{handle,name:handle,password:PASSWORD,role:'admin'});
      assert.equal(r.status,201); assert(!('password' in r.data.user)); assert(!('role' in r.data.user));
      assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
      if (c===owner) ownerId=r.data.user.id;
      if (c===member) memberId=r.data.user.id;
    }
    assert.notEqual(owner.cookie,member.cookie);
    assert.equal((await guest.request('/api/me')).data.user,null);
  });
  await t.test('validates login, password and JSON; rejects login collisions', async () => {
    assert.equal((await guest.request('/api/register','POST',{handle:'OWNER',name:'duplicate',password:PASSWORD})).status,409);
    assert.equal((await guest.request('/api/register','POST',{handle:'new',name:'new',password:'short'})).status,422);
    assert.equal((await guest.request('/api/login','POST',{handle:'owner',password:'wrong-password-123'})).status,401);
    const bad = await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'X-Community-Request':'1','Content-Type':'application/json'},body:'{bad'});
    assert.equal(bad.status,400);
  });
  await t.test('rejects cross-origin, missing CSRF, spoofed host and unauthenticated writes', async () => {
    assert.equal((await owner.request('/api/clubs','POST',{}, {Origin:'https://attacker.test'})).status,403);
    assert.equal((await owner.request('/api/clubs','POST',{}, {'X-CSRF-Token':''})).status,403);
    assert.equal((await guest.request('/api/clubs','POST',{})).status,401);
    const status = await new Promise((resolve,reject) => { get(origin+'/api/me',{headers:{Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject); });
    assert.equal(status,403);
  });
  await t.test('creates a request-only club; pending membership cannot read', async () => {
    const r = await owner.request('/api/clubs','POST',{name:'Закрытый клуб',description:'Общение',access:'request'});
    assert.equal(r.status,201); clubId=r.data.id;
    for (const c of [guest,outsider,member]) assert.equal((await c.request(`/api/clubs/${clubId}/posts`)).status,403);
    assert.equal((await member.request(`/api/clubs/${clubId}/join`,'POST',{})).data.status,'pending');
    assert.equal((await member.request(`/api/clubs/${clubId}/posts`)).status,403);
    assert.equal((await outsider.request(`/api/clubs/${clubId}/members`)).status,403);
    assert.equal((await member.request(`/api/clubs/${clubId}/decision`,'POST',{userId:memberId,decision:'approve'})).status,403);
    assert.equal((await owner.request(`/api/clubs/${clubId}/decision`,'POST',{userId:memberId,decision:'approve'})).status,200);
  });
  await t.test('member publishes; owner comments; outsiders cannot read direct IDs', async () => {
    const r=await member.request(`/api/clubs/${clubId}/posts`,'POST',{title:'Привет',body:'<script>alert(1)</script>',author_id:ownerId});
    assert.equal(r.status,201);postId=r.data.id;
    const p=(await owner.request(`/api/posts/${postId}`)).data.post;
    assert.equal(p.author_id,memberId);assert.equal(p.body,'<script>alert(1)</script>');
    assert.equal((await owner.request(`/api/posts/${postId}/comments`,'POST',{body:'Добро пожаловать'})).status,201);
    assert.equal((await member.request(`/api/posts/${postId}/comments`)).data.comments.length,1);
    for(const c of [guest,outsider])for(const suffix of ['', '/comments'])assert.equal((await c.request(`/api/posts/${postId}${suffix}`)).status,403);
    assert.equal((await owner.request(`/api/posts/${postId}`,'DELETE',{})).status,403);
  });
  await t.test('own profile only; no password or session tokens in stored plaintext', async () => {
    assert.equal((await member.request('/api/me','PATCH',{name:'Новое имя',bio:'Текст',id:ownerId})).status,200);
    assert.equal((await owner.request('/api/me')).data.user.name,'owner');
    const db=new DatabaseSync(databasePath);const u=db.prepare('SELECT password FROM users WHERE id=?').get(memberId);
    assert.match(u.password,/^scrypt\$/);assert(!u.password.includes(PASSWORD));
    const sessions=db.prepare('SELECT hash FROM sessions').all();assert(!sessions.some(s=>member.cookie.includes(s.hash)));db.close();
  });
  await t.test('paginates without overlap when a new post arrives', async () => {
    for(let i=0;i<22;i++)await member.request(`/api/clubs/${clubId}/posts`,'POST',{title:'Пост '+i,body:'Текст'});
    const first=(await member.request(`/api/clubs/${clubId}/posts`)).data;assert.equal(first.posts.length,20);assert(first.next);
    await member.request(`/api/clubs/${clubId}/posts`,'POST',{title:'Новый',body:'Текст'});
    const second=(await member.request(`/api/clubs/${clubId}/posts?before=${first.next}`)).data;
    assert.equal(second.posts.length,3);assert(!second.posts.some(p=>first.posts.some(q=>p.id===q.id)));
  });
  await t.test('survives server restart with accounts, sessions, posts and comments', async () => {
    await app.close();app=await createApp({databasePath});origin=await app.listen();
    assert.equal((await member.request('/api/me')).data.user.name,'Новое имя');
    assert.equal((await member.request(`/api/posts/${postId}/comments`)).data.comments[0].body,'Добро пожаловать');
  });
  await t.test('ban immediately revokes direct access; leave/join cannot bypass it', async () => {
    assert.equal((await owner.request(`/api/clubs/${clubId}/ban`,'POST',{userId:memberId})).status,200);
    assert.equal((await member.request(`/api/posts/${postId}`)).status,403);
    assert.equal((await member.request(`/api/posts/${postId}/comments`,'POST',{body:'Попытка'})).status,403);
    await member.request(`/api/clubs/${clubId}/leave`,'POST',{});
    assert.equal((await member.request(`/api/clubs/${clubId}/join`,'POST',{})).status,403);
    assert.equal((await owner.request(`/api/clubs/${clubId}/leave`,'POST',{})).status,409);
  });
  await t.test('open club supports guest reading, idempotent joining and author deletion', async () => {
    const c=await outsider.request('/api/clubs','POST',{name:'Открытый',description:'',access:'open'});
    assert.equal(c.status,201);const id=c.data.id;
    const joined=await Promise.all([member.request(`/api/clubs/${id}/join`,'POST',{}),member.request(`/api/clubs/${id}/join`,'POST',{})]);
    assert(joined.every(x=>x.status===200));
    const members=(await outsider.request(`/api/clubs/${id}/members`)).data.members;assert.equal(members.length,2);
    const p=await member.request(`/api/clubs/${id}/posts`,'POST',{title:'Общий пост',body:'Публичный текст'});
    assert.equal((await guest.request(`/api/posts/${p.data.id}`)).status,200);
    assert.equal((await member.request(`/api/posts/${p.data.id}`,'DELETE',{})).status,200);
    assert.equal((await guest.request(`/api/posts/${p.data.id}`)).status,404);
  });
  await t.test('logout-all revokes multiple sessions', async () => {
    const other=client();assert.equal((await other.request('/api/login','POST',{handle:'owner',password:PASSWORD})).status,200);
    assert.equal((await owner.request('/api/logout-all','POST',{})).status,200);
    assert.equal((await other.request('/api/me')).data.user,null);
    assert.equal((await owner.request('/api/me')).data.user,null);
  });
  await t.test('serves only whitelisted assets and rejects oversized bodies', async () => {
    for(const path of ['/data/community.sqlite','/.git/config','/server/app.mjs','/docs/SPEC.md'])assert.equal((await fetch(origin+path)).status,404);
    const html=await fetch(origin);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/script-src 'self'/);
    const r=await outsider.request('/api/me','PATCH',{name:'x',bio:'x'.repeat(17000)});assert.equal(r.status,413);
  });
});

test('login rate limit and session expiry', async t => {
  let clock=Date.now();const app=await createApp({now:()=>clock,authLimit:2});const origin=await app.listen();t.after(()=>app.close());
  const headers={Origin:origin,'Content-Type':'application/json','X-Community-Request':'1'};
  const register=await fetch(origin+'/api/register',{method:'POST',headers,body:JSON.stringify({handle:'expire',name:'Expiry',password:PASSWORD})});
  const cookie=register.headers.get('set-cookie').split(';')[0];assert.equal(register.status,201);
  for(const status of [401,429]){const r=await fetch(origin+'/api/login',{method:'POST',headers,body:JSON.stringify({handle:'missing',password:PASSWORD})});assert.equal(r.status,status);}
  clock+=8*86400000;
  const expired=await fetch(origin+'/api/me',{headers:{Cookie:cookie}});assert.equal((await expired.json()).user,null);
});
