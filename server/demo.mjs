// Only operator tooling writes this marker. Profile updates use a field allowlist.
export function isDemo(user) {
  return Boolean(user && JSON.parse(user.game_profile||'{}').demoBot==='community-v1');
}
