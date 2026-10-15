"""Static and procedurally generated content for ASTRA.

Nothing in this file talks to the network or the database - it's just the
raw material the rest of the app draws from (stock list, generated clients,
the four omni-bot personas, the job ladder, profile/avatar options, theme
palettes, the music studio's catalogue data, and the work-in-progress
registry).
"""

import random


AVATAR_BASE = "https://api.dicebear.com/10.x/bottts/svg?seed={seed}&backgroundColor={bg}"


def avatar_url(seed, bg="0f1c30"):
    return AVATAR_BASE.format(seed=seed, bg=bg)


FIRST_NAMES = [
    "Arthur", "Beatrice", "Charles", "Diana", "Evelyn", "Franklin", "Grace", "Harrison",
    "Isabella", "Julian", "Katherine", "Liam", "Margaret", "Nathaniel", "Olivia", "Penelope",
    "Quentin", "Rose", "Sebastian", "Theodore", "Victoria", "William", "Xavier", "Yvonne",
    "Zachary", "Abigail", "Benjamin", "Chloe", "Dominic", "Elena", "Domain", "Zend The Gooner", "Elon MUusk", "Jeff Bezos", "Mark Zuckerberg", "Bill Gates", "Warren Buffett", "Larry Page", "Sergey Brin", "Steve Jobs", "elizabeth" , "Donald" ,
]
LAST_NAMES = [
    "Sterling", "Vanderbilt", "Sinclair", "Holloway", "Montague", "Cunningham", "Blackwood",
    "Kensington", "Lancaster", "Pemberton", "Ashworth", "Davenport", "Fairchild", "Giles",
    "Hawthorne", "Lockwood", "Maitland", "Pembroke", "Radcliffe", "Smythe",
]
RISK_PROFILES = ["Conservative", "Balanced", "Aggressive Speculator", "High-Net-Worth VIP"]



STOCKS = {
    "TECH":   {"name": "Astra Tech Corp",   "sector": "Technology",     "price": 142.50, "open": 142.50, "volatility": 1.2,
               "ceo": "R. Voss", "founded": 2011, "employees": 8400, "hq": "Astra City", "pe": 24.1, "dividend": 0.4,
               "desc": "The terminal's own namesake stock. Enterprise software and a cloud arm nobody quite understands."},
    "OIL":    {"name": "Global Petroleum",  "sector": "Energy",         "price": 88.20,  "open": 88.20,  "volatility": 0.9,
               "ceo": "H. Okafor", "founded": 1958, "employees": 41000, "hq": "Port Delray", "pe": 9.8, "dividend": 5.1,
               "desc": "Legacy energy major. Slow, boring, and pays a dividend that keeps retirees calm."},
    "GOLD":   {"name": "Apex Bullion",      "sector": "Commodities",    "price": 2040.00,"open": 2040.00,"volatility": 0.5,
               "ceo": "L. Fennimore", "founded": 1972, "employees": 1100, "hq": "Vault District", "pe": 14.2, "dividend": 1.8,
               "desc": "Physical bullion storage and a small mining arm. The stock people buy when they distrust everything else."},
    "CRYPTO": {"name": "EtherNet Index",    "sector": "Digital Assets", "price": 3400.00,"open": 3400.00,"volatility": 2.8,
               "ceo": "K. Nakamora", "founded": 2017, "employees": 260, "hq": "Remote-first", "pe": None, "dividend": 0.0,
               "desc": "A basket index tracking a handful of major coins. Not the live BTC feed - that's a separate ticker."},
    "NVID":   {"name": "NVidious",          "sector": "Semiconductors", "price": 912.40, "open": 912.40, "volatility": 2.4,
               "ceo": "J. Huang-Reyes", "founded": 1993, "employees": 29600, "hq": "Chipvalley", "pe": 52.3, "dividend": 0.1,
               "desc": "GPUs for gaming and, increasingly, for everything that isn't gaming. A chipmaker parody - not the real company."},
}
# Trimmed from 12 to 5 tickers on purpose - a real desk doesn't cover every
# sector, and a shorter list is one you can actually be expected to know cold
# before MARKETS & SEARCH stops holding your hand. BIO/POST/ORNG/FLIX/BOGL/
# WSFT/TSLO are gone; nothing else in the codebase referenced those symbols
# directly (checked - everything iterates STOCKS, nothing hardcodes a ticker).

JOB_LADDER = [
    "Junior Floor Broker",
    "Associate Broker",
    "Senior Broker",
    "Vice President of Trading",
    "Managing Director",
]


JOB_LISTINGS = [
    {
        "id": "fairview",
        "name": "Fairview & Co",
        "salary": 1800.0,
        "target": 2200.0,
        "blurb": "Entry-level shop. Low pressure, low pay, good place to learn the ropes.",
        "interviewer": "a friendly but no-nonsense HR manager at a small entry-level brokerage called Fairview & Co",
    },
    {
        "id": "apex",
        "name": "Apex Capital Group",
        "salary": 3000.0,
        "target": 5000.0,
        "blurb": "Mid-size brokerage with a steady book of clients. Reasonable expectations.",
        "interviewer": "a polished, professional hiring manager at a respected mid-size brokerage called Apex Capital Group",
    },
    {
        "id": "stratton",
        "name": "Stratton Oakmont",
        "salary": 5000.0,
        "target": 10000.0,
        "blurb": "Aggressive boiler-room culture. High risk, high reward, high turnover.",
        "interviewer": "a loud, high-pressure sales floor manager at a boiler-room-style brokerage called Stratton Oakmont, who wants to hear aggression and hunger",
        "min_credit_score": 690,
    },
    {
        "id": "meridian",
        "name": "Meridian Global Partners",
        "salary": 8000.0,
        "target": 16000.0,
        "blurb": "Elite firm. Brutal expectations, but the payout is real.",
        "interviewer": "a cold, exacting managing partner at an elite brokerage called Meridian Global Partners, who only respects hard numbers and composure",
        "min_credit_score": 750,
    },
]


