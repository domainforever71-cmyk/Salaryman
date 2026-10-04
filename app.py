import integrity
integrity.enforce()

import base64
import json
import math
import os
import random
import re
import secrets
import sys
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from functools import wraps
from urllib.parse import urlencode

import requests
from sqlalchemy.exc import IntegrityError
from flask import Flask, Response, render_template, jsonify, request, session, redirect, url_for

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import ai_engine as ai
import vault_crypto as vault
import mining_calc
from game_data import (
    STOCKS, OMNI_BOTS, PERSONA_TONES, METRIC_REGISTRY, COIN_IDS, JOB_LADDER,
    JOB_LISTINGS, AVATAR_PRESETS, FRAMES, THEMES, WIP_FEATURES, CREDIT_RULES, BANK_TIERS,
    AUDIT_RULES, AUDIT_EVENT_TEXT, CLIENT_TRUST_RULES, CLIENT_DECLINE_LINES,
    RANDOM_EVENTS, RANDOM_EVENT_DAILY_CHANCE, BURNOUT_RULES,
    CREDIT_SINKS, WHALE_ALERT_TEMPLATES,
    MUSIC_GENRES, MUSIC_LABELS, MUSIC_KEYS, generate_client_bots,
    generate_employee_candidates, ASSIGNMENT_TEMPLATES, COMPLIANCE_QUESTIONS,
    SLOT_SYMBOLS, SLOT_PAYOUTS, SLOT_WEIGHTS, CASINO_GAMES,
    POLITICAL_EVENTS, POLITICAL_SECTORS, POLITICAL_EVENT_TICK_CHANCE,
    TAX_RATE_MIN, TAX_RATE_MAX, TAX_RATE_DEFAULT, AI_RIVAL, AI_CONSULTS,
    ESSAY_PROMPTS, LEDGER_ITEM_POOL,
)
from models import (
    db, User, GameSave, CoopRoom, CoopMembership, CoopLogEntry,
    LinkedDevice, VaultEntry, MusicTrack, Friendship, DirectMessage,
    DMAttachment, TradeOffer, CreditLedger, CoopBan, PriceAlert, PlayerHire,
    Report, ImageAsset, ensure_schema,
)

from astra_net import find_user, ensure_admin, sync_admins, init_net

app = Flask(__name__)
secret_key = os.environ.get("SECRET_KEY")
_hosted = bool(os.environ.get("VERCEL") or os.environ.get("RENDER") or os.environ.get("ASTRA_HOSTED"))
if _hosted and not secret_key:
    raise RuntimeError("A hosted deployment requires a stable SECRET_KEY environment variable.")
app.secret_key = secret_key or "dev-only-change-me"
app.config["SESSION_COOKIE_SECURE"] = _hosted
if os.environ.get("ASTRA_BEHIND_PROXY", "").strip() == "1":
    # Behind the Cloudflare Worker/Pages proxy: trust its X-Forwarded-* headers so redirects
    # and Google sign-in use the public address.
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def _default_data_dir():
    if not getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(__file__))
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    probe = os.path.join(exe_dir, ".astra_write_test")
    try:
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
        return exe_dir
    except OSError:
        pass
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    data_dir = os.path.join(base, "Astra")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


DATA_DIR = _default_data_dir()
DB_PATH = os.path.join(DATA_DIR, "astra.db")
database_url = ""
for env_name in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"):
    candidate = os.environ.get(env_name, "").strip()
    if candidate and candidate not in ("sqlite://", "sqlite:///"):
        database_url = candidate
        break
if database_url.startswith("postgres://"):
    database_url = "postgresql://" + database_url[len("postgres://"):]
if _hosted and (
    not database_url or database_url.startswith("sqlite:")
):
    raise RuntimeError(
        "Vercel requires a persistent database. Set DATABASE_URL or POSTGRES_URL "
        "to a managed PostgreSQL connection string."
    )
app.config["SQLALCHEMY_DATABASE_URI"] = database_url or (
    "sqlite:///" + DB_PATH.replace("\\", "/")
)
if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "connect_args": {"timeout": 15},
    }
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

with app.app_context():
    db.create_all()
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        from sqlalchemy import text
        db.session.execute(text("PRAGMA journal_mode=WAL"))
        db.session.execute(text("PRAGMA synchronous=NORMAL"))
        db.session.commit()

    ensure_schema(db.engine)
    sync_admins()


GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

market_state = {
    "portfolio_equity": 42150.00,
    "running_arbitrage": False,
    "scans_performed": 0,
    "opportunities_captured": 0,
    "latest_spreads": [],
    "global_logs": [],
    "bot_logs": {b["id"]: [] for b in OMNI_BOTS},
 
    "btc_price": 93000.0,
    "btc_difficulty": None,

    "tax_rate": TAX_RATE_DEFAULT,
    "political_log": [],
    "ai_rival": {
        "balance": AI_RIVAL["start_balance"],
        "holdings": {},
        "last_move": "Awaiting first move...",
        "equity": AI_RIVAL["start_balance"],
    },
}

PRICE_HISTORY = {sym: deque([s["price"]], maxlen=120) for sym, s in STOCKS.items()}


feed_health = {"binance": False, "kraken": False, "difficulty": False}

bot_broadcast_queue = deque(maxlen=30)
CLIENT_BOTS = generate_client_bots()
state_lock = threading.Lock()
_tick_count = 0


def log_event(message):
    entry = f"[{time.strftime('%H:%M:%S')}] {message}"
    market_state["global_logs"].append(entry)
    del market_state["global_logs"][:-100]


def fetch_btc_price():
    try:
        resp = requests.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", timeout=2)
        price = float(resp.json()["price"])
        feed_health["binance"] = True
        return price
    except Exception:
        feed_health["binance"] = False
        return 93000.0 + random.uniform(-100, 100)


def fetch_kraken_price(reference):
    try:
        resp = requests.get("https://api.kraken.com/0/public/Ticker?pair=XBTUSDT", timeout=2)
        payload = resp.json()
        result = payload.get("result") or {}
        pair = next(iter(result.values()))
        price = float(pair["c"][0])
        feed_health["kraken"] = True
        return price
    except Exception:
        feed_health["kraken"] = False
        return reference + random.uniform(-60, 60)


def fetch_btc_difficulty():
    try:
        resp = requests.get("https://blockchain.info/q/getdifficulty", timeout=3)
        value = float(resp.text.strip())
        feed_health["difficulty"] = True
        return value
    except Exception:
        feed_health["difficulty"] = False

        return 95_000_000_000_000.0


def _maybe_political_event():
    if random.random() >= POLITICAL_EVENT_TICK_CHANCE:
        return
    weights = [e["weight"] for e in POLITICAL_EVENTS]
    ev = random.choices(POLITICAL_EVENTS, weights=weights, k=1)[0]

    if ev["kind"] == "sector_shock":
        sector = random.choice(POLITICAL_SECTORS)
        members = [sym for sym, st in STOCKS.items() if st["sector"] == sector]
        if not members:
            return
        pct = random.uniform(*ev["pct_range"])
        lead = STOCKS[members[0]]
        for sym in members:
            STOCKS[sym]["price"] = round(max(1.0, STOCKS[sym]["price"] * (1 + pct)), 2)
            PRICE_HISTORY[sym].append(STOCKS[sym]["price"])
        headline = ev["headline"].format(sector=sector, name=lead["name"], pct=f"{abs(pct) * 100:.1f}%")
    elif ev["kind"] == "company_shock":
        symbol = random.choice(list(STOCKS.keys()))
        stock = STOCKS[symbol]
        pct = random.uniform(*ev["pct_range"])
        stock["price"] = round(max(1.0, stock["price"] * (1 + pct)), 2)
        PRICE_HISTORY[symbol].append(stock["price"])
        headline = ev["headline"].format(name=stock["name"], pct=f"{abs(pct) * 100:.1f}%")
    elif ev["kind"] == "tax":
        new_rate = round(min(TAX_RATE_MAX, max(TAX_RATE_MIN,
                                                 market_state.get("tax_rate", TAX_RATE_DEFAULT) + ev["delta"])), 3)
        market_state["tax_rate"] = new_rate
        headline = ev["headline"].format(rate=f"{new_rate * 100:.1f}%")
    else:
        return

    entry = {"id": ev["id"], "headline": headline, "time": time.strftime("%H:%M:%S")}
    market_state["political_log"].insert(0, entry)
    del market_state["political_log"][30:]
    log_event(f"POLITICS: {headline}")


def ai_rival_tick():
    rival = market_state["ai_rival"]
    if random.random() >= AI_RIVAL["trade_chance"]:
        return
    symbol = random.choice(list(STOCKS.keys()))
    stock = STOCKS[symbol]
    hist = list(PRICE_HISTORY[symbol])
    momentum = (hist[-1] - hist[0]) if len(hist) >= 2 else 0
    action = "buy" if momentum >= 0 else "sell"
    holdings = rival["holdings"]
    if action == "sell" and holdings.get(symbol, 0) <= 0:
        action = "buy"
    price = stock["price"]
    if action == "buy":
        max_affordable = int(rival["balance"] // price) if price > 0 else 0
        qty = min(max_affordable, random.randint(1, 40))
        if qty <= 0:
            return
        cost = round(price * qty, 2)
        rival["balance"] = round(rival["balance"] - cost, 2)
        holdings[symbol] = holdings.get(symbol, 0) + qty
        rival["last_move"] = f"BUY {qty} {symbol} @ ${price:.2f}"
    else:
        qty = min(holdings.get(symbol, 0), random.randint(1, 40))
        if qty <= 0:
            return
        proceeds = round(price * qty, 2)
        rival["balance"] = round(rival["balance"] + proceeds, 2)
        holdings[symbol] -= qty
        rival["last_move"] = f"SELL {qty} {symbol} @ ${price:.2f}"
    rival["holdings"] = holdings
    equity = rival["balance"] + sum(STOCKS[s]["price"] * q for s, q in holdings.items() if q > 0)
    rival["equity"] = round(equity, 2)
    log_event(f"[OMNI-QUANT] {rival['last_move']}")


def market_tick():
    global _tick_count
    btc_price = fetch_btc_price()
    kraken_price = fetch_kraken_price(btc_price)
    spread = abs(btc_price - kraken_price)

 
    difficulty = None
    if market_state.get("btc_difficulty") is None or _tick_count % 200 == 0:
        difficulty = fetch_btc_difficulty()

    with state_lock:
        market_state["btc_price"] = round(btc_price, 2)
        if difficulty is not None:
            market_state["btc_difficulty"] = difficulty


        if random.random() < 0.02:
            w_symbol = random.choice(list(STOCKS.keys()))
            w_stock = STOCKS[w_symbol]
            w_qty = random.choice([500, 1200, 2500, 4800, 9000, 15000, 22000])
            w_headline = random.choice(WHALE_ALERT_TEMPLATES).format(
                qty=f"{w_qty:,}", name=w_stock["name"]
            )
            log_event(f"MARKET NEWS: \U0001F433 WHALE ALERT: {w_headline} ({w_symbol})")

        if market_state["running_arbitrage"]:
            market_state["scans_performed"] += 1
            entry = {
                "id": market_state["scans_performed"],
                "binance": round(btc_price, 2),
                "kraken": round(kraken_price, 2),
                "spread": round(spread, 2),
                "status": "OPTIMAL PROFIT" if spread > 30 else "STANDARD SPREAD",
                "binance_live": feed_health["binance"],
                "kraken_live": feed_health["kraken"],
            }
            market_state["latest_spreads"].insert(0, entry)
            del market_state["latest_spreads"][15:]
            if spread > 30:
                market_state["opportunities_captured"] += 1
                profit = round(spread * 0.1, 2)
                market_state["portfolio_equity"] += profit
                log_event(f"Arbitrage executed: captured a ${spread:.2f} spread for +${profit}.")

        for symbol, stock in STOCKS.items():
            delta = random.uniform(-1.6, 1.6) * stock["volatility"]
            stock["price"] = round(max(1.0, stock["price"] + delta), 2)
            PRICE_HISTORY[symbol].append(stock["price"])


        if random.random() < 0.04:
            symbol = random.choice(list(STOCKS.keys()))
            stock = STOCKS[symbol]
            direction = random.choice([1, -1])
            pct = random.uniform(0.05, 0.14) * direction
            stock["price"] = round(max(1.0, stock["price"] * (1 + pct)), 2)
            headline = random.choice(
                [f"{stock['name']} surges on strong sector momentum.",
                 f"{stock['name']} rallies after unexpected demand.",
                 f"{stock['name']} spikes on takeover rumors."]
                if pct > 0 else
                [f"{stock['name']} slides on weak outlook.",
                 f"{stock['name']} drops after disappointing guidance.",
                 f"{stock['name']} tumbles amid sector sell-off."]
            )
            PRICE_HISTORY[symbol].append(stock["price"])
            log_event(f"MARKET NEWS: {headline} ({symbol} {pct*100:+.1f}%)")

        _maybe_political_event()

        _tick_count += 1
        if _tick_count % 100 == 0:  
            for stock in STOCKS.values():
                stock["open"] = stock["price"]
        if _tick_count % 20 == 0:
            ai_rival_tick()

    _apply_admin_market_events()
    _apply_admin_live_events()
    if _tick_count % 4 == 0:
        speak_random_bot()


def _apply_admin_market_events():
    """Start any admin crash/boom whose time has come: post the headline and, for the desk stocks
    (TECH, OIL, ...), apply the one-off price shock. Economy stocks follow economy.event_factor."""
    try:
        from economy import MarketEvent, invalidate_events
        with app.app_context():
            due = MarketEvent.query.filter(
                MarketEvent.applied.is_(False), MarketEvent.cancelled.is_(False),
                MarketEvent.start_at <= datetime.utcnow()).order_by(MarketEvent.id).limit(10).all()
            if not due:
                return
            for ev in due:
                ev.applied = True
                targets = list(STOCKS) if ev.symbol == "ALL" else ([ev.symbol] if ev.symbol in STOCKS else [])
                with state_lock:
                    for sym in targets:
                        STOCKS[sym]["price"] = round(max(1.0, STOCKS[sym]["price"] * (1 + ev.pct)), 2)
                        PRICE_HISTORY[sym].append(STOCKS[sym]["price"])
                if ev.symbol == "ALL":
                    name = "The whole market"
                else:
                    name = STOCKS[ev.symbol]["name"] if ev.symbol in STOCKS else ev.symbol
                verb = "crashes" if ev.pct < 0 else "surges"
                headline = ev.note or (f"{name} {verb} {abs(ev.pct) * 100:.0f}% in a sudden "
                                       f"{'sell-off' if ev.pct < 0 else 'rally'}.")
                entry = {"id": f"admin-{ev.id}", "headline": headline, "time": time.strftime("%H:%M:%S")}
                with state_lock:
                    market_state["political_log"].insert(0, entry)
                    del market_state["political_log"][30:]
                log_event(f"MARKET NEWS: {headline} ({ev.symbol} {ev.pct * 100:+.0f}%)")
            db.session.commit()
            invalidate_events()
    except Exception as exc:
        log_event(f"Market event hiccup: {exc}")


def _apply_admin_live_events():
    """Fire admin stimulus / levy / raffle events whose time has come."""
    try:
        from world import process_due_live_events, process_due_court_cases
        with app.app_context():
            process_due_live_events()
            process_due_court_cases()
    except Exception as exc:
        log_event(f"Live event hiccup: {exc}")


def speak_random_bot():
    bot = random.choice(OMNI_BOTS)
    line = ai.bot_log_line(bot, PERSONA_TONES["ruthless"])
    with state_lock:
        market_state["bot_logs"][bot["id"]].insert(0, line)
        del market_state["bot_logs"][bot["id"]][10:]
    log_event(f"[{bot['name']}] {line}")
    bot_broadcast_queue.append(f"{bot['name']} ({bot['role']}): {line}")


def market_loop():
    while True:
        time.sleep(3)
        try:
            market_tick()
        except Exception as exc:
            log_event(f"Market engine hiccup: {exc}")


threading.Thread(target=market_loop, daemon=True).start()



def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Unauthorized"}), 401

        if current_user() is None:
            session.clear()
            return jsonify({"error": "Session expired, please log in again"}), 401
        if current_user().is_banned:
            session.clear()
            return jsonify(success=False, msg="This operator account is suspended."), 403
        return view(*args, **kwargs)
    return wrapped


def current_user():
    uid = session.get("user_id")
    user = db.session.get(User, uid) if uid else None
    if user is not None and not user.is_admin:
        ensure_admin(user)
    return user


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Unauthorized"}), 401
        user = current_user()
        if user is None:
            session.clear()
            return jsonify({"error": "Session expired, please log in again"}), 401
        if user.is_banned:
            session.clear()
            return jsonify(success=False, msg="This operator account is suspended."), 403
        if not user.is_admin:
            return jsonify(success=False, msg="Admins only."), 403
        return view(*args, **kwargs)
    return wrapped


def get_or_create_save(user):
    save = GameSave.query.filter_by(user_id=user.id).first()
    if not save:
        save = GameSave(user_id=user.id)
        db.session.add(save)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            save = GameSave.query.filter_by(user_id=user.id).first()
            if not save:
                raise
    _catch_up_day(user, save)
    return save


DAY_TICK_SECONDS = 30

MAX_LIVE_CATCHUP_TICKS = 5

_epoch_cache = {"value": None}


def _server_epoch():
    if _epoch_cache["value"] is None:
        first = db.session.query(db.func.min(User.created_at)).scalar()
        _epoch_cache["value"] = first or datetime.utcnow()
    return _epoch_cache["value"]


def _target_day_number():
    elapsed = (datetime.utcnow() - _server_epoch()).total_seconds()
    return max(1, int(elapsed // DAY_TICK_SECONDS) + 1)


def _seconds_to_next_tick():
    elapsed = (datetime.utcnow() - _server_epoch()).total_seconds()
    return DAY_TICK_SECONDS - (elapsed % DAY_TICK_SECONDS)


def _catch_up_day(user, save):
    if not save.active:
        return
    target = _target_day_number()
    last_tick = save.world_tick or target
    if last_tick >= target:
        if save.world_tick != target:
            save.world_tick = target
            db.session.commit()
        return
    elapsed_ticks = target - last_tick
    ticks = min(elapsed_ticks, MAX_LIVE_CATCHUP_TICKS)
    _catchup_events = []
    for _ in range(ticks):
        if not save.active:
            break
        _run_day_tick(user, save, _catchup_events)
    skipped_ticks = elapsed_ticks - ticks
    if save.active and skipped_ticks:
        previous_day = save.day
        save.day += skipped_ticks
        save.week += (save.day - 1) // 7 - (previous_day - 1) // 7
        save.month += (save.day - 1) // 30 - (previous_day - 1) // 30
        save.age = 20 + (save.month - 1) // 12
        if save.age >= 80:
            save.active = False
    save.world_tick = target
    db.session.commit()


def register_device(user):
    token = request.cookies.get("device_token")
    device = LinkedDevice.query.filter_by(device_token=token).first() if token else None
    if not device or device.user_id != user.id:
        token = secrets.token_hex(20)
        device = LinkedDevice(
            user_id=user.id, device_token=token, label="New Terminal",
            user_agent=(request.headers.get("User-Agent") or "")[:255],
        )
        db.session.add(device)
    else:
        device.last_seen = datetime.utcnow()
        device.user_agent = (request.headers.get("User-Agent") or "")[:255]
    db.session.commit()
    return token


def _set_device_cookie(resp, token):
    resp.set_cookie("device_token", token, max_age=60 * 60 * 24 * 365,
                     httponly=True, samesite="Lax")
    return resp




@app.route("/")
def index():
    if not session.get("user_id"):
        return redirect(url_for("intro_page"))
    html = render_template("index.html", username=session.get("username"))
    tag = '<script src="%s"></script>' % url_for("static", filename="astra_stage27_law.js")
    if "astra_stage27_law.js" not in html:
        html = html.replace("</body>", tag + "</body>", 1) if "</body>" in html else html + tag
    return html

@app.route("/intro")
def intro_page():
    return render_template("intro.html")
@app.route("/login", methods=["GET", "POST"])
def login_page():
    if request.method == "GET":
        return render_template("login.html")
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    if not username or not password:
        return jsonify(success=False, msg="Username and password are required."), 400
    user = find_user(username)
    if not user or not user.check_password(password):
        return jsonify(success=False, msg="Invalid username or password."), 401
    if user.is_banned:
        return jsonify(success=False, msg="This operator account is suspended."), 403
    session["user_id"] = user.id
    session["username"] = user.username
    log_event(f"Operator {user.username} authenticated.")
    resp = jsonify(success=True)
    token = register_device(user)
    return _set_device_cookie(resp, token)


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    if len(username) < 3:
        return jsonify(success=False, msg="Username must be at least 3 characters."), 400
    if len(password) < 6:
        return jsonify(success=False, msg="Password must be at least 6 characters."), 400
    if find_user(username):
        return jsonify(success=False, msg="That username is already taken."), 409
    user = User(username=username)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    log_event(f"New operator registered: {username}")
    return jsonify(success=True)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))




@app.route("/auth/google/login")
def google_login():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return jsonify(success=False, msg="Google linking isn't configured on this server "
                                            "(missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."), 503
    state = secrets.token_urlsafe(24)
    session["google_oauth_state"] = state
    session["google_link_mode"] = "link" if session.get("user_id") else "login"
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": url_for("google_callback", _external=True),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return redirect(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@app.route("/auth/google/callback")
def google_callback():
    if request.args.get("error"):
        return redirect(f"{url_for('login_page')}?google_error={request.args['error']}")

    state = request.args.get("state")
    if not state or state != session.pop("google_oauth_state", None):
        return redirect(f"{url_for('login_page')}?google_error=state_mismatch")

    link_mode = session.pop("google_link_mode", "login")
    code = request.args.get("code")
    if not code:
        return redirect(f"{url_for('login_page')}?google_error=missing_code")

    try:
        token_resp = requests.post(GOOGLE_TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": url_for("google_callback", _external=True),
        }, timeout=8)
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]

        info_resp = requests.get(GOOGLE_USERINFO_URL,
                                  headers={"Authorization": f"Bearer {access_token}"}, timeout=8)
        info_resp.raise_for_status()
        info = info_resp.json()
    except Exception as exc:
        log_event(f"Google OAuth exchange failed: {exc}")
        return redirect(f"{url_for('login_page')}?google_error=exchange_failed")

    google_sub = info.get("sub")
    google_email = info.get("email")
    if not google_sub:
        return redirect(f"{url_for('login_page')}?google_error=no_sub")

    if link_mode == "link":
        user = current_user()
        if not user:
            return redirect(f"{url_for('login_page')}?google_error=not_logged_in")
        clash = User.query.filter_by(google_sub=google_sub).first()
        if clash and clash.id != user.id:
            return redirect(f"{url_for('index')}?google_error=already_linked")
        user.google_sub = google_sub
        user.google_email = google_email
        db.session.commit()
        log_event(f"{user.username} linked a Google account.")
        return redirect(f"{url_for('index')}?google_linked=1")


    user = User.query.filter_by(google_sub=google_sub).first()
    if not user:
        return redirect(f"{url_for('login_page')}?google_error=no_account")
    session["user_id"] = user.id
    session["username"] = user.username
    log_event(f"{user.username} signed in via Google.")
    resp = redirect(url_for("index"))
    token = register_device(user)
    return _set_device_cookie(resp, token)


