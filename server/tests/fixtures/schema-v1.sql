BEGIN;
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
    COMMIT;
