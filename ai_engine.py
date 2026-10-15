"""AI integration for ASTRA.

Every bot voice in this app - the four omni-bots, the 50+ client bots on the
dial pad, the weekly boss review, the hover explanations, the staff panel -
uses OpenAI when OPENAI_API_KEY is set.

Without any key, every function below falls back to templated variety text,
so the app still runs end to end as a demo. Check ai_available() if you
want to show the user which mode they're in.
"""

import os
import random
import logging

import requests

logger = logging.getLogger("astra.ai")


def _resolve_openai_key():
    return (
        os.environ.get("OPENAI_API_KEY", "").strip()
        or os.environ.get("OPEN_AI_KEY", "").strip()
    )


OPENAI_API_KEY = _resolve_openai_key()
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TTS_MODEL = os.environ.get("OPENAI_TTS_MODEL", "tts-1")
OPENAI_TTS_VOICE = os.environ.get("OPENAI_TTS_VOICE", "onyx")

_ACTIVE_PROVIDER = "openai" if OPENAI_API_KEY else None
MODEL_FAST = OPENAI_MODEL
MODEL_MAIN = OPENAI_MODEL


def ai_available():
    return _ACTIVE_PROVIDER is not None


def active_provider():
    return _ACTIVE_PROVIDER or "offline"


def active_model():
    return OPENAI_MODEL if OPENAI_API_KEY else "n/a"


def tts_available():
    """Server-side OpenAI TTS is only offered if an OpenAI key is present -
    OpenRouter doesn't proxy the audio endpoint. The frontend falls back to
    the browser's own (free) speech synthesis either way, so this only
    gates the higher-quality server voice-over option."""
    return bool(OPENAI_API_KEY)


def synthesize_speech(text, voice=None):
    """Returns raw MP3 bytes for a short line of text, or None if TTS isn't
    configured / the call fails. Callers MUST keep text short - this hits a
    billed endpoint per call, so it's used only for short, user-triggered
    voice-over lines (a bot line, a boss verdict), never bulk text."""
    if not OPENAI_API_KEY or not text:
        return None
    text = text.strip()[:600]
    try:
        resp = requests.post(
            OPENAI_TTS_URL,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={"model": OPENAI_TTS_MODEL, "voice": voice or OPENAI_TTS_VOICE, "input": text},
            timeout=25,
        )
        resp.raise_for_status()
        return resp.content
    except Exception as exc:
        logger.warning("OpenAI TTS call failed: %s", exc)
        return None


def _call(system_prompt, user_prompt, model=MODEL_FAST, max_tokens=200, temperature=0.9,
          image_data_url=None):
    if _ACTIVE_PROVIDER == "openai":
        return _call_openai(system_prompt, user_prompt, max_tokens, temperature, image_data_url)
    return None


