"""Astra legal system: a country-dependent law code, lawyers, civil courts, appeals and record clearing.

Models are defined at import time (so db.create_all() sees them); everything that needs world.py is handed in
through init_law(...) to avoid a circular import.
"""
import random
from datetime import datetime, timedelta
from types import SimpleNamespace

from flask import Blueprint, jsonify, request, session, redirect
from sqlalchemy import func

from models import db, User, GameSave


# ------------------------------------------------------------------ models
class Lawyer(db.Model):
    __tablename__ = "law_lawyers"
    user_id = db.Column(db.Integer, primary_key=True)
    fee = db.Column(db.Float, default=1000.0)
    bio = db.Column(db.String(120), default="")
    wins = db.Column(db.Integer, default=0)
    losses = db.Column(db.Integer, default=0)
    disbarred = db.Column(db.Boolean, default=False)
    licensed_at = db.Column(db.DateTime, default=datetime.utcnow)


class CourtCase(db.Model):
    __tablename__ = "law_cases"
    id = db.Column(db.Integer, primary_key=True)
    claim_type = db.Column(db.String(16))
    plaintiff_id = db.Column(db.Integer, index=True)
    defendant_id = db.Column(db.Integer, index=True)
    plaintiff_name = db.Column(db.String(64))
    defendant_name = db.Column(db.String(64))
    amount = db.Column(db.Float, default=0.0)
    statement = db.Column(db.String(600), default="")
    response = db.Column(db.String(600), default="")
    status = db.Column(db.String(16), default="filed", index=True)   # filed|settlement|decided|withdrawn
    p_lawyer = db.Column(db.String(24), default="public")            # public|junior|senior|elite|u<ID>
    d_lawyer = db.Column(db.String(24), default="")
    regime = db.Column(db.String(24))
    filed_at = db.Column(db.DateTime, default=datetime.utcnow)
    answer_due = db.Column(db.DateTime)
    hearing_at = db.Column(db.DateTime, index=True)
    settle_offer = db.Column(db.Float, default=0.0)
    decided_at = db.Column(db.DateTime)
    outcome = db.Column(db.String(12), default="")                    # plaintiff|defendant|settled|default|admitted|dismissed
    awarded = db.Column(db.Float, default=0.0)
    paid = db.Column(db.Float, default=0.0)
    ruling = db.Column(db.String(900), default="")
    judge = db.Column(db.String(64), default="")


