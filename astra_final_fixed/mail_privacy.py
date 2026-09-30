"""mail_privacy.py - Stage 25: PRIVACY and MAIL.

Wire-up (already in app.py, after init_desk):

    from mail_privacy import init_mail_privacy
    init_mail_privacy(app, login_required, current_user, get_or_create_save, price_index=cpi,
                      log_event=log_event)

How findable you are decides what lands in your inbox:

    exposure = board + profile + mail-policy + filter baseline  +  5 per live data-broker listing

Listings accumulate on their own over time (lazily, on each status/inbox fetch). More
exposure means more of the incoming mail is phishing, and better disguised. Clicking a
phish costs money (two-factor halves it); reporting correctly raises your security score.

Serves static/astra_stage25_privacy.js and static/astra_stage25_mail.js:
    GET  /api/privacy/status
    POST /api/privacy/settings | /twofa | /relay | /delist
    GET  /api/mail/inbox
    POST /api/mail/read | /act | /report | /delete
The server never tells the client what a message really is until the player has acted on it.
"""
import json
import random
import time
from datetime import datetime

from flask import Blueprint, jsonify, request

from models import db

# ---- tuning ------------------------------------------------------------------
OPTIONS = {
    "board":   {"public": 30, "alias": 15, "hidden": 0},
    "profile": {"public": 20, "friends": 10, "private": 0},
    "mail":    {"anyone": 25, "contacts": 10, "nobody": 0},
    "filter":  {"off": 10, "standard": 5, "strict": 0},
}
DEFAULTS = {"board": "public", "profile": "friends", "mail": "contacts", "filter": "standard"}
BROKER_CAP = 8
BROKER_EXPOSURE = 5
BROKER_STEP_S = 300            # one growth roll per 5 minutes of real time
BROKER_MAX_ROLLS = 12
RELAY_HALF_S = 600
RELAY_COOLDOWN_S = 120
DELIST_BASE = 25.0

MAIL_GEN_GAP_S = 40            # one generation pass at most this often
MAIL_MAX_PER_PASS = 4
INBOX_CAP = 40
SPAM_CAP = 25
UNSOLICITED_MULT = {"anyone": 1.0, "contacts": 0.5, "nobody": 0.15}
FILTER_CATCH = {"off": (0.0, 0.0), "standard": (0.55, 0.35), "strict": (0.92, 0.70)}   # (spam, phish)
FILTER_FALSE_POSITIVE = {"off": 0.0, "standard": 0.03, "strict": 0.15}

BANK = "astrabank.example"
WIKI = "astrawiki.example"
HR = "payroll.astra-tech.example"


# =============================================================================
# Models
# =============================================================================
class PrivacyState(db.Model):
    __tablename__ = "privacy_state"
    user_id = db.Column(db.Integer, primary_key=True)
    settings_json = db.Column(db.Text, default="{}")
    twofa = db.Column(db.Boolean, default=False)
    brokers = db.Column(db.Integer, default=0)
    broker_ts = db.Column(db.Float, default=0.0)
    relay_until = db.Column(db.Float, default=0.0)
    relay_ready = db.Column(db.Float, default=0.0)
    clicked = db.Column(db.Integer, default=0)
    reported = db.Column(db.Integer, default=0)
    false_reports = db.Column(db.Integer, default=0)
    mail_ts = db.Column(db.Float, default=0.0)


