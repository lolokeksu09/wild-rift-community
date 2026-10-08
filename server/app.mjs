import { replaceCodes, consumeCode } from './recovery.mjs';
import {catalogRoutes} from './catalog.mjs';
import {pageMetadata,pageHTML,sitemap} from './pages.mjs';
import {contactPolicy} from './contact-budget.mjs';
import {sanctionFor,restrictedWrite,sanctionDate} from './sanctions.mjs';
import {guideRoutes} from './guides.mjs';
import {pollRoutes} from './polls.mjs';
import {postManagementRoutes} from './post-management.mjs';
import {draftRoutes} from './drafts.mjs';
import {homeRoutes} from './home.mjs';
import {previewRoutes} from './preview.mjs';
import {communityMemberRoutes} from './community-members.mjs';
import {isDemo} from './demo.mjs';
import {eventRoutes} from './events.mjs';
import {clubRoutes,clubRole,audit as clubAudit} from './clubs.mjs';
import { discussionRoutes, postExtras, attemptId, mentions, unblocked, staffOf } from './discussions.mjs';
import { playerRoutes, fold } from './players.mjs';
import { profileFields, profileView } from './profiles.mjs';
import { readImage, encodeImage, saveImage, ownedImage, imageAttached } from './media.mjs';
import { lfgRoutes } from './lfg.mjs';
import { moderationRoutes } from './moderation.mjs';
import { directRoutes } from './direct.mjs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { openDatabase, transaction } from './database.mjs';
import { token, digest, passwordHash, passwordMatches, fail, HttpError, text, passwordValue, jsonBody } from './security.mjs';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const assets = new Map([
  ['/role-icons-mask.svg',['role-icons-mask.svg','image/svg+xml']],
  ['/role-icons.jpg',['role-icons.jpg','image/jpeg']],
  ['/favicon.svg',['favicon.svg','image/svg+xml']],
  ['/post-management.js',['post-management.js','text/javascript; charset=utf-8']],
  ['/polls.js',['polls.js','text/javascript; charset=utf-8']],
  ['/guides.js',['guides.js','text/javascript; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/composer.js', ['composer.js','text/javascript; charset=utf-8']],
  ['/community.css', ['community.css', 'text/css; charset=utf-8']],
  ['/launch.css', ['launch.css', 'text/css; charset=utf-8']],
  ['/premium.css', ['premium.css', 'text/css; charset=utf-8']],
  ['/community-cover.webp', ['community-cover.webp', 'image/webp']],
  ['/profile-cover.webp', ['profile-cover.webp', 'image/webp']],
  ['/events-cover.webp', ['events-cover.webp', 'image/webp']],
  ['/editorial.css', ['editorial.css', 'text/css; charset=utf-8']],
  ['/events.js', ['events.js','text/javascript; charset=utf-8']],
  ['/clubs.js', ['clubs.js','text/javascript; charset=utf-8']],
  ['/discussions.js', ['discussions.js', 'text/javascript; charset=utf-8']],
  ['/players.js', ['players.js', 'text/javascript; charset=utf-8']],
  ['/profiles.js', ['profiles.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/lfg.js', ['lfg.js', 'text/javascript; charset=utf-8']],
  ['/direct.js', ['direct.js', 'text/javascript; charset=utf-8']],
  ['/chat.js', ['chat.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
export async function createApp({ databasePath = ':memory:', now = Date.now, authLimit = 20, moderatorIds = [], publicOrigin = null, listenHost = '127.0.0.1', proxyClientHeader = false, directContactPolicy = {} } = {}) {
  const contactLimits=contactPolicy(directContactPolicy);
  const publicAssets=new Map([...assets].map(([path,[file,type]])=>{
    const bytes=readFileSync(new URL(`./public/${file}`,import.meta.url));
    return [path,{bytes,type,hash:createHash('sha256').update(bytes).digest('hex').slice(0,20)}];
  }));
  const index=publicAssets.get('/');
  index.bytes=Buffer.from(index.bytes.toString('utf8').replace(/(href|src)="(\/[\w-]+\.(?:css|js))"/g,(_all,attr,path)=>`${attr}="${path}?v=${publicAssets.get(path).hash}"`));
  if (publicOrigin !== null) {
    const origin = new URL(publicOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin without a path.');
  }
  if (!['127.0.0.1', '0.0.0.0'].includes(listenHost) || (listenHost !== '127.0.0.1' && !publicOrigin)) throw new Error('External listening requires PUBLIC_ORIGIN.');
  const secureCookie = publicOrigin ? '; Secure' : '';
  moderatorIds = [...moderatorIds];
  const db = openDatabase(databasePath);
  db.function('wr_fold',{deterministic:true},fold);
  db.function('wr_session_ref',{deterministic:true},(userId,hash)=>digest('wr-session:'+userId+':'+hash));
  const dummyPassword = await passwordHash(token());
  const counters = new Map(); let activeAuth = 0, activeUploads = 0;
  const sql = (query, ...params) => db.prepare(query).get(...params);
  const run = (query, ...params) => db.prepare(query).run(...params);
  const rows = (query, ...params) => db.prepare(query).all(...params);
  const safeUser = user => ({ ...profileView(user,true), isModerator: moderatorIds.includes(user.id), dmRequests: user.dm_requests !== 0 });
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
  // Read limits key on the proxy-supplied address; auth routes reject a missing one separately.
  const readerKey = (req, user) => user ? 'user:' + user.id : 'ip:' + (proxyClientHeader ? (isIP(req.headers['x-wr-client-ip'] || '') ? req.headers['x-wr-client-ip'] : 'unknown') : req.socket.remoteAddress);
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
  // ignoreBlocks: reports and club staff actions. An author's block does not hide a post from its club staff for reading.
  function postFor(id, user, write = false, ignoreBlocks = false) {
    const post = sql('SELECT * FROM posts WHERE id=?', id);
    if (!post) fail(404, 'Публикация недоступна.');
    clubFor(post.club_id, user, write);
    if(user && !ignoreBlocks && (sql('SELECT 1 FROM blocks WHERE blocker_id=? AND target_id=?',user.id,post.author_id)
      || (sql('SELECT 1 FROM blocks WHERE blocker_id=? AND target_id=?',post.author_id,user.id) && (write || !staffOf(db,post.club_id,user.id)))))fail(404,'Публикация недоступна.');
    return post;
  }
  function newSession(user, previous, res,mutate=()=>{}) {
    const raw = token(), csrf = token();
    transaction(db, () => {
      mutate();
      run('DELETE FROM sessions WHERE expires_at<=?', now());
      if (previous) run('DELETE FROM sessions WHERE hash=?', previous.session_hash);
      run('INSERT INTO sessions(hash,user_id,csrf,expires_at) VALUES(?,?,?,?)', digest(raw), user.id, csrf, now() + SESSION_MS);
    });
    res.setHeader('Set-Cookie', `wr_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureCookie}`);
    return { user: safeUser(user), csrf };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, data) => { if(status===429&&Number.isSafeInteger(data.retryAfterSeconds)&&data.retryAfterSeconds>0)res.setHeader('Retry-After',String(data.retryAfterSeconds));res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const expectedOrigin = publicOrigin || `http://127.0.0.1:${server.address().port}`;
      const expectedHost = new URL(expectedOrigin).host;
      if (req.headers.host !== expectedHost) fail(403, 'Недопустимый адрес сервера.');
      const url = new URL(req.url, expectedOrigin);
      const path = url.pathname, method = req.method;
      if (!path.startsWith('/api/')) {
        if(method==='GET'||method==='HEAD'){
          if(path==='/favicon.ico'){res.writeHead(308,{Location:'/favicon.svg'});res.end();return;}
          if(path==='/robots.txt'||path==='/sitemap.xml'){
            if(path==='/sitemap.xml')rate('sitemap:'+readerKey(req,null),10);
            const value=path==='/robots.txt'?`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account\nDisallow: /messages\nDisallow: /notifications\nDisallow: /reports\nDisallow: /saved\nDisallow: /drafts\nDisallow: /search\nSitemap: ${expectedOrigin}/sitemap.xml\n`:sitemap(db,expectedOrigin);
            res.writeHead(200,{'Content-Type':path==='/robots.txt'?'text/plain; charset=utf-8':'application/xml; charset=utf-8'});res.end(method==='HEAD'?undefined:value);return;
          }
        }
        const pageRoute=/^\/(?:feed|clubs(?:\/[\w-]{1,80})?|posts\/\d{1,16}|players(?:\/[\w-]{1,80})?|guides|teams|events|account|messages|notifications|reports|saved|drafts|search|rules)\/?$/.test(path);
        const asset = assets.get(path)||(pageRoute?assets.get('/'):null);
        if (!['GET','HEAD'].includes(method)) fail(404, 'Страница не найдена.');
        if(!asset){
          const meta=pageMetadata(db,path,session(req));
          res.setHeader('X-Robots-Tag','noindex, nofollow');res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});
          res.end(method==='HEAD'?undefined:pageHTML(index.bytes.toString('utf8'),meta,expectedOrigin));return;
        }
        const resource=publicAssets.get(assets.has(path)?path:'/');
        if(asset[0]==='index.html'){
          const meta=pageMetadata(db,path,session(req));
          if(!meta.index)res.setHeader('X-Robots-Tag','noindex, nofollow');
          res.writeHead(meta.status,{'Content-Type':resource.type});res.end(method==='HEAD'?undefined:pageHTML(resource.bytes.toString('utf8'),meta,expectedOrigin));return;
        }
        if(asset[0]!=='index.html'&&url.searchParams.get('v')===resource.hash)res.setHeader('Cache-Control','public, max-age=31536000, immutable');
        res.writeHead(200, { 'Content-Type': resource.type });
        res.end(method==='HEAD'?undefined:resource.bytes); return;
      }
      const user = session(req), sanction = user ? sanctionFor(db, user.id, now()) : null;
      if (sanction?.level === 'suspended') {
        // A suspension ends every session; the next login attempt explains why.
        run('DELETE FROM sessions WHERE user_id=?', user.id);
        res.setHeader('Set-Cookie', `wr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);
        if (method === 'GET' && path === '/api/me') { send(200, { user: null, csrf: null }); return; }
        fail(401, `Аккаунт приостановлен до ${sanctionDate(sanction.until)} за повторные нарушения правил.`);
      }
      const restricted = sanction?.level === 'restricted' ? `Публикации, сообщения и загрузки ограничены до ${sanctionDate(sanction.until)}: модераторы подтвердили повторные нарушения правил. Чтение, жалобы и выход из клубов доступны.` : null;
      // Search scans whole tables in a single-threaded server; bound it per account or guest address.
      if(method==='GET'&&(['/api/posts/search','/api/guides'].includes(path)||(['/api/clubs','/api/community-members','/api/players'].includes(path)&&url.searchParams.get('q'))))rate('search:'+readerKey(req,user),120);
      if(path==='/api/page-metadata'&&method==='GET'){
        const target=url.searchParams.get('path');
        if(!target||target.length>200||!target.startsWith('/')||target.startsWith('//'))fail(422,'Некорректный путь страницы.');
        const meta=pageMetadata(db,target,user);send(200,{...meta,url:expectedOrigin+meta.path});return;
      }
      let body = {};
      if (method !== 'GET') {
        if (req.headers.origin !== expectedOrigin || req.headers['x-community-request'] !== '1') fail(403, 'Запрос с другого источника отклонён.');
        if (!['/api/register', '/api/login', '/api/recover'].includes(path)) {
          signed(user);
          if (req.headers['x-csrf-token'] !== user.csrf) fail(403, 'Сеанс изменился. Обнови страницу.');
          rate(`write:${user.id}`, 120);
        }
        if (path === '/api/media' && method === 'POST') {
          if (restricted) fail(403, restricted);
          rate(`upload:${user.id}`,10);
          const clientId=req.headers['x-upload-id'];
          if(typeof clientId!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(clientId)) fail(422,'Некорректный идентификатор загрузки.');
          if(activeUploads>=2)fail(429,'Сервер обрабатывает изображения. Повтори чуть позже.');
          activeUploads++;
          try {
            const input=await readImage(req),encoded=await encodeImage(input,req.headers['content-type']);
            const current=session(req);signed(current);
            if(current.id!==user.id||current.csrf!==user.csrf)fail(403,'Сеанс изменился.');
            const result=saveImage(db,current,clientId,input,encoded,now);
            send(result.replayed?200:201,result);
          } finally {activeUploads--;}
          return;
        }
        body = await jsonBody(req,/^\/api\/(?:clubs\/[\w-]+\/guides|posts\/\d+\/guide)$/.test(path)?65536:16384);
        // Body parsing yields; a recovery/logout may revoke this session meanwhile.
        if (!['/api/register', '/api/login', '/api/recover'].includes(path)) {
          const current = session(req);
          if (!current || current.id !== user.id || current.csrf !== user.csrf) fail(403, 'Сеанс изменился. Войди снова.');
        }
        if (restricted && restrictedWrite(method, path, body)) fail(403, restricted);
      }
      if (method === 'GET' && path === '/api/me') { send(200, { user: user ? safeUser(user) : null, csrf: user?.csrf || null, sanction }); return; }
      if(path==='/api/sessions'&&method==='GET'){
        signed(user);let cursor=null;const after=url.searchParams.get('after');
        if(after!==null){try{cursor=JSON.parse(Buffer.from(after,'base64url').toString('utf8'));}catch{fail(422,'Некорректный курсор.');}
          if(!Array.isArray(cursor)||cursor.length!==2||!Number.isSafeInteger(cursor[0])||!/^[a-f0-9]{64}$/.test(cursor[1]))fail(422,'Некорректный курсор.');}
        const list=rows(`SELECT hash,expires_at,wr_session_ref(user_id,hash) id FROM sessions WHERE user_id=? AND expires_at>?
          ${cursor?'AND (expires_at<? OR (expires_at=? AND wr_session_ref(user_id,hash)>?))':''}
          ORDER BY expires_at DESC,id ASC LIMIT 101`,user.id,now(),...(cursor?[cursor[0],cursor[0],cursor[1]]:[]));
        const sessions=list.slice(0,100).map(s=>({id:s.id,expiresAt:s.expires_at,current:s.hash===user.session_hash})),last=sessions.at(-1);
        send(200,{viewerId:user.id,sessions,next:list.length>100?Buffer.from(JSON.stringify([last.expiresAt,last.id])).toString('base64url'):null});return;
      }
      const sessionToRevoke=/^\/api\/sessions\/([a-f0-9]{64})$/.exec(path);
      if(sessionToRevoke&&method==='DELETE'){
        const target=sql('SELECT hash FROM sessions WHERE user_id=? AND expires_at>? AND wr_session_ref(user_id,hash)=?',user.id,now(),sessionToRevoke[1]);
        if(!target)fail(404,'Сеанс недоступен.');
        run('DELETE FROM sessions WHERE user_id=? AND hash=?',user.id,target.hash);
        const loggedOut=target.hash===user.session_hash;
        if(loggedOut)res.setHeader('Set-Cookie',`wr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`);
        send(200,{ok:true,loggedOut});return;
      }
      if(path==='/api/me/password'&&method==='POST'){
        rate(`password-change:${user.id}`,5);
        const oldPassword=passwordValue(body.currentPassword),newPassword=passwordValue(body.newPassword);
        if(oldPassword===newPassword)fail(422,'Новый пароль должен отличаться от текущего.');
        if(activeAuth>=4)fail(429,'Сервер занят. Повтори чуть позже.');activeAuth++;
        try{
          if(!await passwordMatches(oldPassword,user.password))fail(401,'Неверный текущий пароль.');
          const hash=await passwordHash(newPassword),current=session(req);
          if(!current||current.id!==user.id||current.csrf!==user.csrf||current.password!==user.password)fail(403,'Сеанс изменился. Войди снова.');
          const result=newSession(current,null,res,()=>{
            const fresh=session(req);
            if(!fresh||fresh.id!==user.id||fresh.csrf!==user.csrf||fresh.password!==user.password)fail(403,'Сеанс изменился. Войди снова.');
            if(run('UPDATE users SET password=? WHERE id=? AND password=?',hash,user.id,user.password).changes!==1)fail(403,'Пароль уже изменился. Войди снова.');
            run('DELETE FROM sessions WHERE user_id=?',user.id);run('DELETE FROM recovery_codes WHERE user_id=?',user.id);
          });send(200,{...result,recoveryCodesRevoked:true});
        }finally{activeAuth--;}
        return;
      }
      if (method === 'GET' && path === '/api/recovery-codes') {
        signed(user);
        send(200, { remaining: sql('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id=?', user.id).n }); return;
      }
      if (method === 'POST' && path === '/api/recovery-codes') {
        rate(`recovery-generate:${user.id}`, 5);
        if (activeAuth >= 4) fail(429, 'Сервер занят. Повтори чуть позже.');
        activeAuth++;
        try {
          const valid = await passwordMatches(passwordValue(body.password), user.password);
          const current = session(req);
          if (!valid) fail(401, 'Неверный пароль.');
          if (!current || current.id !== user.id || current.csrf !== user.csrf || current.password !== user.password) fail(403, 'Сеанс изменился. Войди снова.');
          send(200, { codes: replaceCodes(db, user.id, now()) });
        } finally { activeAuth--; }
        return;
      }
      if (method === 'POST' && path === '/api/recover') {
        const clientAddress = proxyClientHeader ? req.headers['x-wr-client-ip'] : req.socket.remoteAddress;
        if (proxyClientHeader && (typeof clientAddress !== 'string' || !isIP(clientAddress))) fail(403, 'Недопустимый адрес клиента.');
        rate(`auth:${clientAddress}`, authLimit);
        if (activeAuth >= 4) fail(429, 'Сервер занят. Повтори чуть позже.');
        const handle = text(body.handle, 'Логин', 3, 24).toLowerCase();
        if (!/^[a-z0-9_]+$/.test(handle)) fail(422, 'Логин: латиница, цифры и подчёркивание.');
        const password = passwordValue(body.password);
        activeAuth++;
        try {
          // Always hash the new password, including nonexistent accounts/invalid codes.
          const hash = await passwordHash(password);
          const account = sql('SELECT * FROM users WHERE handle=?', handle);
          if (!account) fail(401, 'Неверный логин или резервный код.');
          consumeCode(db, account.id, body.code, hash);
          send(200, { ok: true });
        } finally { activeAuth--; }
        return;
      }
      if (method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        const clientAddress = proxyClientHeader ? req.headers['x-wr-client-ip'] : req.socket.remoteAddress;
        if (proxyClientHeader && (typeof clientAddress !== 'string' || !isIP(clientAddress))) fail(403, 'Недопустимый адрес клиента.');
        rate(`auth:${clientAddress}`, authLimit);
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
            if (!valid || !account || isDemo(account) || sql('SELECT password FROM users WHERE id=?', account.id)?.password !== account.password) fail(401, 'Неверный логин или пароль.');
            const blocked = sanctionFor(db, account.id, now());
            if (blocked?.level === 'suspended') fail(403, `Аккаунт приостановлен до ${sanctionDate(blocked.until)} за повторные нарушения правил.`);
          }
          send(path === '/api/register' ? 201 : 200, newSession(account, user, res));
        } finally { activeAuth--; }
        return;
      }
      if (method === 'POST' && ['/api/logout', '/api/logout-all'].includes(path)) {
        if (path === '/api/logout-all') run('DELETE FROM sessions WHERE user_id=?', user.id);
        else run('DELETE FROM sessions WHERE hash=?', user.session_hash);
        res.setHeader('Set-Cookie', `wr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`); send(200, { ok: true }); return;
      }
      if (method === 'PATCH' && path === '/api/me') {
        if('profileVisible' in body && typeof body.profileVisible!=='boolean')fail(422,'Проверь видимость профиля.');
        if('gameProfile' in body && (!body.gameProfile || typeof body.gameProfile!=='object' || Array.isArray(body.gameProfile)))fail(422,'Проверь игровые поля.');
        const game=profileFields(body.gameProfile||{},JSON.parse(user.game_profile));
        const name=text(body.name??user.name,'Имя',1,40),bio=text(body.bio??user.bio,'Описание',0,300);
        const avatar='avatarId' in body && body.avatarId!==user.avatar_id?ownedImage(db,body.avatarId,user):user.avatar_id;
        const cover='coverId' in body && body.coverId!==user.cover_id?ownedImage(db,body.coverId,user):user.cover_id;
        if(avatar && avatar===cover)fail(409,'Для аватара и обложки нужны отдельные загрузки.');
        transaction(db,()=>{
          run('UPDATE users SET name=?,bio=?,game_profile=?,profile_visible=?,avatar_id=?,cover_id=? WHERE id=?',name,bio,JSON.stringify(game),'profileVisible' in body?Number(body.profileVisible):user.profile_visible,avatar,cover,user.id);
          for(const id of [user.avatar_id,user.cover_id])if(id && id!==avatar && id!==cover && !imageAttached(db,id))run('DELETE FROM media WHERE id=?',id);
        });
        send(200, { user: safeUser(sql('SELECT * FROM users WHERE id=?', user.id)) }); return;
      }
      const profileRoute=path.match(/^\/api\/profiles\/([\w-]+)$/);
      if(profileRoute && method==='GET') {
        const target=sql('SELECT * FROM users WHERE id=?',profileRoute[1]);
        if(!target || (target.id!==user?.id && (!target.profile_visible || (user && sql('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',user.id,target.id,target.id,user.id)))))fail(404,'Профиль недоступен.');
        send(200,{profile:profileView(target,target.id===user?.id)});return;
      }
      const mediaRoute=path.match(/^\/api\/media\/([\w-]+)$/);
      if(mediaRoute) {
        const id=mediaRoute[1],image=sql('SELECT id,owner_id FROM media WHERE id=?',id);
        if(!image)fail(404,'Изображение недоступно.');
        if(method==='DELETE') {
          if(image.owner_id!==user.id)fail(403,'Изображение недоступно.');
          if(imageAttached(db,id))fail(409,'Сначала убери изображение из профиля, клуба или публикации.');
          run('DELETE FROM media WHERE id=?',id);send(200,{ok:true});return;
        }
        if(method!=='GET')fail(405,'Метод не поддерживается.');
        const draft=sql('SELECT club_id,user_id FROM post_drafts WHERE image_id=?',id),post=sql('SELECT id FROM posts WHERE image_id=?',id),club=sql('SELECT id FROM clubs WHERE cover_id=?',id),profile=sql('SELECT id,profile_visible FROM users WHERE avatar_id=? OR cover_id=?',id,id);
        if(draft){if(draft.user_id!==user?.id)fail(404,'Изображение недоступно.');clubFor(draft.club_id,user,true);}
        else if(post)postFor(post.id,user);
        else if(club){if(user && sql("SELECT 1 FROM memberships WHERE club_id=? AND user_id=? AND status='banned'",club.id,user.id))fail(403,'Изображение недоступно.');}
        else if(profile){if(profile.id!==user?.id && (!profile.profile_visible || (user && sql('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)',user.id,profile.id,profile.id,user.id))))fail(404,'Изображение недоступно.');}
        else if(image.owner_id!==user?.id)fail(404,'Изображение недоступно.');
        res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        res.writeHead(200,{'Content-Type':'image/webp'});res.end(sql('SELECT bytes FROM media WHERE id=?',id).bytes);return;
      }
      const clubCoverRoute=path.match(/^\/api\/clubs\/([\w-]+)\/cover$/);
      if(clubCoverRoute && method==='PATCH') {
        const club=ownerFor(clubCoverRoute[1],user);
        const cover=body.coverId===club.cover_id?club.cover_id:ownedImage(db,body.coverId,user);
        transaction(db,()=>{if(cover!==club.cover_id)clubAudit(db,user,club.id,club.id,'cover',now);run('UPDATE clubs SET cover_id=? WHERE id=?',cover,club.id);if(club.cover_id && club.cover_id!==cover && !imageAttached(db,club.cover_id))run('DELETE FROM media WHERE id=?',club.cover_id);});
        send(200,{ok:true});return;
      }
      if(path==='/api/notifications/summary'&&method==='GET'){
        signed(user);
        const summaries={};
        for(const [key,route,handler] of [
          ['direct','/api/direct/summary',directRoutes],['reports','/api/reports/summary',moderationRoutes],
          ['lfg','/api/lfg/notifications/summary',lfgRoutes],['discussions','/api/discussions/notifications/summary',discussionRoutes],
          ['events','/api/events/notifications/summary',eventRoutes]
        ])handler({db,user,path:route,method,body,url,now,postFor,moderatorIds,send:(status,data)=>{if(status!==200)fail(status,'Не удалось обновить уведомления.');summaries[key]=data;}});
        send(200,{viewerId:user.id,...summaries});return;
      }
      if(guideRoutes({db,user,path,method,body,url,send,now,clubFor,postFor,mentions}))return;
      if(pollRoutes({db,user,path,method,body,send,now,clubFor,postFor,mentions}))return;
      if(postManagementRoutes({db,user,path,method,body,url,send,now,postFor,clubFor}))return;
      if (clubRoutes({db,user,path,method,body,url,send,now,clubFor,postFor})) return;
      if (discussionRoutes({db,user,path,method,body,url,send,now,postFor})) return;
      if (playerRoutes({db,user,path,method,url,send})) return;
      if (communityMemberRoutes({db,user,path,method,url,send})) return;
      if (draftRoutes({db,user,path,method,body,send,now,clubFor})) return;
      if (homeRoutes({db,user,path,method,send,now})) return;
      if (previewRoutes({db,user,path,method,send,now})) return;
      if (eventRoutes({db,user,path,method,body,url,send,now})) return;
      if (lfgRoutes({db,user,path,method,body,url,send,now})) return;
      if (moderationRoutes({db,user,path,method,body,url,send,now,moderatorIds,postFor})) return;
      if (directRoutes({ db, user, path, method, body, url, send, now,contactLimits })) return;
      if (method === 'GET' && path === '/api/feed') {
        const before = url.searchParams.get('before') || String(Number.MAX_SAFE_INTEGER);
        if (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before))) fail(422, 'Некорректный курсор.');
        const result = rows(`SELECT p.*,u.name AS author_name,CASE WHEN u.profile_visible=1 THEN u.avatar_id ELSE NULL END AS author_avatar_id,c.name AS club_name FROM posts p
          JOIN users u ON u.id=p.author_id JOIN clubs c ON c.id=p.club_id
          LEFT JOIN memberships m ON m.club_id=c.id AND m.user_id=:viewer
          WHERE p.id<:before AND (m.status IS NULL OR m.status!='banned')
          AND (c.access='open' OR m.status='member') AND ${unblocked()} ORDER BY p.id DESC LIMIT 21`, {viewer:user?.id||'',before:Number(before)});
        const posts = result.slice(0,20);
        send(200, {posts:postExtras(db,posts,user,now),next:result.length>20?posts.at(-1).id:null}); return;
      }
      if(catalogRoutes({db,user,path,method,url,send}))return;
      if (method === 'POST' && path === '/api/clubs') {
        const name = text(body.name, 'Название', 2, 80), description = text(body.description, 'Описание', 0, 1000);
        if (!['open', 'request'].includes(body.access)) fail(422, 'Выбери тип доступа.');
        const id = randomUUID();
        transaction(db, () => {
          run('INSERT INTO clubs(id,owner_id,name,description,access,created_at) VALUES(?,?,?,?,?,?)', id, user.id, name, description, body.access, now());
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
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.target_id=m.sender_id)
            ORDER BY m.id ${newer ? 'ASC' : 'DESC'} LIMIT 51`, clubId, Number(cursor ?? Number.MAX_SAFE_INTEGER),user.id);
          const hasMore = result.length > 50;
          const messages = result.slice(0, 50);
          if (!newer) messages.reverse();
          send(200, { viewerId: user.id, blockVersion: sql('SELECT block_version FROM users WHERE id=?',user.id).block_version, messages, hasMore, next: hasMore ? (newer ? messages.at(-1).id : messages[0].id) : null }); return;
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
        if (action === 'posts') {
          clubFor(id, user, method !== 'GET');
          if (method === 'GET') {
            const before = url.searchParams.get('before') || String(Number.MAX_SAFE_INTEGER);
            if (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before))) fail(422, 'Некорректный курсор.');
            const result = rows(`SELECT p.*,u.name AS author_name,CASE WHEN u.profile_visible=1 THEN u.avatar_id ELSE NULL END AS author_avatar_id FROM posts p JOIN users u ON u.id=p.author_id WHERE p.club_id=:club AND p.id<:before AND ${unblocked('p',staffOf(db,id,user?.id))} ORDER BY p.id DESC LIMIT 21`, {club:id,before:Number(before),viewer:user?.id||''});
            const more = result.length > 20; const posts = result.slice(0, 20);
            send(200, { posts:postExtras(db,posts,user,now), next: more ? posts.at(-1).id : null }); return;
          }
          if (method === 'POST') {
            const title=text(body.title,'Заголовок',1,100),postBody=text(body.body,'Текст',1,4000),clientId=attemptId(body);
            const replay=clientId?sql('SELECT image_id FROM posts WHERE club_id=? AND author_id=? AND client_id=?',id,user.id,clientId):null;
            const image=body.imageId==null?null:(replay?.image_id===body.imageId?body.imageId:ownedImage(db,body.imageId,user));
            const result=transaction(db,()=>{
              const old=clientId?sql('SELECT id,title,body,image_id FROM posts WHERE club_id=? AND author_id=? AND client_id=?',id,user.id,clientId):null;
              if(old){if(old.title!==title||old.body!==postBody||old.image_id!==image)fail(409,'Этот идентификатор уже использован для другой публикации.');return {id:old.id,replayed:true};}
              const postId=Number(run('INSERT INTO posts(club_id,author_id,title,body,created_at,image_id,client_id) VALUES(?,?,?,?,?,?,?)',id,user.id,title,postBody,now(),image,clientId).lastInsertRowid);
              mentions(db,{post:{id:postId,club_id:id,author_id:user.id},actor:user,body:title+'\n'+postBody,now});
              return {id:postId,replayed:false};
            });
            send(result.replayed?200:201,result);return;
          }
        }
      }
      match = path.match(/^\/api\/posts\/(\d+)(\/comments)?$/);
      if (match) {
        const id = Number(match[1]); if (!Number.isSafeInteger(id)) fail(404, 'Публикация недоступна.');
        const own = !match[2] && method === 'DELETE' && sql('SELECT * FROM posts WHERE id=? AND author_id=?', id, user.id);
        if (own && sql("SELECT 1 FROM memberships WHERE club_id=? AND user_id=? AND status='banned'", own.club_id, user.id)) fail(403, 'Нет доступа к содержимому клуба.');
        // Leaving a club does not take away an author's ability to remove their own post.
        const post = own || postFor(id, user, method !== 'GET');
        if (!match[2] && method === 'GET') { send(200, { post:postExtras(db,[{...post,author_name:sql('SELECT name FROM users WHERE id=?',post.author_id).name,club_name:sql('SELECT name FROM clubs WHERE id=?',post.club_id).name,author_avatar_id:sql('SELECT CASE WHEN profile_visible=1 THEN avatar_id ELSE NULL END AS avatar FROM users WHERE id=?',post.author_id).avatar}],user,now)[0] }); return; }
        if (!match[2] && method === 'DELETE') {
          if (post.author_id !== user.id) fail(403, 'Удалить публикацию может только автор.');
          transaction(db,()=>{run('DELETE FROM posts WHERE id=?',id);if(post.image_id && !imageAttached(db,post.image_id))run('DELETE FROM media WHERE id=?',post.image_id);}); send(200, { ok: true }); return;
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
    async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, listenHost, resolve); }); return publicOrigin || `http://127.0.0.1:${server.address().port}`; },
    async close() { if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); db.close(); }
  };
}

