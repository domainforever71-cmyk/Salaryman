# ASTRA / Salaryman - build roadmap

Everything requested across every session, merged into one list, grouped
into phases. This app is ~4,300 lines across a Flask backend, three models
files, and a ~2,400-line frontend - big enough that shipping all of this as
one untested mega-patch would be worse than useless. Each phase below is
meant to land as a coherent, working slice.

Legend: `[x]` shipped and verified working · `[ ]` queued · `[!]` needs
something from you (an API key, OAuth credentials, a product decision)
before it can be finished for real, not just scaffolded.

## Before this pass: the Company Desk was 404ing, and ensure_schema() was never called

Same exercise as last time - auditing the code against this file rather than
trusting the file - and it turned up two more things bigger than anything
net-new:

**1. `/api/game/stock/<symbol>` did not exist.** `astra_extras.js` has called
it on every ticker click since the company desk was written. There was no
such route in `app.py`, so every click 404'd into the error branch. The desk
is listed as shipped in `README.md`, and Phase 5 below said it "should now
actually work since the script loads" - it never could. Written now, along
with the `PRICE_HISTORY` tracking in `market_tick()` that the sparkline
always needed and never had, and a cheap `/quote` companion route that live-
updates the open desk every 4 seconds without wiping the order ticket.

**2. `models.ensure_schema()` was never called.** It has existed since Phase 2
and `README.md` has been promising "no need to delete your save" on the back
of it, but `app.py` only ever ran `db.create_all()`. It also had a second bug:
the `ALTER TABLE` never committed, so SQLAlchemy 2.x rolled it back on exit
even when it did run. Both fixed - it now runs on every boot and commits,
which matters immediately because this pass adds columns.

## Before the previous pass: one critical bug that undid a lot of Phase 2

Auditing the actual code against this file (rather than trusting the file)
turned up something serious: **`index.html` never loaded `astra_sfx.js` or
`astra_extras.js`.** Both files were fully written and correct, and the
backend routes behind them all worked - but there was no `<script src="...">`
tag for either one anywhere on the page. Every `window.SFX.*` call and every
`AstraX.*` call in `index.html` was silently a no-op against a global that
didn't exist yet. In practice that meant, despite being "done":