OMNI_BOTS = [
    {
        "code": "BOT-01",
        "id": "vex",
        "name": "VEX",
        "role": "Liquidation Risk Monitor",
        "brief": "Tracks leverage and margin-call zones across public exchanges.",
        "avatar_url": avatar_url("vex-astra", bg="ff3366"),
        "persona": (
            "You are VEX, a terse risk-analytics bot inside a fictional retro trading "
            "terminal called ASTRA. You comment on leverage ratios and margin-call zones "
            "using only public order-book data, in short, clipped, technical lines. "
            "You are a fictional game character, not a real financial advisor, and you "
            "never give real investment advice."
        ),
    },
    {
        "code": "BOT-02",
        "id": "chronos",
        "name": "CHRONOS",
        "role": "Cross-Exchange Spread Tracker",
        "brief": "Watches price desync between exchanges for arbitrage windows.",
        "avatar_url": avatar_url("chronos-astra", bg="00ffcc"),
        "persona": (
            "You are CHRONOS, a clock-obsessed arbitrage-tracking bot inside a fictional "
            "retro trading terminal called ASTRA. You describe timing and price desync "
            "between public exchange feeds in short, precise lines, often referencing "
            "milliseconds. You are a fictional game character, not a real financial "
            "advisor, and you never give real investment advice."
        ),
    },
    {
        "code": "BOT-03",
        "id": "nyx",
        "name": "NYX",
        "role": "Sentiment & News Scanner",
        "brief": "Summarizes public market sentiment and headline flow.",
        "avatar_url": avatar_url("nyx-astra", bg="a78bfa"),
        "persona": (
            "You are NYX, a moody sentiment-analysis bot inside a fictional retro trading "
            "terminal called ASTRA. You summarize public market mood and news chatter in a "
            "slightly paranoid tone, but you only ever reference publicly available "
            "information. Keep lines short. You are a fictional game character, not a real "
            "financial advisor, and you never give real investment advice."
        ),
    },
    {
        "code": "BOT-04",
        "id": "goliath",
        "name": "GOLIATH",
        "role": "Order Book Depth Analyst",
        "brief": "Reads liquidity walls and resting order size.",
        "avatar_url": avatar_url("goliath-astra", bg="00ff66"),
        "persona": (
            "You are GOLIATH, a blunt, heavyweight order-book analyst bot inside a "
            "fictional retro trading terminal called ASTRA. You describe liquidity depth "
            "and support/resistance walls in short, gruff lines, using only public order-"
            "book data. You are a fictional game character, not a real financial advisor, "
            "and you never give real investment advice."
        ),
    },
]


PERSONA_TONES = {
    "ruthless":   "Speak like a cold, profit-obsessed operator. No pleasantries.",
    "glitchy":    "Speak like a paranoid system that suspects every feed is compromised.",
    "degenerate": "Speak like a hyperactive, overconfident trader chasing the next play.",
}

METRIC_REGISTRY = {
    "total_equity":  ("nyx",     "The combined USD value of every simulated position ASTRA is currently holding."),
    "engine_status": ("chronos", "Whether the autonomous arbitrage loop is actively scanning for spreads or sitting idle."),
    "opp_captured":  ("chronos", "How many spreads above the profit threshold have been caught since the engine last started."),
    "weekly_target": ("goliath", "The minimum commission you need to close this week to keep your job and avoid a bill default."),
    "weekly_bills":  ("vex",     "Rent, staff pay, and overhead due at the end of every week, whether you hit target or not."),
    "health":        ("vex",     "Your operator's condition. It drops on missed targets and long weeks; at zero, the run ends."),
    "stress":        ("vex",     "A read on how close your operator is to burnout - the inverse of health. High stress means the run is close to ending."),
    "balance":       ("goliath", "Cash on hand after bills, salary, trades, and commissions. Deep enough negative and you're liquidated."),
    "primary_exchange": ("chronos", "The exchange ASTRA is currently reading its baseline spot price from."),
}

COIN_IDS = {
    "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "ADA": "cardano",
    "XRP": "ripple", "DOGE": "dogecoin", "XMR": "monero", "BNB": "binancecoin",
    "MATIC": "matic-network", "LTC": "litecoin",
}



