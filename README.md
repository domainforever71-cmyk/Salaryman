# Salaryman / ASTRA

A brokerage career sim in a retro terminal. Flask backend, vanilla front-end,
optional LLM for the talking characters.

## Run it

```bash
pip install -r requirements.txt
cp .env.example .env          # then edit SECRET_KEY
python app.py
```

Open <http://127.0.0.1:3000>. Register on the login screen, then start a career
from the Broker Simulator tab.

## Maps and daily needs

The preinstalled **MAPS** desktop app opens Astra City, a connected retro map
with homes, neighborhoods, downtown, offices, food stops, a car dealer, fuel,
parking, a clinic, taxi pickup and highway routes. Choose a destination to
compare a free walk, driving your owned car, or a taxi; route estimates factor
in distance, traffic, road conditions and vehicle stats. Walks and trips play
out on the map, and driving has speed, brake and steering controls.

Career balance pays for cars, taxi fares, fuel and food. Buy groceries at
FreshMart and eat from the FOOD BAG, or order a meal at Pixel Plate. Hunger
falls as career days pass; staying hungry can cost health. The Career HUD and
Maps app share the same health, hunger and wallet save.

Driving keeps the car in view and under your control: accelerate to build
speed, coast at your current speed, brake to slow or stop, and use STOP
CAR/RESUME when you want a full stop. The desktop search routes Maps/travel
queries to the Maps app instead of opening Markets for every query.

Career operators can found a custom-named, custom-type company for $250,000
after buying a $10,000 land plot. Construction takes one or two in-game days;
the plot appears in the expanded Eastside Business Park and is visible and
routable for other players. Once open, owners can post a player job listing
and hire staff. The employee roster supports up to 30 named employees.

It runs without an API key. OMNI-CORE drops to a local command set that still
reads live game state, and the omni-bots use templated lines. Set
`OPENAI_API_KEY` (or the existing `OPEN_AI_KEY` spelling) to enable OpenAI
responses (model defaults to `gpt-4o-mini`).
OpenRouter keys are not used.

Local runs save to `astra.db` beside `app.py`. Vercel deployments must set
`DATABASE_URL` or `POSTGRES_URL` to a managed PostgreSQL database; Vercel's
local filesystem is temporary and cannot preserve SQLite accounts between
instances or deployments.

## Locking the code to your version (anti-tamper)

Only a release **you signed** will run; change, add or delete any code file and
the app refuses to start (a running server locks itself within a minute and
answers 503). Line-ending-only changes don't count as edits.

One-time setup, on your own computer:

```bash
pip install -r requirements.txt
python sign_release.py init      # makes your key pair
python sign_release.py sign      # signs the current files
```

- The **private key** is saved outside the project (`~/.astra_release/astra_private.key`)
  so it can't end up in a zip, exe, repo or deployment. Back it up. Never share it.
- After **every** code change, run `python sign_release.py sign` again, then
  deploy/zip everything including `astra_manifest.json` and `astra_manifest.sig`
  (`Build_EXE.bat` signs for you before building).
- `python sign_release.py verify` checks a folder; `/api/integrity` on a running
  server says whether it is the signed release.
- Limits: you can't make files uneditable on someone else's PC - this makes
  edited copies refuse to run. A determined person with the plain-Python
  source could rewrite `integrity.py` itself, so give friends the built
  `astra.exe`, and keep money/accounts/admin logic on your server (it already
  is). The exe itself can still be replaced by a modified one - only Windows
  code-signing (a paid certificate) proves the exe is yours to Windows.

## Multiple servers (low ping for everyone)

Deploy the same app to several regions (e.g. Vercel/Render/Fly in EU and US).
Every copy must use the **same `DATABASE_URL` and `SECRET_KEY`**, and list all
servers in `ASTRA_SERVERS` (see `.env.example`), with its own `ASTRA_SERVER_ID`.
Because the database is shared, players on different servers still share
accounts, friends, DMs, trades and syndicates; each just talks to the nearest
copy. In the game, the badge at the top-right shows your ping; click it to see
every server's ping and JOIN a faster one without logging in again. The EXE
also picks the fastest server on launch when `ASTRA_SERVERS` is set.

