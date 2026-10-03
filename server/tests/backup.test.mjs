import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.mjs';

test('cold backup restores an independent database with private access and new writes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-restore-'));
  const source = join(dir, 'source'), backup = join(dir, 'backup'), restored = join(dir, 'restored');
  mkdirSync(source);
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); });
  app = await createApp({ databasePath: join(source, 'community.sqlite') });
  let origin = await app.listen();
  const password = 'Restore-test-only-12345';
  function client() {
    return { cookie: '', csrf: '', async request(path, method = 'GET', data) {
      const headers = { Cookie: this.cookie };
      if (method !== 'GET') Object.assign(headers, { Origin: origin, 'Content-Type': 'application/json', 'X-Community-Request': '1', 'X-CSRF-Token': this.csrf });
      const response = await fetch(origin + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
      if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
      const body = await response.json();
      if (body.csrf) this.csrf = body.csrf;
      return { status: response.status, body };
    } };
  }
  const owner = client(), outsider = client();
  for (const [c, handle] of [[owner, 'restoreowner'], [outsider, 'restoreoutside']]) {
    assert.equal((await c.request('/api/register', 'POST', { handle, name: handle, password })).status, 201);
  }
  const club = await owner.request('/api/clubs', 'POST', { name: 'Private restore', description: '', access: 'request' });
  assert.equal(club.status, 201);
  const post = await owner.request(`/api/clubs/${club.body.id}/posts`, 'POST', { title: 'Backup', body: 'Private preserved text' });
  assert.equal(post.status, 201);
  const path = `/api/posts/${post.body.id}`;
  assert.equal((await owner.request(path + '/comments', 'POST', { body: 'Before backup' })).status, 201);
  assert.equal((await owner.request(path+'/reaction','PUT',{kind:'useful'})).status,200);
  assert.equal((await owner.request(path+'/saved','PUT',{})).status,200);
  await app.close(); app = null;
  // Cold copy: no open server or SQLite connection during either copy.
  cpSync(source, backup, { recursive: true, errorOnExist: true, force: false });
  cpSync(backup, restored, { recursive: true, errorOnExist: true, force: false });
  const restoredPath = join(restored, 'community.sqlite');
  const db = new DatabaseSync(restoredPath);
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15);
  } finally { db.close(); }
  app = await createApp({ databasePath: restoredPath }); origin = await app.listen();
  assert.equal((await owner.request('/api/me')).body.user.handle, 'restoreowner');
  assert.equal((await owner.request(path)).body.post.body, 'Private preserved text');
  assert.equal((await owner.request(path)).body.post.myReaction,'useful');
  assert.equal((await owner.request('/api/saved')).body.posts[0].id,post.body.id);
  assert.equal((await outsider.request(path)).status, 403);
  assert.equal((await owner.request(path + '/comments')).body.comments[0].body, 'Before backup');
  const fresh = client();
  assert.equal((await fresh.request('/api/login', 'POST', { handle: 'restoreowner', password })).status, 200);
  assert.equal((await fresh.request(path + '/comments', 'POST', { body: 'After restore' })).status, 201);
  assert.equal((await fresh.request(path + '/comments')).body.comments.length, 2);
  await app.close(); app = null;
  for (const original of [source, backup]) {
    const unchanged = new DatabaseSync(join(original, 'community.sqlite'), { readOnly: true });
    try { assert.equal(unchanged.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1); }
    finally { unchanged.close(); }
  }
});