AVATAR_PRESETS = [
    {"id": "chip",    "name": "Chip",     "glyph": "%", "color": "#00ffcc", "unlock": "always"},
    {"id": "bolt",    "name": "Bolt",     "glyph": "⚡", "color": "#ffbb00", "unlock": "always"},
    {"id": "target",  "name": "Target",   "glyph": "◎", "color": "#00ff66", "unlock": "always"},
    {"id": "gear",    "name": "Gear",     "glyph": "⚙", "color": "#73a5c9", "unlock": "always"},
    {"id": "star",    "name": "Star",     "glyph": "★", "color": "#ffbb00", "unlock": "always"},
    {"id": "bull",    "name": "Bull",     "glyph": "▲", "color": "#00ff66", "unlock": "always"},
    {"id": "bear",    "name": "Bear",     "glyph": "▼", "color": "#ff3366", "unlock": "always"},
    {"id": "eye",     "name": "Eye",      "glyph": "◉", "color": "#a78bfa", "unlock": "always"},
    {"id": "diamond", "name": "Diamond",  "glyph": "♦", "color": "#00ffcc", "unlock": "always"},
    {"id": "skull",   "name": "Skull",    "glyph": "☠", "color": "#ff3366", "unlock": "always"},
    {"id": "sigma",   "name": "Sigma",    "glyph": "Ω", "color": "#ffbb00", "unlock": "score_2000",
     "unlock_desc": "Reach a score of 2,000"},
    {"id": "crown",   "name": "Founder",  "glyph": "✦", "color": "#00ff66", "unlock": "business_owner",
     "unlock_desc": "Found your own business"},
    {"id": "vinyl",   "name": "Press",    "glyph": "◍", "color": "#a78bfa", "unlock": "three_tracks",
     "unlock_desc": "Release three tracks"},
  
    {"id": "helix",   "name": "Helix",    "glyph": "⚘", "color": "#00ffcc", "unlock": "credits",
     "cost": 400, "unlock_desc": "400 credits"},
    {"id": "orbit",   "name": "Orbit",    "glyph": "◈", "color": "#ffbb00", "unlock": "credits",
     "cost": 400, "unlock_desc": "400 credits"},
    {"id": "spectre", "name": "Spectre",  "glyph": "◑", "color": "#ff3366", "unlock": "credits",
     "cost": 900, "unlock_desc": "900 credits"},
]


CREDIT_SINKS = {
    "custom_title": {
        "name": "Custom operator title", "cost": 750,
        "blurb": "Replace the rank ASTRA assigns you (Rookie Operator, Desk "
                 "Veteran...) with 32 characters of your own, shown on your profile.",
    },
    # --- Phase 8: ASTRA+ store, microtransaction-flavored ----------------------
    # Same currency, same "cosmetic only, never touches the career economy"
    # rule as everything else in this file - the gacha-crate framing is the
    # point (a bit of a jab at real mobile-game monetization), not a way to
    # actually buy an edge. Every possible pull is itself cosmetic.
    "mystery_crate": {
        "name": "ASTRA+ Mystery Crate", "cost": 180,
        "blurb": "\"Limited-time\" surprise pull - refunds, a free frame you don't "
                 "already own, or (rare) a jackpot credit payout. Never cash, never "
                 "an edge. Just the till rattling.",
    },
}

CRATE_TABLE = [
    {"kind": "refund",  "weight": 40, "label": "Partial refund",
     "amount_pct": 0.5},
    {"kind": "frame",   "weight": 30, "label": "Free frame unlock"},
    {"kind": "bonus",   "weight": 22, "label": "Bonus credits",
     "amount_pct": 1.5},
    {"kind": "jackpot", "weight": 8,  "label": "JACKPOT",
     "amount_pct": 4.0},
]


FRAMES = [
    {"id": "none",   "name": "None",        "css": "1px solid var(--border-color)", "cost": 0},
    {"id": "cyan",   "name": "Cyan Ring",   "css": "2px solid var(--pixel-cyan)", "cost": 0},
    {"id": "green",  "name": "Green Ring",  "css": "2px solid var(--pixel-green)", "cost": 0},
    {"id": "gold",   "name": "Gold Ring",   "css": "2px solid var(--pixel-yellow)", "cost": 0},
    {"id": "violet", "name": "Violet Ring", "css": "2px solid #a78bfa", "cost": 150},
    {"id": "double", "name": "Double Rule", "css": "4px double var(--pixel-cyan)", "cost": 300},
    {"id": "dashed", "name": "Dashed Alert","css": "2px dashed var(--pixel-red)", "cost": 300},
    {"id": "plasma", "name": "Plasma Glow", "css": "2px solid var(--pixel-cyan)", "cost": 600,
     "shadow": "0 0 12px var(--pixel-cyan)"},
]


CREDIT_RULES = {
    "day":          {"amount": 2,  "reason": "Day survived"},
    "deal":         {"amount": 10, "reason": "Client deal closed"},
    "week":         {"amount": 15, "reason": "Week closed out"},
    "target_hit":   {"amount": 25, "reason": "Weekly target hit"},
    "track":        {"amount": 20, "reason": "Track released"},
    "business":     {"amount": 50, "reason": "Founded a business"},
    "interview":    {"amount": 30, "reason": "Passed an interview"},
    "trade_p2p":    {"amount": 5,  "reason": "Operator-to-operator exchange settled"},
    "work_shift":   {"amount": 8,  "reason": "Work shift completed"},
}

# --- Phase 7: bank loans, gated by the new GameSave.credit_score -----------
# credit_score starts at 650 (see models.GameSave). Missing a weekly payment
# knocks it down; paying a loan off in full brings it back up. Each tier's
# `min_score` gates whether that lender will issue you a loan at all - not
# just the APR, so a wrecked score genuinely locks you out of anything but
# the loan shark until you rebuild it.
BANK_TIERS = [
    {
        "id": "corner_lender",
        "name": "Corner Lender",
        "min_score": 0,
        "max_principal": 1500.0,
        "apr": 0.42,
        "blurb": "Takes anyone. Prices it accordingly.",
    },
    {
        "id": "firstunion",
        "name": "First Union Credit",
        "min_score": 580,
        "max_principal": 6000.0,
        "apr": 0.19,
        "blurb": "Standard consumer lender. Reasonable if your score can clear the bar.",
    },
    {
        "id": "meridian_capital",
        "name": "Meridian Capital Bank",
        "min_score": 700,
        "max_principal": 25000.0,
        "apr": 0.09,
        "blurb": "Business-grade credit line. Best rate on the street, strict entry.",
    },
]

