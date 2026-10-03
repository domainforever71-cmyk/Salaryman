"""SQLAlchemy models for ASTRA.

Solo career state lives on GameSave, one per user. Co-op state lives on
CoopRoom, shared by every member of that room - that's the actual
difference between the two modes, not just a separate screen.
"""

import json
import secrets
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    language = db.Column(db.String(8), default="EN")
    bot_persona = db.Column(db.String(16), default="ruthless")
    risk_threshold = db.Column(db.Integer, default=45)
    execution_speed = db.Column(db.Integer, default=1)
    encryption_mode = db.Column(db.String(16), default="aes256")


    theme = db.Column(db.String(16), default="cyan")
    sfx_enabled = db.Column(db.Boolean, default=True)
    sfx_volume = db.Column(db.Integer, default=70)
    reduce_motion = db.Column(db.Boolean, default=False)
    bg_music_enabled = db.Column(db.Boolean, default=False)


    display_name = db.Column(db.String(32))
    bio = db.Column(db.String(160), default="")
    avatar_glyph = db.Column(db.String(16), default="chip")
    avatar_frame = db.Column(db.String(16), default="none")


    google_sub = db.Column(db.String(64), unique=True, nullable=True)
    google_email = db.Column(db.String(255))


    vault_pin_hash = db.Column(db.String(128))
    vault_salt = db.Column(db.String(64))
    vault_fail_count = db.Column(db.Integer, default=0)
    vault_locked_until = db.Column(db.DateTime)
    vault_tos_accepted_at = db.Column(db.DateTime)


    credits = db.Column(db.Integer, default=0)
    credits_earned_total = db.Column(db.Integer, default=0)
    unlocked_frames_json = db.Column(db.Text, default="[]")
    unlocked_avatars_json = db.Column(db.Text, default="[]")
    desktop_state_json = db.Column(db.Text, default="{}")
    custom_title = db.Column(db.String(32))

    # Moderation. Deliberately just a flag, not a login of its own - there is
    # no hardcoded admin account anywhere in this codebase. An operator
    # becomes an admin by having this column flipped true on their own real
    # account (see admin_tools.py's make_admin script), the same account they
    # already signed up and set their own password for.
    is_admin = db.Column(db.Boolean, default=False)
    is_banned = db.Column(db.Boolean, default=False)
    ban_reason = db.Column(db.String(160))
    banned_at = db.Column(db.DateTime)
    banned_by = db.Column(db.String(64))

    def desktop_state(self):
        try:
            value = json.loads(self.desktop_state_json or "{}")
            return value if isinstance(value, dict) else {}
        except (TypeError, ValueError):
            return {}

    def set_desktop_state(self, value):
        self.desktop_state_json = json.dumps(value)

    def unlocked_frames(self):
        try:
            return json.loads(self.unlocked_frames_json or "[]")
        except ValueError:
            return []

    def unlock_frame(self, frame_id):
        owned = self.unlocked_frames()
        if frame_id not in owned:
            owned.append(frame_id)
            self.unlocked_frames_json = json.dumps(owned)

    def unlocked_avatars(self):
        try:
            return json.loads(self.unlocked_avatars_json or "[]")
        except ValueError:
            return []

    def unlock_avatar(self, avatar_id):
        owned = self.unlocked_avatars()
        if avatar_id not in owned:
            owned.append(avatar_id)
            self.unlocked_avatars_json = json.dumps(owned)

    def set_password(self, raw):
        self.password_hash = generate_password_hash(raw)

    def check_password(self, raw):
        return check_password_hash(self.password_hash, raw)

    def settings_dict(self):
        return {
            "language": self.language,
            "bot_persona": self.bot_persona,
            "risk_threshold": self.risk_threshold,
            "execution_speed": self.execution_speed,
            "encryption_mode": self.encryption_mode,
            "theme": self.theme,
            "sfx_enabled": self.sfx_enabled,
            "sfx_volume": self.sfx_volume,
            "reduce_motion": self.reduce_motion,
            "bg_music_enabled": self.bg_music_enabled,
            "google_linked": bool(self.google_sub),
            "vault_setup": bool(self.vault_pin_hash),
            "credits": self.credits or 0,
            "is_admin": bool(self.is_admin),
        }

    def profile_dict(self):
        return {
            "username": self.username,
            "display_name": (self.display_name or self.username or "").strip() or self.username,
            "bio": self.bio or "",
            "avatar_glyph": self.avatar_glyph or "chip",
            "avatar_frame": self.avatar_frame or "none",
            "member_since": self.created_at.strftime("%b %Y") if self.created_at else "—",
            "credits": self.credits or 0,
        }


