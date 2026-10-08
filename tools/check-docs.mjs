import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {dirname, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(root).filter(name => name.endsWith('.md')).map(name => resolve(root, name));
function collect(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.md')) files.push(path);
  }
}
for (const directory of ['docs']) collect(resolve(root, directory));
let checked = 0;
const errors = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8').replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of source.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const local = target.split(/[?#]/)[0];
    let decoded;
    try { decoded = decodeURIComponent(local); } catch { errors.push(`${relative(root, file)}: invalid URL ${target}`); continue; }
    const destination = resolve(dirname(file), decoded);
    const rel = relative(root, destination);
    checked++;
    if (rel === '..' || rel.startsWith('..' + sep) || !existsSync(destination)) errors.push(`${relative(root, file)}: missing/outside repository ${target}`);
    else if (!statSync(destination).isFile() && !statSync(destination).isDirectory()) errors.push(`${relative(root, file)}: invalid target ${target}`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Documentation: ${files.length} Markdown files, ${checked} local targets valid (external URLs and anchors not checked).`);
