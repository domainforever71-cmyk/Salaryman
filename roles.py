"""roles.py - Stage 22: life paths.

Your role decides which apps you get and how the desktop looks.

  unemployed  no job, no business, not underground   -> GIGBOARD + job hunting
  employee    job_status employed / employed_player  -> HR PORTAL + work apps
  boss        job_status business_owner              -> BOARDROOM + company apps
  criminal    chose the underground (or committed a crime) -> UNDERWORLD
  kingpin     underground AND business_owner         -> both, plus the RACKET

"Custody" is a status on top of any role (from world.CriminalRecord.jail_until),
not a role of its own.

Storage: one small table (RoleState). Everything money-related goes through
world._adjust_balance so it is atomic like the rest of the economy.

Wire-up (after init_world / init_economy in app.py):

    from roles import init_roles
    init_roles(app, login_required, current_user, get_or_create_save, price_index=cpi)
"""
import random
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from models import db, User, GameSave
import world
from world import (CriminalRecord, Offense, CRIMES, _record, _current_wanted,
                   _jail_seconds_left, _adjust_balance, _rules)

GIG_COOLDOWN_S = 12
BENEFIT_COOLDOWN_MIN = 8
RAISE_COOLDOWN_MIN = 15
RACKET_COOLDOWN_MIN = 10
FIXER_COST_PER_HEAT = 400.0

GIGS = {
    "flyers":   dict(label="Hand out flyers",        pay=(18, 45),   note="Feet hurt. Nobody reads them."),
    "delivery": dict(label="Deliver parcels",        pay=(30, 80),   note="Tips are a rumour."),
    "survey":   dict(label="Paid online surveys",    pay=(12, 30),   note="Forty minutes for the price of a coffee."),
    "dataentry": dict(label="Data entry",            pay=(40, 95),   note="Copy numbers from one box to another."),
    "tutor":    dict(label="Tutor a broker's kid",   pay=(70, 160),  note="They know more than you do."),
}


class RoleState(db.Model):
    __tablename__ = "role_state"
    user_id = db.Column(db.Integer, primary_key=True)
    underworld = db.Column(db.Boolean, default=False)
    gig_at = db.Column(db.DateTime)
    benefit_at = db.Column(db.DateTime)
    raise_at = db.Column(db.DateTime)
    racket_at = db.Column(db.DateTime)
    gigs_done = db.Column(db.Integer, default=0)


def _now():
    return datetime.utcnow()


def _state(user_id):
    st = db.session.get(RoleState, user_id)
    if not st:
        st = RoleState(user_id=user_id, underworld=False, gigs_done=0)
        db.session.add(st)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            st = db.session.get(RoleState, user_id)
    return st


def role_of(job_status, underworld):
    boss = job_status == "business_owner"
    if underworld and boss:
        return "kingpin"
    if underworld:
        return "criminal"
    if boss:
        return "boss"
    if job_status in ("employed", "employed_player"):
        return "employee"
    return "unemployed"


def _claim(user_id, column, seconds):
    """Atomic cooldown claim on a RoleState datetime column. True if we won."""
    cutoff = _now() - timedelta(seconds=seconds)
    col = getattr(RoleState, column)
    n = RoleState.query.filter(RoleState.user_id == user_id, (col.is_(None)) | (col < cutoff)) \
        .update({column: _now()}, synchronize_session=False)
    db.session.commit()
    return n == 1


def _left(user_id, column, seconds):
    at = db.session.query(getattr(RoleState, column)).filter(RoleState.user_id == user_id).scalar()
    if not at:
        return 0
    return max(0, int(seconds - (_now() - at).total_seconds()))


