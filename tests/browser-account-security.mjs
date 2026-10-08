import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
const oldPassword='Account-ui-old-password-123',newPassword='Account-ui-new-password-456',browser=await chromium.launch();
try{for(const width of [360,390,768,1440]){
 const app=await createApp(),origin=await app.listen(),c=await browser.newContext({viewport:{width,height:900}}),other=await browser.newContext(),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  const call=async(context,path,method='GET',data)=>{const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1'},...(data?{data}:{})});return {status:r.status(),...await r.json()};};
  await call(c,'/api/register','POST',{handle:'account_ui',name:'Игрок',password:oldPassword});await call(other,'/api/login','POST',{handle:'account_ui',password:oldPassword});
  await p.goto(origin+'/account');await p.locator('[data-account-section=security]').click();await p.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();await p.locator('#changePassword').waitFor();assert.equal(await p.locator('[data-session-row]').count(),2);
  await p.locator('#profile [name=bio]').fill('Несохранённое описание');p.once('dialog',d=>d.accept());await p.locator('[data-current-session="0"]').click();await p.waitForFunction(()=>document.querySelectorAll('[data-session-row]').length===1);assert.equal(await p.locator('#profile [name=bio]').inputValue(),'Несохранённое описание');assert.equal((await call(other,'/api/me')).user,null);
  await call(other,'/api/login','POST',{handle:'account_ui',password:oldPassword});
  await p.locator('#changePassword [name=currentPassword]').fill(oldPassword);await p.locator('#changePassword [name=newPassword]').fill(newPassword);await p.locator('#changePassword [name=repeatPassword]').fill('Mismatched-password-000');await p.locator('#changePassword button').click();assert.match(await p.locator('#changePassword .error').textContent(),/не совпадают/);
  await p.locator('#changePassword [name=repeatPassword]').fill(newPassword);p.once('dialog',d=>d.dismiss());await p.locator('#changePassword button').click();assert.equal(await p.locator('#changePassword [name=currentPassword]').inputValue(),oldPassword);
  p.once('dialog',d=>d.accept());await p.locator('#changePassword button').click();await p.waitForFunction(()=>document.querySelector('#toast')?.textContent.startsWith('Пароль изменён'));
  assert.equal(await p.locator('#changePassword [name=currentPassword]').inputValue(),'');assert.equal(await p.locator('[data-session-row]').count(),1);assert.equal((await call(other,'/api/me')).user,null);assert.equal((await call(other,'/api/login','POST',{handle:'account_ui',password:oldPassword})).status,401);assert.equal((await call(other,'/api/login','POST',{handle:'account_ui',password:newPassword})).status,200);
  const storage=await p.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!storage.includes(oldPassword)&&!storage.includes(newPassword));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  p.once('dialog',d=>d.accept());await p.locator('[data-current-session="1"]').click();await p.locator('#login').waitFor();assert.equal((await call(c,'/api/me')).user,null);assert.deepEqual(errors,[]);console.log(`PASS ${width}px: individual session revoke, dirty profile guard, password rotation and current logout`);
 }finally{await c.close();await other.close();await app.close();}
}}finally{await browser.close();}