@app.route("/api/google/unlink", methods=["POST"])
@login_required
def google_unlink():
    user = current_user()
    user.google_sub = None
    user.google_email = None
    db.session.commit()
    log_event(f"{user.username} unlinked their Google account.")
    return jsonify(success=True)




@app.route("/api/status")
@login_required
def api_status():
    with state_lock:
        return jsonify({
            "equity": market_state["portfolio_equity"],
            "opportunities": market_state["opportunities_captured"],
            "running": market_state["running_arbitrage"],
            "spreads": market_state["latest_spreads"],
            "logs": market_state["global_logs"][-15:],
            "feeds": dict(feed_health),
            "ai_live": ai.ai_available(),
            "ai_provider": ai.active_provider(),
        })


@app.route("/api/desktop/state", methods=["GET", "POST"])
@login_required
def api_desktop_state():
    user = current_user()
    state = user.desktop_state()
    if request.method == "GET":
        return jsonify(success=True, state=state)

    raw = request.get_data(cache=True)
    patch = request.get_json(silent=True)
    if len(raw) > 750_000 or not isinstance(patch, dict):
        return jsonify(success=False, msg="Invalid desktop state."), 400
    allowed = {"installed_apps", "recent_apps", "open_apps", "downloads", "notepad", "window_states", "saved_files", "tutorial_seen"}
    if any(key not in allowed for key in patch):
        return jsonify(success=False, msg="Unknown desktop state field."), 400
    for key in ("installed_apps", "recent_apps", "open_apps", "downloads"):
        if key in patch and (not isinstance(patch[key], list) or len(patch[key]) > 100):
            return jsonify(success=False, msg="Invalid desktop state list."), 400
    if "tutorial_seen" in patch and not isinstance(patch["tutorial_seen"], bool):
        return jsonify(success=False, msg="Invalid tutorial flag."), 400
    if "notepad" in patch and (not isinstance(patch["notepad"], str) or len(patch["notepad"]) > 50_000):
        return jsonify(success=False, msg="Invalid notepad contents."), 400
    if "window_states" in patch:
        windows = patch["window_states"]
        if (not isinstance(windows, dict) or len(windows) > 100 or
                any(not isinstance(value, bool) for value in windows.values())):
            return jsonify(success=False, msg="Invalid window state."), 400
    if "saved_files" in patch:
        saved_files = patch["saved_files"]
        if not isinstance(saved_files, list) or len(saved_files) > 100:
            return jsonify(success=False, msg="Invalid saved files."), 400
        total_chars = 0
        seen_paths = set()
        for item in saved_files:
            path = item.get("path") if isinstance(item, dict) else None
            content = item.get("content") if isinstance(item, dict) else None
            parts = path.replace("\\", "/").split("/") if isinstance(path, str) else []
            if (not parts or len(path) > 160 or path.startswith("/") or
                    any(part in ("", ".", "..") for part in parts) or
                    not isinstance(content, str) or len(content) > 50_000 or path in seen_paths):
                return jsonify(success=False, msg="Invalid saved file path or contents."), 400
            seen_paths.add(path)
            total_chars += len(content)
        if total_chars > 500_000:
            return jsonify(success=False, msg="Saved files exceed the account storage limit."), 400

    state.update(patch)
    user.set_desktop_state(state)
    db.session.commit()
    return jsonify(success=True, state=state)


MAX_SAVED_IMAGE_BYTES = 256 * 1024
MAX_SAVED_IMAGES = 50
MAX_SAVED_IMAGE_TOTAL_BYTES = 5 * 1024 * 1024
SAVED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _valid_image_bytes(mime, raw):
    if mime == "image/jpeg":
        return raw.startswith(b"\xff\xd8\xff")
    if mime == "image/png":
        return raw.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/gif":
        return raw.startswith((b"GIF87a", b"GIF89a"))
    if mime == "image/webp":
        return len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    return False


def _owned_image(user_id, image_id):
    if image_id in (None, ""):
        return None
    if isinstance(image_id, bool):
        return None
    try:
        image_id = int(image_id)
    except (TypeError, ValueError):
        return None
    if image_id <= 0:
        return None
    return ImageAsset.query.filter_by(id=image_id, user_id=user_id).first()


def _image_data_url(image):
    if not image:
        return None
    return f"data:{image.mime};base64,{base64.b64encode(image.payload).decode('ascii')}"


def _image_analysis_error():
    return jsonify(
        success=False,
        msg="Pictures are saved, but image analysis needs OPENAI_API_KEY and a vision-capable OPENAI_MODEL.",
    ), 503


@app.route("/api/images", methods=["GET", "POST"])
@login_required
def saved_images():
    user = current_user()
    if request.method == "GET":
        images = ImageAsset.query.filter_by(user_id=user.id).order_by(ImageAsset.created_at.desc()).limit(
            MAX_SAVED_IMAGES
        ).all()
        return jsonify(success=True, images=[image.to_dict() for image in images])

    data = request.get_json(silent=True) or {}
    mime = str(data.get("mime") or "").lower().strip()
    if mime not in SAVED_IMAGE_TYPES:
        return jsonify(success=False, msg="Use a JPEG, PNG, GIF, or WebP image."), 400
    encoded = data.get("data")
    if not isinstance(encoded, str) or len(encoded) > (MAX_SAVED_IMAGE_BYTES * 4 // 3 + 4):
        return jsonify(success=False, msg="Pictures must be 256 KB or smaller."), 413
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return jsonify(success=False, msg="Image data was not valid base64."), 400
    if not raw:
        return jsonify(success=False, msg="The selected picture is empty."), 400
    if len(raw) > MAX_SAVED_IMAGE_BYTES:
        return jsonify(success=False, msg="Pictures must be 256 KB or smaller."), 413
    if not _valid_image_bytes(mime, raw):
        return jsonify(success=False, msg="Image content does not match its file type."), 400

    existing = ImageAsset.query.filter_by(user_id=user.id).all()
    if len(existing) >= MAX_SAVED_IMAGES:
        return jsonify(success=False, msg=f"Picture library is full (maximum {MAX_SAVED_IMAGES})."), 400
    if sum(image.size_bytes for image in existing) + len(raw) > MAX_SAVED_IMAGE_TOTAL_BYTES:
        return jsonify(success=False, msg="Picture library storage limit is 5 MB."), 400

    filename = re.sub(r"[^\w.\- ]", "_", str(data.get("filename") or "picture")[:256])[:128]
    image = ImageAsset(user_id=user.id, filename=filename, mime=mime,
                       size_bytes=len(raw), payload=raw)
    db.session.add(image)
    db.session.commit()
    return jsonify(success=True, image=image.to_dict()), 201


@app.route("/api/images/<int:image_id>", methods=["DELETE"])
@login_required
def saved_image_delete(image_id):
    image = _owned_image(current_user().id, image_id)
    if not image:
        return jsonify(success=False, msg="Picture not found."), 404
    db.session.delete(image)
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/images/<int:image_id>/content")
@login_required
def saved_image_content(image_id):
    image = _owned_image(current_user().id, image_id)
    if not image:
        return jsonify(success=False, msg="Picture not found."), 404
    return Response(image.payload, mimetype=image.mime, headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })


@app.route("/api/game/politics")
@login_required
def politics_status():
    with state_lock:
        log = list(market_state["political_log"][:20])
        tax_rate = market_state.get("tax_rate", TAX_RATE_DEFAULT)
    return jsonify(success=True, tax_rate=tax_rate, tax_rate_min=TAX_RATE_MIN,
                    tax_rate_max=TAX_RATE_MAX, log=log)


@app.route("/api/game/ai_rival")
@login_required
def ai_rival_status():
    with state_lock:
        rival = dict(market_state["ai_rival"])
    rival["name"] = AI_RIVAL["name"]
    rival["title"] = AI_RIVAL["title"]
    rival["bio"] = AI_RIVAL["bio"]
    return jsonify(success=True, rival=rival)


@app.route("/api/settings", methods=["GET", "POST"])
@login_required
def api_settings():
    user = current_user()
    if request.method == "GET":
        return jsonify(success=True, settings=user.settings_dict(), themes=THEMES)

    data = request.get_json(silent=True) or {}
    if "language" in data and data["language"] in ("EN", "ES", "FR", "JA", "DE", "PT"):
        user.language = data["language"]
    if "bot_persona" in data and data["bot_persona"] in PERSONA_TONES:
        user.bot_persona = data["bot_persona"]
    if "risk_threshold" in data:
        user.risk_threshold = max(1, min(100, int(data["risk_threshold"])))
    if "execution_speed" in data and int(data["execution_speed"]) in (1, 2, 5):
        user.execution_speed = int(data["execution_speed"])
    if "encryption_mode" in data and data["encryption_mode"] in ("aes256", "chaCha", "quantum"):
        user.encryption_mode = data["encryption_mode"]
    if "theme" in data and data["theme"] in THEMES:
        user.theme = data["theme"]
    if "sfx_enabled" in data:
        user.sfx_enabled = bool(data["sfx_enabled"])
    if "sfx_volume" in data:
        user.sfx_volume = max(0, min(100, int(data["sfx_volume"])))
    if "reduce_motion" in data:
        user.reduce_motion = bool(data["reduce_motion"])
    db.session.commit()
    log_event(f"{user.username} updated system preferences.")
    return jsonify(success=True, settings=user.settings_dict(), themes=THEMES)


def award_credits(user, rule_key, times=1, commit=True):
    rule = CREDIT_RULES.get(rule_key)
    if not rule or times <= 0:
        return 0
    amount = int(rule["amount"]) * int(times)
    user.credits = (user.credits or 0) + amount
    user.credits_earned_total = (user.credits_earned_total or 0) + amount
    db.session.add(CreditLedger(user_id=user.id, amount=amount, reason=rule["reason"]))
    if commit:
        db.session.commit()
    return amount


def _frame_unlocked(frame, user):
    return not frame.get("cost") or frame["id"] in user.unlocked_frames()


def _avatar_unlocked(preset, save, user=None):
    rule = preset.get("unlock", "always")
    if rule == "always":
        return True
    if rule == "score_2000":
        return bool(save and save.compute_score() >= 2000)
    if rule == "business_owner":
        return bool(save and (save.job_status == "business_owner" or save.business_started_day is not None))
    if rule == "three_tracks":
        return bool(user and MusicTrack.query.filter_by(user_id=user.id).count() >= 3)
    if rule == "credits":
        return bool(user and preset["id"] in user.unlocked_avatars())
    return False


def _operator_title(score):
    if score >= 5000:
        return "Terminal Legend"
    if score >= 2000:
        return "Desk Veteran"
    if score >= 800:
        return "Market Player"
    if score >= 200:
        return "Floor Regular"
    return "Rookie Operator"


@app.route("/api/profile", methods=["GET", "POST"])
@login_required
def api_profile():
    user = current_user()
    save = get_or_create_save(user)

    if request.method == "GET":
        avatars = [dict(a, unlocked=_avatar_unlocked(a, save, user)) for a in AVATAR_PRESETS]
        tracks = MusicTrack.query.filter_by(user_id=user.id).all()
        score = save.compute_score()
        stats = {
            "score": score, "net_worth": save.net_worth(STOCKS), "balance": save.balance,
            "deals_closed": save.deals_closed, "trades_count": save.trades_count,
            "times_fired": save.times_fired, "week": save.week, "boss_mood": save.boss_mood,
            "job_status": save.job_status, "job_title": save.job_title, "company_name": save.company_name,
            "tracks_released": len(tracks),
            "music_earned": round(save.music_earned_total or 0.0, 2),
        }
        frames = [dict(f, unlocked=_frame_unlocked(f, user)) for f in FRAMES]
        return jsonify(success=True, profile=user.profile_dict(), avatars=avatars,
                        frames=frames, stats=stats,
                        title=(user.custom_title or _operator_title(score)),
                        rank=_operator_title(score),
                        credits=user.credits or 0)

    data = request.get_json(silent=True) or {}
    if "avatar_glyph" in data:
        preset = next((a for a in AVATAR_PRESETS if a["id"] == data["avatar_glyph"]), None)
        if not preset:
            return jsonify(success=False, msg="Unknown avatar."), 400
        if not _avatar_unlocked(preset, save, user):
            return jsonify(success=False, msg=f"Locked - {preset.get('unlock_desc', 'not unlocked yet')}."), 403
        user.avatar_glyph = preset["id"]
    if "avatar_frame" in data:
        frame = next((f for f in FRAMES if f["id"] == data["avatar_frame"]), None)
        if not frame:
            return jsonify(success=False, msg="Unknown frame."), 400
        if not _frame_unlocked(frame, user):
            return jsonify(success=False,
                            msg=f"Locked - {frame['name']} costs {frame['cost']} credits."), 403
        user.avatar_frame = frame["id"]
    if "display_name" in data:
        name = (data.get("display_name") or "").strip()[:32]
        user.display_name = name or None
    if "bio" in data:
        user.bio = (data.get("bio") or "").strip()[:160]
    if "sfx_enabled" in data:
        user.sfx_enabled = bool(data["sfx_enabled"])
    db.session.commit()
    return jsonify(success=True, profile=user.profile_dict())


@app.route("/api/wip")
@login_required
def api_wip():
    return jsonify(success=True, features=WIP_FEATURES)


@app.route("/api/game/music/options")
@login_required
def music_options():
    return jsonify(success=True, genres=MUSIC_GENRES, labels=MUSIC_LABELS, keys=MUSIC_KEYS)


@app.route("/api/game/music/tracks")
@login_required
def music_tracks():
    user = current_user()
    tracks = (MusicTrack.query.filter_by(user_id=user.id)
              .order_by(MusicTrack.created_at.desc()).all())
    total_daily = round(sum(t.daily_royalty() for t in tracks), 2)
    total_earned = round(sum(t.total_earned or 0.0 for t in tracks), 2)
    return jsonify(success=True, tracks=[t.to_dict() for t in tracks],
                    total_daily=total_daily, total_earned=total_earned)


@app.route("/api/game/music/release", methods=["POST"])
@login_required
def music_release():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()[:64]
    genre = data.get("genre")
    key = data.get("key")
    label = next((l for l in MUSIC_LABELS if l["id"] == data.get("label")), None)

    if not title:
        return jsonify(success=False, msg="Give the track a title first."), 400
    if genre not in MUSIC_GENRES:
        return jsonify(success=False, msg="Unknown genre."), 400
    if key not in MUSIC_KEYS:
        return jsonify(success=False, msg="Unknown key."), 400
    if not label:
        return jsonify(success=False, msg="Unknown label."), 400

    try:
        bpm = max(40, min(220, int(data.get("bpm") or 120)))
        bars = max(2, min(32, int(data.get("bars") or 8)))
        seed = int(data.get("seed") or 1)
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Bad track parameters."), 400

  
    pattern = data.get("pattern")
    pattern_json = None
    pattern_bonus = 0.0
    if pattern:
        rows = pattern.get("rows") if isinstance(pattern, dict) else None
        if not isinstance(rows, dict) or not rows:
            return jsonify(success=False, msg="That sequencer pattern is unreadable."), 400
        clean_rows, hits, used_rows = {}, 0, 0
        for row_id, cells in list(rows.items())[:8]:
            if not isinstance(cells, list):
                continue
            cells = [1 if c else 0 for c in cells[:32]]
            clean_rows[str(row_id)[:16]] = cells
            row_hits = sum(cells)
            hits += row_hits
            if row_hits:
                used_rows += 1
        if not hits:
            return jsonify(success=False, msg="The grid is empty - place some steps first."), 400
        steps = max(4, min(32, int(pattern.get("steps") or 16)))
        pattern_json = json.dumps({"steps": steps, "rows": clean_rows})

        density = hits / float(steps * max(1, len(clean_rows)))
        pattern_bonus = min(14.0, used_rows * 3.0 + max(0.0, 1 - abs(density - 0.32) * 3) * 6.0)

    user = current_user()
    save = get_or_create_save(user)

    if MusicTrack.query.filter_by(user_id=user.id).count() >= 12:
        return jsonify(success=False, msg="Catalogue's full - pull an old track before releasing another."), 400
    if label["cost"] and save.balance < label["cost"]:
        return jsonify(success=False, msg=f"Not enough cash - {label['name']} wants ${label['cost']:.0f} up front."), 400

    ideal_bpm = MUSIC_GENRES[genre]["bpm"]
    bpm_fit = max(0.0, 1 - abs(bpm - ideal_bpm) / 120)
    length_fit = max(0.0, 1 - abs(bars - 8) / 24)
    variance = random.Random(seed).uniform(-12, 12)
    score = int(round(max(5, min(100, 45 + bpm_fit * 35 + length_fit * 15 + variance + pattern_bonus))))


    base_daily = round((score / 100.0) * 3.2 * label["reach"] * label["cut"], 2)

    if label["cost"]:
        save.balance -= label["cost"]
        save.add_profit(-label["cost"])

    track = MusicTrack(
        user_id=user.id, title=title, genre=genre, label_id=label["id"], key=key,
        bpm=bpm, bars=bars, seed=seed, score=score, base_daily_royalty=base_daily,
        age_days=0, total_earned=0.0, released_day=save.day,
        pattern_json=pattern_json,
    )
    db.session.add(track)
    save.mark_active()
    award_credits(user, "track", commit=False)
    db.session.commit()
    log_event(f"{user.username} released \"{title}\" ({genre}) through {label['name']}.")
    return jsonify(success=True,
                    msg=f"Released. Scored {score}/100, paying roughly ${base_daily:.2f}/day.",
                    track=track.to_dict())


@app.route("/api/game/music/delete", methods=["POST"])
@login_required
def music_delete():
    data = request.get_json(silent=True) or {}
    user = current_user()
    track = MusicTrack.query.filter_by(id=data.get("id"), user_id=user.id).first()
    if not track:
        return jsonify(success=False, msg="Track not found."), 404
    db.session.delete(track)
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/devices")
@login_required
def api_devices():
    user = current_user()
    current_token = request.cookies.get("device_token")
    devices = (LinkedDevice.query.filter_by(user_id=user.id)
               .order_by(LinkedDevice.last_seen.desc()).all())
    return jsonify(success=True, devices=[d.to_dict(current_token) for d in devices])


@app.route("/api/devices/revoke", methods=["POST"])
@login_required
def api_devices_revoke():
    data = request.get_json(silent=True) or {}
    user = current_user()
    device = LinkedDevice.query.filter_by(id=data.get("id"), user_id=user.id).first()
    if not device:
        return jsonify(success=False, msg="Device not found."), 404
    was_current = device.device_token == request.cookies.get("device_token")
    db.session.delete(device)
    db.session.commit()
    log_event(f"{user.username} revoked a linked device{' (this one)' if was_current else ''}.")
    if was_current:
        session.clear()
    return jsonify(success=True, logged_out=was_current)




def _vault_authenticate(user, pin):
    if not user.vault_pin_hash:
        return False, "Vault isn't set up yet."
    if user.vault_locked_until and user.vault_locked_until > datetime.utcnow():
        return False, "Vault temporarily locked from too many failed PIN attempts."
    if not vault.check_pin(pin, user.vault_salt, user.vault_pin_hash):
        user.vault_fail_count = (user.vault_fail_count or 0) + 1
        if user.vault_fail_count >= 5:
            user.vault_locked_until = datetime.utcnow() + timedelta(minutes=10)
            user.vault_fail_count = 0
        db.session.commit()
        return False, "Incorrect PIN."
    user.vault_fail_count = 0
    db.session.commit()
    return True, None


@app.route("/api/vault/status")
@login_required
def vault_status():
    user = current_user()
    entries = (VaultEntry.query.filter_by(user_id=user.id)
               .order_by(VaultEntry.created_at.desc()).all())
    locked = bool(user.vault_locked_until and user.vault_locked_until > datetime.utcnow())
    return jsonify(success=True, is_setup=bool(user.vault_pin_hash), locked=locked,
                    entries=[e.to_dict() for e in entries])


@app.route("/api/vault/setup", methods=["POST"])
@login_required
def vault_setup():
    data = request.get_json(silent=True) or {}
    if not data.get("agree"):
        return jsonify(success=False, msg="You need to accept the Operator Vault Protocol first."), 400
    pin = str(data.get("pin", ""))
    confirm = str(data.get("confirm_pin", ""))
    if not vault.valid_pin_format(pin):
        return jsonify(success=False, msg="PIN must be 4-8 digits."), 400
    if pin != confirm:
        return jsonify(success=False, msg="PINs don't match."), 400

    user = current_user()
    if user.vault_pin_hash:
        return jsonify(success=False, msg="Vault already initialized."), 400
    salt = vault.new_salt()
    user.vault_salt = salt
    user.vault_pin_hash = vault.pin_verification_hash(pin, salt)
    user.vault_tos_accepted_at = datetime.utcnow()
    user.vault_fail_count = 0
    db.session.commit()
    log_event(f"{user.username} initialized their credential vault.")
    return jsonify(success=True)


