import { redis, envStatus, explain } from './_lib.js';
// /api/health  ->  setup check (kaunsa env missing hai, Upstash connect hua ya nahi)
export default async function handler(req, res) {
  const env = envStatus(); res.setHeader('Cache-Control', 'no-store');
  if (!env.redis) return res.status(500).json({ ok: false, missing: env.missing, error: 'Env variables missing' });
  try { await redis.get('health'); return res.json({ ok: true, missing: env.missing }); }
  catch (e) { return res.status(500).json({ ok: false, error: explain(e) }); }
}