Other behaviour worth knowing:

- Usernames are case-insensitive everywhere (login, friends, DMs, trades,
  hiring, syndicate kicks). `doMs` finds `Doms`; `doms` can't be registered
  separately.
- `ADMIN_USERNAMES` (default `alex,domain`) makes those operators admins.
  **Register those accounts yourself first** - whoever registers a listed name
  gets admin.
- Messages, friend requests, trade/hire offers, read receipts and syndicate
  changes arrive live (`/api/live/sync`, about every 1.5 s) with a pop-up;
  no refresh or re-click needed.
- Run `python test_realtime.py` to verify all of it on a throwaway database.

## Share accounts between the website and EXE

Deploy the website with a persistent PostgreSQL database and a stable,
private `SECRET_KEY` configured in the hosting provider's environment. Rebuild
`astra.exe` after updating the code. Beside the EXE, create a `.env` file with
only the public website URL:

```dotenv
ASTRA_SERVER_URL=https://your-astra-site.example
```

The EXE then opens the website inside its window instead of starting a private
local server. Website and EXE users must use that same site to share accounts
and messages. Do not copy server database credentials or API secrets into the
EXE's `.env` file. Without `ASTRA_SERVER_URL`, the EXE continues to run locally.

## What changed in this pass (Phase 6)

### Added

- **Casino** (`[♠] CASINO`). Slots, coin flip, high-low dice, and a quick
  single-draw blackjack. Every spin/flip/roll/deal is resolved server-side
  with the bet debited before the RNG runs, so a page refresh mid-spin can't
  be used to dodge a loss.
- **Named staff with real benefits** (`[⚑] STAFF`). Hire candidates - each a
  named person with a role, a salary, and one concrete benefit (passive
  income, cheaper weekly bills, a boss-mood cushion, or better odds on
  deals) - from a refreshable candidate pool. The roster panel shows morale
  and has a one-click FIRE button; the old plain role/salary hire form in
  the Broker Simulator's Employees tab still works and both write to the
  same roster.
- **Vacation requests.** Employees occasionally message the player (in
  character, via the LLM, flavored by a personality trait) asking for time
  off, specifying how many days and whether they need it paid. Approve
  paid (costs cash, boosts morale most), approve unpaid (smaller morale
  boost), or deny (morale hit).
- **Message an employee.** A small chat composer per staff member; replies
  are in-character and reflect current boss mood.
- **Boss assignments** (`[⚙] TASKS`). Occasional tasks on top of the
  regular weekly target - reconcile a ledger with a planted error, a
  three-question compliance quiz, a cold-call sprint, or spot the fake
  ticker in a trade blotter. The boss's intro line is AI-voiced; grading is
  always deterministic server-side code, never the model, so it can't be
  gamed by prompt-injecting the brief.
- **Investor inbox** (`[✉] INVESTOR INBOX`). Written, specific questions
  from clients that arrive independently of the live phone-call flow. A
  real answer can still close the deal; a non-answer won't.