THEMES = {
    "cyan":  {"name": "Cyan (default)", "accent": "#00ffcc", "accent_dim": "#008877"},
    "green": {"name": "Green Phosphor", "accent": "#00ff66", "accent_dim": "#0a6b33"},
    "amber": {"name": "Amber CRT",      "accent": "#ffbb00", "accent_dim": "#996f00"},
    "red":   {"name": "Red Alert",      "accent": "#ff3366", "accent_dim": "#8f1633"},
}




MUSIC_GENRES = {
    "chiptune":  {"name": "Chiptune",   "blurb": "8-bit square-wave hooks. Broad appeal, modest payout ceiling.", "bpm": 150},
    "synthwave": {"name": "Synthwave",  "blurb": "Neon sawtooth leads over a driving beat. Strong mid-tier earner.", "bpm": 110},
    "darkwave":  {"name": "Darkwave",   "blurb": "Moody triangle-wave minor key. Niche but loyal listeners.", "bpm": 95},
    "acidhouse": {"name": "Acid House", "blurb": "Gritty sawtooth stabs, high tempo. High risk, high reward.", "bpm": 128},
    "ambient":   {"name": "Ambient",    "blurb": "Slow sine pads, no drums. Low payout, never flops either.", "bpm": 70},
}

MUSIC_LABELS = [
    {"id": "indie",   "name": "Self-Released",  "cut": 0.90, "reach": 1, "cost": 0,
     "blurb": "You keep almost everything. Nobody's promoting it but you."},
    {"id": "midtier",  "name": "Static Records", "cut": 0.60, "reach": 3, "cost": 500,
     "blurb": "A real push for a real cut. Decent reach for a modest upfront cost."},
    {"id": "major",   "name": "Chrome Cassette", "cut": 0.35, "reach": 7, "cost": 3000,
     "blurb": "Big distribution, big cut taken. Only worth it for a track you believe in."},
]

MUSIC_KEYS = ["C", "D", "E", "F", "G", "A", "B"]


WHALE_ALERT_TEMPLATES = [
    "{qty} shares of {name} moved from a single wallet to a known exchange address.",
    "A large holder of {name} has gone quiet after moving {qty} shares off-exchange.",
    "A block trade of {qty} {name} shares cleared above the visible order book.",
    "{qty} {name} shares shifted between two addresses with no exchange involved - "
    "accumulation, or just a wallet consolidation.",
    "Desks flag unusual size in {name} after a {qty}-share transfer to cold storage.",
]



WIP_FEATURES = {
    "coop": {
        "label": "Co-op Syndicates", "state": "beta",
        "note": "Found or join a room by code, pool a balance, trade together, chat in "
                "the log, and (owner only) kick, ban or hand over ownership. Updates are "
                "live now - the tab holds a long-poll open and repaints the moment anyone "
                "does anything. The honest caveat is what that costs: each waiting member "
                "parks one server thread, which is fine for a handful of players on the "
                "dev server and would need real websockets for a crowd.",
    },
    "arbitrage": {
        "label": "Arbitrage Engine", "state": "beta",
        "note": "Both legs are real public price feeds - Binance and Kraken - polled "
                "server-side, and a leg that fails is tagged SIMULATED in the panel "
                "rather than quietly inventing a spread. It stays beta for one thing no "
                "amount of code fixes: the captured profit is a flat 10% of the spread, "
                "not a real fill. That is deliberately not a fee-and-slippage model - a "
                "faithful one would net negative on nearly every spread this size, since "
                "round-trip taker fees on ~$93k of notional dwarf a $30 gap. Treat the "
                "profit number as game flavor; the prices are the real part.",
    },
    "vault": {
        "label": "Credential Vault", "state": "beta",
        "note": "PIN-derived encryption at rest for anything you save here. Solid for a "
                "demo project's own secrets - not a claim of audited, unbreakable, "
                "end-to-end cryptography, and a short PIN has a small keyspace (hence the "
                "server-side lockout after 5 bad attempts).",
    },
    "friends_dm": {
        "label": "Friends & DMs", "state": "beta",
        "note": "Friend requests, DMs, read receipts, and optional per-message and "
                "per-attachment encryption all hit real endpoints and persist. Still beta "
                "for the one thing code cannot fix: an encrypted message or file needs "
                "the recipient to know the PIN you chose, and there is deliberately no "
                "in-app way to send it - a server that could hand over the key would "
                "defeat the point. The thread now remembers a passphrase per conversation "
                "in your own browser so you only agree it once, out of band.",
    },
    "google_link": {
        "label": "Google Account Linking", "state": "stub",
        "note": "The OAuth flow, callback route and unlink endpoint are wired up, but "
                "this server has no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured, so "
                "linking stays unavailable until an operator sets those. Nothing in the "
                "code is blocking it.",
    },
}


# ===========================================================================
# Phase 6: harder dial-bots, staff/benefits, boss assignments, gambling
# ===========================================================================

