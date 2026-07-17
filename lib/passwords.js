// Node.js標準の crypto.scrypt を使ったパスワードハッシュ(外部パッケージ不要)。
const crypto = require('crypto');

function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verify(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, key] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(key, 'hex');
  const b = Buffer.from(derived, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hash, verify };
