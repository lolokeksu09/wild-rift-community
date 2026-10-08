import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 22) { db.close(); throw new Error('Unsupported database schema; use matching application version.'); }
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
  if (version < 12) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE posts ADD COLUMN client_id TEXT;
    CREATE UNIQUE INDEX posts_attempt ON posts(club_id,author_id,client_id) WHERE client_id IS NOT NULL;
    ALTER TABLE comments ADD COLUMN client_id TEXT;
    ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE;
    CREATE UNIQUE INDEX comments_attempt ON comments(post_id,author_id,client_id) WHERE client_id IS NOT NULL;
    CREATE TABLE post_reactions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('like','useful','fire')), PRIMARY KEY(post_id,user_id)
    ) STRICT;
    CREATE TABLE saved_posts (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, PRIMARY KEY(post_id,user_id)
    ) STRICT;
    CREATE INDEX saved_posts_user ON saved_posts(user_id,post_id);
    CREATE TABLE discussion_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('mention','reply')),created_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))
    ) STRICT;
    CREATE UNIQUE INDEX discussion_notification_event ON discussion_notifications(user_id,post_id,COALESCE(comment_id,0));
    CREATE INDEX discussion_notifications_user ON discussion_notifications(user_id,seen,id);
    PRAGMA user_version=12;
    COMMIT;`);
  if(version < 13) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE clubs ADD COLUMN rules TEXT NOT NULL DEFAULT '';
    ALTER TABLE clubs ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE clubs ADD COLUMN accent TEXT NOT NULL DEFAULT 'azure' CHECK(accent IN ('azure','emerald','violet','coral'));
    ALTER TABLE clubs ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE club_moderators(club_id TEXT NOT NULL,user_id TEXT NOT NULL,
      PRIMARY KEY(club_id,user_id),FOREIGN KEY(club_id,user_id) REFERENCES memberships(club_id,user_id) ON DELETE CASCADE) STRICT;
    CREATE TABLE club_pins(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      club_id TEXT NOT NULL REFERENCES clubs(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL) STRICT;
    CREATE INDEX club_pins_club ON club_pins(club_id,created_at,post_id);
    CREATE TABLE club_invites(id TEXT PRIMARY KEY,club_id TEXT NOT NULL REFERENCES clubs(id),creator_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 50),
      uses INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),UNIQUE(club_id,creator_id,client_id)) STRICT;
    CREATE TABLE club_invite_uses(invite_id TEXT NOT NULL REFERENCES club_invites(id),user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,PRIMARY KEY(invite_id,user_id)) STRICT;
    CREATE TABLE club_transfers(id TEXT PRIMARY KEY,club_id TEXT NOT NULL REFERENCES clubs(id),owner_id TEXT NOT NULL REFERENCES users(id),
      target_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','cancelled')),UNIQUE(club_id,owner_id,client_id)) STRICT;
    CREATE UNIQUE INDEX club_transfer_pending ON club_transfers(club_id) WHERE status='pending';
    PRAGMA user_version=13;
    COMMIT;`);
  if(version < 14) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE game_events(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,signature TEXT NOT NULL,
      title TEXT NOT NULL,description TEXT NOT NULL,mode TEXT NOT NULL,region TEXT NOT NULL,language TEXT NOT NULL,
      timezone TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),UNIQUE(owner_id,client_id)) STRICT;
    CREATE INDEX game_events_start ON game_events(starts_at,id);
    CREATE TABLE event_slots(event_id INTEGER NOT NULL REFERENCES game_events(id),role TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),PRIMARY KEY(event_id,role),UNIQUE(event_id,user_id)) STRICT;
    CREATE TABLE event_exclusions(event_id INTEGER NOT NULL REFERENCES game_events(id),user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(event_id,user_id)) STRICT;
    CREATE TABLE event_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL REFERENCES game_events(id),sender_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(event_id,sender_id,client_id)) STRICT;
    CREATE INDEX event_messages_history ON event_messages(event_id,id);
    CREATE TABLE event_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),event_id INTEGER NOT NULL REFERENCES game_events(id),
      kind TEXT NOT NULL CHECK(kind IN ('joined','left','removed','cancelled','reminder')),created_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))) STRICT;
    CREATE UNIQUE INDEX event_reminder_unique ON event_notifications(user_id,event_id) WHERE kind='reminder';
    CREATE INDEX event_notifications_user ON event_notifications(user_id,seen,id);
    PRAGMA user_version=14;
    COMMIT;`);
  if(version < 15) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE post_drafts(club_id TEXT NOT NULL,user_id TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',
      image_id TEXT REFERENCES media(id),version INTEGER NOT NULL CHECK(version>0),updated_at INTEGER NOT NULL,
      PRIMARY KEY(club_id,user_id),FOREIGN KEY(club_id,user_id) REFERENCES memberships(club_id,user_id) ON DELETE CASCADE) STRICT;
    CREATE UNIQUE INDEX draft_image ON post_drafts(image_id) WHERE image_id IS NOT NULL;
    CREATE TRIGGER draft_image_deleted AFTER DELETE ON post_drafts WHEN OLD.image_id IS NOT NULL BEGIN
      DELETE FROM media WHERE id=OLD.image_id AND NOT EXISTS(SELECT 1 FROM post_drafts WHERE image_id=OLD.image_id)
      AND NOT EXISTS(SELECT 1 FROM posts WHERE image_id=OLD.image_id) AND NOT EXISTS(SELECT 1 FROM clubs WHERE cover_id=OLD.image_id)
      AND NOT EXISTS(SELECT 1 FROM users WHERE avatar_id=OLD.image_id OR cover_id=OLD.image_id);
    END;
    CREATE TRIGGER draft_image_replaced AFTER UPDATE OF image_id ON post_drafts WHEN OLD.image_id IS NOT NULL AND OLD.image_id IS NOT NEW.image_id BEGIN
      DELETE FROM media WHERE id=OLD.image_id AND NOT EXISTS(SELECT 1 FROM post_drafts WHERE image_id=OLD.image_id)
      AND NOT EXISTS(SELECT 1 FROM posts WHERE image_id=OLD.image_id) AND NOT EXISTS(SELECT 1 FROM clubs WHERE cover_id=OLD.image_id)
      AND NOT EXISTS(SELECT 1 FROM users WHERE avatar_id=OLD.image_id OR cover_id=OLD.image_id);
    END;
    PRAGMA user_version=15;
    COMMIT;`);
  if(version<16)db.exec(`BEGIN; ALTER TABLE posts ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 1 CHECK(edit_version>0); ALTER TABLE posts ADD COLUMN edited_at INTEGER; ALTER TABLE posts ADD COLUMN edit_client_id TEXT; PRAGMA user_version=16; COMMIT;`);
  if(version<17)db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE polls(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,ends_at INTEGER NOT NULL,duration_hours INTEGER NOT NULL CHECK(duration_hours BETWEEN 1 AND 168),UNIQUE(post_id,club_id)) STRICT;
    CREATE TABLE poll_options(post_id INTEGER NOT NULL REFERENCES polls(post_id) ON DELETE CASCADE,option_id INTEGER NOT NULL CHECK(option_id BETWEEN 0 AND 5),label TEXT NOT NULL,PRIMARY KEY(post_id,option_id)) STRICT;
    CREATE TABLE poll_votes(post_id INTEGER NOT NULL,user_id TEXT NOT NULL,club_id TEXT NOT NULL,option_id INTEGER NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(post_id,user_id),FOREIGN KEY(post_id,club_id) REFERENCES polls(post_id,club_id) ON DELETE CASCADE,
      FOREIGN KEY(post_id,option_id) REFERENCES poll_options(post_id,option_id) ON DELETE CASCADE,
      FOREIGN KEY(club_id,user_id) REFERENCES memberships(club_id,user_id) ON DELETE CASCADE) STRICT;
    CREATE INDEX poll_votes_option ON poll_votes(post_id,option_id);
    PRAGMA user_version=17; COMMIT;`);
  if(version<18)db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE guides(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,topic TEXT NOT NULL CHECK(topic IN ('champion','build','macro','roles','beginner')),champion TEXT NOT NULL DEFAULT '',game_version TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '') STRICT;
    CREATE INDEX guides_topic ON guides(topic,post_id);CREATE INDEX guides_version ON guides(game_version,post_id);
    PRAGMA user_version=18;COMMIT;`);
  if (version < 19) db.exec(`BEGIN;
    CREATE TABLE recovery_codes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id,hash)
    ) STRICT;
    PRAGMA user_version=19; COMMIT;`);

  if (version < 20) {
    // Rebuild the CHECK constraint, preserving report IDs and all child records.
    db.exec('PRAGMA foreign_keys=OFF;');
    try {
      transaction(db,()=>{
        const sequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='reports'").get()?.seq||0;
        db.exec(`CREATE TABLE reports_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL REFERENCES users(id),
          kind TEXT NOT NULL CHECK(kind IN ('direct','club','post','comment','profile')),
          message_id INTEGER, target_id TEXT NOT NULL,
          sender_id TEXT NOT NULL REFERENCES users(id), snapshot TEXT NOT NULL, reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),
          decision_note TEXT NOT NULL DEFAULT '', moderator_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
          decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1)),
          UNIQUE(reporter_id,kind,target_id)
        ) STRICT;
        INSERT INTO reports_next SELECT id,reporter_id,kind,message_id,CAST(message_id AS TEXT),sender_id,snapshot,reason,status,decision_note,moderator_id,created_at,decision_seen FROM reports;
        DROP TABLE reports;
        ALTER TABLE reports_next RENAME TO reports;
        CREATE INDEX reports_reporter ON reports(reporter_id,status,decision_seen);
        CREATE INDEX direct_messages_unread ON direct_messages(conversation_id,id,sender_id);
        CREATE TABLE moderation_actions (
          report_id INTEGER PRIMARY KEY REFERENCES reports(id), actor_id TEXT NOT NULL REFERENCES users(id),
          action TEXT NOT NULL CHECK(action IN ('remove-post','remove-comment','hide-profile')),
          note TEXT NOT NULL, created_at INTEGER NOT NULL
        ) STRICT;
        PRAGMA user_version=20;`);
        db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='reports'").run(sequence);
        db.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'reports',? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='reports')").run(sequence);
        if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Report migration integrity check failed.');
      });
    } catch(error) {db.close();throw error;}
    finally {if(db.isOpen)db.exec('PRAGMA foreign_keys=ON;');}
  }
  if (version < 21) {
    // Widen the report kinds (group announcement, event, club page); same rebuild as 19→20.
    db.exec('PRAGMA foreign_keys=OFF;');
    try {
      transaction(db,()=>{
        const sequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='reports'").get()?.seq||0;
        db.exec(`CREATE TABLE reports_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL REFERENCES users(id),
          kind TEXT NOT NULL CHECK(kind IN ('direct','club','post','comment','profile','lfg','event','club_page')),
          message_id INTEGER, target_id TEXT NOT NULL,
          sender_id TEXT NOT NULL REFERENCES users(id), snapshot TEXT NOT NULL, reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),
          decision_note TEXT NOT NULL DEFAULT '', moderator_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
          decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1)),
          UNIQUE(reporter_id,kind,target_id)
        ) STRICT;
        INSERT INTO reports_next SELECT id,reporter_id,kind,message_id,target_id,sender_id,snapshot,reason,status,decision_note,moderator_id,created_at,decision_seen FROM reports;
        DROP TABLE reports;
        ALTER TABLE reports_next RENAME TO reports;
        CREATE INDEX reports_reporter ON reports(reporter_id,status,decision_seen);
        PRAGMA user_version=21;`);
        db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='reports'").run(sequence);
        db.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'reports',? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='reports')").run(sequence);
        if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Report migration integrity check failed.');
      });
    } catch(error) {db.close();throw error;}
    finally {if(db.isOpen)db.exec('PRAGMA foreign_keys=ON;');}
  }
  if (version < 22) {
    // Removal actions for clubs, groups, events and club chat messages; table rebuild keeps all rows.
    db.exec('PRAGMA foreign_keys=OFF;');
    try {
      transaction(db,()=>{
        db.exec(`CREATE TABLE moderation_actions_next (
          report_id INTEGER PRIMARY KEY REFERENCES reports(id), actor_id TEXT NOT NULL REFERENCES users(id),
          action TEXT NOT NULL CHECK(action IN ('remove-post','remove-comment','hide-profile','remove-club','close-group','cancel-event','remove-chat-message')),
          note TEXT NOT NULL, created_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO moderation_actions_next SELECT report_id,actor_id,action,note,created_at FROM moderation_actions;
        DROP TABLE moderation_actions;
        ALTER TABLE moderation_actions_next RENAME TO moderation_actions;
        PRAGMA user_version=22;`);
        if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Moderation action migration integrity check failed.');
      });
    } catch(error) {db.close();throw error;}
    finally {if(db.isOpen)db.exec('PRAGMA foreign_keys=ON;');}
  }
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
