"""economy.py - Astra's market layer: 5 stocks, 4 currencies, fees, inflation.

Wire in AFTER init_world():

    from economy import init_economy, cpi
    import world
    init_economy(app, login_required, current_user, get_or_create_save,
                 extra_fee=lambda: world._rules()[1]["trade_fee"])

Inspired by tycoon-style stock games: every stock has a small finite pool of
available shares, a dividend countdown, and your buy average next to the live
price. On top of that:

  * FEES     - every trade pays a percentage fee (min 1 unit) plus the current
               regime's trade levy; currency conversion pays a 1% spread. Fees
               are destroyed (a money sink that fights inflation).
  * CURRENCY - ASD is the home currency and IS GameSave.balance, so the rest of
               the game keeps working untouched. VLT / KRN / DRX live in a
               wallet table. Each stock is priced in its own currency, so to buy
               it you must convert first (and pay the spread).
  * INFLATION- each currency has its own daily inflation (tapering over time). A currency's exchange
               rate drifts down as its inflation outruns ASD's, and the ASD
               price index cpi() rises, which world.py applies to bail, app
               prices, etc. Stocks partially hedge (beta 0.8) so holding shares
               beats holding cash - but only if you beat the fees.

Scale notes: prices and FX are PURE FUNCTIONS OF TIME (seeded sine mixes +
hash jitter), so every worker process agrees with zero shared state and there
is no tick thread to keep alive. The only mutable market state is the
`stock_state.available` counter, changed by atomic conditional UPDATEs.
"""
import hashlib
import math
import os
import time
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError

from models import db, GameSave, User
from astra_net import find_user

HOME = "ASD"
STEP_S = 30                     # one price step
# Launch date of THIS server's economy (set ECON_EPOCH=YYYY-MM-DD in .env; prices
# are at their listed base on that day). Changing it later re-prices everything.
ECON_EPOCH = datetime.fromisoformat(os.environ.get("ECON_EPOCH", "2026-09-28")).timestamp()
INFLATION_TAPER_DAYS = 30       # inflation rate halves by day 30, thirds by day 60 ...
TRADE_FEE_PCT = 0.005
TRADE_FEE_MIN = 1.0
CONVERT_SPREAD = 0.01
MAX_TRADE = 1000
DIV_CATCHUP_CAP = 48            # max unclaimed dividend intervals that accrue
STOCK_BETA = 0.8                # how much of local-currency inflation stocks track
SCARCITY_PREMIUM = 0.5          # price is up to +50% when the pool is empty
SEND_FEE_PCT = 0.01             # player-to-player transfers
SEND_FEE_MIN = 0.5
SEND_LIMIT_ASD = 25000.0        # rolling 24h, in ASD-equivalent, scaled by the price index
SAVINGS_CAP_ASD = 50000.0       # per currency, ASD-equivalent (savings interest is new money; cap the printing)
WITHDRAW_FEE_PCT = 0.005
# Daily savings interest. Compare with CURRENCIES[*]['infl']: ASD/KRN/DRX savings LOSE to inflation
# early on, VLT (the hard currency) gains. Picking where to park cash is the game.
SAVINGS_RATE = {"ASD": 0.010, "VLT": 0.006, "KRN": 0.030, "DRX": 0.010}

CURRENCIES = {
    #        base rate in ASD, daily inflation, FX wobble
    "ASD": dict(name="Astra Dollar", rate=1.00, infl=0.020, wobble=0.00),
    "VLT": dict(name="Volta Credit", rate=1.80, infl=0.005, wobble=0.06),
    "KRN": dict(name="Kron",         rate=0.12, infl=0.060, wobble=0.10),
    "DRX": dict(name="Drax Mark",    rate=0.55, infl=0.015, wobble=0.05),
}

STOCKS = {
    "QUIK": dict(name="Quik Logistics", cur="ASD", base=9.77, vol=0.22, float=2000, yld=0.004, div_s=600),
    "NOVA": dict(name="Nova Grid",      cur="ASD", base=42.0, vol=0.15, float=800,  yld=0.003, div_s=900),
    "VOLT": dict(name="Volt Freight",   cur="VLT", base=15.5, vol=0.28, float=1500, yld=0.006, div_s=600),
    "KRON": dict(name="Kron Mining",    cur="KRN", base=120., vol=0.35, float=600,  yld=0.010, div_s=1200),
    "DRAX": dict(name="Drax Pharma",    cur="DRX", base=28.0, vol=0.18, float=1000, yld=0.005, div_s=900),
}