def _call_openai(system_prompt, user_prompt, max_tokens=200, temperature=0.9,
                 image_data_url=None):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    user_content = user_prompt
    if image_data_url:
        user_content = [
            {"type": "text", "text": user_prompt},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    try:
        resp = requests.post(OPENAI_URL, headers=headers, json=payload, timeout=12)
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices") or []
        text = (choices[0].get("message", {}).get("content", "") if choices else "").strip()
        return text or None
    except Exception as exc:
        logger.warning("OpenAI call failed: %s", exc)
        return None


LANG_NAMES = {"EN": "English", "ES": "Spanish", "FR": "French", "JA": "Japanese", "DE": "German", "PT": "Portuguese"}


def _lang_line(language):
    name = LANG_NAMES.get((language or "EN").upper(), "English")
    return f" Reply only in {name}." if name != "English" else ""




_BOT_FALLBACKS = {
    "vex": [
        "Margin cushion thinning on three overleveraged longs. Watching the cascade point.",
        "Leverage ratio on the majors ticking up again.",
        "One account rolled off the liquidation watchlist. Two more just joined it.",
    ],
    "chronos": [
        "Cross-exchange desync holding under a second. Window's thin but it's there.",
        "Latency gap widened for a beat, then closed. Someone else caught that one first.",
        "Clock's ticking on the spread. Feed sync in three, two...",
    ],
    "nyx": [
        "Public sentiment's drifting bearish again. Nobody trusts the rally.",
        "Headline noise up, signal down. Standard cycle.",
        "Chatter volume spiking on the majors. Could be nothing. Could be everything.",
    ],
    "goliath": [
        "Thick resting wall just above spot. Somebody's defending that level.",
        "Order book thinning on the bid side. Not a great sign.",
        "Depth looks healthy on both sides for once.",
    ],
}


def bot_log_line(bot, tone_instruction, language="EN"):
    system = bot["persona"] + " " + tone_instruction + _lang_line(language) + " One line only, under 20 words."
    line = _call(system, "Report your current reading.", model=MODEL_FAST, max_tokens=60)
    if line:
        return line.splitlines()[0][:220]
    return random.choice(_BOT_FALLBACKS.get(bot["id"], ["Nominal. No anomalies."]))


def dial_bot_reply(bot, tone_instruction, directive, language="EN", trust=100,
                   image_data_url=None):
    """Harder than it used to be: a directive is checked against the bot's
    domain keywords BEFORE any model call. A vague "status report" gets an
    in-character refusal that costs nothing; only a directive that actually
    references the bot's domain reaches the LLM, and low trust (repeated
    bad directives from this operator) makes the bot outright hostile.
    Returns {"reply": str, "accepted": bool, "trust_delta": int}.
    """
    from game_data import BOT_REQUIREMENTS, BOT_TRUST_HOSTILE_LINES

    req = BOT_REQUIREMENTS.get(bot["id"])
    text = (directive or "").strip().lower()
    hostile = trust < 40

    if req:
        hit = len(text) >= req["min_len"] and any(k in text for k in req["keywords"])
        if not hit:
            prefix = random.choice(BOT_TRUST_HOSTILE_LINES) + " " if hostile else ""
            return {"reply": f"{prefix}{req['demand']}", "accepted": False, "trust_delta": -8}

    system = (
        bot["persona"] + " " + tone_instruction + _lang_line(language) +
        " Keep it to 1-2 short sentences. The operator's directive already cleared your "
        "domain-relevance check, so treat it as a legitimate request and actually act on "
        "it or report a concrete finding - don't just ask them to rephrase. "
        + ("If an image is attached, inspect it and incorporate relevant visible details. " if image_data_url else "")
        + ("You are currently running low on trust for this operator and should sound "
           "clipped and skeptical, but still answer. " if hostile else "")
    )
    reply = _call(system, f"An operator on the terminal just typed this directive at you: {directive!r}",
                  model=MODEL_FAST, max_tokens=100, image_data_url=image_data_url)
    if reply:
        return {"reply": reply, "accepted": True, "trust_delta": 6}
    fallback = f"{bot['name']} acknowledges the directive. {random.choice(_BOT_FALLBACKS.get(bot['id'], ['Standing by.']))}"
    return {"reply": fallback, "accepted": True, "trust_delta": 6}


_SLASH_HELP = (
    "/help - this list\n"
    "/portfolio - cash, holdings, net worth\n"
    "/price TICKER - current price of a stock (e.g. /price TECH)\n"
    "/company TICKER - fundamentals for a stock (e.g. /company POST)\n"
    "/career - job/business status and boss mood\n"
    "/jobs - open firms on the job market\n"
    "/bots - omni-bot roster\n"
    "/music - your released tracks and royalties\n"
    "/wip - features still marked work-in-progress\n"
    "/status - engine + AI connection status\n"
    "/whoami - real account facts pulled straight from your session\n"
    "/reveal - what OMNI-CORE can see about you, color-coded by sensitivity\n"
    "/trace - reveal your own IP/location as seen by this server (needs /trace confirm)\n"
    "/positions - cost basis & unrealized P&L per holding\n"
    "/risk - portfolio concentration/diversification snapshot\n"
    "/mine HASHRATE UNIT [WATTS] [$/KWH] [POOL%] - real Bitcoin mining profitability "
    "(e.g. /mine 110 th 3250 0.12 1)\n"
    "/alert TICKER above|below PRICE - set a price alert (e.g. /alert TECH above 200)\n"
    "/alerts - list your price alerts\n"
    "/translate LANG text - translate text (e.g. /translate ES good morning)\n"
    "/clear - clear this console"
)


def _compact_state(state):
    import json as _json
    save = state.get("save") or {}
    slim = {
        "balance": save.get("balance"), "day": save.get("day"), "week": save.get("week"),
        "job_title": save.get("job_title"), "company_name": save.get("company_name"),
        "job_status": save.get("job_status"), "score": save.get("score"),
        "boss_mood": save.get("boss_mood"),
    }
    try:
        return _json.dumps(slim)
    except Exception:
        return "{}"


def _slash_command(raw, state):
    """Resolves a leading-slash command purely from the live state snapshot
    app.py hands in - no network call, so it's instant, free, and the
    numbers it reports can't be hallucinated. Returns None for an
    unrecognized command, which lets the caller fall through to the model
    (or the plain offline fallback) instead."""
    parts = raw[1:].split(maxsplit=1)
    if not parts:
        return None
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""

    if cmd == "help":
        return "OMNI-CORE command set:\n" + _SLASH_HELP
    if cmd == "clear":
        return "__CLEAR__"

    save = state.get("save") or {}
    stocks = state.get("stocks") or {}

    if cmd == "portfolio":
        if not save:
            return "No active career - start one from the Broker Simulator tab first."
        shares = save.get("shares") or {}
        lines = [f"Cash: ${save.get('balance', 0):,.2f}"]
        if shares:
            for sym, qty in shares.items():
                st = stocks.get(sym)
                if st and qty:
                    lines.append(f"  {sym} x{qty} @ ${st['price']:,.2f} = ${st['price'] * qty:,.2f}")
        else:
            lines.append("  No open positions.")
        lines.append(f"Score: {save.get('score', 0):,}")
        return "\n".join(lines)

    if cmd == "price":
        if not arg:
            return "Usage: /price TICKER (e.g. /price TECH)"
        sym = arg.strip().upper()
        st = stocks.get(sym)
        if not st:
            return f"Unknown ticker '{sym}'."
        return f"{sym} ({st['name']}): ${st['price']:,.2f}"

    if cmd == "company":
        if not arg:
            return "Usage: /company TICKER (e.g. /company POST)"
        sym = arg.strip().upper()
        st = stocks.get(sym)
        if not st:
            return f"Unknown ticker '{sym}'."
        bits = [f"{sym} - {st['name']} ({st.get('sector', '—')})", f"Price: ${st['price']:,.2f}"]
        if st.get("ceo"):
            bits.append(f"CEO: {st['ceo']}")
        if st.get("founded"):
            bits.append(f"Founded: {st['founded']}")
        if st.get("employees"):
            bits.append(f"Employees: {st['employees']:,}")
        if st.get("hq"):
            bits.append(f"HQ: {st['hq']}")
        if st.get("desc"):
            bits.append(st["desc"])
        return "\n".join(bits)

    if cmd == "career":
        if not save:
            return "No active career - start one from the Broker Simulator tab first."
        status = save.get("job_status", "unemployed")
        if status == "unemployed":
            line = "Status: unemployed. Check /jobs for open firms."
        else:
            line = f"{save.get('job_title', '—')} @ {save.get('company_name', '—')} - ${save.get('salary', 0):,.2f}/wk"
        return (
            f"{line}\nBoss mood: {save.get('boss_mood', 0)}/100\n"
            f"Day {save.get('day', 1)} · Week {save.get('week', 1)} · Month {save.get('month', 1)}\n"
            f"Deals closed: {save.get('deals_closed', 0)} · Trades: {save.get('trades_count', 0)} · "
            f"Times fired: {save.get('times_fired', 0)}"
        )

    if cmd == "jobs":
        jobs = state.get("jobs") or []
        if not jobs:
            return "No other open positions right now."
        return "\n".join(f"{j['name']} - ${j['salary']:,.0f}/wk, target ${j['target']:,.0f}/wk" for j in jobs)

    if cmd == "bots":
        bots = state.get("bots") or []
        return "\n".join(f"{b['code']} {b['name']} - {b['role']}" for b in bots) or "No bots loaded."

    if cmd == "music":
        tracks = state.get("tracks") or []
        if not tracks:
            return "No tracks released yet. Open the STUDIO tab to compose one."
        total = sum(t.get("daily_royalty", 0) for t in tracks)
        lines = [f"{t['title']} ({t['genre']}) - ${t.get('daily_royalty', 0):,.2f}/day" for t in tracks]
        lines.append(f"Total: ${total:,.2f}/day across {len(tracks)} track(s).")
        return "\n".join(lines)

    if cmd == "wip":
        from game_data import WIP_FEATURES
        return "\n".join(f"{v['label']} [{v['state'].upper()}]: {v['note']}" for v in WIP_FEATURES.values())

    if cmd == "status":
        live = "LIVE" if ai_available() else "LOCAL (no model key set)"
        return f"OMNI-CORE: {live}\nModel: {MODEL_FAST if ai_available() else 'n/a'}"

    if cmd == "whoami":
        user = state.get("user")
        if not user:
            return "No session data available."
        lines = [
            f"Operator: {user.display_name or user.username} (@{user.username})",
            f"Member since: {user.created_at.strftime('%b %Y') if user.created_at else '—'}",
            f"Language: {user.language} · Theme: {user.theme} · Bot persona: {user.bot_persona}",
            f"Vault: {'set up' if user.vault_pin_hash else 'not set up'} · "
            f"Google linked: {'yes' if user.google_sub else 'no'}",
        ]
        if save:
            lines.append(
                f"Career: {save.get('job_title', '—')} @ {save.get('company_name') or '—'} · "
                f"Score {save.get('score', 0):,}"
            )
        return "\n".join(lines)

    if cmd == "reveal":
        user = state.get("user")
        if not user:
            return "No session data available."
        g, y, r = "#00ff66", "#ffbb00", "#ff3366"

        def row(color, text):
            return f'<span style="color:{color};">&#9632;</span> {text}'

        lines = [
            "What this terminal can see about you, color-coded by sensitivity:",
            row(g, f"Theme: {user.theme} · Language: {user.language} · SFX: "
                   f"{'on' if user.sfx_enabled else 'off'}"),
            row(g, f"Bot persona: {user.bot_persona} · Risk threshold: {user.risk_threshold}"),
            row(y, f"Display name: {user.display_name or user.username} · "
                   f"Bio: {'set' if user.bio else 'not set'}"),
            row(y, f"Career state: {'active' if save else 'no active career'}"),
            row(r, f"Username / login identity: {user.username}"),
            row(r, f"Credential vault: {'unlocked entries exist' if user.vault_pin_hash else 'not set up'} "
                   f"(contents are never shown here - PIN required on the VAULT screen)"),
            row(r, f"Google account link: {'linked - ' + (user.google_email or 'email hidden') if user.google_sub else 'not linked'}"),
        ]
        return "<br>".join(lines)

    if cmd == "positions":
        positions = state.get("positions") or []
        if not positions:
            return ("No open positions - or no cost-basis data recorded for what you hold "
                     "(shares bought before this feature existed won't have one). Trade "
                     "something to start tracking it going forward.")
        lines = []
        for p in positions:
            if p.get("has_basis"):
                sign = "+" if p["unrealized_pnl"] >= 0 else ""
                lines.append(
                    f"{p['symbol']} x{p['qty']} @ avg ${p['avg_cost']:,.2f} -> ${p['price']:,.2f}  "
                    f"({sign}${p['unrealized_pnl']:,.2f}, {sign}{p['unrealized_pnl_pct']:.1f}%)"
                )
            else:
                lines.append(f"{p['symbol']} x{p['qty']} @ ${p['price']:,.2f} - no cost basis on record")
        totals = state.get("totals") or {}
        lines.append(f"Realized P&L to date: ${totals.get('realized_pnl_total', 0):,.2f}")
        return "\n".join(lines)

    if cmd == "risk":
        risk = state.get("risk") or {}
        totals = state.get("totals") or {}
        if not risk:
            return "No active career - nothing to assess yet."
        return (
            f"Concentration: {risk.get('label', '—')} (HHI {risk.get('hhi', 0)})\n"
            f"Cash: {risk.get('cash_pct', 0):.1f}% of net worth (${totals.get('cash', 0):,.2f})\n"
            f"Largest position: {risk.get('top_holding') or '—'} at "
            f"{risk.get('top_holding_pct', 0):.1f}% of net worth\n"
            f"Open positions: {risk.get('position_count', 0)}\n"
            "HHI under 1500 reads diversified, 1500-2500 moderate, above 2500 concentrated - "
            "the same shorthand real portfolio tools use, applied to this book."
        )

    if cmd == "alerts":
        alerts = state.get("alerts") or []
        if not alerts:
            return "No alerts set. /alert TICKER above|below PRICE to add one (e.g. /alert TECH above 200)."
        lines = []
        for a in alerts:
            status = (f"TRIGGERED @ ${a['triggered_price']:,.2f} ({a['triggered_at']})"
                      if a["triggered"] else "watching")
            lines.append(f"#{a['id']} {a['symbol']} {a['direction']} ${a['threshold']:,.2f} - {status}")
        return "\n".join(lines)

    if cmd == "mine":
        if not arg:
            return "Usage: /mine HASHRATE UNIT [WATTS] [$/KWH] [POOL%]\ne.g. /mine 110 th 3250 0.12 1"
        mining = state.get("mining") or {}
        btc_price, difficulty = mining.get("btc_price"), mining.get("btc_difficulty")
        if not btc_price or not difficulty:
            return "Live BTC price/difficulty aren't loaded yet - try again in a few seconds."
        bits = arg.split()
        try:
            import mining_calc
            hashrate = float(bits[0])
            unit = bits[1] if len(bits) > 1 else "th"
            power_w = float(bits[2]) if len(bits) > 2 else 0.0
            cost_kwh = float(bits[3]) if len(bits) > 3 else 0.0
            pool_fee = float(bits[4]) if len(bits) > 4 else 1.0
            r = mining_calc.estimate_profit(hashrate, unit, difficulty, btc_price,
                                             power_watts=power_w, cost_per_kwh=cost_kwh,
                                             pool_fee_pct=pool_fee)
        except (ValueError, IndexError) as e:
            return f"Couldn't parse that: {e}\nUsage: /mine HASHRATE UNIT [WATTS] [$/KWH] [POOL%]"
        live_tag = "live" if mining.get("btc_difficulty_live") else "cached/approximate"
        sign = "+" if r["daily_profit_usd"] >= 0 else ""
        lines = [
            f"BTC ${btc_price:,.2f} · network difficulty {difficulty:,.0f} ({live_tag})",
            f"Your network share: {r['network_share_pct']:.10f}%",
            f"Est. {r['daily_btc_net']:.8f} BTC/day -> ${r['daily_revenue_usd']:,.2f}/day revenue",
        ]
        if power_w:
            lines.append(f"Power cost: ${r['daily_power_cost_usd']:,.2f}/day")
            if r.get("breakeven_kwh_cost") is not None:
                lines.append(f"Breakeven electricity rate: ${r['breakeven_kwh_cost']:.4f}/kWh")
        lines.append(f"Est. profit: {sign}${r['daily_profit_usd']:,.2f}/day · "
                     f"{sign}${r['monthly_profit_usd']:,.2f}/mo")
        return "\n".join(lines)

    if cmd == "translate":
        if not arg:
            return "Usage: /translate LANG text (e.g. /translate ES good morning)"
        bits = arg.split(maxsplit=1)
        if len(bits) < 2:
            return "Usage: /translate LANG text (e.g. /translate ES good morning)"
        target_lang, text = bits[0].upper(), bits[1]
        system = (
            "You are a translation engine. Translate the user's text into "
            f"{target_lang}. Reply with ONLY the translation, no notes, no quotes."
        )
        reply = _call(system, text, model=MODEL_FAST, max_tokens=200)
        if reply:
            return reply.strip()
        return "Translation unavailable in local mode (no OPENAI_API_KEY set)."

    return None


def console_reply(prompt, language="EN", state=None, image_data_url=None):
    """state, when provided by app.py, is a live snapshot (save/stocks/jobs/
    bots/tracks) so slash commands answer from real numbers instead of the
    model guessing. Slash commands resolve locally first - instant, free,
    and correct by construction - before anything reaches the network; only
    a genuine free-text question goes to the LLM."""
    stripped = prompt.strip()
    if stripped.startswith("/"):
        local = _slash_command(stripped, state or {})
        if local is not None:
            return local

    system = (
        "You are OMNI-CORE, the general command assistant inside a fictional retro "
        "trading-terminal game called ASTRA. Answer the operator's question or command "
        "helpfully and briefly, in character as a terminal AI."
        + (" Inspect any attached picture and answer about its visible contents." if image_data_url else "")
        + _lang_line(language)
    )
    if state and state.get("save"):
        system += " Here is the operator's live session state as JSON - use it if relevant: " + _compact_state(state)
    reply = _call(system, prompt, model=MODEL_FAST, max_tokens=180, image_data_url=image_data_url)
    if reply:
        return reply
    return ("OMNI-CORE local mode: no OPENAI_API_KEY configured, so free-form questions get this "
            "static line. Slash commands still work fully offline - try /help.")


def explain_metric(bot, description, language="EN"):
    system = (
        bot["persona"] + " An operator is hovering over a UI element and wants a quick, "
        "plain explanation of what it means. Explain it in one short sentence, in your "
        "voice, based on this definition: " + description + _lang_line(language)
    )
    text = _call(system, "Explain it now.", model=MODEL_FAST, max_tokens=60)
    return text or f"{bot['name']}: {description}"




def interview_opening(firm, language="EN"):
    system = (
        f"You are {firm['interviewer']}. You're interviewing a candidate for a broker "
        f"position at {firm['name']} in a fictional retro trading-terminal game. Open the "
        "interview with a short greeting and then ask ONE specific interview question "
        "(about their experience, work ethic, or how they'd handle a difficult client). "
        "2-3 sentences total. Stay in character. This is a fictional game; never give "
        "real financial or career advice." + _lang_line(language)
    )
    text = _call(system, "Begin the interview.", model=MODEL_FAST, max_tokens=120)
    return text or (
        f"Welcome to {firm['name']}. Before we go further - why should we trust you "
        "with our clients' money?"
    )


def interview_reply(firm, transcript, answer, turn, language="EN"):
    """turn is the 0-indexed number of answers the candidate has already given
    (before this one). Returns {"reply": str, "decision": "HIRE"|"REJECT"|None}."""
    final_turn = turn >= 1  
    system = (
        f"You are {firm['interviewer']}, continuing a job interview for a broker "
        f"position at {firm['name']} in a fictional retro trading-terminal game. "
        "Judge the candidate's answers on confidence, composure, and whether they sound "
        "competent - reward specific, concrete answers over vague ones. "
        + ("This is their final answer. Respond in 1-2 sentences reacting to it, then on a "
           "new final line write exactly 'DECISION: HIRE' or 'DECISION: REJECT'. "
           if final_turn else
           "React in 1 short sentence, then ask ONE more short follow-up interview question. "
           "Do not make a decision yet.")
        + " Stay in character throughout. This is a fictional game; never give real career "
        "or financial advice." + _lang_line(language)
    )
    prompt = f"Interview so far:\n{transcript}\n\nCandidate's latest answer: {answer!r}"
    raw = _call(system, prompt, model=MODEL_MAIN, max_tokens=160)

    if raw and final_turn:
        lines = raw.strip().splitlines()
        decision_line = lines[-1].upper() if lines else ""
        decision = "HIRE" if ("HIRE" in decision_line and "REJECT" not in decision_line) else "REJECT" if "DECISION" in decision_line else None
        reply = "\n".join(lines[:-1]).strip() if "DECISION:" in decision_line else raw
        if decision is None:
            decision = "HIRE" if any(w in raw.lower() for w in ("welcome aboard", "you're hired", "hired")) else "REJECT"
        return {"reply": reply or raw, "decision": decision}

    if raw:
        return {"reply": raw, "decision": None}

    if final_turn:
        decision = "HIRE" if len(answer) > 15 else "REJECT"
        reply = ("Good enough - welcome aboard." if decision == "HIRE"
                  else "That's not the answer we're looking for. We'll pass.")
        return {"reply": reply, "decision": decision}
    return {"reply": "Noted. One more thing - how do you handle a client who wants to pull out at a loss?", "decision": None}


def boss_followup(stats, message, language="EN"):
    """Interactive reply from the boss during the weekly review conversation."""
    system = (
        "You are the fictional Executive Overseer at a retro brokerage-sim game called "
        "ASTRA, mid-conversation with an employee during their weekly performance review. "
        "Be terse, in character, and respond directly to what they just said - approving "
        "if they have a good excuse or plan, unimpressed if they're making excuses. "
        "1-2 sentences." + _lang_line(language)
    )
    prompt = (
        f"Week {stats['week']}, target ${stats['target']:.2f}, they closed "
        f"${stats['commission']:.2f}. Boss mood is currently {stats.get('boss_mood', 100)}/100. "
        f"The employee just said: {message!r}"
    )
    text = _call(system, prompt, model=MODEL_FAST, max_tokens=100)
    return text or "Noted. Get back to work."


def client_pitch_reply(client, message, language="EN", image_data_url=None):
    """Returns {"reply": str, "invests": bool}."""
    system = (
        f"You are {client['name']}, a fictional investment client in a retro broker-"
        f"simulator game. Your risk profile is {client['risk_profile']}, your net worth "
        f"is ${client['net_worth']:,}, and you're specifically interested in the "
        f"{client['target_sector']} sector. A broker is pitching you on the phone. "
        "Judge the pitch on its merits for a client like you - reward pitches that "
        "mention your sector and use terms like profit, growth, dividend, or security; "
        "be skeptical of empty guarantees. If the broker hasn't actually answered a "
        "question you previously asked them, call that out and be less convinced. "
        + ("Also consider the attached picture as part of the pitch. " if image_data_url else "")
        + "Reply "
        "in 1-3 sentences in character - and if you're not ready to decide yet, end with "
        "a real follow-up question of your own (about risk, timeline, or fees) instead of "
        "deciding - then on a new final line write exactly 'DECISION: INVEST' or "
        "'DECISION: DECLINE'. This is a fictional game; never give real investment advice." + _lang_line(language)
    )
    raw = _call(system, message, model=MODEL_MAIN, max_tokens=180, image_data_url=image_data_url)
    if raw:
        lines = raw.strip().splitlines()
        decision_line = lines[-1].upper() if lines else ""
        invests = "INVEST" in decision_line and "DECLINE" not in decision_line
        reply = "\n".join(lines[:-1]).strip() if "DECISION:" in decision_line else raw
        if reply:
            return {"reply": reply, "invests": invests}

    return _client_pitch_fallback(client, message)


def _client_pitch_fallback(client, message):
    text = message.lower()
    score = 0
    if client["target_sector"].lower() in text:
        score += 40
    if any(w in text for w in ("profit", "dividend", "growth", "secure", "security")):
        score += 30
    if "guarantee" in text:
        score -= 20
    invests = score >= 50
    if invests:
        reply = (f"Your pitch on {client['target_sector']} sounds compelling. "
                  "I'll allocate funds - pleasure doing business.")
    else:
        reply = f"I'm not convinced yet about {client['target_sector']}. Let's revisit this later."
    return {"reply": reply, "invests": invests}


def client_greeting(client, language="EN"):
    system = (
        f"You are {client['name']}, a fictional investment client, {client['risk_profile']}, "
        f"interested in {client['target_sector']}. Open a phone call with your broker in "
        "1-2 short sentences, in character, ending with a real question for the broker "
        "(about a sector, a risk, or what they'd recommend) that they need to answer." + _lang_line(language)
    )
    text = _call(system, "Open the call.", model=MODEL_FAST, max_tokens=60)
    return text or client["greeting"]



def employee_vacation_request(employee, stats, language="EN"):
    """A longer, in-character vacation-request message from a named
    employee, varying in tone with their trait and the company's current
    boss mood. Returns plain text (2-5 sentences)."""
    system = (
        f"You are {employee['name']}, a {employee['role']} at a fictional brokerage in a "
        f"retro terminal game called ASTRA. Your personality trait: {employee['trait']}. "
        "Write a message to your boss (the player) asking for time off. Vary your approach "
        "based on your personality - some employees are apologetic, some are blunt, some "
        "over-explain, some negotiate. Mention roughly how many days you want (2-10) and "
        "whether you'd accept it unpaid if needed, or whether you specifically need it paid. "
        "3-5 sentences, written as a real message, no headers or signatures." + _lang_line(language)
    )
    prompt = (
        f"Company boss mood is currently {stats.get('boss_mood', 100)}/100. Your salary is "
        f"${employee.get('salary', 0):,.0f}/wk. Write the request now."
    )
    text = _call(system, prompt, model=MODEL_FAST, max_tokens=180)
    if text:
        return text
    return (
        f"Hey - it's {employee['name']}. I need some time off, probably a week. "
        "Paid if that's possible, but I understand if it can't be. Let me know."
    )


def employee_chat_reply(employee, message, stats, language="EN"):
    """In-character reply from a named employee to a direct message from
    the player (their boss). Used by the STAFF panel's 'talk to employee'
    composer."""
    system = (
        f"You are {employee['name']}, a {employee['role']} at a fictional brokerage in a "
        f"retro terminal game called ASTRA. Your personality trait: {employee['trait']}. "
        "Reply to a direct message from your boss (the player) in 1-3 sentences, staying "
        "in character. This is a fictional game; never give real financial advice." + _lang_line(language)
    )
    prompt = f"Boss mood toward staff is {stats.get('boss_mood', 100)}/100. Your boss just wrote: {message!r}"
    text = _call(system, prompt, model=MODEL_FAST, max_tokens=120)
    if text:
        return text
    return f"{employee['name']}: Got it, boss."


def investor_inbox_message(client, language="EN"):
    """An unsolicited, detailed inbound message from an investor/client -
    distinct from the live phone-call flow, this is an inbox item with a
    real, specific question the player has to actually answer."""
    system = (
        f"You are {client['name']}, a fictional investment client in a retro broker-sim "
        f"game. Risk profile: {client['risk_profile']}. Net worth: ${client['net_worth']:,}. "
        f"Sector interest: {client['target_sector']}. Write a short email-style message to "
        "your broker (the player) with ONE specific, concrete question about your "
        "portfolio, a sector, fees, or risk - something that actually needs a real answer, "
        "not small talk. 2-4 sentences. This is a fictional game; never give real "
        "investment advice." + _lang_line(language)
    )
    text = _call(system, "Write the message now.", model=MODEL_FAST, max_tokens=140)
    if text:
        return text
    return (
        f"This is {client['name']}. I've been thinking about my exposure to "
        f"{client['target_sector']} - what's your honest read on the risk right now?"
    )


def investor_inbox_reply(client, thread, message, language="EN", image_data_url=None):
    """Reply to an investor inbox message. Same INVEST/DECLINE grading as
    the live call flow, so a good written answer can still close the deal.
    Returns {"reply": str, "invests": bool}."""
    system = (
        f"You are {client['name']}, a fictional investment client. Risk profile: "
        f"{client['risk_profile']}. Net worth: ${client['net_worth']:,}. Sector interest: "
        f"{client['target_sector']}. You messaged your broker with a question; they just "
        "replied. Judge whether their reply actually answers your question and is "
        "reasonably convincing for a client like you. Reply in 1-3 sentences in character, "
        "then on a new final line write exactly 'DECISION: INVEST' or 'DECISION: DECLINE'. "
        + ("Consider the attached picture while judging the broker's reply. " if image_data_url else "")
        + "This is a fictional game; never give real investment advice." + _lang_line(language)
    )
    prompt = f"Your original message: {thread!r}\n\nBroker's reply: {message!r}"
    raw = _call(system, prompt, model=MODEL_MAIN, max_tokens=160, image_data_url=image_data_url)
    if raw:
        lines = raw.strip().splitlines()
        decision_line = lines[-1].upper() if lines else ""
        invests = "INVEST" in decision_line and "DECLINE" not in decision_line
        reply = "\n".join(lines[:-1]).strip() if "DECISION:" in decision_line else raw
        if reply:
            return {"reply": reply, "invests": invests}
    return _client_pitch_fallback(client, message)


def boss_assignment_brief(assignment, stats, language="EN"):
    """Flavor text from the boss introducing a fresh assignment. Grading is
    always done server-side without AI - this is just the framing line."""
    system = (
        "You are the fictional Executive Overseer at a retro brokerage-sim game called "
        "ASTRA, handing an employee a task. Be terse and in character, 1-2 sentences, "
        "introducing the task below without restating its full instructions." + _lang_line(language)
    )
    prompt = f"Task: {assignment['title']} - {assignment['brief']}. Week {stats.get('week', 1)}."
    text = _call(system, prompt, model=MODEL_FAST, max_tokens=90)
    return text or f"{assignment['title']}. {assignment['brief']}"


def boss_weekly_review(stats, language="EN"):
    """stats: dict with week, hit_target, commission, target, job_title, difficulty."""
    system = (
        "You are the fictional Executive Overseer at a retro brokerage-sim game called "
        "ASTRA, reviewing an employee's week. Be terse and in character - approving if "
        "they hit target, cutting if they missed it. 2-3 sentences." + _lang_line(language)
    )
    prompt = (
        f"Week {stats['week']}. Job title: {stats['job_title']}. Difficulty: {stats['difficulty']}. "
        f"Target was ${stats['target']:.2f}, they closed ${stats['commission']:.2f} in commissions. "
        f"They {'hit' if stats['hit_target'] else 'missed'} target."
    )
    text = _call(system, prompt, model=MODEL_MAIN, max_tokens=150)
    mood = "APPROVING" if stats["hit_target"] else "DISPLEASED"
    if text:
        return {"mood": mood, "message": text}
    if stats["hit_target"]:
        message = f"Week {stats['week']} target cleared. Keep this pace and a corner office isn't far off."
    else:
        message = f"Week {stats['week']} target missed. One more shortfall and we talk about your future here."
    return {"mood": mood, "message": message}