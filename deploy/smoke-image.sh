#!/usr/bin/env bash
set -euo pipefail
image=${1:?Image required}
sandbox=$(mktemp -d)
trap 'sudo rm -rf "$sandbox"' EXIT
chmod 755 "$sandbox"
mkdir "$sandbox/data"
sudo chown 1000:1000 "$sandbox/data"
# Reproduce the actual cold schema-11 → 12 path as the image's node user.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges -v "$sandbox/data:/data" -v "$PWD/server/tests/fixtures/schema-v11.sql:/schema.sql:ro" "$image" node --input-type=module -e "import {readFileSync} from 'node:fs'; import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('/data/community.sqlite'); d.exec(readFileSync('/schema.sql','utf8')); d.exec(\"INSERT INTO users(id,handle,name,password,created_at) VALUES('u','keep','Keep','unchanged',1)\");d.close();" </dev/null
# Same temporary-copy operation used by install.sh, including read-only mount.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev -v "$sandbox/data:/backup:ro" "$image" node --input-type=module -e "import {cpSync} from 'node:fs'; import {openDatabase} from './server/database.mjs'; import sharp from 'sharp'; import {encodeImage} from './server/media.mjs';cpSync('/backup','/tmp/check',{recursive:true});const d=openDatabase('/tmp/check/community.sqlite');if(d.prepare('PRAGMA user_version').get().user_version!==12||d.prepare('SELECT handle FROM users').get().handle!=='keep')throw Error('Migration failed');d.close();const input=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();const out=await encodeImage(input,'image/png');if(out.width!==20)throw Error('Image runtime failed');console.log('PASS: packaged image migrates cold copy and processes images as node');" </dev/null
# Verify the source mount was never migrated.
docker run --rm --network none -v "$sandbox/data:/data:ro" "$image" node --input-type=module -e "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/data/community.sqlite',{readOnly:true});if(d.prepare('PRAGMA user_version').get().user_version!==11)throw Error('Original changed');d.close();" </dev/null