def init_roles(app, login_required, current_user, get_or_create_save, price_index=lambda: 1.0):
    bp = Blueprint("roles", __name__)

    with app.app_context():
        db.create_all()

    def _ctx(user):
        save = get_or_create_save(user)
        st = _state(user.id)
        rec = _record(user.id)
        role = role_of(save.job_status, bool(st.underworld))
        regime, rules = _rules()
        return save, st, rec, role, regime, rules

    # Any successful crime pulls you underground, wherever it was committed
    # from (CIVICS or UNDERWORLD).
    @app.after_request
    def _mark_underworld(resp):
        try:
            if request.path == "/api/world/crime" and request.method == "POST" and resp.status_code == 200:
                user = current_user()
                if user is not None:
                    st = _state(user.id)
                    if not st.underworld:
                        st.underworld = True
                        db.session.commit()
        except Exception:
            db.session.rollback()
        return resp

    JAILED_BLOCK = ("/api/role/gig", "/api/role/benefit", "/api/role/raise", "/api/role/racket", "/api/role/fixer")

    @app.before_request
    def _custody_gate():
        if request.method == "POST" and request.path in JAILED_BLOCK:
            user = current_user()
            if user is not None and _jail_seconds_left(user.id) > 0:
                return jsonify(success=False, jailed=True, msg="You're in custody."), 403

    @bp.route("/api/role")
    @login_required
    def role_info():
        user = current_user()
        save, st, rec, role, regime, rules = _ctx(user)
        jail = _jail_seconds_left(user.id)
        recent = Offense.query.filter_by(user_id=user.id).order_by(Offense.id.desc()).limit(8).all()
        return jsonify(
            success=True, role=role, underworld=bool(st.underworld), active=bool(save.active),
            job_status=save.job_status, job_title=save.job_title, company=save.company_name,
            salary=save.salary, boss_mood=save.boss_mood, balance=save.balance,
            wanted=round(_current_wanted(rec), 2), convictions=rec.convictions or 0,
            jailed=jail > 0, jail_seconds_left=jail, jail_reason=rec.jail_reason if jail > 0 else "",
            regime=regime, regime_label=rules["label"],
            gigs_done=st.gigs_done or 0,
            cooldowns=dict(gig=_left(user.id, "gig_at", GIG_COOLDOWN_S),
                           benefit=_left(user.id, "benefit_at", BENEFIT_COOLDOWN_MIN * 60),
                           raise_=_left(user.id, "raise_at", RAISE_COOLDOWN_MIN * 60),
                           racket=_left(user.id, "racket_at", RACKET_COOLDOWN_MIN * 60)),
            gigs={k: dict(label=v["label"], pay=v["pay"], note=v["note"]) for k, v in GIGS.items()},
            crimes={k: dict(label=v["label"], severity=v["severity"], reward=v["reward"],
                            catch=v["catch"], jail_min=v["jail_min"]) for k, v in CRIMES.items()},
            offenses=[dict(crime=o.crime, outcome=o.outcome, amount=round(o.amount or 0, 2),
                           at=o.created_at.strftime("%H:%M:%S") if o.created_at else "") for o in recent])

    @bp.route("/api/role/path", methods=["POST"])
    @login_required
    def role_path():
        user = current_user()
        save, st, rec, role, _, _ = _ctx(user)
        choice = (request.get_json(silent=True) or {}).get("choice")
        if _jail_seconds_left(user.id) > 0:
            return jsonify(success=False, msg="You're in custody."), 403
        if choice == "underworld":
            st.underworld = True
            msg = "You know a guy now. Welcome to the underworld."
        elif choice == "legit":
            if _current_wanted(rec) >= 2:
                return jsonify(success=False, msg="Too hot. Lay low (or pay the FIXER) before going straight."), 400
            st.underworld = False
            msg = "You walk away from the life. For now."
        else:
            return jsonify(success=False, msg="Unknown choice."), 400
        db.session.commit()
        return jsonify(success=True, msg=msg, role=role_of(save.job_status, bool(st.underworld)))

    # ---- UNEMPLOYED: GIGBOARD ---------------------------------------------
    @bp.route("/api/role/gig", methods=["POST"])
    @login_required
    def role_gig():
        user = current_user()
        save, st, rec, role, _, _ = _ctx(user)
        if role != "unemployed":
            return jsonify(success=False, msg="Gigs are for people between jobs."), 403
        if not save.active:
            return jsonify(success=False, msg="Start a game first."), 400
        gig = GIGS.get((request.get_json(silent=True) or {}).get("gig"))
        if not gig:
            return jsonify(success=False, msg="Unknown gig."), 400
        if not _claim(user.id, "gig_at", GIG_COOLDOWN_S):
            return jsonify(success=False, msg=f"Catch your breath ({GIG_COOLDOWN_S}s between gigs)."), 429
        pay = round(random.uniform(*gig["pay"]) * price_index(), 2)
        _adjust_balance(user.id, pay)
        RoleState.query.filter_by(user_id=user.id).update({RoleState.gigs_done: RoleState.gigs_done + 1},
                                                          synchronize_session=False)
        db.session.commit()
        return jsonify(success=True, amount=pay, msg=f"{gig['label']}: +${pay:,.2f}. {gig['note']}")

    @bp.route("/api/role/benefit", methods=["POST"])
    @login_required
    def role_benefit():
        user = current_user()
        save, st, rec, role, regime, rules = _ctx(user)
        if role != "unemployed":
            return jsonify(success=False, msg="Benefits are for the unemployed."), 403
        if not save.active:
            return jsonify(success=False, msg="Start a game first."), 400
        if not _claim(user.id, "benefit_at", BENEFIT_COOLDOWN_MIN * 60):
            return jsonify(success=False, msg="Come back later, the office is closed."), 429
        amt = round(60 * (1 + 4 * rules["redistribution_rate"]) * price_index(), 2)
        _adjust_balance(user.id, amt)
        return jsonify(success=True, amount=amt, msg=f"{rules['label']} benefit: +${amt:,.2f}.")

    # ---- EMPLOYEE: HR PORTAL ----------------------------------------------
    @bp.route("/api/role/raise", methods=["POST"])
    @login_required
    def role_raise():
        user = current_user()
        save, st, rec, role, _, _ = _ctx(user)
        if save.job_status != "employed" or role not in ("employee", "criminal"):
            return jsonify(success=False, msg="Raises are negotiated with an NPC firm's HR."), 403
        if not _claim(user.id, "raise_at", RAISE_COOLDOWN_MIN * 60):
            return jsonify(success=False, msg="You already asked recently. Don't push it."), 429
        mood = max(0, min(100, save.boss_mood or 0))
        if random.random() < 0.15 + 0.55 * (mood / 100.0):
            bump = random.uniform(0.05, 0.10)
            new = round(save.salary * (1 + bump), 2)
            GameSave.query.filter_by(user_id=user.id).update({GameSave.salary: new}, synchronize_session=False)
            db.session.commit()
            return jsonify(success=True, granted=True, salary=new, msg=f"Approved: salary now ${new:,.2f} (+{bump*100:.1f}%).")
        GameSave.query.filter_by(user_id=user.id).update(
            {GameSave.boss_mood: max(0, mood - 10)}, synchronize_session=False)
        db.session.commit()
        return jsonify(success=True, granted=False, msg="Denied. Your boss is less fond of you now (mood -10).")

    # ---- BOSS: BOARDROOM ---------------------------------------------------
    @bp.route("/api/role/boardroom")
    @login_required
    def role_boardroom():
        user = current_user()
        save, st, rec, role, _, _ = _ctx(user)
        if role not in ("boss", "kingpin"):
            return jsonify(success=False, msg="Executives only."), 403
        staff = GameSave.query.filter_by(employer_user_id=user.id, job_status="employed_player").all()
        names = {u.id: u.username for u in User.query.filter(User.id.in_([s.user_id for s in staff] or [0])).all()}
        return jsonify(
            success=True, cash=save.balance, capital=save.business_capital, daily_profit=save.daily_profit,
            day=save.day, founded_day=save.business_started_day, company=save.company_name,
            hiring_open=bool(save.hiring_open), hiring_role=save.hiring_role, hiring_salary=save.hiring_salary,
            staff=[dict(name=names.get(s.user_id, "?"), title=s.job_title, salary=s.salary) for s in staff],
            payroll=round(sum(s.salary or 0 for s in staff), 2), racket_left=_left(user.id, "racket_at", RACKET_COOLDOWN_MIN * 60))

    # ---- CRIMINAL: FIXER, KINGPIN: RACKET -----------------------------------
    @bp.route("/api/role/fixer", methods=["POST"])
    @login_required
    def role_fixer():
        user = current_user()
        save, st, rec, role, _, _ = _ctx(user)
        if role not in ("criminal", "kingpin"):
            return jsonify(success=False, msg="You don't know anyone like that."), 403
        heat = _current_wanted(rec)
        if heat < 0.5:
            return jsonify(success=False, msg="You're already clean. The fixer laughs at you."), 400
        cut = min(heat, 3.0)
        cost = round(cut * FIXER_COST_PER_HEAT * price_index() * (0.5 if role == "kingpin" else 1.0), 2)
        if not _adjust_balance(user.id, -cost):
            return jsonify(success=False, msg=f"The fixer wants ${cost:,.2f} up front."), 400
        rec.wanted = max(0.0, heat - cut)
        rec.wanted_at = _now()
        db.session.commit()
        return jsonify(success=True, cost=cost, msg=f"Paid ${cost:,.2f}. Heat -{cut:.1f}.")

    @bp.route("/api/role/racket", methods=["POST"])
    @login_required
    def role_racket():
        user = current_user()
        save, st, rec, role, _, _ = _ctx(user)
        if role != "kingpin":
            return jsonify(success=False, msg="You need a company and a reputation."), 403
        if _jail_seconds_left(user.id) > 0:
            return jsonify(success=False, msg="You're in custody."), 403
        if not _claim(user.id, "racket_at", RACKET_COOLDOWN_MIN * 60):
            return jsonify(success=False, msg="The neighbourhood has already paid this round."), 429
        heads = GameSave.query.filter_by(employer_user_id=user.id, job_status="employed_player").count()
        amt = round(150 * (1 + heads) * price_index(), 2)
        _adjust_balance(user.id, amt)
        rec.wanted = _current_wanted(rec) + 1.5
        rec.wanted_at = _now()
        db.session.commit()
        return jsonify(success=True, amount=amt, msg=f"Tribute collected: +${amt:,.2f}. Heat +1.5.")

    app.register_blueprint(bp)