class GameSave(db.Model):
    __tablename__ = "game_saves"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False)

    active = db.Column(db.Boolean, default=False)
    name = db.Column(db.String(64), default="Operator")
    age = db.Column(db.Integer, default=20)
    world_tick = db.Column(db.Integer, default=0)
    health = db.Column(db.Integer, default=80)
    balance = db.Column(db.Float, default=2000.0)
    salary = db.Column(db.Float, default=2500.0)
    job_title = db.Column(db.String(64), default="Junior Floor Broker")
    spouse = db.Column(db.String(64))
    company_name = db.Column(db.String(64))

    day = db.Column(db.Integer, default=1)
    week = db.Column(db.Integer, default=1)
    month = db.Column(db.Integer, default=1)
    difficulty = db.Column(db.String(16), default="Normal")

    weekly_target = db.Column(db.Float, default=800.0)
    weekly_bills = db.Column(db.Float, default=450.0)
    weekly_commission = db.Column(db.Float, default=0.0)

    shares_json = db.Column(db.Text, default="{}")
    employees_json = db.Column(db.Text, default="[]")


    job_status = db.Column(db.String(16), default="unemployed") 
    applied_firm = db.Column(db.String(32)) 
    interview_turns = db.Column(db.Integer, default=0)
    interview_transcript = db.Column(db.Text, default="")
    last_rejected_firm = db.Column(db.String(32))
    reapply_after_day = db.Column(db.Integer, default=0)
    job_start_day = db.Column(db.Integer, default=1)


    business_started_day = db.Column(db.Integer)
    business_capital = db.Column(db.Float, default=0.0)

    # --- Work Shifts: the actual job-work minigame (accounting ledger +
    # algebra/commission math + a short essay), gated behind job_status !=
    # "unemployed". work_shift_json holds the ONE currently-open shift (its
    # generated tasks, none of which are stored with answers - those are
    # regenerated server-side at grading time from the same seed so nothing
    # client-visible can just be read back to "solve" it). Completed shifts
    # pay into weekly_commission, the same field trades/deals already feed.
    work_shift_json = db.Column(db.Text, default="{}")
    work_shifts_completed = db.Column(db.Integer, default=0)
    work_tasks_correct = db.Column(db.Integer, default=0)
    work_tasks_total = db.Column(db.Integer, default=0)
    essays_written = db.Column(db.Integer, default=0)  

    # --- Privacy pass: real player-run companies -----------------------------
    # A business_owner save can post ONE open role; another operator's save
    # points back at it via employer_user_id once hired. Payroll for this
    # moves real balance employer->employee (see app._process_player_company_
    # payroll) - it is not conjured like an NPC salary, so it only pays out
    # when the founder themselves advances a day, same honest constraint the
    # existing PlayerHire ("network") payroll already has.
    employer_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    hiring_role = db.Column(db.String(64), nullable=True)
    hiring_salary = db.Column(db.Float, default=0.0)
    hiring_target = db.Column(db.Float, default=0.0)
    hiring_open = db.Column(db.Boolean, default=False)

    boss_mood = db.Column(db.Integer, default=100)
    last_active_day = db.Column(db.Integer, default=1)


    daily_profit = db.Column(db.Float, default=0.0)
    profit_log_json = db.Column(db.Text, default="[]") 

    deals_closed = db.Column(db.Integer, default=0)
    trades_count = db.Column(db.Integer, default=0)
    times_fired = db.Column(db.Integer, default=0)

   
    music_earned_total = db.Column(db.Float, default=0.0)


    cost_basis_json = db.Column(db.Text, default="{}")  
    realized_pnl_total = db.Column(db.Float, default=0.0)

    # --- Phase 6: staff, boss assignments, investor inbox, casino -------
    assignments_json = db.Column(db.Text, default="[]")
    assignment_history_json = db.Column(db.Text, default="[]")
    investor_inbox_json = db.Column(db.Text, default="[]")
    vacation_requests_json = db.Column(db.Text, default="[]")
    casino_stats_json = db.Column(db.Text, default="{}")
    last_assignment_day = db.Column(db.Integer, default=0)
    last_investor_msg_day = db.Column(db.Integer, default=0)
    last_vacation_day = db.Column(db.Integer, default=0)

    # --- Phase 7: debt & credit -------------------------------------------
    # 300-850 scale, same shape as a real consumer score, starting in the
    # "fair" band - good enough for the bottom two lender tiers, not the
    # top one. See game_data.BANK_TIERS and JOB_LISTINGS[*].min_credit_score.
    credit_score = db.Column(db.Integer, default=650)
    loans_json = db.Column(db.Text, default="[]")

    # --- Phase 7: compliance / legal risk -----------------------------------
    # Failing a compliance-flavored assignment (compliance_quiz, reconcile,
    # spot_the_error - "bad trades or skipped compliance quizzes" per the
    # plan) can roll into an audit event. audit_strikes escalates the
    # consequence: 1 = fine, 2 = probation, 3+ = termination. See
    # game_data.AUDIT_RULES and the trigger logic in game_assignment_submit.
    audit_strikes = db.Column(db.Integer, default=0)
    audit_status = db.Column(db.String(20), default="clean")  # clean, fined, probation
    audit_log_json = db.Column(db.Text, default="[]")
    probation_until_week = db.Column(db.Integer, nullable=True)
    probation_pre_salary = db.Column(db.Float, nullable=True)

    # --- Phase 8: paid AI-bot consults --------------------------------------
    # {effect_key: expires_on_day}. Set by /api/game/ai/consult, read by
    # whichever system that effect touches (audit trigger, random events,
    # client trust, arbitrage capture) - see game_data.AI_CONSULTS.
    ai_buff_json = db.Column(db.Text, default="{}")

    def ai_buffs(self):
        return json.loads(self.ai_buff_json or "{}")

    def set_ai_buffs(self, d):
        self.ai_buff_json = json.dumps(d)

    def ai_buff_active(self, effect_key):
        return (self.ai_buffs().get(effect_key) or 0) >= (self.day or 1)

    # --- Phase 7: client relationships --------------------------------------
    # Per-client trust (0-100, starts neutral at 50). A bad pitch drags it
    # down; a closed deal builds it up. Low trust can get you declined on
    # the next call; high trust can pay out a referral bonus on top of the
    # normal commission. See game_data.CLIENT_TRUST_RULES.
    client_trust_json = db.Column(db.Text, default="{}")

    # --- Phase 7: burnout ----------------------------------------------------
    # No new stored state needed - burnout reads straight off the existing
    # `health` column (the HUD's STRESS% is already just 100-health computed
    # client-side), but a forced sick day needs to know it already happened
    # today so advance_day can't double-fire it.
    last_sick_day = db.Column(db.Integer, default=0)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def loans(self):
        return json.loads(self.loans_json or "[]")

    def client_trust(self):
        return json.loads(self.client_trust_json or "{}")

    def set_client_trust(self, d):
        self.client_trust_json = json.dumps(d)

    def audit_log(self):
        return json.loads(self.audit_log_json or "[]")

    def set_audit_log(self, lst):
        self.audit_log_json = json.dumps(lst[-20:])

    def set_loans(self, lst):
        self.loans_json = json.dumps(lst)

    def shares(self):
        return json.loads(self.shares_json or "{}")

    def set_shares(self, d):
        self.shares_json = json.dumps(d)

    def cost_basis(self):
        return json.loads(self.cost_basis_json or "{}")

    def set_cost_basis(self, d):
        self.cost_basis_json = json.dumps(d)

    def record_buy(self, symbol, qty, price):
        """Weighted-average cost basis update for a buy fill. Called from
        the same trade route that updates shares_json, right after it."""
        basis = self.cost_basis()
        entry = basis.get(symbol, {"qty": 0, "avg_cost": 0.0})
        prev_qty, prev_avg = entry.get("qty", 0), entry.get("avg_cost", 0.0)
        new_qty = prev_qty + qty
        new_avg = ((prev_qty * prev_avg) + (qty * price)) / new_qty if new_qty else 0.0
        basis[symbol] = {"qty": new_qty, "avg_cost": round(new_avg, 4)}
        self.set_cost_basis(basis)

    def record_sell(self, symbol, qty, price):
        """Reduces the tracked position and returns the realized P&L for
        this fill: qty * (sale price - average cost). Shares sold beyond
        whatever cost-basis data exists (e.g. positions opened before this
        column existed) are treated as zero cost basis rather than raising -
        the realized figure is then just the full proceeds, which is at
        least honestly labelled as "no basis on record" by the caller."""
        basis = self.cost_basis()
        entry = basis.get(symbol, {"qty": 0, "avg_cost": 0.0})
        avg_cost = entry.get("avg_cost", 0.0)
        realized = round(qty * (price - avg_cost), 2)
        remaining = max(0, entry.get("qty", 0) - qty)
        if remaining <= 0:
            basis.pop(symbol, None)
        else:
            basis[symbol] = {"qty": remaining, "avg_cost": avg_cost}
        self.set_cost_basis(basis)
        self.realized_pnl_total = round((self.realized_pnl_total or 0.0) + realized, 2)
        return realized

    def employees(self):
        return json.loads(self.employees_json or "[]")

    def set_employees(self, lst):
        self.employees_json = json.dumps(lst)

    # --- Phase 6 helpers --------------------------------------------------
    def assignments(self):
        return json.loads(self.assignments_json or "[]")

    def set_assignments(self, lst):
        self.assignments_json = json.dumps(lst)

    def assignment_history(self):
        return json.loads(self.assignment_history_json or "[]")

    def set_assignment_history(self, lst):
        self.assignment_history_json = json.dumps(lst[-40:])

    def investor_inbox(self):
        return json.loads(self.investor_inbox_json or "[]")

    def set_investor_inbox(self, lst):
        self.investor_inbox_json = json.dumps(lst[-30:])

    def vacation_requests(self):
        return json.loads(self.vacation_requests_json or "[]")

    def set_vacation_requests(self, lst):
        self.vacation_requests_json = json.dumps(lst[-30:])

    def casino_stats(self):
        return json.loads(self.casino_stats_json or "{}")

    def set_casino_stats(self, d):
        self.casino_stats_json = json.dumps(d)

    def profit_log(self):
        return json.loads(self.profit_log_json or "[]")

    def set_profit_log(self, lst):
        self.profit_log_json = json.dumps(lst[-120:])

    def add_profit(self, amount):
        """Credit realized profit toward today's running total (called any time
        commission, business revenue, or salary lands - logged to history at day-end)."""
        self.daily_profit = round((self.daily_profit or 0.0) + amount, 2)

    def mark_active(self):
        """Call whenever the operator does something productive (trade, pitch a
        client, interview, hire) so the boss doesn't think they're slacking."""
        self.last_active_day = self.day

    def net_worth(self, stocks=None):
        """balance + the current market value of every held position."""
        total = self.balance or 0.0
        if stocks:
            for sym, qty in self.shares().items():
                stock = stocks.get(sym)
                if stock:
                    total += stock["price"] * qty
        return round(total, 2)

    def compute_score(self):
        tenure_weeks = max(0, self.week - 1)
        score = (
            (self.balance or 0) * 0.01
            + self.deals_closed * 25
            + self.trades_count * 3
            + tenure_weeks * 20
            + (self.boss_mood or 0) * 0.5
            + (150 if self.job_status == "business_owner" else 0)
            - self.times_fired * 40
        )
        return round(max(0, score), 2)

    def to_dict(self):
        return {
            "active": self.active, "name": self.name, "age": self.age, "health": self.health,
            "balance": self.balance, "salary": self.salary, "job_title": self.job_title,
            "spouse": self.spouse, "company_name": self.company_name,
            "day": self.day, "week": self.week, "month": self.month, "difficulty": self.difficulty,
            "weekly_target": self.weekly_target, "weekly_bills": self.weekly_bills,
            "weekly_commission": self.weekly_commission,
            "shares": self.shares(), "employees": self.employees(),
            "job_status": self.job_status, "applied_firm": self.applied_firm,
            "job_start_day": self.job_start_day,
            "boss_mood": self.boss_mood,
            "deals_closed": self.deals_closed, "trades_count": self.trades_count,
            "score": self.compute_score(),
            "business_started_day": self.business_started_day,
            "business_capital": self.business_capital,
            "work_shifts_completed": self.work_shifts_completed,
            "work_tasks_correct": self.work_tasks_correct,
            "work_tasks_total": self.work_tasks_total,
            "essays_written": self.essays_written,
            "credit_score": self.credit_score,
            "audit_strikes": self.audit_strikes, "audit_status": self.audit_status,
            "employer_user_id": self.employer_user_id,
            "hiring_role": self.hiring_role, "hiring_salary": self.hiring_salary,
            "hiring_target": self.hiring_target,
            "hiring_open": self.hiring_open,
        }