@app.route("/api/vault/store", methods=["POST"])
@login_required
def vault_store():
    data = request.get_json(silent=True) or {}
    pin = str(data.get("pin", ""))
    label = (data.get("label") or "").strip()[:64]
    secret = data.get("secret") or ""
    if not label or not secret:
        return jsonify(success=False, msg="Label and secret are both required."), 400

    user = current_user()
    ok, err = _vault_authenticate(user, pin)
    if not ok:
        return jsonify(success=False, msg=err), 403

    ciphertext = vault.encrypt(pin, user.vault_salt, secret)
    entry = VaultEntry(user_id=user.id, label=label, ciphertext=ciphertext)
    db.session.add(entry)
    db.session.commit()
    log_event(f"{user.username} saved a new vault entry ({label}).")
    return jsonify(success=True, entry=entry.to_dict())


@app.route("/api/vault/reveal", methods=["POST"])
@login_required
def vault_reveal():
    data = request.get_json(silent=True) or {}
    pin = str(data.get("pin", ""))
    user = current_user()
    ok, err = _vault_authenticate(user, pin)
    if not ok:
        return jsonify(success=False, msg=err), 403

    entry = VaultEntry.query.filter_by(id=data.get("id"), user_id=user.id).first()
    if not entry:
        return jsonify(success=False, msg="Entry not found."), 404
    plaintext = vault.decrypt(pin, user.vault_salt, entry.ciphertext)
    if plaintext is None:
        return jsonify(success=False, msg="Could not decrypt - wrong PIN or corrupted entry."), 400
    return jsonify(success=True, secret=plaintext)


@app.route("/api/vault/delete", methods=["POST"])
@login_required
def vault_delete():
    data = request.get_json(silent=True) or {}
    pin = str(data.get("pin", ""))
    user = current_user()
    ok, err = _vault_authenticate(user, pin)
    if not ok:
        return jsonify(success=False, msg=err), 403
    entry = VaultEntry.query.filter_by(id=data.get("id"), user_id=user.id).first()
    if not entry:
        return jsonify(success=False, msg="Entry not found."), 404
    db.session.delete(entry)
    db.session.commit()
    return jsonify(success=True)




def _friendship_between(a_id, b_id):
    return Friendship.query.filter(
        db.or_(
            db.and_(Friendship.requester_id == a_id, Friendship.addressee_id == b_id),
            db.and_(Friendship.requester_id == b_id, Friendship.addressee_id == a_id),
        )
    ).first()


def _are_friends(a_id, b_id):
    fr = _friendship_between(a_id, b_id)
    return bool(fr and fr.status == "accepted")


@app.route("/api/friends")
@login_required
def friends_list():
    user = current_user()
    rows = Friendship.query.filter(
        db.or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id)
    ).all()

    friends, incoming, outgoing = [], [], []
    for f in rows:
        other_id = f.addressee_id if f.requester_id == user.id else f.requester_id
        other = db.session.get(User, other_id)
        other_name = other.username if other else "unknown"
        if f.status == "accepted":
            unread = DirectMessage.query.filter_by(
                sender_id=other_id, recipient_id=user.id, read_at=None
            ).count()
            friends.append({"username": other_name, "unread": unread})
        elif f.requester_id == user.id:
            outgoing.append({"id": f.id, "username": other_name})
        else:
            incoming.append({"id": f.id, "username": other_name})

    return jsonify(success=True, friends=friends, incoming=incoming, outgoing=outgoing)


@app.route("/api/friends/request", methods=["POST"])
@login_required
def friend_request():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    user = current_user()
    if not username:
        return jsonify(success=False, msg="Enter a username.")
    if username.lower() == user.username.lower():
        return jsonify(success=False, msg="You can't add yourself.")
    target = find_user(username)
    if not target:
        return jsonify(success=False, msg="No operator with that username.")
    existing = _friendship_between(user.id, target.id)
    if existing:
        if existing.status == "accepted":
            return jsonify(success=False, msg="You are already friends.")
        if existing.requester_id == target.id and existing.addressee_id == user.id:
            existing.status = "accepted"
            existing.responded_at = datetime.utcnow()
            db.session.commit()
            return jsonify(success=True, msg=f"Friend request from {target.username} accepted.")
        return jsonify(success=False, msg="Your friend request is already pending.")
    db.session.add(Friendship(requester_id=user.id, addressee_id=target.id, status="pending"))
    db.session.commit()
    return jsonify(success=True, msg=f"Friend request sent to {target.username}.")


@app.route("/api/friends/respond", methods=["POST"])
@login_required
def friend_respond():
    data = request.get_json(silent=True) or {}
    user = current_user()
    fr = db.session.get(Friendship, data.get("id"))
    if not fr or fr.addressee_id != user.id or fr.status != "pending":
        return jsonify(success=False, msg="Request not found."), 404
    if data.get("action") == "accept":
        fr.status = "accepted"
        fr.responded_at = datetime.utcnow()
        db.session.commit()
        return jsonify(success=True, msg="Friend added.")
    db.session.delete(fr)
    db.session.commit()
    return jsonify(success=True, msg="Request declined.")


@app.route("/api/friends/remove", methods=["POST"])
@login_required
def friend_remove():
    data = request.get_json(silent=True) or {}
    user = current_user()
    target = find_user((data.get("username") or "").strip())
    if not target:
        return jsonify(success=False, msg="Unknown operator.")
    fr = _friendship_between(user.id, target.id)
    if not fr or fr.status != "accepted":
        return jsonify(success=False, msg="Not friends.")
    db.session.delete(fr)
    db.session.commit()
    return jsonify(success=True, msg=f"Removed {target.username}.")


@app.route("/api/hire/offer", methods=["POST"])
@login_required
def hire_offer():
    user = current_user()
    data = request.get_json(silent=True) or {}
    target_name = (data.get("username") or "").strip()
    role = (data.get("role") or "Contract Operator").strip()[:64] or "Contract Operator"
    try:
        salary = round(float(data.get("salary", 0)), 2)
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid salary."), 400
    if salary <= 0 or salary > 5000:
        return jsonify(success=False, msg="Salary must be between $0 and $5000/day.")
    target = find_user(target_name)
    if not target or target.id == user.id:
        return jsonify(success=False, msg="No such operator.")
    fr = _friendship_between(user.id, target.id)
    if not fr or fr.status != "accepted":
        return jsonify(success=False, msg="You can only hire friends. Send a friend request first.")
    existing = PlayerHire.query.filter_by(employer_id=user.id, employee_id=target.id, status="pending").first()
    if existing:
        return jsonify(success=False, msg="You already have a pending offer to that operator.")
    hire = PlayerHire(employer_id=user.id, employee_id=target.id, role=role, salary=salary, status="pending")
    db.session.add(hire)
    db.session.commit()
    log_event(f"{user.username} sent a hire offer to {target.username} ({role}, ${salary:.2f}/day).")
    return jsonify(success=True, hire_id=hire.id)


@app.route("/api/hire/respond", methods=["POST"])
@login_required
def hire_respond():
    user = current_user()
    data = request.get_json(silent=True) or {}
    hire = db.session.get(PlayerHire, data.get("hire_id"))
    if not hire or hire.employee_id != user.id or hire.status != "pending":
        return jsonify(success=False, msg="No such pending offer."), 404
    hire.status = "active" if data.get("accept") else "declined"
    hire.responded_at = datetime.utcnow()
    db.session.commit()
    employer = db.session.get(User, hire.employer_id)
    if employer:
        log_event(f"{user.username} {'accepted' if hire.status == 'active' else 'declined'} "
                  f"a hire offer from {employer.username}.")
    return jsonify(success=True, status=hire.status)


@app.route("/api/hire/end", methods=["POST"])
@login_required
def hire_end():
    user = current_user()
    data = request.get_json(silent=True) or {}
    hire = db.session.get(PlayerHire, data.get("hire_id"))
    if not hire or hire.status != "active" or user.id not in (hire.employer_id, hire.employee_id):
        return jsonify(success=False, msg="No such active hire."), 404
    hire.status = "ended"
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/hire/list")
@login_required
def hire_list():
    user = current_user()
    rows = PlayerHire.query.filter(
        db.or_(PlayerHire.employer_id == user.id, PlayerHire.employee_id == user.id)
    ).order_by(PlayerHire.id.desc()).limit(50).all()
    out = []
    for h in rows:
        employer = db.session.get(User, h.employer_id)
        employee = db.session.get(User, h.employee_id)
        d = h.to_dict(employer_name=employer.username if employer else "?",
                       employee_name=employee.username if employee else "?")
        d["as"] = "employer" if h.employer_id == user.id else "employee"
        out.append(d)
    return jsonify(success=True, hires=out)


@app.route("/api/messages/<username>")
@login_required
def messages_thread(username):
    user = current_user()
    target = find_user(username)
    if not target:
        return jsonify(success=False, msg="No operator with that username."), 404
    if target.id == user.id:
        return jsonify(success=False, msg="You can't message yourself."), 400

    rows = (
        DirectMessage.query.filter(
            db.or_(
                db.and_(DirectMessage.sender_id == user.id, DirectMessage.recipient_id == target.id),
                db.and_(DirectMessage.sender_id == target.id, DirectMessage.recipient_id == user.id),
            )
        )
        .order_by(DirectMessage.created_at.asc())
        .all()
    )

    unread = [m for m in rows if m.recipient_id == user.id and not m.read_at]
    if unread:
        for m in unread:
            m.read_at = datetime.utcnow()
        db.session.commit()

    return jsonify(success=True, messages=[m.to_dict(user.id) for m in rows])


@app.route("/api/messages/inbox_summary")
@login_required
def messages_inbox_summary():
    user = current_user()
    unread_rows = (
        DirectMessage.query.filter_by(recipient_id=user.id, read_at=None)
        .order_by(DirectMessage.created_at.asc())
        .all()
    )
    by_sender = {}
    for m in unread_rows:
        by_sender.setdefault(m.sender_id, []).append(m)

    senders = []
    for sender_id, msgs in by_sender.items():
        sender = db.session.get(User, sender_id)
        if not sender:
            continue
        last = msgs[-1]
        senders.append({
            "username": sender.username,
            "count": len(msgs),
            "preview": "[ENCRYPTED MESSAGE]" if last.encrypted else (last.body[:80] if last.body else ""),
            "last_at": last.created_at.strftime("%Y-%m-%d %H:%M") if last.created_at else None,
        })
    senders.sort(key=lambda s: s["last_at"] or "", reverse=True)
    return jsonify(success=True, total_unread=len(unread_rows), senders=senders)


@app.route("/api/messages/send", methods=["POST"])
@login_required
def messages_send():
    data = request.get_json(silent=True) or {}
    body = (data.get("body") or "").strip()
    encrypt = bool(data.get("encrypt"))
    pin = str(data.get("pin", ""))
    user = current_user()

    if not body:
        return jsonify(success=False, msg="Message is empty.")
    if len(body) > 2000:
        return jsonify(success=False, msg="Message is too long (2,000 char limit).")

    target = find_user((data.get("to") or "").strip())
    if not target:
        return jsonify(success=False, msg="No operator with that username."), 404
    if target.id == user.id:
        return jsonify(success=False, msg="You can't message yourself."), 400

    if encrypt:
        if not vault.valid_pin_format(pin):
            return jsonify(success=False, msg="Encrypted messages need a 4-8 digit PIN - pick one and share it with them however you trust.")
        salt = vault.new_salt()
        msg = DirectMessage(
            sender_id=user.id, recipient_id=target.id,
            body=vault.encrypt(pin, salt, body), encrypted=True, salt=salt,
        )
    else:
        msg = DirectMessage(sender_id=user.id, recipient_id=target.id, body=body, encrypted=False)

    db.session.add(msg)
    db.session.commit()
    return jsonify(success=True, message=msg.to_dict(user.id))


@app.route("/api/messages/decrypt", methods=["POST"])
@login_required
def messages_decrypt():
    data = request.get_json(silent=True) or {}
    user = current_user()
    msg = db.session.get(DirectMessage, data.get("id"))
    if not msg or user.id not in (msg.sender_id, msg.recipient_id):
        return jsonify(success=False, msg="Message not found."), 404
    if not msg.encrypted:
        return jsonify(success=True, body=msg.body)
    plaintext = vault.decrypt(str(data.get("pin", "")), msg.salt, msg.body)
    if plaintext is None:
        return jsonify(success=False, msg="Wrong PIN, or the message is corrupted.")
    return jsonify(success=True, body=plaintext)


@app.route("/api/toggle_arbitrage", methods=["POST"])
@login_required
def toggle_arbitrage():
    with state_lock:
        market_state["running_arbitrage"] = not market_state["running_arbitrage"]
        running = market_state["running_arbitrage"]
    log_event(f"Cross-exchange arbitrage engine {'ACTIVATED' if running else 'PAUSED'} by operator.")
    return jsonify(running=running)


@app.route("/api/search_crypto", methods=["POST"])
@login_required
def search_crypto():
    data = request.get_json(silent=True) or {}
    query = data.get("query", "").upper().strip()
    coin_id = COIN_IDS.get(query)

    if coin_id:
        try:
            resp = requests.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": coin_id, "vs_currencies": "usd", "include_market_cap": "true",
                        "include_24hr_vol": "true", "include_24hr_change": "true"},
                timeout=4,
            )
            row = resp.json()[coin_id]
            change = row.get("usd_24h_change", 0)
            sentiment = "Bullish" if change > 1 else "Bearish" if change < -1 else "Neutral"
            log_event(f"Crypto Search Engine queried live asset: {query}")
            return jsonify({
                "name": query, "price": f"${row['usd']:,.2f}",
                "cap": f"${row.get('usd_market_cap', 0):,.0f}",
                "vol": f"${row.get('usd_24h_vol', 0):,.0f}",
                "sentiment": f"{sentiment} ({change:+.2f}% 24h)",
            })
        except Exception as exc:
            log_event(f"Live price lookup failed for {query}, using offline data: {exc}")

    fallback = {
        "BTC": {"name": "Bitcoin", "price": "$93,842.10", "cap": "$1.85T", "sentiment": "Bullish", "vol": "$32.4B"},
        "ETH": {"name": "Ethereum", "price": "$3,450.80", "cap": "$415.2B", "sentiment": "Accumulation", "vol": "$14.1B"},
    }
    result = fallback.get(query, {"name": f"Asset [{query}]", "price": f"${random.uniform(1, 500):.2f}",
                                   "cap": "N/A", "sentiment": "Volatile / Speculative", "vol": "$12M"})
    log_event(f"Crypto Search Engine queried asset: {query} (offline data)")
    return jsonify(result)




@app.route("/api/omni_bots")
@login_required
def api_omni_bots():
    with state_lock:
        return jsonify({
            "bots": OMNI_BOTS,
            "logs": market_state["bot_logs"],
            "ai_live": ai.ai_available(),
            "model": ai.MODEL_FAST,
        })


@app.route("/api/bots/dial", methods=["POST"])
@login_required
def dial_bot():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()
    query = (data.get("query") or "").strip()
    bot = next((b for b in OMNI_BOTS if b["code"] == code or b["id"] == code.lower()), None)
    if not bot:
        return jsonify(success=False, msg="Unknown bot code."), 404

    user = current_user()
    image = _owned_image(user.id, data.get("image_id"))
    if data.get("image_id") not in (None, "") and not image:
        return jsonify(success=False, msg="Picture not found in your library."), 404
    if image and not ai.ai_available():
        return _image_analysis_error()
    tone = PERSONA_TONES.get(user.bot_persona, PERSONA_TONES["ruthless"])
    trust_map = session.get("bot_trust") or {}
    trust = trust_map.get(bot["id"], 100)
    if not query and image:
        from game_data import BOT_REQUIREMENTS
        keywords = BOT_REQUIREMENTS.get(bot["id"], {}).get("keywords", ["picture"])
        query = f"Review the attached picture for a concrete {keywords[0]} observation."
    result = ai.dial_bot_reply(bot, tone, query or "Status report.", user.language,
                               trust=trust, image_data_url=_image_data_url(image))
    trust_map[bot["id"]] = max(0, min(100, trust + result["trust_delta"]))
    session["bot_trust"] = trust_map
    output = result["reply"]
    with state_lock:
        market_state["bot_logs"][bot["id"]].insert(0, output)
        del market_state["bot_logs"][bot["id"]][10:]
    return jsonify(success=True, bot=bot["name"], role=bot["role"], output=output,
                    accepted=result["accepted"], trust=trust_map[bot["id"]],
                    image=image.to_dict() if image else None)


@app.route("/api/bot_broadcast")
@login_required
def bot_broadcast():
    if bot_broadcast_queue:
        return jsonify(success=True, broadcast=bot_broadcast_queue.popleft())
    return jsonify(success=False)


@app.route("/api/explain")
@login_required
def api_explain():
    key = request.args.get("key", "")
    entry = METRIC_REGISTRY.get(key)
    if not entry:
        return jsonify(success=False), 404
    persona_id, description = entry
    bot = next(b for b in OMNI_BOTS if b["id"] == persona_id)
    user = current_user()
    text = ai.explain_metric(bot, description, user.language)
    return jsonify(success=True, bot=bot["name"], text=text)


_REMEMBER_PATTERN = re.compile(r"^\s*remember\s+(?:my\s+)?(.+?)\s*[:\-]\s*(.+)$", re.IGNORECASE)


@app.route("/api/ai/command", methods=["POST"])
@login_required
def ai_command():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "assistant")
    prompt = (data.get("prompt") or "").strip()
    user = current_user()
    image = _owned_image(user.id, data.get("image_id"))
    if data.get("image_id") not in (None, "") and not image:
        return jsonify(success=False, msg="Picture not found in your library."), 404
    if image and not ai.ai_available():
        return _image_analysis_error()
    if not prompt and not image:
        return jsonify(response="Enter a directive first.")
    if not prompt:
        prompt = "Describe this picture."

    if mode == "assistant" and _REMEMBER_PATTERN.match(prompt):

        label = _REMEMBER_PATTERN.match(prompt).group(1).strip()[:64]
        return jsonify(response=(
            f"OMNI-CORE does not accept raw credentials over an open channel - relaying "
            f"'{label}' to the model provider in plain text isn't something this terminal "
            f"will do. Open SETTINGS -> CREDENTIAL VAULT, unlock it with your PIN, and save "
            f"'{label}' there directly. Everything in the vault is encrypted under your PIN "
            f"before it ever touches the database, and never leaves this server."
        ))

    if mode == "market_scan":
        bot = random.choice(OMNI_BOTS)
        tone = PERSONA_TONES.get(user.bot_persona, PERSONA_TONES["ruthless"])
        if image and prompt == "Describe this picture.":
            from game_data import BOT_REQUIREMENTS
            keywords = BOT_REQUIREMENTS.get(bot["id"], {}).get("keywords", ["picture"])
            prompt = f"Review the attached picture for a concrete {keywords[0]} observation."
        text = ai.dial_bot_reply(bot, tone, prompt, user.language,
                                 image_data_url=_image_data_url(image))
        return jsonify(response=f"[{bot['name']}] {text}", image=image.to_dict() if image else None)


    lowered = prompt.strip().lower()
    if lowered == "/trace":
        return jsonify(response=_TRACE_WARNING)
    if lowered == "/trace confirm":
        return jsonify(response=_run_trace())
    if lowered.startswith("/alert ") and not lowered.startswith("/alerts"):
        return jsonify(response=_create_alert_from_command(user, prompt.strip()[len("/alert "):]))

    text = ai.console_reply(prompt, user.language, state=_omni_state_snapshot(user),
                            image_data_url=_image_data_url(image))
    return jsonify(response=text, image=image.to_dict() if image else None)


_TRACE_WARNING = (
    "TRACE reveals what THIS SERVER can see about the connection you're using "
    "right now: your public IP address, an approximate IP-based location "
    "(city-level at best, and often wrong), and your browser/OS string. "
    "Nothing about any other operator, ever - this terminal has no way to "
    "trace anyone but you, by design.\n\n"
    "Type /trace confirm to actually reveal it."
)


def _run_trace():
    ip = (request.headers.get("X-Forwarded-For", "") or request.remote_addr or "unknown")
    ip = ip.split(",")[0].strip()
    ua = request.headers.get("User-Agent", "unknown")
    lines = [f"IP: {ip}", f"User-Agent: {ua}"]

    is_private = ip in ("unknown", "127.0.0.1", "::1") or ip.startswith(("192.168.", "10.", "172."))
    if is_private:
        lines.append("Geolocation: not meaningful for a local/private address - "
                      "this only gets interesting on a real deployment.")
    else:
        try:

            resp = requests.get(f"http://ip-api.com/json/{ip}", timeout=3)
            geo = resp.json()
            if geo.get("status") == "success":
                lines.append(
                    f"Approximate location: {geo.get('city', '—')}, {geo.get('regionName', '—')}, "
                    f"{geo.get('country', '—')} (via {geo.get('isp', 'unknown ISP')})"
                )
            else:
                lines.append("Geolocation: lookup failed.")
        except Exception:
            lines.append("Geolocation: lookup unavailable right now.")

    lines.append("\nThat's everything this server can see from the request itself - "
                 "nothing more precise than IP geolocation is possible without location "
                 "permissions this app never asks for.")
    return "\n".join(lines)


def _create_alert_from_command(user, arg):
    bits = arg.split()
    if len(bits) != 3:
        return "Usage: /alert TICKER above|below PRICE (e.g. /alert TECH above 200)"
    symbol, direction, price_raw = bits[0].upper(), bits[1].lower(), bits[2]
    if symbol not in STOCKS:
        return f"Unknown ticker '{symbol}'."
    if direction not in ("above", "below"):
        return "Direction must be 'above' or 'below'."
    try:
        threshold = float(price_raw)
    except ValueError:
        return f"'{price_raw}' isn't a price."
    alert = PriceAlert(user_id=user.id, symbol=symbol, direction=direction, threshold=threshold)
    db.session.add(alert)
    db.session.commit()
    return f"Alert set: {symbol} {direction} ${threshold:,.2f}. Check /alerts any time."


