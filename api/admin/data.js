import { redis, getSession, getConfig, getChannels, envStatus, day, explain } from '../_lib.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!getSession(req, 'admin')) return res.status(401).json({ error: 'Login karo' });
  try {
    const [us, ss, cfg, channels, logs] = await Promise.all([redis.smembers('users:all'), redis.smembers('sites:all'), getConfig(), getChannels(), redis.lrange('log', 0, 99)]);
    const U = us.slice(0, 1000), S = ss.slice(0, 1000);
    const p = redis.pipeline(); U.forEach(u => { p.hmget(`user:${u}`, 'created', 'banned', 'last', 'limit'); p.scard(`usites:${u}`); });
    const q = redis.pipeline(); S.forEach(s => q.hgetall(`site:${s}`));
    const days = [...Array(14)].map((_, i) => day(13 - i));
    const keys = [...days.map(d => `st:u:${d}`), ...days.map(d => `st:v:${d}`), ...days.map(d => `st:s:${d}`), ...channels.map(c => `chc:${c.id}`)];
    const [ur, sr, st] = await Promise.all([U.length ? p.exec() : [], S.length ? q.exec() : [], keys.length ? redis.mget(...keys) : []]);
    const users = U.map((u, i) => { const m = ur[2 * i] || {}; return { u, created: +m.created || 0, last: +m.last || 0, limit: +m.limit || 0, banned: String(m.banned) === '1', sites: ur[2 * i + 1] || 0 }; })
      .sort((a, b) => b.created - a.created);
    const sites = S.map((n, i) => ({ name: n, ...sr[i] })).sort((a, b) => (+b.created || 0) - (+a.created || 0));
    const n = (x) => +x || 0;
    const chart = days.map((d, i) => ({ d, users: n(st[i]), visits: n(st[14 + i]), uploads: n(st[28 + i]) }));
    const chs = channels.map((c, i) => ({ ...c, clicks: n(st[42 + i]) }));
    return res.json({
      cfg, channels: chs, users, sites, chart, logs,
      totals: { users: us.length, sites: ss.length, visits: sites.reduce((a, s) => a + n(s.visits), 0), bytes: sites.reduce((a, s) => a + n(s.size), 0), banned: users.filter(u => u.banned).length },
      env: envStatus(), now: Date.now()
    });
  } catch (e) { return res.status(500).json({ error: explain(e) }); }
}