# Each OMNI-BOT now expects a directive that actually references its domain.
# dial_bot_reply() in ai_engine.py checks these before ever calling the model
# - a vague "status report" gets an in-character refusal for free (no tokens
# spent), and only a directive that clears the bar reaches the LLM.
BOT_REQUIREMENTS = {
    "vex": {
        "keywords": ["margin", "leverage", "liquidat", "collateral", "position", "exposure"],
        "min_len": 8,
        "demand": "Give me a position or a leverage figure to check, not small talk.",
    },
    "chronos": {
        "keywords": ["spread", "arbitrage", "exchange", "latency", "sync", "window", "leg"],
        "min_len": 8,
        "demand": "Name the two feeds you want cross-checked. I don't run on vibes.",
    },
    "nyx": {
        "keywords": ["sentiment", "news", "headline", "chatter", "mood", "rumor", "coverage"],
        "min_len": 8,
        "demand": "Which ticker or story? I'm not reading the whole feed for you.",
    },
    "goliath": {
        "keywords": ["order book", "depth", "wall", "liquidity", "bid", "ask", "resistance", "support"],
        "min_len": 8,
        "demand": "Give me a price level or a side of the book. Otherwise I've got nothing.",
    },
}

# Escalating trust: every clean, well-formed directive nudges a bot's trust
# up; every rejected one nudges it down. Below the threshold the bot goes
# openly hostile and needs two good directives in a row to warm back up.
BOT_TRUST_HOSTILE_LINES = [
    "Trust on this channel is thin. Convince me with specifics or don't bother.",
    "Last three requests from this terminal were noise. Make this one count.",
    "I'm two bad directives from dropping this connection.",
]


EMPLOYEE_ROLE_POOL = [
    {"role": "Junior Analyst",      "base_salary": 900,  "benefit": "commission_boost",  "benefit_value": 0.03,
     "benefit_desc": "+3% on every closed deal"},
    {"role": "Risk Officer",        "base_salary": 1300, "benefit": "bill_discount",      "benefit_value": 0.04,
     "benefit_desc": "-4% weekly bills"},
    {"role": "Compliance Lead",     "base_salary": 1500, "benefit": "boss_mood_shield",   "benefit_value": 3,
     "benefit_desc": "+3 boss mood recovery/day"},
    {"role": "Trading Assistant",   "base_salary": 1100, "benefit": "passive_income",     "benefit_value": 45,
     "benefit_desc": "+$45/day passive revenue"},
    {"role": "Client Relations Rep","base_salary": 1200, "benefit": "investor_boost",     "benefit_value": 0.05,
     "benefit_desc": "+5% chance investors say yes"},
    {"role": "Quant Researcher",    "base_salary": 1800, "benefit": "passive_income",     "benefit_value": 90,
     "benefit_desc": "+$90/day passive revenue"},
    {"role": "Office Manager",      "base_salary": 800,  "benefit": "bill_discount",      "benefit_value": 0.06,
     "benefit_desc": "-6% weekly bills"},
    {"role": "Floor Trader",        "base_salary": 1400, "benefit": "commission_boost",   "benefit_value": 0.05,
     "benefit_desc": "+5% on every closed deal"},
]

EMPLOYEE_TRAITS = [
    "meticulous", "a little burnt out", "fiercely competitive", "quietly loyal", "always early",
    "chronically late", "obsessed with spreadsheets", "the office's unofficial therapist",
    "counting down to retirement", "new and eager to prove themselves",
]


def generate_employee_candidates(count=4, seed=None, exclude_names=None):
    """Procedurally generated hire candidates - name, role, salary jitter,
    one concrete benefit, and a personality trait that flavors their AI
    messages later (vacation requests, chat replies)."""
    rng = random.Random(seed)
    exclude_names = exclude_names or set()
    out = []
    tries = 0
    while len(out) < count and tries < count * 8:
        tries += 1
        fname, lname = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        full = f"{fname} {lname}"
        if full in exclude_names:
            continue
        exclude_names.add(full)
        template = rng.choice(EMPLOYEE_ROLE_POOL)
        salary = round(template["base_salary"] * rng.uniform(0.9, 1.25), 2)
        out.append({
            "cand_id": f"cand_{int(rng.random()*1e9)}",
            "name": full,
            "role": template["role"],
            "salary": salary,
            "benefit": template["benefit"],
            "benefit_value": template["benefit_value"],
            "benefit_desc": template["benefit_desc"],
            "trait": rng.choice(EMPLOYEE_TRAITS),
            "avatar_url": avatar_url(f"emp-{full}-{template['role']}"),
        })
    return out


# --- Boss assignments -------------------------------------------------------
# "kind" decides which mini-UI the frontend renders and how the server
# grades the submission - no AI call is needed to *verify* an answer, which
# keeps assignments instant and free to grade; the flavor text asking for it
# can still come from the boss AI voice.
ASSIGNMENT_TEMPLATES = [
    {
        "kind": "reconcile",
        "title": "Reconcile the ledger",
        "brief": "Three of these numbers don't add up to the reported total. Find the one that's wrong.",
        "reward": 220, "penalty": 90, "time_limit": 90,
    },
    {
        "kind": "compliance_quiz",
        "title": "Compliance refresher",
        "brief": "Quick compliance quiz before the auditors show up. Don't embarrass the desk.",
        "reward": 180, "penalty": 60, "time_limit": 60,
    },
    {
        "kind": "cold_call_sprint",
        "title": "Cold-call sprint",
        "brief": "Pitch three prospects back-to-back before the timer runs out.",
        "reward": 260, "penalty": 100, "time_limit": 120,
    },
    {
        "kind": "spot_the_error",
        "title": "Audit the trade blotter",
        "brief": "One line in the blotter has a symbol that isn't in today's market. Flag it.",
        "reward": 200, "penalty": 80, "time_limit": 75,
    },
]

