// Dependency-free check of the security primitives. Run with: node test/crypto.unit.mjs
// (uses Node's built-in TypeScript type stripping, Node >= 22.18).
import assert from 'node:assert/strict';

const c = await import('../src/common/crypto.ts');

const h = await c.hashPassword('correct horse');
assert.ok(await c.verifyPassword('correct horse', h));
assert.ok(!(await c.verifyPassword('wrong', h)));
assert.ok(!(await c.verifyPassword('correct horse', 'garbage')));

const t = c.signJwt({ sub: 'u1' }, 'secret', 60);
assert.equal(c.verifyJwt(t, 'secret').sub, 'u1');
assert.equal(c.verifyJwt(t, 'other'), null, 'wrong secret');
assert.equal(c.verifyJwt(t, 'secret', Date.now() + 61_000), null, 'expired');
const algNone = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${t.split('.')[1]}.`;
assert.equal(c.verifyJwt(algNone, 'secret'), null, 'alg=none must be rejected');
assert.equal(c.verifyJwt('not-a-token', 'secret'), null);

// RFC 6238 Appendix B vectors (SHA-1, secret "12345678901234567890"), truncated to 6 digits.
const secret = c.base32Encode(Buffer.from('12345678901234567890'));
assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.deepEqual(c.base32Decode(secret), Buffer.from('12345678901234567890'));
assert.equal(c.totpCode(secret, 59_000), '287082');
assert.equal(c.totpCode(secret, 1_111_111_109_000), '081804');
assert.equal(c.totpCode(secret, 1_234_567_890_000), '005924');
assert.ok(c.verifyTotp(secret, '287082', 59_000 + 30_000), 'one step of drift is accepted');
assert.ok(!c.verifyTotp(secret, '287082', 59_000 + 90_000), 'three steps of drift is rejected');
assert.ok(!c.verifyTotp(secret, 'abcdef', 59_000));

const key = c.parseKey('00'.repeat(32));
const enc = c.encryptBuffer(Buffer.from('hello'), key);
assert.equal(c.decryptBuffer(enc, key).toString(), 'hello');
enc[30] ^= 1;
assert.throws(() => c.decryptBuffer(enc, key), 'tampered ciphertext must fail authentication');
assert.equal(c.decryptString(c.encryptString('s3cret', key), key), 's3cret');
assert.throws(() => c.parseKey('abcd'));

console.log('crypto primitives ok');
