import { fail, text } from './security.mjs';
export const roles = ['baron','jungle','mid','dragon','support'];
export function profileFields(body, old = {}) {
  const result = {...old};
  for (const [key,label,max] of [['riotId','Riot ID',64],['rank','Ранг',40],['region','Регион',40],['language','Язык',40],['playTime','Время игры',100]]) {
    if (key in body) result[key] = text(body[key],label,0,max);
  }
  if (result.riotId && !/^.{3,32}#[\p{L}\p{N}]{3,5}$/u.test(result.riotId)) fail(422,'Riot ID: имя#тег (3–5 букв или цифр в теге).');
  if ('roles' in body) {
    if (!Array.isArray(body.roles) || body.roles.length>2 || new Set(body.roles).size!==body.roles.length || body.roles.some(x=>!roles.includes(x))) fail(422,'Выбери не больше двух различных ролей.');
    result.roles = body.roles;
  }
  if ('champions' in body) {
    if (!Array.isArray(body.champions) || body.champions.length>3) fail(422,'Укажи до трёх любимых чемпионов.');
    result.champions = body.champions.map(x=>text(x,'Чемпион',1,40));
    if (new Set(result.champions).size!==result.champions.length) fail(422,'Чемпионы не должны повторяться.');
  }
  if ('riotVisible' in body) {
    if (typeof body.riotVisible!=='boolean') fail(422,'Проверь видимость Riot ID.');
    result.riotVisible=body.riotVisible;
  }
  return result;
}
export function gameProfile(user, own=false) {
  const p=JSON.parse(user.game_profile||'{}');
  return {...p,riotId: own || p.riotVisible ? p.riotId||'' : '',rankVerified:false};
}
export function profileView(user, own=false) {
  return {id:user.id,handle:user.handle,name:user.name,bio:user.bio,gameProfile:gameProfile(user,own),profileVisible:user.profile_visible===1,
    avatarId:user.avatar_id||null,coverId:user.cover_id||null};
}
