import crypto from 'crypto';
import { redis, getSession, body, hashPw, deleteSite, getConfig, cleanCfg, getChannels, cleanChannel, log } from '../_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!getSession(req, 'admin')) return res.status(401).json({ error: 'Login karo' });
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = body(req), { a, name, value } = b;
    const u = String(b.u || '').toLowerCase().trim();
    const userSites = x => redis.smembers(`usites:${x}`);
    const exists = async () => (await redis.hget(`user:${u}`, 'banned')) !== null;
    let out = {};

    if (a === 'ban' || a === 'unban') {
      if (!await exists()) return res.status(404).json({ error: 'User nahi mila' });
      await redis.hset(`user:${u}`, { banned: a === 'ban' ? '1' : '0' });
      for (const s of await userSites(u)) await redis.hset(`site:${s}`, { disabled: a === 'ban' ? '1' : '0' });
      await log('admin', `${a === 'ban' ? 'Ban' : 'Unban'}: ${u}`);
    } else if (a === 'deluser') {
      for (const s of await userSites(u)) await deleteSite(s);
      await redis.del(`user:${u}`, `usites:${u}`); await redis.srem('users:all', u); await log('admin', `User delete: ${u}`);
    } else if (a === 'resetpw') {
      if (String(value || '').length < 8) return res.status(400).json({ error: 'Password kam se kam 8 characters' });
      if (!await exists()) return res.status(404).json({ error: 'User nahi mila' });
      await redis.hset(`user:${u}`, { pass: hashPw(String(value)) }); await log('admin', `Password reset: ${u}`);
    } else if (a === 'adduser') {
      if (!/^[a-z0-9_]{3,20}$/.test(u)) return res.status(400).json({ error: 'Username 3-20 chars (a-z, 0-9, _)' });
      if (String(value || '').length < 8) return res.status(400).json({ error: 'Password kam se kam 8 characters' });
      if (!await redis.hsetnx(`user:${u}`, 'pass', hashPw(String(value)))) return res.status(409).json({ error: 'Ye username already hai' });
      await redis.hset(`user:${u}`, { created: Date.now(), banned: '0', last: 0 }); await redis.sadd('users:all', u); await log('admin', `User add kiya: ${u}`);
    } else if (a === 'setlimit') {
      if (!await exists()) return res.status(404).json({ error: 'User nahi mila' });
      const n = parseInt(value, 10);
      if (!n || n < 1) await redis.hdel(`user:${u}`, 'limit'); else await redis.hset(`user:${u}`, { limit: Math.min(n, 999) });
      await log('admin', `Site limit ${u}: ${n || 'default'}`);
    } else if (a === 'delsite') { await deleteSite(String(name)); await log('admin', `Site delete: ${name}`); }
    else if (a === 'togglesite') {
      const cur = await redis.hget(`site:${name}`, 'disabled'); if (cur === null) return res.status(404).json({ error: 'Site nahi mili' });
      await redis.hset(`site:${name}`, { disabled: String(cur) === '1' ? '0' : '1' }); await log('admin', `Site toggle: ${name}`);
    } else if (a === 'savecfg') {
      const cur = await getConfig(); await redis.set('cfg', cleanCfg(b.cfg || {}, cur)); await log('admin', 'Settings save hui');
    } else if (a === 'chsave') {
      const list = await getChannels(); const c = cleanChannel(b.ch || {});
      const i = list.findIndex(x => x.id === b.ch?.id);
      if (i >= 0) list[i] = { ...list[i], ...c }; else { if (list.length >= 30) return res.status(400).json({ error: 'Max 30 channels' }); list.push({ id: crypto.randomBytes(4).toString('hex'), ...c }); }
      await redis.set('channels', list); await log('admin', `Channel ${i >= 0 ? 'edit' : 'add'}: ${c.name}`);
    } else if (a === 'chdel') {
      const list = (await getChannels()).filter(x => x.id !== b.id); await redis.set('channels', list); await redis.del(`chc:${b.id}`); await log('admin', 'Channel delete');
    } else if (a === 'chmove') {
      const list = await getChannels(); const i = list.findIndex(x => x.id === b.id), j = i + (value === 'up' ? -1 : 1);
      if (i >= 0 && j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; await redis.set('channels', list); }
    } else if (a === 'chtoggle') {
      const list = await getChannels(); const c = list.find(x => x.id === b.id); if (c) { c.on = !c.on; await redis.set('channels', list); }
    } else if (a === 'clearlog') await redis.del('log');
    else return res.status(400).json({ error: 'Bad action' });
    return res.json({ ok: true, ...out });
  } catch (e) { return res.status(400).json({ error: e.message || 'Error' }); }
}