class LinkedDevice(db.Model):
    """One row per browser/device that has ever logged in, tracked via an
    httpOnly device_token cookie so the SETTINGS page can list and revoke
    sessions by name instead of just guessing."""
    __tablename__ = "linked_devices"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    device_token = db.Column(db.String(64), unique=True, nullable=False)
    label = db.Column(db.String(64), default="New Terminal")
    user_agent = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, current_token=None):
        return {
            "id": self.id,
            "label": self.label,
            "user_agent": self.user_agent or "Unknown client",
            "last_seen": self.last_seen.strftime("%Y-%m-%d %H:%M") if self.last_seen else None,
            "is_current": bool(current_token) and self.device_token == current_token,
        }


class VaultEntry(db.Model):
    """A single encrypted credential saved by the operator. `ciphertext` is
    the base64 payload produced by vault_crypto.encrypt() - the plaintext
    never touches the database."""
    __tablename__ = "vault_entries"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    label = db.Column(db.String(64), nullable=False)
    ciphertext = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
        }


class MusicTrack(db.Model):
    """A track released from the Music Studio. Only the seed is stored - the
    browser regenerates the actual audio from {genre,bpm,key,bars,seed} via
    Chiptune.play(), so a track costs a few dozen bytes, not a media file."""
    __tablename__ = "music_tracks"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)

    title = db.Column(db.String(64), nullable=False)
    genre = db.Column(db.String(16), nullable=False)
    label_id = db.Column(db.String(16), nullable=False)
    key = db.Column(db.String(2), default="C")
    bpm = db.Column(db.Integer, default=120)
    bars = db.Column(db.Integer, default=8)
    seed = db.Column(db.Integer, default=1)

    pattern_json = db.Column(db.Text)

    score = db.Column(db.Integer, default=50)           
    base_daily_royalty = db.Column(db.Float, default=0.0)
    age_days = db.Column(db.Integer, default=0)
    total_earned = db.Column(db.Float, default=0.0)
    released_day = db.Column(db.Integer, default=1)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def pattern(self):
        if not self.pattern_json:
            return None
        try:
            return json.loads(self.pattern_json)
        except ValueError:
            return None

    def daily_royalty(self):
        """Royalties decay slowly as a track ages - never to zero, but a
        five-year-old single shouldn't out-earn this week's release."""
        decay = max(0.15, 1 - (self.age_days or 0) * 0.01)
        return round((self.base_daily_royalty or 0.0) * decay, 2)

    def to_dict(self):
        return {
            "id": self.id, "title": self.title, "genre": self.genre, "label": self.label_id,
            "key": self.key, "bpm": self.bpm, "bars": self.bars, "seed": self.seed,
            "score": self.score, "daily_royalty": self.daily_royalty(),
            "total_earned": round(self.total_earned or 0.0, 2), "released_day": self.released_day,
            "pattern": self.pattern(),
        }


