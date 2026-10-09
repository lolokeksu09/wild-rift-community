import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.mjs';
import { openDatabase } from '../database.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function client(origin) {
  return { cookie: '', csrf: '', async call(path, method = 'GET', data, override = {}) {
    const response = await fetch(origin + path, { method, headers: {
      Cookie: this.cookie, Origin: origin, 'Content-Type': 'application/json',
      'X-Community-Request': '1', 'X-CSRF-Token': this.csrf, ...override
    }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json();
    if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
    if (body.csrf) this.csrf = body.csrf;
    return { status: response.status, ...body };
  } };
}
const password = 'Recovery-tests-only-1234', changed = 'Changed-tests-only-5678';

test('codes require password/CSRF, rotate, consume once, revoke all sessions and preserve content', async t => {
  const app = await createApp(); const origin = await app.listen(); t.after(() => app.close());
  const owner = client(origin), otherSession = client(origin), guest = client(origin), outsider = client(origin);
  const account = await owner.call('/api/register', 'POST', { handle: 'recoverowner', name: 'Owner', password });
  await outsider.call('/api/register', 'POST', { handle: 'recoverother', name: 'Other', password });
  await otherSession.call('/api/login', 'POST', { handle: 'recoverowner', password });
  const club = await owner.call('/api/clubs', 'POST', { name: 'Private', description: '', access: 'request' });
  const post = await owner.call(`/api/clubs/${club.id}/posts`, 'POST', { title: 'Keep', body: 'Preserved private text' });
  assert.equal((await guest.call('/api/recovery-codes')).status, 401);
  assert.equal((await owner.call('/api/recovery-codes', 'POST', { password }, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await owner.call('/api/recovery-codes', 'POST', { password: changed })).status, 401);
  const first = await owner.call('/api/recovery-codes', 'POST', { password });
  assert.equal(first.codes.length, 8); assert.equal(new Set(first.codes).size, 8);
  assert.match(first.codes[0], /^[a-f0-9]{8}(-[a-f0-9]{8}){3}$/);
  const replacement = await owner.call('/api/recovery-codes', 'POST', { password });
  assert.equal((await owner.call('/api/recovery-codes')).remaining, 8);
  const payload = { handle: 'RECOVEROWNER', code: replacement.codes[0], password: changed };
  assert.equal((await guest.call('/api/recover', 'POST', { ...payload, code: first.codes[0] })).status, 401);
  assert.equal((await guest.call('/api/recover', 'POST', payload, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await outsider.call('/api/recover', 'POST', { ...payload, handle: 'recoverother' })).status, 401);
  const concurrent = await Promise.all([guest.call('/api/recover', 'POST', payload), client(origin).call('/api/recover', 'POST', payload)]);
  assert.deepEqual(concurrent.map(x => x.status).sort(), [200, 401]);
  assert.equal((await owner.call('/api/me')).user, null);
  assert.equal((await otherSession.call('/api/me')).user, null);
  assert.equal((await owner.call(`/api/posts/${post.id}`)).status, 403);
  assert.equal((await guest.call('/api/login', 'POST', { handle: 'recoverowner', password })).status, 401);
  assert.equal((await guest.call('/api/login', 'POST', { handle: 'recoverowner', password: changed })).status, 200);
  assert.equal((await guest.call(`/api/posts/${post.id}`)).post.body, 'Preserved private text');
  assert.equal((await guest.call('/api/recovery-codes')).remaining, 7);
  assert.equal((await guest.call('/api/recover', 'POST', { ...payload, code: replacement.codes[1].replaceAll('-', '').toUpperCase(), password })).status, 200);
  assert.equal(account.user.handle, 'recoverowner');
});

test('recovery has shared authentication rate limit and uniform invalid-account error', async t => {
  const app = await createApp({ authLimit: 2 }); const origin = await app.listen(); t.after(() => app.close());
  const guest = client(origin), payload = { handle: 'nonexistent', code: '0'.repeat(32), password };
  const first = await guest.call('/api/recover', 'POST', payload);
  assert.equal(first.status, 401); assert.equal(first.error, 'Неверный логин или резервный код.');
  assert.equal((await guest.call('/api/recover', 'POST', payload)).status, 401);
  assert.equal((await guest.call('/api/login', 'POST', { handle: 'nonexistent', password })).status, 429);
});

test('18→19 migration is repeatable and preserves accounts without inventing codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-recovery-migration-'));
  try {
    const path = join(dir, 'db'); let db = new DatabaseSync(path);
    db.exec(readFileSync(new URL('./fixtures/schema-v18.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO users(id,handle,name,password,created_at) VALUES('u','kept','Kept','untouched',1);"); db.close();
    for (let i = 0; i < 2; i++) {
      db = openDatabase(path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,32);
      assert.equal(db.prepare('SELECT password FROM users').get().password, 'untouched');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recovery_codes').get().n, 0);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); db.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('revoked session cannot finish a delayed authenticated write', async t => {
  const app = await createApp(), origin = await app.listen(); t.after(() => app.close());
  const owner = client(origin), guest = client(origin);
  await owner.call('/api/register', 'POST', { handle: 'slowwriter', name: 'Original', password });
  const { codes } = await owner.call('/api/recovery-codes', 'POST', { password });
  let pending;
  const response = new Promise((resolve, reject) => {
    pending = request(origin + '/api/me', { method: 'PATCH', headers: {
      Cookie: owner.cookie, Origin: origin, 'Content-Type': 'application/json',
      'X-Community-Request': '1', 'X-CSRF-Token': owner.csrf
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    pending.on('error', reject); pending.write('{"name":');
  });
  // Keep the body open while the account's recovery transaction revokes cookies.
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await guest.call('/api/recover', 'POST', { handle: 'slowwriter', code: codes[0], password: changed })).status, 200);
  pending.end('"Overwritten"}');
  assert.equal(await response, 403);
  await guest.call('/api/login', 'POST', { handle: 'slowwriter', password: changed });
  assert.equal((await guest.call('/api/me')).user.name, 'Original');
});
