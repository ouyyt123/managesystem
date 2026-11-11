import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export const ROLES = {
  ADMIN: { code: 'ADMIN', name: '系统管理员', tone: 'indigo' },
  RESEARCH_MANAGER: { code: 'RESEARCH_MANAGER', name: '科研管理员', tone: 'violet' },
  PROJECT_MANAGER: { code: 'PROJECT_MANAGER', name: '项目经理', tone: 'cyan' },
  VIEWER: { code: 'VIEWER', name: '查看/展示', tone: 'slate' }
};

export function hashPassword(raw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(raw), salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(raw, stored) {
  try {
    const [scheme, iterations, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2' || !salt || !hash) return false;
    const actual = crypto.pbkdf2Sync(String(raw), salt, Number(iterations) || ITERATIONS, KEY_LENGTH, DIGEST);
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function loadSecret(dataDir) {
  if (process.env.APP_TOKEN_SECRET) return process.env.APP_TOKEN_SECRET;
  const file = path.join(dataDir, 'token.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, 'utf8');
  return secret;
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text) {
  const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

/** 轻量 HMAC 签名 Token，结构与需求文档 7.2 一致 */
export function signToken(userId, secret, hours = 12) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + hours * 3600 * 1000 }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function readToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(unb64url(payload).toString('utf8'));
    if (!data.uid || !data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function uuid() {
  return crypto.randomUUID();
}
