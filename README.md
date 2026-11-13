*//~Genius Hacker Updated Version~//*
#~*[Bahut Mehnat Se Error Fix Kya hu Support Me]*~#
# 🚀 Genius Hosting — Ek hi project (website + admin dono saath)

```
genius-site/
├── api/            (website + admin dono ke API)
├── public/
│   ├── index.html  → website (sidebar menu)
│   └── admin.html  → admin panel (/admin pe khulta hai, sidebar me link hai)
├── package.json
└── vercel.json
```

## Deploy (sirf 1 Vercel project)
1. **Upstash** (upstash.com) → Create Database (Redis) → **REST API** se copy karo:
   - `UPSTASH_REDIS_REST_URL` (https://....upstash.io wala)
   - `UPSTASH_REDIS_REST_TOKEN`
2. **GitHub** → naya repo → is zip ke **andar ki files** upload karo (root me `api/`, `public/`, `package.json`, `vercel.json` dikhne chahiye, koi extra folder nahi).
3. **Vercel** → Add New → Project → repo import → Root Directory **khali** rehne do.
4. **Environment Variables** (teeno zaroori):
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `ADMIN_PASSWORD` (apna password, min 8 chars)
5. **Deploy**. Baad me env daalo to **Deployments → ⋯ → Redeploy** zaroor karo.
6. Check: `/api/health` → `{"ok":true}` aana chahiye.

## Admin panel
- Link: `tera-site.vercel.app/admin` (website ke sidebar me bhi "🔐 Admin Panel" button hai). Password wahi hai jo tumne `ADMIN_PASSWORD` env me daala.
- **Koi default password nahi hai.** Vercel env me `ADMIN_PASSWORD` daalna zaroori hai, warna admin login error dega.

## Admin se kya hota hai
Website ka naam/logo/header, channels, developer credit, users (ban/add/reset pw/limit), sites (disable/delete), settings (signup on/off, maintenance, limits), activity log — sab yahin se.

## Limits (free plans)
Upload max 4MB, ek file max 600KB (Upstash free). Uploaded sites sandbox me chalti hain, cookies/localStorage nahi chalte.

## ⚠️ Agar `/s/site-naam/` pe 404 (Vercel ka apna "This page doesn't exist") aaye
Matlab `vercel.json` repo ke **root** me nahi hai, ya kisi extra folder ke andar chala gaya. GitHub repo khol ke check karo — `vercel.json`, `api/`, `public/` seedha root me dikhne chahiye.
