"""world.py - Astra "world layer": political regimes, crime & justice, BLABBER
(anonymous parody social), NOTEPAD PRO (paid app), signed stats + sharing,
and admin cheat-review tools.

Wire it in with two lines in app.py, AFTER login_required / admin_required /
current_user / get_or_create_save / market_state are defined:

    from world import init_world
    init_world(app, login_required, admin_required, current_user,
               get_or_create_save, market_state)

Design rules (these are what make it hold up with thousands of players):
  * Every balance change is ONE atomic SQL UPDATE (see _adjust_balance), never
    read-modify-write in Python, so two requests can't double-spend.
  * Shared state (regime, votes, jail) lives in the database, not in process
    memory, so it stays correct across multiple server workers.
  * Anything global (wealth redistribution) is claimed with an atomic
    "UPDATE ... WHERE last_run < cutoff" so exactly one worker runs it.
  * Feeds are cursor-paginated; hot columns are indexed.
  * There is no hardcoded admin account. Admin = User.is_admin (see
    admin_tools.py). ADMIN_BOOTSTRAP_USERNAME in .env can flip the flag on an
    account that ALREADY EXISTS at boot - register first, then start the server.
"""
import hashlib
import hmac
import json
import os
import random
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError

from models import db, User, GameSave, Report
from astra_net import find_user


# =============================================================================
# Rules tables
# =============================================================================
REGIMES = {
    "capitalism": dict(
        label="Free Market Republic", tax_rate=0.04, allow_player_trading=True,
        trade_fee=0.0, enforcement=1.0, redistribution_rate=0.0, threshold_mult=0,
        allow_anonymous=True,
        blurb="Low tax, open trading, light policing. Wealth stays where it lands."),
    "mixed": dict(
        label="Social Democracy", tax_rate=0.12, allow_player_trading=True,
        trade_fee=0.01, enforcement=1.2, redistribution_rate=0.05, threshold_mult=3.0,
        allow_anonymous=True,
        blurb="Moderate tax, a 1% trading levy, and a small top-up funded by the very rich."),
    "communism": dict(
        label="People's Collective", tax_rate=0.25, allow_player_trading=False,
        trade_fee=0.0, enforcement=1.5, redistribution_rate=0.20, threshold_mult=1.5,
        allow_anonymous=True,
        blurb="Player-to-player trading banned. 20% of everything above 1.5x the average is shared equally."),
    "authoritarian": dict(
        label="Security State", tax_rate=0.20, allow_player_trading=True,
        trade_fee=0.03, enforcement=2.2, redistribution_rate=0.0, threshold_mult=0,
        allow_anonymous=False,
        blurb="Crime is policed hard, a 3% trade levy applies, and BLABBER anonymity is switched off."),
}
DEFAULT_REGIME = "capitalism"
REGIME_COOLDOWN_MIN = 60          # min real minutes between regime changes
REGIME_VOTE_WINDOW_H = 24
REDISTRIBUTION_EVERY_MIN = 10

CRIMES = {
    "pickpocket":      dict(label="Pickpocket a trader", severity=1, reward=(40, 220),      catch=0.30, fine_pct=0.02, fine_min=50,    jail_min=0),
    "forgery":         dict(label="Forge invoices",       severity=2, reward=(300, 1200),    catch=0.40, fine_pct=0.06, fine_min=200,   jail_min=0),
    "tax_evasion":     dict(label="Hide income",          severity=2, reward=(500, 2500),    catch=0.45, fine_pct=0.10, fine_min=400,   jail_min=3),
    "insider_trading": dict(label="Insider trading",      severity=3, reward=(2000, 9000),   catch=0.50, fine_pct=0.15, fine_min=1500,  jail_min=10),
    "embezzlement":    dict(label="Embezzle from firm",   severity=4, reward=(6000, 25000),  catch=0.55, fine_pct=0.25, fine_min=5000,  jail_min=25),
    "bank_hack":       dict(label="Hack a bank",          severity=5, reward=(20000, 90000), catch=0.70, fine_pct=0.40, fine_min=15000, jail_min=60),
}
CRIME_COOLDOWN_S = 20
WANTED_DECAY_PER_MIN = 0.1
BAIL_PER_MINUTE = 150.0
JAIL_CAP_MIN = 180

# Server actions blocked while jailed (reading, notes, BLABBER, reports stay open).
JAIL_BLOCKED_PREFIXES = ("/api/wallet/", "/api/econ/", "/api/game/", "/api/work/", "/api/exchange/",
                         "/api/coop/trade_share", "/api/bots/dial", "/api/hire/")
TRADE_PREFIXES = ("/api/exchange/",)

