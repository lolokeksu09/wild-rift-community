/** Isolated real HTTP/SQLite fixtures for Android instrumentation; never contacts production. */
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createServer as createTlsServer, request as httpsRequest} from 'node:https';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/app.mjs';

const origin='https://localhost:5032';
const password='Walkthrough-test-only-123';
const assetPath=fileURLToPath(new URL('../android/app/src/androidTest/assets/walkthrough.json',import.meta.url));
const directory=await mkdtemp(join(tmpdir(),'wr-android-walkthrough-'));
const databasePath=join(directory,'community.sqlite');
const moderatorIds=[];
let app,proxy,closing;
async function cleanup(){
  if(closing)return closing;
  closing=(async()=>{
    if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
    if(app)await app.close();
    await rm(directory,{recursive:true,force:true});
  })();
  return closing;
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{cleanup().then(()=>process.exit(0),()=>process.exit(1));});

function request(path,method='GET',body,account=null,tls=false,ca){
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const headers={Host:'localhost:5032'};
  if(bytes){headers['Content-Type']='application/json';headers['Content-Length']=bytes.length;}
  if(method!=='GET'){headers.Origin=origin;headers['X-Community-Request']='1';if(account)headers['X-CSRF-Token']=account.csrf;}
  if(account)headers.Cookie=account.cookie;
  return new Promise((resolve,reject)=>{
    const req=(tls?httpsRequest:httpRequest)({hostname:'127.0.0.1',port:tls?5032:5033,path,method,headers,...(tls?{ca,servername:'localhost'}:{})},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{
        try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString()),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});}catch(error){reject(error);}
      });
    });
    req.setTimeout(15000,()=>req.destroy(new Error('Fixture request timed out')));
    req.on('error',reject);req.end(bytes);
  });
}
async function call(path,method='GET',body,account=null){
  const response=await request(path,method,body,account);
  assert.ok(response.status>=200&&response.status<300,`${method} ${path}: ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}
async function startBackend(){
  app=await createApp({databasePath,authLimit:500,moderatorIds,publicOrigin:origin});
  await app.listen(5033);
}
try{
  assert.ok(process.env.TLS_KEY&&process.env.TLS_CERT,'TLS_KEY and TLS_CERT must point to an ephemeral localhost certificate/key');
  const [key,cert]=await Promise.all([readFile(process.env.TLS_KEY),readFile(process.env.TLS_CERT)]);
  await startBackend();
  const accounts={};
  for(const role of ['owner','writer','outsider','moderator','moderator2']){
    const handle=`walk_${role}`,name=`Walkthrough ${role}`;
    const response=await request('/api/register','POST',{handle,name,password});
    assert.equal(response.status,201,`Registration failed for ${role}`);
    accounts[role]={...response.data.user,csrf:response.data.csrf,cookie:response.cookie};
    assert.ok(accounts[role].cookie&&accounts[role].csrf);
  }
  moderatorIds.push(accounts.moderator.id,accounts.moderator2.id);
  // createApp snapshots configured platform roles; reopen the same isolated database.
  await app.close();app=null;await startBackend();
  for(const role of Object.keys(accounts)){
    const me=await call('/api/me','GET',undefined,accounts[role]);
    assert.equal(me.user.isModerator,role.startsWith('moderator'));
    await call('/api/me','PATCH',{profileVisible:true,bio:`Android isolated ${role} fixture`,gameProfile:{roles:role==='writer'?['jungle']:['baron'],region:'eu',language:'ru',rank:'Gold',microphone:'yes'}},accounts[role]);
  }
  const owner=accounts.owner,writer=accounts.writer;
  const clubId=(await call('/api/clubs','POST',{name:'Walkthrough club',description:'Android fixture open club',access:'open'},owner)).id;
  const closedClubId=(await call('/api/clubs','POST',{name:'Walkthrough closed club',description:'Android fixture private club',access:'request'},owner)).id;
  await call(`/api/clubs/${clubId}/join`,'POST',{},writer);
  await call(`/api/clubs/${clubId}/join`,'POST',{},accounts.moderator);
  await call(`/api/clubs/${clubId}/moderators`,'PUT',{userId:accounts.moderator.id},owner);
  const postId=(await call(`/api/clubs/${clubId}/posts`,'POST',{title:'Walkthrough post',body:'Publication created by writer for Android role scenarios.',clientId:'walkthrough-post-0001'},writer)).id;
  const commentId=(await call(`/api/posts/${postId}/comments`,'POST',{body:'Walkthrough target comment',clientId:'walkthrough-comment-target'},owner)).id;
  for(let i=0;i<65;i++)await call(`/api/posts/${postId}/comments`,'POST',{body:`Walkthrough comment ${i+1}`,clientId:`walkthrough-comment-${String(i).padStart(3,'0')}`},writer);
  const pollId=(await call(`/api/clubs/${clubId}/polls`,'POST',{title:'Walkthrough poll',body:'Choose a role',durationHours:24,options:['Baron','Jungle'],clientId:'walkthrough-poll-0001'},writer)).id;
  await call(`/api/clubs/${clubId}/guides`,'POST',{title:'Walkthrough guide',body:'A real fixture guide.',topic:'macro',champion:'',gameVersion:'7.0',summary:'Android guide fixture',clientId:'walkthrough-guide-0001'},writer);
  await call(`/api/clubs/${clubId}/draft`,'PUT',{title:'Walkthrough private draft',body:'Only writer may read this draft.',version:0},writer);
  await call(`/api/clubs/${closedClubId}/posts`,'POST',{title:'Walkthrough private post',body:'Only approved closed club members may read this post.',clientId:'walkthrough-private-post'},owner);
  const groupId=(await call('/api/lfg','POST',{title:'Walkthrough group',mode:'ranked',region:'eu',language:'ru',role:'any',rank:'',voice:'optional',description:'Android group fixture',capacity:3,durationHours:8,clientId:'walkthrough-group-0001'},owner)).id;
  const eventId=(await call('/api/events','POST',{title:'Walkthrough event',description:'Android event fixture',mode:'normal',region:'eu',language:'ru',timezone:'Europe/Moscow',startsAt:Date.now()+3600000,durationHours:1,roles:['baron','jungle','mid'],ownerRole:'baron',clientId:'walkthrough-event-0001'},owner)).id;
  const firstComments=await call(`/api/posts/${postId}/comments`,'GET',undefined,writer);
  assert.equal(firstComments.comments.length,50);assert.ok(firstComments.next);
  const older=await call(`/api/posts/${postId}/comments?before=${firstComments.next}`,'GET',undefined,writer);
  assert.equal(older.comments.length,16);assert.ok(older.comments.some(comment=>comment.id===commentId));
  assert.equal((await request(`/api/clubs/${closedClubId}/posts`,'GET',undefined,accounts.outsider)).status,403);
  const metadata={origin,password,users:Object.fromEntries(Object.entries(accounts).map(([role,{name,handle,id}])=>[role,{name,handle,id}])),clubId,closedClubId,postId,pollId,commentId,groupId,eventId};
  proxy=createTlsServer({key,cert},(req,res)=>{
    // Preserve the original Host: production Origin/Host checks remain active.
    const upstream=httpRequest({hostname:'127.0.0.1',port:5033,path:req.url,method:req.method,headers:req.headers},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(5032,'127.0.0.1',resolve);});
  const secureMe=await request('/api/me','GET',undefined,accounts.moderator,true,cert);
  assert.equal(secureMe.status,200);assert.equal(secureMe.data.user.isModerator,true);
  const secureWrite=await request('/api/me','PATCH',{bio:'Android isolated writer fixture'},writer,true,cert);
  assert.equal(secureWrite.status,200,'TLS proxy must preserve Origin, CSRF and session headers');
  const deniedWrite=await request('/api/me','PATCH',{bio:'Must not be accepted'},null,true,cert);
  assert.equal(deniedWrite.status,401,'TLS proxy must preserve server authorization enforcement');
  await mkdir(new URL('../android/app/src/androidTest/assets/',import.meta.url),{recursive:true});
  await writeFile(assetPath,JSON.stringify(metadata,null,2)+'\n');
  process.stdout.write(`android-walkthrough-ready ${JSON.stringify({origin,metadata:assetPath,comments:66})}\n`);
  if(process.argv.includes('--smoke'))await cleanup();
}catch(error){await cleanup();console.error(error.message);process.exitCode=1;}
