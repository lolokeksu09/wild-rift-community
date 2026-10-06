import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApp } from '../app.mjs';

test('HTTPS origin preserves authentication and rejects hostile hosts and origins', async () => {
  const server = await createApp({publicOrigin:'https://139.100.205.135',proxyClientHeader:true});
  // Reserve a loopback transport port independently of the public origin.
  const { createServer } = await import('node:net');
  const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port; await new Promise(r=>probe.close(r));
  await server.listen(port);
  try {
    const url=`http://127.0.0.1:${port}`;
    const fetch=(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
      const req=request(url,{method,headers},res=>{
        let raw='';res.setEncoding('utf8');res.on('data',x=>raw+=x);res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>Array.isArray(res.headers[key])?res.headers[key].join('; '):res.headers[key]},json:async()=>JSON.parse(raw)}));
      });req.on('error',reject);req.end(body);
    });
    const headers={Host:'139.100.205.135',Origin:'https://139.100.205.135','X-Community-Request':'1','Content-Type':'application/json','X-WR-Client-IP':'192.0.2.1'};
    assert.equal((await fetch(url+'/api/me',{headers:{Host:'evil.test'}})).status,403);
    const body=JSON.stringify({handle:'deploy_test',name:'Тест',password:'separate-test-password'});
    assert.equal((await fetch(url+'/api/register',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body})).status,403);
    assert.equal((await fetch(url+'/api/register',{method:'POST',headers:{...headers,'X-WR-Client-IP':'bad'},body})).status,403);
    const registered=await fetch(url+'/api/register',{method:'POST',headers,body});
    assert.equal(registered.status,201);
    assert.match(registered.headers.get('set-cookie'),/; Secure/);
    const session=await registered.json();
    const cookie=registered.headers.get('set-cookie').split(';')[0];
    const me=await fetch(url+'/api/me',{headers:{Host:headers.Host,Cookie:cookie}});
    assert.equal((await me.json()).user.handle,'deploy_test');
    assert.equal((await fetch(url+'/api/logout',{method:'POST',headers:{...headers,Cookie:cookie},body:'{}'})).status,403);
    const logout=await fetch(url+'/api/logout',{method:'POST',headers:{...headers,Cookie:cookie,'X-CSRF-Token':session.csrf},body:'{}'});
    assert.equal(logout.status,200);
    assert.match(logout.headers.get('set-cookie'),/; Secure/);
  } finally { await server.close(); }
});

test('external listener requires an exact HTTPS origin', async () => {
  await assert.rejects(createApp({listenHost:'0.0.0.0'}));
  for(const publicOrigin of ['http://example.com','https://example.com/path','https://example.com/','https://user:pass@example.com']) await assert.rejects(createApp({publicOrigin}));
});

test('deploy verifies demo ownership only in the release that assigns it', async () => {
  // A later consensual transfer by the real owner must not block future releases.
  const { readFileSync } = await import('node:fs');
  const install = readFileSync(new URL('../../deploy/install.sh', import.meta.url), 'utf8').split('\n');
  const start = install.findIndex(line => line.startsWith('if test -n "${DEMO_OWNER_HANDLE:-}" && ! test -f "$root/demo-owner-assigned-v1"; then'));
  const end = install.findIndex((line, i) => i > start && line === 'fi');
  assert(start >= 0 && end > start);
  const ownership = /demo-ownership(-cli)?\.mjs|demoOwnershipPlan|transferDemoOwnership/;
  const calls = install.map((line, i) => [line, i]).filter(([line]) => ownership.test(line));
  assert.deepEqual(calls.filter(([line]) => line.includes('demo-ownership-cli.mjs')).map(([line]) => /--(apply|check)\b/.exec(line)?.[1]), ['apply', 'check']);
  for (const [line, i] of calls) { assert(i > start && i < end, line); assert(!line.includes('||'), line); }
  assert(end < install.findIndex(line => line.startsWith('published=true')));
  const workflow = readFileSync(new URL('../../.github/workflows/vds-deploy.yml', import.meta.url), 'utf8');
  assert(!ownership.test(workflow));
});
