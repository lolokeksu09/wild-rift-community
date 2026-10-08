import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 4) { db.close(); throw new Error('Unsupported database schema; use matching application version.'); }
  if (version === 0) db.exec(`BEGIN;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '', password TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE TABLE clubs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, description TEXT NOT NULL,
      access TEXT NOT NULL CHECK(access IN ('open','request')), created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE memberships (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('member','pending','banned')),
      PRIMARY KEY(club_id,user_id)
    ) STRICT;
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, club_id TEXT NOT NULL REFERENCES clubs(id),
      author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX posts_club ON posts(club_id,id);
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX comments_post ON comments(post_id,id);
    CREATE TABLE audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES users(id),
      club_id TEXT NOT NULL REFERENCES clubs(id), target_id TEXT NOT NULL,
      action TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    PRAGMA user_version=1;
    COMMIT;`);
  if (version < 2) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(club_id,sender_id,client_id)
    ) STRICT;
    CREATE INDEX messages_club ON messages(club_id,id);
    PRAGMA user_version=2;
    COMMIT;`);
  if (version < 3) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE users ADD COLUMN dm_requests INTEGER NOT NULL DEFAULT 1 CHECK(dm_requests IN (0,1));
    CREATE TABLE direct_conversations (
      id TEXT PRIMARY KEY, user_low TEXT NOT NULL REFERENCES users(id), user_high TEXT NOT NULL REFERENCES users(id),
      requester_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
      created_at INTEGER NOT NULL, UNIQUE(user_low,user_high), CHECK(user_low<user_high)
    ) STRICT;
    CREATE TABLE direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES direct_conversations(id),
      sender_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(conversation_id,sender_id,client_id)
    ) STRICT;
    CREATE INDEX direct_history ON direct_messages(conversation_id,id);
    CREATE TABLE blocks (blocker_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(blocker_id,target_id), CHECK(blocker_id<>target_id)) STRICT;
    PRAGMA user_version=3;
    COMMIT;`);
  if (version < 4) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE direct_reads (
      conversation_id TEXT NOT NULL REFERENCES direct_conversations(id),
      user_id TEXT NOT NULL REFERENCES users(id), last_id INTEGER NOT NULL CHECK(last_id>=0),
      PRIMARY KEY(conversation_id,user_id)
    ) STRICT;
    PRAGMA user_version=4;
    COMMIT;`);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
