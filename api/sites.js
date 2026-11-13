import JSZip from 'jszip';
import { redis, body, rawBody, userAuth, deleteSite, getConfig, limited, bump, log } from './_lib.js';

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json', webmanifest: 'application/manifest+json', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', map: 'application/json'
};
// Upstash free plan: max ~1MB per request, so a single file is capped and writes are batched.
const MAX_FILE = 600 * 1024, BATCH = 700 * 1024;

export default async function handler(req, res) {
  try {
    const u = await userAuth(req); if (!u) return res.status(401).json({ error: 'Pehle login karo' });
    const cfg = await getConfig();
    const limit = Number(await redis.hget(`user:${u}`, 'limit')) || cfg.maxSites;

    if (req.method === 'GET') {
      const names = await redis.smembers(`usites:${u}`); const p = redis.pipeline();
      names.forEach(n => p.hgetall(`site:${n}`)); const r = names.length ? await p.exec() : [];
      return res.json({ sites: names.map((n, i) => ({ name: n, ...r[i] })), limit });
    }
    if (req.method === 'DELETE') {
      const n = String(body(req).name || '');
      if (await redis.hget(`site:${n}`, 'owner') !== u) return res.status(403).json({ error: 'Ye site aapki nahi hai' });
      await deleteSite(n); await log('site', `${u} ne site delete ki: ${n}`); return res.json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).end();

    if (cfg.maintenance) return res.status(503).json({ error: cfg.maintenanceMsg });
    if (await limited(req, 'up', 40, 3600)) return res.status(429).json({ error: 'Bahut uploads, thodi der baad try karo' });

    const name = String(req.query.name || '').toLowerCase().trim();
    const kind = req.query.kind === 'html' ? 'html' : 'zip';
    if (!/^[a-z0-9-]{3,30}$/.test(name) || name.startsWith('-') || name.endsWith('-')) return res.status(400).json({ error: 'Site naam 3-30 chars ka ho (a-z, 0-9, -)' });
    const blocked = cfg.blocked.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (blocked.includes(name)) return res.status(400).json({ error: 'Ye naam allowed nahi hai' });
    const owner = await redis.hget(`site:${name}`, 'owner');
    if (owner && owner !== u) return res.status(409).json({ error: 'Ye naam kisi aur ne le liya hai' });
    if (!owner && (await redis.scard(`usites:${u}`)) >= limit) return res.status(400).json({ error: `Aapki limit ${limit} sites ki hai` });

    const buf = await rawBody(req, cfg.maxZipMB * 1024 * 1024 + 1024);
    if (!buf.length) return res.status(400).json({ error: 'File khali hai' });
    if (buf.length > cfg.maxZipMB * 1024 * 1024) return res.status(400).json({ error: `File ${cfg.maxZipMB}MB se badi hai` });

    const files = {}, skipped = []; let total = 0;
    const add = (path, data) => {
      const ext = path.split('.').pop().toLowerCase();
      if (!MIME[ext]) { skipped.push(path); return null; }
      if (data.length > MAX_FILE) return `"${path}" bahut badi hai (max ${MAX_FILE / 1024}KB per file). Image compress karo.`;
      total += data.length; files[path] = MIME[ext] + '|' + data.toString('base64'); return null;
    };
    if (kind === 'html') {
      const err = add('index.html', buf); if (err) return res.status(400).json({ error: err });
    } else {
      let zip; try { zip = await JSZip.loadAsync(buf); } catch { return res.status(400).json({ error: 'Valid ZIP file bhejo' }); }
      const entries = Object.values(zip.files).filter(f => !f.dir && !f.name.startsWith('__MACOSX') && !f.name.split('/').some(s => s.startsWith('.')));
      if (entries.length > cfg.maxFiles) return res.status(400).json({ error: `Max ${cfg.maxFiles} files allowed hain` });
      const declared = entries.reduce((a, f) => a + (f._data?.uncompressedSize || 0), 0);
      if (declared > 25 * 1024 * 1024) return res.status(400).json({ error: 'ZIP ke andar ka data bahut bada hai' });
      const tops = new Set(entries.map(f => f.name.split('/')[0]));
      const strip = tops.size === 1 && entries.every(f => f.name.includes('/'));
      for (const f of entries) {
        const path = strip ? f.name.split('/').slice(1).join('/') : f.name;
        if (path.includes('..') || path.startsWith('/')) return res.status(400).json({ error: 'Invalid file path' });
        const err = add(path, await f.async('nodebuffer')); if (err) return res.status(400).json({ error: err });
      }
    }
    if (!files['index.html']) return res.status(400).json({ error: 'ZIP mein index.html zaroori hai (root mein)' });

    // write new files first, then drop stale ones (site never goes empty mid-update)
    const key = `files:${name}`, old = await redis.hkeys(key);
    let batch = {}, size = 0;
    for (const [p, v] of Object.entries(files)) {
      if (size + v.length > BATCH && size) { await redis.hset(key, batch); batch = {}; size = 0; }
      batch[p] = v; size += v.length;
    }
    if (size) await redis.hset(key, batch);
    const stale = old.filter(k => !(k in files)); if (stale.length) await redis.hdel(key, ...stale);

    if (!owner) {
      await redis.hset(`site:${name}`, { owner: u, created: Date.now(), visits: 0, disabled: '0' });
      await redis.sadd('sites:all', name); await redis.sadd(`usites:${u}`, name);
    }
    await redis.hset(`site:${name}`, { files: Object.keys(files).length, size: total, updated: Date.now() });
    await bump('s'); await log('upload', `${u} ne ${owner ? 'update' : 'naya'} site daali: ${name}`);
    return res.json({ ok: true, url: `/s/${name}`, files: Object.keys(files).length, skipped: skipped.slice(0, 10) });
  } catch (e) {
    return res.status(400).json({ error: String(e.message).includes('too big') ? 'File bahut badi hai' : 'Upload fail ho gaya. Valid ZIP bhejo.' });
  }
}