def _new_room_code():
    return secrets.token_hex(3).upper()


class Friendship(db.Model):
    """One row per friend relationship, in whichever direction it started.
    `status` moves pending -> accepted; a declined/cancelled request is just
    deleted rather than kept around in a third state."""
    __tablename__ = "friendships"

    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    addressee_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    status = db.Column(db.String(16), default="pending")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    responded_at = db.Column(db.DateTime)


class DirectMessage(db.Model):
    """A single DM between two friends. `body` holds plaintext, or - when
    `encrypted` is set - the base64 payload from vault_crypto.encrypt(),
    keyed to a PIN the sender chooses for that message (not necessarily
    their vault PIN, since the recipient needs to be able to decrypt it too
    and only the sender's own vault PIN is derived from their account).
    Uses the same PIN-derived-key primitive as the vault, not the vault's
    stored secret itself."""
    __tablename__ = "direct_messages"

    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    recipient_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    body = db.Column(db.Text, nullable=False)
    encrypted = db.Column(db.Boolean, default=False)
    salt = db.Column(db.String(64)) 
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    read_at = db.Column(db.DateTime)

    def to_dict(self, viewer_id):
        att = self.attachment
        return {
            "id": self.id,
            "from_me": self.sender_id == viewer_id,
            "encrypted": bool(self.encrypted),
            "body": None if self.encrypted else self.body,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
           
            "read": bool(self.read_at),
            "read_at": self.read_at.strftime("%Y-%m-%d %H:%M") if self.read_at else None,
            "attachment": att.to_dict() if att else None,
        }


