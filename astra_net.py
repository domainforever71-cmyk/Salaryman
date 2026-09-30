"""astra_net.py - networking glue for Astra.

Four things live here, all small and all independent of the game rules:

1. find_user(name)      case-insensitive username lookup ("doMs" finds "Doms").
2. ADMIN_USERNAMES      operators who are admins no matter what case they typed.
3. Multi-server         /api/ping, /api/servers, server hand-off between servers.
4. /api/live/sync       one cheap call the browser makes every ~1.5s so messages,
                        friend requests, trade offers etc. show up without a
                        refresh or a re-click.

HOW MULTIPLE SERVERS WORK
-------------------------
Every server is the same app, deployed in a different region, pointed at the
SAME database (DATABASE_URL) and using the SAME SECRET_KEY. Because the data
lives in one shared database, a player on the EU server and a player on the US
server see the same accounts, friends and messages - they just each talk to
the app instance closest to them, which is what keeps their ping low.

List the servers in every instance's environment:

    ASTRA_SERVERS=eu|Europe|https://eu.example.com,us|N. America|https://us.example.com
    ASTRA_SERVER_ID=eu          # which one THIS instance is

With nothing set, the app behaves as a single server exactly as before.
"""
import hashlib
import os
import time

from flask import jsonify, redirect, request, session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from models import db, User

# --------------------------------------------------------------------------
# 1. case-insensitive usernames
# --------------------------------------------------------------------------


def find_user(name):
    """Look a player up by username, ignoring case.

    If an old database somehow holds two accounts that differ only by case
    ("Doms" and "doms"), an exact-case match wins so nobody gets locked out.
    """
    name = (name or "").strip()
    if not name:
        return None
    exact = User.query.filter_by(username=name).first()
    if exact:
        return exact
    return User.query.filter(db.func.lower(User.username) == name.lower()).first()


# --------------------------------------------------------------------------
# 2. admins by name
# --------------------------------------------------------------------------

ADMIN_USERNAMES = {
    n.strip().lower()
    for n in os.environ.get("ADMIN_USERNAMES", "alex,domain").split(",")
    if n.strip()
}


def is_admin_name(username):
    return (username or "").strip().lower() in ADMIN_USERNAMES


def ensure_admin(user):
    """Flip is_admin on for a listed operator. Returns True if it changed."""
    if user is not None and not user.is_admin and is_admin_name(user.username):
        user.is_admin = True
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            return False
        return True
    return False


def sync_admins():
    """Run once at startup: anyone already registered under a listed name."""
    if not ADMIN_USERNAMES:
        return
    rows = User.query.filter(db.func.lower(User.username).in_(ADMIN_USERNAMES)).all()
    changed = False
    for u in rows:
        if not u.is_admin:
            u.is_admin = True
            changed = True
    if changed:
        db.session.commit()


# --------------------------------------------------------------------------
# 3. servers
# --------------------------------------------------------------------------


def _parse_servers(raw):
    out = []
    for chunk in (raw or "").split(","):
        parts = [p.strip() for p in chunk.split("|")]
        if len(parts) == 3 and parts[0] and parts[2].lower().startswith(("http://", "https://")):
            out.append({"id": parts[0], "name": parts[1] or parts[0], "url": parts[2].rstrip("/")})
    return out


SERVERS = _parse_servers(os.environ.get("ASTRA_SERVERS", ""))
SERVER_ID = os.environ.get("ASTRA_SERVER_ID", "").strip() or (SERVERS[0]["id"] if SERVERS else "main")
HANDOFF_MAX_AGE = 30  # seconds a hand-off link stays valid


def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Cache-Control"] = "no-store"
    return resp


