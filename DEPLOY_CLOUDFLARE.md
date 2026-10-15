# Deploying Astra with GitHub + Cloudflare Pages

Cloudflare Pages/Workers cannot run a Flask + PostgreSQL app, so Astra is split in two:

    players -> Cloudflare Pages (functions/[[path]].js) -> Flask backend (Render) -> PostgreSQL (Neon)

Everyone uses ONE backend and ONE database, so friend requests, DMs and trades finally work.

## 1. Database (free): neon.tech
Create a project, copy the connection string (postgresql://...). This is your DATABASE_URL.

## 2. Backend: render.com
1. Push this folder to a GitHub repo.
2. Render -> New -> Blueprint -> pick the repo (it reads render.yaml).
3. When asked, paste DATABASE_URL. SECRET_KEY is generated for you. Keep it stable forever.
4. After deploy, note the URL, e.g. https://astra-backend.onrender.com
   Check https://astra-backend.onrender.com/api/ping loads.
   Optional env: ADMIN_USERNAMES, OPENAI_API_KEY.

## 3. Front door: Cloudflare (Workers & Pages -> Create -> Connect to Git)
The repo contains wrangler.jsonc + worker.js, so Cloudflare's default deploy command
(`npx wrangler deploy`) works as is. Settings:
1. Build command: leave empty. Deploy command: `npx wrangler deploy`.
2. Root directory: the folder that contains wrangler.jsonc (the repo root if you pushed the project folder's contents).
3. After the first deploy: Worker -> Settings -> Variables and Secrets -> add
   BACKEND_URL = https://astra-backend.onrender.com   (then it is kept on every redeploy)
4. Your game is at https://<name>.<account>.workers.dev
   (If the build complains the Worker name differs, change "name" in wrangler.jsonc to your Worker's name.)
Classic "Pages" projects also work: functions/[[path]].js is the same proxy; output directory `public`.

## 4. The exe
Beside astra.exe put a .env containing only:
    ASTRA_SERVER_URL=https://<name>.<account>.workers.dev
Everyone (exe and browser) now shares one world. Register accounts again on it.

## Notes
- Render's free plan sleeps after ~15 min idle; the first request then takes ~30-60 s.
- The free plan allows 100,000 requests/day. The game polls about every 1.5 s
  (~2,400 requests per player-hour), so that is roughly 40 player-hours per day.
- If you use the anti-tamper lock, run `python sign_release.py sign` after these edits
  (new files were added) and commit astra_manifest.json / astra_manifest.sig.
- Never commit .env or your private signing key (.gitignore already excludes them).