# --- Phase 7: compliance / legal risk ---------------------------------------
# Failing a compliance-flavored assignment can roll into a real audit event
# instead of just the flat cash penalty already on the template. Chance is
# per assignment `kind` - compliance_quiz is the most likely to draw a real
# review, cold_call_sprint never does (it's not a compliance-adjacent task).
# Strike count on GameSave.audit_strikes decides the consequence tier below.
AUDIT_RULES = {
    "trigger_chance": {
        "compliance_quiz": 0.45,
        "reconcile": 0.20,
        "spot_the_error": 0.20,
        "cold_call_sprint": 0.0,
    },
    "fine_pct": 0.08,           # strike 1: fraction of current balance
    "fine_min": 150.0,
    "probation_salary_cut": 0.25,  # strike 2: knocked off salary until a clean week
    "probation_weeks": 2,
}

AUDIT_EVENT_TEXT = {
    1: "Compliance flagged your work for review. You're fined {fine} and it's on your record.",
    2: "A second compliance flag in your file triggers a formal review - you're placed on "
       "probation. Salary cut {cut}% for the next {weeks} weeks while they watch you.",
    3: "A third strike closes it out: compliance refers you to the desk head and you're "
       "terminated for cause.",
}

# --- Phase 7: client relationships -------------------------------------------
CLIENT_TRUST_RULES = {
    "start": 50,
    "deal_delta": 12,          # a closed deal
    "fail_delta": -15,         # a pitch that doesn't land
    "min_call_trust": 15,      # below this, the client may just not pick up
    "decline_chance": 0.55,    # chance of a decline when under min_call_trust
    "referral_trust": 80,      # trust needed for a referral bonus
    "referral_chance": 0.25,
    "referral_bonus_pct": 0.15,  # extra commission on top of the normal cut
}

CLIENT_DECLINE_LINES = [
    "doesn't pick up. Last time didn't go well.",
    "sends it straight to voicemail.",
    "picks up just to say \"not interested, lost my trust in you\" and hangs up.",
]

# --- Phase 7: random events ---------------------------------------------------
# Rolled once a day (low odds) in advance_day. Each entry is a flavor line
# plus a simple, personal, server-computed effect - no global market state
# is touched, so these never affect other players.
RANDOM_EVENTS = [
    {
        "id": "margin_call", "weight": 3,
        "text": "A margin call hits overnight - the desk pulls {amt} straight from your balance "
                "to cover it.",
        "effect": "cash_pct", "pct": 0.06, "min": 40, "max": 600,
    },
    {
        "id": "portfolio_scandal", "weight": 2,
        "text": "A scandal breaks at one of your portfolio picks. Your book takes a {amt} hit "
                "before you can react.",
        "effect": "cash_pct", "pct": 0.09, "min": 60, "max": 900,
    },
    {
        "id": "staff_theft", "weight": 2,
        "text": "One of your staff is caught with a hand in the till. You claw back what you "
                "can, but you're still out {amt}.",
        "effect": "cash_flat_if_staff", "min": 80, "max": 500,
    },
    {
        "id": "lucky_tip", "weight": 2,
        "text": "A contact passes you a legit heads-up before the open. Quiet, but it's worth "
                "{amt} to your balance.",
        "effect": "cash_gain", "min": 50, "max": 400,
    },
    {
        "id": "referral_wave", "weight": 1,
        "text": "Word's gotten around about your work - a wave of goodwill nudges your boss's "
                "mood up.",
        "effect": "boss_mood", "amount": 10,
    },
]
RANDOM_EVENT_DAILY_CHANCE = 0.12

# --- Phase 7: burnout ---------------------------------------------------------
# Reads off the existing `health` column (STRESS% on the HUD is just
# 100-health). High sustained stress starts costing you for real instead of
# just sitting there as a readout.
BURNOUT_RULES = {
    "error_stress_threshold": 70,   # stress % (100-health) above this...
    "error_chance": 0.18,           # ...this % chance a correct assignment answer still fails
    "sick_day_stress_threshold": 85,
    "sick_day_chance": 0.20,        # chance per day of a forced sick day at/above that stress
    "sick_day_health_recovery": 12,
}

# --- Phase 8: OMNI-BOTS become a real, paid mechanic --------------------------
# The OMNI-CORE console already exists as flavor text. This is what makes an
# AI bot an actual *thing in the game*: paying one of the four bots real cash
# (not cosmetic credits - this is a career decision, not a store purchase)
# buys a temporary, mechanically real edge, applied and consumed server-side
# by whichever system the bot covers. Each bot can only sell you its own
# specialty - you can hold more than one buff at once by consulting more than
# one bot, but re-consulting the same one just refreshes its own timer.
AI_CONSULTS = {
    "vex": {
        "cost": 320, "effect": "random_event_shield", "duration_days": 3,
        "blurb": "VEX flags your exposure before the desk finds out. Cuts your odds "
                 "of eating a random-event loss for {days} days.",
    },
    "chronos": {
        "cost": 260, "effect": "arbitrage_window_boost", "duration_days": 3,
        "blurb": "CHRONOS buys you real time on the spread feed - longer capture "
                 "windows and a bigger cut on anything you land, for {days} days.",
    },
    "nyx": {
        "cost": 220, "effect": "client_trust_boost", "duration_days": 3,
        "blurb": "NYX reads the room before you dial. Better trust swings on every "
                 "client call for {days} days.",
    },
    "goliath": {
        "cost": 380, "effect": "audit_shield", "duration_days": 4,
        "blurb": "GOLIATH knows which desks compliance is actually watching this week. "
                 "Cuts your odds of drawing an audit strike for {days} days.",
    },
}

