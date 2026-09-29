import { directRoutes } from './direct.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase, transaction } from './database.mjs';
import { token, digest, passwordHash, passwordMatches, fail, HttpError, text, passwordValue, jsonBody } from './security.mjs';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/direct.js', ['direct.js', 'text/javascript; charset=utf-8']],
  ['/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
export async function createApp({ databasePath = ':memory:', now = Date.now, authLimit = 20 } = {}) {
  const db = openDatabase(databasePath);
  const dummyPassword = await passwordHash(token());
  const counters = new Map(); let activeAuth = 0;
  const sql = (query, ...params) => db.prepare(query).get(...params);
  const run = (query, ...params) => db.prepare(query).run(...params);
  const rows = (query, ...params) => db.prepare(query).all(...params);
  const safeUser = user => ({ id: user.id, handle: user.handle, name: user.name, bio: user.bio, dmRequests: user.dm_requests !== 0 });
  function rate(key, limit, windowMs = 60000) {
    const time = now();
    for (const [k, v] of counters) if (v.until <= time) counters.delete(k);
    const entry = counters.get(key) || { count: 0, until: time + windowMs };
    if (entry.count >= limit) fail(429, 'Слишком много запросов. Подожди минуту.');
    entry.count++; counters.set(key, entry);
  }
  function session(req) {
    const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('wr_session='))?.slice(11);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    return sql(`SELECT users.*, sessions.hash AS session_hash, sessions.csrf, sessions.expires_at
      FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND expires_at>?`, digest(raw), now());
  }
  function signed(user) { if (!user) fail(401, 'Сначала войди в аккаунт.'); return user; }
  function clubFor(id, user, write = false) {
    const club = sql('SELECT * FROM clubs WHERE id=?', id);
    if (!club) fail(404, 'Клуб не найден.');
    const membership = user ? sql('SELECT status FROM memberships WHERE club_id=? AND user_id=?', id, user.id) : null;
    if (membership?.status === 'banned' || ((write || club.access === 'request') && membership?.status !== 'member')) fail(403, 'Нет доступа к содержимому клуба.');
    return club;
  }
  function ownerFor(id, user) {
    signed(user);
    const club = sql('SELECT * FROM clubs WHERE id=?', id);
    if (!club || club.owner_id !== user.id) fail(403, 'Действие доступно владельцу клуба.');
    return club;
  }
  function postFor(id, user, write = false) {
    const post = sql('SELECT * FROM posts WHERE id=?', id);
    if (!post) fail(404, 'Публикация недоступна.');
    clubFor(post.club_id, user, write); return post;
  }
  function newSession(user, previous, res) {
    const raw = token(), csrf = token();
    transaction(db, () => {
      run('DELETE FROM sessions WHERE expires_at<=?', now());
      if (previous) run('DELETE FROM sessions WHERE hash=?', previous.session_hash);
      run('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES(?,?,?,?)', digest(raw), user.id, csrf, now() + SESSION_MS);
    });
    res.setHeader('Set-Cookie', `wr_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    return { user: safeUser(user), csrf };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) fail(403, 'Недопустимый адрес сервера. Используй 127.0.0.1.');
      const url = new URL(req.url, `http://${expectedHost}`);
      const path = url.pathname, method = req.method;
      if (!path.startsWith('/api/')) {
        const asset = assets.get(path);
        if (method !== 'GET' || !asset) fail(404, 'Страница не найдена.');
        res.writeHead(200, { 'Content-Type': asset[1] });
        res.end(readFileSync(new URL(`./public/${asset[0]}`, import.meta.url))); return;
      }
      const user = session(req);
      let body = {};
      if (method !== 'GET') {
        if (req.headers.origin !== `http://${expectedHost}` || req.headers['x-community-request'] !== '1') fail(403, 'Запрос с другого источника отклонён.');
        if (!['/api/register', '/api/login'].includes(path)) {
          signed(user);
          if (req.headers['x-csrf-token'] !== user.csrf) fail(403, 'Сеанс изменился. Обнови страницу.');
          rate(`write:${user.id}`, 120);
        }
        body = await jsonBody(req);
      }
      if (method === 'GET' && path === '/api/me') { send(200, { user: user ? safeUser(user) : null, csrf: user?.csrf || null }); return; }
      if (method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        rate(`auth:${req.socket.remoteAddress}`, authLimit);
        if (activeAuth >= 4) fail(429, 'Сервер занят. Повтори чуть позже.');
        const handle = text(body.handle, 'Логин', 3, 24).toLowerCase();
        if (!/^[a-z0-9_]+$/.test(handle)) fail(422, 'Логин: латиница, цифры и подчёркивание.');
        const password = passwordValue(body.password);
        activeAuth++;
        try {
          let account;
          if (path === '/api/register') {
            const name = text(body.name, 'Имя', 1, 40);
            const hash = await passwordHash(password);
            // Recheck after asynchronous hashing to handle concurrent registrations.
            if (sql('SELECT id FROM users WHERE handle=?', handle)) fail(409, 'Этот логин недоступен.');
            account = { id: randomUUID(), handle, name, bio: '' };
            run('INSERT INTO users(id,handle,name,password,created_at) VALUES(?,?,?,?,?)', account.id, handle, name, hash, now());
          } else {
            account = sql('SELECT * FROM users WHERE handle=?', handle);
            const valid = await passwordMatches(password, account?.password || dummyPassword);
            if (!valid || !account) fail(401, 'Неверный логин или пароль.');
          }
          send(path === '/api/register' ? 201 : 200, newSession(account, user, res));
        } finally { activeAuth--; }
        return;
      }
      if (method === 'POST' && ['/api/logout', '/api/logout-all'].includes(path)) {
        if (path === '/api/logout-all') run('DELETE FROM sessions WHERE user_id=?', user.id);
        else run('DELETE FROM sessions WHERE hash=?', user.session_hash);
        res.setHeader('Set-Cookie', 'wr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); send(200, { ok: true }); return;
      }
      if (method === 'PATCH' && path === '/api/me') {
        run('UPDATE users SET name=?,bio=? WHERE id=?', text(body.name, 'Имя', 1, 40), text(body.bio, 'Описание', 0, 300), user.id);
        send(200, { user: safeUser(sql('SELECT * FROM users WHERE id=?', user.id)) }); return;
      }
      if (directRoutes({ db, user, path, method, body, url, send, now })) return;
      if (method === 'GET' && path === '/api/clubs') {
        send(200, { clubs: rows(`SELECT c.*, m.status AS membership,
          (SELECT count(*) FROM memberships WHERE club_id=c.id AND status='member') AS members
          FROM clubs c LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 100`, user?.id || '') }); return;
      }
      if (method === 'POST' && path === '/api/clubs') {
        const name = text(body.name, 'Название', 2, 80), description = text(body.description, 'Описание', 0, 1000);
        if (!['open', 'request'].includes(body.access)) fail(422, 'Выбери тип доступа.');
        const id = randomUUID();
        transaction(db, () => {
          run('INSERT INTO clubs VALUES(?,?,?,?,?,?)', id, user.id, name, description, body.access, now());
          run('INSERT INTO memberships VALUES(?,?,?)', id, user.id, 'member');
        });
        send(201, { id }); return;
      }
      const messageRoute = path.match(/^\/api\/clubs\/([\w-]+)\/messages$/);
      if (messageRoute) {
        const clubId = messageRoute[1];
        signed(user);
        // Chats require membership even when the club's posts are public.
        clubFor(clubId, user, true);
        if (method === 'GET') {
          const before = url.searchParams.get('before'), after = url.searchParams.get('after');
          if (before !== null && after !== null) fail(422, 'Укажи только один курсор.');
          const cursor = before ?? after;
          if (cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) fail(422, 'Некорректный курсор.');
          const newer = after !== null;
          const result = rows(`SELECT m.id,m.club_id,m.sender_id,m.client_id,m.body,m.created_at,u.name AS sender_name
            FROM messages m JOIN users u ON u.id=m.sender_id
            WHERE m.club_id=? AND m.id${newer ? '>' : '<'}?
            ORDER BY m.id ${newer ? 'ASC' : 'DESC'} LIMIT 51`, clubId, Number(cursor ?? Number.MAX_SAFE_INTEGER));
          const hasMore = result.length > 50;
          const messages = result.slice(0, 50);
          if (!newer) messages.reverse();
          send(200, { viewerId: user.id, messages, hasMore, next: hasMore ? (newer ? messages.at(-1).id : messages[0].id) : null }); return;
        }
        if (method === 'POST') {
          const clientId = text(body.clientId, 'Идентификатор сообщения', 16, 80);
          if (!/^[A-Za-z0-9_-]+$/.test(clientId)) fail(422, 'Некорректный идентификатор сообщения.');
          const messageBody = text(body.body, 'Сообщение', 1, 2000);
          const result = transaction(db, () => {
            const existing = sql('SELECT id,body FROM messages WHERE club_id=? AND sender_id=? AND client_id=?', clubId, user.id, clientId);
            if (existing) {
              if (existing.body !== messageBody) fail(409, 'Этот идентификатор уже использован для другого текста.');
              return { id: existing.id, replayed: true };
            }
            const inserted = run('INSERT INTO messages(club_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)', clubId, user.id, clientId, messageBody, now());
            return { id: Number(inserted.lastInsertRowid), replayed: false };
          });
          const message = sql(`SELECT m.id,m.club_id,m.sender_id,m.client_id,m.body,m.created_at,u.name AS sender_name
            FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`, result.id);
          send(result.replayed ? 200 : 201, { message, replayed: result.replayed }); return;
        }
        fail(405, 'Метод не поддерживается.');
      }
      let match = path.match(/^\/api\/clubs\/([\w-]+)\/(join|leave|members|decision|ban|posts)$/);
      if (match) {
        const [, id, action] = match;
        if (method === 'POST' && action === 'join') {
          const club = sql('SELECT * FROM clubs WHERE id=?', id); if (!club) fail(404, 'Клуб не найден.');
          const old = sql('SELECT status FROM memberships WHERE club_id=? AND user_id=?', id, user.id);
          if (old?.status === 'banned') fail(403, 'Вступление в клуб ограничено.');
          const status = old?.status || (club.access === 'open' ? 'member' : 'pending');
          run('INSERT OR IGNORE INTO memberships VALUES(?,?,?)', id, user.id, status); send(200, { status }); return;
        }
        if (method === 'POST' && action === 'leave') {
          const club = sql('SELECT * FROM clubs WHERE id=?', id);
          if (club?.owner_id === user.id) fail(409, 'Владелец пока не может выйти: передача владения ещё не реализована.');
          // Leaving must not remove a ban.
          run("DELETE FROM memberships WHERE club_id=? AND user_id=? AND status!='banned'", id, user.id); send(200, { ok: true }); return;
        }
        if (method === 'GET' && action === 'members') {
          ownerFor(id, user); send(200, { members: rows('SELECT u.id,u.handle,u.name,m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=? ORDER BY u.handle', id) }); return;
        }
        if (method === 'POST' && ['decision', 'ban'].includes(action)) {
          const club = ownerFor(id, user); const target = text(body.userId, 'Участник', 1, 80);
          if (target === club.owner_id) fail(409, 'Нельзя изменить членство владельца.');
          const old = sql('SELECT status FROM memberships WHERE club_id=? AND user_id=?', id, target);
          if (!old) fail(404, 'Участник не найден.');
          if (action === 'decision' && (old.status !== 'pending' || !['approve', 'reject'].includes(body.decision))) fail(409, 'Нет подходящей заявки.');
          transaction(db, () => {
            if (action === 'ban') run("UPDATE memberships SET status='banned' WHERE club_id=? AND user_id=?", id, target);
            else if (body.decision === 'approve') run("UPDATE memberships SET status='member' WHERE club_id=? AND user_id=?", id, target);
            else run('DELETE FROM memberships WHERE club_id=? AND user_id=?', id, target);
            run('INSERT INTO audit(actor_id,club_id,target_id,action,created_at) VALUES(?,?,?,?,?)', user.id, id, target, action === 'ban' ? 'ban' : body.decision, now());
          }); send(200, { ok: true }); return;
        }
        if (action === 'posts') {
          clubFor(id, user, method !== 'GET');
          if (method === 'GET') {
            const before = url.searchParams.get('before') || String(Number.MAX_SAFE_INTEGER);
            if (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before))) fail(422, 'Некорректный курсор.');
            const result = rows(`SELECT p.*,u.name AS author_name FROM posts p JOIN users u ON u.id=p.author_id WHERE p.club_id=? AND p.id<? ORDER BY p.id DESC LIMIT 21`, id, Number(before));
            const more = result.length > 20; const posts = result.slice(0, 20);
            send(200, { posts, next: more ? posts.at(-1).id : null }); return;
          }
          if (method === 'POST') {
            const result = run('INSERT INTO posts(club_id,author_id,title,body,created_at) VALUES(?,?,?,?,?)', id, user.id, text(body.title, 'Заголовок', 1, 100), text(body.body, 'Текст', 1, 4000), now());
            send(201, { id: Number(result.lastInsertRowid) }); return;
          }
        }
      }
      match = path.match(/^\/api\/posts\/(\d+)(\/comments)?$/);
      if (match) {
        const id = Number(match[1]); if (!Number.isSafeInteger(id)) fail(404, 'Публикация недоступна.');
        const post = postFor(id, user, method !== 'GET');
        if (match[2] && method === 'GET') { send(200, { comments: rows('SELECT c.id,c.body,c.created_at,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? ORDER BY c.id DESC LIMIT 100', id).reverse() }); return; }
        if (match[2] && method === 'POST') { const r = run('INSERT INTO comments(post_id,author_id,body,created_at) VALUES(?,?,?,?)', id, user.id, text(body.body, 'Комментарий', 1, 1000), now()); send(201, { id: Number(r.lastInsertRowid) }); return; }
        if (!match[2] && method === 'GET') { send(200, { post }); return; }
        if (!match[2] && method === 'DELETE') {
          if (post.author_id !== user.id) fail(403, 'Удалить публикацию может только автор.');
          run('DELETE FROM posts WHERE id=?', id); send(200, { ok: true }); return;
        }
      }
      fail(404, 'Маршрут не найден.');
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof HttpError) send(error.status, { error: error.message });
      else { console.error('Request failed:', error.code || error.name); send(500, { error: 'Ошибка сервера. Повтори запрос позже.' }); }
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return {
    async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return `http://127.0.0.1:${server.address().port}`; },
    async close() { if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); db.close(); }
  };
}
