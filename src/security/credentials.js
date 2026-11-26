import { createHash, randomBytes, timingSafeEqual, pbkdf2 as pbkdf2Callback } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
const ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [scheme, digest, iterationsText, saltText, hashText] = encoded.split('$');
    const iterations = Number(iterationsText);
    if (scheme !== 'pbkdf2' || digest !== DIGEST || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const salt = Buffer.from(saltText, 'base64url');
    if (expected.length !== KEY_LENGTH || salt.length !== 16) return false;
    const actual = await pbkdf2(password, salt, iterations, KEY_LENGTH, digest);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashOpaqueToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function safeEqualBuffers(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && timingSafeEqual(left, right);
}

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}