class MailMsg(db.Model):
    __tablename__ = "mail_msgs"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    folder = db.Column(db.String(8), default="inbox")        # inbox | spam
    kind = db.Column(db.String(8), nullable=False)           # phish | spam | legit (server-side truth)
    from_name = db.Column(db.String(80))
    from_addr = db.Column(db.String(120))
    reply_to = db.Column(db.String(120))
    subject = db.Column(db.String(160))
    body = db.Column(db.Text)
    link_label = db.Column(db.String(120))
    link_shown = db.Column(db.String(200))
    open_app = db.Column(db.String(24))
    tells_json = db.Column(db.Text, default="[]")
    read = db.Column(db.Boolean, default=False)
    state = db.Column(db.String(10), default="new")          # new | clicked | reported | deleted
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# =============================================================================
# Content
# =============================================================================
def _phish_templates(q, name, job, addr):
    """q: 0 sloppy, 1 plausible, 2 targeted. Returns a list of candidate dicts."""
    greet = "Dear Customer," if q == 0 else f"Hi {name},"
    lookalike = {0: f"astra-bank-secure-login.net", 1: "astrabank-secure.example", 2: "astrabnak.example"}[q]
    sub_trick = f"{BANK}.verify-session.net"
    mismatch = {0: "support@gmail-helpdesk.net", 1: "help@astrabank-secure.example", 2: None}[q]
    pressure = {0: "URGENT!!! Your account will be CLOSED within 24 hours.",
                1: "Your account has been temporarily limited. Verify within 24 hours to avoid closure.",
                2: "We flagged a transfer from your account and paused it. Confirm within the hour so it isn't reversed."}[q]
    detail = ("" if q < 2 else f"\n\nThis affects your {job} profile and the payroll deposit due this week.")
    tells_common = []
    if q == 0:
        tells_common += ["Generic greeting: a real bank knows your name.",
                         "Shouting and threats: manufactured urgency is the oldest trick there is."]
    elif q == 1:
        tells_common += ["Artificial deadline pushing you to act before you think."]
    else:
        tells_common += ["The deadline is the hook: 'within the hour' is there to stop you checking."]

    def T(*extra):
        return tells_common + list(extra)

    out = [
        dict(from_name="AstraBank Security", from_addr=f"security@{lookalike}",
             reply_to=mismatch or f"security@{lookalike}",
             subject={0: "URGENT: verify you're account now", 1: "Action required: account limited",
                      2: f"{name}, transfer on hold - confirm now"}[q],
             body=f"{greet}\n\n{pressure}{detail}\n\nSign in below to keep access.",
             link_label="Verify account", link_shown=f"https://{lookalike}/login" if q < 2 else f"https://{sub_trick}/session",
             open_app="app:bank",
             tells=T(f"Sender domain is {lookalike}, not {BANK}." if q < 2 else f"The link's real host is verify-session.net; {BANK} is only a decoy prefix.",
                     *(["Reply-To points to a different domain than the sender."] if mismatch else []))),
        dict(from_name="Astra Payroll", from_addr=f"noreply@{HR.replace('payroll', 'payrol1')}",
             reply_to=f"noreply@{HR.replace('payroll', 'payrol1')}",
             subject="Your direct deposit details need re-confirming" if q else "payment problem - action nessesary",
             body=f"{greet}\n\nWe could not process your last deposit. Re-enter your banking details to receive it." + detail,
             link_label="Update deposit details", link_shown=f"https://{HR.replace('payroll', 'payrol1')}/update",
             open_app="app:bank",
             tells=T("'payrol1' has a digit one where the 'l' should be.",
                     "Payroll never asks you to re-enter banking details from an email link.")),
        dict(from_name="ASTRAWIKI Certificates", from_addr=f"certs@{WIKI.replace('astrawiki', 'astra-wiki')}",
             reply_to=f"certs@{WIKI.replace('astrawiki', 'astra-wiki')}",
             subject="Your certificate is about to be revoked",
             body=f"{greet}\n\nYour Brokerage 101 certificate failed re-validation. Pay a $49 reinstatement fee to keep trading.",
             link_label="Pay reinstatement fee", link_shown=f"https://{WIKI.replace('astrawiki', 'astra-wiki')}/pay",
             open_app="app:wiki",
             tells=T("Certificates are earned by passing exams, never reinstated by paying a fee.",
                     f"The domain is astra-wiki, not {WIKI}.")),
    ]
    return out


