# Astra: integration + what it takes to hold 500 - 5,000 players

## 1. Integration (5 minutes)

1. Copy `world.py`, `economy.py` next to `app.py`. Copy the three `.js` files into `static/`
   (`astra_stage14_appstore.js` and `astra_winos.js` REPLACE your current ones; they are your
   uploaded files plus small additions).
2. In `templates/index.html`, after the `astra_stage19_workshift.js` script tag add:
   `<script src="{{ url_for('static', filename='astra_stage20_world.js') }}"></script>`
3. In `app.py`, after `market_state`, `login_required`, `admin_required`, `current_user` and
   `get_or_create_save` are defined (anywhere before `app.run` / route-less end is fine):

```python
from world import init_world
import world
from economy import init_economy, cpi
init_world(app, login_required, admin_required, current_user, get_or_create_save,
           market_state, price_index=cpi)
init_economy(app, login_required, current_user, get_or_create_save,
             extra_fee=lambda: world._rules()[1]["trade_fee"])
```
4. `.env`: `ECON_EPOCH=2026-09-28` (launch date; prices equal their listed base that day).
5. Admin: register your account normally, then `python admin_tools.py <yourname>`.
   Or set `ADMIN_BOOTSTRAP_USERNAME=<yourname>` in `.env`, restart once, then delete the line.
   (It only flips an account that already exists, so register first or someone else could.)
6. Run `python test_world.py` (needs Flask-SQLAlchemy installed). I could NOT run the database
   tests in my sandbox (no SQLAlchemy, no network), so run this before trusting anything.

## 2. Bugs I found in your existing code

* **WORK DESK, ADMIN and APP STORE were locked out.** `astra_stage14_appstore.js` locks every
  nav button not in `SYSTEM_APPS`, and those three were not in it. Fixed in the patched copy.
* **Syndicate long-poll (`/api/coop/poll`)** holds a worker thread in `time.sleep` for up to
  `COOP_POLL_TIMEOUT` seconds per player. 200 syndicate members = 200 stuck workers.
* **`market_state` is a Python dict plus a thread**, so every worker process gets its own private
  market. The new `economy.py` avoids this (prices are pure functions of time).
* `app.run(debug=True)` and `sqlite:///astra.db` are fine for you and a friend, not for a crowd.

## 3. What the numbers really require

| Players online | What breaks first | What to do |
|---|---|---|
| ~50 | nothing | current setup |
| ~500 | SQLite write lock, single dev server | PostgreSQL (`DATABASE_URL=postgresql://...`), `gunicorn -w 4 --threads 8 app:app`, debug off |
| ~2,000 | polling load, long-poll workers, per-request DB reads | Redis for rate limits + cached `/api/econ/state` (one computation per 30 s step, shared), replace `/api/coop/poll` with Server-Sent Events or WebSockets on an async worker (gevent/uvicorn) |
| ~5,000+ | the `_run_day_tick` per-user catch-up, the in-process `market_loop` | move the world clock + AI rival to ONE scheduler process (or a cron job) writing to the DB/Redis; put static files on a CDN; add a load balancer; read replicas for feeds |

Already handled in the new code: atomic conditional `UPDATE`s for every money/share change (no
double-spend), DB-backed shared state (correct across workers), single-winner claims for global
jobs (redistribution), indexed + cursor-paginated feeds, per-player cooldowns enforced in SQL,
and the UI only polls the window that's actually on screen.

## 4. Honest limits

* Anti-cheat here is server-authoritative rules + audit trails + statistical leads
  (`/api/admin/cheatcheck`). It is not a guarantee: the moment two accounts trade with each
  other, multi-accounting / wintrading is possible. Watch the Offense and trade logs.
* NSFW moderation is: report button, auto-hide after 3 distinct reports, an admin queue, and an
  optional keyword flag list from `BLABBER_FLAG_TERMS` in `.env`. A real crowd needs human mods.
* Anonymity: BLABBER handles are `anon-` + a daily-rotating HMAC, so a poster can't be linked
  across days by other players. Admins can reveal an author; every reveal is written to the
  admin audit log. Tell players that.