def _compute_positions(save, stocks):
    empty = {"positions": [], "totals": {}, "risk": {}}
    if not save:
        return empty

    shares = save.shares()
    basis = save.cost_basis()
    rows = []
    total_value = 0.0

    for symbol, qty in shares.items():
        if not qty:
            continue
        stock = stocks.get(symbol)
        if not stock:
            continue
        price = stock["price"]
        entry = basis.get(symbol, {})
        tracked_qty = entry.get("qty", 0)
        has_basis = tracked_qty > 0
        avg_cost = entry.get("avg_cost", 0.0) if has_basis else None
        value = round(price * qty, 2)
        cost = round(avg_cost * qty, 2) if has_basis else None
        unrealized = round(value - cost, 2) if has_basis else None
        unrealized_pct = round((unrealized / cost) * 100, 2) if has_basis and cost else None
        rows.append({
            "symbol": symbol, "name": stock["name"], "qty": qty, "price": price,
            "avg_cost": avg_cost, "value": value, "cost_basis": cost,
            "unrealized_pnl": unrealized, "unrealized_pnl_pct": unrealized_pct,
            "has_basis": has_basis,
        })
        total_value += value

    cash = save.balance or 0.0
    net_worth = round(cash + total_value, 2)


    weights = []
    if net_worth > 0:
        if cash:
            weights.append(cash / net_worth)
        weights.extend(r["value"] / net_worth for r in rows)
    hhi = int(round(sum(w * w for w in weights) * 10000, 0)) if weights else 0
    risk_label = "Diversified" if hhi < 1500 else "Moderate concentration" if hhi < 2500 else "Concentrated"
    top = max(rows, key=lambda r: r["value"], default=None)
    top_pct = round((top["value"] / net_worth) * 100, 1) if top and net_worth else 0.0

    totals = {
        "cash": round(cash, 2), "positions_value": round(total_value, 2), "net_worth": net_worth,
        "unrealized_pnl": round(sum(r["unrealized_pnl"] for r in rows if r["has_basis"]), 2),
        "realized_pnl_total": round(save.realized_pnl_total or 0.0, 2),
    }
    risk = {
        "hhi": hhi, "label": risk_label,
        "cash_pct": round((cash / net_worth) * 100, 1) if net_worth else 0.0,
        "top_holding": top["symbol"] if top else None, "top_holding_pct": top_pct,
        "position_count": len(rows),
    }
    return {"positions": rows, "totals": totals, "risk": risk}


def _omni_state_snapshot(user):
    save = GameSave.query.filter_by(user_id=user.id).first()
    tracks = MusicTrack.query.filter_by(user_id=user.id).all()
    pos_data = _compute_positions(save if save and save.active else None, STOCKS)
    alerts = (PriceAlert.query.filter_by(user_id=user.id)
              .order_by(PriceAlert.created_at.desc()).limit(10).all())
    return {
        "save": save.to_dict() if save and save.active else {},
        "stocks": STOCKS,
        "jobs": JOB_LISTINGS,
        "bots": OMNI_BOTS,
        "tracks": [t.to_dict() for t in tracks],
        "positions": pos_data["positions"],
        "totals": pos_data["totals"],
        "risk": pos_data["risk"],
        "alerts": [a.to_dict() for a in alerts],
        "mining": {
            "btc_price": market_state.get("btc_price"),
            "btc_difficulty": market_state.get("btc_difficulty"),
            "btc_difficulty_live": feed_health.get("difficulty", False),
        },
        "user": user,
    }




@app.route("/api/game/start", methods=["POST"])
@login_required
def game_start():
    data = request.get_json(silent=True) or {}
    user = current_user()
    save = get_or_create_save(user)
    save.name = (data.get("name") or user.username)[:64]
    save.health = int(data.get("health", 80))
    save.hunger = 100
    save.city_state_json = "{}"
    save.difficulty = data.get("difficulty", "Normal")
    save.active = True
    save.age = 20
    save.world_tick = _target_day_number()
    save.balance = 2000.0
    save.salary = 0.0
    save.job_title = "Unemployed"
    save.spouse = None
    save.company_name = None
    save.day = save.week = save.month = 1
    save.weekly_target = 0.0
    save.weekly_bills = 450.0
    save.weekly_commission = 0.0
    save.set_shares({})
    save.set_employees([])
    save.job_status = "unemployed"
    save.employer_user_id = None
    save.applied_firm = None
    save.interview_turns = 0
    save.interview_transcript = ""
    save.job_start_day = 1
    save.hiring_open = False
    save.hiring_role = None
    save.hiring_salary = 0.0
    save.hiring_target = 0.0
    save.business_started_day = None
    save.business_capital = 0.0
    save.boss_mood = 100
    save.last_active_day = 1
    save.daily_profit = 0.0
    save.set_profit_log([])
    save.deals_closed = 0
    save.trades_count = 0
    save.times_fired = 0
    db.session.commit()
    log_event(f"Brokerage career started for {save.name} (age 20, {save.difficulty}).")
    return jsonify(success=True)


@app.route("/api/game/state")
@login_required
def game_state():
    user = current_user()
    save = get_or_create_save(user)
    payload = save.to_dict()
    payload["stocks"] = STOCKS
    payload["clients"] = CLIENT_BOTS
    payload["day_tick_seconds"] = DAY_TICK_SECONDS
    payload["next_tick_in"] = round(_seconds_to_next_tick(), 1)
    return jsonify(payload)


@app.route("/api/game/bank/status")
@login_required
def game_bank_status():
    user = current_user()
    save = get_or_create_save(user)
    tiers = []
    for t in BANK_TIERS:
        entry = dict(t)
        entry["locked"] = (save.credit_score or 0) < t["min_score"]
        tiers.append(entry)
    return jsonify(success=True, credit_score=save.credit_score, tiers=tiers, loans=save.loans())


@app.route("/api/game/bank/loan", methods=["POST"])
@login_required
def game_bank_loan():
    data = request.get_json(silent=True) or {}
    lender_id = data.get("lender_id")
    try:
        amount = round(float(data.get("amount", 0)), 2)
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid amount."), 400

    tier = next((t for t in BANK_TIERS if t["id"] == lender_id), None)
    if not tier:
        return jsonify(success=False, msg="Unknown lender."), 404

    user = current_user()
    save = get_or_create_save(user)
    if not save.active:
        return jsonify(success=False, msg="No active career.")
    if (save.credit_score or 0) < tier["min_score"]:
        return jsonify(success=False,
                        msg=f"{tier['name']} won't lend to a {save.credit_score} score. "
                            f"They want {tier['min_score']}+.")
    if amount <= 0 or amount > tier["max_principal"]:
        return jsonify(success=False, msg=f"{tier['name']} will only issue up to ${tier['max_principal']:.2f}.")

    loans = save.loans()
    active_count = sum(1 for l in loans if l.get("status") == "active")
    if active_count >= 3:
        return jsonify(success=False, msg="You already have 3 active loans - pay one down before taking another.")

    loan = {
        "id": secrets.token_hex(4),
        "lender_id": tier["id"],
        "lender": tier["name"],
        "principal": amount,
        "balance": amount,
        "apr": tier["apr"],
        "taken_day": save.day,
        "last_payment_day": save.day,
        "missed_payments": 0,
        "status": "active",
    }
    loans.append(loan)
    save.set_loans(loans)
    save.balance += amount
    db.session.commit()
    log_event(f"{user.username} took a ${amount:.2f} loan from {tier['name']}.")
    return jsonify(success=True, loan=loan, balance=save.balance)


@app.route("/api/game/bank/repay", methods=["POST"])
@login_required
def game_bank_repay():
    data = request.get_json(silent=True) or {}
    loan_id = data.get("loan_id")
    try:
        amount = round(float(data.get("amount", 0)), 2)
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid amount."), 400

    user = current_user()
    save = get_or_create_save(user)
    loans = save.loans()
    loan = next((l for l in loans if l.get("id") == loan_id and l.get("status") == "active"), None)
    if not loan:
        return jsonify(success=False, msg="No active loan with that id."), 404
    if amount <= 0:
        return jsonify(success=False, msg="Enter a positive amount.")
    if amount > save.balance:
        return jsonify(success=False, msg="Insufficient funds.")

    pay = min(amount, loan["balance"])
    loan["balance"] = round(loan["balance"] - pay, 2)
    loan["last_payment_day"] = save.day
    save.balance -= pay

    paid_off = loan["balance"] <= 0.01
    if paid_off:
        loan["balance"] = 0.0
        loan["status"] = "paid"
        save.credit_score = min(850, (save.credit_score or 650) + 15)

    save.set_loans(loans)
    db.session.commit()
    log_event(f"{user.username} paid ${pay:.2f} toward a {loan['lender']} loan.")
    return jsonify(success=True, loan=loan, balance=save.balance, credit_score=save.credit_score,
                    paid_off=paid_off)


def _maybe_random_event(save, events):
    chance = RANDOM_EVENT_DAILY_CHANCE
    if save.ai_buff_active("random_event_shield"):
        chance *= 0.5
    if random.random() >= chance:
        return
    pool = RANDOM_EVENTS
    weights = [e["weight"] for e in pool]
    ev = random.choices(pool, weights=weights, k=1)[0]

    if ev["effect"] == "cash_pct":
        amt = round(min(max((save.balance or 0) * ev["pct"], ev["min"]), ev["max"]), 2)
        amt = min(amt, max(0, save.balance))
        save.balance -= amt
        events.append(ev["text"].format(amt=f"${amt:.2f}"))
    elif ev["effect"] == "cash_flat_if_staff":
        if not save.employees():
            return
        amt = round(random.uniform(ev["min"], ev["max"]), 2)
        amt = min(amt, max(0, save.balance))
        save.balance -= amt
        events.append(ev["text"].format(amt=f"${amt:.2f}"))
    elif ev["effect"] == "cash_gain":
        amt = round(random.uniform(ev["min"], ev["max"]), 2)
        save.balance += amt
        save.add_profit(amt)
        events.append(ev["text"].format(amt=f"${amt:.2f}"))
    elif ev["effect"] == "boss_mood":
        if save.job_status != "employed":
            return
        save.boss_mood = min(100, (save.boss_mood or 0) + ev["amount"])
        events.append(ev["text"])
    log_event(f"{save.name} random event: {ev['id']}.")


def _process_player_hires(user, save, events):
    hires = PlayerHire.query.filter_by(employer_id=user.id, status="active").all()
    if not hires:
        return
    for hire in hires:
        if save.balance < hire.salary:
            events.append(f"Missed payroll for your {hire.role} (insufficient funds).")
            continue
        emp_save = GameSave.query.filter_by(user_id=hire.employee_id).first()
        if not emp_save:
            continue
        save.balance -= hire.salary
        emp_save.balance += hire.salary
        hire.total_paid = round((hire.total_paid or 0) + hire.salary, 2)
        hire.last_paid_day = save.day
        events.append(f"Paid ${hire.salary:.2f} to your {hire.role}.")


def _process_player_company_payroll(user, save, events):
    if save.job_status != "business_owner":
        return
    staff = GameSave.query.filter_by(employer_user_id=user.id, job_status="employed_player").all()
    for emp_save in staff:
        pay = round((emp_save.salary or 0) / 7, 2)
        if pay <= 0:
            continue
        if save.balance < pay:
            events.append(f"Missed payroll for {emp_save.name or 'an employee'} at {save.company_name} (insufficient funds).")
            continue
        save.balance -= pay
        emp_save.balance += pay
        emp_save.add_profit(pay)


def _process_player_company_bonus(save, events):
    if save.job_status != "employed_player" or not save.employer_user_id:
        return
    bonus = round(max(0.0, (save.weekly_commission or 0.0) - (save.weekly_target or 0.0)), 2)
    if bonus <= 0:
        return
    employer = GameSave.query.filter_by(user_id=save.employer_user_id).first()
    if not employer or employer.job_status != "business_owner":
        return
    if employer.balance < bonus:
        events.append(f"Your employer could not fund the ${bonus:.2f} above-target bonus.")
        return
    employer.balance -= bonus
    employer.add_profit(-bonus)
    save.balance += bonus
    save.add_profit(bonus)
    events.append(f"Above-target bonus paid: +${bonus:.2f}.")


def _maybe_sick_day(save, events):
    if save.last_sick_day == save.day:
        return
    stress = 100 - (save.health or 80)
    if stress < BURNOUT_RULES["sick_day_stress_threshold"]:
        return
    if random.random() >= BURNOUT_RULES["sick_day_chance"]:
        return
    save.last_sick_day = save.day
    save.health = min(100, (save.health or 80) + BURNOUT_RULES["sick_day_health_recovery"])
    save.last_active_day = save.day
    events.append("Burnout catches up with you - you're forced to take a sick day. "
                   "(Health recovered, but no hustle today.)")
    log_event(f"{save.name} forced sick day (burnout).")


