"""desk.py - Stage 25: the brokerage desk backend.

Wire-up (already in app.py, after init_learn):

    from desk import init_desk
    init_desk(app, login_required, current_user, get_or_create_save, STOCKS, PRICE_HISTORY,
              price_index=cpi, log_event=log_event)

Serves static/astra_stage25_desk.js:
    GET  /api/desk/portfolio      everything the desk renders, in one call
    POST /api/desk/check          pre-trade check (fill, fee, blockers, warnings)
    POST /api/desk/order          market / limit / stop orders
    POST /api/desk/cancel         cancel an open order (it lands in the BIN)
    POST /api/desk/watch          add/remove a watchlist symbol
    GET  /api/desk/bin            cancelled orders, resignation letters, shredded notes
    POST /api/desk/bin/restore | /delete | /empty

Limit and stop orders rest until the price crosses them. There is no matching thread:
open orders are evaluated lazily every time this user touches the desk, which is
also how often anyone could observe the difference.

Other modules can drop things in the BIN with desk.bin_add(user_id, kind, label, body).
"""
import json
import time
from datetime import datetime

from flask import Blueprint, jsonify, request

from models import db, GameSave

BASE_FEE_RATE = 0.001          # 0.1% of notional
MIN_FEE = 0.50                 # x price index
SLIPPAGE = {"deep": 0.0002, "good": 0.0005, "thin": 0.0015}
CONCENTRATION_WARN = 40.0      # % of account
SPARK_POINTS = 30
CURVE_POINTS = 60
CURVE_MIN_GAP_S = 5
HISTORY_ROWS = 40
KINDS = ("market", "limit", "stop")


# =============================================================================
# Models
# =============================================================================
class DeskOrder(db.Model):
    __tablename__ = "desk_orders"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    symbol = db.Column(db.String(12), nullable=False)
    side = db.Column(db.String(4), nullable=False)          # buy | sell
    kind = db.Column(db.String(8), nullable=False)          # market | limit | stop
    qty = db.Column(db.Integer, nullable=False)
    price = db.Column(db.Float)                             # limit / stop trigger
    status = db.Column(db.String(12), default="open")       # open | filled | cancelled | rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    closed_at = db.Column(db.DateTime)
    fill_price = db.Column(db.Float)
    fee = db.Column(db.Float)
    realized = db.Column(db.Float)


class DeskWatch(db.Model):
    __tablename__ = "desk_watch"
    user_id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(12), primary_key=True)


class DeskBin(db.Model):
    __tablename__ = "desk_bin"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    kind = db.Column(db.String(16), default="note")         # order | resignation | note
    label = db.Column(db.String(160), default="")
    body = db.Column(db.Text, default="")
    payload = db.Column(db.Text, default="{}")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class DeskState(db.Model):
    __tablename__ = "desk_state"
    user_id = db.Column(db.Integer, primary_key=True)
    curve_json = db.Column(db.Text, default="[]")
    curve_ts = db.Column(db.Float, default=0.0)


def bin_add(user_id, kind, label, body="", payload=None, commit=True):
    """Public helper: other modules (resignation, notes) can shred things into the BIN."""
    db.session.add(DeskBin(user_id=user_id, kind=kind, label=(label or "")[:160],
                           body=body or "", payload=json.dumps(payload or {})))
    if commit:
        db.session.commit()


