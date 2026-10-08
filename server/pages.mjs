const brand='Wild Rift Community';
const defaultDescription='Сообщество Wild Rift. Находи напарников, создавай клубы и обсуждай игру.';
const sections={
 '/':['Твои люди, твой клуб',defaultDescription],
 '/feed':['Обсуждения','Обсуждения, публикации и клубы сообщества Wild Rift.'],
 '/clubs':['Клубы','Клубы и обсуждения игроков Wild Rift. Найди сообщество по своим интересам.'],
 '/players':['Люди','Публичные профили участников сообщества Wild Rift.'],
 '/guides':['Руководства','Руководства игроков Wild Rift: роли, чемпионы и игровой опыт.'],
 '/teams':['Найти команду','Объявления игроков Wild Rift о поиске компании для игры.'],
 '/tournaments':['Турниры','Командные турниры Wild Rift: регистрация, сетка и результаты.'],
 '/events':['События','Игровые события сообщества Wild Rift.'],
 '/rules':['Правила сообщества','Правила общения, публикаций и модерации Wild Rift Community.'],
 '/account':['Профиль',defaultDescription],'/messages':['Сообщения',defaultDescription],
 '/notifications':['Ответы',defaultDescription],'/reports':['Жалобы',defaultDescription],
 '/saved':['Сохранённое',defaultDescription],'/drafts':['Черновики',defaultDescription],'/search':['Поиск',defaultDescription]
};
const indexable=new Set(['/','/feed','/clubs','/players','/guides','/teams','/events','/rules']);
export const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const excerpt=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,180);
export function pageMetadata(db,path,user){
 path=path==='/'?path:path.replace(/\/$/,'');
 const generic=(status=404)=>({status,path,title:status===403?'Страница недоступна':'Страница не найдена',description:defaultDescription,index:false});
 if(sections[path])return {status:200,path,title:sections[path][0],description:sections[path][1],index:indexable.has(path)};
 const match=/^\/(clubs|posts|players)\/([\w-]{1,80})$/.exec(path);if(!match)return generic();
 const [,kind,id]=match,viewer=user?.id||'';
 const blocked=author=>db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)').get(viewer,author,author,viewer);
 if(kind==='players'){
  const profile=db.prepare('SELECT name,bio,profile_visible FROM users WHERE id=?').get(id);
  if(!profile||!profile.profile_visible||blocked(id))return generic();
  return {status:200,path,title:profile.name,description:excerpt(profile.bio)||'Публичный профиль участника Wild Rift Community.',index:true};
 }
 const post=kind==='posts'&&/^\d{1,16}$/.test(id)?db.prepare('SELECT * FROM posts WHERE id=?').get(id):null;
 if(kind==='posts'&&!post)return generic();
 const club=db.prepare('SELECT * FROM clubs WHERE id=?').get(post?post.club_id:id);if(!club)return generic();
 const membership=user?db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(club.id,viewer):null;
 if(membership?.status==='banned')return generic(403);
 if(post){
  if(blocked(post.author_id))return generic();
  if(club.access!=='open'&&membership?.status!=='member')return generic(403);
  // Even an authenticated member receives no private text in link metadata.
  if(club.access!=='open')return {status:200,path,title:'Публикация клуба',description:'Публикация доступна участникам клуба.',index:false};
  return {status:200,path,title:post.title,description:excerpt(post.body)||'Обсуждение в сообществе Wild Rift.',index:true,type:'article'};
 }
 return {status:200,path,title:club.name,description:excerpt(club.description)||'Клуб игроков Wild Rift.',index:true};
}
export function pageHTML(template,meta,origin){
 const title=escapeHTML(`${meta.title} — ${brand}`),description=escapeHTML(meta.description),canonical=escapeHTML(origin+meta.path);
 // Replacement functions keep "$&", "$`" and "$$" in stored text literal.
 return template.replace(/<title>[^<]*<\/title>/,()=>`<title>${title}</title>`)
 .replace(/<meta name="description" content="[^"]*">/,()=>`<meta name="description" content="${description}">`)
 .replace('</head>',()=>`<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="canonical" href="${canonical}"><meta name="robots" content="${meta.index?'index,follow':'noindex,nofollow'}"><meta property="og:type" content="${meta.type||'website'}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="${brand}"></head>`);
}
export function sitemap(db,origin){
 // Only guest-visible URLs; no private post titles, media or account routes.
 const urls=[...indexable];
 for(const row of db.prepare(`SELECT path FROM (
 SELECT '/clubs/'||id path FROM clubs
 UNION ALL SELECT '/posts/'||p.id path FROM posts p JOIN clubs c ON c.id=p.club_id WHERE c.access='open'
 UNION ALL SELECT '/players/'||id path FROM users WHERE profile_visible=1
 ) ORDER BY path LIMIT ?`).all(50000-urls.length))urls.push(row.path);
 return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(path=>`<url><loc>${escapeHTML(origin+path)}</loc></url>`).join('')+'</urlset>';
}