def _run_day_tick(user, save, events):
    benefits = _apply_employee_benefits(save)

    _maybe_random_event(save, events)
    _maybe_sick_day(save, events)
    _process_player_hires(user, save, events)
    _process_player_company_payroll(user, save, events)

    acted_today = save.last_active_day == save.day
    if save.job_status in ("employed", "employed_player", "business_owner"):
        if acted_today:
            save.boss_mood = min(100, (save.boss_mood or 100) + 5 + benefits["boss_mood_shield"])
        else:
            save.boss_mood = max(0, (save.boss_mood or 100) - 15)
            label = "boss" if save.job_status in ("employed", "employed_player") else "investors"
            events.append(f"No trades or client calls today - your {label} noticed the inactivity.")
        if save.boss_mood <= 0 and save.job_status in ("employed", "employed_player"):
            events.append(f"You've been fired from {save.company_name or 'your firm'} for inactivity.")
            save.job_status = "unemployed"
            save.job_title = "Unemployed"
            save.company_name = None
            save.salary = 0.0
            save.weekly_target = 0.0
            save.employer_user_id = None
            save.times_fired += 1
            save.boss_mood = 50


    if save.job_status == "business_owner":
        headcount = len(save.employees())
        revenue = round(random.uniform(40, 120) + headcount * random.uniform(60, 140), 2)
        save.balance += revenue
        save.add_profit(revenue)
    elif save.job_status != "employed_player":
        daily_salary = (save.salary or 0.0) / 7
        save.balance += daily_salary
        save.add_profit(daily_salary)

    if benefits["passive_income"]:
        save.balance += benefits["passive_income"]
        save.add_profit(benefits["passive_income"])
        events.append(f"Staff passive income: +${benefits['passive_income']:.2f}.")

    tracks = MusicTrack.query.filter_by(user_id=user.id).all()
    if tracks:
        music_income = 0.0
        for t in tracks:
            payout = t.daily_royalty()
            if payout:
                save.balance += payout
                t.total_earned = round((t.total_earned or 0.0) + payout, 2)
                music_income += payout
            t.age_days = (t.age_days or 0) + 1
        if music_income:
            save.music_earned_total = round((save.music_earned_total or 0.0) + music_income, 2)
            save.add_profit(music_income)
            events.append(f"Music royalties: +${music_income:.2f} from {len(tracks)} track(s).")

    loans = save.loans()
    if loans:
        loan_events = []
        for loan in loans:
            if loan.get("status") != "active":
                continue
            daily_rate = (loan.get("apr", 0.0)) / 365.0
            loan["balance"] = round(loan["balance"] * (1 + daily_rate), 2)
            if save.day - loan.get("last_payment_day", loan.get("taken_day", save.day)) >= 7:
                loan["missed_payments"] = loan.get("missed_payments", 0) + 1
                loan["last_payment_day"] = save.day
                save.credit_score = max(300, (save.credit_score or 650) - 20)
                if loan["missed_payments"] >= 3:
                    loan["status"] = "defaulted"
                    save.credit_score = max(300, save.credit_score - 60)
                    loan_events.append(f"Defaulted on your {loan['lender']} loan after repeated missed "
                                        f"payments - sent to collections. Credit score: {save.credit_score}.")
                else:
                    loan_events.append(f"Missed this week's payment on your {loan['lender']} loan "
                                        f"(${loan['balance']:.2f} owed). Credit score: {save.credit_score}.")
        save.set_loans(loans)
        events.extend(loan_events)

    save.set_profit_log(save.profit_log() + [{
        "day": save.day, "week": save.week, "month": save.month,
        "amount": round(save.daily_profit, 2),
    }])
    save.daily_profit = 0.0

    save.day += 1
    save.hunger = max(0, (save.hunger if save.hunger is not None else 100) - 2)
    if save.hunger <= 10:
        save.health = max(0, save.health - 1)
        events.append("You skipped meals and lost 1 health. Pick up food in Maps.")
    award_credits(user, "day", commit=False)

    if (save.day - 1) % 7 == 0:
        save.week += 1
        hit_target = save.weekly_commission >= save.weekly_target
        if save.job_status == "employed":
            bonus = round(max(0.0, save.weekly_commission - save.weekly_target), 2)
            if bonus:
                save.balance += bonus
                save.add_profit(bonus)
                events.append(f"Above-target bonus paid: +${bonus:.2f}.")
        else:
            _process_player_company_bonus(save, events)
        award_credits(user, "week", commit=False)
        if hit_target and save.weekly_target > 0:
            award_credits(user, "target_hit", commit=False)
        bills_due = round(save.weekly_bills * (1 - benefits["bill_discount"]), 2)
        save.balance -= bills_due
        if benefits["bill_discount"]:
            events.append(f"Staff cut this week's bills by {benefits['bill_discount']*100:.0f}% "
                           f"(paid ${bills_due:.2f} instead of ${save.weekly_bills:.2f}).")
        if not hit_target and save.weekly_target > 0:
            save.health = max(0, save.health - 2)
            events.append("Missed weekly target - health took an extra hit.")
        scale = 1.15 if save.difficulty == "Hard" else 1.12
        bills_scale = 1.10 if save.difficulty == "Hard" else 1.08
        save.weekly_target = round(save.weekly_target * scale, 2)
        save.weekly_bills = round(save.weekly_bills * bills_scale, 2)
        save.weekly_commission = 0.0
        save.health = max(0, save.health - 1)

        if save.probation_until_week is not None and save.week >= save.probation_until_week:
            if save.probation_pre_salary is not None and save.job_status == "employed":
                save.salary = save.probation_pre_salary
            save.probation_until_week = None
            save.probation_pre_salary = None
            if save.audit_status == "probation":
                save.audit_status = "clean"
            events.append("Your compliance probation period has ended - salary restored.")

    if (save.day - 1) % 30 == 0:
        save.month += 1
        save.age = 20 + ((save.month - 1) // 12)
        if save.balance > 0:
            tax_rate = market_state.get("tax_rate", TAX_RATE_DEFAULT)
            tax = round(save.balance * tax_rate, 2)
            save.balance -= tax
            events.append(f"Monthly taxes withheld: -${tax:.2f} ({tax_rate * 100:.1f}%, set by current tax law).")
        if save.job_status == "employed" and save.company_name == "Entry Level Desk":
            rung = min(len(JOB_LADDER) - 1, (save.month - 1) // 12)
            if JOB_LADDER[rung] != save.job_title:
                save.job_title = JOB_LADDER[rung]
                save.salary = round(save.salary * 1.15, 2)
                events.append(f"Promoted to {save.job_title}.")

    if save.health <= 0:
        save.active = False
        events.append("Health reached zero. Career over.")
    elif save.balance <= -1000:
        save.active = False
        events.append("Debts exceeded recovery threshold. Liquidated.")
    elif save.age >= 80:
        save.active = False
        events.append("Retirement age reached. Career over.")


@app.route("/api/game/advance_day", methods=["POST"])
@login_required
def game_advance_day():
    user = current_user()
    save = get_or_create_save(user)
    if not save.active:
        return jsonify(success=False, msg="No active career.")

    events = []
    _run_day_tick(user, save, events)
    save.world_tick = _target_day_number()

    db.session.commit()
    return jsonify(success=True, events=events, boss_mood=save.boss_mood)


@app.route("/api/game/trade_share", methods=["POST"])
@login_required
def game_trade_share():
    data = request.get_json(silent=True) or {}
    symbol = data.get("symbol")
    action = data.get("action")
    qty = max(1, int(data.get("qty", 1)))

    if symbol not in STOCKS:
        return jsonify(success=False, msg="Invalid stock symbol")

    user = current_user()
    save = get_or_create_save(user)
    price = STOCKS[symbol]["price"]
    total = round(price * qty, 2)
    shares = save.shares()

    if action == "buy":
        if save.balance < total:
            return jsonify(success=False, msg="Insufficient funds")
        save.balance -= total
        shares[symbol] = shares.get(symbol, 0) + qty
        save.record_buy(symbol, qty, price)
        log_event(f"{user.username}: bought {qty} {symbol} for ${total:.2f}")
    elif action == "sell":
        if shares.get(symbol, 0) < qty:
            return jsonify(success=False, msg="Insufficient shares owned")
        shares[symbol] -= qty
        save.balance += total
        realized = save.record_sell(symbol, qty, price)
        save.add_profit(total)
        sign = "+" if realized >= 0 else "-"
        log_event(f"{user.username}: sold {qty} {symbol} for ${total:.2f} "
                  f"({sign}${abs(realized):.2f} vs cost basis)")
    else:
        return jsonify(success=False, msg="Unknown action")

    save.set_shares(shares)
    save.trades_count += 1
    save.mark_active()
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/game/positions")
@login_required
def api_positions():
    user = current_user()
    save = GameSave.query.filter_by(user_id=user.id).first()
    data = _compute_positions(save if save and save.active else None, STOCKS)
    return jsonify(success=True, **data)


@app.route("/api/alerts", methods=["GET", "POST"])
@login_required
def api_alerts():
    user = current_user()

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        symbol = (data.get("symbol") or "").strip().upper()
        direction = data.get("direction")
        try:
            threshold = float(data.get("threshold"))
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Threshold must be a number."), 400
        if symbol not in STOCKS:
            return jsonify(success=False, msg=f"Unknown ticker '{symbol}'."), 400
        if direction not in ("above", "below"):
            return jsonify(success=False, msg="Direction must be 'above' or 'below'."), 400
        alert = PriceAlert(user_id=user.id, symbol=symbol, direction=direction, threshold=threshold)
        db.session.add(alert)
        db.session.commit()
        return jsonify(success=True, alert=alert.to_dict())


    newly_triggered = []
    live_alerts = PriceAlert.query.filter_by(user_id=user.id, active=True).all()
    for a in live_alerts:
        if a.triggered_at:
            continue
        stock = STOCKS.get(a.symbol)
        if not stock:
            continue
        price = stock["price"]
        crossed = (a.direction == "above" and price >= a.threshold) or \
                  (a.direction == "below" and price <= a.threshold)
        if crossed:
            a.triggered_at = datetime.utcnow()
            a.triggered_price = price
            newly_triggered.append(a)
    if newly_triggered:
        db.session.commit()

    all_alerts = (PriceAlert.query.filter_by(user_id=user.id)
                  .order_by(PriceAlert.created_at.desc()).limit(50).all())
    return jsonify(success=True, alerts=[a.to_dict() for a in all_alerts],
                    newly_triggered=[a.to_dict() for a in newly_triggered])


@app.route("/api/alerts/<int:alert_id>/delete", methods=["POST"])
@login_required
def api_alert_delete(alert_id):
    user = current_user()
    alert = PriceAlert.query.filter_by(id=alert_id, user_id=user.id).first()
    if not alert:
        return jsonify(success=False), 404
    db.session.delete(alert)
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/mining/estimate", methods=["POST"])
@login_required
def api_mining_estimate():
    data = request.get_json(silent=True) or {}
    btc_price = market_state.get("btc_price")
    difficulty = market_state.get("btc_difficulty")
    if not btc_price or not difficulty:
        return jsonify(success=False, msg="Market feed still warming up - try again in a few seconds."), 503

    try:
        result = mining_calc.estimate_profit(
            hashrate=data.get("hashrate"),
            unit=data.get("unit", "th"),
            difficulty=difficulty,
            btc_price=btc_price,
            power_watts=data.get("power_watts", 0) or 0,
            cost_per_kwh=data.get("cost_per_kwh", 0) or 0,
            pool_fee_pct=data.get("pool_fee_pct", 1) or 0,
        )
    except (ValueError, TypeError) as e:
        return jsonify(success=False, msg=str(e)), 400

    return jsonify(success=True, result=result, btc_price=btc_price, difficulty=difficulty,
                    difficulty_live=feed_health.get("difficulty", False))


@app.route("/api/game/call_client", methods=["POST"])
@login_required
def game_call_client():
    data = request.get_json(silent=True) or {}
    bot_id = data.get("bot_id")
    client = next((b for b in CLIENT_BOTS if b["id"] == bot_id), None)
    if not client:
        return jsonify(success=False)
    user = current_user()
    save = get_or_create_save(user)
    trust = save.client_trust().get(bot_id, CLIENT_TRUST_RULES["start"])
    if trust < CLIENT_TRUST_RULES["min_call_trust"] and random.random() < CLIENT_TRUST_RULES["decline_chance"]:
        line = random.choice(CLIENT_DECLINE_LINES)
        return jsonify(success=False, declined=True, trust=trust,
                        msg=f"{client['name']} {line}")
    session["active_call_client_id"] = client["id"]
    greeting = ai.client_greeting(client, user.language)
    return jsonify(success=True, client={**client, "greeting": greeting}, trust=trust)


@app.route("/api/game/convince_client", methods=["POST"])
@login_required
def game_convince_client():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    user = current_user()
    image = _owned_image(user.id, data.get("image_id"))
    if data.get("image_id") not in (None, "") and not image:
        return jsonify(success=False, msg="Picture not found in your library."), 404
    if image and not ai.ai_available():
        return _image_analysis_error()
    if not message and not image:
        return jsonify(success=False, msg="Write a pitch or attach a picture."), 400
    client_id = session.get("active_call_client_id")
    client = next((b for b in CLIENT_BOTS if b["id"] == client_id), None)
    if not client:
        return jsonify(success=False, reply="No active call.")

    save = get_or_create_save(user)
    save.mark_active()
    result = ai.client_pitch_reply(client, message, user.language,
                                   image_data_url=_image_data_url(image))

    trust_map = save.client_trust()
    trust = trust_map.get(client_id, CLIENT_TRUST_RULES["start"])

    if result["invests"]:
        benefits = _apply_employee_benefits(save)
        commission = round(client["net_worth"] * 0.005 * (1 + benefits["commission_boost"]), 2)
        if trust >= CLIENT_TRUST_RULES["referral_trust"] and random.random() < CLIENT_TRUST_RULES["referral_chance"]:
            bonus = round(commission * CLIENT_TRUST_RULES["referral_bonus_pct"], 2)
            commission += bonus
            result["reply"] += f" (Referral bonus, they trust you: +${bonus:.2f})"
        save.balance += commission
        save.weekly_commission += commission
        save.add_profit(commission)
        save.deals_closed += 1
        award_credits(user, "deal", commit=False)
        log_event(f"{user.username}: closed {client['name']}, +${commission:.2f} commission.")
        result["reply"] += f" (Commission earned: +${commission:.2f})"
        trust = max(0, min(100, trust + CLIENT_TRUST_RULES["deal_delta"]))
    else:
        trust = max(0, min(100, trust + CLIENT_TRUST_RULES["fail_delta"]))
        if trust <= 5:
            save.boss_mood = max(0, save.boss_mood - 5)
            result["reply"] += " (They mention this call to your boss.)"

    trust_map[client_id] = trust
    save.set_client_trust(trust_map)

    db.session.commit()
    return jsonify(success=True, deal_closed=result["invests"], reply=result["reply"], trust=trust,
                    image=image.to_dict() if image else None)


@app.route("/api/game/boss_review", methods=["GET", "POST"])
@login_required
def game_boss_review():
    user = current_user()
    save = get_or_create_save(user)
    stats = {
        "week": save.week, "job_title": save.job_title, "difficulty": save.difficulty,
        "target": save.weekly_target, "commission": save.weekly_commission,
        "hit_target": save.weekly_commission >= save.weekly_target,
        "boss_mood": save.boss_mood,
    }
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        message = (data.get("message") or "").strip()
        if not message:
            return jsonify(success=False, msg="Say something to your boss first.")
        text = ai.boss_followup(stats, message, user.language)
        return jsonify(success=True, mood="NEUTRAL", message=text)
    return jsonify(success=True, **ai.boss_weekly_review(stats, user.language))




def _resolve_firm(firm_id):
    if isinstance(firm_id, str) and firm_id.startswith("player:"):
        try:
            gs_id = int(firm_id.split(":", 1)[1])
        except ValueError:
            return None, None
        gs = db.session.get(GameSave, gs_id)
        if not gs or gs.job_status != "business_owner" or not gs.hiring_open:
            return None, None
        owner = db.session.get(User, gs.user_id)
        firm = {
            "id": firm_id, "name": gs.company_name or "an operator-run company",
            "role": gs.hiring_role or "Operator", "salary": gs.hiring_salary or 0.0,
            "target": gs.hiring_target or 0.0,
            "interviewer": f"{owner.username if owner else 'the founder'}, "
                           f"the founder of {gs.company_name or 'the company'}",
        }
        return firm, gs.user_id
    firm = next((j for j in JOB_LISTINGS if j["id"] == firm_id), None)
    return firm, None


def _build_work_shift(seed):
    rng = random.Random(seed)

    x = rng.randint(2, 19)
    a = rng.randint(2, 9)
    b = rng.randint(-40, 60)
    c = a * x + b
    algebra = {"a": a, "b": b, "c": c, "answer": x}

    pct = rng.choice([2, 3, 5, 7, 8, 10, 12, 15, 18, 20])
    base = rng.randint(1200, 48000)
    percent_answer = round(base * pct / 100.0, 2)
    percent = {"pct": pct, "base": base, "answer": percent_answer}

    start_balance = rng.choice([5000, 8000, 10000, 12500, 15000])
    n_items = rng.randint(4, 6)
    items = []
    running = start_balance
    for _ in range(n_items):
        label, lo, hi = rng.choice(LEDGER_ITEM_POOL)
        amount = round(rng.uniform(min(lo, hi), max(lo, hi)), 2)
        items.append({"label": label, "amount": amount})
        running += amount
    ledger = {"start_balance": start_balance, "items": items, "answer": round(running, 2)}

    prompt = rng.choice(ESSAY_PROMPTS)

    return {"algebra": algebra, "percent": percent, "ledger": ledger, "essay_prompt": prompt}


def _work_shift_public(shift):
    return {
        "algebra": {"a": shift["algebra"]["a"], "b": shift["algebra"]["b"], "c": shift["algebra"]["c"]},
        "percent": {"pct": shift["percent"]["pct"], "base": shift["percent"]["base"]},
        "ledger": {"start_balance": shift["ledger"]["start_balance"], "items": shift["ledger"]["items"]},
        "essay_prompt": shift["essay_prompt"],
    }


@app.route("/api/work/shift/start")
@login_required
def work_shift_start():
    user = current_user()
    save = get_or_create_save(user)
    if save.job_status == "unemployed":
        return jsonify(success=False, msg="You need a job (or a business) before you can clock in."), 403

    state = json.loads(save.work_shift_json or "{}")
    if not state.get("open"):
        seed = random.randint(1, 2_000_000_000)
        state = {"open": True, "seed": seed, "started_day": save.day}
        save.work_shift_json = json.dumps(state)
        db.session.commit()

    shift = _build_work_shift(state["seed"])
    return jsonify(success=True, shift=_work_shift_public(shift), started_day=state["started_day"])


@app.route("/api/work/shift/submit", methods=["POST"])
@login_required
def work_shift_submit():
    data = request.get_json(silent=True) or {}
    user = current_user()
    save = get_or_create_save(user)

    state = json.loads(save.work_shift_json or "{}")
    if not state.get("open"):
        return jsonify(success=False, msg="No shift is open. Clock in first."), 400

    shift = _build_work_shift(state["seed"])
    results = {}

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    algebra_ans = _num(data.get("algebra"))
    results["algebra"] = algebra_ans is not None and abs(algebra_ans - shift["algebra"]["answer"]) < 0.001

    percent_ans = _num(data.get("percent"))
    results["percent"] = percent_ans is not None and abs(percent_ans - shift["percent"]["answer"]) < 0.5

    ledger_ans = _num(data.get("ledger"))
    results["ledger"] = ledger_ans is not None and abs(ledger_ans - shift["ledger"]["answer"]) < 0.5

    essay_text = (data.get("essay") or "").strip()
    words = [w for w in re.split(r"\s+", essay_text) if w]
    prompt = shift["essay_prompt"]
    has_terms = all(term.lower() in essay_text.lower() for term in prompt["must_include"])
    results["essay"] = len(words) >= prompt["min_words"] and has_terms

    correct_count = sum(1 for v in results.values() if v)

    base_payout = round((save.salary or 2000.0) * 0.06, 2)
    payout = round(base_payout * (correct_count / 4.0), 2)

    save.balance += payout
    save.weekly_commission += payout
    save.add_profit(payout)
    save.work_shifts_completed = (save.work_shifts_completed or 0) + 1
    save.work_tasks_total = (save.work_tasks_total or 0) + 4
    save.work_tasks_correct = (save.work_tasks_correct or 0) + correct_count
    if words:
        save.essays_written = (save.essays_written or 0) + 1
    save.work_shift_json = "{}"
    save.mark_active()
    award_credits(user, "work_shift", commit=False)
    log_event(f"{user.username} closed out a work shift: {correct_count}/4 tasks, +${payout:.2f}.")
    db.session.commit()

    return jsonify(
        success=True, results=results, correct_count=correct_count, payout=payout,
        correct_answers={
            "algebra": shift["algebra"]["answer"], "percent": shift["percent"]["answer"],
            "ledger": shift["ledger"]["answer"],
            "essay_requirements": {"min_words": prompt["min_words"], "must_include": prompt["must_include"], "your_words": len(words)},
        },
        stats={
            "work_shifts_completed": save.work_shifts_completed, "work_tasks_correct": save.work_tasks_correct,
            "work_tasks_total": save.work_tasks_total, "essays_written": save.essays_written,
        },
    )


@app.route("/api/reports", methods=["POST"])
@login_required
def reports_create():
    data = request.get_json(silent=True) or {}
    user = current_user()
    target_username = (data.get("target_username") or "").strip()
    if not target_username:
        return jsonify(success=False, msg="Missing a target username."), 400
    reason = data.get("reason") if data.get("reason") in ("cheating", "nsfw", "harassment", "scam", "other") else "other"
    report = Report(
        reporter_id=user.id, target_username=target_username[:64],
        target_type=(data.get("target_type") or "user")[:24], target_ref=(data.get("target_ref") or "")[:64],
        reason=reason, details=(data.get("details") or "")[:500],
    )
    db.session.add(report)
    db.session.commit()
    return jsonify(success=True, msg="Report filed. An admin will review it.")


@app.route("/api/admin/reports")
@admin_required
def admin_reports_list():
    status = request.args.get("status")
    q = Report.query
    if status:
        q = q.filter_by(status=status)
    rows = q.order_by(Report.created_at.desc()).limit(200).all()
    out = []
    for r in rows:
        reporter = db.session.get(User, r.reporter_id)
        out.append(r.to_dict(reporter_name=reporter.username if reporter else None))
    return jsonify(success=True, reports=out)


@app.route("/api/admin/reports/<int:report_id>/resolve", methods=["POST"])
@admin_required
def admin_reports_resolve(report_id):
    data = request.get_json(silent=True) or {}
    user = current_user()
    report = db.session.get(Report, report_id)
    if not report:
        return jsonify(success=False, msg="No such report."), 404
    status = data.get("status") if data.get("status") in ("reviewing", "resolved", "dismissed") else "resolved"
    report.status = status
    report.resolved_at = datetime.utcnow()
    report.resolved_by = user.username
    report.resolution_note = (data.get("note") or "")[:500]
    db.session.commit()
    return jsonify(success=True, report=report.to_dict())


@app.route("/api/admin/users")
@admin_required
def admin_users_list():
    q = (request.args.get("q") or "").strip()
    query = User.query
    if request.args.get("admins_only") == "1":
        query = query.filter(User.is_admin.is_(True))
    if q:
        query = query.filter(User.username.ilike(f"%{q}%"))
    users = query.order_by(User.created_at.desc()).limit(100).all()
    out = []
    for u in users:
        save = GameSave.query.filter_by(user_id=u.id).first()
        open_reports = Report.query.filter_by(target_username=u.username, status="open").count()
        out.append({
            "id": u.id, "username": u.username,
            "created_at": u.created_at.strftime("%Y-%m-%d") if u.created_at else None,
            "is_admin": bool(u.is_admin), "is_banned": bool(u.is_banned),
            "ban_reason": u.ban_reason, "open_reports": open_reports,
            "job_status": save.job_status if save else None,
            "job_title": save.job_title if save else None,
            "salary": save.salary if save else None,
            "balance": save.balance if save else None,
        })
    return jsonify(success=True, users=out)


@app.route("/api/admin/users/<int:user_id>/ban", methods=["POST"])
@admin_required
def admin_ban_user(user_id):
    actor = current_user()
    target = db.session.get(User, user_id)
    if not target:
        return jsonify(success=False, msg="No such operator."), 404
    if target.id == actor.id or target.is_admin:
        return jsonify(success=False, msg="Admins cannot suspend themselves or another admin."), 403
    data = request.get_json(silent=True) or {}
    reason = str(data.get("reason") or "").strip()[:160]
    if not reason:
        return jsonify(success=False, msg="A reason is required."), 400
    target.is_banned = True
    target.ban_reason = reason
    target.banned_at = datetime.utcnow()
    target.banned_by = actor.username
    db.session.commit()
    log_event(f"Admin {actor.username} suspended {target.username}: {reason}")
    return jsonify(success=True, msg=f"{target.username} suspended.")


@app.route("/api/admin/users/<int:user_id>/unban", methods=["POST"])
@admin_required
def admin_unban_user(user_id):
    actor = current_user()
    target = db.session.get(User, user_id)
    if not target:
        return jsonify(success=False, msg="No such operator."), 404
    if not target.is_banned:
        return jsonify(success=False, msg="That operator is not suspended."), 400
    target.is_banned = False
    target.ban_reason = None
    target.banned_at = None
    target.banned_by = None
    db.session.commit()
    log_event(f"Admin {actor.username} restored {target.username}'s access.")
    return jsonify(success=True, msg=f"{target.username} can sign in again.")


@app.route("/api/game/jobs")
@login_required
def game_jobs():
    user = current_user()
    save = get_or_create_save(user)
    listings = []
    for j in JOB_LISTINGS:
        if j["name"] == save.company_name:
            continue
        entry = dict(j)
        min_score = j.get("min_credit_score")
        entry["credit_locked"] = bool(min_score and (save.credit_score or 0) < min_score)
        listings.append(entry)

    player_rows = (GameSave.query
                   .filter(GameSave.job_status == "business_owner",
                           GameSave.hiring_open.is_(True),
                           GameSave.user_id != user.id)
                   .order_by(GameSave.id.desc()).limit(30).all())
    for gs in player_rows:
        owner = db.session.get(User, gs.user_id)
        headcount = GameSave.query.filter_by(employer_user_id=gs.user_id, job_status="employed_player").count()
        listings.append({
            "id": f"player:{gs.id}", "name": gs.company_name or "Unnamed Company",
            "salary": gs.hiring_salary or 0.0, "target": gs.hiring_target or 0.0,
            "blurb": f"Player-founded company. Role: {gs.hiring_role or 'Operator'}. "
                     f"{headcount} operator(s) currently on staff.",
            "founder": owner.username if owner else "?", "player_company": True,
            "credit_locked": False,
        })

    return jsonify(success=True, jobs=listings, job_status=save.job_status,
                    applied_firm=save.applied_firm, current_firm=save.company_name,
                    current_title=save.job_title, current_salary=save.salary,
                    credit_score=save.credit_score)


@app.route("/api/game/apply_job", methods=["POST"])
@login_required
def game_apply_job():
    data = request.get_json(silent=True) or {}
    firm_id = data.get("firm_id")
    firm, player_employer_id = _resolve_firm(firm_id)
    if not firm:
        return jsonify(success=False, msg="Unknown firm, or that posting just closed."), 404

    user = current_user()
    save = get_or_create_save(user)
    if player_employer_id == user.id:
        return jsonify(success=False, msg="You can't interview at your own company.")
    if save.applied_firm:
        return jsonify(success=False, msg="You already have an interview in progress. Finish or abandon it first.")
    if save.last_rejected_firm == firm_id and save.day < (save.reapply_after_day or 0):
        days_left = (save.reapply_after_day or save.day) - save.day
        return jsonify(success=False, msg=f"That firm asked you to wait {days_left} more in-game day(s) before reapplying."), 429

    min_score = firm.get("min_credit_score")
    if min_score and (save.credit_score or 0) < min_score:
        return jsonify(success=False,
                        msg=f"{firm['name']} runs a credit check before they'll even interview you. "
                            f"Your score is {save.credit_score}; they want {min_score}+.")

    save.applied_firm = firm_id
    save.interview_turns = 0
    question = ai.interview_opening(firm, user.language)
    save.interview_transcript = f"Interviewer: {question}"
    db.session.commit()
    log_event(f"{user.username} started interviewing at {firm['name']}.")
    return jsonify(success=True, firm=firm["name"], message=question)


@app.route("/api/game/interview_answer", methods=["POST"])
@login_required
def game_interview_answer():
    data = request.get_json(silent=True) or {}
    answer = (data.get("message") or "").strip()
    user = current_user()
    save = get_or_create_save(user)
    firm, player_employer_id = _resolve_firm(save.applied_firm)
    if not firm:
        return jsonify(success=False, msg="No interview in progress.")
    if not answer:
        return jsonify(success=False, msg="Say something to the interviewer.")

    result = ai.interview_reply(firm, save.interview_transcript, answer, save.interview_turns, user.language)
    save.interview_transcript += f"\nCandidate: {answer}\nInterviewer: {result['reply']}"
    save.interview_turns += 1

    hired = False
    if result["decision"] == "HIRE":
        save.job_status = "employed_player" if player_employer_id else "employed"
        save.employer_user_id = player_employer_id
        save.job_title = f"{firm.get('role', 'Broker')} @ {firm['name']}"
        save.company_name = firm["name"]
        save.salary = firm["salary"]
        save.weekly_target = firm.get("target", 0.0)
        save.weekly_commission = 0.0
        save.job_start_day = save.day
        save.boss_mood = 100
        save.last_rejected_firm = None
        save.reapply_after_day = 0
        save.applied_firm = None
        save.interview_turns = 0
        save.interview_transcript = ""
        hired = True
        award_credits(user, "interview", commit=False)
        log_event(f"{user.username} was hired at {firm['name']}.")
    elif result["decision"] == "REJECT":
        save.last_rejected_firm = save.applied_firm
        save.reapply_after_day = save.day + 3
        save.applied_firm = None
        save.interview_turns = 0
        save.interview_transcript = ""
        log_event(f"{user.username} was rejected by {firm['name']}.")

    db.session.commit()
    return jsonify(success=True, reply=result["reply"], decision=result["decision"], hired=hired)


@app.route("/api/game/abandon_interview", methods=["POST"])
@login_required
def game_abandon_interview():
    save = get_or_create_save(current_user())
    save.applied_firm = None
    save.interview_turns = 0
    save.interview_transcript = ""
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/game/company/set_listing", methods=["POST"])
@login_required
def game_company_set_listing():
    data = request.get_json(silent=True) or {}
    user = current_user()
    save = get_or_create_save(user)
    if save.job_status != "business_owner":
        return jsonify(success=False, msg="Found a business first - you need one to hire into.")

    if not data.get("open"):
        save.hiring_open = False
        db.session.commit()
        return jsonify(success=True, hiring_open=False)

    role = (data.get("role") or "").strip()[:64]
    try:
        salary = round(float(data.get("salary", 0)), 2)
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid salary."), 400
    if not role:
        return jsonify(success=False, msg="Give the role a title.")
    if not math.isfinite(salary) or salary <= 0 or salary > 50000:
        return jsonify(success=False, msg="Weekly salary must be between $0 and $50,000."), 400
    try:
        target = round(float(data.get("target", 0)), 2)
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid weekly target."), 400
    if not math.isfinite(target) or target <= 0 or target > 1000000:
        return jsonify(success=False, msg="Weekly target must be between $0.01 and $1,000,000."), 400
    save.hiring_role = role
    save.hiring_salary = salary
    save.hiring_target = target
    save.hiring_open = True
    db.session.commit()
    log_event(f"{user.username} opened a role ({role}) at {save.company_name}.")
    return jsonify(success=True, hiring_open=True, hiring_role=role,
                   hiring_salary=salary, hiring_target=target)


@app.route("/api/game/company/roster")
@login_required
def game_company_roster():
    user = current_user()
    save = get_or_create_save(user)
    if save.job_status != "business_owner":
        return jsonify(success=False, msg="You don't run a company."), 400
    staff = GameSave.query.filter_by(employer_user_id=user.id, job_status="employed_player").all()
    out = []
    for s in staff:
        owner = db.session.get(User, s.user_id)
        out.append({"username": owner.username if owner else "?", "role": s.job_title,
                     "salary": s.salary, "target": s.weekly_target,
                     "since_day": s.job_start_day})
    return jsonify(success=True, staff=out, hiring_open=save.hiring_open,
                    hiring_role=save.hiring_role, hiring_salary=save.hiring_salary,
                    hiring_target=save.hiring_target or 0.0)


@app.route("/api/game/quit_job", methods=["POST"])
@login_required
def game_quit_job():
    user = current_user()
    save = get_or_create_save(user)
    if save.job_status not in ("employed", "employed_player", "business_owner"):
        return jsonify(success=False, msg="You don't currently have a job to leave.")
    old = save.company_name
    save.job_status = "unemployed"
    save.job_title = "Unemployed"
    save.company_name = None
    save.salary = 0.0
    save.weekly_target = 0.0
    save.weekly_commission = 0.0
    save.employer_user_id = None
    save.boss_mood = 100
    db.session.commit()
    log_event(f"{user.username} left {old or 'their position'}.")
    return jsonify(success=True)


BUSINESS_STARTUP_COST = 20000.0


@app.route("/api/game/start_business", methods=["POST"])
@login_required
def game_start_business():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:64]
    if not name:
        return jsonify(success=False, msg="Name your business first.")

    user = current_user()
    save = get_or_create_save(user)
    if save.balance < BUSINESS_STARTUP_COST:
        return jsonify(success=False, msg=f"Insufficient funds - need ${BUSINESS_STARTUP_COST:,.0f} to start a business.")

    save.balance -= BUSINESS_STARTUP_COST
    save.business_capital = BUSINESS_STARTUP_COST
    save.business_started_day = save.day
    save.job_status = "business_owner"
    save.job_title = f"Founder & CEO, {name}"
    save.company_name = name
    save.salary = 0.0
    save.weekly_target = 0.0
    save.weekly_commission = 0.0
    save.boss_mood = 100
    save.applied_firm = None
    save.employer_user_id = None
    save.hiring_open = False
    save.hiring_role = None
    save.hiring_target = 0.0
    award_credits(user, "business", commit=False)
    db.session.commit()
    log_event(f"{user.username} founded {name} with ${BUSINESS_STARTUP_COST:,.0f} in startup capital.")
    return jsonify(success=True, name=name)


@app.route("/api/game/profit_report")
@login_required
def game_profit_report():
    save = get_or_create_save(current_user())
    log = save.profit_log()
    today = round(save.daily_profit, 2)
    week_total = round(sum(e["amount"] for e in log if e["week"] == save.week), 2) + today
    month_total = round(sum(e["amount"] for e in log if e["month"] == save.month), 2) + today
    return jsonify(success=True, today=today, week=week_total, month=month_total, log=log[-14:])


@app.route("/api/game/marry", methods=["POST"])
@login_required
def game_marry():
    data = request.get_json(silent=True) or {}
    spouse_name = (data.get("spouse_name") or "").strip()
    if not spouse_name:
        return jsonify(success=False, msg="Enter a name.")
    save = get_or_create_save(current_user())
    save.spouse = spouse_name[:64]
    db.session.commit()
    log_event(f"{save.name} married {spouse_name}.")
    return jsonify(success=True)


@app.route("/api/game/hire_employee", methods=["POST"])
@login_required
def game_hire_employee():
    data = request.get_json(silent=True) or {}
    role = (data.get("role") or "Junior Analyst")[:64]
    try:
        salary = max(0.0, float(data.get("salary", 1000)))
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid salary.")

    user = current_user()
    save = get_or_create_save(user)
    employees = save.employees()
    employees.append({"id": int(time.time() * 1000), "role": role, "salary": salary})
    save.set_employees(employees)
    save.weekly_bills = round(save.weekly_bills + salary / 4, 2)
    save.mark_active()
    db.session.commit()
    log_event(f"{save.name} hired a {role} at ${salary:.2f}/wk.")
    return jsonify(success=True, employees=employees, weekly_bills=save.weekly_bills)


@app.route("/api/game/fire_employee", methods=["POST"])
@login_required
def game_fire_employee():
    data = request.get_json(silent=True) or {}
    emp_id = data.get("id")
    save = get_or_create_save(current_user())
    employees = save.employees()
    target = next((e for e in employees if e.get("id") == emp_id), None)
    if not target:
        return jsonify(success=False, msg="Employee not found.")
    employees = [e for e in employees if e.get("id") != emp_id]
    save.set_employees(employees)
    save.weekly_bills = round(max(0.0, save.weekly_bills - target["salary"] / 4), 2)
    db.session.commit()
    log_event(f"{save.name} let go of a {target['role']}.")
    return jsonify(success=True, employees=employees, weekly_bills=save.weekly_bills)


def _apply_employee_benefits(save):
    totals = {"passive_income": 0.0, "bill_discount": 0.0, "boss_mood_shield": 0,
              "commission_boost": 0.0, "investor_boost": 0.0}
    for e in save.employees():
        b, v = e.get("benefit"), e.get("benefit_value", 0)
        if b == "passive_income":
            totals["passive_income"] += v
        elif b == "bill_discount":
            totals["bill_discount"] += v
        elif b == "boss_mood_shield":
            totals["boss_mood_shield"] += v
        elif b == "commission_boost":
            totals["commission_boost"] += v
        elif b == "investor_boost":
            totals["investor_boost"] += v
    totals["bill_discount"] = min(0.5, totals["bill_discount"])
    return totals


@app.route("/api/game/employees/candidates")
@login_required
def game_employee_candidates():
    save = get_or_create_save(current_user())
    existing = {e["name"] for e in save.employees() if e.get("name")}
    cands = generate_employee_candidates(count=4, exclude_names=existing)
    return jsonify(success=True, candidates=cands, roster=save.employees(),
                    weekly_bills=save.weekly_bills, balance=save.balance)


@app.route("/api/game/employees/hire_named", methods=["POST"])
@login_required
def game_hire_named_employee():
    data = request.get_json(silent=True) or {}
    user = current_user()
    save = get_or_create_save(user)
    employees = save.employees()
    if len(employees) >= 12:
        return jsonify(success=False, msg="Staff roster is full (max 12). Fire someone first.")
    name = (data.get("name") or "").strip()[:64]
    role = (data.get("role") or "Staff")[:64]
    try:
        salary = max(0.0, float(data.get("salary", 1000)))
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid salary.")
    if not name:
        return jsonify(success=False, msg="Candidate has no name.")

    employees.append({
        "id": int(time.time() * 1000), "name": name, "role": role, "salary": salary,
        "benefit": data.get("benefit"), "benefit_value": data.get("benefit_value", 0),
        "benefit_desc": data.get("benefit_desc", ""), "trait": data.get("trait", "steady"),
        "morale": 80, "hired_day": save.day,
        "avatar_url": data.get("avatar_url", ""),
    })
    save.set_employees(employees)
    save.weekly_bills = round(save.weekly_bills + salary / 4, 2)
    save.mark_active()
    db.session.commit()
    log_event(f"{save.name} hired {name} as {role} at ${salary:.2f}/wk.")
    return jsonify(success=True, employees=employees, weekly_bills=save.weekly_bills, balance=save.balance)


@app.route("/api/game/employees/talk", methods=["POST"])
@login_required
def game_talk_employee():
    data = request.get_json(silent=True) or {}
    emp_id = data.get("id")
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify(success=False, msg="Say something first.")
    user = current_user()
    save = get_or_create_save(user)
    emp = next((e for e in save.employees() if e.get("id") == emp_id), None)
    if not emp:
        return jsonify(success=False, msg="Employee not found.")
    stats = {"boss_mood": save.boss_mood}
    reply = ai.employee_chat_reply(emp, message, stats, user.language)
    return jsonify(success=True, reply=reply)


@app.route("/api/game/vacation/list")
@login_required
def game_vacation_list():
    user = current_user()
    save = get_or_create_save(user)
    employees = save.employees()
    requests_ = save.vacation_requests()

    if employees and save.last_vacation_day != save.day:
        save.last_vacation_day = save.day
        pending_names = {r["employee_name"] for r in requests_ if r["status"] == "pending"}
        for emp in employees:
            if emp["name"] in pending_names:
                continue
            if random.random() < 0.2:
                stats = {"boss_mood": save.boss_mood}
                msg = ai.employee_vacation_request(emp, stats, user.language)
                requests_.append({
                    "id": int(time.time() * 1000) + random.randint(0, 999),
                    "employee_id": emp["id"], "employee_name": emp["name"],
                    "role": emp.get("role", ""), "message": msg, "status": "pending",
                    "day": save.day,
                })
                break
        save.set_vacation_requests(requests_)
        db.session.commit()

    return jsonify(success=True, requests=save.vacation_requests(), employees=employees)


@app.route("/api/game/vacation/respond", methods=["POST"])
@login_required
def game_vacation_respond():
    data = request.get_json(silent=True) or {}
    req_id = data.get("id")
    decision = data.get("decision")
    if decision not in ("approve_paid", "approve_unpaid", "deny"):
        return jsonify(success=False, msg="Invalid decision.")

    user = current_user()
    save = get_or_create_save(user)
    reqs = save.vacation_requests()
    target = next((r for r in reqs if r["id"] == req_id and r["status"] == "pending"), None)
    if not target:
        return jsonify(success=False, msg="Request not found or already handled.")

    employees = save.employees()
    emp = next((e for e in employees if e.get("id") == target["employee_id"]), None)
    target["status"] = decision
    morale_delta = 0
    cash_delta = 0.0
    if decision == "approve_paid":
        morale_delta = 15
        if emp:
            cash_delta = -round(emp.get("salary", 0) * 0.25, 2)
            save.balance += cash_delta
    elif decision == "approve_unpaid":
        morale_delta = 5
    else:
        morale_delta = -20

    if emp:
        emp["morale"] = max(0, min(100, emp.get("morale", 80) + morale_delta))
        save.set_employees(employees)
    save.set_vacation_requests(reqs)
    db.session.commit()
    log_event(f"{save.name} {decision.replace('_', ' ')} {target['employee_name']}'s vacation request.")
    return jsonify(success=True, requests=reqs, employees=employees, balance=save.balance,
                    cash_delta=cash_delta)


@app.route("/api/game/compliance/status")
@login_required
def game_compliance_status():
    user = current_user()
    save = get_or_create_save(user)
    return jsonify(success=True, audit_strikes=save.audit_strikes, audit_status=save.audit_status,
                    probation_until_week=save.probation_until_week, week=save.week,
                    log=save.audit_log()[-10:])


@app.route("/api/game/assignments")
@login_required
def game_assignments():
    user = current_user()
    save = get_or_create_save(user)
    active = [a for a in save.assignments() if a["status"] == "pending"]

    if not active and save.job_status in ("employed", "business_owner") and save.last_assignment_day != save.day:
        save.last_assignment_day = save.day
        if random.random() < 0.6:
            template = random.choice(ASSIGNMENT_TEMPLATES)
            stats = {"week": save.week}
            brief = ai.boss_assignment_brief(template, stats, user.language)
            payload = _build_assignment_payload(template)
            payload.update({
                "id": int(time.time() * 1000), "kind": template["kind"], "title": template["title"],
                "brief": brief, "reward": template["reward"], "penalty": template["penalty"],
                "status": "pending", "day": save.day,
            })
            active = save.assignments()
            active.append(payload)
            save.set_assignments(active)
        db.session.commit()

    return jsonify(success=True, assignments=[a for a in save.assignments() if a["status"] == "pending"],
                    history=save.assignment_history()[-10:])


def _build_assignment_payload(template):
    kind = template["kind"]
    if kind == "reconcile":
        nums = [round(random.uniform(500, 5000), 2) for _ in range(4)]
        wrong_idx = random.randint(0, 3)
        true_total = round(sum(nums), 2)
        nums[wrong_idx] = round(nums[wrong_idx] + random.uniform(50, 400), 2)
        return {"numbers": nums, "reported_total": true_total, "answer_index": wrong_idx}
    if kind == "compliance_quiz":
        qs = random.sample(COMPLIANCE_QUESTIONS, k=3)
        return {"questions": qs, "answers": [q["answer"] for q in qs]}
    if kind == "cold_call_sprint":
        return {"target_pitches": 3, "progress": 0}
    if kind == "spot_the_error":
        real_symbols = list(STOCKS.keys())
        fake_symbol = "ZZZQ"
        rows = [{"symbol": s, "qty": random.randint(10, 500)} for s in random.sample(real_symbols, k=4)]
        insert_at = random.randint(0, len(rows))
        rows.insert(insert_at, {"symbol": fake_symbol, "qty": random.randint(10, 500)})
        return {"rows": rows, "answer_index": insert_at}
    return {}


@app.route("/api/game/assignments/submit", methods=["POST"])
@login_required
def game_assignment_submit():
    data = request.get_json(silent=True) or {}
    a_id = data.get("id")
    answer = data.get("answer")

    user = current_user()
    save = get_or_create_save(user)
    assignments = save.assignments()
    target = next((a for a in assignments if a["id"] == a_id and a["status"] == "pending"), None)
    if not target:
        return jsonify(success=False, msg="Assignment not found or already resolved.")

    correct = False
    if target["kind"] in ("reconcile", "spot_the_error"):
        try:
            correct = int(answer) == int(target["answer_index"])
        except (TypeError, ValueError):
            correct = False
    elif target["kind"] == "compliance_quiz":
        try:
            given = [int(x) for x in (answer or [])]
        except (TypeError, ValueError):
            given = []
        correct = given == target["answers"]
    elif target["kind"] == "cold_call_sprint":
        try:
            correct = int(answer) >= int(target["target_pitches"])
        except (TypeError, ValueError):
            correct = False

    burnout_flub = False
    stress = 100 - (save.health or 80)
    if correct and stress >= BURNOUT_RULES["error_stress_threshold"] \
            and random.random() < BURNOUT_RULES["error_chance"]:
        correct = False
        burnout_flub = True

    target["status"] = "passed" if correct else "failed"
    delta = target["reward"] if correct else -target["penalty"]
    save.balance += delta
    save.boss_mood = max(0, min(100, save.boss_mood + (8 if correct else -12)))
    save.set_assignments(assignments)
    history = save.assignment_history()
    history.append({"title": target["title"], "status": target["status"], "delta": delta, "day": save.day})
    save.set_assignment_history(history)
    log_event(f"{save.name} {'passed' if correct else 'failed'} assignment '{target['title']}' ({delta:+.2f})."
              + (" [burnout fumble]" if burnout_flub else ""))

    audit_event = None
    if not correct:
        audit_event = _maybe_trigger_audit(save, target["kind"])

    db.session.commit()
    resp = dict(success=True, correct=correct, delta=delta, balance=save.balance, boss_mood=save.boss_mood)
    if burnout_flub:
        resp["msg"] = "You had it right, but you're running on fumes - your hand slipped."
    if audit_event:
        resp["audit_event"] = audit_event
    return jsonify(**resp)


def _maybe_trigger_audit(save, kind):
    chance = AUDIT_RULES["trigger_chance"].get(kind, 0.0)
    if save.ai_buff_active("audit_shield"):
        chance *= 0.35
    if chance <= 0 or random.random() >= chance:
        return None

    save.audit_strikes = (save.audit_strikes or 0) + 1
    strike = save.audit_strikes
    log = save.audit_log()
    entry = {"day": save.day, "strike": strike}

    if strike == 1:
        fine = max(AUDIT_RULES["fine_min"], round((save.balance or 0) * AUDIT_RULES["fine_pct"], 2))
        fine = min(fine, save.balance) if save.balance > 0 else AUDIT_RULES["fine_min"]
        save.balance -= fine
        save.audit_status = "fined"
        msg = AUDIT_EVENT_TEXT[1].format(fine=f"${fine:.2f}")
        entry.update({"kind": "fine", "amount": fine, "msg": msg})
        log_event(f"{save.name} was fined ${fine:.2f} after a compliance review.")
    elif strike == 2:
        cut = AUDIT_RULES["probation_salary_cut"]
        weeks = AUDIT_RULES["probation_weeks"]
        save.probation_pre_salary = save.salary
        save.salary = round(save.salary * (1 - cut), 2)
        save.probation_until_week = save.week + weeks
        save.audit_status = "probation"
        msg = AUDIT_EVENT_TEXT[2].format(cut=int(cut * 100), weeks=weeks)
        entry.update({"kind": "probation", "salary_cut_pct": cut, "weeks": weeks, "msg": msg})
        log_event(f"{save.name} was placed on compliance probation ({int(cut*100)}% salary cut, {weeks} weeks).")
    else:
        save.job_status = "unemployed"
        save.job_title = "Unemployed"
        save.company_name = None
        save.salary = 0.0
        save.weekly_target = 0.0
        save.times_fired += 1
        save.audit_status = "clean"
        save.audit_strikes = 0
        save.probation_until_week = None
        save.probation_pre_salary = None
        msg = AUDIT_EVENT_TEXT[3]
        entry.update({"kind": "termination", "msg": msg})
        log_event(f"{save.name} was terminated for cause after repeated compliance violations.")

    log.append(entry)
    save.set_audit_log(log)
    return entry


@app.route("/api/game/privacy/status")
@login_required
def game_privacy_status():
    save = get_or_create_save(current_user())
    buffs = save.ai_buffs()
    active = {k: v for k, v in buffs.items() if v >= (save.day or 1)}
    catalog = [dict(bot=k, **v) for k, v in AI_CONSULTS.items()]
    return jsonify(success=True, active=active, day=save.day, catalog=catalog,
                    balance=save.balance, encryption_mode=current_user().encryption_mode)


@app.route("/api/game/privacy/consult", methods=["POST"])
@login_required
def game_privacy_consult():
    data = request.get_json(silent=True) or {}
    bot = (data.get("bot") or "").lower()
    spec = AI_CONSULTS.get(bot)
    if not spec:
        return jsonify(success=False, msg="Unknown relay."), 404
    user = current_user()
    save = get_or_create_save(user)
    if save.balance < spec["cost"]:
        return jsonify(success=False, msg=f"Need ${spec['cost']:,.0f} to buy that relay.")
    save.balance -= spec["cost"]
    buffs = save.ai_buffs()
    expires = (save.day or 1) + spec["duration_days"]
    buffs[spec["effect"]] = expires
    save.set_ai_buffs(buffs)
    db.session.commit()
    log_event(f"{user.username} routed through {bot.upper()} ({spec['effect']}, {spec['duration_days']}d).")
    return jsonify(success=True, effect=spec["effect"], expires_day=expires, balance=save.balance)


@app.route("/api/game/browser/scam", methods=["POST"])
@login_required
def game_browser_scam():
    user = current_user()
    save = get_or_create_save(user)
    if not save.active:
        return jsonify(success=False, msg="No active career to scam yet.")
    loss = round(min(save.balance * 0.12, 4000.0) + random.uniform(20, 150), 2)
    loss = max(0.0, min(loss, save.balance))
    save.balance -= loss
    db.session.commit()
    log_event(f"{user.username} got taken by a fake download for ${loss:,.2f}.")
    return jsonify(success=True, loss=loss, balance=save.balance)


@app.route("/api/game/investors/inbox")
@login_required
def game_investor_inbox():
    user = current_user()
    save = get_or_create_save(user)

    if save.job_status in ("employed", "business_owner") and save.last_investor_msg_day != save.day:
        save.last_investor_msg_day = save.day
        if random.random() < 0.5:
            client = random.choice(CLIENT_BOTS)
            msg = ai.investor_inbox_message(client, user.language)
            inbox = save.investor_inbox()
            inbox.append({
                "id": int(time.time() * 1000), "client_id": client["id"], "client_name": client["name"],
                "avatar_url": client.get("avatar_url", ""), "message": msg, "reply": None,
                "status": "pending", "day": save.day,
            })
            save.set_investor_inbox(inbox)
        db.session.commit()

    return jsonify(success=True, inbox=save.investor_inbox())


@app.route("/api/game/investors/reply", methods=["POST"])
@login_required
def game_investor_reply():
    data = request.get_json(silent=True) or {}
    msg_id = data.get("id")
    reply_text = (data.get("message") or "").strip()
    user = current_user()
    image = _owned_image(user.id, data.get("image_id"))
    if data.get("image_id") not in (None, "") and not image:
        return jsonify(success=False, msg="Picture not found in your library."), 404
    if image and not ai.ai_available():
        return _image_analysis_error()
    if not reply_text and not image:
        return jsonify(success=False, msg="Write a reply or attach a picture.")
    save = get_or_create_save(user)
    inbox = save.investor_inbox()
    target = next((m for m in inbox if m["id"] == msg_id and m["status"] == "pending"), None)
    if not target:
        return jsonify(success=False, msg="Message not found or already answered.")
    client = next((c for c in CLIENT_BOTS if c["id"] == target["client_id"]), None)
    if not client:
        return jsonify(success=False, msg="Client no longer available.")

    save.mark_active()
    benefits = _apply_employee_benefits(save)
    result = ai.investor_inbox_reply(client, target["message"], reply_text, user.language,
                                     image_data_url=_image_data_url(image))
    invests = result["invests"]
    if invests and random.random() < benefits["investor_boost"]:
        pass
    if not invests and benefits["investor_boost"] > 0 and random.random() < benefits["investor_boost"]:
        invests = True
        result["reply"] += " (Your Client Relations team's follow-up sealed it.)"

    target["status"] = "replied"
    target["reply"] = result["reply"]
    target["invested"] = invests
    if image:
        target["reply_image"] = image.to_dict()

    if invests:
        commission = round(client["net_worth"] * 0.005 * (1 + benefits["commission_boost"]), 2)
        save.balance += commission
        save.weekly_commission += commission
        save.add_profit(commission)
        save.deals_closed += 1
        award_credits(user, "deal", commit=False)
        target["commission"] = commission

    save.set_investor_inbox(inbox)
    db.session.commit()
    log_event(f"{user.username} answered {client['name']}'s inbox message ({'invested' if invests else 'declined'}).")
    return jsonify(success=True, invests=invests, reply=result["reply"], balance=save.balance,
                    commission=target.get("commission", 0))


@app.route("/api/game/casino/games")
@login_required
def game_casino_games():
    save = get_or_create_save(current_user())
    return jsonify(success=True, games=CASINO_GAMES, balance=save.balance, stats=save.casino_stats())


@app.route("/api/game/casino/play", methods=["POST"])
@login_required
def game_casino_play():
    data = request.get_json(silent=True) or {}
    game = data.get("game")
    if game not in CASINO_GAMES:
        return jsonify(success=False, msg="Unknown game."), 404
    try:
        bet = float(data.get("bet", 0))
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid bet.")

    cfg = CASINO_GAMES[game]
    if bet < cfg["min_bet"] or bet > cfg["max_bet"]:
        return jsonify(success=False, msg=f"Bet must be between ${cfg['min_bet']} and ${cfg['max_bet']}.")

    user = current_user()
    save = get_or_create_save(user)
    if save.balance < bet:
        return jsonify(success=False, msg="Insufficient funds.")

    save.balance -= bet
    payout = 0.0
    detail = {}

    if game == "slots":
        reels = random.choices(SLOT_SYMBOLS, weights=SLOT_WEIGHTS, k=3)
        if reels[0] == reels[1] == reels[2]:
            payout = round(bet * SLOT_PAYOUTS.get(reels[0], 0), 2)
        elif len(set(reels)) == 2:
            payout = round(bet * 1.2, 2)
        detail = {"reels": reels}

    elif game == "coinflip":
        choice = data.get("choice") if data.get("choice") in ("heads", "tails") else "heads"
        result = random.choice(["heads", "tails"])
        won = result == choice
        payout = round(bet * cfg["payout"], 2) if won else 0.0
        detail = {"choice": choice, "result": result, "won": won}

    elif game == "dice":
        guess = data.get("guess")
        roll = random.randint(1, 6)
        won = (guess == "high" and roll >= 4) or (guess == "low" and roll <= 3)
        payout = round(bet * 1.9, 2) if won else 0.0
        detail = {"roll": roll, "guess": guess, "won": won}

    elif game == "blackjack_quick":
        def draw_total():
            total = random.randint(2, 21)
            return total
        player_total = draw_total()
        house_total = draw_total()
        player_bust = player_total > 21
        house_bust = house_total > 21
        if player_bust:
            won = False
        elif house_bust:
            won = True
        else:
            won = player_total > house_total
        push = (not player_bust and not house_bust and player_total == house_total)
        if push:
            payout = bet
        elif won:
            payout = round(bet * 1.95, 2)
        detail = {"player_total": player_total, "house_total": house_total, "won": won, "push": push}

    save.balance += payout
    stats = save.casino_stats()
    stats["wagered"] = round(stats.get("wagered", 0) + bet, 2)
    stats["won"] = round(stats.get("won", 0) + payout, 2)
    stats["hands"] = stats.get("hands", 0) + 1
    save.set_casino_stats(stats)
    db.session.commit()
    log_event(f"{save.name} played {game} for ${bet:.2f}, payout ${payout:.2f}.")
    return jsonify(success=True, payout=payout, net=round(payout - bet, 2), balance=save.balance, detail=detail)


@app.route("/api/game/gift_spouse", methods=["POST"])
@login_required
def game_gift_spouse():
    data = request.get_json(silent=True) or {}
    try:
        amount = max(0.0, float(data.get("amount", 0)))
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Invalid amount.")
    save = get_or_create_save(current_user())
    if not save.spouse:
        return jsonify(success=False, msg="You're not married.")
    if amount <= 0 or save.balance < amount:
        return jsonify(success=False, msg="Insufficient funds.")
    save.balance -= amount
    save.health = min(100, save.health + int(amount / 100))
    db.session.commit()
    log_event(f"{save.name} gifted {save.spouse} ${amount:.2f}.")
    return jsonify(success=True, balance=save.balance, health=save.health)


@app.route("/api/leaderboard")
@login_required
def leaderboard():
    rows = (
        db.session.query(User.username, GameSave)
        .join(GameSave, GameSave.user_id == User.id)
        .all()
    )
    scored = [
        {"username": username, "balance": save.balance, "job_title": save.job_title,
         "score": save.compute_score(), "job_status": save.job_status, "is_ai": False}
        for username, save in rows
    ]
    with state_lock:
        rival_equity = market_state["ai_rival"]["equity"]
    scored.append({
        "username": AI_RIVAL["name"], "balance": rival_equity, "job_title": AI_RIVAL["title"],
        "score": int(rival_equity), "job_status": "ai", "is_ai": True,
    })
    scored.sort(key=lambda r: r["score"], reverse=True)
    return jsonify(success=True, rows=scored[:20])




def get_active_room(user):
    room_id = session.get("coop_room_id")
    if not room_id:
        m = (CoopMembership.query.filter_by(user_id=user.id)
             .order_by(CoopMembership.id.desc()).first())
        if not m:
            return None
        room_id = m.room_id
        session["coop_room_id"] = room_id
    room = db.session.get(CoopRoom, room_id)
    if not room:
        return None
    member = CoopMembership.query.filter_by(room_id=room.id, user_id=user.id).first()
    return room if member else None


@app.route("/api/coop/create", methods=["POST"])
@login_required
def coop_create():
    user = current_user()
    data = request.get_json(silent=True) or {}
    firm_name = (data.get("firm_name") or f"{user.username}'s Syndicate")[:64]
    room = CoopRoom(firm_name=firm_name, owner_id=user.id)
    db.session.add(room)
    db.session.commit()
    db.session.add(CoopMembership(room_id=room.id, user_id=user.id))
    db.session.add(CoopLogEntry(room_id=room.id, username=user.username, message="founded the syndicate."))
    room.touch()
    db.session.commit()
    session["coop_room_id"] = room.id
    return jsonify(success=True, room_code=room.room_code, firm_name=room.firm_name)


@app.route("/api/coop/join", methods=["POST"])
@login_required
def coop_join():
    user = current_user()
    data = request.get_json(silent=True) or {}
    code = (data.get("room_code") or "").strip().upper()
    room = CoopRoom.query.filter_by(room_code=code).first()
    if not room:
        return jsonify(success=False, msg="No syndicate found with that code."), 404
    if CoopBan.query.filter_by(room_id=room.id, user_id=user.id).first():
        return jsonify(success=False, msg="You've been banned from that syndicate."), 403
    if not CoopMembership.query.filter_by(room_id=room.id, user_id=user.id).first():
        db.session.add(CoopMembership(room_id=room.id, user_id=user.id))
        db.session.add(CoopLogEntry(room_id=room.id, username=user.username, message="joined the syndicate."))
        room.touch()
        db.session.commit()
    session["coop_room_id"] = room.id
    return jsonify(success=True, room_code=room.room_code, firm_name=room.firm_name)


@app.route("/api/coop/leave", methods=["POST"])
@login_required
def coop_leave():
    user = current_user()
    room = get_active_room(user)
    session.pop("coop_room_id", None)
    if not room:
        return jsonify(success=True)

    membership = CoopMembership.query.filter_by(room_id=room.id, user_id=user.id).first()
    if membership:
        db.session.delete(membership)
        db.session.add(CoopLogEntry(room_id=room.id, username="SYSTEM",
                                     message=f"{user.username} left the syndicate."))

    if room.owner_id == user.id:
        heir = (CoopMembership.query
                .filter(CoopMembership.room_id == room.id, CoopMembership.user_id != user.id)
                .order_by(CoopMembership.id.asc()).first())
        if heir:
            room.owner_id = heir.user_id
            new_owner = db.session.get(User, heir.user_id)
            db.session.add(CoopLogEntry(
                room_id=room.id, username="SYSTEM",
                message=f"Ownership passed to {new_owner.username if new_owner else 'a member'}.",
            ))
        else:
            room.owner_id = None  
    room.touch()
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/coop/state")
@login_required
def coop_state():
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404
    members = [u.username for u in _coop_members(room)]
    logs = [e.to_dict() for e in
            CoopLogEntry.query.filter_by(room_id=room.id).order_by(CoopLogEntry.id.desc()).limit(30).all()]
    owner = db.session.get(User, room.owner_id) if room.owner_id else None
    banned = [u.username for u in
              db.session.query(User).join(CoopBan, CoopBan.user_id == User.id)
              .filter(CoopBan.room_id == room.id).all()]

    my_membership = CoopMembership.query.filter_by(room_id=room.id, user_id=user.id).first()
    if my_membership:
        my_membership.last_seen = datetime.utcnow()
        db.session.commit()
    now = datetime.utcnow()
    member_stats = []
    for m in CoopMembership.query.filter_by(room_id=room.id).all():
        mu = db.session.get(User, m.user_id)
        if not mu:
            continue
        online = bool(m.last_seen and (now - m.last_seen).total_seconds() < 120)
        member_stats.append({
            "username": mu.username, "online": online,
            "contribution": round(m.contribution or 0.0, 2),
        })

    payload = room.to_dict(members=members)
    payload["stocks"] = STOCKS
    payload["logs"] = logs
    payload["owner"] = owner.username if owner else None
    payload["is_owner"] = bool(owner and owner.id == user.id)
    payload["banned"] = banned
    payload["member_stats"] = member_stats
    payload["online_count"] = sum(1 for m in member_stats if m["online"])
    return jsonify(success=True, **payload)


@app.route("/api/coop/advance_day", methods=["POST"])
@login_required
def coop_advance_day():
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404

    room.day += 1
    if room.day % 7 == 0:
        room.week += 1
        hit_target = room.weekly_commission >= room.weekly_target
        room.balance -= room.weekly_bills

        sentiment = max(-100.0, min(100.0, room.sentiment or 0.0))
        swing = round(room.weekly_bills * (sentiment / 100.0) * 0.15, 2)
        if swing:
            room.balance += swing
            mood = "bullish" if swing > 0 else "bearish"
            db.session.add(CoopLogEntry(
                room_id=room.id, username="SYSTEM",
                message=f"Syndicate sentiment was {mood} ({sentiment:+.0f}) - bills adjusted ${swing:+.2f}.",
            ))
        room.sentiment = round(sentiment * 0.7, 1)

        room.weekly_target = round(room.weekly_target * 1.12, 2)
        room.weekly_bills = round(room.weekly_bills * 1.08, 2)
        room.weekly_commission = 0.0
        db.session.add(CoopLogEntry(
            room_id=room.id, username="SYSTEM",
            message=f"Week closed - {'target hit' if hit_target else 'target missed'}.",
        ))
    room.touch()
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/coop/trade_share", methods=["POST"])
@login_required
def coop_trade_share():
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404

    data = request.get_json(silent=True) or {}
    symbol = data.get("symbol")
    action = data.get("action")
    qty = max(1, int(data.get("qty", 1)))
    if symbol not in STOCKS:
        return jsonify(success=False, msg="Invalid stock symbol")

    price = STOCKS[symbol]["price"]
    total = round(price * qty, 2)
    shares = room.shares()

    if action == "buy":
        if room.balance < total:
            return jsonify(success=False, msg="Insufficient syndicate funds")
        room.balance -= total
        shares[symbol] = shares.get(symbol, 0) + qty
        note = f"bought {qty} {symbol} for ${total:.2f}"
        sentiment_nudge = total / 200.0
    elif action == "sell":
        if shares.get(symbol, 0) < qty:
            return jsonify(success=False, msg="Insufficient shares owned")
        shares[symbol] -= qty
        room.balance += total
        note = f"sold {qty} {symbol} for ${total:.2f}"
        sentiment_nudge = -total / 200.0
    else:
        return jsonify(success=False, msg="Unknown action")

    room.set_shares(shares)
    room.sentiment = round(max(-100.0, min(100.0, (room.sentiment or 0.0) + sentiment_nudge)), 1)
    membership = CoopMembership.query.filter_by(room_id=room.id, user_id=user.id).first()
    if membership:
        membership.contribution = round((membership.contribution or 0.0) + total, 2)
        membership.last_seen = datetime.utcnow()
    db.session.add(CoopLogEntry(room_id=room.id, username=user.username, message=note))
    room.touch()
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/coop/chat", methods=["POST"])
@login_required
def coop_chat():
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()[:255]
    if not message:
        return jsonify(success=False)
    db.session.add(CoopLogEntry(room_id=room.id, username=user.username, message=message))
    room.touch()
    db.session.commit()
    return jsonify(success=True)





def _order_book(symbol, price):
    rng = random.Random(f"{symbol}:{price:.2f}")
    tick = max(0.01, round(price * 0.0004, 2))
    rows = []
    for i in range(1, 6):
        rows.append({
            "bid": round(price - tick * i, 2),
            "bid_size": rng.randint(50, 4000),
            "ask": round(price + tick * i, 2),
            "ask_size": rng.randint(50, 4000),
        })
    return rows


def _stock_headlines(symbol, stock):
    name = stock["name"]
    with state_lock:
        logs = list(market_state["global_logs"])
    hits = [l.split("MARKET NEWS: ", 1)[1] for l in reversed(logs)
            if "MARKET NEWS:" in l and name in l][:4]
    rng = random.Random(f"{symbol}:headlines")
    filler = [
        f"{name} holds an investor call; management reiterates guidance.",
        f"Analysts split on {name} after the latest {stock['sector'].lower()} print.",
        f"{name} names a new head of operations.",
        f"Sector rotation leaves {stock['sector'].lower()} names choppy.",
        f"{name} buyback program continues at a measured pace.",
    ]
    rng.shuffle(filler)
    return (hits + filler)[:5]


@app.route("/api/game/stock/<symbol>")
@login_required
def game_stock_detail(symbol):
    symbol = (symbol or "").upper()
    if symbol not in STOCKS:
        return jsonify(success=False, msg="Unknown ticker."), 404

    stock = STOCKS[symbol]
    user = current_user()
    save = get_or_create_save(user)

    with state_lock:
        price = stock["price"]
        open_price = stock.get("open") or price
        history = list(PRICE_HISTORY.get(symbol) or [])

    if len(history) < 2:
        history = [open_price, price]

    change = round(price - open_price, 2)
    change_pct = round((change / open_price) * 100, 2) if open_price else 0.0
    owned = int(save.shares().get(symbol, 0))
    balance = round(save.balance or 0.0, 2)

    return jsonify(
        success=True,
        stock={
            "symbol": symbol, "name": stock["name"], "sector": stock["sector"],
            "price": round(price, 2), "open": round(open_price, 2),
            "change": change, "change_pct": change_pct,
        },
        profile={
            "ceo": stock.get("ceo"), "founded": stock.get("founded"),
            "employees": stock.get("employees"), "hq": stock.get("hq"),
            "pe": stock.get("pe"), "dividend": stock.get("dividend"),
            "desc": stock.get("desc", ""),
        },
        history=[round(p, 2) for p in history[-120:]],
        book=_order_book(symbol, price),
        headlines=_stock_headlines(symbol, stock),
        balance=balance,
        owned=owned,
        position_value=round(price * owned, 2),
        max_affordable=int(balance // price) if price > 0 else 0,
    )


@app.route("/api/game/stock/<symbol>/quote")
@login_required
def game_stock_quote(symbol):
    symbol = (symbol or "").upper()
    if symbol not in STOCKS:
        return jsonify(success=False), 404
    stock = STOCKS[symbol]
    with state_lock:
        price = stock["price"]
        open_price = stock.get("open") or price
        history = list(PRICE_HISTORY.get(symbol) or [])
    change = round(price - open_price, 2)
    return jsonify(
        success=True, price=round(price, 2), change=change,
        change_pct=round((change / open_price) * 100, 2) if open_price else 0.0,
        history=[round(p, 2) for p in history[-120:]],
    )




@app.route("/api/credits")
@login_required
def credits_state():
    user = current_user()
    owned = set(user.unlocked_frames()) | {f["id"] for f in FRAMES if not f.get("cost")}
    ledger = (CreditLedger.query.filter_by(user_id=user.id)
              .order_by(CreditLedger.id.desc()).limit(40).all())
    save = get_or_create_save(user)
    buyable_avatars = [
        dict(a, owned=a["id"] in user.unlocked_avatars())
        for a in AVATAR_PRESETS if a.get("unlock") == "credits"
    ]
    return jsonify(
        success=True,
        credits=user.credits or 0,
        earned_total=user.credits_earned_total or 0,
        frames=[dict(f, owned=f["id"] in owned) for f in FRAMES],
        avatars=buyable_avatars,
        sinks=CREDIT_SINKS,
        custom_title=user.custom_title or "",
        rank=_operator_title(save.compute_score()),
        rules=[{"reason": r["reason"], "amount": r["amount"]} for r in CREDIT_RULES.values()],
        ledger=[e.to_dict() for e in ledger],
        active_frame=user.avatar_frame or "none",
        active_avatar=user.avatar_glyph or "chip",
    )


@app.route("/api/credits/buy_avatar", methods=["POST"])
@login_required
def credits_buy_avatar():
    data = request.get_json(silent=True) or {}
    user = current_user()
    preset = next((a for a in AVATAR_PRESETS
                   if a["id"] == data.get("avatar_id") and a.get("unlock") == "credits"), None)
    if not preset:
        return jsonify(success=False, msg="That emblem isn't for sale."), 400
    if preset["id"] in user.unlocked_avatars():
        return jsonify(success=False, msg="You already own that emblem.")
    cost = int(preset.get("cost") or 0)
    if (user.credits or 0) < cost:
        return jsonify(success=False, msg=f"Not enough credits - {preset['name']} costs {cost}.")

    user.credits = (user.credits or 0) - cost
    user.unlock_avatar(preset["id"])
    db.session.add(CreditLedger(user_id=user.id, amount=-cost,
                                reason=f"Unlocked emblem: {preset['name']}"))
    db.session.commit()
    return jsonify(success=True, msg=f"{preset['name']} unlocked.", credits=user.credits)


@app.route("/api/credits/buy_title", methods=["POST"])
@login_required
def credits_buy_title():
    data = request.get_json(silent=True) or {}
    user = current_user()
    title = re.sub(r"\s+", " ", (data.get("title") or "")).strip()[:32]
    sink = CREDIT_SINKS["custom_title"]

    if not title:
        if not user.custom_title:
            return jsonify(success=False, msg="Type a title first.")
        user.custom_title = None      
        db.session.commit()
        return jsonify(success=True, msg="Custom title cleared - back to your earned rank.")

    if user.custom_title:             
        user.custom_title = title
        db.session.commit()
        return jsonify(success=True, msg="Title updated.", credits=user.credits or 0)

    cost = int(sink["cost"])
    if (user.credits or 0) < cost:
        return jsonify(success=False, msg=f"Not enough credits - a custom title costs {cost}.")
    user.credits = (user.credits or 0) - cost
    user.custom_title = title
    db.session.add(CreditLedger(user_id=user.id, amount=-cost, reason="Custom operator title"))
    db.session.commit()
    return jsonify(success=True, msg="Title set. Renaming it later is free.", credits=user.credits)


@app.route("/api/credits/buy_frame", methods=["POST"])
@login_required
def credits_buy_frame():
    data = request.get_json(silent=True) or {}
    user = current_user()
    frame = next((f for f in FRAMES if f["id"] == data.get("frame_id")), None)
    if not frame:
        return jsonify(success=False, msg="Unknown frame."), 400
    cost = int(frame.get("cost") or 0)
    if not cost:
        return jsonify(success=False, msg="That frame is already free to use.")
    if frame["id"] in user.unlocked_frames():
        return jsonify(success=False, msg="You already own that frame.")
    if (user.credits or 0) < cost:
        return jsonify(success=False, msg=f"Not enough credits - {frame['name']} costs {cost}.")

    user.credits = (user.credits or 0) - cost
    user.unlock_frame(frame["id"])
    db.session.add(CreditLedger(user_id=user.id, amount=-cost,
                                reason=f"Unlocked frame: {frame['name']}"))
    db.session.commit()
    return jsonify(success=True, msg=f"{frame['name']} unlocked.", credits=user.credits)


@app.route("/api/credits/buy_sink", methods=["POST"])
@login_required
def credits_buy_sink():
    data = request.get_json(silent=True) or {}
    sink_id = data.get("sink_id")
    sink = CREDIT_SINKS.get(sink_id)
    if not sink or sink_id not in ("priority_execution", "sentiment_boost", "rival_taunt"):
        return jsonify(success=False, msg="Unknown item."), 400
    user = current_user()
    cost = int(sink["cost"])
    if (user.credits or 0) < cost:
        return jsonify(success=False, msg=f"Not enough credits - {sink['name']} costs {cost}.")

    if sink_id == "sentiment_boost":
        room = get_active_room(user)
        if not room:
            return jsonify(success=False, msg="Join a syndicate first.")
        room.sentiment = round(max(-100.0, min(100.0, (room.sentiment or 0.0) + 15)), 1)
        db.session.add(CoopLogEntry(room_id=room.id, username="SYSTEM",
                                    message=f"{user.username} spent credits on a sentiment boost (+15)."))
        msg = "Sentiment boosted +15."
    elif sink_id == "rival_taunt":
        line = re.sub(r"\s+", " ", (data.get("text") or "")).strip()[:120] or "You're just a model."
        log_event(f"[{user.username} -> OMNI-QUANT] {line}")
        msg = "Taunt sent. OMNI-QUANT did not react."
    else:
        msg = "Priority execution active for 7 days."

    user.credits = (user.credits or 0) - cost
    db.session.add(CreditLedger(user_id=user.id, amount=-cost, reason=sink["name"]))
    db.session.commit()
    return jsonify(success=True, msg=msg, credits=user.credits, sink_id=sink_id)


MAX_ATTACHMENT_BYTES = 256 * 1024


@app.route("/api/messages/attach", methods=["POST"])
@login_required
def messages_attach():
    data = request.get_json(silent=True) or {}
    user = current_user()

    target = find_user((data.get("to") or "").strip())
    if not target:
        return jsonify(success=False, msg="No operator with that username."), 404
    if target.id == user.id:
        return jsonify(success=False, msg="You can't message yourself."), 400

    filename = re.sub(r"[^\w.\- ]", "_", str(data.get("filename") or "file")[:256])[:128]
    mime = (data.get("mime") or "application/octet-stream")[:64]
    payload_b64 = data.get("data") or ""
    encrypt = bool(data.get("encrypt"))
    pin = str(data.get("pin", ""))
    caption = (data.get("body") or "").strip()[:2000]

    if not isinstance(payload_b64, str) or len(payload_b64) > (MAX_ATTACHMENT_BYTES * 4 // 3 + 4):
        return jsonify(success=False, msg="Attachments are capped at 256 KB in this build."), 413
    try:
        raw = base64.b64decode(payload_b64, validate=True)
    except (ValueError, TypeError):
        return jsonify(success=False, msg="Attachment payload was not valid base64.")
    if not raw:
        return jsonify(success=False, msg="That file is empty.")
    if len(raw) > MAX_ATTACHMENT_BYTES:
        return jsonify(success=False, msg="Attachments are capped at 256 KB in this build.")

    salt = None
    if encrypt:
        if not vault.valid_pin_format(pin):
            return jsonify(success=False,
                           msg="Encrypted attachments need a 4-8 digit PIN - pick one and share "
                               "it with them however you trust.")
        salt = vault.new_salt()
       
        stored = vault.encrypt(pin, salt, base64.b64encode(raw).decode())
    else:
        stored = base64.b64encode(raw).decode()

    msg = DirectMessage(
        sender_id=user.id, recipient_id=target.id,
        body=caption or f"[file] {filename}",
        encrypted=False,
    )
    db.session.add(msg)
    db.session.flush()
    db.session.add(DMAttachment(
        message_id=msg.id, filename=filename, mime=mime, size_bytes=len(raw),
        encrypted=bool(encrypt), salt=salt, payload=stored,
    ))
    db.session.commit()
    return jsonify(success=True, message=msg.to_dict(user.id))


@app.route("/api/messages/attachment/<int:att_id>", methods=["POST"])
@login_required
def messages_attachment_fetch(att_id):
    data = request.get_json(silent=True) or {}
    user = current_user()
    att = db.session.get(DMAttachment, att_id)
    if not att:
        return jsonify(success=False, msg="Attachment not found."), 404
    msg = att.message
    if not msg or user.id not in (msg.sender_id, msg.recipient_id):
        return jsonify(success=False, msg="Attachment not found."), 404

    if not att.encrypted:
        return jsonify(success=True, filename=att.filename, mime=att.mime, data=att.payload)

    plain_b64 = vault.decrypt(str(data.get("pin", "")), att.salt, att.payload)
    if plain_b64 is None:
        return jsonify(success=False, msg="Wrong PIN, or the file was tampered with.")
    return jsonify(success=True, filename=att.filename, mime=att.mime, data=plain_b64)


@app.route("/api/messages/attachment/<int:att_id>/content")
@login_required
def messages_attachment_image_content(att_id):
    user = current_user()
    attachment = db.session.get(DMAttachment, att_id)
    message = attachment.message if attachment else None
    if (
        not attachment or not message
        or user.id not in (message.sender_id, message.recipient_id)
        or attachment.encrypted
        or attachment.mime not in SAVED_IMAGE_TYPES
    ):
        return jsonify(success=False, msg="Picture not found."), 404
    try:
        raw = base64.b64decode(attachment.payload, validate=True)
    except (ValueError, TypeError):
        return jsonify(success=False, msg="Picture data is unavailable."), 500
    if not _valid_image_bytes(attachment.mime, raw):
        return jsonify(success=False, msg="Picture data is unavailable."), 500
    return Response(raw, mimetype=attachment.mime, headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })




def _clean_share_map(raw):
    out = {}
    for sym, qty in (raw or {}).items():
        sym = str(sym).upper()
        if sym not in STOCKS:
            continue
        try:
            n = int(qty)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out[sym] = n
    return out


def _slice_offer(fraction, cash, shares):
    cash = round((cash or 0.0) * fraction, 2)
    shares = {k: int(v * fraction) for k, v in (shares or {}).items()}
    return cash, {k: v for k, v in shares.items() if v > 0}


def _offer_counterparty(offer, viewer_id):
    other_id = offer.to_user_id if offer.from_user_id == viewer_id else offer.from_user_id
    other = db.session.get(User, other_id)
    return other.username if other else "unknown"


def _get_draft(user_id, target_id, create=False):
    draft = TradeOffer.query.filter_by(
        from_user_id=user_id, to_user_id=target_id, status="draft").first()
    if draft is None and create:
        draft = TradeOffer(from_user_id=user_id, to_user_id=target_id, status="draft")
        db.session.add(draft)
    return draft


def _can_cover(save, cash, shares):
    if cash and (save.balance or 0.0) + 1e-9 < cash:
        return f"short ${cash - (save.balance or 0.0):,.2f} in cash"
    held = save.shares()
    for sym, qty in shares.items():
        if int(held.get(sym, 0)) < qty:
            return f"short {qty - int(held.get(sym, 0))} {sym}"
    return None


@app.route("/api/exchange/state")
@login_required
def exchange_state():
    user = current_user()
    save = get_or_create_save(user)

    rows = Friendship.query.filter(
        db.and_(
            Friendship.status == "accepted",
            db.or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id),
        )
    ).all()
    friends = []
    for f in rows:
        other_id = f.addressee_id if f.requester_id == user.id else f.requester_id
        other = db.session.get(User, other_id)
        if other:
            friends.append(other.username)
    friends.sort()

    incoming = TradeOffer.query.filter_by(to_user_id=user.id, status="pending").order_by(TradeOffer.id.desc()).all()
    outgoing = TradeOffer.query.filter_by(from_user_id=user.id, status="pending").order_by(TradeOffer.id.desc()).all()
    history = (TradeOffer.query
               .filter(TradeOffer.status.in_(["accepted", "declined", "cancelled", "countered"]))
               .filter(db.or_(TradeOffer.from_user_id == user.id, TradeOffer.to_user_id == user.id))
               .order_by(TradeOffer.id.desc()).limit(10).all())

    draft = None
    with_user = (request.args.get("with") or "").strip()
    if with_user:
        target = find_user(with_user)
        if target:
            d = _get_draft(user.id, target.id)
            if d:
                draft = d.to_dict(user.id, counterparty=target.username)

    prices = {sym: round(s["price"], 2) for sym, s in STOCKS.items()}
    return jsonify(
        success=True,
        friends=friends,
        balance=round(save.balance or 0.0, 2),
        shares=save.shares(),
        prices=prices,
        draft=draft,
        incoming=[o.to_dict(user.id, _offer_counterparty(o, user.id)) for o in incoming],
        outgoing=[o.to_dict(user.id, _offer_counterparty(o, user.id)) for o in outgoing],
        history=[dict(o.to_dict(user.id, _offer_counterparty(o, user.id)),
                      resolved_at=o.resolved_at.strftime("%Y-%m-%d %H:%M") if o.resolved_at else None)
                 for o in history],
    )


@app.route("/api/exchange/draft", methods=["POST"])
@login_required
def exchange_draft():
    data = request.get_json(silent=True) or {}
    user = current_user()
    target = find_user((data.get("to") or "").strip())
    if not target or not _are_friends(user.id, target.id):
        return jsonify(success=False, msg="You can only trade with a friend."), 403

    draft = _get_draft(user.id, target.id, create=True)
    try:
        draft.offer_cash = max(0.0, round(float(data.get("offer_cash") or 0), 2))
        draft.want_cash = max(0.0, round(float(data.get("want_cash") or 0), 2))
    except (TypeError, ValueError):
        return jsonify(success=False, msg="Cash amounts have to be numbers.")
    draft.set_offer_shares(_clean_share_map(data.get("offer_shares")))
    draft.set_want_shares(_clean_share_map(data.get("want_shares")))
    if "allow_partial" in data:
        draft.allow_partial = bool(data.get("allow_partial"))
    if "note" in data:
        draft.note = (data.get("note") or "")[:1000] or None
        draft.note_encrypted = False
        draft.note_salt = None
    db.session.commit()
    return jsonify(success=True, draft=draft.to_dict(user.id, counterparty=target.username))


@app.route("/api/exchange/send", methods=["POST"])
@login_required
def exchange_send():
    data = request.get_json(silent=True) or {}
    user = current_user()
    save = get_or_create_save(user)
    target = find_user((data.get("to") or "").strip())
    if not target or not _are_friends(user.id, target.id):
        return jsonify(success=False, msg="You can only trade with a friend."), 403

    draft = _get_draft(user.id, target.id)
    if not draft or draft.is_empty():
        return jsonify(success=False, msg="Stage something on at least one side of the trade first.")

    problem = _can_cover(save, draft.offer_cash or 0.0, draft.offer_shares())
    if problem:
        return jsonify(success=False, msg=f"You can't cover your own side - {problem}.")

    if TradeOffer.query.filter_by(from_user_id=user.id, to_user_id=target.id, status="pending").count() >= 3:
        return jsonify(success=False, msg="You already have three offers pending with that operator.")

    note_pin = str(data.get("note_pin", ""))
    if draft.note and note_pin:
        if not vault.valid_pin_format(note_pin):
            return jsonify(success=False, msg="A memo PIN has to be 4-8 digits.")
        salt = vault.new_salt()
        draft.note = vault.encrypt(note_pin, salt, draft.note)
        draft.note_encrypted = True
        draft.note_salt = salt

    draft.status = "pending"
    db.session.commit()
    log_event(f"{user.username} sent an exchange offer to {target.username}.")
    return jsonify(success=True, msg=f"Offer sent to {target.username}.",
                   offer=draft.to_dict(user.id, counterparty=target.username))


@app.route("/api/exchange/note", methods=["POST"])
@login_required
def exchange_note():
    data = request.get_json(silent=True) or {}
    user = current_user()
    offer = db.session.get(TradeOffer, data.get("id"))
    if not offer or user.id not in (offer.from_user_id, offer.to_user_id):
        return jsonify(success=False, msg="Offer not found."), 404
    if not offer.note:
        return jsonify(success=False, msg="No memo on this offer.")
    if not offer.note_encrypted:
        return jsonify(success=True, note=offer.note)
    plaintext = vault.decrypt(str(data.get("pin", "")), offer.note_salt, offer.note)
    if plaintext is None:
        return jsonify(success=False, msg="Wrong PIN, or the memo is corrupted.")
    return jsonify(success=True, note=plaintext)


@app.route("/api/exchange/cancel", methods=["POST"])
@login_required
def exchange_cancel():
    data = request.get_json(silent=True) or {}
    user = current_user()
    offer = db.session.get(TradeOffer, data.get("id"))
    if not offer or offer.from_user_id != user.id or offer.status != "pending":
        return jsonify(success=False, msg="Offer not found."), 404
    offer.status = "cancelled"
    offer.resolved_at = datetime.utcnow()
    db.session.commit()
    return jsonify(success=True, msg="Offer withdrawn.")


@app.route("/api/exchange/respond", methods=["POST"])
@login_required
def exchange_respond():
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    user = current_user()
    offer = db.session.get(TradeOffer, data.get("id"))
    if not offer or offer.to_user_id != user.id or offer.status != "pending":
        return jsonify(success=False, msg="Offer not found."), 404

    sender = db.session.get(User, offer.from_user_id)
    if not sender:
        return jsonify(success=False, msg="The other operator's account is gone."), 404

    if action == "decline":
        offer.status = "declined"
        offer.decline_reason = (data.get("reason") or "")[:160] or None
        offer.resolved_at = datetime.utcnow()
        db.session.commit()
        return jsonify(success=True, msg="Offer declined.")

    if action != "accept":
        return jsonify(success=False, msg="Unknown action.")

    my_save = get_or_create_save(user)
    their_save = get_or_create_save(sender)


    try:
        fraction = float(data.get("fraction") or 1)
    except (TypeError, ValueError):
        fraction = 1.0
    fraction = max(0.05, min(1.0, fraction))
    partial = fraction < 1.0
    if partial and not offer.allow_partial:
        return jsonify(success=False, msg="This offer has to be taken in full.")

    full_offer_shares = offer.offer_shares()
    full_want_shares = offer.want_shares()

    if partial:
        offer_cash, offer_shares = _slice_offer(fraction, offer.offer_cash, full_offer_shares)
        want_cash, want_shares = _slice_offer(fraction, offer.want_cash, full_want_shares)
        if not offer_cash and not want_cash and not offer_shares and not want_shares:
            return jsonify(success=False,
                           msg="That slice rounds down to nothing - take a bigger share of it.")
    else:
        offer_shares = full_offer_shares
        want_shares = full_want_shares
        offer_cash = round(offer.offer_cash or 0.0, 2)
        want_cash = round(offer.want_cash or 0.0, 2)


    problem = _can_cover(their_save, offer_cash, offer_shares)
    if problem:
        return jsonify(success=False,
                       msg=f"{sender.username} can no longer cover their side ({problem}). "
                           f"The offer is stale - ask them to re-send it.")
    problem = _can_cover(my_save, want_cash, want_shares)
    if problem:
        return jsonify(success=False, msg=f"You can't cover your side - {problem}.")

    mine = my_save.shares()
    theirs = their_save.shares()

    their_save.balance = round((their_save.balance or 0.0) - offer_cash + want_cash, 2)
    my_save.balance = round((my_save.balance or 0.0) + offer_cash - want_cash, 2)

    for sym, qty in offer_shares.items():
        theirs[sym] = int(theirs.get(sym, 0)) - qty
        mine[sym] = int(mine.get(sym, 0)) + qty
    for sym, qty in want_shares.items():
        mine[sym] = int(mine.get(sym, 0)) - qty
        theirs[sym] = int(theirs.get(sym, 0)) + qty

    my_save.set_shares({k: v for k, v in mine.items() if v > 0})
    their_save.set_shares({k: v for k, v in theirs.items() if v > 0})
    my_save.trades_count += 1
    their_save.trades_count += 1
    my_save.mark_active()
    their_save.mark_active()

    offer.fills = (offer.fills or 0) + 1
    if partial:

        offer.offer_cash = round((offer.offer_cash or 0.0) - offer_cash, 2)
        offer.want_cash = round((offer.want_cash or 0.0) - want_cash, 2)
        offer.set_offer_shares({k: v - offer_shares.get(k, 0) for k, v in full_offer_shares.items()})
        offer.set_want_shares({k: v - want_shares.get(k, 0) for k, v in full_want_shares.items()})
        if offer.is_empty():
            offer.status = "accepted"
            offer.resolved_at = datetime.utcnow()
    else:
        offer.status = "accepted"
        offer.resolved_at = datetime.utcnow()

    award_credits(user, "trade_p2p", commit=False)
    award_credits(sender, "trade_p2p", commit=False)
    db.session.commit()

    summary = _describe_offer(offer_cash, offer_shares, want_cash, want_shares)
    log_event(f"Exchange settled: {sender.username} <-> {user.username} ({summary}).")
    return jsonify(success=True,
                    msg="Trade settled." + (" Remainder left standing." if offer.status == "pending" else ""),
                    summary=summary, remaining=offer.status == "pending")


@app.route("/api/exchange/counter", methods=["POST"])
@login_required
def exchange_counter():
    data = request.get_json(silent=True) or {}
    user = current_user()
    offer = db.session.get(TradeOffer, data.get("id"))
    if not offer or offer.to_user_id != user.id or offer.status != "pending":
        return jsonify(success=False, msg="Offer not found."), 404

    sender = db.session.get(User, offer.from_user_id)
    if not sender:
        return jsonify(success=False, msg="The other operator's account is gone."), 404

    draft = _get_draft(user.id, sender.id, create=True)
    draft.offer_cash = offer.want_cash or 0.0     
    draft.want_cash = offer.offer_cash or 0.0
    draft.set_offer_shares(offer.want_shares())
    draft.set_want_shares(offer.offer_shares())
    draft.allow_partial = bool(offer.allow_partial)
    draft.counter_to_id = offer.id
    draft.note = None
    draft.note_encrypted = False
    draft.note_salt = None

    offer.status = "countered"
    offer.resolved_at = datetime.utcnow()
    db.session.commit()
    return jsonify(success=True, msg=f"Loaded as a counter to {sender.username}'s offer - edit and send.",
                    counterparty=sender.username,
                    draft=draft.to_dict(user.id, counterparty=sender.username))


def _describe_offer(offer_cash, offer_shares, want_cash, want_shares):
    def side(cash, shares):
        bits = []
        if cash:
            bits.append(f"${cash:,.2f}")
        bits += [f"{q} {s}" for s, q in sorted(shares.items())]
        return " + ".join(bits) or "nothing"
    return f"{side(offer_cash, offer_shares)} for {side(want_cash, want_shares)}"




def _coop_members(room):
    return (db.session.query(User)
            .join(CoopMembership, CoopMembership.user_id == User.id)
            .filter(CoopMembership.room_id == room.id)
            .order_by(CoopMembership.id.asc()).all())


@app.route("/api/coop/kick", methods=["POST"])
@login_required
def coop_kick():
    data = request.get_json(silent=True) or {}
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404
    if room.owner_id != user.id:
        return jsonify(success=False, msg="Only the founder can remove members."), 403

    target = find_user((data.get("username") or "").strip())
    if not target or target.id == user.id:
        return jsonify(success=False, msg="Pick another member.")
    membership = CoopMembership.query.filter_by(room_id=room.id, user_id=target.id).first()
    if not membership:
        return jsonify(success=False, msg="That operator isn't in this syndicate.")

    db.session.delete(membership)
    banned = bool(data.get("ban"))
    if banned and not CoopBan.query.filter_by(room_id=room.id, user_id=target.id).first():
        db.session.add(CoopBan(room_id=room.id, user_id=target.id, banned_by=user.username))
    db.session.add(CoopLogEntry(
        room_id=room.id, username="SYSTEM",
        message=f"{target.username} was {'banned' if banned else 'removed'} by {user.username}.",
    ))
    room.touch()
    db.session.commit()
    return jsonify(success=True, msg=f"{target.username} {'banned' if banned else 'removed'}.")


@app.route("/api/coop/unban", methods=["POST"])
@login_required
def coop_unban():
    data = request.get_json(silent=True) or {}
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404
    if room.owner_id != user.id:
        return jsonify(success=False, msg="Only the founder can lift a ban."), 403
    target = find_user((data.get("username") or "").strip())
    ban = CoopBan.query.filter_by(room_id=room.id, user_id=target.id).first() if target else None
    if not ban:
        return jsonify(success=False, msg="No ban on that operator.")
    db.session.delete(ban)
    db.session.commit()
    return jsonify(success=True, msg=f"{target.username} can rejoin with the room code.")


@app.route("/api/coop/transfer", methods=["POST"])
@login_required
def coop_transfer():
    data = request.get_json(silent=True) or {}
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404
    if room.owner_id != user.id:
        return jsonify(success=False, msg="Only the founder can hand over ownership."), 403

    target = find_user((data.get("username") or "").strip())
    if not target or target.id == user.id:
        return jsonify(success=False, msg="Pick another member.")
    if not CoopMembership.query.filter_by(room_id=room.id, user_id=target.id).first():
        return jsonify(success=False, msg="That operator isn't in this syndicate.")

    room.owner_id = target.id
    db.session.add(CoopLogEntry(
        room_id=room.id, username="SYSTEM",
        message=f"{user.username} handed the syndicate over to {target.username}.",
    ))
    room.touch()
    db.session.commit()
    return jsonify(success=True, msg=f"{target.username} now runs the syndicate.")



COOP_POLL_TIMEOUT = float(os.environ.get("COOP_POLL_TIMEOUT", "0"))
COOP_POLL_INTERVAL = 0.6


@app.route("/api/coop/poll")
@login_required
def coop_poll():
    user = current_user()
    room = get_active_room(user)
    if not room:
        return jsonify(success=False, msg="Not in a syndicate."), 404

    try:
        since = int(request.args.get("since") or 0)
    except (TypeError, ValueError):
        since = 0

    room_id = room.id
    deadline = time.time() + COOP_POLL_TIMEOUT
    while True:
        revision = db.session.query(CoopRoom.revision).filter(CoopRoom.id == room_id).scalar()
        if revision is None:
            return jsonify(success=False, msg="That syndicate is gone."), 404
        if revision != since:
            return jsonify(success=True, revision=revision, changed=True)
        db.session.rollback()
        if time.time() >= deadline:
  
            return jsonify(success=True, revision=revision, changed=False)
        time.sleep(COOP_POLL_INTERVAL)


from world import init_world
import world
from economy import init_economy, cpi
from city_travel import init_city
init_city(app, login_required, current_user, get_or_create_save)
init_world(app, login_required, admin_required, current_user, get_or_create_save,
           market_state, price_index=cpi)
init_economy(app, login_required, current_user, get_or_create_save,
             extra_fee=lambda: world._rules()[1]["trade_fee"])

from roles import init_roles
init_roles(app, login_required, current_user, get_or_create_save, price_index=cpi)
from learn import init_learn
init_learn(app, login_required, current_user, get_or_create_save, price_index=cpi)

from desk import init_desk
init_desk(app, login_required, current_user, get_or_create_save, STOCKS, PRICE_HISTORY,
          price_index=cpi, log_event=log_event)
from mail_privacy import init_mail_privacy
init_mail_privacy(app, login_required, current_user, get_or_create_save, price_index=cpi,
                   log_event=log_event)

from astra_net import init_net
init_net(app, login_required, current_user)
integrity.init_app(app)


@app.route("/manifest.webmanifest")
def pwa_manifest():
    resp = jsonify(
        name="Astra - Salaryman", short_name="Astra",
        description="Brokerage career sim - multiplayer.",
        start_url="/intro", scope="/", display="standalone",
        background_color="#000000", theme_color="#00ffcc",
        icons=[
            {"src": "/static/img/astra_icon_192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/astra_icon_512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/astra_icon_maskable_512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    )
    resp.headers["Content-Type"] = "application/manifest+json"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/sw.js")
def pwa_service_worker():
    resp = app.send_static_file("astra_sw.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


if __name__ == '__main__':
    app.run(host=os.environ.get("HOST", "127.0.0.1"),
            port=int(os.environ.get("PORT", "3000")),
            debug=os.environ.get("FLASK_DEBUG", "1") == "1",
            threaded=True)