def init_net(app, login_required, current_user):
    serializer = URLSafeTimedSerializer(app.secret_key, salt="astra-server-handoff")

    # ---- ping: no DB, no session - measures the network, not the app --------
    @app.route("/api/ping", methods=["GET", "OPTIONS"])
    def api_ping():
        return _cors(jsonify(ok=True, server=SERVER_ID, t=time.time()))

    @app.route("/api/servers")
    def api_servers():
        servers = SERVERS or [{"id": SERVER_ID, "name": "Main", "url": ""}]
        return _cors(jsonify(success=True, current=SERVER_ID, servers=servers))

    # ---- hand-off: move a logged-in player to another server without a re-login
    @app.route("/api/servers/handoff", methods=["POST"])
    @login_required
    def api_handoff():
        data = request.get_json(silent=True) or {}
        target = next((s for s in SERVERS if s["id"] == data.get("server")), None)
        if not target:
            return jsonify(success=False, msg="Unknown server."), 404
        token = serializer.dumps({"uid": session.get("user_id")})
        return jsonify(success=True, url=f"{target['url']}/auth/handoff?t={token}")

    @app.route("/auth/handoff")
    def auth_handoff():
        try:
            payload = serializer.loads(request.args.get("t", ""), max_age=HANDOFF_MAX_AGE)
        except SignatureExpired:
            return redirect("/login?msg=handoff-expired")
        except BadSignature:
            return redirect("/login")
        user = db.session.get(User, payload.get("uid"))
        if not user or user.is_banned:
            return redirect("/login")
        session["user_id"] = user.id
        session["username"] = user.username
        return redirect("/")

    # ---- live sync ----------------------------------------------------------
    @app.route("/api/live/sync")
    @login_required
    def api_live_sync():
        from models import DirectMessage, Friendship, TradeOffer, PlayerHire, CoopRoom

        user = current_user()
        uid = user.id

        # unread messages, grouped by sender
        unread_rows = (
            db.session.query(DirectMessage.sender_id, db.func.count(DirectMessage.id),
                             db.func.max(DirectMessage.id))
            .filter(DirectMessage.recipient_id == uid, DirectMessage.read_at.is_(None))
            .group_by(DirectMessage.sender_id)
            .all()
        )
        unread_by, newest_unread = {}, 0
        for sender_id, count, max_id in unread_rows:
            sender = db.session.get(User, sender_id)
            if sender:
                unread_by[sender.username] = {"count": count, "last_id": max_id}
                newest_unread = max(newest_unread, max_id or 0)

        # friends: a signature that changes whenever a request is sent,
        # accepted, declined or removed
        fr_rows = Friendship.query.filter(
            db.or_(Friendship.requester_id == uid, Friendship.addressee_id == uid)
        ).all()
        incoming = []
        sig_parts = []
        for f in fr_rows:
            sig_parts.append(f"{f.id}:{f.status}")
            if f.status == "pending" and f.addressee_id == uid:
                other = db.session.get(User, f.requester_id)
                if other:
                    incoming.append(other.username)
        friends_sig = hashlib.md5("|".join(sorted(sig_parts)).encode()).hexdigest()[:12]

        trades_in = TradeOffer.query.filter_by(to_user_id=uid, status="pending").count()
        hires_in = PlayerHire.query.filter_by(employee_id=uid, status="pending").count()

        # the thread the player currently has open (if any)
        thread = None
        with_name = (request.args.get("with") or "").strip()
        if with_name:
            other = find_user(with_name)
            if other:
                pair = db.or_(
                    db.and_(DirectMessage.sender_id == uid, DirectMessage.recipient_id == other.id),
                    db.and_(DirectMessage.sender_id == other.id, DirectMessage.recipient_id == uid),
                )
                last_id, total = db.session.query(
                    db.func.max(DirectMessage.id), db.func.count(DirectMessage.id)
                ).filter(pair).one()
                my_read = DirectMessage.query.filter(
                    DirectMessage.sender_id == uid, DirectMessage.recipient_id == other.id,
                    DirectMessage.read_at.isnot(None)).count()
                thread = {"with": other.username, "last_id": last_id or 0,
                          "count": total or 0, "read": my_read}

        coop_rev = None
        room_id = session.get("coop_room_id")
        if room_id:
            coop_rev = db.session.query(CoopRoom.revision).filter(CoopRoom.id == room_id).scalar()

        db.session.rollback()  # read-only request: release the connection at once
        return jsonify(
            success=True, server=SERVER_ID, t=time.time(),
            unread_total=sum(v["count"] for v in unread_by.values()),
            unread_by=unread_by, newest_unread=newest_unread,
            friends_sig=friends_sig, incoming_requests=incoming,
            trades_in=trades_in, hires_in=hires_in,
            thread=thread, coop_rev=coop_rev,
        )