# =============================================================================
# Wire-up
# =============================================================================
def init_desk(app, login_required, current_user, get_or_create_save, STOCKS, PRICE_HISTORY,
              price_index=lambda: 1.0, log_event=lambda m: None):
    bp = Blueprint("desk", __name__)

    with app.app_context():
        db.create_all()

    # ---- helpers ------------------------------------------------------------
    def _now_hm(dt):
        return (dt or datetime.utcnow()).strftime("%H:%M")

    def _cpi():
        try:
            return float(price_index())
        except Exception:
            return 1.0

    def _session():
        try:
            import learn_core as core
            label, depth = core.session_label(datetime.utcnow().hour)
            return {"label": label, "depth": depth}
        except Exception:
            return {"label": "MARKET", "depth": "good"}

    def _regime_fee():
        try:
            import world
            return float(world._rules()[1].get("trade_fee", 0.0) or 0.0)
        except Exception:
            return 0.0

    def _jailed(user_id):
        try:
            import world
            return world._jail_seconds_left(user_id) > 0
        except Exception:
            return False

    def _certs(user_id):
        out = {"basics": False, "credit": False, "broker": False, "risk": False}
        try:
            from learn import has_cert
            for k in out:
                out[k] = bool(has_cert(user_id, k))
        except Exception:
            # If the knowledge-gate module is unavailable, don't lock the desk.
            for k in out:
                out[k] = True
        return out

    def _retail_cap():
        try:
            import learn_core as core
            return int(core.RETAIL_CAP)
        except Exception:
            return 10

    def _spark(sym):
        h = list(PRICE_HISTORY.get(sym, []))[-SPARK_POINTS:]
        return h if len(h) > 1 else h * 2

    def _quote(sym):
        s = STOCKS[sym]
        price = float(s["price"])
        op = float(s.get("open") or price)
        chg = price - op
        return {"symbol": sym, "name": s["name"], "price": round(price, 2),
                "change": round(chg, 2), "change_pct": round(chg / op * 100, 2) if op else 0.0,
                "spark": _spark(sym)}

    def _fee(notional):
        rate = BASE_FEE_RATE + _regime_fee()
        return round(max(MIN_FEE * _cpi(), notional * rate), 2)

    def _fill_price(sym, side):
        slip = SLIPPAGE.get(_session()["depth"], 0.0005)
        px = float(STOCKS[sym]["price"])
        return round(px * (1 + slip) if side == "buy" else px * (1 - slip), 2)

    def _reserved(user_id):
        """Cash tied up by resting buy orders."""
        total = 0.0
        for o in DeskOrder.query.filter_by(user_id=user_id, status="open", side="buy").all():
            total += o.qty * (o.price or STOCKS[o.symbol]["price"]) * (1 + BASE_FEE_RATE + _regime_fee())
        return round(total, 2)

    def _positions(save):
        shares = save.shares()
        basis = save.cost_basis()
        rows, equity_pos = [], 0.0
        for sym, qty in shares.items():
            if qty <= 0 or sym not in STOCKS:
                continue
            px = float(STOCKS[sym]["price"])
            equity_pos += qty * px
            rows.append((sym, qty, px, (basis.get(sym) or {}).get("avg_cost")))
        equity = (save.balance or 0.0) + equity_pos
        out = []
        for sym, qty, px, avg in rows:
            value = qty * px
            unreal = (px - avg) * qty if avg else None
            out.append({"symbol": sym, "qty": qty, "price": round(px, 2),
                        "avg_cost": round(avg, 2) if avg else None, "value": round(value, 2),
                        "unrealized": round(unreal, 2) if unreal is not None else None,
                        "unrealized_pct": round((px / avg - 1) * 100, 2) if avg else None,
                        "weight": round(value / equity * 100, 1) if equity > 0 else 0.0})
        out.sort(key=lambda r: -r["value"])
        return out, round(equity, 2)

    def _diversification(positions):
        vals = [p["value"] for p in positions if p["value"] > 0]
        if len(vals) < 2:
            return 0
        tot = sum(vals)
        hhi = sum((v / tot) ** 2 for v in vals)
        n = max(2, len(STOCKS))
        return int(round(max(0.0, min(1.0, (1 - hhi) / (1 - 1.0 / n))) * 100))

    def _curve(user_id, equity):
        row = db.session.get(DeskState, user_id)
        if not row:
            row = DeskState(user_id=user_id, curve_json="[]", curve_ts=0.0)
            db.session.add(row)
        try:
            pts = json.loads(row.curve_json or "[]")
        except Exception:
            pts = []
        now = time.time()
        if not pts or now - (row.curve_ts or 0) >= CURVE_MIN_GAP_S:
            pts.append(round(equity, 2))
            pts = pts[-CURVE_POINTS:]
            row.curve_json = json.dumps(pts)
            row.curve_ts = now
        return pts if len(pts) > 1 else pts * 2

    # ---- execution ----------------------------------------------------------
    def _execute(user, save, sym, side, qty, fill, kind, order=None):
        """Apply a fill to the save. Assumes validation already passed."""
        notional = round(fill * qty, 2)
        fee = _fee(notional)
        shares = save.shares()
        realized = None
        if side == "buy":
            save.balance = round((save.balance or 0.0) - notional - fee, 2)
            shares[sym] = shares.get(sym, 0) + qty
            save.record_buy(sym, qty, fill)
        else:
            shares[sym] = shares.get(sym, 0) - qty
            if shares[sym] <= 0:
                shares.pop(sym, None)
            save.balance = round((save.balance or 0.0) + notional - fee, 2)
            realized = round(save.record_sell(sym, qty, fill) - fee, 2)
            save.add_profit(notional - fee)
        save.set_shares(shares)
        save.trades_count = (save.trades_count or 0) + 1
        save.mark_active()
        if order is None:
            order = DeskOrder(user_id=user.id, symbol=sym, side=side, kind=kind, qty=qty)
            db.session.add(order)
        order.status = "filled"
        order.closed_at = datetime.utcnow()
        order.fill_price, order.fee, order.realized = fill, fee, realized
        tail = f" (realized ${realized:+,.2f})" if realized is not None else ""
        log_event(f"{user.username}: DESK {side.upper()} {qty} {sym} @ ${fill:,.2f}{tail}")
        return order

    def _check(user, save, sym, side, kind, qty, price, exclude_order=None):
        """Returns (ok, info). info matches what /api/desk/check sends the UI."""
        blockers, warnings = [], []
        cash = save.balance or 0.0
        reserved = _reserved(user.id)
        if exclude_order is not None and exclude_order.side == "buy":
            reserved = max(0.0, reserved - exclude_order.qty * (exclude_order.price or STOCKS[sym]["price"]))
        avail = cash - reserved
        px = float(STOCKS[sym]["price"])
        certs = _certs(user.id)

        if not save.active:
            blockers.append("Start a career from CAREER to open an account.")
        if _jailed(user.id):
            blockers.append("You are in jail. The desk is closed to you.")
        if not certs["broker"]:
            blockers.append("Certificate required: pass Brokerage 101 in ASTRAWIKI first.")
        if qty > _retail_cap() and not certs["risk"]:
            blockers.append(f"Retail accounts are capped at {_retail_cap()} shares per order. "
                            "Pass Risk & Sizing in ASTRAWIKI to lift it.")
        if kind in ("limit", "stop") and (not price or price <= 0):
            blockers.append(f"Enter a {kind} price.")

        # What would this fill at, if it filled right now?
        immediate = True
        if kind == "limit" and price:
            immediate = (side == "buy" and price >= px) or (side == "sell" and price <= px)
        elif kind == "stop" and price:
            immediate = (side == "buy" and px >= price) or (side == "sell" and px <= price)
            if immediate:
                warnings.append("Stop is already triggered and will execute at market.")
        fill = _fill_price(sym, side)
        if kind == "limit" and price and not immediate:
            fill = float(price)
        elif kind == "stop" and price and not immediate:
            fill = float(price)
        notional = round(fill * qty, 2)
        fee = _fee(notional)
        total = round(notional + fee, 2) if side == "buy" else round(notional - fee, 2)

        held = save.shares().get(sym, 0)
        if side == "buy":
            cash_after = round(avail - total, 2)
            if cash_after < 0:
                blockers.append(f"Short by ${-cash_after:,.2f} of available cash.")
        else:
            cash_after = round(avail + total, 2)
            committed = sum(o.qty for o in DeskOrder.query.filter_by(user_id=user.id, status="open", side="sell", symbol=sym).all()
                            if exclude_order is None or o.id != exclude_order.id)
            if held - committed < qty:
                blockers.append(f"You only have {max(0, held - committed)} {sym} free to sell.")

        # Concentration warning on buys.
        if side == "buy" and qty > 0:
            positions, equity = _positions(save)
            after = (held + qty) * px
            eq_after = max(equity, 1.0)
            w = after / eq_after * 100
            if w >= CONCENTRATION_WARN:
                warnings.append(f"{sym} would be {w:,.0f}% of your account. One bad print and it hurts.")
        if _session()["depth"] == "thin" and kind == "market":
            warnings.append("Thin session: wider spreads, so market orders slip more.")
        if kind == "limit" and price and not immediate:
            warnings.append("Limit is away from the market; the order will rest until price reaches it.")
        if kind == "stop" and price and not immediate:
            warnings.append("Stop order rests until price crosses the trigger, then fills at market.")

        info = {"fill": fill, "fee": fee, "total": total, "cash_after": cash_after,
                "blockers": blockers, "warnings": warnings, "immediate": immediate}
        return (not blockers), info

    def _process_open_orders(user, save):
        """Lazy matching: fill or reject any resting order whose trigger has been crossed."""
        changed = False
        for o in DeskOrder.query.filter_by(user_id=user.id, status="open").order_by(DeskOrder.id).all():
            if o.symbol not in STOCKS:
                o.status, o.closed_at = "rejected", datetime.utcnow()
                changed = True
                continue
            px = float(STOCKS[o.symbol]["price"])
            trig = False
            if o.kind == "limit":
                trig = (o.side == "buy" and px <= o.price) or (o.side == "sell" and px >= o.price)
            elif o.kind == "stop":
                trig = (o.side == "buy" and px >= o.price) or (o.side == "sell" and px <= o.price)
            if not trig:
                continue
            # Re-validate against current funds / holdings with this order excluded from reservations.
            fill = float(o.price) if o.kind == "limit" else _fill_price(o.symbol, o.side)
            if o.kind == "limit":
                fill = min(fill, px) if o.side == "buy" else max(fill, px)
            cost = fill * o.qty + _fee(fill * o.qty)
            if o.side == "buy" and (save.balance or 0.0) < cost:
                o.status, o.closed_at = "rejected", datetime.utcnow()
                log_event(f"{user.username}: DESK order #{o.id} rejected (insufficient cash)")
                changed = True
                continue
            if o.side == "sell" and save.shares().get(o.symbol, 0) < o.qty:
                o.status, o.closed_at = "rejected", datetime.utcnow()
                log_event(f"{user.username}: DESK order #{o.id} rejected (shares gone)")
                changed = True
                continue
            _execute(user, save, o.symbol, o.side, o.qty, round(fill, 2), o.kind, order=o)
            changed = True
        if changed:
            db.session.commit()

    def _parse_order(data):
        sym = str(data.get("symbol") or "").upper()
        side = str(data.get("side") or "").lower()
        kind = str(data.get("type") or "market").lower()
        try:
            qty = int(data.get("qty") or 0)
        except (TypeError, ValueError):
            qty = 0
        try:
            price = float(data.get("price") or 0)
        except (TypeError, ValueError):
            price = 0.0
        if sym not in STOCKS:
            return None, "Unknown symbol."
        if side not in ("buy", "sell"):
            return None, "Side must be buy or sell."
        if kind not in KINDS:
            return None, "Unknown order type."
        if qty < 1 or qty > 1_000_000:
            return None, "Enter a share quantity."
        return (sym, side, kind, qty, price), None

    # ---- routes -------------------------------------------------------------
    @bp.route("/api/desk/portfolio")
    @login_required
    def desk_portfolio():
        user = current_user()
        save = get_or_create_save(user)
        session = _session()
        universe = [_quote(s) for s in STOCKS]
        movers = sorted(universe, key=lambda q: q["change_pct"], reverse=True)
        pick = lambda q: {"symbol": q["symbol"], "change": q["change"], "change_pct": q["change_pct"]}
        base = {"success": True, "active": bool(save.active), "session": session,
                "universe": universe, "certs": _certs(user.id),
                "gainers": [pick(q) for q in movers[:2] if q["change_pct"] > 0],
                "losers": [pick(q) for q in movers[::-1][:2] if q["change_pct"] < 0]}
        watch_syms = [w.symbol for w in DeskWatch.query.filter_by(user_id=user.id).all() if w.symbol in STOCKS]
        base["watch"] = [q for q in universe if q["symbol"] in watch_syms]
        if not save.active:
            base.update(equity=0, cash=0, buying_power=0, day_change=0, day_change_pct=0, unrealized=0,
                        diversification=0, positions=[], top_weight=0, curve=[], open_orders=[], history=[])
            return jsonify(base)

        _process_open_orders(user, save)
        positions, equity = _positions(save)
        cash = round(save.balance or 0.0, 2)
        day_change = sum(p["qty"] * (STOCKS[p["symbol"]]["price"] - float(STOCKS[p["symbol"]].get("open") or STOCKS[p["symbol"]]["price"]))
                         for p in positions)
        prev = equity - day_change
        unreal = sum(p["unrealized"] for p in positions if p["unrealized"] is not None)
        curve = _curve(user.id, equity)
        db.session.commit()

        open_orders = [{"id": o.id, "symbol": o.symbol, "side": o.side, "kind": o.kind, "qty": o.qty,
                        "price": o.price or 0, "now": round(float(STOCKS[o.symbol]["price"]), 2),
                        "age_s": int((datetime.utcnow() - o.created_at).total_seconds())}
                       for o in DeskOrder.query.filter_by(user_id=user.id, status="open").order_by(DeskOrder.id.desc()).all()
                       if o.symbol in STOCKS]
        history = [{"at": _now_hm(o.closed_at or o.created_at), "symbol": o.symbol, "side": o.side, "kind": o.kind,
                    "qty": o.qty, "fill_price": o.fill_price, "fee": o.fee, "realized": o.realized,
                    "status": o.status.upper()}
                   for o in DeskOrder.query.filter(DeskOrder.user_id == user.id, DeskOrder.status != "open")
                   .order_by(DeskOrder.id.desc()).limit(HISTORY_ROWS).all()]
        base.update(equity=equity, cash=cash, buying_power=round(max(0.0, cash - _reserved(user.id)), 2),
                    day_change=round(day_change, 2),
                    day_change_pct=round(day_change / prev * 100, 2) if prev else 0.0,
                    unrealized=round(unreal, 2), diversification=_diversification(positions),
                    positions=positions, top_weight=positions[0]["weight"] if positions else 0.0,
                    curve=curve, open_orders=open_orders, history=history)
        return jsonify(base)

    @bp.route("/api/desk/check", methods=["POST"])
    @login_required
    def desk_check():
        parsed, err = _parse_order(request.get_json(silent=True) or {})
        if err:
            return jsonify(success=False, msg=err)
        sym, side, kind, qty, price = parsed
        user = current_user()
        save = get_or_create_save(user)
        ok, info = _check(user, save, sym, side, kind, qty, price)
        return jsonify(success=True, ok=ok, **info)

    @bp.route("/api/desk/order", methods=["POST"])
    @login_required
    def desk_order():
        parsed, err = _parse_order(request.get_json(silent=True) or {})
        if err:
            return jsonify(success=False, msg=err)
        sym, side, kind, qty, price = parsed
        user = current_user()
        save = get_or_create_save(user)
        _process_open_orders(user, save)
        ok, info = _check(user, save, sym, side, kind, qty, price)
        if not ok:
            return jsonify(success=False, msg=info["blockers"][0])
        if info["immediate"]:
            fill = info["fill"]
            if kind == "limit":   # a marketable limit never fills worse than its limit
                fill = min(fill, price) if side == "buy" else max(fill, price)
            o = _execute(user, save, sym, side, qty, round(fill, 2), kind)
            db.session.commit()
            word = "Bought" if side == "buy" else "Sold"
            extra = f" Realized ${o.realized:+,.2f}." if o.realized is not None else ""
            return jsonify(success=True, filled=True, id=o.id,
                           msg=f"{word} {qty} {sym} @ ${o.fill_price:,.2f} (fee ${o.fee:,.2f}).{extra}")
        o = DeskOrder(user_id=user.id, symbol=sym, side=side, kind=kind, qty=qty, price=price)
        db.session.add(o)
        db.session.commit()
        return jsonify(success=True, filled=False, id=o.id,
                       msg=f"{kind.title()} {side} for {qty} {sym} @ ${price:,.2f} is working.")

    @bp.route("/api/desk/cancel", methods=["POST"])
    @login_required
    def desk_cancel():
        user = current_user()
        try:
            oid = int((request.get_json(silent=True) or {}).get("id"))
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Bad order id."), 400
        o = DeskOrder.query.filter_by(id=oid, user_id=user.id, status="open").first()
        if not o:
            return jsonify(success=False, msg="That order is no longer open.")
        o.status, o.closed_at = "cancelled", datetime.utcnow()
        label = f"Cancelled {o.kind} {o.side} {o.qty} {o.symbol}" + (f" @ ${o.price:,.2f}" if o.price else "")
        bin_add(user.id, "order", label, "",
                {"symbol": o.symbol, "side": o.side, "type": o.kind, "qty": o.qty, "price": o.price},
                commit=False)
        db.session.commit()
        return jsonify(success=True, msg="Order cancelled. It's in the BIN if you change your mind.")

    @bp.route("/api/desk/watch", methods=["POST"])
    @login_required
    def desk_watch():
        user = current_user()
        data = request.get_json(silent=True) or {}
        sym = str(data.get("symbol") or "").upper()
        if sym not in STOCKS:
            return jsonify(success=False, msg="Unknown symbol."), 400
        row = db.session.get(DeskWatch, (user.id, sym))
        if data.get("on") and not row:
            db.session.add(DeskWatch(user_id=user.id, symbol=sym))
        elif not data.get("on") and row:
            db.session.delete(row)
        db.session.commit()
        return jsonify(success=True)

    @bp.route("/api/desk/bin")
    @login_required
    def desk_bin():
        user = current_user()
        rows = DeskBin.query.filter_by(user_id=user.id).order_by(DeskBin.id.desc()).limit(100).all()
        return jsonify(success=True, items=[{"id": b.id, "kind": b.kind, "at": _now_hm(b.created_at),
                                             "label": b.label, "body": b.body or ""} for b in rows])

    @bp.route("/api/desk/bin/restore", methods=["POST"])
    @login_required
    def desk_bin_restore():
        user = current_user()
        try:
            bid = int((request.get_json(silent=True) or {}).get("id"))
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Bad id."), 400
        b = DeskBin.query.filter_by(id=bid, user_id=user.id).first()
        if not b:
            return jsonify(success=False, msg="Already gone.")
        if b.kind == "order":
            try:
                p = json.loads(b.payload or "{}")
            except Exception:
                p = {}
            save = get_or_create_save(user)
            parsed, err = _parse_order(p)
            if err:
                return jsonify(success=False, msg="Can't restore: " + err)
            sym, side, kind, qty, price = parsed
            ok, info = _check(user, save, sym, side, kind, qty, price)
            if not ok:
                return jsonify(success=False, msg="Can't restore: " + info["blockers"][0])
            if info["immediate"]:
                _execute(user, save, sym, side, qty, round(info["fill"], 2), kind)
                msg = f"Order restored and filled: {side} {qty} {sym}."
            else:
                db.session.add(DeskOrder(user_id=user.id, symbol=sym, side=side, kind=kind, qty=qty, price=price))
                msg = "Order restored and working again."
            db.session.delete(b)
            db.session.commit()
            return jsonify(success=True, msg=msg)
        db.session.delete(b)
        db.session.commit()
        return jsonify(success=True, msg="Fished it out of the bin.")

    @bp.route("/api/desk/bin/delete", methods=["POST"])
    @login_required
    def desk_bin_delete():
        user = current_user()
        try:
            bid = int((request.get_json(silent=True) or {}).get("id"))
        except (TypeError, ValueError):
            return jsonify(success=False), 400
        DeskBin.query.filter_by(id=bid, user_id=user.id).delete()
        db.session.commit()
        return jsonify(success=True)

    @bp.route("/api/desk/bin/empty", methods=["POST"])
    @login_required
    def desk_bin_empty():
        user = current_user()
        n = DeskBin.query.filter_by(user_id=user.id).delete()
        db.session.commit()
        return jsonify(success=True, msg=f"Bin emptied ({n} item{'s' if n != 1 else ''}).")

    app.register_blueprint(bp)
