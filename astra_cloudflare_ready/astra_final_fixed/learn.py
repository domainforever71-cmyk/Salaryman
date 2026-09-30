"""learn.py - Stage 24: ASTRAWIKI, certificates and knowledge gates.

Wire-up (after init_roles in app.py):

    from learn import init_learn
    init_learn(app, login_required, current_user, get_or_create_save, price_index=cpi)

Gates are enforced server-side in a before_request hook, so no client can skip them:
    POST /api/game/apply_job        needs  basics
    POST /api/game/bank/loan        needs  credit
    POST /api/game/trade_share      needs  broker   (qty > RETAIL_CAP also needs risk)
    POST /api/coop/trade_share      same
"""
import json
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from models import db
from world import _adjust_balance
import learn_core as core

GATES = {
    "/api/game/apply_job": "basics",
    "/api/game/bank/loan": "credit",
    "/api/game/trade_share": "broker",
    "/api/coop/trade_share": "broker",
}


class LearnState(db.Model):
    __tablename__ = "learn_state"
    user_id = db.Column(db.Integer, primary_key=True)
    data = db.Column(db.Text, default="{}")   # {"opened":{art:iso},"certs":{c:iso},"lock":{c:iso},"exam":{...}|null}


def _now():
    return datetime.utcnow()


def _iso(dt):
    return dt.isoformat()


def _parse(s):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _load(user_id):
    row = db.session.get(LearnState, user_id)
    if not row:
        row = LearnState(user_id=user_id, data="{}")
        db.session.add(row)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            row = db.session.get(LearnState, user_id)
    try:
        d = json.loads(row.data or "{}")
    except Exception:
        d = {}
    for k in ("opened", "certs", "lock"):
        d.setdefault(k, {})
    d.setdefault("exam", None)
    return row, d


def _save(row, d):
    row.data = json.dumps(d)
    db.session.commit()


def has_cert(user_id, cert):
    _, d = _load(user_id)
    return cert in d["certs"]


