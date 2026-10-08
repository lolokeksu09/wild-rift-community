import {resolve} from 'node:path';
import {openDatabase} from './database.mjs';
import {seedDemoCommunity} from './demo-seed.mjs';
if(process.argv.length!==3)throw Error('Usage: node server/demo-seed-cli.mjs /path/to/community.sqlite');
process.umask(0o077);const db=openDatabase(resolve(process.argv[2]));
try{console.log(JSON.stringify(await seedDemoCommunity(db)));}finally{db.close();}