def _spam_templates():
    return [
        dict(from_name="Crypto Kings", from_addr="win@moonshot-mailer.biz", subject="10x your balance by FRIDAY",
             body="Insiders are buying. You could be too. Reply YES for the guaranteed pick.",
             link_label="See the pick", link_shown="http://moonshot-mailer.biz/pick",
             tells=["Guaranteed returns do not exist.", "You never signed up for this list."]),
        dict(from_name="Deals4U", from_addr="promo@deals4u-blast.net", subject="You've been selected!!",
             body="One lucky trader wins a free terminal upgrade. Claim before midnight.",
             link_label="Claim prize", link_shown="http://deals4u-blast.net/claim",
             tells=["A prize for a contest you never entered.", "Bulk-mail sender with no relationship to you."]),
        dict(from_name="Wealth Webinar", from_addr="host@richquick-academy.co", subject="Quit your job: free webinar",
             body="Learn the one weird trick brokers hate. Seats are limited.",
             link_label="Save my seat", link_shown="http://richquick-academy.co/seat",
             tells=["'One weird trick' pitches are the mark of junk mail.", "Unsolicited and it wants your details."]),
    ]


def _legit_templates(name, job):
    return [
        dict(from_name="AstraBank", from_addr=f"statements@{BANK}", reply_to=f"statements@{BANK}",
             subject="Your monthly statement is ready",
             body=f"Hi {name},\n\nYour latest statement is available in your bank app. We will never ask for your PIN or password by email.",
             link_label="Open bank", link_shown="Opens your AstraBank app (no login form)", open_app="app:bank",
             tells=[f"Sent from {BANK}, the real domain.", "Nothing urgent, no credentials requested, no threat."]),
        dict(from_name="ASTRAWIKI", from_addr=f"learn@{WIKI}", reply_to=f"learn@{WIKI}",
             subject="New article: Position sizing basics",
             body="A new lesson went up in ASTRAWIKI. Read it any time; certificates are earned by passing exams in the app.",
             link_label="Open ASTRAWIKI", link_shown="Opens ASTRAWIKI in this desktop", open_app="app:wiki",
             tells=[f"Sender domain is {WIKI}.", "It points you into the app you already have instead of asking for details."]),
        dict(from_name="Astra Payroll", from_addr=f"noreply@{HR}", reply_to=f"noreply@{HR}",
             subject="Payslip available", body=f"Hi {name},\n\nYour payslip for the {job} role is ready. Nothing to do.",
             link_label=None, link_shown=None, open_app=None,
             tells=[f"Exact domain match ({HR}).", "No link, no action needed, no pressure."]),
    ]