class Report(db.Model):
    """A player-filed report - on another operator, a DM, or a post from the
    social feed once that ships. Deliberately generic (target_type/target_id
    instead of separate tables per thing you can report) so BLABBER posts,
    usernames, and DM abuse all funnel into one admin queue. Resolving a
    report never deletes the reported content itself - an admin can act on
    it (ban, warn, dismiss) but this table is the audit trail of that
    decision, not the enforcement mechanism."""
    __tablename__ = "reports"

    id = db.Column(db.Integer, primary_key=True)
    reporter_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    target_username = db.Column(db.String(64), nullable=False)
    target_type = db.Column(db.String(24), default="user")  # user | dm | post
    target_ref = db.Column(db.String(64))  # optional: a DM id, a post id, etc.
    reason = db.Column(db.String(32), default="other")  # cheating | nsfw | harassment | scam | other
    details = db.Column(db.String(500), default="")
    status = db.Column(db.String(16), default="open")  # open | reviewing | resolved | dismissed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    resolved_at = db.Column(db.DateTime)
    resolved_by = db.Column(db.String(64))
    resolution_note = db.Column(db.String(500), default="")

    def to_dict(self, reporter_name=None):
        return {
            "id": self.id, "reporter": reporter_name, "target_username": self.target_username,
            "target_type": self.target_type, "target_ref": self.target_ref,
            "reason": self.reason, "details": self.details, "status": self.status,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
            "resolved_at": self.resolved_at.strftime("%Y-%m-%d %H:%M") if self.resolved_at else None,
            "resolved_by": self.resolved_by, "resolution_note": self.resolution_note,
        }


