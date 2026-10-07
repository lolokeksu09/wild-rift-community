// Moderator removal of reported objects. Each function runs inside the caller's transaction.
// The report keeps a text snapshot, so evidence outlives the removed data.
import {imageAttached} from './media.mjs';
export const REMOVED='[Удалено модерацией]';
const drop=(db,ids)=>{for(const id of ids)if(id&&!imageAttached(db,id))db.prepare('DELETE FROM media WHERE id=?').run(id);};
export function removeClub(db,id){
 const images=[db.prepare('SELECT cover_id FROM clubs WHERE id=?').get(id)?.cover_id,
  ...db.prepare('SELECT image_id FROM posts WHERE club_id=? AND image_id IS NOT NULL').all(id).map(r=>r.image_id),
  ...db.prepare('SELECT image_id FROM post_drafts WHERE club_id=? AND image_id IS NOT NULL').all(id).map(r=>r.image_id)];
 const run=(q)=>db.prepare(q).run(id);
 run('DELETE FROM post_drafts WHERE club_id=?');run('DELETE FROM club_pins WHERE club_id=?');
 run('DELETE FROM posts WHERE club_id=?');
 run('DELETE FROM club_invite_uses WHERE invite_id IN (SELECT id FROM club_invites WHERE club_id=?)');
 run('DELETE FROM club_invites WHERE club_id=?');run('DELETE FROM club_transfers WHERE club_id=?');
 run('DELETE FROM audit WHERE club_id=?');
 // Memberships, moderators, chat messages and polls follow by cascade.
 run('DELETE FROM clubs WHERE id=?');
 drop(db,images);
}
export function closeGroup(db,id,time){
 db.prepare('UPDATE lfg_groups SET closed=1,title=?,description=? WHERE id=?').run(REMOVED,'',id);
 const owner=db.prepare('SELECT owner_id FROM lfg_groups WHERE id=?').get(id).owner_id;
 for(const m of db.prepare("SELECT user_id FROM lfg_members WHERE group_id=? AND user_id<>? AND status IN ('accepted','pending')").all(id,owner))
  db.prepare("INSERT INTO lfg_notifications(user_id,group_id,kind,created_at) VALUES(?,?,'closed',?)").run(m.user_id,id,time);
 db.prepare('DELETE FROM lfg_messages WHERE group_id=?').run(id);
}
export function cancelEvent(db,id,time){
 db.prepare('UPDATE game_events SET cancelled=1,title=?,description=? WHERE id=?').run(REMOVED,'',id);
 const owner=db.prepare('SELECT owner_id FROM game_events WHERE id=?').get(id).owner_id;
 for(const s of db.prepare('SELECT user_id FROM event_slots WHERE event_id=? AND user_id IS NOT NULL AND user_id<>?').all(id,owner))
  db.prepare("INSERT INTO event_notifications(user_id,event_id,kind,created_at) VALUES(?,?,'cancelled',?)").run(s.user_id,id,time);
 db.prepare('DELETE FROM event_messages WHERE event_id=?').run(id);
}
