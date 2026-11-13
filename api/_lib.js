import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const E = process.env;
const clean = v => String(v ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
let URL_ = clean(E.UPSTASH_REDIS_REST_URL || E.KV_REST_API_URL), TOKEN = clean(E.UPSTASH_REDIS_REST_TOKEN || E.KV_REST_API_TOKEN);
if (/^rediss?:\/\//i.test(URL_)) { // galti se redis:// wala URL paste kiya ho to REST URL + token nikaal lo
  try { const x = new URL(URL_); if (!TOKEN) TOKEN = decodeURIComponent(x.password); URL_ = 'https://' + x.hostname; } catch {}
}
if (URL_ && !/^https?:\/\//i.test(URL_)) URL_ = 'https://' + URL_;
URL_ = URL_.replace(/\/+$/, '');
const ADMIN_PW = clean(E.ADMIN_PASSWORD || E.ADMIN_PASS);
export const adminPw = () => ADMIN_PW;

export const envStatus = () => {
  const missing = []; if (!URL_) missing.push('UPSTASH_REDIS_REST_URL'); if (!TOKEN) missing.push('UPSTASH_REDIS_REST_TOKEN'); if (!ADMIN_PW) missing.push('ADMIN_PASSWORD');
  return { redis: !!(URL_ && TOKEN), adminPassword: !!ADMIN_PW, adminPasswordStrong: ADMIN_PW.length >= 8, missing };
};
export function explain(e) {
  const m = String(e?.message || e);
  if (/NOPERM/i.test(m)) return 'Upstash token read-only hai. "Read-Only" nahi, normal REST TOKEN use karo.';
  if (/unauthor|wrongpass|invalid token|NOAUTH|forbidden/i.test(m)) return 'Upstash TOKEN galat hai. Upstash > REST API se UPSTASH_REDIS_REST_TOKEN dobara copy karo.';
  if (/fetch failed|ENOTFOUND|invalid url|failed to parse|EAI_AGAIN|missing\.invalid|ECONN/i.test(m)) return 'Upstash URL galat hai. https://....upstash.io wala REST URL chahiye.';
  return 'Upstash se connect nahi ho paya: ' + m.slice(0, 120);
}
export const redis = new Redis({ url: URL_ || 'https://missing.invalid', token: TOKEN || 'missing' });

/* ---------- sessions (signed cookies) ---------- */
const secret = () => clean(E.SESSION_SECRET) || crypto.createHash('sha256').update('gh|' + (TOKEN || '')).digest('hex');
// admin sessions are also bound to ADMIN_PASSWORD: change the env password => everyone is logged out
const sign = (p, role) => crypto.createHmac('sha256', secret() + (role === 'admin' ? ADMIN_PW : '')).update(p).digest('base64url');
export const COOKIE = { user: 'gu', admin: 'ga' };
const cookiePath = { user: '/', admin: '/' };

export function makeSession(u, role, hours = 24) {
  const p = Buffer.from(JSON.stringify({ u, role, exp: Date.now() + hours * 36e5 })).toString('base64url');
  return p + '.' + sign(p, role);
}
export function getSession(req, role) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE[role] + '=([^;]+)'));
  if (!m) return null;
  const [p, s] = m[1].split('.');
  if (!p || !s) return null;
  const a = Buffer.from(sign(p, role)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp > Date.now() && d.role === role ? d : null; } catch { return null; }
}
export const setCookie = (res, role, v, maxAge) =>
  res.setHeader('Set-Cookie', `${COOKIE[role]}=${v}; HttpOnly; Secure; SameSite=Strict; Path=${cookiePath[role]}; Max-Age=${maxAge}`);

