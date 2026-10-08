import { resolve } from 'node:path';
import { createApp } from './app.mjs';
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.PUBLIC_ORIGIN) throw new Error('Production requires PUBLIC_ORIGIN.');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
process.umask(0o077);
const app = await createApp({
  databasePath: resolve(process.env.COMMUNITY_DB || 'data/community.sqlite'),
  moderatorIds: (process.env.COMMUNITY_MODERATOR_IDS || '').split(',').map(x=>x.trim()).filter(Boolean),
  publicOrigin: production ? process.env.PUBLIC_ORIGIN : null,
  listenHost: production ? '0.0.0.0' : '127.0.0.1',
  proxyClientHeader: production
});
console.log(`Community: ${await app.listen(port)}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
