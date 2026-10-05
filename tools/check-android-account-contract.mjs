import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';

// Isolated in-memory server. This never sends credentials or mutations to production.
const app = await createApp({authLimit:100});
const origin = await app.listen();
let cookie = '', csrf = '';
async function request(path, method='GET', payload, expected=200, override={}) {
  const headers={...override};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json',Origin:origin,'X-Community-Request':'1','X-CSRF-Token':csrf},override);
  const response=await fetch(origin+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
  assert.equal(response.status,expected,`${method} ${path}`);
  const data=await response.json();
  const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  if(data.csrf)csrf=data.csrf;
  return data;
}
try {
  const password='android-test-password-123';
  const registered=await request('/api/register','POST',{handle:'android_contract',name:'Android test',password},201);
  assert.equal(registered.user.handle,'android_contract');assert.ok(csrf);assert.ok(cookie.startsWith('wr_session='));
  assert.equal((await request('/api/me')).user.id,registered.user.id);
  await request('/api/me','PATCH',{name:'Updated',bio:'Android draft',profileVisible:false,gameProfile:{riotId:'Player#TEST',region:'EU',rank:'Gold',language:'Русский'}});
  assert.equal((await request('/api/me')).user.name,'Updated');
  await request('/api/me','PATCH',{name:'Forbidden'},403,{Origin:'https://foreign.invalid'});
  await request('/api/me','PATCH',{name:'Forbidden'},403,{'X-CSRF-Token':'wrong'});
  const generated=await request('/api/recovery-codes','POST',{password});assert.ok(generated.codes.length>0);
  const active=await request('/api/sessions');assert.equal(active.sessions.filter(s=>s.current).length,1);
  await request('/api/logout','POST',{});assert.equal((await request('/api/me')).user,null);
  await request('/api/login','POST',{handle:'android_contract',password});
  const newer='android-new-password-123';
  const changed=await request('/api/me/password','POST',{currentPassword:password,newPassword:newer});
  assert.equal(changed.recoveryCodesRevoked,true);
  const codes=await request('/api/recovery-codes','POST',{password:newer});
  await request('/api/logout-all','POST',{});assert.equal((await request('/api/me')).user,null);
  await request('/api/recover','POST',{handle:'android_contract',code:codes.codes[0],password});
  await request('/api/login','POST',{handle:'android_contract',password});
  const current=(await request('/api/sessions')).sessions.find(s=>s.current);
  assert.equal((await request(`/api/sessions/${current.id}`,'DELETE',{})).loggedOut,true);
  assert.equal((await request('/api/me')).user,null);
  console.log('Android account contract: register, restore, profile, Origin/CSRF, codes, password rotation, recovery, session revoke and logout passed (isolated DB).');
} finally { await app.close(); }