def init_learn(app, login_required, current_user, get_or_create_save, price_index=lambda: 1.0):
    bp = Blueprint("learn", __name__)

    with app.app_context():
        db.create_all()

    def fee_for(cert):
        base = core.CERTS[cert]["fee"]
        return round(base * price_index(), 2) if base else 0.0

    @app.before_request
    def _knowledge_gate():
        if request.method != "POST":
            return None
        need = GATES.get(request.path)
        if not need:
            return None
        user = current_user()
        if user is None:
            return None  # login_required on the route answers this
        _, d = _load(user.id)
        if need not in d["certs"]:
            c = core.CERTS[need]
            return jsonify(success=False, gate=need,
                           msg=f"CERTIFICATE REQUIRED: {c['label']}. Open ASTRAWIKI, study "
                               f"'{core.ARTICLES[c['article']]['title']}' and pass the exam."), 403
        if request.path.endswith("/trade_share"):
            try:
                qty = int((request.get_json(silent=True) or {}).get("qty", 1))
            except (TypeError, ValueError):
                qty = 1
            if qty > core.RETAIL_CAP and "risk" not in d["certs"]:
                return jsonify(success=False, gate="risk",
                               msg=f"Retail accounts are capped at {core.RETAIL_CAP} shares per order. "
                                   f"Pass Risk & Sizing in ASTRAWIKI to lift the cap."), 403
        return None

    @bp.route("/api/learn/status")
    @login_required
    def learn_status():
        user = current_user()
        _, d = _load(user.id)
        now = _now()
        certs = []
        for cid, c in core.CERTS.items():
            lock = _parse(d["lock"].get(cid, ""))
            lock_left = max(0, int((lock - now).total_seconds())) if lock and lock > now else 0
            certs.append(dict(id=cid, label=c["label"], fee=fee_for(cid), prereq=c["prereq"], article=c["article"],
                              unlocks=c["unlocks"], passed=cid in d["certs"], lock_left=lock_left,
                              prereq_ok=(c["prereq"] is None or c["prereq"] in d["certs"])))
        label, depth = core.session_label(now.hour)
        return jsonify(success=True, certs=certs, session=dict(label=label, depth=depth),
                       exam_active=bool(d["exam"]), study_seconds=core.STUDY_SECONDS,
                       articles=[dict(id=a, title=v["title"], cert=v["cert"]) for a, v in core.ARTICLES.items()],
                       pass_mark=core.PASS_MARK, questions=core.QUESTIONS, retail_cap=core.RETAIL_CAP)

    @bp.route("/api/learn/article/<aid>")
    @login_required
    def learn_article(aid):
        a = core.ARTICLES.get(aid)
        if not a:
            return jsonify(success=False, msg="No such article."), 404
        user = current_user()
        row, d = _load(user.id)
        if aid not in d["opened"]:
            d["opened"][aid] = _iso(_now())   # first open starts the study clock
            _save(row, d)
        opened = _parse(d["opened"][aid])
        studied = int((_now() - opened).total_seconds()) if opened else 0
        return jsonify(success=True, id=aid, title=a["title"], body=a["body"], cert=a["cert"],
                       studied=studied, study_needed=core.STUDY_SECONDS)

    @bp.route("/api/learn/search")
    @login_required
    def learn_search():
        ids = core.search(request.args.get("q", ""))
        return jsonify(success=True, results=[dict(id=i, title=core.ARTICLES[i]["title"],
                                                   snippet=core.ARTICLES[i]["body"][0]) for i in ids])

    @bp.route("/api/learn/exam/start", methods=["POST"])
    @login_required
    def exam_start():
        user = current_user()
        cert = (request.get_json(silent=True) or {}).get("cert")
        if cert not in core.CERTS:
            return jsonify(success=False, msg="Unknown exam."), 400
        c = core.CERTS[cert]
        row, d = _load(user.id)
        now = _now()
        ex = d["exam"]
        if ex:
            started = _parse(ex.get("started", ""))
            if started and (now - started).total_seconds() < core.EXAM_MINUTES * 60:
                if ex["cert"] != cert:
                    return jsonify(success=False, msg=f"Finish your {core.CERTS[ex['cert']]['label']} sitting first."), 400
                qs = core.make_exam(cert, ex["seed"])
                return jsonify(success=True, resumed=True, cert=cert, questions=[q["prompt"] for q in qs],
                               seconds_left=int(core.EXAM_MINUTES * 60 - (now - started).total_seconds()))
            d["exam"] = None   # expired; fee already spent
        if cert in d["certs"]:
            return jsonify(success=False, msg="You already hold this certificate."), 400
        if c["prereq"] and c["prereq"] not in d["certs"]:
            return jsonify(success=False, msg=f"Requires {core.CERTS[c['prereq']]['label']} first."), 400
        lock = _parse(d["lock"].get(cert, ""))
        if lock and lock > now:
            return jsonify(success=False, msg=f"Locked out for {int((lock - now).total_seconds())}s after a failed sitting."), 429
        opened = _parse(d["opened"].get(c["article"], ""))
        if not opened:
            return jsonify(success=False, msg=f"Open and study '{core.ARTICLES[c['article']]['title']}' first."), 400
        if (now - opened).total_seconds() < core.STUDY_SECONDS:
            left = int(core.STUDY_SECONDS - (now - opened).total_seconds())
            return jsonify(success=False, msg=f"You have not studied long enough. {left}s more with the article open."), 400
        fee = fee_for(cert)
        if fee and not _adjust_balance(user.id, -fee):
            return jsonify(success=False, msg=f"The exam fee is ${fee:,.2f}. You cannot afford it yet."), 400
        seed = secrets.randbelow(2 ** 31)
        d["exam"] = dict(cert=cert, seed=seed, started=_iso(now))
        _save(row, d)
        qs = core.make_exam(cert, seed)
        return jsonify(success=True, cert=cert, fee=fee, questions=[q["prompt"] for q in qs],
                       seconds_left=core.EXAM_MINUTES * 60)

    @bp.route("/api/learn/exam/submit", methods=["POST"])
    @login_required
    def exam_submit():
        user = current_user()
        row, d = _load(user.id)
        ex = d["exam"]
        if not ex:
            return jsonify(success=False, msg="No sitting in progress."), 400
        now = _now()
        started = _parse(ex.get("started", ""))
        cert = ex["cert"]
        if not started or (now - started).total_seconds() > core.EXAM_MINUTES * 60:
            d["exam"] = None
            _save(row, d)
            return jsonify(success=False, msg="Time's up. The sitting expired and the fee is gone."), 400
        answers = (request.get_json(silent=True) or {}).get("answers") or []
        marks, score = core.grade(cert, ex["seed"], answers)
        d["exam"] = None
        passed = score >= core.PASS_MARK
        if passed:
            d["certs"][cert] = _iso(now)
            d["lock"].pop(cert, None)
            msg = f"PASSED {score}/{core.QUESTIONS}. Certificate earned: {core.CERTS[cert]['label']}."
        else:
            d["lock"][cert] = _iso(now + timedelta(minutes=core.LOCKOUT_MIN))
            msg = (f"FAILED {score}/{core.QUESTIONS} (need {core.PASS_MARK}). Locked out {core.LOCKOUT_MIN} minutes. "
                   f"Re-read the article; the numbers will be different next time.")
        _save(row, d)
        return jsonify(success=True, passed=passed, score=score, marks=marks, msg=msg)

    app.register_blueprint(bp)