class CoopRoom(db.Model):
    __tablename__ = "coop_rooms"

    id = db.Column(db.Integer, primary_key=True)
    room_code = db.Column(db.String(8), unique=True, nullable=False, default=_new_room_code)
    firm_name = db.Column(db.String(64), default="Unnamed Syndicate")
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"))

    balance = db.Column(db.Float, default=5000.0)
    weekly_target = db.Column(db.Float, default=1500.0)
    weekly_bills = db.Column(db.Float, default=700.0)
    weekly_commission = db.Column(db.Float, default=0.0)
    day = db.Column(db.Integer, default=1)
    week = db.Column(db.Integer, default=1)
    shares_json = db.Column(db.Text, default="{}")

    # --- Phase 8: syndicate cross-effects -----------------------------------
    # Members keep their own solo GameSave/balance/risk - this pair of dials
    # is the actual link between them. Pushed by members' own solo actions
    # (see game_data.SYNDICATE_RULES), decays daily, read by every member's
    # own solo systems while they're in this room.
    heat = db.Column(db.Float, default=0.0)
    sentiment = db.Column(db.Float, default=0.0)

  
    revision = db.Column(db.Integer, default=1)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def shares(self):
        return json.loads(self.shares_json or "{}")

    def set_shares(self, d):
        self.shares_json = json.dumps(d)

    def touch(self):
        self.revision = (self.revision or 1) + 1

    def to_dict(self, members=None):
        return {
            "room_code": self.room_code, "firm_name": self.firm_name,
            "revision": self.revision or 1,
            "balance": self.balance, "weekly_target": self.weekly_target,
            "weekly_bills": self.weekly_bills, "weekly_commission": self.weekly_commission,
            "day": self.day, "week": self.week, "shares": self.shares(),
            "heat": round(self.heat or 0, 1), "sentiment": round(self.sentiment or 0, 1),
            "members": members or [],
        }


class CoopMembership(db.Model):
    __tablename__ = "coop_memberships"

    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("coop_rooms.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Presence heartbeat + how much this member has traded in the room. app.py's
    # coop_state / coop_trade_share read and write both; without the columns the
    # whole syndicate screen raised AttributeError.
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    contribution = db.Column(db.Float, default=0.0)


class CoopLogEntry(db.Model):
    __tablename__ = "coop_log_entries"

    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("coop_rooms.id"), nullable=False)
    username = db.Column(db.String(64))
    message = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {"username": self.username, "message": self.message,
                "time": self.created_at.strftime("%H:%M:%S")}

