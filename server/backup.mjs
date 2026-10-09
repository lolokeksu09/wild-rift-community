import { DatabaseSync, backup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, mkdtempSync, rmSync, linkSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('WRBACK01');
export function backupKey(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw Error('WR_BACKUP_KEY must contain 64 hexadecimal characters.');
  return Buffer.from(value, 'hex');
}
function checkDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const schema=db.prepare('PRAGMA user_version').get().user_version;
    if (![19,20,21,22,23,24,25,26,27,28,29,30,31].includes(schema)) throw Error('Backup requires supported schema 19 to 31.');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Invalid backup database.');
    return schema;
  } finally { db.close(); }
}

export async function createBackup(sourcePath, destination, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('Invalid backup key.');
  // Open read-only: never create a missing source or migrate a live database.
  const source = new DatabaseSync(resolve(sourcePath), { readOnly: true, timeout: 3000 });
  // Stage beside the destination on disk: a container /tmp is tmpfs and counts against its memory limit.
  const temporary = mkdtempSync(join(dirname(resolve(destination)), '.wr-encrypted-backup-'));
  let ownsOutput = false;
  try {
    const snapshot = join(temporary, 'snapshot.sqlite');
    await backup(source, snapshot);
    const schema=checkDatabase(snapshot);
    const nonce = randomBytes(12), header = Buffer.concat([magic, nonce]);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(header);
    const file = await open(destination, 'wx', 0o600);
    ownsOutput = true;
    try { await file.writeFile(header); } finally { await file.close(); }
    await pipeline(createReadStream(snapshot), cipher, createWriteStream(destination, { flags: 'r+', start: header.length }));
    const append = await open(destination, 'a');
    try { await append.writeFile(cipher.getAuthTag()); } finally { await append.close(); }
    return { bytes: (await stat(destination)).size, schema };
  } catch (error) {
    if (ownsOutput) rmSync(destination, { force: true });
    throw error;
  } finally { source.close(); rmSync(temporary, { recursive: true, force: true }); }
}

export async function restoreBackup(archive, destination, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('Invalid backup key.');
  // Stage on the destination filesystem; link publishes without overwriting.
  const temporary = mkdtempSync(join(dirname(resolve(destination)), '.wr-restore-'));
  try {
    const input = await open(archive, 'r');
    let header, tag, size;
    try {
      size = (await input.stat()).size;
      if (size < 37) throw Error('Invalid backup archive.');
      header = Buffer.alloc(20); tag = Buffer.alloc(16);
      await input.read(header, 0, 20, 0); await input.read(tag, 0, 16, size - 16);
    } finally { await input.close(); }
    if (!header.subarray(0, 8).equals(magic)) throw Error('Unknown backup format.');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    const restored = join(temporary, 'restored.sqlite');
    await pipeline(createReadStream(archive, { start: 20, end: size - 17 }), decipher, createWriteStream(restored, { flags: 'wx', mode: 0o600 }));
    const schema=checkDatabase(restored);
    const db = new DatabaseSync(restored);
    try {
      // Old cookies and already-used recovery codes must not revive on rollback.
      db.exec('BEGIN; DELETE FROM sessions; DELETE FROM recovery_codes; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
    } finally { db.close(); }
    linkSync(restored, destination);
    return { schema, sessionsRevoked: true, recoveryCodesRevoked: true };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
