CREATE TABLE users (
      id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '', password TEXT NOT NULL, created_at INTEGER NOT NULL
    , dm_requests INTEGER NOT NULL DEFAULT 1 CHECK(dm_requests IN (0,1)), block_version INTEGER NOT NULL DEFAULT 0, game_profile TEXT NOT NULL DEFAULT '{}', profile_visible INTEGER NOT NULL DEFAULT 0 CHECK(profile_visible IN (0,1)), avatar_id TEXT REFERENCES media(id), cover_id TEXT REFERENCES media(id)) STRICT;
CREATE TABLE sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
CREATE TABLE clubs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, description TEXT NOT NULL,
      access TEXT NOT NULL CHECK(access IN ('open','request')), created_at INTEGER NOT NULL
    , cover_id TEXT REFERENCES media(id), rules TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', accent TEXT NOT NULL DEFAULT 'azure' CHECK(accent IN ('azure','emerald','violet','coral')), settings_version INTEGER NOT NULL DEFAULT 0) STRICT;
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
    , image_id TEXT REFERENCES media(id), client_id TEXT) STRICT;
CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
    , client_id TEXT, parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE) STRICT;
CREATE TABLE audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES users(id),
      club_id TEXT NOT NULL REFERENCES clubs(id), target_id TEXT NOT NULL,
      action TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(club_id,sender_id,client_id)
    ) STRICT;
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
CREATE TABLE blocks (blocker_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(blocker_id,target_id), CHECK(blocker_id<>target_id)) STRICT;
CREATE TABLE direct_reads (
      conversation_id TEXT NOT NULL REFERENCES direct_conversations(id),
      user_id TEXT NOT NULL REFERENCES users(id), last_id INTEGER NOT NULL CHECK(last_id>=0),
      PRIMARY KEY(conversation_id,user_id)
    ) STRICT;
CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('direct','club')), message_id INTEGER NOT NULL,
      sender_id TEXT NOT NULL REFERENCES users(id), snapshot TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),
      decision_note TEXT NOT NULL DEFAULT '', moderator_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL, decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1)),
      UNIQUE(reporter_id,kind,message_id)
    ) STRICT;
CREATE TABLE moderation_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,report_id INTEGER NOT NULL REFERENCES reports(id),
      actor_id TEXT NOT NULL REFERENCES users(id),decision TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL, stage TEXT NOT NULL DEFAULT 'initial' CHECK(stage IN ('initial','appeal'))) STRICT;
CREATE TABLE report_appeals (
      report_id INTEGER PRIMARY KEY REFERENCES reports(id), reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','dismissed')),
      note TEXT NOT NULL DEFAULT '', moderator_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL,
      decision_seen INTEGER NOT NULL DEFAULT 0 CHECK(decision_seen IN (0,1))
    ) STRICT;
CREATE TABLE lfg_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,create_signature TEXT NOT NULL,
      title TEXT NOT NULL,mode TEXT NOT NULL,region TEXT NOT NULL,language TEXT NOT NULL,role TEXT NOT NULL,rank TEXT NOT NULL,voice TEXT NOT NULL,description TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 5),starts_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),UNIQUE(owner_id,client_id)
    ) STRICT;
CREATE TABLE lfg_members(group_id INTEGER NOT NULL REFERENCES lfg_groups(id),user_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')),PRIMARY KEY(group_id,user_id)) STRICT;
CREATE TABLE lfg_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,group_id INTEGER NOT NULL REFERENCES lfg_groups(id),sender_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(group_id,sender_id,client_id)) STRICT;
CREATE TABLE lfg_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),group_id INTEGER NOT NULL REFERENCES lfg_groups(id),kind TEXT NOT NULL CHECK(kind IN ('application','accepted','rejected','removed','cancelled','left','closed')),created_at INTEGER NOT NULL,seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))) STRICT;
CREATE TABLE media (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
      signature TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      size INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(owner_id,client_id)
    ) STRICT;
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
CREATE TABLE discussion_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('mention','reply')),created_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))
    ) STRICT;
CREATE TABLE club_moderators(club_id TEXT NOT NULL,user_id TEXT NOT NULL,
      PRIMARY KEY(club_id,user_id),FOREIGN KEY(club_id,user_id) REFERENCES memberships(club_id,user_id) ON DELETE CASCADE) STRICT;
CREATE TABLE club_pins(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      club_id TEXT NOT NULL REFERENCES clubs(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL) STRICT;
CREATE TABLE club_invites(id TEXT PRIMARY KEY,club_id TEXT NOT NULL REFERENCES clubs(id),creator_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 50),
      uses INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),UNIQUE(club_id,creator_id,client_id)) STRICT;