- All sound (SFX + the Music Studio's Chiptune engine) was silent
- The `[◆] PROFILE`, `[♪] STUDIO`, and `[Σ] CALC` tabs never appeared at all
- Every Settings control that depended on `AstraX` (theme live-preview
  glue, avatar picker, vault UI wiring) was inert
- The WIP badges never rendered

**Fixed** - both scripts are now loaded via
`{{ url_for('static', filename=...) }}` right before `</body>`. This alone
is a bigger fix than anything net-new in this pass, and it means you need
to actually put `astra_sfx.js` and `astra_extras.js` in your Flask app's
`static/` folder if they aren't there already - `url_for('static', ...)`
resolves to `/static/<filename>`, served from that folder by default.

Also fixed while in there (same category - stale/broken markup nobody had
re-checked against the live page):
- A duplicate, contradictory `<title>` (leftover "NEXE Productions" next to
  "Salaryman: DEMO") - now a single `<title>Salaryman</title>`.
- A broken `<script>` tag pointing at `js.puter.com` with literal
  markdown-link brackets baked into the `src` attribute
  (`src="[https://...](https://...)"`) - it never worked, and nothing else
  in the codebase references Puter, so it's removed rather than fixed.
- A stale ticker label, `TECH (NEXE Tech)`, left over from the company
  rename to Astra Tech Corp in `game_data.py`.

## Also fixed: ACCESS DENIED blocking you during normal testing

The devtools-open intercept panel (Phase 1, plus the two extra checks added
in Phase 3) had no escape hatch for whoever runs this site. The `debugger;`
timing check trips the instant devtools is open in *any* panel - Console,
Network, whatever - which is exactly what testing looks like. There was no
way to turn it off short of editing the code.

**Fixed** - the panel now has a small "disable these checks in this
browser" link in the corner. One click sets a `localStorage` flag and every
check (devtools, fetch-override, function-tamper) skips itself in that
browser from then on; you can also run `astraDisableIntegrityChecks()` from
the console directly. This doesn't weaken the deterrent for actual players
- they'd need devtools open to even see the option, at which point there's
nothing left to deter. Same "fun retro touch, not real security" framing as
always; now it just doesn't get in your way while you're building.

## Phase 1 - bug fixes & visual cleanup (shipped)
- [x] Fix `/intro` route (`render_template` was pointing at a nonexistent
  template)
- [x] Fix "ACCESS DENIED" inspection-mode panel not always showing
- [x] Remove all emoji from the UI
- [x] Remove "//" / disclaimer-style decoration from visible headers
- [x] Add a simple "%" logo (header, login, intro)
- [x] Point the AI engine at a model whose free tier isn't restricted to
  agentic harnesses
- [!] "Make the bot online" - the code path is correct; going from
  OFFLINE (templated fallback) to LIVE requires you to set an
  `OPENROUTER_API_KEY` in the environment. That's an account/billing step
  only you can do - nothing left in the code is blocking it.

## Phase 2 - identity, settings, security (shipped, and now actually loading)
- [x] User profile with a small, fixed set of selectable PFPs + frames (the
  `[◆] PROFILE` tab). Two emblems are earned (score 2,000+, found a
  business) - the unlock check is enforced server-side in `/api/profile`,
  not just hidden in the UI.
- [x] Theme setting (cyan/green/amber/red) wired to the existing CSS
  variables, with a live preview as you change the dropdown.
- [x] More settings: SFX on/off + volume (live-updates while dragging),
  reduce-motion override (a real CSS rule now, not just a stored flag).
- [x] Portuguese added as a full language, and a real frontend i18n system
  (EN/ES/FR/JA/DE/PT) so switching language actually re-labels the nav bar
  and settings screen instead of only affecting AI-generated text.
- [x] Credential vault: consent screen, user-chosen PIN, PIN-derived
  encryption at rest (`vault_crypto.py`) - setup/store/reveal/delete are
  now wired end to end in the Settings screen.
- [x] Linked-devices list (name your sessions, revoke old ones).
- [!] Linking Google (and other) accounts - the OAuth flow, callback
  route, and link/unlink UI are all wired up, but an actual sign-in still
  needs a real Google Cloud OAuth Client ID/Secret, which only you can
  create.
- [x] Investor calculator (compound growth / position-sizing / P&L) - this
  was believed queued for Phase 3 but turned out to already be fully built
  (the `[Σ] CALC` tab in `astra_extras.js`). Confirmed working now that the
  script actually loads.
- [x] Procedural retro SFX - also already fully built (`astra_sfx.js`),
  also confirmed working now that it actually loads.
- [x] OMNI-CORE translate command, `/whoami`, and `/reveal` (color-coded by
  sensitivity) - also already fully built in `ai_engine.py`; this file just
  hadn't been updated to say so.

## Phase 3 - retro UX & new tools (this pass)
- [x] OMNI-CORE quick-reply option buttons - a row of chips
  (`/help /portfolio /career /jobs /music /whoami /reveal /wip /status`)
  under the console log that fire the command immediately, alongside free
  text.
- [x] More ACCESS-DENIED-style intercept panels for other suspicious
  client-side tampering. The original devtools-open check now shares its
  panel with two more independent signals, each with its own message:
  a monkey-patched `window.fetch` (network-layer override), and a
  reassigned core action function (`executeTrade` / `advanceGameDay` /
  `sendOmniConsole`) caught by comparing `toString()` against a snapshot
  taken right after `astra_extras.js` finishes its own legitimate
  SFX-wrapping of those same functions (via a new `astrax:ready` event -
  needed so the check's own "before" picture isn't a version that's about
  to be legitimately replaced a moment later). Same caveat as before: fun
  deterrent, not real security.
- [x] Per-persona touches:
  - A burnout/stress readout in the game HUD (`STRESS %`, inverse of
    health, tiered color + tooltip), reusing the existing `/api/explain`
    metric-commentary flow via a new `stress` entry in `METRIC_REGISTRY`.
  - A crypto-miner-flavored widget on the Markets tab (`SIMULATED MINING
    RIG`) - hash rate, temp, and a shares-found counter, explicitly labeled
    as cosmetic and not wired to the player's balance.
  - A gamer easter egg: the Konami code now opens a small mini-leaderboard
    overlay. This also closes an actual gap - `/api/leaderboard` has been
    fully implemented since Phase 2 but had no UI anywhere in the terminal
    until now.
- [x] A simple in-terminal music maker (step-sequencer synth) - shipped this
  pass. A 4-voice (LEAD/BASS/KICK/HAT) × 16-step grid in the Studio tab with
  its own WebAudio engine, a live playhead, tempo slider, per-step audition,
  randomize, and release straight from the grid. The pattern is stored on the
  track (`MusicTrack.pattern_json`) so a sequenced release replays what you
  wrote rather than re-rolling a seed, and scoring rewards using more than
  one voice at a sane density. Seed-rolled tracks leave the column null and
  behave exactly as before.
- [ ] OMNI-CORE: a "what do you know about me" command - already done as
  `/whoami` (see Phase 2 above); moved out of this list.
- [x] Rename/re-theme in-fiction brands - already done (Postify, Netflux,
  Orange, Boggle, Macrosoft, NVidious, Teslo, Shellfish all read as
  parodies with "not the real company" in their descriptions); moved out
  of this list.

## Phase 4 - social layer (in progress)
- [x] Friends list + DM messaging, with an explicit per-message "encrypt
  this" toggle. New `Friendship` and `DirectMessage` tables, a full
  request/accept/decline/remove flow, and a `[✉] MESSAGES` tab with an
  unread badge on the nav button. One deliberate design call worth
  flagging: encryption reuses `vault_crypto`'s PIN-derived-key primitive,
  but *not* literally your account vault PIN - only you know that. For a
  message to be readable by the friend you sent it to, the sender instead
  picks a PIN for that message and has to share it with the recipient
  out of band (however they trust). The server only ever stores the
  ciphertext and a random salt, never the PIN, so this is genuinely a
  "both people need the shared secret" scheme, not a backdoor - but it
  does mean there's no in-app way yet to tell the other person what the
  PIN is. That's the honest state of it; see `friends_dm` in `/api/wip`.
- [x] Wire a real frontend onto the co-op syndicate backend. This was the
  README's own "biggest remaining gap" - `/api/coop/*` was fully working
  with zero UI anywhere in the terminal. New `[⚑] SYNDICATE` tab: found or
  join a room by code, shared balance/target/bills/commission HUD, a
  shared trading desk (buy/sell hit the pooled balance, visible to every
  member), and a live syndicate log that doubles as chat. Polls every 4s
  while the tab is open so other members' trades/messages show up without
  a manual refresh. Moved `coop` from `stub` to `beta` in `WIP_FEATURES`
  now that there's something real to caveat (not stress-tested past a
  couple of concurrent players, no kick/ban or ownership-transfer flow).