NOTES_PRO_PRICE = 1200.0
NOTES_MAX = 200
NOTE_MAX_CHARS = 20000
SHARE_TTL_DAYS = 7
BLABBER_MAX_CHARS = 280
BLABBER_COOLDOWN_S = 10
BLABBER_AUTOHIDE_REPORTS = 3
FLAG_TERMS = [t.strip().lower() for t in os.environ.get("BLABBER_FLAG_TERMS", "").split(",") if t.strip()]


# =============================================================================
# Models
# =============================================================================
class WorldState(db.Model):
    __tablename__ = "world_state"
    id = db.Column(db.Integer, primary_key=True)
    regime = db.Column(db.String(24), default=DEFAULT_REGIME)
    regime_changed_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_redistribution = db.Column(db.DateTime)


class RegimeVote(db.Model):
    __tablename__ = "regime_votes"
    user_id = db.Column(db.Integer, primary_key=True)
    regime = db.Column(db.String(24), nullable=False)
    cast_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class CriminalRecord(db.Model):
    __tablename__ = "criminal_records"
    user_id = db.Column(db.Integer, primary_key=True)
    wanted = db.Column(db.Float, default=0.0)
    wanted_at = db.Column(db.DateTime, default=datetime.utcnow)
    convictions = db.Column(db.Integer, default=0)
    last_crime_at = db.Column(db.DateTime)
    jail_until = db.Column(db.DateTime, index=True)
    jail_reason = db.Column(db.String(120), default="")


class Offense(db.Model):
    __tablename__ = "offenses"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, index=True, nullable=False)
    crime = db.Column(db.String(24))
    outcome = db.Column(db.String(12))       # success | fined | jailed
    amount = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class BlabberPost(db.Model):
    __tablename__ = "blabber_posts"
    id = db.Column(db.Integer, primary_key=True)
    author_id = db.Column(db.Integer, index=True, nullable=False)
    anonymous = db.Column(db.Boolean, default=False)
    body = db.Column(db.String(BLABBER_MAX_CHARS), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    likes = db.Column(db.Integer, default=0)
    report_count = db.Column(db.Integer, default=0)
    hidden = db.Column(db.Boolean, default=False, index=True)
    flagged = db.Column(db.Boolean, default=False, index=True)


class BlabberLike(db.Model):
    __tablename__ = "blabber_likes"
    user_id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, primary_key=True)


class Note(db.Model):
    __tablename__ = "pro_notes"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, index=True, nullable=False)
    title = db.Column(db.String(80), default="Untitled")
    body = db.Column(db.Text, default="")
    tags = db.Column(db.String(120), default="")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)


class AppLicense(db.Model):
    __tablename__ = "app_licenses"
    user_id = db.Column(db.Integer, primary_key=True)
    app_id = db.Column(db.String(32), primary_key=True)
    bought_at = db.Column(db.DateTime, default=datetime.utcnow)


class SharedItem(db.Model):
    __tablename__ = "shared_items"
    code = db.Column(db.String(16), primary_key=True)
    owner_id = db.Column(db.Integer, index=True, nullable=False)
    owner_name = db.Column(db.String(64))
    kind = db.Column(db.String(12))          # note | stats
    payload = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, index=True)


