import { redis, getChannels } from './_lib.js';
// /api/go?id=xxxx  -> counts the click and redirects to the channel link
export default async function handler(req, res) {
  try {
    const id = String(req.query.id || '');
    const ch = (await getChannels()).find(c => c.id === id && c.on);
    if (!ch) return res.status(404).end('Channel not found');
    await redis.incr(`chc:${id}`);
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 302; res.setHeader('Location', ch.url); return res.end();
  } catch { return res.status(500).end('Error'); }
}