class LegalAction(db.Model):
    """Appeals against a conviction, and petitions to expunge a conviction."""
    __tablename__ = "law_actions"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, index=True)
    kind = db.Column(db.String(8))                                     # appeal|expunge
    offense_id = db.Column(db.Integer, index=True)
    lawyer = db.Column(db.String(24))
    cost = db.Column(db.Float, default=0.0)
    success = db.Column(db.Boolean, default=False)
    result = db.Column(db.String(300), default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class RegimeHistory(db.Model):
    __tablename__ = "law_regime_history"
    id = db.Column(db.Integer, primary_key=True)
    prev = db.Column(db.String(24))
    regime = db.Column(db.String(24))
    how = db.Column(db.String(12))                                     # vote|admin
    detail = db.Column(db.String(160), default="")
    at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


# ------------------------------------------------------------------ static rules
FIRMS = {
    "public": dict(label="Public Defender's Office", fee=0.0, skill=35, blurb="Free, overworked, and mostly unbothered."),
    "junior": dict(label="Pettigrew & Co. (junior associate)", fee=500.0, skill=50, blurb="Eager, cheap, reads the file on the way in."),
    "senior": dict(label="Halloran Vance LLP", fee=3000.0, skill=68, blurb="Solid record, solid invoices."),
    "elite":  dict(label="Sterling, Okoye & Byrne", fee=15000.0, skill=85, blurb="The firm judges pretend not to be afraid of."),
}

CLAIMS = {
    "contract":   "Breach of contract or a deal that was not honoured.",
    "fraud":      "You were deceived into a transaction.",
    "theft":      "Money or property was taken from you.",
    "defamation": "Public statements (for example on BLABBER) that damaged your name.",
    "negligence": "Someone's carelessness cost you money.",
}

# Every number that differs between countries lives here, so the law code and the courts always agree.
LAW = {
    "capitalism": dict(
        court_fee=0.02, fee_min=100, damages=1.00, appeal_base=38, appeal_window=30, expunge_base=30, expunge_clean_h=6,
        answer_min=10, defamation=-8, property=6, poverty=0, priors=3, bar_fee=2500, lawyer_w=0.40,
        lawyer_fee_mult=1.0, appeal_contempt=0.0,
        preamble="The Republic exists to protect property and the freedom to bargain. Courts are adversarial: the side with "
                 "the better counsel and the cleaner record tends to win, and the state does not redistribute outcomes.",
        courts="Independent adversarial courts. Private counsel is unregulated; fees are whatever the market bears."),
    "mixed": dict(
        court_fee=0.01, fee_min=50, damages=0.90, appeal_base=45, appeal_window=45, expunge_base=45, expunge_clean_h=4,
        answer_min=15, defamation=0, property=2, poverty=4, priors=3, bar_fee=1500, lawyer_w=0.35,
        lawyer_fee_mult=1.0, appeal_contempt=0.0,
        preamble="The Social Democracy balances contract against fairness. Awards are trimmed to what a reasonable court "
                 "thinks is proportionate, and judges give a little extra weight to the party with fewer resources.",
        courts="Mixed courts with subsidised filing. Private counsel is licensed and fee-guided."),
    "communism": dict(
        court_fee=0.0, fee_min=0, damages=0.75, appeal_base=55, appeal_window=60, expunge_base=60, expunge_clean_h=3,
        answer_min=20, defamation=0, property=-6, poverty=10, priors=2, bar_fee=0, lawyer_w=0.30,
        lawyer_fee_mult=0.25, appeal_contempt=0.0,
        preamble="The People's Collective treats private accumulation with suspicion. Courts are free to use, damages are "
                 "reduced, and judges lean toward whichever party holds less of the common wealth.",
        courts="People's courts. Filing is free. Private counsel is capped at a quarter of market fees."),
    "authoritarian": dict(
        court_fee=0.03, fee_min=300, damages=1.00, appeal_base=15, appeal_window=15, expunge_base=5, expunge_clean_h=12,
        answer_min=5, defamation=10, property=0, poverty=0, priors=5, bar_fee=6000, lawyer_w=0.25,
        lawyer_fee_mult=1.5, appeal_contempt=0.5,
        preamble="The Security State values order over argument. Hearings are swift, prior convictions weigh heavily on "
                 "credibility, insulting statements are punished, and appealing a sentence you lose makes it worse.",
        courts="State tribunals. Short response deadlines. Counsel is expensive and carries little weight."),
}

CIVIL_MAX_CLAIM = 1_000_000.0
CIVIL_MIN_CLAIM = 100.0
CIVIL_MAX_OPEN = 3
SETTLE_WINDOW_MIN = 10
HEARING_DELAY_MIN = 2
APPEAL_MAX_BIO = 120


def _lp(regime):
    return LAW.get(regime, LAW["capitalism"])


def init_law(app, login_required, admin_required, current_user, deps):
    """deps: SimpleNamespace from world.py (rules(), REGIMES, CRIMES, record(), adjust(), take(), log_admin(), ...)."""
    bp = Blueprint("law", __name__)
    D = deps

    # ------------------------------------------------------------ helpers
    def _regime():
        return D.rules()[0]

    def _name(uid):
        u = db.session.get(User, uid)
        return u.username if u else "deleted"

    def _bal(uid):
        return db.session.query(GameSave.balance).filter(GameSave.user_id == uid).scalar() or 0.0

    def _convictions(uid):
        rec = D.record(uid)
        return rec.convictions or 0

    def _lawyer_info(code, regime):
        """-> (label, skill, fee) for a lawyer code like 'senior' or 'u12', or None."""
        lp = _lp(regime)
        if code in FIRMS:
            f = FIRMS[code]
            fee = round(f["fee"] * D.price_index() * lp["lawyer_fee_mult"], 2) if f["fee"] else 0.0
            return f["label"], f["skill"], fee
        if code and code.startswith("u") and code[1:].isdigit():
            lw = db.session.get(Lawyer, int(code[1:]))
            if not lw or lw.disbarred:
                return None
            skill = max(30, min(90, 45 + 3 * (lw.wins or 0) - 2 * (lw.losses or 0)))
            fee = round(lw.fee * lp["lawyer_fee_mult"], 2)
            return _name(lw.user_id), skill, fee
        return None

    def _pay_lawyer(payer_id, code, regime):
        """Charge the fee for a lawyer choice. Returns (ok, fee, message)."""
        info = _lawyer_info(code, regime)
        if not info:
            return False, 0.0, "Unknown or unavailable lawyer."
        label, _, fee = info
        if code.startswith("u") and int(code[1:]) == payer_id:
            return False, 0.0, "You can't hire yourself."
        if fee > 0:
            if not D.adjust(payer_id, -fee):
                return False, fee, f"{label} costs ${fee:,.2f} and you can't cover it."
            if code.startswith("u"):
                D.adjust(int(code[1:]), fee)
        return True, fee, ""

    def _court_fee(amount, regime):
        lp = _lp(regime)
        return round(max(lp["fee_min"], amount * lp["court_fee"]), 2) if (lp["court_fee"] or lp["fee_min"]) else 0.0

    def _note_lawyer_result(code, won):
        if code and code.startswith("u") and code[1:].isdigit():
            lw = db.session.get(Lawyer, int(code[1:]))
            if lw:
                if won:
                    lw.wins = (lw.wins or 0) + 1
                else:
                    lw.losses = (lw.losses or 0) + 1

    def _case_dict(c, me=None):
        return dict(
            id=c.id, claim=c.claim_type, plaintiff=c.plaintiff_name, defendant=c.defendant_name, amount=c.amount,
            status=c.status, statement=c.statement, response=c.response, outcome=c.outcome, awarded=c.awarded,
            paid=c.paid, ruling=c.ruling, judge=c.judge, settle_offer=c.settle_offer, regime=c.regime,
            p_lawyer=(_lawyer_info(c.p_lawyer, c.regime) or ("?",))[0], d_lawyer=(_lawyer_info(c.d_lawyer, c.regime) or ("-",))[0] if c.d_lawyer else "",
            filed=c.filed_at.strftime("%Y-%m-%d %H:%M"),
            answer_in_s=max(0, int((c.answer_due - datetime.utcnow()).total_seconds())) if c.answer_due else 0,
            hearing_in_s=max(0, int((c.hearing_at - datetime.utcnow()).total_seconds())) if c.hearing_at else 0,
            role=("plaintiff" if me and c.plaintiff_id == me else "defendant" if me and c.defendant_id == me else ""))

    # ------------------------------------------------------------ verdict engine
    def _decide(c, forced=None, judge="AUTO", note=""):
        """Resolve a contested case. forced: 'plaintiff'|'defendant'|'dismissed' from an admin."""
        lp = _lp(c.regime or _regime())
        reasons = []
        outcome = forced
        if not outcome:
            p_info = _lawyer_info(c.p_lawyer, c.regime) or ("", 35, 0)
            d_info = _lawyer_info(c.d_lawyer, c.regime) or ("", 35, 0)
            score = 50.0
            diff = (p_info[1] - d_info[1]) * lp["lawyer_w"]
            score += diff
            reasons.append(f"counsel ({p_info[0]} vs {d_info[0]}): {diff:+.0f}")
            if c.claim_type in ("contract", "fraud", "theft") and lp["property"]:
                score += lp["property"]
                reasons.append(f"property-rights doctrine of this country: {lp['property']:+d}")
            if c.claim_type == "defamation" and lp["defamation"]:
                score += lp["defamation"]
                reasons.append(f"defamation doctrine of this country: {lp['defamation']:+d}")
            if lp["poverty"]:
                pb, db_ = _bal(c.plaintiff_id), _bal(c.defendant_id)
                shift = lp["poverty"] if pb < db_ else -lp["poverty"]
                score += shift
                reasons.append(f"wealth gap ({'plaintiff' if pb < db_ else 'defendant'} is poorer): {shift:+d}")
            pri = max(-15, min(15, (_convictions(c.defendant_id) - _convictions(c.plaintiff_id)) * lp["priors"]))
            if pri:
                score += pri
                reasons.append(f"prior convictions (credibility): {pri:+d}")
            score += random.gauss(0, 8)
            p_win = max(5.0, min(95.0, score)) / 100.0
            outcome = "plaintiff" if random.random() < p_win else "defendant"
            reasons.append(f"final odds for plaintiff {p_win * 100:.0f}%")
        awarded = paid = 0.0
        if outcome == "plaintiff":
            awarded = round(c.amount * lp["damages"] * (random.uniform(0.75, 1.0) if not forced else 1.0), 2)
            paid = D.take(c.defendant_id, awarded)
            if paid > 0:
                D.adjust(c.plaintiff_id, paid)
        c.status, c.outcome, c.awarded, c.paid = "decided", outcome, awarded, paid
        c.decided_at, c.judge = datetime.utcnow(), judge
        art = {"plaintiff": "for the plaintiff", "defendant": "for the defendant", "dismissed": "dismissed"}[outcome]
        text = f"Judgment {art} under the law of {D.REGIMES[c.regime]['label']}."
        if outcome == "plaintiff":
            text += f" Damages ${awarded:,.2f} (claim x {lp['damages']:.2f}); ${paid:,.2f} collected" + \
                    (" (defendant could not cover the rest)." if paid + 0.01 < awarded else ".")
        if reasons:
            text += " Factors: " + "; ".join(reasons) + "."
        if note:
            text += f" Judge's note: {note}"
        c.ruling = text[:900]
        if outcome in ("plaintiff", "defendant"):
            _note_lawyer_result(c.p_lawyer, outcome == "plaintiff")
            _note_lawyer_result(c.d_lawyer, outcome == "defendant")
        db.session.commit()

    def process_due_cases():
        """Called from the server tick: hear cases whose time has come, default the silent, expire settlement offers."""
        now = datetime.utcnow()
        due = CourtCase.query.filter(CourtCase.status.in_(("filed", "settlement")),
                                     CourtCase.hearing_at <= now).order_by(CourtCase.id).limit(10).all()
        for c in due:
            was = c.status
            claimed = CourtCase.query.filter(CourtCase.id == c.id, CourtCase.status == was).update(
                {CourtCase.status: "hearing"}, synchronize_session=False)
            db.session.commit()
            if claimed != 1:
                continue                      # another worker took it
            db.session.refresh(c)
            if was == "filed" and not c.d_lawyer and not c.response:
                lp = _lp(c.regime)
                awarded = round(c.amount * lp["damages"], 2)
                paid = D.take(c.defendant_id, awarded)
                if paid > 0:
                    D.adjust(c.plaintiff_id, paid)
                c.status, c.outcome, c.awarded, c.paid = "decided", "default", awarded, paid
                c.decided_at, c.judge = now, "AUTO"
                c.ruling = (f"Default judgment for the plaintiff: the defendant did not answer within "
                            f"{lp['answer_min']} minutes. Damages ${awarded:,.2f}; ${paid:,.2f} collected.")
                _note_lawyer_result(c.p_lawyer, True)
                db.session.commit()
            else:
                _decide(c)
        return len(due)

    # ------------------------------------------------------------ law code generator
    def _tally():
        since = datetime.utcnow() - timedelta(hours=D.vote_window_h)
        rows = db.session.query(D.RegimeVote.regime, func.count()).filter(D.RegimeVote.cast_at >= since).group_by(
            D.RegimeVote.regime).all()
        return {r: c for r, c in rows}

    def _offense_stats(uid):
        rows = db.session.query(D.Offense.crime, D.Offense.outcome, func.count(), func.coalesce(func.sum(D.Offense.amount), 0.0)
                                ).filter(D.Offense.user_id == uid).group_by(D.Offense.crime, D.Offense.outcome).all()
        out = {}
        for crime, outcome, n, amt in rows:
            d = out.setdefault(crime, dict(success=0, caught=0, overturned=0, fines=0.0, loot=0.0))
            if outcome == "success":
                d["success"] += n
                d["loot"] += amt
            elif outcome == "overturned":
                d["overturned"] += n
            else:
                d["caught"] += n
                d["fines"] += amt
        return out

    def build_code(uid, regime):
        R = D.REGIMES[regime]
        lp = _lp(regime)
        current = _regime()
        w = D.world()
        tally = _tally()
        total = sum(tally.values())
        quorum = max(3, int(D.active_count() * 0.10))
        hist = RegimeHistory.query.order_by(RegimeHistory.id.desc()).limit(8).all()
        rec = D.record(uid)
        conv = rec.convictions or 0
        wanted = D.current_wanted(rec)
        parts = []

        def part(pid, title, arts):
            parts.append(dict(id=pid, title=title, articles=[dict(n=n, title=t, text=x) for n, t, x in arts]))

        # PART I
        lead = max(tally.items(), key=lambda kv: kv[1]) if tally else None
        mins = int((datetime.utcnow() - (w.regime_changed_at or datetime.utcnow())).total_seconds() / 60)
        art = [
            ("1.1", "Preamble", lp["preamble"]),
            ("1.2", "Name and form", f"This country is the {R['label']}. {R['blurb']}"),
            ("1.3", "How the law changes", f"Any operator may vote once for the form of government. Votes count for {D.vote_window_h} hours. "
             f"A change needs a quorum of {quorum} votes (10% of active operators, minimum 3), a strict majority of the votes cast, "
             f"and at least {D.regime_cooldown_min} minutes since the last change. When all three hold, every rule in this code is "
             "replaced by the rules of the winning country, immediately."),
            ("1.4", "Current standing",
             (f"Votes in the last {D.vote_window_h}h: " + ", ".join(f"{D.REGIMES[r]['label']} {c}" for r, c in sorted(tally.items(), key=lambda kv: -kv[1]))
              + f" ({total} total). " if tally else "No votes have been cast in the last day. ")
             + (f"{D.REGIMES[current]['label']} has been in force for {mins} minutes." if regime == current else
                f"You are reading the code of a country that is NOT in force. The one in force is {D.REGIMES[current]['label']}.")),
        ]
        if hist:
            art.append(("1.5", "Constitutional history", " ".join(
                f"[{h.at:%m-%d %H:%M}] {D.REGIMES.get(h.prev, {}).get('label', h.prev or 'start')} -> {D.REGIMES.get(h.regime, {}).get('label', h.regime)} "
                f"({'by referendum' if h.how == 'vote' else 'by administrative order'}{': ' + h.detail if h.detail else ''})." for h in hist)))
        part("constitution", "PART I - The Constitution", art)

        # PART II
        part("commerce", "PART II - Taxes and commerce", [
            ("2.1", "Income tax", f"Earnings are taxed at {R['tax_rate'] * 100:.0f}%."),
            ("2.2", "Trading between operators", "Player-to-player trading is PROHIBITED." if not R["allow_player_trading"] else
             f"Player-to-player trading is permitted with a {R['trade_fee'] * 100:.0f}% levy."),
            ("2.3", "Redistribution", "There is no redistribution." if not R["redistribution_rate"] else
             f"Every 10 minutes, {R['redistribution_rate'] * 100:.0f}% of every balance above {R['threshold_mult']}x the average is pooled and shared equally."),
            ("2.4", "Anonymity", "Anonymous posting on BLABBER is permitted." if R["allow_anonymous"] else
             "Anonymous posting on BLABBER is ABOLISHED. Everything you say carries your name."),
        ])

        # PART III
        a3 = [
            ("3.1", "Enforcement", f"Enforcement strength in this country is x{R['enforcement']}. It multiplies the chance that any crime is detected."),
            ("3.2", "Wanted rating", f"Each attempt raises your wanted rating (x2 severity if caught, x0.5 if clean). It decays by {D.wanted_decay}/min. "
             "Every wanted point adds 5% to your chance of being caught."),
            ("3.3", "Repeat offenders", "After a conviction, jail terms grow by 25% of the base term for every earlier conviction, up to "
             f"{D.jail_cap} minutes. A wanted rating of 5 or more means custody even for minor crimes."),
            ("3.4", "Bail", f"Bail is ${D.bail_per_min:,.0f} per remaining minute, scaled by the price index."),
        ]
        for i, (cid, c) in enumerate(D.CRIMES.items(), start=1):
            eff = min(0.95, c["catch"] * R["enforcement"])
            jail1 = min(D.jail_cap, c["jail_min"]) if (c["jail_min"] or c["severity"] >= 3) else 0
            jailn = min(D.jail_cap, int(c["jail_min"] * (1 + 0.25 * conv))) if (c["jail_min"] or c["severity"] >= 3) else 0
            a3.append((f"3.{4 + i}", c["label"],
                       f"Severity {c['severity']}. Proceeds {c['reward'][0]:,}-{c['reward'][1]:,}. Base detection {c['catch'] * 100:.0f}%; "
                       f"under this country's enforcement {eff * 100:.0f}% before your wanted rating. Fine: {c['fine_pct'] * 100:.0f}% of balance "
                       f"(at least {c['fine_min']:,}). Custody: {('first conviction ' + str(jail1) + ' min' + ('; with your ' + str(conv) + ' prior conviction(s) ' + str(jailn) + ' min') if conv else str(jail1) + ' min') if jail1 else 'none unless wanted rating is 5 or more'}."))
        part("criminal", "PART III - Criminal code", a3)

        # PART IV
        fee_txt = "Filing is free." if not lp["court_fee"] and not lp["fee_min"] else \
            f"The court fee is {lp['court_fee'] * 100:.0f}% of the claim (minimum ${lp['fee_min']:,}), non-refundable."
        part("civil", "PART IV - Civil courts", [
            ("4.1", "Jurisdiction", lp["courts"]),
            ("4.2", "Who may sue", f"Any operator with an active career may sue another for ${CIVIL_MIN_CLAIM:,.0f} to ${CIVIL_MAX_CLAIM:,.0f}. "
             f"You may have at most {CIVIL_MAX_OPEN} suits open at once."),
            ("4.3", "Grounds", " ".join(f"{k.upper()}: {v}" for k, v in CLAIMS.items())),
            ("4.4", "Costs", fee_txt + " Counsel is paid up front."),
            ("4.5", "Answering", f"The defendant has {lp['answer_min']} minutes to answer: CONTEST (hire counsel), ADMIT (pay in full now) or OFFER A SETTLEMENT. "
             f"Silence means default judgment for the plaintiff. A settlement offer lapses after {SETTLE_WINDOW_MIN} minutes and the case goes to hearing."),
            ("4.6", "How judgment is reached", f"A hearing follows about {HEARING_DELAY_MIN} minutes after the answer. Odds start at 50% and move with: the skill gap "
             f"between counsel (x{lp['lawyer_w']}); "
             + (f"property-rights doctrine ({lp['property']:+d}) for contract, fraud and theft; " if lp["property"] else "")
             + (f"defamation doctrine ({lp['defamation']:+d}); " if lp["defamation"] else "")
             + (f"the poorer party gains {lp['poverty']} points; " if lp["poverty"] else "")
             + f"each prior conviction costs {lp['priors']} points of credibility (difference between the parties, max 15); plus chance. Every ruling lists its factors."),
            ("4.7", "Damages", f"A winning plaintiff recovers {lp['damages'] * 100:.0f}% of the claim (randomly 75-100% of that). "
             "The court collects only what the defendant can pay; it does not create debt."),
        ])

        # PART V
        firm_lines = " ".join(f"{f['label']}: skill {f['skill']}, " +
                              ("free." if not f["fee"] else f"${f['fee'] * D.price_index() * lp['lawyer_fee_mult']:,.0f} per matter.") for f in FIRMS.values())
        part("counsel", "PART V - Counsel", [
            ("5.1", "Firms", firm_lines),
            ("5.2", "Player lawyers", f"Any operator may take the bar exam for ${lp['bar_fee']:,} (registration fee) and set their own fee. "
             + ("In this country fees are capped at 25% of the market rate. " if lp["lawyer_fee_mult"] < 1 else
                "Fees here are marked up 50% by the licensing board. " if lp["lawyer_fee_mult"] > 1 else "")
             + "A lawyer's skill starts at 45 and moves with their record (+3 per win, -2 per loss, between 30 and 90). A licence can be revoked (disbarment)."),
            ("5.3", "Weight of counsel", f"Counsel moves a civil case by up to about {round(55 * lp['lawyer_w'])} points and an appeal by half the skill gap from 50."),
        ])

        # PART VI
        part("appeals", "PART VI - Appeals and clean slates", [
            ("6.1", "Appeal", f"You may appeal a fine or custody sentence within {lp['appeal_window']} minutes. Base success {lp['appeal_base']}%, "
             "plus half the skill gap from 50, minus 3 per earlier conviction (minimum 3%, maximum 90%). Success returns the fine, frees you if still in custody for that "
             "crime, removes the conviction and cuts your wanted rating. "
             + (f"FAILURE ADDS {lp['appeal_contempt'] * 100:.0f}% of the base custody term for contempt. " if lp["appeal_contempt"] else "Failure costs you the fees only. ")
             + "Each sentence can be appealed once."),
            ("6.2", "Expungement", f"After {lp['expunge_clean_h']} hours with no new offense you may petition to erase ONE conviction. Base success {lp['expunge_base']}%, "
             "plus 40% of the skill gap from 50. Success halves your wanted rating. Costs double the court fee plus counsel."),
        ])

        # PART VII: your record
        stats = _offense_stats(uid)
        lines = []
        for cid, s in stats.items():
            label = D.CRIMES.get(cid, {}).get("label", cid)
            lines.append(f"{label}: {s['success']} clean, {s['caught']} caught (fines ${s['fines']:,.0f})" + (f", {s['overturned']} overturned" if s["overturned"] else "") + ".")
        pri = max(-15, min(15, conv * lp["priors"]))
        part("record", "PART VII - Your record", [
            ("7.1", "Standing", f"Convictions: {conv}. Wanted rating: {wanted:.1f}. "
             + ("You are currently in custody. " if D.jail_left(uid) > 0 else "") + f"In a civil case against a clean opponent your priors cost you about {pri} odds points here."),
            ("7.2", "History", " ".join(lines) if lines else "You have no recorded offenses."),
            ("7.3", "If you offend again", "Your next conviction would carry "
             + ", ".join(f"{c['label']} {min(D.jail_cap, int(c['jail_min'] * (1 + 0.25 * conv)))} min" for c in D.CRIMES.values() if c["jail_min"]) + " of custody."),
        ])

        # PART VIII: case law
        cases = CourtCase.query.filter_by(status="decided").order_by(CourtCase.id.desc()).limit(8).all()
        part("caselaw", "PART VIII - Recent case law", [
            (f"8.{i}", f"#{c.id} {c.claim_type}: {c.plaintiff_name} v. {c.defendant_name}",
             f"${c.amount:,.0f} claimed, decided '{c.outcome}' under {D.REGIMES.get(c.regime, {}).get('label', c.regime)}. {c.ruling}")
            for i, c in enumerate(cases, start=1)] or [("8.1", "No decisions yet", "The courts have not ruled on anything.")])

        # PART IX: comparison
        comp = []
        for i, (k, r) in enumerate(D.REGIMES.items(), start=1):
            if k == regime:
                continue
            o = _lp(k)
            d = []
            d.append(f"tax {r['tax_rate'] * 100:.0f}% (here {R['tax_rate'] * 100:.0f}%)")
            d.append(f"enforcement x{r['enforcement']} (here x{R['enforcement']})")
            d.append(f"appeal success {o['appeal_base']}% in {o['appeal_window']} min (here {lp['appeal_base']}% in {lp['appeal_window']} min)")
            d.append(f"damages {o['damages'] * 100:.0f}% (here {lp['damages'] * 100:.0f}%)")
            d.append(f"answer deadline {o['answer_min']} min (here {lp['answer_min']} min)")
            d.append("trading banned" if not r["allow_player_trading"] else "trading allowed")
            comp.append((f"9.{i}", r["label"], "; ".join(d) + "."))
        part("compare", "PART IX - How other countries differ", comp)
        return dict(regime=regime, label=R["label"], in_force=(regime == current), parts=parts)

    # ------------------------------------------------------------ pages / API
    @bp.route("/law")
    def law_page():
        if not session.get("user_id"):
            return redirect("/")
        return LAW_PAGE

    @bp.route("/api/law/countries")
    @login_required
    def law_countries():
        cur = _regime()
        return jsonify(success=True, current=cur, countries=[dict(id=k, label=v["label"]) for k, v in D.REGIMES.items()])

    @bp.route("/api/law/code")
    @login_required
    def law_code():
        me = current_user()
        regime = request.args.get("country") or _regime()
        if regime not in D.REGIMES:
            return jsonify(success=False, msg="Unknown country."), 400
        return jsonify(success=True, **build_code(me.id, regime))

    @bp.route("/api/law/record")
    @login_required
    def law_record():
        me = current_user()
        rec = D.record(me.id)
        rows = D.Offense.query.filter_by(user_id=me.id).order_by(D.Offense.id.desc()).limit(40).all()
        lp = _lp(_regime())
        now = datetime.utcnow()
        appealed = {a.offense_id for a in LegalAction.query.filter_by(user_id=me.id, kind="appeal").all()}
        out = []
        for o in rows:
            can = (o.outcome in ("fined", "jailed") and o.id not in appealed
                   and (now - o.created_at).total_seconds() <= lp["appeal_window"] * 60)
            out.append(dict(id=o.id, crime=D.CRIMES.get(o.crime, {}).get("label", o.crime), outcome=o.outcome,
                            amount=round(o.amount or 0, 2), at=o.created_at.strftime("%Y-%m-%d %H:%M"), can_appeal=can,
                            appeal_left_s=max(0, int(lp["appeal_window"] * 60 - (now - o.created_at).total_seconds())) if can else 0))
        last = D.Offense.query.filter_by(user_id=me.id).order_by(D.Offense.id.desc()).first()
        clean_ok = (not last) or (now - last.created_at).total_seconds() >= lp["expunge_clean_h"] * 3600
        return jsonify(success=True, convictions=rec.convictions or 0, wanted=round(D.current_wanted(rec), 1),
                       jail_seconds_left=D.jail_left(me.id), offenses=out, can_expunge=bool(clean_ok and (rec.convictions or 0) > 0),
                       appeal_window_min=lp["appeal_window"], expunge_clean_h=lp["expunge_clean_h"])

    # ---- lawyers
    @bp.route("/api/law/lawyers")
    @login_required
    def law_lawyers():
        me = current_user()
        reg = _regime()
        lp = _lp(reg)
        firms = []
        for k in FIRMS:
            label, skill, fee = _lawyer_info(k, reg)
            firms.append(dict(code=k, name=label, skill=skill, fee=fee, blurb=FIRMS[k]["blurb"]))
        players = []
        for lw in Lawyer.query.filter_by(disbarred=False).order_by(Lawyer.wins.desc()).limit(30).all():
            info = _lawyer_info(f"u{lw.user_id}", reg)
            if info and lw.user_id != me.id:
                players.append(dict(code=f"u{lw.user_id}", name=info[0], skill=info[1], fee=info[2], bio=lw.bio or "",
                                    wins=lw.wins or 0, losses=lw.losses or 0))
        mine = db.session.get(Lawyer, me.id)
        return jsonify(success=True, firms=firms, players=players, bar_fee=lp["bar_fee"],
                       me=dict(licensed=bool(mine and not mine.disbarred), disbarred=bool(mine and mine.disbarred),
                               fee=mine.fee if mine else None, bio=mine.bio if mine else "", wins=mine.wins if mine else 0,
                               losses=mine.losses if mine else 0))

    @bp.route("/api/law/bar/register", methods=["POST"])
    @login_required
    def law_bar_register():
        me = current_user()
        d = request.get_json(silent=True) or {}
        lw = db.session.get(Lawyer, me.id)
        if lw and lw.disbarred:
            return jsonify(success=False, msg="You have been disbarred."), 403
        try:
            fee = float(d.get("fee", 1000))
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Fee must be a number."), 400
        if not 0 <= fee <= 100000:
            return jsonify(success=False, msg="Fee must be 0 to 100,000 ASD."), 400
        bio = D.clean(d.get("bio"), APPEAL_MAX_BIO)
        if lw:
            lw.fee, lw.bio = fee, bio
            db.session.commit()
            return jsonify(success=True, msg="Your practice details are updated.")
        if not db.session.query(GameSave.user_id).filter(GameSave.user_id == me.id, GameSave.active.is_(True)).first():
            return jsonify(success=False, msg="Start a career first."), 400
        cost = _lp(_regime())["bar_fee"]
        if cost and not D.adjust(me.id, -cost):
            return jsonify(success=False, msg=f"Bar registration costs ${cost:,.0f} and you can't cover it."), 400
        db.session.add(Lawyer(user_id=me.id, fee=fee, bio=bio))
        db.session.commit()
        return jsonify(success=True, msg=f"Admitted to the bar. Your fee is ${fee:,.0f} per matter.")

    # ---- civil cases
    def _open_count(uid):
        return CourtCase.query.filter(CourtCase.plaintiff_id == uid, CourtCase.status.in_(("filed", "settlement"))).count()

    @bp.route("/api/law/sue", methods=["POST"])
    @login_required
    def law_sue():
        me = current_user()
        d = request.get_json(silent=True) or {}
        reg = _regime()
        lp = _lp(reg)
        target = D.find_user(str(d.get("defendant") or ""))
        if not target or target.id == me.id:
            return jsonify(success=False, msg="Pick another operator to sue."), 400
        if not db.session.query(GameSave.user_id).filter(GameSave.user_id == target.id).first():
            return jsonify(success=False, msg="That operator has no career to sue."), 400
        claim = str(d.get("claim") or "").lower()
        if claim not in CLAIMS:
            return jsonify(success=False, msg="Claim must be: " + ", ".join(CLAIMS)), 400
        try:
            amount = round(float(d.get("amount")), 2)
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Amount must be a number."), 400
        if not CIVIL_MIN_CLAIM <= amount <= CIVIL_MAX_CLAIM:
            return jsonify(success=False, msg=f"Claims run from ${CIVIL_MIN_CLAIM:,.0f} to ${CIVIL_MAX_CLAIM:,.0f}."), 400
        statement = " ".join(str(d.get("statement") or "").split())[:600]
        if len(statement) < 15:
            return jsonify(success=False, msg="Explain what happened (at least a sentence)."), 400
        if _open_count(me.id) >= CIVIL_MAX_OPEN:
            return jsonify(success=False, msg=f"You already have {CIVIL_MAX_OPEN} open suits."), 400
        if CourtCase.query.filter(CourtCase.plaintiff_id == me.id, CourtCase.defendant_id == target.id,
                                  CourtCase.status.in_(("filed", "settlement"))).first():
            return jsonify(success=False, msg="You already have an open suit against them."), 400
        code = str(d.get("lawyer") or "public")
        fee_court = _court_fee(amount, reg)
        if fee_court and not D.adjust(me.id, -fee_court):
            return jsonify(success=False, msg=f"The court fee is ${fee_court:,.2f} and you can't cover it."), 400
        ok, lfee, err = _pay_lawyer(me.id, code, reg)
        if not ok:
            if fee_court:
                D.adjust(me.id, fee_court)
            return jsonify(success=False, msg=err), 400
        now = datetime.utcnow()
        c = CourtCase(claim_type=claim, plaintiff_id=me.id, defendant_id=target.id, plaintiff_name=me.username,
                      defendant_name=target.username, amount=amount, statement=statement, p_lawyer=code, regime=reg,
                      answer_due=now + timedelta(minutes=lp["answer_min"]),
                      hearing_at=now + timedelta(minutes=lp["answer_min"] + HEARING_DELAY_MIN))
        db.session.add(c)
        db.session.commit()
        return jsonify(success=True, case=_case_dict(c, me.id),
                       msg=f"Case #{c.id} filed against {target.username} (court fee ${fee_court:,.2f}, counsel ${lfee:,.2f}). "
                           f"They have {lp['answer_min']} minutes to answer.")

    @bp.route("/api/law/cases")
    @login_required
    def law_cases():
        me = current_user()
        process_due_cases()
        rows = CourtCase.query.filter(db.or_(CourtCase.plaintiff_id == me.id, CourtCase.defendant_id == me.id)
                                      ).order_by(CourtCase.id.desc()).limit(40).all()
        return jsonify(success=True, cases=[_case_dict(c, me.id) for c in rows])

    @bp.route("/api/law/docket")
    @login_required
    def law_docket():
        rows = CourtCase.query.filter_by(status="decided").order_by(CourtCase.id.desc()).limit(30).all()
        return jsonify(success=True, cases=[_case_dict(c) for c in rows])

    @bp.route("/api/law/inbox")
    @login_required
    def law_inbox():
        me = current_user()
        process_due_cases()
        summons = CourtCase.query.filter_by(defendant_id=me.id, status="filed").filter(
            CourtCase.d_lawyer == "", CourtCase.response == "").count()
        offers = CourtCase.query.filter_by(plaintiff_id=me.id, status="settlement").count()
        return jsonify(success=True, summons=summons, offers=offers, total=summons + offers)

    def _get_case(cid):
        c = db.session.get(CourtCase, cid)
        return c

    @bp.route("/api/law/case/<int:cid>/answer", methods=["POST"])
    @login_required
    def law_answer(cid):
        me = current_user()
        d = request.get_json(silent=True) or {}
        c = _get_case(cid)
        if not c or c.defendant_id != me.id:
            return jsonify(success=False, msg="No such case against you."), 404
        if c.status != "filed" or c.d_lawyer or c.response:
            return jsonify(success=False, msg="You have already answered this case."), 400
        lp = _lp(c.regime)
        action = str(d.get("action") or "").lower()
        text = " ".join(str(d.get("response") or "").split())[:600]
        if action == "admit":
            paid = D.take(me.id, c.amount)
            if paid > 0:
                D.adjust(c.plaintiff_id, paid)
            c.status, c.outcome, c.awarded, c.paid = "decided", "admitted", c.amount, paid
            c.decided_at, c.judge, c.response = datetime.utcnow(), "AUTO", text or "Admitted."
            c.ruling = f"The defendant admitted the claim. ${paid:,.2f} of ${c.amount:,.2f} collected."
            _note_lawyer_result(c.p_lawyer, True)
            db.session.commit()
            return jsonify(success=True, msg=c.ruling)
        if action == "settle":
            try:
                offer = round(float(d.get("offer")), 2)
            except (TypeError, ValueError):
                return jsonify(success=False, msg="Offer must be a number."), 400
            if not 0 < offer < c.amount:
                return jsonify(success=False, msg="Offer must be more than 0 and less than the claim."), 400
            if _bal(me.id) < offer:
                return jsonify(success=False, msg="You can't cover that offer."), 400
            c.status, c.settle_offer, c.response = "settlement", offer, text or "Settlement offered."
            c.hearing_at = datetime.utcnow() + timedelta(minutes=SETTLE_WINDOW_MIN)
            db.session.commit()
            return jsonify(success=True, msg=f"Offer of ${offer:,.2f} sent. The plaintiff has {SETTLE_WINDOW_MIN} minutes to accept.")
        if action == "contest":
            code = str(d.get("lawyer") or "public")
            ok, fee, err = _pay_lawyer(me.id, code, c.regime)
            if not ok:
                return jsonify(success=False, msg=err), 400
            c.d_lawyer, c.response = code, text or "Contested."
            c.hearing_at = datetime.utcnow() + timedelta(minutes=HEARING_DELAY_MIN)
            db.session.commit()
            return jsonify(success=True, msg=f"Contesting with counsel (${fee:,.2f}). Hearing in about {HEARING_DELAY_MIN} minutes.")
        return jsonify(success=False, msg="Action must be contest, admit or settle."), 400

    @bp.route("/api/law/case/<int:cid>/settle", methods=["POST"])
    @login_required
    def law_settle(cid):
        me = current_user()
        accept = bool((request.get_json(silent=True) or {}).get("accept"))
        c = _get_case(cid)
        if not c or c.plaintiff_id != me.id or c.status != "settlement":
            return jsonify(success=False, msg="No settlement offer to answer."), 404
        if not accept:
            c.status, c.hearing_at = "filed", datetime.utcnow() + timedelta(minutes=HEARING_DELAY_MIN)
            if not c.d_lawyer:
                c.d_lawyer = "public"
            db.session.commit()
            return jsonify(success=True, msg="Offer rejected. The case goes to hearing.")
        paid = D.take(c.defendant_id, c.settle_offer)
        if paid > 0:
            D.adjust(c.plaintiff_id, paid)
        c.status, c.outcome, c.awarded, c.paid = "decided", "settled", c.settle_offer, paid
        c.decided_at, c.judge = datetime.utcnow(), "AUTO"
        c.ruling = f"Settled out of court for ${c.settle_offer:,.2f} (${paid:,.2f} collected)."
        db.session.commit()
        return jsonify(success=True, msg=c.ruling)

    @bp.route("/api/law/case/<int:cid>/withdraw", methods=["POST"])
    @login_required
    def law_withdraw(cid):
        me = current_user()
        c = _get_case(cid)
        if not c or c.plaintiff_id != me.id or c.status not in ("filed", "settlement"):
            return jsonify(success=False, msg="Nothing to withdraw."), 404
        c.status, c.outcome, c.decided_at = "withdrawn", "dismissed", datetime.utcnow()
        c.ruling = "Withdrawn by the plaintiff. Fees are not refunded."
        db.session.commit()
        return jsonify(success=True, msg="Case withdrawn.")

    # ---- appeals and expungement
    @bp.route("/api/law/appeal", methods=["POST"])
    @login_required
    def law_appeal():
        me = current_user()
        d = request.get_json(silent=True) or {}
        reg = _regime()
        lp = _lp(reg)
        try:
            oid = int(d.get("offense_id"))
        except (TypeError, ValueError):
            return jsonify(success=False, msg="Pick an offense from your record."), 400
        o = db.session.get(D.Offense, oid)
        if not o or o.user_id != me.id or o.outcome not in ("fined", "jailed"):
            return jsonify(success=False, msg="Only your own fines and sentences can be appealed."), 400
        if LegalAction.query.filter_by(user_id=me.id, kind="appeal", offense_id=oid).first():
            return jsonify(success=False, msg="That sentence was already appealed."), 400
        if (datetime.utcnow() - o.created_at).total_seconds() > lp["appeal_window"] * 60:
            return jsonify(success=False, msg=f"The appeal window here is {lp['appeal_window']} minutes and it has closed."), 400
        code = str(d.get("lawyer") or "public")
        court = _court_fee(o.amount or 0, reg)
        if court and not D.adjust(me.id, -court):
            return jsonify(success=False, msg=f"The court fee is ${court:,.2f} and you can't cover it."), 400
        ok, lfee, err = _pay_lawyer(me.id, code, reg)
        if not ok:
            if court:
                D.adjust(me.id, court)
            return jsonify(success=False, msg=err), 400
        skill = _lawyer_info(code, reg)[1]
        conv = _convictions(me.id)
        p = max(3.0, min(90.0, lp["appeal_base"] + (skill - 50) * 0.5 - 3 * max(0, conv - 1)))
        won = random.random() * 100 < p
        crime = D.CRIMES.get(o.crime, {"label": o.crime, "jail_min": 0, "severity": 1})
        rec = D.record(me.id)
        if won:
            if o.amount:
                D.adjust(me.id, o.amount)
            o.outcome = "overturned"
            rec.convictions = max(0, (rec.convictions or 0) - 1)
            rec.wanted = max(0.0, D.current_wanted(rec) - crime["severity"] * 2)
            rec.wanted_at = datetime.utcnow()
            if rec.jail_until and rec.jail_reason == crime["label"]:
                rec.jail_until = None
            res = f"Conviction overturned. Fine ${o.amount or 0:,.2f} returned."
        else:
            res = "Appeal dismissed."
            if lp["appeal_contempt"] and crime.get("jail_min"):
                extra = max(1, int(crime["jail_min"] * lp["appeal_contempt"]))
                base = rec.jail_until if rec.jail_until and rec.jail_until > datetime.utcnow() else datetime.utcnow()
                rec.jail_until = base + timedelta(minutes=extra)
                rec.jail_reason = crime["label"] + " (contempt)"
                res += f" Contempt: +{extra} minutes in custody."
        db.session.add(LegalAction(user_id=me.id, kind="appeal", offense_id=oid, lawyer=code, cost=court + lfee,
                                   success=won, result=res))
        _note_lawyer_result(code, won)
        db.session.commit()
        return jsonify(success=True, won=won, chance=round(p), msg=f"{res} (odds were {p:.0f}%, fees ${court + lfee:,.2f})")

    @bp.route("/api/law/expunge", methods=["POST"])
    @login_required
    def law_expunge():
        me = current_user()
        d = request.get_json(silent=True) or {}
        reg = _regime()
        lp = _lp(reg)
        rec = D.record(me.id)
        if (rec.convictions or 0) <= 0:
            return jsonify(success=False, msg="You have no convictions to erase."), 400
        now = datetime.utcnow()
        last = D.Offense.query.filter_by(user_id=me.id).order_by(D.Offense.id.desc()).first()
        if last and (now - last.created_at).total_seconds() < lp["expunge_clean_h"] * 3600:
            return jsonify(success=False, msg=f"You need {lp['expunge_clean_h']} hours without any offense first."), 400
        prev = LegalAction.query.filter_by(user_id=me.id, kind="expunge").order_by(LegalAction.id.desc()).first()
        if prev and (now - prev.created_at).total_seconds() < lp["expunge_clean_h"] * 3600:
            return jsonify(success=False, msg="You petitioned recently. Wait before trying again."), 400
        code = str(d.get("lawyer") or "public")
        court = _court_fee(1000, reg) * 2
        if court and not D.adjust(me.id, -court):
            return jsonify(success=False, msg=f"The petition fee is ${court:,.2f} and you can't cover it."), 400
        ok, lfee, err = _pay_lawyer(me.id, code, reg)
        if not ok:
            if court:
                D.adjust(me.id, court)
            return jsonify(success=False, msg=err), 400
        skill = _lawyer_info(code, reg)[1]
        p = max(3.0, min(90.0, lp["expunge_base"] + (skill - 50) * 0.4))
        won = random.random() * 100 < p
        if won:
            rec.convictions = max(0, (rec.convictions or 0) - 1)
            rec.wanted = D.current_wanted(rec) * 0.5
            rec.wanted_at = now
            res = "One conviction erased and your wanted rating halved."
        else:
            res = "Petition denied."
        db.session.add(LegalAction(user_id=me.id, kind="expunge", lawyer=code, cost=court + lfee, success=won, result=res))
        _note_lawyer_result(code, won)
        db.session.commit()
        return jsonify(success=True, won=won, msg=f"{res} (odds were {p:.0f}%, fees ${court + lfee:,.2f})")

    # ---- admin
    @bp.route("/api/admin/law/cases")
    @admin_required
    def admin_law_cases():
        status = request.args.get("status")
        q = CourtCase.query
        if status:
            q = q.filter_by(status=status)
        return jsonify(success=True, cases=[_case_dict(c) for c in q.order_by(CourtCase.id.desc()).limit(30).all()])

    @bp.route("/api/admin/law/case/<int:cid>/rule", methods=["POST"])
    @admin_required
    def admin_law_rule(cid):
        d = request.get_json(silent=True) or {}
        c = db.session.get(CourtCase, cid)
        if not c:
            return jsonify(success=False, msg="No such case."), 404
        if c.status in ("decided", "withdrawn"):
            return jsonify(success=False, msg="That case is already closed."), 400
        verdict = str(d.get("verdict") or "").lower()
        if verdict not in ("plaintiff", "defendant", "dismissed"):
            return jsonify(success=False, msg="Verdict: plaintiff, defendant or dismissed."), 400
        me = current_user()
        _decide(c, forced=verdict, judge=me.username, note=D.clean(d.get("note"), 200))
        D.log_admin("court_ruling", cid, f"{verdict}: {c.ruling}"[:290])
        return jsonify(success=True, msg=f"Case #{cid}: {c.ruling}")

    @bp.route("/api/admin/law/disbar", methods=["POST"])
    @admin_required
    def admin_law_disbar():
        d = request.get_json(silent=True) or {}
        u = D.find_user(str(d.get("username") or ""))
        lw = db.session.get(Lawyer, u.id) if u else None
        if not lw:
            return jsonify(success=False, msg="That operator is not a lawyer."), 404
        lw.disbarred = not bool(d.get("reinstate"))
        db.session.commit()
        D.log_admin("reinstate" if d.get("reinstate") else "disbar", u.username)
        return jsonify(success=True, msg=f"{u.username} {'reinstated' if d.get('reinstate') else 'disbarred'}.")

    @bp.route("/api/admin/law/pardon", methods=["POST"])
    @admin_required
    def admin_law_pardon():
        d = request.get_json(silent=True) or {}
        u = D.find_user(str(d.get("username") or ""))
        if not u:
            return jsonify(success=False, msg="No such account."), 404
        rec = D.record(u.id)
        rec.convictions, rec.wanted, rec.jail_until, rec.jail_reason = 0, 0.0, None, ""
        rec.wanted_at = datetime.utcnow()
        db.session.commit()
        D.log_admin("pardon", u.username, D.clean(d.get("reason"), 120))
        return jsonify(success=True, msg=f"{u.username} pardoned: convictions, wanted rating and custody cleared.")

    app.register_blueprint(bp)
    return SimpleNamespace(process_due_cases=process_due_cases)


def note_regime_change(prev, new, how, detail=""):
    db.session.add(RegimeHistory(prev=prev, regime=new, how=how, detail=(detail or "")[:160]))
    db.session.commit()


LAW_PAGE = r"""<!doctype html><html><head><meta charset="utf-8"><title>ASTRA LAW</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0b0f14;--fg:#cfe8ff;--dim:#6f8aa6;--acc:#3ddcff;--warn:#ffd24a;--bad:#ff5b6b;--ok:#4be38a;--card:#121923;--line:#1f2b3a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,Consolas,monospace}
header{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5;flex-wrap:wrap}
h1{font-size:15px;margin:0 12px 0 0;color:var(--acc)}button,select,input,textarea{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);padding:6px 10px;border-radius:4px}
button{cursor:pointer}button:hover{border-color:var(--acc)}button.on{border-color:var(--acc);color:var(--acc)}
main{max-width:920px;margin:0 auto;padding:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px;margin:10px 0}
.dim{color:var(--dim)}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
details{border:1px solid var(--line);border-radius:6px;margin:8px 0;background:var(--card)}summary{cursor:pointer;padding:10px 12px;color:var(--acc)}
.art{padding:8px 14px;border-top:1px solid var(--line)}.art b{color:var(--warn)}mark{background:#3a3300;color:var(--warn)}
input,textarea,select{width:100%}.half{flex:1;min-width:140px}.badge{background:var(--bad);color:#fff;border-radius:9px;padding:0 7px;font-size:12px;margin-left:4px}
</style></head><body>
<header><h1>&#9878; ASTRA LAW</h1>
<button data-t="code" class="on">LAW CODE</button><button data-t="record">MY RECORD</button><button data-t="lawyers">LAWYERS</button>
<button data-t="court">COURT<span id="bdg" class="badge" style="display:none"></span></button></header>
<main id="m"></main>
<script>
var tab='code',country=null,cache={};
function $(s){return document.querySelector(s)}function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function api(m,p,b){return fetch(p,{method:m,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(function(r){return r.json()}).catch(function(){return{success:false,msg:'Could not reach the server.'}})}
function money(n){return '$'+(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:2})}
function note(r){var d=document.createElement('div');d.className='card '+(r.success?'ok':'bad');d.textContent=r.msg||(r.success?'Done.':'Failed.');$('#m').prepend(d);setTimeout(function(){d.remove()},9000)}
Array.prototype.forEach.call(document.querySelectorAll('header button'),function(b){b.onclick=function(){tab=b.dataset.t;Array.prototype.forEach.call(document.querySelectorAll('header button'),function(x){x.classList.toggle('on',x===b)});render()}});
function lawyerOpts(d){return d.firms.map(function(f){return '<option value="'+f.code+'">'+esc(f.name)+' (skill '+f.skill+', '+(f.fee?money(f.fee):'free')+')</option>'}).join('')+d.players.map(function(p){return '<option value="'+p.code+'">'+esc(p.name)+' - player (skill '+p.skill+', '+money(p.fee)+')</option>'}).join('')}
function render(){var m=$('#m');m.innerHTML='<div class="dim">loading...</div>';({code:rCode,record:rRecord,lawyers:rLawyers,court:rCourt})[tab]()}
function rCode(){api('GET','/api/law/countries').then(function(c){country=country||c.current;api('GET','/api/law/code?country='+country).then(function(d){
var h='<div class="row"><select id="cs" class="half">'+c.countries.map(function(x){return '<option value="'+x.id+'"'+(x.id===country?' selected':'')+'>'+esc(x.label)+(x.id===c.current?' (in force)':'')+'</option>'}).join('')+'</select><input id="q" class="half" placeholder="search the law..."></div>';
if(!d.in_force)h+='<div class="card warn">You are reading a country that is NOT in force. Switch back to the one marked (in force) to see the rules that apply to you today.</div>';
h+=d.parts.map(function(p,i){return '<details '+(i<1?'open':'')+'><summary>'+esc(p.title)+'</summary>'+p.articles.map(function(a){return '<div class="art" data-x="'+esc((a.title+' '+a.text).toLowerCase())+'"><b>Art. '+a.n+' '+esc(a.title)+'.</b> <span>'+esc(a.text)+'</span></div>'}).join('')+'</details>'}).join('');
$('#m').innerHTML=h;$('#cs').onchange=function(){country=this.value;render()};
$('#q').oninput=function(){var q=this.value.toLowerCase();Array.prototype.forEach.call(document.querySelectorAll('.art'),function(a){var hit=!q||a.dataset.x.indexOf(q)>=0;a.style.display=hit?'':'none';if(q&&hit)a.parentNode.open=true})}})})}
function rRecord(){api('GET','/api/law/record').then(function(r){api('GET','/api/law/lawyers').then(function(l){
var h='<div class="card"><b>Convictions:</b> '+r.convictions+' &nbsp; <b>Wanted:</b> '+r.wanted+(r.jail_seconds_left?' &nbsp; <span class="bad">IN CUSTODY '+Math.ceil(r.jail_seconds_left/60)+' min</span>':'')+'</div>';
h+='<div class="row"><select id="lw" class="half">'+lawyerOpts(l)+'</select><button id="ex">PETITION TO ERASE A CONVICTION</button></div><div class="dim">Needs '+r.expunge_clean_h+'h without offenses. '+(r.can_expunge?'<span class="ok">You are eligible.</span>':'<span class="warn">Not eligible right now.</span>')+'</div>';
h+=r.offenses.length?r.offenses.map(function(o){return '<div class="card"><b>'+esc(o.crime)+'</b> - '+esc(o.outcome)+(o.amount?' ('+money(o.amount)+')':'')+' <span class="dim">'+o.at+'</span>'+(o.can_appeal?' <button data-a="'+o.id+'">APPEAL ('+Math.ceil(o.appeal_left_s/60)+' min left)</button>':'')+'</div>'}).join(''):'<div class="card dim">No recorded offenses.</div>';
$('#m').innerHTML=h;$('#ex').onclick=function(){api('POST','/api/law/expunge',{lawyer:$('#lw').value}).then(function(x){note(x);rRecord()})};
Array.prototype.forEach.call(document.querySelectorAll('[data-a]'),function(b){b.onclick=function(){api('POST','/api/law/appeal',{offense_id:b.dataset.a,lawyer:$('#lw').value}).then(function(x){note(x);rRecord()})}})})})}
function rLawyers(){api('GET','/api/law/lawyers').then(function(d){var me=d.me;
var h='<div class="card"><b>FIRMS</b>'+d.firms.map(function(f){return '<div>'+esc(f.name)+' - skill '+f.skill+' - '+(f.fee?money(f.fee):'free')+' <span class="dim">'+esc(f.blurb)+'</span></div>'}).join('')+'</div>';
h+='<div class="card"><b>PLAYER LAWYERS</b>'+(d.players.length?d.players.map(function(p){return '<div>'+esc(p.name)+' - skill '+p.skill+' - '+money(p.fee)+' - '+p.wins+'W/'+p.losses+'L <span class="dim">'+esc(p.bio)+'</span></div>'}).join(''):'<div class="dim">None yet.</div>')+'</div>';
h+=me.disbarred?'<div class="card bad">You have been disbarred.</div>':'<div class="card"><b>'+(me.licensed?'YOUR PRACTICE ('+me.wins+'W/'+me.losses+'L)':'BECOME A LAWYER - bar fee '+money(d.bar_fee))+'</b><div class="row"><input id="fee" class="half" type="number" placeholder="your fee per matter" value="'+(me.fee||1000)+'"><input id="bio" class="half" maxlength="120" placeholder="one line about you" value="'+esc(me.bio)+'"></div><button id="reg">'+(me.licensed?'UPDATE':'TAKE THE BAR')+'</button></div>';
$('#m').innerHTML=h;var b=$('#reg');if(b)b.onclick=function(){api('POST','/api/law/bar/register',{fee:$('#fee').value,bio:$('#bio').value}).then(function(x){note(x);rLawyers()})}})}
function caseHtml(c){var h='<div class="card"><b>#'+c.id+' '+esc(c.claim.toUpperCase())+'</b> '+esc(c.plaintiff)+' v. '+esc(c.defendant)+' - '+money(c.amount)+' - <span class="'+(c.status==='decided'?'dim':'warn')+'">'+esc(c.status)+(c.outcome?' / '+esc(c.outcome):'')+'</span>';
h+='<div class="dim">'+esc(c.statement)+'</div>';if(c.response)h+='<div class="dim">Reply: '+esc(c.response)+'</div>';if(c.ruling)h+='<div>'+esc(c.ruling)+'</div>';
if(c.status==='filed'&&c.role==='defendant'&&!c.d_lawyer&&!c.response)h+='<div class="row warn">You were sued. Answer within '+Math.ceil(c.answer_in_s/60)+' min or lose by default.</div><div class="row"><textarea id="r'+c.id+'" rows="2" placeholder="your response"></textarea></div><div class="row"><select id="l'+c.id+'" class="half">'+(cache.lo||'')+'</select><button data-act="contest" data-id="'+c.id+'">CONTEST</button><button data-act="admit" data-id="'+c.id+'">ADMIT &amp; PAY</button></div><div class="row"><input id="o'+c.id+'" class="half" type="number" placeholder="settlement offer"><button data-act="settle" data-id="'+c.id+'">OFFER SETTLEMENT</button></div>';
if(c.status==='settlement'&&c.role==='plaintiff')h+='<div class="row warn">Offer: '+money(c.settle_offer)+'</div><div class="row"><button data-s="1" data-id="'+c.id+'">ACCEPT</button><button data-s="0" data-id="'+c.id+'">REJECT</button></div>';
if((c.status==='filed'||c.status==='settlement')&&c.role==='plaintiff')h+='<div class="row"><button data-w="'+c.id+'">WITHDRAW</button></div>';return h+'</div>'}
function rCourt(){api('GET','/api/law/lawyers').then(function(l){cache.lo=lawyerOpts(l);api('GET','/api/law/cases').then(function(mine){api('GET','/api/law/docket').then(function(dk){
var h='<div class="card"><b>FILE A SUIT</b><div class="row"><input id="df" class="half" placeholder="defendant username"><select id="ct" class="half">'+['contract','fraud','theft','defamation','negligence'].map(function(x){return '<option>'+x+'</option>'}).join('')+'</select><input id="am" class="half" type="number" placeholder="amount claimed"></div><div class="row"><textarea id="st" rows="3" placeholder="what happened?"></textarea></div><div class="row"><select id="lw" class="half">'+cache.lo+'</select><button id="go">FILE</button></div></div>';
h+='<h3>MY CASES</h3>'+(mine.cases.length?mine.cases.map(caseHtml).join(''):'<div class="dim">None.</div>')+'<h3>PUBLIC DOCKET</h3>'+(dk.cases.length?dk.cases.map(caseHtml).join(''):'<div class="dim">No rulings yet.</div>');
$('#m').innerHTML=h;$('#go').onclick=function(){api('POST','/api/law/sue',{defendant:$('#df').value,claim:$('#ct').value,amount:$('#am').value,statement:$('#st').value,lawyer:$('#lw').value}).then(function(x){note(x);rCourt()})};
Array.prototype.forEach.call(document.querySelectorAll('[data-act]'),function(b){b.onclick=function(){var id=b.dataset.id;api('POST','/api/law/case/'+id+'/answer',{action:b.dataset.act,response:($('#r'+id)||{}).value,lawyer:($('#l'+id)||{}).value,offer:($('#o'+id)||{}).value}).then(function(x){note(x);rCourt()})}});
Array.prototype.forEach.call(document.querySelectorAll('[data-s]'),function(b){b.onclick=function(){api('POST','/api/law/case/'+b.dataset.id+'/settle',{accept:b.dataset.s==='1'}).then(function(x){note(x);rCourt()})}});
Array.prototype.forEach.call(document.querySelectorAll('[data-w]'),function(b){b.onclick=function(){api('POST','/api/law/case/'+b.dataset.w+'/withdraw').then(function(x){note(x);rCourt()})}})})})})}
function poll(){api('GET','/api/law/inbox').then(function(r){var b=$('#bdg');if(r&&r.total){b.textContent=r.total;b.style.display='inline'}else b.style.display='none'})}
render();poll();setInterval(poll,20000);
</script></body></html>"""