class AdminAction(db.Model):
    """Audit trail: every admin power that touches a player is logged here."""
    __tablename__ = "admin_actions"
    id = db.Column(db.Integer, primary_key=True)
    admin_name = db.Column(db.String(64))
    action = db.Column(db.String(32))
    target = db.Column(db.String(64))
    detail = db.Column(db.String(300), default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


# =============================================================================
# Helpers
# =============================================================================
def _now():
    return datetime.utcnow()


def _adjust_balance(user_id, delta):
    """Atomic. Negative deltas succeed only if the player can afford them."""
    q = GameSave.query.filter(GameSave.user_id == user_id)
    if delta < 0:
        q = q.filter(GameSave.balance >= -delta)
    n = q.update({GameSave.balance: GameSave.balance + delta}, synchronize_session=False)
    db.session.commit()
    return n == 1


def _take_up_to(user_id, amount):
    """Atomic fine: removes min(amount, balance) and returns what was taken."""
    before = db.session.query(GameSave.balance).filter(GameSave.user_id == user_id).scalar() or 0.0
    taken = max(0.0, min(amount, before))
    GameSave.query.filter(GameSave.user_id == user_id).update(
        {GameSave.balance: case((GameSave.balance > amount, GameSave.balance - amount), else_=0.0)},
        synchronize_session=False)
    db.session.commit()
    return round(taken, 2)


def _world():
    w = db.session.get(WorldState, 1)
    if not w:
        w = WorldState(id=1, regime=DEFAULT_REGIME)
        db.session.add(w)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            w = db.session.get(WorldState, 1)
    return w


def _rules():
    r = _world().regime
    return r if r in REGIMES else DEFAULT_REGIME, REGIMES.get(r, REGIMES[DEFAULT_REGIME])


def _record(user_id):
    rec = db.session.get(CriminalRecord, user_id)
    if not rec:
        rec = CriminalRecord(user_id=user_id)
        db.session.add(rec)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            rec = db.session.get(CriminalRecord, user_id)
    return rec


def _current_wanted(rec):
    elapsed_min = (_now() - (rec.wanted_at or _now())).total_seconds() / 60.0
    return max(0.0, (rec.wanted or 0.0) - elapsed_min * WANTED_DECAY_PER_MIN)


def _jail_seconds_left(user_id):
    until = db.session.query(CriminalRecord.jail_until).filter(CriminalRecord.user_id == user_id).scalar()
    if not until:
        return 0
    return max(0, int((until - _now()).total_seconds()))


def _active_count():
    return db.session.query(func.count(GameSave.id)).filter(GameSave.active.is_(True)).scalar() or 0


def _sign(payload_str, secret):
    return hmac.new(secret.encode(), payload_str.encode(), hashlib.sha256).hexdigest()


def _clean(s, n):
    return "".join(ch for ch in str(s or "") if ch == "\n" or ch >= " ")[:n].strip()


# =============================================================================
# init
# =============================================================================
def init_world(app, login_required, admin_required, current_user, get_or_create_save, market_state=None,
               price_index=lambda: 1.0):
    bp = Blueprint("world", __name__)
    secret = app.secret_key or "dev-only-change-me"

    with app.app_context():
        db.create_all()
        _world()
        boot_name = (os.environ.get("ADMIN_BOOTSTRAP_USERNAME") or "").strip()
        if boot_name:
            u = find_user(boot_name)
            if u and not u.is_admin:
                u.is_admin = True
                db.session.commit()
                app.logger.warning("ADMIN_BOOTSTRAP_USERNAME: granted admin to %r. Remove it from .env now.", boot_name)

    # ---- global request gate: jail + regime trading ban ---------------------
    @app.before_request
    def _world_gate():
        from flask import session
        if request.method not in ("POST", "PUT", "DELETE"):
            return None
        uid = session.get("user_id")
        if not uid:
            return None
        path = request.path
        if path.startswith(JAIL_BLOCKED_PREFIXES):
            left = _jail_seconds_left(uid)
            if left > 0:
                return jsonify(success=False, jailed=True, seconds_left=left,
                               msg=f"You are in custody for another {left // 60}m {left % 60}s. Pay bail in CIVICS."), 403
        if path.startswith(TRADE_PREFIXES):
            _, rules = _rules()
            if not rules["allow_player_trading"]:
                return jsonify(success=False, msg="Player-to-player trading is banned under the current regime."), 403
        return None

    # ---- lazy, single-winner redistribution ---------------------------------
    def _maybe_redistribute():
        name, rules = _rules()
        if rules["redistribution_rate"] <= 0:
            return
        cutoff = _now() - timedelta(minutes=REDISTRIBUTION_EVERY_MIN)
        won = WorldState.query.filter(
            WorldState.id == 1,
            (WorldState.last_redistribution.is_(None)) | (WorldState.last_redistribution < cutoff)
        ).update({WorldState.last_redistribution: _now()}, synchronize_session=False)
        db.session.commit()
        if won != 1:
            return
        n = _active_count()
        if n < 2:
            return
        avg = db.session.query(func.avg(GameSave.balance)).filter(GameSave.active.is_(True)).scalar() or 0
        threshold = avg * rules["threshold_mult"]
        rate = rules["redistribution_rate"]
        pool = db.session.query(func.coalesce(func.sum((GameSave.balance - threshold) * rate), 0.0)).filter(
            GameSave.active.is_(True), GameSave.balance > threshold).scalar() or 0.0
        if pool <= 0:
            return
        GameSave.query.filter(GameSave.active.is_(True), GameSave.balance > threshold).update(
            {GameSave.balance: GameSave.balance - (GameSave.balance - threshold) * rate}, synchronize_session=False)
        GameSave.query.filter(GameSave.active.is_(True)).update(
            {GameSave.balance: GameSave.balance + pool / n}, synchronize_session=False)
        db.session.commit()

    def _apply_regime(name):
        rules = REGIMES[name]
        if market_state is not None:
            market_state["tax_rate"] = rules["tax_rate"]

    def _tally_and_maybe_switch():
        w = _world()
        since = _now() - timedelta(hours=REGIME_VOTE_WINDOW_H)
        rows = db.session.query(RegimeVote.regime, func.count()).filter(
            RegimeVote.cast_at >= since).group_by(RegimeVote.regime).all()
        tally = {r: c for r, c in rows}
        total = sum(tally.values())
        quorum = max(3, int(_active_count() * 0.10))
        if total < quorum:
            return tally, quorum
        leader, votes = max(tally.items(), key=lambda kv: kv[1])
        if leader != w.regime and votes * 2 > total and \
                (_now() - (w.regime_changed_at or _now())).total_seconds() >= REGIME_COOLDOWN_MIN * 60:
            changed = WorldState.query.filter(WorldState.id == 1, WorldState.regime == w.regime).update(
                {WorldState.regime: leader, WorldState.regime_changed_at: _now()}, synchronize_session=False)
            db.session.commit()
            if changed:
                _apply_regime(leader)
        return tally, quorum

    # ========================================================================
    # CIVICS: state, regime vote, crime, bail
    # ========================================================================
    @bp.route("/api/world/state")
    @login_required
    def world_state():
        user = current_user()
        _maybe_redistribute()
        name, rules = _rules()
        w = _world()
        since = _now() - timedelta(hours=REGIME_VOTE_WINDOW_H)
        rows = db.session.query(RegimeVote.regime, func.count()).filter(RegimeVote.cast_at >= since).group_by(RegimeVote.regime).all()
        mine = db.session.get(RegimeVote, user.id)
        rec = _record(user.id)
        left = _jail_seconds_left(user.id)
        return jsonify(
            success=True, regime=name, rules=rules, regimes=REGIMES, tally={r: c for r, c in rows},
            quorum=max(3, int(_active_count() * 0.10)), my_vote=mine.regime if mine else None,
            changed_ago_min=int((_now() - (w.regime_changed_at or _now())).total_seconds() / 60),
            crimes={k: {"label": v["label"], "severity": v["severity"], "reward": v["reward"]} for k, v in CRIMES.items()},
            record=dict(wanted=round(_current_wanted(rec), 1), convictions=rec.convictions or 0,
                        jail_seconds_left=left, jail_reason=rec.jail_reason if left else "",
                        bail=round(left / 60.0 * BAIL_PER_MINUTE * price_index(), 2) if left else 0))

    @bp.route("/api/world/vote", methods=["POST"])
    @login_required
    def world_vote():
        user = current_user()
        choice = (request.get_json(silent=True) or {}).get("regime")
        if choice not in REGIMES:
            return jsonify(success=False, msg="Unknown regime."), 400
        v = db.session.get(RegimeVote, user.id)
        if v:
            v.regime, v.cast_at = choice, _now()
        else:
            db.session.add(RegimeVote(user_id=user.id, regime=choice))
        db.session.commit()
        tally, quorum = _tally_and_maybe_switch()
        return jsonify(success=True, msg="Vote recorded.", tally=tally, quorum=quorum, regime=_rules()[0])

    @bp.route("/api/world/crime", methods=["POST"])
    @login_required
    def world_crime():
        user = current_user()
        crime_id = (request.get_json(silent=True) or {}).get("crime")
        crime = CRIMES.get(crime_id)
        if not crime:
            return jsonify(success=False, msg="Unknown crime."), 400
        save = get_or_create_save(user)
        if not save.active:
            return jsonify(success=False, msg="Start a game first."), 400
        if _jail_seconds_left(user.id) > 0:
            return jsonify(success=False, msg="You're in custody."), 403
        rec = _record(user.id)
        # Atomic cooldown claim: only one request per player per window wins.
        cutoff = _now() - timedelta(seconds=CRIME_COOLDOWN_S)
        won = CriminalRecord.query.filter(
            CriminalRecord.user_id == user.id,
            (CriminalRecord.last_crime_at.is_(None)) | (CriminalRecord.last_crime_at < cutoff)
        ).update({CriminalRecord.last_crime_at: _now()}, synchronize_session=False)
        db.session.commit()
        if won != 1:
            return jsonify(success=False, msg=f"Lay low for {CRIME_COOLDOWN_S}s between jobs."), 429

        _, rules = _rules()
        wanted = _current_wanted(rec)
        p_catch = min(0.95, crime["catch"] * rules["enforcement"] * (1 + wanted * 0.05))
        caught = random.random() < p_catch
        sev = crime["severity"]
        rec.wanted = wanted + (sev * 2 if caught else sev * 0.5)
        rec.wanted_at = _now()

        if not caught:
            loot = round(random.uniform(*crime["reward"]), 2)
            _adjust_balance(user.id, loot)
            db.session.add(Offense(user_id=user.id, crime=crime_id, outcome="success", amount=loot))
            db.session.commit()
            return jsonify(success=True, outcome="success", amount=loot, p_catch=round(p_catch, 2),
                           msg=f"Clean getaway. +${loot:,.2f}")

        bal = db.session.query(GameSave.balance).filter(GameSave.user_id == user.id).scalar() or 0
        fine = _take_up_to(user.id, max(crime["fine_min"], bal * crime["fine_pct"]))
        rec.convictions = (rec.convictions or 0) + 1
        jail_min = 0
        if crime["jail_min"] or sev >= 3:
            jail_min = min(JAIL_CAP_MIN, int(crime["jail_min"] * (1 + 0.25 * (rec.convictions - 1))))
        elif rec.wanted >= 5:
            jail_min = 5
        outcome = "fined"
        if jail_min > 0:
            outcome = "jailed"
            rec.jail_until = _now() + timedelta(minutes=jail_min)
            rec.jail_reason = crime["label"]
        db.session.add(Offense(user_id=user.id, crime=crime_id, outcome=outcome, amount=fine))
        db.session.commit()
        msg = f"Caught. Fined ${fine:,.2f}."
        if jail_min:
            msg += f" Sentenced to {jail_min} min in custody."
        return jsonify(success=True, outcome=outcome, fine=fine, jail_minutes=jail_min,
                       p_catch=round(p_catch, 2), msg=msg)

    @bp.route("/api/world/bail", methods=["POST"])
    @login_required
    def world_bail():
        user = current_user()
        left = _jail_seconds_left(user.id)
        if left <= 0:
            return jsonify(success=False, msg="You're not in custody."), 400
        bail = round(left / 60.0 * BAIL_PER_MINUTE * price_index(), 2)
        if not _adjust_balance(user.id, -bail):
            return jsonify(success=False, msg=f"Bail is ${bail:,.2f} and you can't cover it."), 400
        CriminalRecord.query.filter_by(user_id=user.id).update({CriminalRecord.jail_until: None}, synchronize_session=False)
        db.session.commit()
        return jsonify(success=True, msg=f"Bail paid: ${bail:,.2f}. You're free.")

    # ========================================================================
    # BLABBER
    # ========================================================================
    def _handle(post, viewer_id, is_admin=False):
        if post.anonymous:
            day = post.created_at.strftime("%Y%m%d")
            tag = _sign(f"{post.author_id}:{day}", secret)[:5]
            return f"anon-{tag}"
        u = db.session.get(User, post.author_id)
        return u.username if u else "deleted"

    def _post_dict(p, viewer_id):
        return dict(id=p.id, handle=_handle(p, viewer_id), anonymous=bool(p.anonymous), body=p.body,
                    likes=p.likes or 0, mine=(p.author_id == viewer_id),
                    ts=p.created_at.strftime("%Y-%m-%d %H:%M"))

    @bp.route("/api/blabber/feed")
    @login_required
    def blabber_feed():
        user = current_user()
        try:
            before = int(request.args.get("before") or 0)
        except ValueError:
            before = 0
        q = BlabberPost.query.filter(BlabberPost.hidden.is_(False))
        if before:
            q = q.filter(BlabberPost.id < before)
        rows = q.order_by(BlabberPost.id.desc()).limit(30).all()
        return jsonify(success=True, posts=[_post_dict(p, user.id) for p in rows],
                       next_before=rows[-1].id if len(rows) == 30 else None,
                       anon_allowed=_rules()[1]["allow_anonymous"])

    @bp.route("/api/blabber/post", methods=["POST"])
    @login_required
    def blabber_post():
        user = current_user()
        data = request.get_json(silent=True) or {}
        body = _clean(data.get("body"), BLABBER_MAX_CHARS)
        if not body:
            return jsonify(success=False, msg="Say something first."), 400
        anon = bool(data.get("anonymous"))
        if anon and not _rules()[1]["allow_anonymous"]:
            return jsonify(success=False, msg="Anonymous posting is disabled under the current regime."), 403
        last = db.session.query(func.max(BlabberPost.created_at)).filter(BlabberPost.author_id == user.id).scalar()
        if last and (_now() - last).total_seconds() < BLABBER_COOLDOWN_S:
            return jsonify(success=False, msg="Slow down."), 429
        flagged = any(t in body.lower() for t in FLAG_TERMS)
        p = BlabberPost(author_id=user.id, anonymous=anon, body=body, flagged=flagged, hidden=flagged)
        db.session.add(p)
        db.session.commit()
        msg = "Posted." if not flagged else "Posted, but held for admin review."
        return jsonify(success=True, msg=msg, post=_post_dict(p, user.id))

    @bp.route("/api/blabber/like", methods=["POST"])
    @login_required
    def blabber_like():
        user = current_user()
        pid = (request.get_json(silent=True) or {}).get("post_id")
        try:
            db.session.add(BlabberLike(user_id=user.id, post_id=int(pid)))
            db.session.commit()
        except (IntegrityError, TypeError, ValueError):
            db.session.rollback()
            return jsonify(success=False, msg="Already liked."), 400
        BlabberPost.query.filter_by(id=int(pid)).update({BlabberPost.likes: BlabberPost.likes + 1}, synchronize_session=False)
        db.session.commit()
        return jsonify(success=True)

    @bp.route("/api/blabber/report", methods=["POST"])
    @login_required
    def blabber_report():
        user = current_user()
        data = request.get_json(silent=True) or {}
        try:
            pid = int(data.get("post_id") or 0)
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Bad post id."), 400
        p = db.session.get(BlabberPost, pid)
        if not p:
            return jsonify(success=False, msg="No such post."), 404
        if p.author_id == user.id:
            return jsonify(success=False, msg="You can't report your own post."), 400
        if Report.query.filter_by(reporter_id=user.id, target_type="post", target_ref=str(p.id)).first():
            return jsonify(success=False, msg="You already reported this."), 400
        author = db.session.get(User, p.author_id)
        reason = data.get("reason") if data.get("reason") in ("nsfw", "harassment", "scam", "cheating", "other") else "other"
        db.session.add(Report(reporter_id=user.id, target_username=(author.username if author else "unknown"),
                              target_type="post", target_ref=str(p.id), reason=reason,
                              details=_clean(data.get("details"), 500)))
        BlabberPost.query.filter_by(id=p.id).update({BlabberPost.report_count: BlabberPost.report_count + 1}, synchronize_session=False)
        db.session.commit()
        db.session.refresh(p)
        if (p.report_count or 0) >= BLABBER_AUTOHIDE_REPORTS and not p.hidden:
            p.hidden = True
            db.session.commit()
        return jsonify(success=True, msg="Reported. An admin will review it.")

    # ========================================================================
    # NOTEPAD PRO (paid)
    # ========================================================================
    def _np():
        return round(NOTES_PRO_PRICE * price_index(), 2)

    def _has_pro(uid):
        return db.session.get(AppLicense, (uid, "notespro")) is not None

    def _need_pro(uid):
        if not _has_pro(uid):
            return jsonify(success=False, needs_license=True, price=_np(), msg="NOTEPAD PRO license required."), 402
        return None

    def _note_dict(n):
        return dict(id=n.id, title=n.title, body=n.body, tags=n.tags,
                    updated=n.updated_at.strftime("%Y-%m-%d %H:%M"))

    @bp.route("/api/notes/status")
    @login_required
    def notes_status():
        u = current_user()
        return jsonify(success=True, licensed=_has_pro(u.id), price=_np(),
                       limits=dict(notes=NOTES_MAX, chars=NOTE_MAX_CHARS))

    @bp.route("/api/notes/buy", methods=["POST"])
    @login_required
    def notes_buy():
        u = current_user()
        if _has_pro(u.id):
            return jsonify(success=False, msg="Already licensed."), 400
        price_now = _np()
        if not _adjust_balance(u.id, -price_now):
            return jsonify(success=False, msg=f"You need ${price_now:,.2f}."), 400
        try:
            db.session.add(AppLicense(user_id=u.id, app_id="notespro"))
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            _adjust_balance(u.id, price_now)   # refund a racing double-buy
            return jsonify(success=False, msg="Already licensed."), 400
        return jsonify(success=True, msg="NOTEPAD PRO unlocked.")

    @bp.route("/api/notes/list")
    @login_required
    def notes_list():
        u = current_user()
        blocked = _need_pro(u.id)
        if blocked:
            return blocked
        q = (request.args.get("q") or "").strip().lower()
        query = Note.query.filter_by(user_id=u.id)
        if q:
            like = f"%{q}%"
            query = query.filter(func.lower(Note.title).like(like) | func.lower(Note.body).like(like) | func.lower(Note.tags).like(like))
        return jsonify(success=True, notes=[_note_dict(n) for n in query.order_by(Note.updated_at.desc()).limit(NOTES_MAX).all()])

    @bp.route("/api/notes/save", methods=["POST"])
    @login_required
    def notes_save():
        u = current_user()
        blocked = _need_pro(u.id)
        if blocked:
            return blocked
        d = request.get_json(silent=True) or {}
        title, body, tags = _clean(d.get("title"), 80) or "Untitled", str(d.get("body") or "")[:NOTE_MAX_CHARS], _clean(d.get("tags"), 120)
        n = Note.query.filter_by(id=d.get("id"), user_id=u.id).first() if d.get("id") else None
        if not n:
            if Note.query.filter_by(user_id=u.id).count() >= NOTES_MAX:
                return jsonify(success=False, msg=f"Note limit reached ({NOTES_MAX})."), 400
            n = Note(user_id=u.id)
            db.session.add(n)
        n.title, n.body, n.tags, n.updated_at = title, body, tags, _now()
        db.session.commit()
        return jsonify(success=True, note=_note_dict(n))

    @bp.route("/api/notes/delete", methods=["POST"])
    @login_required
    def notes_delete():
        u = current_user()
        Note.query.filter_by(id=(request.get_json(silent=True) or {}).get("id"), user_id=u.id).delete()
        db.session.commit()
        return jsonify(success=True)

    @bp.route("/api/notes/export")
    @login_required
    def notes_export():
        u = current_user()
        blocked = _need_pro(u.id)
        if blocked:
            return blocked
        notes = [dict(title=n.title, body=n.body, tags=n.tags) for n in Note.query.filter_by(user_id=u.id).all()]
        return jsonify(success=True, format="astra-notes-v1", notes=notes)

    @bp.route("/api/notes/import", methods=["POST"])
    @login_required
    def notes_import():
        u = current_user()
        blocked = _need_pro(u.id)
        if blocked:
            return blocked
        items = (request.get_json(silent=True) or {}).get("notes")
        if not isinstance(items, list):
            return jsonify(success=False, msg="Bad file."), 400
        room = NOTES_MAX - Note.query.filter_by(user_id=u.id).count()
        added = 0
        for it in items[:max(0, room)]:
            if not isinstance(it, dict):
                continue
            db.session.add(Note(user_id=u.id, title=_clean(it.get("title"), 80) or "Imported",
                                body=str(it.get("body") or "")[:NOTE_MAX_CHARS], tags=_clean(it.get("tags"), 120)))
            added += 1
        db.session.commit()
        return jsonify(success=True, added=added, msg=f"Imported {added} note(s).")

    # ========================================================================
    # Stats (signed) + sharing
    # ========================================================================
    def _stats_snapshot(user, save):
        rec = _record(user.id)
        return dict(
            operator=user.username, day=getattr(save, "day", 0), balance=round(save.balance or 0, 2),
            credit_score=getattr(save, "credit_score", None), job_status=getattr(save, "job_status", None),
            work_tasks_total=getattr(save, "work_tasks_total", 0) or 0, essays_written=getattr(save, "essays_written", 0) or 0,
            convictions=rec.convictions or 0,
            crimes_succeeded=Offense.query.filter_by(user_id=user.id, outcome="success").count(),
            exported_at=_now().isoformat(timespec="seconds"))

    @bp.route("/api/stats/me")
    @login_required
    def stats_me():
        user = current_user()
        snap = _stats_snapshot(user, get_or_create_save(user))
        payload = json.dumps(snap, sort_keys=True)
        return jsonify(success=True, stats=snap, payload=payload, sig=_sign(payload, secret))

    @bp.route("/api/stats/verify", methods=["POST"])
    @login_required
    def stats_verify():
        d = request.get_json(silent=True) or {}
        ok = hmac.compare_digest(_sign(str(d.get("payload") or ""), secret), str(d.get("sig") or ""))
        return jsonify(success=True, valid=ok)

    @bp.route("/api/share/create", methods=["POST"])
    @login_required
    def share_create():
        user = current_user()
        d = request.get_json(silent=True) or {}
        kind = d.get("kind")
        if kind == "note":
            blocked = _need_pro(user.id)
            if blocked:
                return blocked
            n = Note.query.filter_by(id=d.get("note_id"), user_id=user.id).first()
            if not n:
                return jsonify(success=False, msg="No such note."), 404
            payload = json.dumps(dict(title=n.title, body=n.body, tags=n.tags))
        elif kind == "stats":
            snap = _stats_snapshot(user, get_or_create_save(user))
            p = json.dumps(snap, sort_keys=True)
            payload = json.dumps(dict(payload=p, sig=_sign(p, secret)))
        else:
            return jsonify(success=False, msg="Unknown kind."), 400
        if SharedItem.query.filter(SharedItem.owner_id == user.id, SharedItem.expires_at > _now()).count() >= 50:
            return jsonify(success=False, msg="Too many active share links."), 429
        code = secrets.token_urlsafe(6)
        db.session.add(SharedItem(code=code, owner_id=user.id, owner_name=user.username, kind=kind, payload=payload,
                                  expires_at=_now() + timedelta(days=SHARE_TTL_DAYS)))
        db.session.commit()
        return jsonify(success=True, code=code, expires_days=SHARE_TTL_DAYS)

    @bp.route("/api/share/open", methods=["POST"])
    @login_required
    def share_open():
        item = db.session.get(SharedItem, str((request.get_json(silent=True) or {}).get("code") or "").strip())
        if not item or item.expires_at < _now():
            return jsonify(success=False, msg="That code is invalid or expired."), 404
        return jsonify(success=True, kind=item.kind, from_user=item.owner_name, data=json.loads(item.payload))

    @bp.route("/api/share/import", methods=["POST"])
    @login_required
    def share_import():
        user = current_user()
        blocked = _need_pro(user.id)
        if blocked:
            return blocked
        item = db.session.get(SharedItem, str((request.get_json(silent=True) or {}).get("code") or "").strip())
        if not item or item.expires_at < _now() or item.kind != "note":
            return jsonify(success=False, msg="Only live shared notes can be imported."), 404
        if Note.query.filter_by(user_id=user.id).count() >= NOTES_MAX:
            return jsonify(success=False, msg="Note limit reached."), 400
        d = json.loads(item.payload)
        db.session.add(Note(user_id=user.id, title=_clean(d.get("title"), 70) + " (shared)", body=d.get("body", "")[:NOTE_MAX_CHARS], tags=d.get("tags", "")))
        db.session.commit()
        return jsonify(success=True, msg="Note imported.")

    # ========================================================================
    # ADMIN
    # ========================================================================
    def _log_admin(action, target, detail=""):
        db.session.add(AdminAction(admin_name=current_user().username, action=action, target=str(target)[:64], detail=detail[:300]))
        db.session.commit()

    @bp.route("/api/admin/blabber/queue")
    @admin_required
    def admin_blabber_queue():
        rows = BlabberPost.query.filter((BlabberPost.hidden.is_(True)) | (BlabberPost.flagged.is_(True)) | (BlabberPost.report_count > 0)) \
            .order_by(BlabberPost.id.desc()).limit(100).all()
        return jsonify(success=True, posts=[dict(id=p.id, body=p.body, anonymous=p.anonymous, hidden=p.hidden,
                                                 flagged=p.flagged, reports=p.report_count or 0) for p in rows])

    @bp.route("/api/admin/blabber/<int:pid>/reveal")
    @admin_required
    def admin_blabber_reveal(pid):
        p = db.session.get(BlabberPost, pid)
        if not p:
            return jsonify(success=False, msg="No such post."), 404
        u = db.session.get(User, p.author_id)
        _log_admin("reveal_author", p.id, f"author={u.username if u else '?'}")
        return jsonify(success=True, author=u.username if u else None)

    @bp.route("/api/admin/blabber/<int:pid>/<action>", methods=["POST"])
    @admin_required
    def admin_blabber_act(pid, action):
        p = db.session.get(BlabberPost, pid)
        if not p or action not in ("remove", "restore"):
            return jsonify(success=False, msg="Bad request."), 400
        p.hidden = action == "remove"
        p.flagged = False
        db.session.commit()
        _log_admin(f"blabber_{action}", pid)
        return jsonify(success=True)

    @bp.route("/api/admin/world/jail", methods=["POST"])
    @admin_required
    def admin_jail():
        d = request.get_json(silent=True) or {}
        u = find_user(str(d.get("username") or ""))
        if not u:
            return jsonify(success=False, msg="No such account."), 404
        minutes = max(0, min(int(d.get("minutes") or 0), 1440))
        rec = _record(u.id)
        rec.jail_until = _now() + timedelta(minutes=minutes) if minutes else None
        rec.jail_reason = _clean(d.get("reason"), 120) or "Admin order"
        db.session.commit()
        _log_admin("jail" if minutes else "release", u.username, f"{minutes}min {rec.jail_reason}")
        return jsonify(success=True, msg=f"{u.username}: {minutes} min custody." if minutes else f"{u.username} released.")

    @bp.route("/api/admin/cheatcheck")
    @admin_required
    def admin_cheatcheck():
        """Leads, not verdicts: outliers vs the population plus report/crime context."""
        avg = db.session.query(func.avg(GameSave.balance)).filter(GameSave.active.is_(True)).scalar() or 1
        rows = db.session.query(GameSave, User).join(User, User.id == GameSave.user_id) \
            .filter(GameSave.active.is_(True)).order_by(GameSave.balance.desc()).limit(25).all()
        day_ago = _now() - timedelta(hours=24)
        out = []
        for s, u in rows:
            ratio = (s.balance or 0) / avg if avg else 0
            crimes_24h = Offense.query.filter(Offense.user_id == u.id, Offense.created_at >= day_ago, Offense.outcome == "success").count()
            reps = Report.query.filter_by(target_username=u.username, status="open").count()
            try:   # money-laundering / multi-account lead: how much they pushed to other players today
                from economy import WalletTx
                sent = -(db.session.query(func.coalesce(func.sum(WalletTx.amount_asd), 0.0)).filter(
                    WalletTx.user_id == u.id, WalletTx.kind == "send", WalletTx.created_at >= day_ago).scalar() or 0.0)
            except Exception:
                sent = 0.0
            score = (2 if ratio > 15 else 1 if ratio > 6 else 0) + (2 if crimes_24h > 60 else 0) + min(reps, 3) + (1 if sent > 10000 else 0)
            out.append(dict(username=u.username, balance=round(s.balance or 0, 2), x_avg=round(ratio, 1),
                            crimes_24h=crimes_24h, open_reports=reps, sent_24h=round(sent, 2), suspicion=score))
        out.sort(key=lambda r: r["suspicion"], reverse=True)
        return jsonify(success=True, avg_balance=round(avg, 2), players=out)

    @bp.route("/api/admin/actions")
    @admin_required
    def admin_actions():
        rows = AdminAction.query.order_by(AdminAction.id.desc()).limit(100).all()
        return jsonify(success=True, actions=[dict(admin=r.admin_name, action=r.action, target=r.target, detail=r.detail,
                                                   at=r.created_at.strftime("%Y-%m-%d %H:%M")) for r in rows])

    app.register_blueprint(bp)
    return bp
