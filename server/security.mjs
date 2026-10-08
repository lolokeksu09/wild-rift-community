import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('hex');
export const digest = s => createHash('sha256').update(s).digest('hex');
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, options);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function passwordMatches(password, encoded) {
  const [, salt, hash] = encoded.split('$');
  const candidate = (await passwordHash(password, salt)).split('$')[2];
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(candidate, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function fail(status, message) { throw new HttpError(status, message); }
export function text(value, label, min, max) {
  if (typeof value !== 'string') fail(422, `${label}: ожидается текст.`);
  const result = value.trim();
  if (result.length < min || result.length > max) fail(422, `${label}: от ${min} до ${max} символов.`);
  return result;
}
export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(422, 'Пароль: от 12 до 128 символов.');
  return value;
}
export async function jsonBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Ожидается JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) fail(413, 'Запрос слишком большой.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'Некорректный JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Ожидается объект JSON.');
  return data;
}
