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
PRAGMA user_version=13;