# --- Phase 8: arbitrage engine, repurposed into a real per-operator mechanic --
# It used to auto-credit a fake global "portfolio_equity" number nobody's
# career actually touched. Now: the feed is shared (everyone watches the same
# spread scans, same as a real cross-exchange desk would), but capturing one
# is a manual, timed action that pays real cash into the operator who clicks
# it first - so it's a genuine skill/reflex mechanic, and a race against
# other operators online at the same time, not scenery.
ARBITRAGE_RULES = {
    "spread_threshold": 30,      # spread has to clear this to spawn a capturable window
    "window_seconds": 6,
    "profit_pct": 0.45,          # cut of the spread you bank on a clean capture
    "boosted_window_seconds": 9,
    "boosted_profit_pct": 0.6,
}

# --- Phase 8: syndicate cross-effects ------------------------------------------
# Each syndicate member still plays their own solo career (own GameSave, own
# balance, own risk) - "syndicate" was never meant to mean a shared wallet.
# What it's missing is any actual link between members. HEAT and SENTIMENT
# are that link: a shared, decaying pair of dials per CoopRoom that members'
# own solo actions push, and that in turn nudge everyone else's odds.
SYNDICATE_RULES = {
    "heat_per_audit_strike": 18,     # a member drawing an audit strike raises the room's heat
    "heat_per_default": 12,          # a member defaulting on a loan does too
    "heat_decay_per_day": 4,
    "heat_audit_risk_pct_per_point": 0.006,  # extra audit-trigger chance per point of room heat, for everyone
    "sentiment_per_deal": 3,         # a member closing a client deal nudges room sentiment up
    "sentiment_per_failed_assignment": -2,
    "sentiment_decay_per_day": 2,
    "sentiment_trust_bonus_per_point": 0.15,  # extra client-trust delta per point of positive sentiment, for everyone
    "online_window_minutes": 3,      # a member counts as "online" if their save updated within this window
}

COMPLIANCE_QUESTIONS = [    {"q": "A client asks you to guarantee a specific return. You should:",
     "options": ["Guarantee it to close the deal", "Explain no return can be guaranteed", "Ignore the question"],
     "answer": 1},
    {"q": "You notice a trade was logged at the wrong price. You should:",
     "options": ["Leave it, it's close enough", "Correct the record and note the fix", "Delete the trade"],
     "answer": 1},
    {"q": "A colleague asks you to backdate a client's order. You should:",
     "options": ["Do it, it's a small favor", "Refuse and report it", "Backdate it but tell no one"],
     "answer": 1},
    {"q": "Weekly reporting is due and your numbers look bad. You should:",
     "options": ["Report the real numbers", "Round up until it looks acceptable", "Skip this week's report"],
     "answer": 0},
    {"q": "A client's risk profile is Conservative but they ask you to go all-in on one volatile stock. You should:",
     "options": ["Do exactly what they ask, no questions", "Flag the mismatch and confirm they understand the risk", "Refuse to serve them at all"],
     "answer": 1},
]


# --- Casino / gambling -------------------------------------------------------
SLOT_SYMBOLS = ["7", "BAR", "BELL", "CHERRY", "STAR", "SKULL"]
SLOT_PAYOUTS = {  # multiplier on stake for three-of-a-kind
    "7": 12.0, "BAR": 8.0, "BELL": 6.0, "STAR": 5.0, "CHERRY": 3.0, "SKULL": 0.0,
}
SLOT_WEIGHTS = [3, 6, 8, 8, 10, 14]  # rarer symbols weighted lower, SKULL common (house edge)

CASINO_GAMES = {
    "slots":    {"label": "Slot Machine",   "min_bet": 5,  "max_bet": 2000},
    "coinflip": {"label": "Coin Flip",      "min_bet": 5,  "max_bet": 5000, "payout": 1.92},
    "dice":     {"label": "High-Low Dice",  "min_bet": 5,  "max_bet": 5000},
    "blackjack_quick": {"label": "Quick Blackjack (vs house, single draw)", "min_bet": 5, "max_bet": 3000},
}


def generate_client_bots(count=55, seed=None):
    rng = random.Random(seed)
    bots = []
    for i in range(count):
        fname = rng.choice(FIRST_NAMES)
        lname = rng.choice(LAST_NAMES)
        risk = rng.choice(RISK_PROFILES)
        sector = rng.choice(list(STOCKS.keys()))
        bots.append({
            "id": f"client_{i + 1}",
            "name": f"{fname} {lname}",
            "risk_profile": risk,
            "net_worth": rng.randint(50_000, 2_500_000),
            "target_sector": sector,
            "difficulty": rng.randint(30, 85),
            "avatar_url": avatar_url(f"client-{i + 1}-{fname}-{lname}"),
            "greeting": (
                f"This is {fname} {lname}. I'm reviewing my portfolio and I'm open to a "
                f"{risk.lower()} allocation today - convince me."
            ),
        })
    return bots