CREATE TABLE club_invite_uses(invite_id TEXT NOT NULL REFERENCES club_invites(id),user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,PRIMARY KEY(invite_id,user_id)) STRICT;
CREATE TABLE club_transfers(id TEXT PRIMARY KEY,club_id TEXT NOT NULL REFERENCES clubs(id),owner_id TEXT NOT NULL REFERENCES users(id),
      target_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','cancelled')),UNIQUE(club_id,owner_id,client_id)) STRICT;
CREATE TABLE game_events(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,signature TEXT NOT NULL,
      title TEXT NOT NULL,description TEXT NOT NULL,mode TEXT NOT NULL,region TEXT NOT NULL,language TEXT NOT NULL,
      timezone TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),UNIQUE(owner_id,client_id)) STRICT;
CREATE TABLE event_slots(event_id INTEGER NOT NULL REFERENCES game_events(id),role TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),PRIMARY KEY(event_id,role),UNIQUE(event_id,user_id)) STRICT;
CREATE TABLE event_exclusions(event_id INTEGER NOT NULL REFERENCES game_events(id),user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(event_id,user_id)) STRICT;
CREATE TABLE event_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL REFERENCES game_events(id),sender_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(event_id,sender_id,client_id)) STRICT;
CREATE TABLE event_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),event_id INTEGER NOT NULL REFERENCES game_events(id),
      kind TEXT NOT NULL CHECK(kind IN ('joined','left','removed','cancelled','reminder')),created_at INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1))) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX posts_club ON posts(club_id,id);
CREATE INDEX comments_post ON comments(post_id,id);
CREATE INDEX messages_club ON messages(club_id,id);
CREATE INDEX direct_history ON direct_messages(conversation_id,id);
CREATE INDEX lfg_members_user ON lfg_members(user_id,group_id);
CREATE INDEX lfg_messages_group ON lfg_messages(group_id,id);
CREATE INDEX lfg_notifications_user ON lfg_notifications(user_id,seen,id);
CREATE INDEX media_owner ON media(owner_id);
CREATE UNIQUE INDEX posts_attempt ON posts(club_id,author_id,client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX comments_attempt ON comments(post_id,author_id,client_id) WHERE client_id IS NOT NULL;
CREATE INDEX saved_posts_user ON saved_posts(user_id,post_id);
CREATE UNIQUE INDEX discussion_notification_event ON discussion_notifications(user_id,post_id,COALESCE(comment_id,0));
CREATE INDEX discussion_notifications_user ON discussion_notifications(user_id,seen,id);
CREATE INDEX club_pins_club ON club_pins(club_id,created_at,post_id);
CREATE UNIQUE INDEX club_transfer_pending ON club_transfers(club_id) WHERE status='pending';
CREATE INDEX game_events_start ON game_events(starts_at,id);
CREATE INDEX event_messages_history ON event_messages(event_id,id);
CREATE UNIQUE INDEX event_reminder_unique ON event_notifications(user_id,event_id) WHERE kind='reminder';
CREATE INDEX event_notifications_user ON event_notifications(user_id,seen,id);
PRAGMA user_version=14;

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
ALTER TABLE posts ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 1 CHECK(edit_version>0);ALTER TABLE posts ADD COLUMN edited_at INTEGER;ALTER TABLE posts ADD COLUMN edit_client_id TEXT;PRAGMA user_version=16;

    CREATE TABLE polls(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,ends_at INTEGER NOT NULL,duration_hours INTEGER NOT NULL CHECK(duration_hours BETWEEN 1 AND 168),UNIQUE(post_id,club_id)) STRICT;
    CREATE TABLE poll_options(post_id INTEGER NOT NULL REFERENCES polls(post_id) ON DELETE CASCADE,option_id INTEGER NOT NULL CHECK(option_id BETWEEN 0 AND 5),label TEXT NOT NULL,PRIMARY KEY(post_id,option_id)) STRICT;
    CREATE TABLE poll_votes(post_id INTEGER NOT NULL,user_id TEXT NOT NULL,club_id TEXT NOT NULL,option_id INTEGER NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(post_id,user_id),FOREIGN KEY(post_id,club_id) REFERENCES polls(post_id,club_id) ON DELETE CASCADE,
      FOREIGN KEY(post_id,option_id) REFERENCES poll_options(post_id,option_id) ON DELETE CASCADE,
      FOREIGN KEY(club_id,user_id) REFERENCES memberships(club_id,user_id) ON DELETE CASCADE) STRICT;
    CREATE INDEX poll_votes_option ON poll_votes(post_id,option_id);
PRAGMA user_version=17;

CREATE TABLE guides(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,topic TEXT NOT NULL CHECK(topic IN ('champion','build','macro','roles','beginner')),champion TEXT NOT NULL DEFAULT '',game_version TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '') STRICT;
CREATE INDEX guides_topic ON guides(topic,post_id);
CREATE INDEX guides_version ON guides(game_version,post_id);
PRAGMA user_version=18;
