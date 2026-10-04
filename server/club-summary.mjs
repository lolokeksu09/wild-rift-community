import {isDemo,demoClubIds} from './demo.mjs';
export function clubSummary(db,club,user) {
  const viewer=user?.id||'';
  const bots=db.prepare("SELECT count(*) n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=? AND m.status='member' AND json_extract(u.game_profile,'$.demoBot')='community-v1'").get(club.id).n;
  const isDemoClub=demoClubIds.has(club.id)||isDemo(db.prepare('SELECT game_profile FROM users WHERE id=?').get(club.owner_id));
  const canRead=club.membership!=='banned'&&(club.access==='open'||club.membership==='member');
  const lastPost=canRead?db.prepare(`SELECT p.id,p.title,p.created_at FROM posts p WHERE p.club_id=:club AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:viewer AND b.target_id=p.author_id) OR (b.target_id=:viewer AND b.blocker_id=p.author_id)) ORDER BY p.id DESC LIMIT 1`).get({club:club.id,viewer})||null:null;
  return {bots,isDemoClub,lastPost};
}