- [x] Encrypted file attachments in DMs. 256 KB cap. Ticking ENCRYPT runs the
  file's bytes through `vault_crypto` with a PIN you pick, so the server
  holds ciphertext and a salt and cannot open it; filename, MIME and size
  stay clear so the thread can label a file it can't read. The browser
  rebuilds the decrypted bytes into a Blob download.
- [x] Player-to-player asset trading/exchange, encrypted, resumable. New
  `[⇄] EXCHANGE` tab and `TradeOffer` table. Cash and shares in either
  direction, **settled atomically with both sides re-validated at the moment
  of acceptance** - a stale offer fails rather than overdrawing anyone.
  Resumable because the composer is persisted as a `draft` row, debounced as
  you type, so closing the tab mid-trade restores exactly what you staged.
  One honest limit on "encrypted": the terms themselves are readable by the
  server because it has to move the assets. Only the optional memo is
  encrypted, with a PIN shared out of band. Pretending otherwise would be
  theatre.
- [x] "Credits" stub with the yellow WIP badge - it ended up more than a
  stub. New `[¤] CREDITS` tab: earned from real events, every grant written
  to a `CreditLedger` row with a reason, spendable on four new profile
  frames. Cosmetic only and deliberately not convertible to in-game cash, so
  it can't distort the career economy. Still badged, because frames are
  currently the only sink.
- [x] Syndicate admin, which was the open caveat on co-op: kick, ban
  (rejoining by code is refused) and ownership transfer. Also fixed `leave`,
  which only popped the session key - the membership row survived, so the
  member list kept showing people who had walked out. It now removes the row
  and hands ownership to the longest-standing remaining member if the founder
  is the one leaving.
