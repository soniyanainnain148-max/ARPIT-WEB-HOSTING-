import { makeSession, getSession, setCookie, limited, body, safeEq, envStatus, log, adminPw, explain } from '../_lib.js';
export default async function handler(req, res) {
  const env = envStatus(); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ admin: !!getSession(req, 'admin'), env });
  if (req.method !== 'POST') return res.status(405).end();
  const { action } = body(req); const password = String(body(req).password ?? '').trim();
  if (action === 'logout') { setCookie(res, 'admin', '', 0); return res.json({ ok: true }); }
  if (!env.adminPassword) return res.status(500).json({ error: 'ADMIN_PASSWORD env Vercel me set nahi hai. Settings > Environment Variables me daalo, phir Deployments > Redeploy karo.' });
  if (!env.redis) return res.status(500).json({ error: 'Upstash env variables nahi mile: ' + env.missing.filter(x => x.startsWith('UPSTASH')).join(', ') + '. Daal ke Redeploy karo.' });
  try {
    if (await limited(req, 'adm', 6, 900)) return res.status(429).json({ error: 'Bahut try ho gaye, 15 min baad aao' });
    if (!safeEq(password, adminPw())) { await log('security', 'Galat admin password try hua'); return res.status(401).json({ error: 'Password galat hai' }); }
    setCookie(res, 'admin', makeSession('admin', 'admin', 12), 43200);
    await log('security', 'Admin login hua');
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: explain(e) }); }
}
