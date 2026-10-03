import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 11) { db.close(); throw new Error('Unsupported database schema; use matching application version.'); }
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
  if (version < 5) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('direct','club')), message_id INTEGER NOT NULL,
      sender_id TEXT NOT NULL REFERENCES users(id), snapshot TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),
      decision_note TEXT NOT NULL DEFAULT '', moderator_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
      UNIQUE(reporter_id,kind,message_id)
    ) STRICT;
    CREATE TABLE moderation_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,report_id INTEGER NOT NULL REFERENCES reports(id),
      actor_id TEXT NOT NULL REFERENCES users(id),decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
    PRAGMA user_version=5;
    COMMIT;`);
  if (version < 6) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE reports ADD COLUMN decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1));
    PRAGMA user_version=6;
    COMMIT;`);
  if (version < 7) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE report_appeals (
      report_id INTEGER PRIMARY KEY REFERENCES reports(id), reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),
      note TEXT NOT NULL DEFAULT '', moderator_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
      decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1))
    ) STRICT;
    ALTER TABLE moderation_audit ADD COLUMN stage TEXT NOT NULL DEFAULT 'initial' CHECK(stage IN ('initial','appeal'));
    PRAGMA user_version=7;
    COMMIT;`);
  if (version < 8) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE users ADD COLUMN block_version INTEGER NOT NULL DEFAULT 0;
    PRAGMA user_version=8;
    COMMIT;`);
  if (version < 9) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE lfg_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,create_signature TEXT NOT NULL,
      title TEXT NOT NULL,mode TEXT NOT NULL,region TEXT NOT NULL,language TEXT NOT NULL,role TEXT NOT NULL,rank TEXT NOT NULL,voice TEXT NOT NULL,description TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 5),starts_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),UNIQUE(owner_id,client_id)
    ) STRICT;
    CREATE TABLE lfg_members(group_id INTEGER NOT NULL REFERENCES lfg_groups(id),user_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')),PRIMARY KEY(group_id,user_id)) STRICT;
    CREATE INDEX lfg_members_user ON lfg_members(user_id,group_id);
    CREATE TABLE lfg_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,group_id INTEGER NOT NULL REFERENCES lfg_groups(id),sender_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(group_id,sender_id,client_id)) STRICT;
    CREATE INDEX lfg_messages_group ON lfg_messages(group_id,id);
    PRAGMA user_version=9;
    COMMIT;`);
  if (version < 10) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE lfg_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),group_id INTEGER NOT NULL REFERENCES lfg_groups(id),kind TEXT NOT NULL CHECK(kind IN ('application','accepted','rejected','removed','cancelled','left','closed')),created_at INTEGER NOT NULL,seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))) STRICT;
    CREATE INDEX lfg_notifications_user ON lfg_notifications(user_id,seen,id);
    PRAGMA user_version=10;
    COMMIT;`);
  if (version < 11) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE media (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
      signature TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      size INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(owner_id,client_id)
    ) STRICT;
    CREATE INDEX media_owner ON media(owner_id);
    ALTER TABLE users ADD COLUMN game_profile TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE users ADD COLUMN profile_visible INTEGER NOT NULL DEFAULT 0 CHECK(profile_visible IN (0,1));
    ALTER TABLE users ADD COLUMN avatar_id TEXT REFERENCES media(id);
    ALTER TABLE users ADD COLUMN cover_id TEXT REFERENCES media(id);
    ALTER TABLE clubs ADD COLUMN cover_id TEXT REFERENCES media(id);
    ALTER TABLE posts ADD COLUMN image_id TEXT REFERENCES media(id);
    PRAGMA user_version=11;
    COMMIT;`);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