- [x] Read receipts on DMs (✓ sent / ✓✓ read), and a per-conversation
  passphrase remembered in your own browser so the shared PIN is agreed once
  instead of retyped per message. It never touches the server - which is
  exactly why there is still no in-app way to hand it to the other person.

## Phase 5 - trading desk upgrade (shipped)
- [x] Clicking a stock opens a full per-stock screen: live-updating price, a
  history view, and buy/sell in one place. The note here last pass said this
  "may already be closer to done than this list suggests" because
  `openStock()` was wired up - re-checking it, as that note suggested, is
  what turned up the 404. The frontend was complete; the endpoint behind it
  had never been written. Now: real intraday history from `PRICE_HISTORY`,
  fundamentals from the fields already sitting unused in `STOCKS`, a
  deterministic order book that doesn't jitter between renders, headlines
  seeded from the genuine `MARKET NEWS` events that moved that price, and a
  4-second live quote poll that updates the price in place without wiping
  the order ticket.
- [x] Arbitrage's second leg is a real Kraken feed now, not
  `binance + random()`. Each leg reports health; a failed leg falls back to a
  simulated quote and is tagged `SIMULATED` in the panel header instead of
  being passed off as live.

## Phase 6 - closing out the caveats (shipped)
- [x] Counter-offers and partial fills on the exchange. `[COUNTER]` marks the
  original `countered` and loads it into your draft with the sides swapped;
  partial fills are opt-in per offer, floor to whole shares, refuse a slice
  that rounds everything to zero, and leave the reduced remainder standing so
  an offer can be filled down over several accepts.
- [x] Live co-op updates. `CoopRoom.revision` plus a long-polling
  `/api/coop/poll` - the tab repaints the instant anyone acts. Long-poll
  rather than websockets on purpose: no new dependency, and Flask's dev server
  is already threaded. The cost is stated plainly in the WIP note (one parked
  thread per waiting member), the session is rolled back before each sleep so
  a waiter never blocks SQLite writers, and the watcher stops when you leave
  the tab.
- [x] More credit sinks: three purchasable emblems, one more earned emblem
  (release three tracks), and a custom operator title. Renaming or clearing
  the title afterwards is free. All cosmetic; credits still buy nothing the
  score reads.
- [x] i18n for every tab the two add-on scripts create, in all six languages -
  and a real bug fixed on the way: `applyLanguage()` used `innerText`, which
  deleted the WIP badge and unread dots inside nav buttons every time you
  switched language.
- [!] Google account linking. Unchanged and unchangeable from here: the OAuth
  flow, callback and unlink UI are all wired, but a real sign-in needs a
  Google Cloud Client ID/Secret only you can create.
- [~] A fee-and-slippage model for arbitrage - **deliberately not done.**
  Round-trip taker fees on ~$93k of notional dwarf a $30 spread, so a faithful
  model would net negative on nearly every scan and delete the feature. It
  keeps the flat 10% and the WIP note now says so outright: the prices are
  real, the profit is flavor.

## What is still badged, and why it always will be

`WIP_FEATURES` is down to five entries, and none of them is an unfinished
feature waiting on more code:

- **coop** - one parked server thread per waiting member. Real websockets
  behind a proper server is the only fix, and that's a deployment decision,
  not a missing function.
- **arbitrage** - the captured profit is modelled. See above.
- **vault** - a 4-8 digit PIN has a small keyspace, and this is not audited
  cryptography. Both true forever; the lockout is the mitigation.
- **friends_dm** - an encrypted message needs a secret the server must never
  hold, so there is no in-app way to share the PIN. The per-conversation
  passphrase in your own browser is as far as this can honestly go.
- **google_link** - needs your credentials.

---
Every phase on this list is shipped. What remains is the five badged items
above, and each of those is a limit of the design or of what a server is
allowed to know - not a queue.

If you want to push further, the honest next moves are structural rather than
feature work: a real WSGI server with websockets (which retires the co-op
caveat), your Google OAuth credentials (which retires the stub), and playtest
data to tune the score thresholds, credit rates and royalty balance against
something other than my judgement. Say which and I'll keep going the same
way - real working code, committed to these files, documented here as it
lands.
