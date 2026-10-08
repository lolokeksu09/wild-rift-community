import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { fail, HttpError } from './security.mjs';
import { transaction } from './database.mjs';
sharp.cache(false);
sharp.concurrency(1);
const MAX_BYTES=5*1024*1024,UNATTACHED_MS=24*60*60*1000;
export async function readImage(req) {
  if (!['image/jpeg','image/png','image/webp'].includes(req.headers['content-type'])) fail(415,'Выбери JPEG, PNG или WebP.');
  if(Number(req.headers['content-length'])>MAX_BYTES) fail(413,'Изображение должно быть не больше 5 МБ.');
  const parts=[];let size=0;
  for await(const part of req){size+=part.length;if(size>MAX_BYTES)fail(413,'Изображение должно быть не больше 5 МБ.');parts.push(part);}
  if(!size)fail(422,'Файл пустой.');
  return Buffer.concat(parts);
}
export async function encodeImage(input, contentType) {
  const format=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':input[0]===255&&input[1]===216&&input[2]===255?'jpeg':input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(format==='png') {
    for(let offset=8;offset+12<=input.length;){
      const length=input.readUInt32BE(offset);
      if(input.toString('ascii',offset+4,offset+8)==='acTL')fail(422,'Анимированные изображения не поддерживаются.');
      offset+=length+12;
    }
  }
  if(!format || (contentType && contentType!=='image/'+format))fail(422,'Содержимое файла не соответствует поддерживаемому формату.');
  try {
    const options={limitInputPixels:16000000,failOn:'warning'};
    const metadata=await sharp(input,options).metadata();
    if(!['jpeg','png','webp'].includes(metadata.format)||metadata.pages>1)fail(422,'Поддерживаются только неподвижные JPEG, PNG и WebP.');
    const {data,info}=await sharp(input,options).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
    if(data.length>1024*1024)fail(413,'Слишком сложное изображение. Уменьши его размер.');
    return {bytes:data,width:info.width,height:info.height,size:data.length};
  } catch(e){if(e instanceof HttpError)throw e;fail(422,'Не удалось прочитать изображение. Проверь формат и размер.');}
}
export function saveImage(db,user,clientId,input,encoded,now) {
  const signature=createHash('sha256').update(input).digest('hex');
  return transaction(db,()=>{
    const old=db.prepare('SELECT id,signature,width,height,size FROM media WHERE owner_id=? AND client_id=?').get(user.id,clientId);
    if(old){if(old.signature!==signature)fail(409,'Идентификатор загрузки уже использован для другого файла.');return {image:{id:old.id,width:old.width,height:old.height,size:old.size},replayed:true};}
    // Uploads never attached anywhere expire after a day instead of holding the shared quota forever.
    db.prepare(`DELETE FROM media WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM post_drafts WHERE image_id=media.id) AND NOT EXISTS(SELECT 1 FROM posts WHERE image_id=media.id)
      AND NOT EXISTS(SELECT 1 FROM clubs WHERE cover_id=media.id) AND NOT EXISTS(SELECT 1 FROM users WHERE avatar_id=media.id OR cover_id=media.id)`).run(now()-UNATTACHED_MS);
    const own=db.prepare('SELECT coalesce(sum(size),0) AS size FROM media WHERE owner_id=?').get(user.id).size;
    const total=db.prepare('SELECT coalesce(sum(size),0) AS size FROM media').get().size;
    if(own+encoded.size>50*1024*1024 || total+encoded.size>500*1024*1024)fail(413,'Лимит хранения изображений достигнут.');
    const id=randomUUID();db.prepare('INSERT INTO media(id,owner_id,client_id,signature,bytes,width,height,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,user.id,clientId,signature,encoded.bytes,encoded.width,encoded.height,encoded.size,now());
    return {image:{id,width:encoded.width,height:encoded.height,size:encoded.size},replayed:false};
  });
}
export function ownedImage(db,id,user) {
  if(id===null)return null;
  if(typeof id!=='string'||!db.prepare('SELECT id FROM media WHERE id=? AND owner_id=?').get(id,user.id))fail(403,'Изображение недоступно для этой операции.');
  // A private post attachment must never become a public avatar or cover.
  if(db.prepare('SELECT club_id FROM post_drafts WHERE image_id=?').get(id)||db.prepare('SELECT id FROM posts WHERE image_id=?').get(id)||db.prepare('SELECT id FROM clubs WHERE cover_id=?').get(id)||db.prepare('SELECT id FROM users WHERE avatar_id=? OR cover_id=?').get(id,id))fail(409,'Изображение уже используется. Для нового места загрузи его отдельно.');
  return id;
}
export function imageAttached(db,id) {
  return !!(db.prepare('SELECT club_id FROM post_drafts WHERE image_id=?').get(id)||db.prepare('SELECT id FROM posts WHERE image_id=?').get(id)||db.prepare('SELECT id FROM clubs WHERE cover_id=?').get(id)||db.prepare('SELECT id FROM users WHERE avatar_id=? OR cover_id=?').get(id,id));
}