# ---- models ----------------------------------------------------------------
class Wallet(db.Model):
    __tablename__ = "wallets"
    user_id = db.Column(db.Integer, primary_key=True)
    currency = db.Column(db.String(4), primary_key=True)
    amount = db.Column(db.Float, default=0.0)


class Holding(db.Model):
    __tablename__ = "holdings"
    user_id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(8), primary_key=True)
    shares = db.Column(db.Integer, default=0)
    cost_total = db.Column(db.Float, default=0.0)      # what you paid for the shares held, excl. fees
    last_div_idx = db.Column(db.Integer, default=0)


class StockState(db.Model):
    __tablename__ = "stock_state"
    symbol = db.Column(db.String(8), primary_key=True)
    available = db.Column(db.Integer, default=0)


class WalletTx(db.Model):
    """Append-only ledger. Signed amount in `currency`; amount_asd is the ASD value at the time."""
    __tablename__ = "wallet_tx"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, index=True, nullable=False)
    kind = db.Column(db.String(12), index=True)   # convert buy sell dividend send receive save withdraw
    currency = db.Column(db.String(4))
    amount = db.Column(db.Float)
    amount_asd = db.Column(db.Float, default=0.0)
    note = db.Column(db.String(120), default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class Savings(db.Model):
    __tablename__ = "savings"
    user_id = db.Column(db.Integer, primary_key=True)
    currency = db.Column(db.String(4), primary_key=True)
    principal = db.Column(db.Float, default=0.0)
    last_accrual = db.Column(db.DateTime, default=datetime.utcnow)


class EconState(db.Model):
    __tablename__ = "econ_state"
    id = db.Column(db.Integer, primary_key=True)
    fees_destroyed = db.Column(db.Float, default=0.0)


# ---- deterministic market math ---------------------------------------------
def _hours():
    return max(0.0, (time.time() - ECON_EPOCH) / 3600.0)


def _days():
    return _hours() / 24.0


def _noise(seed, step):
    """Slow seeded sine mix + per-step hash jitter, roughly in [-1, 1]. Same
    (seed, step) -> same value on every server, forever."""
    h = hashlib.sha256(seed.encode()).digest()
    total = 0.0
    for i in range(4):
        period = 20 + h[i] * 0.8                     # 20..224 steps
        phase = h[4 + i] / 255.0 * 2 * math.pi
        total += (0.5 ** i) * math.sin(2 * math.pi * step / period + phase)
    total /= 1.875
    j = hashlib.sha256(f"{seed}:{step}".encode()).digest()
    jitter = int.from_bytes(j[:4], "big") / 2 ** 32 - 0.5
    return max(-1.0, min(1.0, total * 0.85 + jitter * 0.3))


def cpi(cur=HOME, at=None):
    """Price index: 1.0 at the epoch. The daily inflation rate tapers hyperbolically
    (r(d) = infl * T / (T + d)), so cash keeps losing value but a months-long
    server never ends with a worthless currency. Closed form:
    cpi = ((T + d) / T) ** (T * ln(1 + infl))."""
    days = _days() if at is None else max(0.0, (at - ECON_EPOCH) / 86400.0)
    T = INFLATION_TAPER_DAYS
    return ((T + days) / T) ** (T * math.log(1 + CURRENCIES[cur]["infl"]))


def fx(cur, step=None):
    """ASD value of one unit of `cur`."""
    if cur == HOME:
        return 1.0
    c = CURRENCIES[cur]
    step = int(time.time() // STEP_S) if step is None else step
    t = step * STEP_S + 0.0
    drift = (cpi(HOME, t) / cpi(cur, t))              # higher local inflation -> weaker currency
    return max(1e-6, c["rate"] * drift * math.exp(c["wobble"] * _noise("fx:" + cur, step)))


def _pool_mult(available, flt):
    return 1 + SCARCITY_PREMIUM * (1 - max(0, min(flt, available)) / float(flt))


def price(sym, available, step=None):
    s = STOCKS[sym]
    step = int(time.time() // STEP_S) if step is None else step
    t = step * STEP_S + 0.0
    local = cpi(s["cur"], t) ** STOCK_BETA
    return round(s["base"] * math.exp(s["vol"] * _noise("px:" + sym, step)) * local * _pool_mult(available, s["float"]), 4)


def _div_per_share(sym, px, available):
    s = STOCKS[sym]
    issued_frac = 1 - available / float(s["float"])
    return px * s["yld"] * max(0.3, 1 - 0.7 * issued_frac)     # dilution: more holders, thinner yield


# ---- init ------------------------------------------------------------------
def init_economy(app, login_required, current_user, get_or_create_save, extra_fee=lambda: 0.0,
                 can_transfer=lambda: True):
    bp = Blueprint("economy", __name__)

    with app.app_context():
        db.create_all()
        for sym, s in STOCKS.items():
            if not db.session.get(StockState, sym):
                db.session.add(StockState(symbol=sym, available=s["float"]))
        if not db.session.get(EconState, 1):
            db.session.add(EconState(id=1))
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()

    # -- atomic money (caller commits, so multi-step trades are all-or-nothing)
    def _adjust(uid, cur, delta):
        if cur == HOME:
            q = GameSave.query.filter(GameSave.user_id == uid)
            if delta < 0:
                q = q.filter(GameSave.balance >= -delta)
            return q.update({GameSave.balance: GameSave.balance + delta}, synchronize_session=False) == 1
        base = Wallet.query.filter(Wallet.user_id == uid, Wallet.currency == cur)
        if delta < 0:
            return base.filter(Wallet.amount >= -delta).update({Wallet.amount: Wallet.amount + delta}, synchronize_session=False) == 1
        if base.update({Wallet.amount: Wallet.amount + delta}, synchronize_session=False) == 1:
            return True
        try:
            with db.session.begin_nested():
                db.session.add(Wallet(user_id=uid, currency=cur, amount=delta))
            return True
        except IntegrityError:
            return base.update({Wallet.amount: Wallet.amount + delta}, synchronize_session=False) == 1

    def _balances(uid, save):
        out = {HOME: round(save.balance or 0, 2)}
        for w in Wallet.query.filter_by(user_id=uid).all():
            out[w.currency] = round(w.amount or 0, 2)
        for c in CURRENCIES:
            out.setdefault(c, 0.0)
        return out

    def _fee(notional):
        pct = TRADE_FEE_PCT + max(0.0, float(extra_fee() or 0))
        return round(max(TRADE_FEE_MIN, notional * pct), 4)

    def _avail():
        return {r.symbol: r.available for r in StockState.query.all()}

    def _log(uid, kind, cur, amount, note=""):
        db.session.add(WalletTx(user_id=uid, kind=kind, currency=cur, amount=round(amount, 4),
                                amount_asd=round(amount * fx(cur), 2), note=note[:120]))

    def _burn_fee(amount_home):
        EconState.query.filter_by(id=1).update({EconState.fees_destroyed: EconState.fees_destroyed + amount_home}, synchronize_session=False)

    def _get_holding(uid, sym):
        h = db.session.get(Holding, (uid, sym))
        if not h:
            try:
                with db.session.begin_nested():
                    h = Holding(user_id=uid, symbol=sym, shares=0, cost_total=0.0,
                                last_div_idx=int(time.time() // STOCKS[sym]["div_s"]))
                    db.session.add(h)
            except IntegrityError:
                h = db.session.get(Holding, (uid, sym))
        return h

    # ------------------------------------------------------------------ state
    @bp.route("/api/econ/state")
    @login_required
    def econ_state():
        user = current_user()
        save = get_or_create_save(user)
        avail = _avail()
        now = time.time()
        step = int(now // STEP_S)
        holdings = {h.symbol: h for h in Holding.query.filter_by(user_id=user.id).all()}
        stocks, portfolio_home = [], 0.0
        for sym, s in STOCKS.items():
            px = price(sym, avail[sym])
            prev = price(sym, avail[sym], step - 10)         # ~5 min ago, for the +/- arrow
            h = holdings.get(sym)
            shares = h.shares if h else 0
            idx = int(now // s["div_s"])
            pending = 0.0
            if h and shares:
                owed = min(DIV_CATCHUP_CAP, max(0, idx - (h.last_div_idx or idx)))
                pending = round(shares * _div_per_share(sym, px, avail[sym]) * owed, 2)
            portfolio_home += shares * px * fx(s["cur"])
            stocks.append(dict(
                symbol=sym, name=s["name"], currency=s["cur"], price=px, change_pct=round((px / prev - 1) * 100, 2),
                available=avail[sym], float=s["float"],
                div_per_share=round(_div_per_share(sym, px, avail[sym]), 4), div_every_s=s["div_s"],
                next_div_in_s=int(s["div_s"] - now % s["div_s"]),
                shares=shares, buy_avg=round(h.cost_total / h.shares, 4) if h and h.shares else None,
                pending_dividends=pending))
        return jsonify(
            success=True, home=HOME, balances=_balances(user.id, save), stocks=stocks,
            currencies={c: dict(name=v["name"], to_asd=round(fx(c), 4), cpi=round(cpi(c), 4),
                                inflation_per_day_pct=round(v["infl"] * 100, 2)) for c, v in CURRENCIES.items()},
            fees=dict(trade_pct=round((TRADE_FEE_PCT + float(extra_fee() or 0)) * 100, 2), trade_min=TRADE_FEE_MIN,
                      convert_spread_pct=CONVERT_SPREAD * 100),
            portfolio_value_asd=round(portfolio_home, 2), price_index=round(cpi(), 4), step_s=STEP_S)

    @bp.route("/api/econ/history")
    @login_required
    def econ_history():
        sym = request.args.get("symbol")
        if sym not in STOCKS:
            return jsonify(success=False, msg="Unknown symbol."), 400
        try:
            n = max(10, min(int(request.args.get("n") or 60), 240))
        except ValueError:
            n = 60
        step, av = int(time.time() // STEP_S), _avail()[sym]
        return jsonify(success=True, symbol=sym, step_s=STEP_S,
                       series=[price(sym, av, step - i) for i in range(n - 1, -1, -1)])

    # ---------------------------------------------------------------- convert
    @bp.route("/api/econ/convert", methods=["POST"])
    @login_required
    def econ_convert():
        user = current_user()
        d = request.get_json(silent=True) or {}
        src, dst = d.get("from"), d.get("to")
        try:
            amt = round(float(d.get("amount")), 2)
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Bad amount."), 400
        if src not in CURRENCIES or dst not in CURRENCIES or src == dst or amt <= 0:
            return jsonify(success=False, msg="Pick two different currencies and a positive amount."), 400
        got = round(amt * fx(src) / fx(dst) * (1 - CONVERT_SPREAD), 2)
        if got <= 0:
            return jsonify(success=False, msg="Amount too small."), 400
        if not _adjust(user.id, src, -amt):
            db.session.rollback()
            return jsonify(success=False, msg=f"Not enough {src}."), 400
        _adjust(user.id, dst, got)
        _log(user.id, "convert", src, -amt, f"to {got:,.2f} {dst}")
        _log(user.id, "convert", dst, got, f"from {amt:,.2f} {src}")
        _burn_fee(round(amt * fx(src) * CONVERT_SPREAD, 4))
        db.session.commit()
        return jsonify(success=True, msg=f"Converted {amt:,.2f} {src} -> {got:,.2f} {dst} (1% spread).", received=got)

    # -------------------------------------------------------------- buy / sell
    def _parse_trade():
        d = request.get_json(silent=True) or {}
        sym = d.get("symbol")
        try:
            n = int(d.get("shares"))
        except (TypeError, ValueError):
            n = 0
        if sym not in STOCKS or not (1 <= n <= MAX_TRADE):
            return None, None
        return sym, n

    @bp.route("/api/econ/buy", methods=["POST"])
    @login_required
    def econ_buy():
        user = current_user()
        sym, n = _parse_trade()
        if not sym:
            return jsonify(success=False, msg=f"Pick a stock and 1-{MAX_TRADE} shares."), 400
        s = STOCKS[sym]
        avail = _avail()[sym]
        px = price(sym, avail)
        cost = round(px * n, 2)
        fee = _fee(cost)
        got = StockState.query.filter(StockState.symbol == sym, StockState.available >= n).update(
            {StockState.available: StockState.available - n}, synchronize_session=False)
        if got != 1:
            db.session.rollback()
            return jsonify(success=False, msg="Not enough shares left in the pool."), 400
        if not _adjust(user.id, s["cur"], -(cost + fee)):
            db.session.rollback()
            return jsonify(success=False, msg=f"You need {cost + fee:,.2f} {s['cur']} (incl. {fee:,.2f} fee). Convert some first."), 400
        _get_holding(user.id, sym)
        Holding.query.filter_by(user_id=user.id, symbol=sym).update(
            {Holding.shares: Holding.shares + n, Holding.cost_total: Holding.cost_total + cost}, synchronize_session=False)
        _log(user.id, "buy", s["cur"], -(cost + fee), f"{n} {sym} @ {px:,.4f}")
        _burn_fee(fee * fx(s["cur"]))
        db.session.commit()
        return jsonify(success=True, price=px, cost=cost, fee=fee, msg=f"Bought {n} {sym} @ {px:,.4f} {s['cur']} (+{fee:,.2f} fee).")

    @bp.route("/api/econ/sell", methods=["POST"])
    @login_required
    def econ_sell():
        user = current_user()
        sym, n = _parse_trade()
        if not sym:
            return jsonify(success=False, msg=f"Pick a stock and 1-{MAX_TRADE} shares."), 400
        s = STOCKS[sym]
        h = db.session.get(Holding, (user.id, sym))
        if not h or (h.shares or 0) < n:
            return jsonify(success=False, msg="You don't hold that many shares."), 400
        avg = h.cost_total / h.shares
        px = price(sym, _avail()[sym])
        gross = round(px * n, 2)
        fee = _fee(gross)
        net = round(gross - fee, 2)
        ok = Holding.query.filter(Holding.user_id == user.id, Holding.symbol == sym, Holding.shares >= n).update(
            {Holding.cost_total: Holding.cost_total - Holding.cost_total * n / Holding.shares,
             Holding.shares: Holding.shares - n}, synchronize_session=False)
        if ok != 1:
            db.session.rollback()
            return jsonify(success=False, msg="Sale failed, try again."), 409
        _adjust(user.id, s["cur"], max(0.0, net))
        _log(user.id, "sell", s["cur"], max(0.0, net), f"{n} {sym} @ {px:,.4f}")
        StockState.query.filter_by(symbol=sym).update({StockState.available: StockState.available + n}, synchronize_session=False)
        _burn_fee(fee * fx(s["cur"]))
        db.session.commit()
        pl = round(net - avg * n, 2)
        return jsonify(success=True, price=px, fee=fee, net=net, realized_pl=pl,
                       msg=f"Sold {n} {sym} @ {px:,.4f}. Realized {'+' if pl >= 0 else ''}{pl:,.2f} {s['cur']} after fees.")

    # -------------------------------------------------------------- dividends
    @bp.route("/api/econ/claim", methods=["POST"])
    @login_required
    def econ_claim():
        user = current_user()
        now = time.time()
        avail = _avail()
        paid = {}
        for h in Holding.query.filter(Holding.user_id == user.id, Holding.shares > 0).all():
            s = STOCKS.get(h.symbol)
            if not s:
                continue
            idx = int(now // s["div_s"])
            owed = min(DIV_CATCHUP_CAP, idx - (h.last_div_idx or idx))
            if owed <= 0:
                continue
            amt = round(h.shares * _div_per_share(h.symbol, price(h.symbol, avail[h.symbol]), avail[h.symbol]) * owed, 2)
            # conditional advance: a double-click / racing tab can't claim twice
            if Holding.query.filter(Holding.user_id == user.id, Holding.symbol == h.symbol,
                                    Holding.last_div_idx == h.last_div_idx).update(
                    {Holding.last_div_idx: idx}, synchronize_session=False) == 1 and amt > 0:
                _adjust(user.id, s["cur"], amt)
                _log(user.id, "dividend", s["cur"], amt, f"{h.shares} {h.symbol} x{owed}")
                paid[s["cur"]] = round(paid.get(s["cur"], 0) + amt, 2)
        db.session.commit()
        if not paid:
            return jsonify(success=False, msg="No dividends due yet."), 400
        return jsonify(success=True, paid=paid, msg="Dividends paid: " + ", ".join(f"{v:,.2f} {k}" for k, v in paid.items()))

    # ====================================================================
    # WALLET (lives inside the BANK app): ledger, send, savings, net worth
    # ====================================================================
    def _accrue(uid, cur):
        """Lazy compounding. The conditional UPDATE on last_accrual means two racing
        requests can't both pay the same interest."""
        row = db.session.get(Savings, (uid, cur))
        if not row or (row.principal or 0) <= 0:
            return row
        now = datetime.utcnow()
        elapsed = (now - (row.last_accrual or now)).total_seconds() / 86400.0
        if elapsed < 1 / 1440.0:
            return row
        new_p = round(row.principal * (1 + SAVINGS_RATE[cur]) ** min(elapsed, 30), 4)
        Savings.query.filter(Savings.user_id == uid, Savings.currency == cur, Savings.last_accrual == row.last_accrual).update(
            {Savings.principal: new_p, Savings.last_accrual: now}, synchronize_session=False)
        db.session.commit()
        db.session.refresh(row)
        return row

    def _stock_value_asd(uid, avail):
        total = 0.0
        for h in Holding.query.filter(Holding.user_id == uid, Holding.shares > 0).all():
            total += h.shares * price(h.symbol, avail[h.symbol]) * fx(STOCKS[h.symbol]["cur"])
        return total

    @bp.route("/api/wallet/summary")
    @login_required
    def wallet_summary():
        user = current_user()
        save = get_or_create_save(user)
        bal = _balances(user.id, save)
        sav = {}
        for c in CURRENCIES:
            row = _accrue(user.id, c)
            sav[c] = round((row.principal if row else 0) or 0, 2)
        cash_asd = sum(bal[c] * fx(c) for c in CURRENCIES)
        sav_asd = sum(sav[c] * fx(c) for c in CURRENCIES)
        stock_asd = _stock_value_asd(user.id, _avail())
        total = cash_asd + sav_asd + stock_asd
        day_ago = datetime.utcnow() - timedelta(hours=24)
        sent = -(db.session.query(db.func.coalesce(db.func.sum(WalletTx.amount_asd), 0.0)).filter(
            WalletTx.user_id == user.id, WalletTx.kind == "send", WalletTx.created_at >= day_ago).scalar() or 0.0)
        txs = WalletTx.query.filter_by(user_id=user.id).order_by(WalletTx.id.desc()).limit(40).all()
        return jsonify(
            success=True, price_index=round(cpi(), 4),
            currencies={c: dict(name=v["name"], to_asd=round(fx(c), 4), wallet=bal[c], savings=sav[c],
                                savings_rate_pct=round(SAVINGS_RATE[c] * 100, 2), inflation_pct=round(v["infl"] * 100, 2),
                                real_yield_pct=round((SAVINGS_RATE[c] - v["infl"]) * 100, 2)) for c, v in CURRENCIES.items()},
            worth=dict(cash=round(cash_asd, 2), savings=round(sav_asd, 2), stocks=round(stock_asd, 2), total=round(total, 2),
                       real_total=round(total / cpi(), 2)),
            send=dict(fee_pct=round((SEND_FEE_PCT + float(extra_fee() or 0)) * 100, 2), limit_asd=round(SEND_LIMIT_ASD * cpi(), 2),
                      used_asd=round(sent, 2), allowed=bool(can_transfer())),
            savings_cap_asd=round(SAVINGS_CAP_ASD * cpi(), 2),
            tx=[dict(id=t.id, kind=t.kind, currency=t.currency, amount=t.amount, asd=t.amount_asd, note=t.note,
                     at=t.created_at.strftime("%m-%d %H:%M")) for t in txs])

    @bp.route("/api/wallet/history")
    @login_required
    def wallet_history():
        user = current_user()
        try:
            before = int(request.args.get("before") or 0)
        except ValueError:
            before = 0
        q = WalletTx.query.filter_by(user_id=user.id)
        if before:
            q = q.filter(WalletTx.id < before)
        rows = q.order_by(WalletTx.id.desc()).limit(50).all()
        return jsonify(success=True, next_before=rows[-1].id if len(rows) == 50 else None,
                       tx=[dict(id=t.id, kind=t.kind, currency=t.currency, amount=t.amount, asd=t.amount_asd, note=t.note,
                                at=t.created_at.strftime("%m-%d %H:%M")) for t in rows])

    def _amount(d):
        try:
            a = round(float(d.get("amount")), 2)
        except (TypeError, ValueError):
            return None
        return a if a > 0 else None

    @bp.route("/api/wallet/send", methods=["POST"])
    @login_required
    def wallet_send():
        user = current_user()
        d = request.get_json(silent=True) or {}
        cur, amt = d.get("currency"), _amount(d)
        if cur not in CURRENCIES or amt is None:
            return jsonify(success=False, msg="Pick a currency and a positive amount."), 400
        if not can_transfer():
            return jsonify(success=False, msg="Player-to-player transfers are banned under the current regime."), 403
        to = find_user(str(d.get("to") or "").strip())
        if not to or to.id == user.id:
            return jsonify(success=False, msg="No such operator (and you can't pay yourself)."), 400
        fee = round(max(SEND_FEE_MIN, amt * (SEND_FEE_PCT + max(0.0, float(extra_fee() or 0)))), 2)
        day_ago = datetime.utcnow() - timedelta(hours=24)
        used = -(db.session.query(db.func.coalesce(db.func.sum(WalletTx.amount_asd), 0.0)).filter(
            WalletTx.user_id == user.id, WalletTx.kind == "send", WalletTx.created_at >= day_ago).scalar() or 0.0)
        if used + amt * fx(cur) > SEND_LIMIT_ASD * cpi():
            return jsonify(success=False, msg="Daily send limit reached."), 429
        if not _adjust(user.id, cur, -(amt + fee)):
            db.session.rollback()
            return jsonify(success=False, msg=f"You need {amt + fee:,.2f} {cur} (incl. {fee:,.2f} fee)."), 400
        if not _adjust(to.id, cur, amt):
            db.session.rollback()
            return jsonify(success=False, msg="That operator hasn't started a game yet."), 400
        note = str(d.get("note") or "")[:60]
        _log(user.id, "send", cur, -(amt + fee), f"to {to.username} {note}".strip())
        _log(to.id, "receive", cur, amt, f"from {user.username} {note}".strip())
        _burn_fee(fee * fx(cur))
        db.session.commit()
        return jsonify(success=True, msg=f"Sent {amt:,.2f} {cur} to {to.username} (+{fee:,.2f} fee).")

    @bp.route("/api/wallet/save", methods=["POST"])
    @login_required
    def wallet_save():
        user = current_user()
        d = request.get_json(silent=True) or {}
        cur, amt = d.get("currency"), _amount(d)
        if cur not in CURRENCIES or amt is None:
            return jsonify(success=False, msg="Pick a currency and a positive amount."), 400
        row = _accrue(user.id, cur)
        if ((row.principal if row else 0) + amt) * fx(cur) > SAVINGS_CAP_ASD * cpi():
            return jsonify(success=False, msg="That would exceed the savings cap for this currency."), 400
        if not _adjust(user.id, cur, -amt):
            db.session.rollback()
            return jsonify(success=False, msg=f"Not enough {cur}."), 400
        if row is None:
            try:
                with db.session.begin_nested():
                    db.session.add(Savings(user_id=user.id, currency=cur, principal=0.0))
            except IntegrityError:
                pass
        Savings.query.filter_by(user_id=user.id, currency=cur).update({Savings.principal: Savings.principal + amt}, synchronize_session=False)
        _log(user.id, "save", cur, -amt, "to savings")
        db.session.commit()
        return jsonify(success=True, msg=f"Moved {amt:,.2f} {cur} into savings ({SAVINGS_RATE[cur] * 100:.1f}%/day).")

    @bp.route("/api/wallet/withdraw", methods=["POST"])
    @login_required
    def wallet_withdraw():
        user = current_user()
        d = request.get_json(silent=True) or {}
        cur, amt = d.get("currency"), _amount(d)
        if cur not in CURRENCIES or amt is None:
            return jsonify(success=False, msg="Pick a currency and a positive amount."), 400
        _accrue(user.id, cur)
        fee = round(max(SEND_FEE_MIN, amt * WITHDRAW_FEE_PCT), 2)
        if Savings.query.filter(Savings.user_id == user.id, Savings.currency == cur, Savings.principal >= amt).update(
                {Savings.principal: Savings.principal - amt}, synchronize_session=False) != 1:
            db.session.rollback()
            return jsonify(success=False, msg="That's more than your savings balance."), 400
        _adjust(user.id, cur, max(0.0, amt - fee))
        _log(user.id, "withdraw", cur, max(0.0, amt - fee), f"from savings, fee {fee:,.2f}")
        _burn_fee(fee * fx(cur))
        db.session.commit()
        return jsonify(success=True, msg=f"Withdrew {amt:,.2f} {cur} (fee {fee:,.2f}).")

    app.register_blueprint(bp)
    return bp
