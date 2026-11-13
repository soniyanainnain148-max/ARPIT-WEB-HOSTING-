import { redis, bump } from './_lib.js';

const page = (res, code, title, msg) => {
  res.status(code).setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e8ecf5;font-family:system-ui,sans-serif;text-align:center"><div><div style="font-size:54px">🌐</div><h2 style="margin:8px 0">${title}</h2><p style="color:#8d97ad">${msg}</p><a style="color:#6ea0ff" href="/">← Home</a></div>`);
};

export default async function handler(req, res) {
  try {
    const site = String(req.query.site || '').toLowerCase(); let path = String(req.query.path || '');
    if (!/^[a-z0-9-]{3,30}$/.test(site) || path.includes('..')) return page(res, 404, 'Not found', 'Ye link galat hai.');
    if (!path || path.endsWith('/')) path += 'index.html';
    const [dis, f] = await redis.pipeline().hget(`site:${site}`, 'disabled').hget(`files:${site}`, path).exec();
    if (dis === null) return page(res, 404, 'Site nahi mili', 'Is naam ki koi site nahi hai.');
    if (String(dis) === '1') return page(res, 403, 'Site band hai', 'Ye site admin ne disable kar di hai.');
    let file = f;
    if (!file && !path.includes('.')) { path += '/index.html'; file = await redis.hget(`files:${site}`, path); }
    if (!file) return page(res, 404, 'File nahi mili', 'Is site mein ye page maujood nahi hai.');

    const i = String(file).indexOf('|'), mime = file.slice(0, i); let out = Buffer.from(file.slice(i + 1), 'base64');
    const isHtml = mime.startsWith('text/html'), isCss = mime.startsWith('text/css');
    if (isHtml) { await redis.hincrby(`site:${site}`, 'visits', 1); bump('v').catch(() => {}); }

    // make root-relative links ("/style.css") work inside /s/<site>/
    if (isHtml || isCss) {
      const base = `/s/${site}/`;
      let t = out.toString('utf8');
      t = t.replace(/(url\(\s*["']?)\/(?!\/)(?!s\/[a-z0-9-]+\/)/gi, `$1${base}`);
      if (isHtml) {
        t = t.replace(/(\s(?:href|src|action|poster)\s*=\s*["'])\/(?!\/)(?!s\/[a-z0-9-]+\/)/gi, `$1${base}`);
        if (!/<base[\s>]/i.test(t)) {
          const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
          const tag = `<base href="${base}${dir}">`;
          t = /<head[^>]*>/i.test(t) ? t.replace(/<head[^>]*>/i, m => m + tag) : tag + t;
        }
      }
      out = Buffer.from(t, 'utf8');
    }
    res.setHeader('Content-Type', mime); res.setHeader('X-Content-Type-Options', 'nosniff');
    // user code runs in a sandbox (no access to our cookies / APIs)
    if (isHtml || mime.startsWith('image/svg') || mime.includes('xml')) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads');
    res.setHeader('Cache-Control', isHtml ? 'public, s-maxage=10, stale-while-revalidate=30' : 'public, s-maxage=300');
    return res.status(200).end(out);
  } catch { return page(res, 500, 'Error', 'Kuch gadbad ho gayi. Thodi der baad try karo.'); }
}
