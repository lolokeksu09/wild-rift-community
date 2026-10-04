import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { replaceCodes } from '../recovery.mjs';
import { backupKey, createBackup, restoreBackup } from '../backup.mjs';

test('live WAL snapshot encrypts content, restores independently and revokes stale secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-live-backup-'));
  const source = join(dir, 'source'), archive = join(dir, 'archive.wrbackup'), destination = join(dir, 'restored');
  const db = openDatabase(source), key = randomBytes(32);
  try {
    db.exec("INSERT INTO users(id,handle,name,password,created_at) VALUES('u','owner','Owner','preserved-password-hash',1); INSERT INTO sessions VALUES('cookie','u','csrf',9999999999999); INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES('c','u','Private','Private backup content','request',1); INSERT INTO memberships VALUES('c','u','member'); INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES('c','u','Secret','Private preserved post',1);");
    replaceCodes(db, 'u', 1);
    const result = await createBackup(source, archive, key);
    assert.equal(result.schema, 20);
    const encrypted = readFileSync(archive);
    assert(!encrypted.includes(Buffer.from('Private preserved post')));
    assert(!encrypted.includes(Buffer.from('preserved-password-hash')));
    db.exec("UPDATE posts SET body='New source content' WHERE id=1;");
    await restoreBackup(archive, destination, key);
    const restored = new DatabaseSync(destination);
    try {
      assert.equal(restored.prepare('SELECT body FROM posts').get().body, 'Private preserved post');
      assert.equal(restored.prepare('SELECT password FROM users').get().password, 'preserved-password-hash');
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovery_codes').get().n, 0);
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      restored.exec("UPDATE posts SET body='Restored new write' WHERE id=1;");
    } finally { restored.close(); }
    assert.equal(db.prepare('SELECT body FROM posts').get().body, 'New source content');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM recovery_codes').get().n, 8);
    await assert.rejects(createBackup(source, archive, key));
    assert.deepEqual(readFileSync(archive), encrypted);
    await assert.rejects(restoreBackup(archive, destination, key));
    const corrupt = join(dir, 'corrupt'); encrypted[25] ^= 1; writeFileSync(corrupt, encrypted);
    await assert.rejects(restoreBackup(corrupt, join(dir, 'bad'), key));
    assert(!existsSync(join(dir, 'bad')));
    await assert.rejects(restoreBackup(archive, join(dir, 'wrong'), randomBytes(32)));
    assert(!existsSync(join(dir, 'wrong')));
    await assert.rejects(createBackup(join(dir, 'missing'), join(dir, 'missing-out'), key));
    assert(!existsSync(join(dir, 'missing')));
    assert.throws(() => backupKey('short'));
  } finally { db.close(); key.fill(0); rmSync(dir, { recursive: true, force: true }); }
});