- **Harder OMNI-BOTS.** Dialing a bot with a vague directive ("status
  report") now gets an in-character refusal for free, with no model call -
  each bot checks the directive against its own domain keywords first.
  Repeated vague directives drop a per-bot trust score (kept in session);
  low trust makes the bot openly hostile until a couple of good directives
  rebuild it.
- **Voice-over toggle** (`[🔊] VOICE` in the header). Free, offline,
  browser-based text-to-speech (Web Speech API) that can auto-read new
  AI-voiced lines as they arrive - bot dial output, boss assignment briefs,
  vacation requests, investor inbox messages, employee chat replies - plus
  a `[▶ SPEAK]` link on each one to replay it on demand. No per-word API
  cost. If `OPENAI_API_KEY` is set, `ai_engine.synthesize_speech()` can also
  hit OpenAI's TTS endpoint for a higher-quality clip on request; nothing
  in the shipped UI calls it automatically, to keep token/API spend
  predictable - it's there for a future "higher quality voice" toggle.
- **OpenAI provider.** `ai_engine.py` now calls OpenAI's `/v1/chat/completions`
  `ai_engine.py` calls OpenAI's `/v1/chat/completions` directly with
  `gpt-4o-mini` when an OpenAI key is set. Every new AI call above is capped
  at a modest `max_tokens` (90-220) and most are gated to at most once per
  in-game day per source, not per page load, to keep usage bounded.

## What changed in the previous pass

### Bugs fixed

- **The company desk 404'd on every click.** `astra_extras.js` has called
  `/api/game/stock/<symbol>` since the desk was written; the route was never
  added to `app.py`. Written now, with the per-ticker price history
  `market_tick()` was never recording, so the sparkline has something real to
  draw.
- **`ensure_schema()` was never called.** It has existed since Phase 2 and
  this README has been promising "no need to delete your save" on the back of
  it, while `app.py` only ran `db.create_all()`. It also never committed its
  `ALTER TABLE`, which SQLAlchemy 2.x rolls back on exit. Both fixed; it runs
  on every boot now.
- **Leaving a syndicate didn't leave.** `/api/coop/leave` only dropped the
  session key, so the membership row survived and the roster kept listing
  people who had walked out.

### Added

- **Operator exchange** (`[⇄] EXCHANGE`). Cash-and-share trades with a friend,
  settled in one transaction with both sides re-checked at the moment of
  acceptance, and resumable - the composer is stored as a server-side draft,
  so closing the tab mid-trade doesn't lose it.
- **Credits** (`[¤] CREDITS`). Cosmetic soft currency earned from real events,
  every grant logged with a reason, spendable on profile frames. Not
  convertible to in-game cash, on purpose.
- **Encrypted DM attachments.** 256 KB cap; ticking ENCRYPT runs the bytes
  through `vault_crypto` with a PIN you pick, so the server stores ciphertext
  and can't open the file.
- **Step sequencer.** A 4-voice × 16-step grid in the Studio with its own
  WebAudio engine. The pattern is stored with the track, so a sequenced
  release replays what you wrote.
- **A real Kraken feed** behind the arbitrage engine's second leg. A leg that
  fails is labelled SIMULATED rather than passed off as live.
- **Read receipts** on DMs, and a per-conversation passphrase remembered in
  your browser so an encrypted thread's PIN is agreed once, not retyped.
- **Counter-offers and partial fills** on the exchange. Partial fills are
  opt-in per offer, floor to whole shares, and leave the remainder standing.
- **Live syndicate updates.** A long-polling `/api/coop/poll` replaces the
  4-second timer, so the tab repaints the moment anyone acts.
- **Credit sinks** — three purchasable emblems, one more earned emblem, and a
  custom operator title. Renaming or clearing it later is free.
- **The new tabs are translated** in all six languages. Switching language
  also used to delete the WIP badge and unread dots inside nav buttons
  (`innerText` on an element with children); fixed.

## What changed in the previous pass

### Bugs fixed

- **The app 500'd on first load.** `index()` redirected to `url_for("intro_html")`,
  but the endpoint is `intro_page`. Every logged-out visitor hit a `BuildError`.
- **`ai_engine.py` had no fallback depth.** Offline mode returned one canned
  sentence to every question. It now routes by keyword against live state.
- **Old saves broke on upgrade.** `create_all()` only adds missing *tables*, so
  an existing `astra.db` lacked the new profile and music columns. `ensure_schema()`
  adds columns in place on boot — no need to delete your save.
- **The bots billed a model call every 12 seconds forever**, including with
  nobody logged in. They now stay quiet unless someone touched the terminal in
  the last five minutes.
- **Duplicate `<title>` tag** in `index.html`.
- **Music economy was degenerate** — every careful track scored 100/100 regardless
  of genre, and one release out-earned the weekly bills. Rebalanced so genre
  choice matters and a strong track is a side income, not a replacement salary.

### Added

- **Retro sound** (`static/astra_sfx.js`). Every effect is synthesised with
  WebAudio — no audio files to host. Buy, sell, dial, cash, boot, deny, day-tick,
  key clicks. Audio unlocks on first gesture, per browser autoplay rules.
- **Operator profile** (`[◆] PROFILE`). Twelve terminal-glyph emblems drawn by
  the browser, four frames, display name, bio, career stats. Two emblems are
  earned; the unlock check is server-side, not just hidden in the UI.
- **Full company desk.** Click any ticker tile to open it: intraday sparkline,
  fundamentals, simulated order book, sector headlines, and an order ticket with
  1/10/MAX/ALL sizing.
- **Parody companies.** Twelve tickers — Orange, Postify, Netflux, Boggle,
  Amazoo, NVidious, Macrosoft, Teslo, Shellfish and the original three — each
  with a CEO, founding year, headcount and description.
- **Music Studio** (`[♪] STUDIO`). Pick genre, key, tempo and length; the browser
  synthesises a chiptune loop from a seed. Release it under a label for royalties
  that pay out each in-game day and decay as the track ages. The server stores
  only the seed, so a track row is a few bytes.
- **OMNI-CORE is properly online.** It now receives a live snapshot of your
  session and answers about *your* career. Eleven slash commands (`/help`,
  `/portfolio`, `/price CHIP`, `/company POST`, `/career`, `/jobs`, `/bots`,
  `/music`, `/wip`, `/status`, `/clear`) resolve locally — instant, free, and
  they can't get the number wrong. A status dot shows whether a model is connected.

### Marked work-in-progress

Anything shipped incomplete is declared in `WIP_FEATURES` (`game_data.py`) and
badged in the UI, so unfinished reads as unfinished rather than broken. Ask
OMNI-CORE `/wip` for the current list. Music studio, co-op, avatar unlocks,
company detail, leaderboard, arbitrage and the household system all carry notes.

## Known gaps

These are limits of the design, not a queue — `WIP_FEATURES` is down to five
entries and each one is here for a reason that more code doesn't fix.

- **Google account linking needs your credentials.** The OAuth flow, callback
  and unlink UI are wired; a real sign-in needs a Google Cloud Client
  ID/Secret. Nothing in the code is blocking it.
- **Co-op long-polling parks one server thread per waiting member.** Updates
  are live now, but that's the cost, and it's fine for a handful of players
  rather than a crowd. Real websockets behind a proper WSGI server is the fix.
- **Arbitrage's captured profit is a flat 10% of the spread.** Both price legs
  are real; the fill isn't. A faithful fee model would net negative on nearly
  every spread this size, so it would delete the feature rather than improve
  it. The prices are the real part.
- **Score thresholds, credit rates and royalty balance are tuned by hand**
  against a handful of test careers, not real play data.
- **Encrypted DMs and attachments need a PIN the recipient already knows.**
  There is deliberately no in-app way to send it; a server that could hand
  over the key would defeat the point. The thread remembers one per
  conversation in your browser so you only agree it once.
- Arbitrage polls two real feeds now, but the "captured" profit is still a
  modelled 10% of the spread, not a real fill.
- `/api/bot_broadcast` is implemented but unused.
- The devtools blocker is intentional. Note it only raises the effort bar — it
  can't actually prevent inspection, so don't put a secret in the client.

## Layout

```
app.py              routes, market loop, game rules
ai_engine.py        LLM calls + offline fallbacks (OpenRouter)
game_data.py        stocks, companies, avatars, music, OMNI knowledge, WIP registry
models.py           SQLAlchemy models + ensure_schema() migration
templates/          intro, login, index
static/astra_sfx.js       WebAudio sound + chiptune generator
static/astra_extras.js    profile, company desk, studio, messages, syndicate, WIP badges
static/astra_phase5.js    exchange, credits, step sequencer, DM attachments, live quotes
```

`astra_phase5.js` loads last and waits for `astra_extras.js` to fire
`astrax:ready` before building anything, since its views and nav buttons hang
off what that file creates. It does not re-wrap `executeTrade`,
`advanceGameDay` or `sendOmniConsole` — those are the three functions the
runtime-integrity check in `index.html` snapshots off that same event.

`d.js` in the project root is a stale copy of `astra_extras.js` from before
the co-op and messaging work. Nothing references it; don't copy it into
`static/`.

Nothing in this project is financial advice. Every company is a parody and
every market except the BTC/USDT reference feed is simulated.
