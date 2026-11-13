import { redis, makeSession, setCookie, hashPw, checkPw, limited, body, userAuth, getConfig, bump, log } from './_lib.js';
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') { const u = await userAuth(req); return res.json({ user: u }); }
    if (req.method !== 'POST') return res.status(405).end();
    const { action, username, password } = body(req);
    if (action === 'logout') { setCookie(res, 'user', '', 0); return res.json({ ok: true }); }
    const cfg = await getConfig();
    if (cfg.maintenance) return res.status(503).json({ error: cfg.maintenanceMsg || 'Maintenance chal raha hai' });
    const u = String(username || '').toLowerCase().trim(), p = String(password || '');
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return res.status(400).json({ error: 'Username 3-20 chars (a-z, 0-9, _)' });
    if (p.length < 8 || p.length > 100) return res.status(400).json({ error: 'Password kam se kam 8 characters ka ho' });
    if (action === 'signup') {
      if (!cfg.signupOpen) return res.status(403).json({ error: 'Signup abhi band hai' });
      if (await limited(req, 'signup', 5, 3600)) return res.status(429).json({ error: 'Bahut try ho gaye, baad mein aao' });
      const ok = await redis.hsetnx(`user:${u}`, 'pass', hashPw(p));
      if (!ok) return res.status(409).json({ error: 'Ye username le liya gaya hai' });
      await redis.hset(`user:${u}`, { created: Date.now(), banned: '0', last: Date.now() });
      await redis.sadd('users:all', u); await bump('u'); await log('signup', `Naya user: ${u}`);
    } else if (action === 'login') {
      if (await limited(req, 'login', 10, 900)) return res.status(429).json({ error: 'Bahut try ho gaye, 15 min baad aao' });
      const d = await redis.hgetall(`user:${u}`);
      if (!d || !d.pass || !checkPw(p, d.pass)) return res.status(401).json({ error: 'Username ya password galat hai' });
      if (String(d.banned) === '1') return res.status(403).json({ error: 'Aapka account ban hai' });
      await redis.hset(`user:${u}`, { last: Date.now() });
    } else return res.status(400).json({ error: 'Bad action' });
    setCookie(res, 'user', makeSession(u, 'user'), 86400);
    return res.json({ ok: true, user: u });
  } catch (e) { return res.status(500).json({ error: 'Server error' }); }
}
