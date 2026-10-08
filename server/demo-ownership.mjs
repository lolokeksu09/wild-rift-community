import {transaction} from './database.mjs';
import {demoClubs,demoId} from './demo-seed.mjs';
import {isDemo} from './demo.mjs';

export function demoOwnershipPlan(db,handle){
 const target=db.prepare('SELECT id,handle,game_profile FROM users WHERE handle=?').get(handle.toLowerCase());
 if(!target||isDemo(target))throw Error('A real existing owner account is required.');
 const clubs=demoClubs.map((_,i)=>{
  const club=db.prepare('SELECT c.id,c.name,c.owner_id,u.game_profile FROM clubs c JOIN users u ON u.id=c.owner_id WHERE c.id=?').get(demoId('club:'+i));
  if(!club||(club.owner_id!==target.id&&(!isDemo(club)||club.owner_id!==demoId('user:'+i))))throw Error('Demo club missing or ownership changed; no clubs will be modified.');
  if(db.prepare('SELECT status FROM memberships WHERE club_id=? AND user_id=?').get(club.id,target.id)?.status==='banned')throw Error('Target owner is banned from a demo club; resolve explicitly first.');
  return {id:club.id,name:club.name,oldOwner:club.owner_id,changed:club.owner_id!==target.id};
 });
 return {target,clubs};
}
export function transferDemoOwnership(db,handle,now=Date.now()){
 return transaction(db,()=>{
  const plan=demoOwnershipPlan(db,handle);
  for(const c of plan.clubs){
   if(!c.changed)continue;
   db.prepare("INSERT INTO memberships VALUES(?,?,'member') ON CONFLICT(club_id,user_id) DO UPDATE SET status='member'").run(c.id,plan.target.id);
   db.prepare('UPDATE clubs SET owner_id=?,settings_version=settings_version+1 WHERE id=?').run(plan.target.id,c.id);
   db.prepare('DELETE FROM club_moderators WHERE club_id=? AND user_id IN (?,?)').run(c.id,c.oldOwner,plan.target.id);
   db.prepare('UPDATE club_invites SET revoked=1 WHERE club_id=?').run(c.id);
   db.prepare("UPDATE club_transfers SET status='cancelled' WHERE club_id=? AND status='pending'").run(c.id);
   db.prepare('INSERT INTO audit(actor_id,club_id,target_id,action,created_at) VALUES(?,?,?,?,?)').run(plan.target.id,c.id,c.oldOwner,'owner-operator-transfer',now);
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Ownership integrity check failed.');
  return {owner:plan.target.handle,changed:plan.clubs.filter(c=>c.changed).length,clubs:plan.clubs.map(c=>({id:c.id,name:c.name}))};
 });
}