# =============================================================================
# Wire-up
# =============================================================================
def init_mail_privacy(app, login_required, current_user, get_or_create_save, price_index=lambda: 1.0,
                      log_event=lambda m: None):
    bp = Blueprint("mail_privacy", __name__)

    with app.app_context():
        db.create_all()

    # ---- state / exposure -----------------------------------------------------
    def _cpi():
        try:
            return float(price_index())
        except Exception:
            return 1.0

    def _state(uid):
        row = db.session.get(PrivacyState, uid)
        if not row:
            row = PrivacyState(user_id=uid, settings_json=json.dumps(DEFAULTS), broker_ts=time.time())
            db.session.add(row)
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
                row = db.session.get(PrivacyState, uid)
        return row

    def _settings(row):
        try:
            s = json.loads(row.settings_json or "{}")
        except Exception:
            s = {}
        return {k: (s.get(k) if s.get(k) in OPTIONS[k] else DEFAULTS[k]) for k in OPTIONS}

    def _baseline(s):
        return sum(OPTIONS[k][s[k]] for k in OPTIONS)

    def _exposure(row):
        s = _settings(row)
        return max(0, min(100, _baseline(s) + (row.brokers or 0) * BROKER_EXPOSURE))

    def _score(row, exposure):
        v = (100 - exposure * 0.6 + (10 if row.twofa else 0) + (row.reported or 0) * 3
             - (row.clicked or 0) * 8 - (row.false_reports or 0) * 2)
        return int(max(0, min(100, round(v))))

    def _grow_brokers(row):
        """Lazy accumulation: one roll per BROKER_STEP_S elapsed since the last accounting."""
        now = time.time()
        if not row.broker_ts:
            row.broker_ts = now
            return
        rolls = int((now - row.broker_ts) // BROKER_STEP_S)
        if rolls <= 0:
            return
        s = _settings(row)
        base = _baseline(s) / 100.0
        p = 0.10 + base * 0.6
        added = 0
        for i in range(min(rolls, BROKER_MAX_ROLLS)):
            step_time = row.broker_ts + (i + 1) * BROKER_STEP_S
            pp = p * (0.5 if step_time < (row.relay_until or 0) else 1.0)
            if (row.brokers or 0) + added < BROKER_CAP and random.random() < pp:
                added += 1
        row.brokers = min(BROKER_CAP, (row.brokers or 0) + added)
        row.broker_ts += rolls * BROKER_STEP_S
        if rolls > BROKER_MAX_ROLLS:                     # long absence: don't backfill forever
            row.broker_ts = now

    def _status(row):
        exposure = _exposure(row)
        return {"success": True, "exposure": exposure, "score": _score(row, exposure),
                "settings": _settings(row), "twofa": bool(row.twofa), "brokers": row.brokers or 0,
                "broker_cap": BROKER_CAP, "clicked": row.clicked or 0, "reported": row.reported or 0,
                "false_reports": row.false_reports or 0}

    # ---- privacy routes -------------------------------------------------------
    @bp.route("/api/privacy/status")
    @login_required
    def privacy_status():
        row = _state(current_user().id)
        _grow_brokers(row)
        db.session.commit()
        return jsonify(_status(row))

    @bp.route("/api/privacy/settings", methods=["POST"])
    @login_required
    def privacy_settings():
        row = _state(current_user().id)
        data = request.get_json(silent=True) or {}
        s = _settings(row)
        for k in OPTIONS:
            if k in data:
                if data[k] not in OPTIONS[k]:
                    return jsonify(success=False, msg="Invalid option."), 400
                s[k] = data[k]
        row.settings_json = json.dumps(s)
        db.session.commit()
        return jsonify(_status(row))

    @bp.route("/api/privacy/twofa", methods=["POST"])
    @login_required
    def privacy_twofa():
        row = _state(current_user().id)
        row.twofa = bool((request.get_json(silent=True) or {}).get("on"))
        db.session.commit()
        return jsonify(_status(row))

    @bp.route("/api/privacy/relay", methods=["POST"])
    @login_required
    def privacy_relay():
        row = _state(current_user().id)
        now = time.time()
        if now < (row.relay_ready or 0):
            wait = int(row.relay_ready - now)
            return jsonify(success=False, msg=f"Relay is cooling down ({wait}s).")
        removed = 0
        if (row.brokers or 0) > 0:
            row.brokers -= 1
            removed = 1
        row.relay_until = now + RELAY_HALF_S
        row.relay_ready = now + RELAY_COOLDOWN_S
        db.session.commit()
        out = _status(row)
        out["msg"] = ("Relay pass closed a leak point." if removed else "Relay is up.") + " New listings grow at half speed for 10 minutes."
        return jsonify(out)

    @bp.route("/api/privacy/delist", methods=["POST"])
    @login_required
    def privacy_delist():
        user = current_user()
        save = get_or_create_save(user)
        row = _state(user.id)
        if (row.brokers or 0) <= 0:
            return jsonify(success=False, msg="No live listings to remove.")
        cost = round(DELIST_BASE * _cpi(), 2)
        if (save.balance or 0.0) < cost:
            return jsonify(success=False, msg=f"A delisting costs ${cost:,.2f}. You're short.")
        save.balance = round(save.balance - cost, 2)
        row.brokers -= 1
        db.session.commit()
        log_event(f"{user.username}: paid ${cost:,.2f} to scrub a data-broker listing")
        out = _status(row)
        out["msg"] = f"Listing removed for ${cost:,.2f}."
        return jsonify(out)

    # ---- mail generation ------------------------------------------------------
    def _make(uid, save, user, exposure, s, force=None):
        name = (save.name or user.username or "Operator").split(" ")[0]
        job = save.job_title or "broker"
        q = 0 if exposure < 35 else (1 if exposure < 66 else 2)
        p_phish = 0.10 + exposure / 100.0 * 0.50
        p_spam = 0.20 + exposure / 100.0 * 0.15
        roll = random.random()
        kind = force or ("phish" if roll < p_phish else "spam" if roll < p_phish + p_spam else "legit")
        if kind == "phish":
            t = random.choice(_phish_templates(q, name, job, ""))
        elif kind == "spam":
            t = random.choice(_spam_templates())
        else:
            t = random.choice(_legit_templates(name, job))
        # Filter: catches unsolicited mail, occasionally swallows real mail.
        c_spam, c_phish = FILTER_CATCH[s["filter"]]
        folder = "inbox"
        if kind == "spam" and random.random() < c_spam:
            folder = "spam"
        elif kind == "phish" and random.random() < c_phish:
            folder = "spam"
        elif kind == "legit" and random.random() < FILTER_FALSE_POSITIVE[s["filter"]]:
            folder = "spam"
        m = MailMsg(user_id=uid, folder=folder, kind=kind, from_name=t["from_name"], from_addr=t["from_addr"],
                    reply_to=t.get("reply_to") or t["from_addr"], subject=t["subject"], body=t["body"],
                    link_label=t.get("link_label"), link_shown=t.get("link_shown"), open_app=t.get("open_app"),
                    tells_json=json.dumps(t.get("tells") or []))
        db.session.add(m)
        return m

    def _generate(user, save, row):
        now = time.time()
        first = not row.mail_ts
        if not first and now - row.mail_ts < MAIL_GEN_GAP_S:
            return
        s = _settings(row)
        exposure = _exposure(row)
        elapsed = MAIL_GEN_GAP_S * 2 if first else now - row.mail_ts
        n = int(min(MAIL_MAX_PER_PASS, max(1, elapsed // MAIL_GEN_GAP_S)))
        if first:
            n = 3
        made = 0
        for _ in range(n):
            # Legit mail always flows; unsolicited mail is throttled by who may mail you.
            if random.random() < UNSOLICITED_MULT[s["mail"]] or first and made == 0:
                _make(user.id, save, user, exposure, s, force="legit" if (first and made == 0) else None)
                made += 1
            elif random.random() < 0.35:
                _make(user.id, save, user, exposure, s, force="legit")
                made += 1
        row.mail_ts = now
        db.session.flush()
        # Trim folders.
        for folder, cap in (("inbox", INBOX_CAP), ("spam", SPAM_CAP)):
            rows = (MailMsg.query.filter(MailMsg.user_id == user.id, MailMsg.folder == folder, MailMsg.state != "deleted")
                    .order_by(MailMsg.id.desc()).all())
            for old in rows[cap:]:
                old.state = "deleted"

    def _public(m):
        d = {"id": m.id, "read": bool(m.read), "at": m.created_at.strftime("%H:%M"), "from_name": m.from_name,
             "from_addr": m.from_addr, "reply_to": m.reply_to, "subject": m.subject, "body": m.body,
             "kind": (m.kind if m.state in ("clicked", "reported") else None),
             "link": ({"label": m.link_label, "shown": m.link_shown} if m.link_label else None)}
        return d

    @bp.route("/api/mail/inbox")
    @login_required
    def mail_inbox():
        user = current_user()
        save = get_or_create_save(user)
        row = _state(user.id)
        _grow_brokers(row)
        if save.active:
            _generate(user, save, row)
        db.session.commit()

        def folder(name):
            return [_public(m) for m in MailMsg.query.filter(MailMsg.user_id == user.id, MailMsg.folder == name,
                                                             MailMsg.state != "deleted")
                    .order_by(MailMsg.id.desc()).all() if m.state != "reported"]
        inbox, spam = folder("inbox"), folder("spam")
        return jsonify(success=True, inbox=inbox, spam=spam, unread=sum(1 for m in inbox if not m["read"]))

    def _mine(mid):
        try:
            mid = int(mid)
        except (TypeError, ValueError):
            return None
        return MailMsg.query.filter_by(id=mid, user_id=current_user().id).first()

    @bp.route("/api/mail/read", methods=["POST"])
    @login_required
    def mail_read():
        m = _mine((request.get_json(silent=True) or {}).get("id"))
        if m:
            m.read = True
            db.session.commit()
        return jsonify(success=bool(m))

    @bp.route("/api/mail/delete", methods=["POST"])
    @login_required
    def mail_delete():
        m = _mine((request.get_json(silent=True) or {}).get("id"))
        if not m:
            return jsonify(success=False), 404
        m.state = "deleted"
        db.session.commit()
        return jsonify(success=True)

    @bp.route("/api/mail/act", methods=["POST"])
    @login_required
    def mail_act():
        user = current_user()
        m = _mine((request.get_json(silent=True) or {}).get("id"))
        if not m or not m.link_label:
            return jsonify(success=False, msg="Nothing to open."), 404
        if m.state in ("clicked", "reported"):
            return jsonify(success=True, msg="You already dealt with this message.", tells=json.loads(m.tells_json or "[]"))
        save = get_or_create_save(user)
        row = _state(user.id)
        tells = json.loads(m.tells_json or "[]")
        m.state, m.read = "clicked", True
        out = {"success": True, "tells": tells}
        if m.kind == "phish":
            row.clicked = (row.clicked or 0) + 1
            bal = max(0.0, save.balance or 0.0)
            loss = max(25.0 * _cpi(), bal * random.uniform(0.05, 0.14))
            loss = round(min(loss, bal * 0.5, bal), 2)
            half = bool(row.twofa)
            if half:
                loss = round(loss / 2, 2)
            save.balance = round(bal - loss, 2)
            log_event(f"{user.username}: fell for a phishing email (-${loss:,.2f})")
            out.update(loss=loss, msg=("That was a phish. Two-factor stopped half of it." if half
                                       else "That was a phish. Turn on two-factor to halve the damage next time."))
        elif m.kind == "spam":
            row.brokers = min(BROKER_CAP, (row.brokers or 0) + 1)
            out["msg"] = "You confirmed your address is live. A new data-broker listing appeared."
        else:
            out["msg"] = "Legitimate message. Nothing bad happened."
            if m.open_app:
                out["open_app"] = m.open_app
        db.session.commit()
        return jsonify(out)

    @bp.route("/api/mail/report", methods=["POST"])
    @login_required
    def mail_report():
        user = current_user()
        m = _mine((request.get_json(silent=True) or {}).get("id"))
        if not m:
            return jsonify(success=False, msg="Message not found."), 404
        row = _state(user.id)
        tells = json.loads(m.tells_json or "[]")
        if m.state == "clicked":
            m.state = "reported"
            db.session.commit()
            return jsonify(success=True, tells=tells, msg="Reported, but you had already clicked. It counts for nothing.")
        if m.state == "reported":
            return jsonify(success=True, tells=tells, msg="Already reported.")
        m.state, m.read = "reported", True
        if m.kind in ("phish", "spam"):
            row.reported = (row.reported or 0) + 1
            msg = ("Correct: that was phishing. Security score up." if m.kind == "phish"
                   else "Correct: that was spam. Security score up.")
            db.session.commit()
            return jsonify(success=True, msg=msg, tells=tells)
        row.false_reports = (row.false_reports or 0) + 1
        db.session.commit()
        return jsonify(success=True, msg="False report: that message was legitimate. Here is how you could tell.",
                       tells=tells)

    app.register_blueprint(bp)