class DMAttachment(db.Model):
    """A file attached to a DM. Small by design (256 KB cap, enforced in
    app.py): the browser base64s the file, and when the sender ticks
    "encrypt", the *bytes* are run through vault_crypto with a PIN the sender
    picks - so the server stores ciphertext plus a random salt and never sees
    the file contents or the PIN. Filename and MIME type are stored in the
    clear so the thread can show "photo.png, 40 KB" without decrypting."""
    __tablename__ = "dm_attachments"

    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("direct_messages.id"), nullable=False, index=True)
    filename = db.Column(db.String(128), nullable=False)
    mime = db.Column(db.String(64), default="application/octet-stream")
    size_bytes = db.Column(db.Integer, default=0)
    encrypted = db.Column(db.Boolean, default=False)
    salt = db.Column(db.String(64))        
    payload = db.Column(db.Text, nullable=False)  
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    message = db.relationship(
        "DirectMessage",
        backref=db.backref("attachment", uselist=False, cascade="all, delete-orphan"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "mime": self.mime,
            "size_bytes": self.size_bytes or 0,
            "encrypted": bool(self.encrypted),
        }


class TradeOffer(db.Model):
    """A player-to-player exchange of cash and/or shares.

    Lifecycle: draft -> pending -> accepted | declined | cancelled.

    `draft` is what makes a trade resumable: the composer writes the offer to
    the server as you build it, so closing the tab (or switching device) and
    coming back restores exactly what you had staged. Only one draft exists
    per (sender, recipient) pair - it is the scratchpad for that pairing.

    The terms themselves are deliberately *not* encrypted: the server has to
    read them to move the assets, and pretending otherwise would be theatre.
    `note` / `note_salt` hold an optional memo that IS encrypted with a
    sender-chosen PIN (same primitive as the vault and DMs), for anything the
    two of you want to say about the trade that the server shouldn't hold in
    the clear.
    """
    __tablename__ = "trade_offers"

    id = db.Column(db.Integer, primary_key=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    to_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    status = db.Column(db.String(16), default="draft", index=True)

    offer_cash = db.Column(db.Float, default=0.0)
    offer_shares_json = db.Column(db.Text, default="{}")
    want_cash = db.Column(db.Float, default=0.0)
    want_shares_json = db.Column(db.Text, default="{}")

    note = db.Column(db.Text)    
    note_encrypted = db.Column(db.Boolean, default=False)
    note_salt = db.Column(db.String(64))

    allow_partial = db.Column(db.Boolean, default=False)
    fills = db.Column(db.Integer, default=0)


    counter_to_id = db.Column(db.Integer, db.ForeignKey("trade_offers.id"))

    decline_reason = db.Column(db.String(160))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at = db.Column(db.DateTime)

    def offer_shares(self):
        return json.loads(self.offer_shares_json or "{}")

    def set_offer_shares(self, d):
        self.offer_shares_json = json.dumps({k: int(v) for k, v in d.items() if int(v) > 0})

    def want_shares(self):
        return json.loads(self.want_shares_json or "{}")

    def set_want_shares(self, d):
        self.want_shares_json = json.dumps({k: int(v) for k, v in d.items() if int(v) > 0})

    def is_empty(self):
        return (not self.offer_cash and not self.want_cash
                and not self.offer_shares() and not self.want_shares())

    def to_dict(self, viewer_id, counterparty=None):
        return {
            "id": self.id,
            "status": self.status,
            "from_me": self.from_user_id == viewer_id,
            "counterparty": counterparty,
            "offer_cash": round(self.offer_cash or 0.0, 2),
            "offer_shares": self.offer_shares(),
            "want_cash": round(self.want_cash or 0.0, 2),
            "want_shares": self.want_shares(),
            "allow_partial": bool(self.allow_partial),
            "fills": self.fills or 0,
            "counter_to_id": self.counter_to_id,
            "note_encrypted": bool(self.note_encrypted),
            "note": None if self.note_encrypted else (self.note or ""),
            "decline_reason": self.decline_reason,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
            "updated_at": self.updated_at.strftime("%Y-%m-%d %H:%M") if self.updated_at else None,
        }


class CreditLedger(db.Model):
    """Every credit in or out, with a reason - so the CREDITS tab can show
    where they came from instead of a number that changes on its own."""
    __tablename__ = "credit_ledger"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    amount = db.Column(db.Integer, nullable=False)  
    reason = db.Column(db.String(96), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "amount": self.amount,
            "reason": self.reason,
            "at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
        }


class PriceAlert(db.Model):
    """A user-set threshold on a ticker. Deliberately evaluated lazily, in
    api_alerts()'s normal request handler, against whatever STOCKS shows at
    that moment - never from the market_tick() background thread, which
    never touches the database. That's one fewer thing writing to SQLite
    outside a normal Flask request, on top of the concurrency compromise
    already documented for co-op long-polling."""
    __tablename__ = "price_alerts"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    symbol = db.Column(db.String(16), nullable=False)
    direction = db.Column(db.String(8), nullable=False)  
    threshold = db.Column(db.Float, nullable=False)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    triggered_at = db.Column(db.DateTime)
    triggered_price = db.Column(db.Float)

    def to_dict(self):
        return {
            "id": self.id, "symbol": self.symbol, "direction": self.direction,
            "threshold": self.threshold, "active": self.active,
            "created_at": self.created_at.strftime("%b %d %H:%M") if self.created_at else None,
            "triggered": self.triggered_at is not None,
            "triggered_at": self.triggered_at.strftime("%b %d %H:%M") if self.triggered_at else None,
            "triggered_price": self.triggered_price,
        }


class PlayerHire(db.Model):
    """Phase 8: real player-to-player hiring. One row is one employment
    relationship between two real accounts (employer -> employee), separate
    from the NPC `employees_json` roster on GameSave - this is a person, not
    flavor text. Restricted at the route level to accepted friends.

    Lifecycle: pending -> active (accepted) or declined; active -> ended
    (either side can end it). Payroll is processed once per employer's own
    advance_day call in _process_player_hires(), which pays the employer's
    GameSave.balance out to the employee's GameSave.balance directly -
    real money moving between two real careers, not a cosmetic number."""
    __tablename__ = "player_hires"

    id = db.Column(db.Integer, primary_key=True)
    employer_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    role = db.Column(db.String(64), default="Contract Operator")
    salary = db.Column(db.Float, default=0.0)  # per week, paid employer -> employee in daily installments
    status = db.Column(db.String(16), default="pending")  # pending/active/declined/ended
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    responded_at = db.Column(db.DateTime)
    total_paid = db.Column(db.Float, default=0.0)
    last_paid_day = db.Column(db.Integer, default=0)

    def to_dict(self, employer_name=None, employee_name=None):
        return {
            "id": self.id,
            "employer_id": self.employer_id, "employee_id": self.employee_id,
            "employer_name": employer_name, "employee_name": employee_name,
            "role": self.role, "salary": self.salary, "status": self.status,
            "total_paid": round(self.total_paid or 0, 2),
            "last_paid_day": self.last_paid_day,
            "created_at": self.created_at.strftime("%b %d %H:%M") if self.created_at else None,
        }


class CoopBan(db.Model):
    """A user the syndicate owner has kicked with the door locked behind
    them - rejoining by room code is refused while this row exists."""
    __tablename__ = "coop_bans"

    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey("coop_rooms.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    banned_by = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ImageAsset(db.Model):
    """A private, account-owned picture that can be reused in game messages."""
    __tablename__ = "image_assets"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    filename = db.Column(db.String(128), nullable=False)
    mime = db.Column(db.String(32), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False)
    payload = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id": self.id, "filename": self.filename, "mime": self.mime,
            "size_bytes": self.size_bytes,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
        }


def ensure_schema(engine):
    """create_all() only creates missing *tables* - it will never add a
    column to a table that already exists. That means anyone upgrading from
    an older astra.db would need to delete their save every time this file
    grows a new column. This inspects the live schema and ALTERs in any
    column that's on the model but missing from the actual table, so
    upgrades are additive instead of destructive. SQLite (the default here)
    supports ADD COLUMN directly; this is safe to call on every boot."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    for model in (User, GameSave, LinkedDevice, VaultEntry, MusicTrack, CoopRoom,
                  CoopMembership, CoopLogEntry, Friendship, DirectMessage,
                  DMAttachment, TradeOffer, CreditLedger, CoopBan, PriceAlert,
                  PlayerHire, Report, ImageAsset):
        table = model.__table__
        if table.name not in existing_tables:
            continue  
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing_cols:
                continue
            try:
                col_type = col.type.compile(engine.dialect)
            except Exception:
                col_type = "TEXT"
            default_sql = ""
            default = col.default
            if default is not None and getattr(default, "is_scalar", False):
                val = default.arg
                if isinstance(val, bool):
                    default_sql = f" DEFAULT {1 if val else 0}"
                elif isinstance(val, (int, float)):
                    default_sql = f" DEFAULT {val}"
                elif isinstance(val, str):
                    escaped = val.replace("'", "''")
                    default_sql = f" DEFAULT '{escaped}'"
            ddl = f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {col_type}{default_sql}'
            with engine.connect() as conn:
                conn.execute(text(ddl))
              
                conn.commit()
                conn.commit()