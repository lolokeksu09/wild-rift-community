// Only operator tooling writes this marker. Profile updates use a field allowlist.
import {createHash} from 'node:crypto';
export const demoId=value=>{const h=createHash('sha256').update('wr-community-demo-v1:'+value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
export const demoClubIds=new Set(Array.from({length:6},(_,i)=>demoId('club:'+i)));
export function isDemo(user) {
  return Boolean(user && JSON.parse(user.game_profile||'{}').demoBot==='community-v1');
}
