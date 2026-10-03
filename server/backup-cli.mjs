import { backupKey, createBackup, restoreBackup } from './backup.mjs';
process.umask(0o077);
const [command, source, destination, ...extra] = process.argv.slice(2);
try {
  if (!['create', 'restore'].includes(command) || !source || !destination || extra.length) throw Error('Usage: node server/backup-cli.mjs create|restore SOURCE NEW_DESTINATION');
  const key = backupKey(process.env.WR_BACKUP_KEY);
  delete process.env.WR_BACKUP_KEY;
  const result = await (command === 'create' ? createBackup : restoreBackup)(source, destination, key);
  key.fill(0);
  console.log(JSON.stringify({ ok: true, ...result }));
} catch {
  // Do not print paths, SQL, content, keys, or cryptographic error internals.
  console.error('Backup operation failed. Check key, schema, permissions, archive and unused destination.');
  process.exitCode = 1;
}
