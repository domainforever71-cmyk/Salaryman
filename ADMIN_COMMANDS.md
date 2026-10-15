# Admin terminal commands

Open **[⌨] ADMIN TERMINAL** (admins only) and type `/r help admin`. Every action is logged - `/r audit`.

| Command | What it does |
|---|---|
| `/r announce [-w\|-u] [-t 30m\|6h\|2d] <message>` | Pop-up for every player. `-w` warning, `-u` urgent. Default: info, 24h. Alias `/r broadcast` |
| `/r announcements` · `/r retract <id>` | List recent announcements / pull one back |
| `/r users [search]` · `/r whois <user>` · `/r admins` | Look players up |
| `/r ban <user> <reason>` · `/r unban <user>` | Suspend / restore an account |
| `/r jail <user> <minutes> [reason]` · `/r release <user>` | Custody order (max 1440 min) |
| `/r reports [status]` · `/r resolve <id> [status] [note]` | Player reports |
| `/r queue` · `/r hide <id>` · `/r unhide <id>` · `/r reveal <id>` | BLABBER moderation |
| `/r leads` | Cheat-check outliers (leads, not verdicts) |
| `/r give <user> <amount> <reason>` · `/r take <user> <amount> <reason>` | Adjust ASD (reason required, max 10,000,000 per command) |
| `/r regime [name]` | Show or force the world regime |
| `/r crash <SYMBOL\|all> <pct> [options]` · `/r boom ...` | Sudden drop / rally, now or scheduled (see below) |
| `/r market` · `/r cancel <id>` · `/r symbols` | List shocks, cancel one, list tickers |
| `/r stats` · `/r audit [count]` | Server overview / admin action log |

Admins can't ban themselves or other admins. After editing code run `python sign_release.py sign` (or `Build_EXE.bat`).

## Market shocks
`/r crash all 40 -in 2h -m Bank run spreads` - every stock falls 40% in two hours' time and a headline is posted.

Options: `-in 30m|2h|1d` (start later) or `-at 2026-10-01T18:00` (UTC) · `-ramp 30s` (how fast it falls) ·
`-hold 10m` (how long it stays down) · `-recover 30m` (how long to heal) · `-m <headline>` (last).
Defaults: ramp 30s, hold 10m, recover 30m. Crash 1-95%, boom 1-300%, up to 30 days ahead, 50 pending.

Two stock systems exist: the exchange stocks (QUIK NOVA VOLT KRON DRAX) follow the whole ramp/hold/recover curve and the
chart shows it; the desk stocks (TECH OIL GOLD CRYPTO NVID) take a one-off drop when the event starts and then trade normally.
Cancelling stops the exchange-stock effect within seconds but can't undo a desk-stock drop that already happened.
Scheduled events live in the database, so they survive restarts.

## Live events (stimulus, levy, raffle, trading halt)
All take `-in 30m|2h|1d` or `-at 2026-10-01T18:00` (UTC) to schedule, and `-m <message>` (last) for a custom pop-up. They
hit *active* players only, post a SYSTEM announcement when they fire, and are logged in `/r audit`.

| Command | What it does |
|---|---|
| `/r stimulus <amount> [opts]` | Pay every active player (max 1,000,000 each) |
| `/r levy <percent> [opts]` | Collect 1-50% of every active balance (warning pop-up) |
| `/r raffle <prize> <winners> [opts]` | Random active players win the prize (1-100 winners), winners named in the pop-up |
| `/r halt <10m\|2h> [reason]` | Freeze exchange and share trading for everyone (max 24h), urgent pop-up. `/r resume` ends it early |
| `/r live` | List live events, results and any active halt |
| `/r cancelevent <id>` | Cancel a scheduled live event (not one that already fired) |

Example: `/r raffle 5000 3 -in 1h -m Friday raffle starting now!`
Up to 30 live events can be pending. Events are stored in the database (tables `admin_events`, `admin_flags`, created
automatically on first start), so they survive restarts. Run `python sign_release.py sign` (or `Build_EXE.bat`) after updating.

## Courts and law
| Command | What it does |
|---|---|
| `/r court [filed\|settlement\|decided]` | List civil cases |
| `/r verdict <id> <plaintiff\|defendant\|dismiss> [note]` | Rule on an open case yourself (full claim awarded to a winning plaintiff) |
| `/r disbar <user>` · `/r reinstate <user>` | Revoke / restore a player lawyer's licence |
| `/r pardon <user> <reason>` | Clear convictions, wanted rating and custody |
