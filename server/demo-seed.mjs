import sharp from 'sharp';
import {createHash,randomBytes} from 'node:crypto';
import {transaction} from './database.mjs';
import {passwordHash} from './security.mjs';
import {isDemo} from './demo.mjs';

export const demoId=value=>{const h=createHash('sha256').update('wr-community-demo-v1:'+value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
const names=['Лунный Лис','Тихий Рифт','Северный Ветер','Золотой Фонарь','Лесной След','Синий Комет','Алый Рассвет','Звёздный Шаг','Ночной Барон','Мятный Дракон','Стальной Лотос','Искра Рифта','Лунный Страж','Песочный Час','Сапфир','Тёплый Пинг','Кристальный Луч','Медный Ключ','Белый Сокол','Теневой След','Космический Кот','Зелёный Огонь','Речной Камень','Последний Фонарь'];
const colors=['#be9c62','#7292bf','#9a7dbc','#70a798','#ba7973','#a8a071'];
const roles=['baron','jungle','mid','dragon','support'];
export const demoClubs=[
 {name:'После матча',description:'Истории, красивые моменты и разговоры, которые остаются после игры.',tags:['Общение','Моменты'],accent:'azure'},
 {name:'Школа Рифта',description:'Место для вопросов. Разбираем свой опыт и помогаем друг другу освоиться.',tags:['Новичкам','Советы'],accent:'emerald'},
 {name:'ARAM & Chill',description:'Любимые чемпионы, неожиданные составы и спокойные разговоры об ARAM.',tags:['ARAM','Общение'],accent:'violet'},
 {name:'Пять ролей',description:'Барон, лес, центр, дракон и поддержка — найдём общий язык между линиями.',tags:['Роли','Командная игра'],accent:'coral'},
 {name:'Галерея Рифта',description:'Идеи для творчества, оформление профилей и любимые игровые образы.',tags:['Творчество','Образы'],accent:'violet'},
 {name:'Своя компания',description:'Знакомства, игровые привычки и разговоры о том, с кем приятно проводить вечер.',tags:['Знакомства','Компания'],accent:'azure'}
];
const titles=[
 ['Какой момент ты вспоминаешь после матча?','Когда игра не задалась: что помогает переключиться?','Как рассказать о матче, чтобы разговор получился полезным','Небольшая победа, которой хочется поделиться'],
 ['Первый вопрос в клубе: что хотелось бы понять?','Какой совет ты хотел бы получить в начале?','Как попросить совет по игре и получить понятный ответ','Ошибки — повод разобраться, а не ругать себя'],
 ['Кого тебе приятнее всего получить в ARAM?','Идеальный вечер: серьёзная игра или неожиданные составы?','Какая комбинация команды запомнилась больше всего?','Одна игра, которая подняла настроение'],
 ['На какой роли ты чувствуешь себя на своём месте?','Что помогает лучше понимать союзников?','Как обсуждать свои роли перед совместной игрой','Если бы ты попробовал вторую роль — какую?'],
 ['Как выглядела бы твоя обложка профиля?','Любимый игровой образ: что тебя в нём цепляет?','Небольшое творческое задание: придумай символ своего клуба','Палитра настроения: золото, синий или фиолетовый?'],
 ['Давайте знакомиться: какой у тебя игровой ритуал?','Какой компании ты рад после трудного дня?','Что написать в первом посте знакомства','Хорошая компания: три качества, которые для тебя важны']
];
const prompts=[
 'Это демонстрационная тема для разговора. Расскажи о моменте из своей игры: что произошло, почему ты его запомнил и чему он тебя научил. Можно приложить свой скриншот — без личных данных других игроков.',
 'Это демонстрационная тема. Здесь можно задавать простые вопросы без страха ошибиться. Опиши, что именно непонятно, на какой роли играешь и какого ответа ждёшь. Конкретная ситуация помогает начать полезный разговор.',
 'Это демонстрационная тема об ARAM. Делись любимыми моментами и неожиданными составами, а не только результатом. Какой матч ты бы хотел повторить ради самой атмосферы?',
 'Это демонстрационная тема о ролях. Расскажи, что тебе нравится в своей роли и что хотелось бы понять в других. Давайте обсудим ожидания друг от друга без обвинений.',
 'Это демонстрационная творческая тема. Предложи идею оформления: настроение, цвета и символ. Используй собственные материалы и уважай авторов чужих работ.',
 'Это демонстрационная тема знакомства. Напиши, что тебе нравится в Wild Rift, о чём любишь общаться и какой компании ищешь. Сам бот этой публикации не играет и не принимает приглашения в команду.'
];
const answers=['В этом демонстрационном обсуждении выбрал бы спокойный разговор: интереснее понять ход мысли, чем спорить о результате.','Мой вариант для этой демонстрации — начать с одного конкретного момента и послушать другие точки зрения.','Для примера: мне нравится идея клуба, в котором можно задать простой вопрос и получить доброжелательный ответ.'];
function artwork(index,wide=false){
 const color=colors[index%colors.length],w=wide?1000:256,h=wide?360:256;
 const angle=(index*13)%90;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#252a34"/><stop offset="1" stop-color="#0f131b"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#bg)"/><g transform="translate(${w/2} ${h/2}) rotate(${angle})" fill="none" stroke="${color}"><circle r="${h*.37}" opacity=".28"/><circle r="${h*.28}" stroke-dasharray="2 10" opacity=".6"/><path d="M0 ${-h*.33} ${h*.33} 0 0 ${h*.33} ${-h*.33} 0Z" opacity=".6"/><path d="M${-h*.18} 0 0 ${-h*.18} ${h*.18} 0 0 ${h*.18}Z" stroke-width="3"/><path d="M${-h*.12} ${-h*.08} 0 ${h*.11} ${h*.12} ${-h*.08}" stroke-width="4" stroke-linecap="round"/><circle cx="0" cy="${-h*.1}" r="5" fill="${color}"/></g></svg>`;
}

export async function seedDemoCommunity(db,{now=Date.now()}={}) {
 // Prepare all expensive work before the short, atomic write transaction.
 const assets=[];for(let i=0;i<24;i++)for(const kind of ['avatar','cover']){const bytes=await sharp(Buffer.from(artwork(i,kind==='cover'))).webp({quality:82}).toBuffer();assets.push({index:i,kind,bytes,width:kind==='cover'?1000:256,height:kind==='cover'?360:256});}
 const hash=await passwordHash(randomBytes(48).toString('hex'));
 return transaction(db,()=>{
  const run=(q,...p)=>db.prepare(q).run(...p),get=(q,...p)=>db.prepare(q).get(...p);
  const stats={createdBots:0,createdClubs:0,createdPosts:0,createdComments:0};
  const users=names.map((name,i)=>({id:demoId('user:'+i),handle:'bot_rift_'+String(i+1).padStart(2,'0'),name,index:i}));
  for(const u of users){const existing=get('SELECT id,game_profile FROM users WHERE handle=? OR id=?',u.handle,u.id);if(existing&&(existing.id!==u.id||!isDemo(existing)))throw Error('Demo account collides with an existing account; no data changed.');
   if(!existing){run('INSERT INTO users(id,handle,name,bio,password,created_at,dm_requests,profile_visible,game_profile) VALUES(?,?,?,?,?,?,0,1,?)',u.id,u.handle,u.name,'Демонстрационный бот. Интересы: '+demoClubs[u.index%6].tags.join(', ')+'. Не играю матчи и не отвечаю на сообщения.',hash,now,JSON.stringify({demoBot:'community-v1',roles:[roles[u.index%5]],champions:[],rank:'',language:'Русский',region:'',playTime:'Демонстрационный профиль',microphone:'unknown'}));stats.createdBots++;}
  }
  function image(u,asset,key){const id=demoId('media:'+key),existing=get('SELECT id,owner_id FROM media WHERE id=?',id);if(existing){if(existing.owner_id!==u.id)throw Error('Demo media collision.');return id;}
   const total=get('SELECT coalesce(sum(size),0) n FROM media').n,own=get('SELECT coalesce(sum(size),0) n FROM media WHERE owner_id=?',u.id).n;
   if(total+asset.bytes.length>500*1024*1024||own+asset.bytes.length>50*1024*1024)throw Error('Media quota reached; demo seed rolled back.');
   run('INSERT INTO media(id,owner_id,client_id,signature,bytes,width,height,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,u.id,'demo-v1-'+key,createHash('sha256').update(asset.bytes).digest('hex'),asset.bytes,asset.width,asset.height,asset.bytes.length,now);return id;
  }
  for(const u of users){for(const kind of ['avatar','cover']){const asset=assets.find(a=>a.index===u.index&&a.kind===kind);const id=image(u,asset,'user-'+u.index+'-'+kind);run(`UPDATE users SET ${kind==='avatar'?'avatar_id':'cover_id'}=coalesce(${kind==='avatar'?'avatar_id':'cover_id'},?) WHERE id=?`,id,u.id);}}
  const clubs=demoClubs.map((c,i)=>({...c,id:demoId('club:'+i),owner:users[i],index:i}));
  for(const c of clubs){const existing=get('SELECT owner_id FROM clubs WHERE id=?',c.id);if(existing&&existing.owner_id!==c.owner.id)throw Error('Demo club ownership changed; seed stopped.');if(!existing){const cover=image(c.owner,assets.find(a=>a.index===c.index&&a.kind==='cover'),'club-'+c.index);run('INSERT INTO clubs(id,owner_id,name,description,access,created_at,tags,accent,rules,cover_id) VALUES(?,?,?,?,?,?,?,?,?,?)',c.id,c.owner.id,c.name,c.description,'open',now,JSON.stringify(c.tags),c.accent,'Это демонстрационный клуб с отмеченными ботами. Реальные участники могут вступать и общаться. Уважайте друг друга, избегайте оскорблений и спама. Боты не отвечают и не собирают игровые команды.',cover);stats.createdClubs++;}
   for(const u of users.filter(u=>(u.index+c.index)%2===0))run("INSERT OR IGNORE INTO memberships(club_id,user_id,status) VALUES(?,?,'member')",c.id,u.id);
  }
  for(let n=0;n<4;n++)for(const c of clubs){const participants=users.filter(u=>(u.index+c.index)%2===0),author=participants[(n+c.index)%participants.length],client='demo-v1-post-'+c.index+'-'+n;
   let post=get('SELECT id FROM posts WHERE club_id=? AND author_id=? AND client_id=?',c.id,author.id,client);
   if(!post){const imageId=n===0?image(author,assets.find(a=>a.index===c.index&&a.kind==='cover'),'post-'+c.index):null;const body=n===2&&[0,1,3].includes(c.index)?'Демонстрационный материал о разговоре в сообществе.\n\n1. Опиши ситуацию своими словами: что хотел сделать и что получилось.\n2. Сформулируй один вопрос вместо списка претензий.\n3. Уточни свою роль и контекст, если просишь игровой совет.\n4. Поблагодари за ответ и расскажи, что оказалось полезным.\n\nЭтот текст не содержит сборок, игровых чисел или сведений о текущем патче. Его цель — показать формат руководства и помочь начать общение.':prompts[c.index];
    const result=run('INSERT INTO posts(club_id,author_id,title,body,created_at,client_id,image_id) VALUES(?,?,?,?,?,?,?)',c.id,author.id,titles[c.index][n],body,now,client,imageId);post={id:Number(result.lastInsertRowid)};stats.createdPosts++;
    if(n===2&&[0,1,3].includes(c.index))run('INSERT INTO guides(post_id,topic,champion,game_version,summary) VALUES(?,?,?,?,?)',post.id,'beginner','','Демонстрация','Пример руководства о доброжелательном и полезном общении в сообществе.');
   }
   for(let j=0;j<3;j++){const commenter=participants[(n+c.index+j+1)%participants.length],key=client+'-comment-'+j;const result=run('INSERT INTO comments(post_id,author_id,body,created_at,client_id) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM comments WHERE post_id=? AND author_id=? AND client_id=?)',post.id,commenter.id,answers[j],now,key,post.id,commenter.id,key);stats.createdComments+=result.changes;}
  }
  // Only bot messages in bot-owned clubs; no direct messages or real-user notifications.
  for(const c of clubs)for(let i=0;i<3;i++){const u=users[(c.index+i*2)%24];if((u.index+c.index)%2)continue;run('INSERT OR IGNORE INTO messages(club_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)',c.id,u.id,'demo-v1-chat-'+i,'[Демонстрационный бот] Добро пожаловать! Это пример истории чата. Боты не отвечают; здесь могут общаться реальные участники клуба.',now);}
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Demo seed integrity check failed.');
  return {...stats,bots:24,clubs:6,posts:24,comments:72};
 });
}
