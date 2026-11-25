import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Passwords (scrypt)                                                  */
/* ------------------------------------------------------------------ */

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = await scrypt(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ------------------------------------------------------------------ */
/* Tokens and hashes                                                   */
/* ------------------------------------------------------------------ */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(secret: string | Buffer, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ------------------------------------------------------------------ */
/* JWT (HS256 only)                                                    */
/* ------------------------------------------------------------------ */

const b64u = (v: Buffer | string): string => Buffer.from(v).toString('base64url');

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/** Returns the payload, or null when the token is malformed, tampered with, not HS256 or expired. */
export function verifyJwt<T = Record<string, any>>(token: string, secret: string, now = Date.now()): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (h.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (!safeEqual(sig, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
    return payload as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* TOTP (RFC 6238, SHA-1, 6 digits, 30 s) for authenticator apps       */
/* ------------------------------------------------------------------ */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = ((value << 5) | B32.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, timeMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Accepts the current code and one step either side to tolerate clock drift. */
export function verifyTotp(secret: string, code: string, timeMs = Date.now()): boolean {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(totpCode(secret, timeMs + drift * 30_000), clean)) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string, issuer = 'HomeOS'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ------------------------------------------------------------------ */
/* Encryption at rest (AES-256-GCM)                                    */
/* ------------------------------------------------------------------ */

export function parseKey(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return key;
}

/** Layout: 12-byte IV | 16-byte auth tag | ciphertext. */
export function encryptBuffer(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < 28) throw new Error('Ciphertext is too short');
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export function encryptString(plain: string, key: Buffer): string {
  return `v1:${encryptBuffer(Buffer.from(plain, 'utf8'), key).toString('base64')}`;
}

export function decryptString(stored: string, key: Buffer): string {
  if (!stored.startsWith('v1:')) throw new Error('Unknown ciphertext format');
  return decryptBuffer(Buffer.from(stored.slice(3), 'base64'), key).toString('utf8');
}
