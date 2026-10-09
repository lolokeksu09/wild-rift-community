const {JSDOM}=require('jsdom'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const dom=new JSDOM('<section id="root"></section>',{url:'https://example.test/tournaments?id=1',runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('#root');
 const data={tournament:{id:1,title:'Cup',state:'open',capacity:4,owner_id:'captain'},teams:[{id:1,name:'Alpha',captain_id:'captain',memberCount:1,pendingCount:0,roster_required:1}],matches:[],roster:[{user_id:'captain',handle:'captain',status:'accepted'}],myTeam:1};
 const waits=new Map(),calls=[];
 const api=async(p,m,b)=>{calls.push({p,m,b});if(p.includes('/invite-candidates'))return new Promise(resolve=>waits.set(new URL('https://example.test'+p).searchParams.get('q'),resolve));return structuredClone(data);};
 const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+root.textContent);};
 try{
  w.eval(fs.readFileSync(path.join(__dirname,'../server/public/tournaments.js'),'utf8'));
  const controller=w.createTournaments({root,user:{id:'captain'},api});
  await until(()=>root.querySelector('[data-tournament-invite]'));
  const input=root.querySelector('[name=handle]'),query=value=>{input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  query('older');await until(()=>waits.has('older'));query('newer');await until(()=>waits.has('newer'));
  waits.get('newer')({viewerId:'captain',freeSlots:4,players:[{handle:'newer_player',name:'<img src=x>',avatarId:null}]});
  await until(()=>root.querySelector('[data-invite-player]'));assert.equal(root.querySelector('img'),null);
  waits.get('older')({viewerId:'captain',freeSlots:4,players:[{handle:'older_player',name:'Old'}]});
  await new Promise(r=>setTimeout(r,20));assert.equal(root.querySelector('[data-invite-player]').dataset.invitePlayer,'newer_player');
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.querySelector('[data-invite-player]'),null);
  assert.equal(calls.filter(c=>c.m==='POST').length,0);
  query('wrong-viewer');await until(()=>waits.has('wrong-viewer'));waits.get('wrong-viewer')({viewerId:'other',freeSlots:4,players:[{handle:'private',name:'Private'}]});
  await new Promise(r=>setTimeout(r,20));assert.equal(root.querySelector('[data-invite-player]'),null);
  query('after-destroy');await until(()=>waits.has('after-destroy'));controller.destroy();root.innerHTML='New screen';waits.get('after-destroy')({viewerId:'captain',freeSlots:4,players:[{handle:'late',name:'Late'}]});
  await new Promise(r=>setTimeout(r,20));assert.equal(root.textContent,'New screen');
  console.log('PASS roster search: stale responses, identity guard, escaping, Escape, no implicit invitation and teardown. DOM only.');
 }finally{dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