/* ---------- passwords ---------- */
export const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
export const checkPw = (pw, st) => {
  const [salt, h] = String(st || ':').split(':');
  const x = hashPw(pw, salt).split(':')[1];
  return x.length === (h || '').length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h));
};
export const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/* ---------- misc helpers ---------- */
export async function limited(req, key, max, secs) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const k = `rl:${key}:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, secs);
  return n > max;
}
export const body = req => (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body : (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })();
export async function rawBody(req, limit) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('too big'); chunks.push(c); }
  return Buffer.concat(chunks);
}
export const day = (ago = 0) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);
export async function bump(kind) { const k = `st:${kind}:${day()}`; const n = await redis.incr(k); if (n === 1) await redis.expire(k, 60 * 86400); return n; }
export async function log(type, msg) {
  try { await redis.lpush('log', { t: Date.now(), type, msg: String(msg).slice(0, 200) }); await redis.ltrim('log', 0, 199); } catch {}
}

export async function userAuth(req) {
  const s = getSession(req, 'user'); if (!s) return null;
  const b = await redis.hget(`user:${s.u}`, 'banned');
  return (b === null || String(b) === '1') ? null : s.u;
}
export async function deleteSite(name) {
  const owner = await redis.hget(`site:${name}`, 'owner');
  await redis.del(`files:${name}`, `site:${name}`); await redis.srem('sites:all', name);
  if (owner) await redis.srem(`usites:${owner}`, name);
}

/* ---------- admin-editable settings (stored in Redis, not env) ---------- */
export const DEFAULTS = {
  name: 'Genius Hosting', logo: '🚀', tagline: 'Free static website hosting',
  heroTitle: 'Apni website free mein host karo', heroText: 'ZIP upload karo, turant link pao. Koi server, koi setup nahi.',
  accent: '#4f8cff', siteUrl: '', footer: '', devName: '', devLink: '', contact: '', seoDesc: 'Free static website hosting. Upload a ZIP and go live in seconds.',
  announceOn: false, announce: '',
  signupOpen: true, maintenance: false, maintenanceMsg: 'Site maintenance mein hai. Thodi der baad aao.',
  maxSites: 5, maxFiles: 200, maxZipMB: 4, blocked: 'admin, api, login, signup'
};
const S = (v, n) => String(v ?? '').trim().slice(0, n);
const B = v => v === true || v === 'true' || v === 1 || v === '1';
const N = (v, a, b, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const CLEAN = {
  name: v => S(v, 40) || DEFAULTS.name, logo: v => S(v, 300) || '🚀', tagline: v => S(v, 120), heroTitle: v => S(v, 120), heroText: v => S(v, 300),
  siteUrl: v => /^https?:\/\/[^\s]+$/i.test(String(v).trim()) ? String(v).trim().replace(/\/+$/, '') : '', accent: v => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : DEFAULTS.accent, footer: v => S(v, 200), devName: v => S(v, 60), devLink: v => /^https?:\/\/[^\s]+$/i.test(String(v).trim()) ? String(v).trim().slice(0, 300) : '', contact: v => S(v, 200), seoDesc: v => S(v, 200),
  announceOn: B, announce: v => S(v, 300), signupOpen: B, maintenance: B, maintenanceMsg: v => S(v, 300),
  maxSites: v => N(v, 1, 100, 5), maxFiles: v => N(v, 1, 1000, 200), maxZipMB: v => N(v, 1, 4, 4), blocked: v => S(v, 400)
};
export const cleanCfg = (input, cur) => { const o = { ...cur }; for (const k in CLEAN) if (k in input) o[k] = CLEAN[k](input[k]); return o; };
export async function getConfig() { const c = await redis.get('cfg'); return { ...DEFAULTS, ...(c && typeof c === 'object' ? c : {}) }; }

export const PLATFORMS = ['telegram', 'whatsapp', 'youtube', 'instagram', 'discord', 'twitter', 'facebook', 'website', 'other'];
export async function getChannels() { const c = await redis.get('channels'); return Array.isArray(c) ? c : []; }
export function cleanChannel(i) {
  const platform = PLATFORMS.includes(i.platform) ? i.platform : 'other';
  let url = S(i.url, 300);
  if (url.startsWith('@')) url = 'https://t.me/' + url.slice(1);
  else if (/^t\.me\//i.test(url)) url = 'https://' + url;
  else if (!/^[a-z]+:\/\//i.test(url) && url.includes('.')) url = 'https://' + url;
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Link sahi daalo (https://t.me/... ya @username)');
  const name = S(i.name, 60); if (!name) throw new Error('Channel ka naam likho');
  return { name, url, platform, desc: S(i.desc, 120), on: i.on === undefined ? true : B(i.on) };
}
