const DAY=86400000;
export function contactPolicy(input={}){
 const policy={daily:10,newDaily:3,cooldownSeconds:60,newCooldownSeconds:300,newAccountHours:24,...input};
 for(const [key,value] of Object.entries(policy))if(!['daily','newDaily','cooldownSeconds','newCooldownSeconds','newAccountHours'].includes(key)||!Number.isSafeInteger(value)||value<1||value>({daily:100,newDaily:100,cooldownSeconds:86400,newCooldownSeconds:86400,newAccountHours:168}[key]))throw Error('Invalid direct contact policy: '+key);
 if(policy.newDaily>policy.daily||policy.newCooldownSeconds<policy.cooldownSeconds)throw Error('New account contact policy must not be less restrictive.');
 return Object.freeze(policy);
}
export function contactBudget(db,user,time,policy){
 const fresh=time<user.created_at+policy.newAccountHours*3600000;
 const limit=fresh?policy.newDaily:policy.daily,cooldownSeconds=fresh?policy.newCooldownSeconds:policy.cooldownSeconds;
 const row=db.prepare(`SELECT count(*) used,min(created_at) oldest,max(created_at) latest FROM direct_conversations WHERE requester_id=? AND created_at>?`).get(user.id,time-DAY);
 let nextAllowedAt=Math.max(time,row.latest===null?time:row.latest+cooldownSeconds*1000,row.used>=limit?row.oldest+DAY:time);
 if(fresh&&nextAllowedAt>time){
  const matureAt=user.created_at+policy.newAccountHours*3600000;
  const mature=db.prepare('SELECT count(*) used,min(created_at) oldest,max(created_at) latest FROM direct_conversations WHERE requester_id=? AND created_at>?').get(user.id,matureAt-DAY);
  nextAllowedAt=Math.min(nextAllowedAt,Math.max(matureAt,mature.latest===null?matureAt:mature.latest+policy.cooldownSeconds*1000,mature.used>=policy.daily?mature.oldest+DAY:matureAt));
 }
 return {limit,used:row.used,remaining:Math.max(0,limit-row.used),cooldownSeconds,newAccount:fresh,nextAllowedAt,retryAfterSeconds:Math.max(0,Math.ceil((nextAllowedAt-time)/1000))};
}
