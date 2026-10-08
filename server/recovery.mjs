import { randomBytes } from 'node:crypto';
import { digest, fail } from './security.mjs';
import { transaction } from './database.mjs';

export function codeHash(value) {
  const code = typeof value === 'string' ? value.replaceAll('-', '').trim().toLowerCase() : '';
  return /^[a-f0-9]{32}$/.test(code) ? digest(code) : digest('invalid recovery code');
}

export function replaceCodes(db, userId, now) {
  const codes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex').match(/.{8}/g).join('-'));
  transaction(db, () => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
    for (const code of codes) db.prepare('INSERT INTO recovery_codes(user_id,hash,created_at) VALUES(?,?,?)').run(userId, codeHash(code), now);
  });
  return codes;
}

export function consumeCode(db, userId, code, passwordHash) {
  transaction(db, () => {
    const used = db.prepare('DELETE FROM recovery_codes WHERE user_id=? AND hash=?').run(userId, codeHash(code));
    if (used.changes !== 1) fail(401, 'Неверный логин или резервный код.');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash, userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  });
}