# --- Phase 8: politics & economy -----------------------------------------
# Global, ticks for every player identically (rolled once per market_tick,
# not per-player) - see _maybe_political_event() in app.py. Two shapes:
# "sector_shock"/"company_shock" move STOCKS prices; "tax" moves the shared
# market_state["tax_rate"] that advance_day's monthly withholding reads.
POLITICAL_EVENT_TICK_CHANCE = 0.006  # per market_tick (~every few minutes on average)

POLITICAL_SECTORS = [
    "Commodities", "Consumer Tech", "Digital Assets", "Electric Vehicles",
    "Energy", "Healthcare", "Media & Streaming", "Search & Ads",
    "Semiconductors", "Software", "Streaming Video", "Technology",
]

TAX_RATE_MIN = 0.01
TAX_RATE_MAX = 0.12
TAX_RATE_DEFAULT = 0.04

POLITICAL_EVENTS = [
    {"id": "tariff", "kind": "sector_shock", "weight": 18, "pct_range": (-0.09, -0.02),
     "headline": "New tariffs hit {sector} - {name} and peers slide {pct}."},
    {"id": "subsidy", "kind": "sector_shock", "weight": 14, "pct_range": (0.02, 0.08),
     "headline": "Government subsidy announced for {sector} - {name} leads a {pct} rally."},
    {"id": "trade_deal", "kind": "sector_shock", "weight": 10, "pct_range": (0.015, 0.05),
     "headline": "Trade deal signed - {sector} names including {name} climb {pct}."},
    {"id": "corruption", "kind": "company_shock", "weight": 10, "pct_range": (-0.14, -0.04),
     "headline": "Corruption probe opens into {name} executives - shares drop {pct}."},
    {"id": "bailout", "kind": "company_shock", "weight": 8, "pct_range": (0.04, 0.11),
     "headline": "{name} secures a government bailout - shares jump {pct}."},
    {"id": "regulation", "kind": "sector_shock", "weight": 12, "pct_range": (-0.06, -0.015),
     "headline": "New regulation lands on {sector} - {name} and the sector dip {pct}."},
    {"id": "tax_hike", "kind": "tax", "weight": 10, "delta": 0.01,
     "headline": "Legislature raises the capital tax rate to {rate}."},
    {"id": "tax_cut", "kind": "tax", "weight": 10, "delta": -0.01,
     "headline": "Tax cut passed - capital tax rate falls to {rate}."},
]

# OMNI-QUANT: a visible, always-on AI rival that trades the same public
# prices every human sees. Distinct from OMNI-CORE (chat) and the OMNI_BOTS
# dial-pad NPCs (paid consults) - this one just plays the game next to you,
# shows up on the leaderboard, and gives the AI layer an actual presence in
# the world instead of only living behind a chat box.
AI_RIVAL = {
    "name": "OMNI-QUANT",
    "title": "Autonomous Trading Node",
    "bio": "A standing desk order-flow bot the exchange leaves running as a "
           "benchmark. It doesn't sleep, doesn't panic, and doesn't know your name.",
    "start_balance": 25_000.0,
    "trade_chance": 0.35,  # per market_tick
}

# ---------------------------------------------------------------------------
# WORK SHIFTS - the actual job-work minigame. Three task types per shift:
# a ledger reconciliation (arithmetic, but you have to actually add up a
# column of numbers with a rounding trap in it), a commission/algebra
# problem (solve for x), and a short essay against a prompt + required
# terms. See app.py's work_shift_start/work_shift_submit for how these get
# generated with a server-side seed (so the correct answer is never sent to
# the client) and graded.
# ---------------------------------------------------------------------------
ESSAY_PROMPTS = [
    {"id": "quarterly_note", "title": "Quarterly Client Note",
     "brief": "Write a short note to a client explaining why their portfolio is down this quarter without spooking them into pulling out.",
     "must_include": ["volatility", "long-term"], "min_words": 60},
    {"id": "audit_response", "title": "Compliance Audit Response",
     "brief": "Respond to a compliance inquiry about an unusual trade pattern on your desk. Be factual, not defensive.",
     "must_include": ["compliance", "trade"], "min_words": 50},
    {"id": "hire_justification", "title": "Headcount Justification",
     "brief": "Make the case to leadership for why your team needs one more hire this quarter.",
     "must_include": ["headcount", "workload"], "min_words": 50},
    {"id": "incident_summary", "title": "Incident Summary",
     "brief": "Summarize a minor system outage on the trading floor for the daily ops log - what happened, impact, and next steps.",
     "must_include": ["outage", "impact"], "min_words": 55},
    {"id": "market_brief", "title": "Morning Market Brief",
     "brief": "Write the morning brief circulated to the desk before the open - what's moving and why it matters today.",
     "must_include": ["open", "sector"], "min_words": 55},
]

LEDGER_ITEM_POOL = [
    ("Client commission", 40, 900), ("Wire transfer fee", -5, -60),
    ("Office supplies", -10, -150), ("Referral bonus", 20, 500),
    ("Software license", -30, -400), ("Interest earned", 5, 120),
    ("Travel reimbursement", -20, -300), ("Late payment penalty", -15, -250),
    ("Signing bonus (prorated)", 50, 800), ("Compliance fine", -100, -1200),
]

