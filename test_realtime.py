"""Tests for: case-insensitive names, admin names, servers, live sync.
Run:  python test_realtime.py   (uses a throwaway database, never astra.db)"""
import os, sys, tempfile
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "t.db").replace("\\", "/")
os.environ["SECRET_KEY"] = "test-secret"
os.environ["ASTRA_SERVERS"] = "eu|Europe|https://eu.example.com,us|N. America|https://us.example.com"
os.environ["ASTRA_SERVER_ID"] = "eu"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as A
from models import User

def client(): return A.app.test_client()
def reg(c, n, pw="secret1"): return c.post("/register", json={"username": n, "password": pw})
def login(c, n, pw="secret1"): return c.post("/login", json={"username": n, "password": pw})
ok = 0
def check(cond, label):
    global ok
    assert cond, "FAIL: " + label
    ok += 1; print("  ok  " + label)

a, b, dom, alex = client(), client(), client(), client()

# --- case-insensitive names
check(reg(a, "Doms").status_code == 200, "register Doms")
check(reg(client(), "doms").status_code == 409, "'doms' is rejected as a duplicate of 'Doms'")
check(reg(client(), "DOMS").status_code == 409, "'DOMS' is rejected too")
check(login(client(), "dOmS").status_code == 200, "login works with wrong capitalisation")
reg(b, "Bob"); login(b, "bob"); login(a, "Doms")
r = b.post("/api/friends/request", json={"username": "doMs"}).get_json()
check(r["success"], "friend request to 'doMs' finds Doms")
live = a.get("/api/live/sync").get_json()
check(live["incoming_requests"] == ["Bob"], "Doms sees the incoming request via live sync (no click)")
fid = a.get("/api/friends").get_json()["incoming"][0]["id"]
a.post("/api/friends/respond", json={"id": fid, "action": "accept"})
live2 = a.get("/api/live/sync").get_json()
check(live2["friends_sig"] != live["friends_sig"], "friends signature changes when request is accepted")
check(b.get("/api/live/sync").get_json()["friends_sig"] == live2["friends_sig"], "both sides see the same change")

# --- messaging with sloppy case + live thread updates
s0 = b.get("/api/live/sync?with=DOMS").get_json()["thread"]
check(s0["with"] == "Doms" and s0["count"] == 0, "live sync resolves thread name case-insensitively")
check(b.post("/api/messages/send", json={"to": "dOMs", "body": "hi"}).get_json()["success"], "send DM to 'dOMs'")
la = a.get("/api/live/sync").get_json()
check(la["unread_total"] == 1 and la["unread_by"]["Bob"]["count"] == 1, "recipient's unread count appears by itself")
check(a.get("/api/live/sync?with=bob").get_json()["thread"]["count"] == 1, "open thread sees the new message")
a.get("/api/messages/BOB")
check(a.get("/api/live/sync").get_json()["unread_total"] == 0, "opening thread (any case) clears unread")
s1 = b.get("/api/live/sync?with=doms").get_json()["thread"]
check(s1["read"] == 1, "sender sees read receipt change")
check(b.post("/api/friends/remove", json={"username": "DOMS"}).get_json()["success"], "remove friend with wrong case")

# --- admins
reg(dom, "domain"); login(dom, "DOMAIN")
check(dom.get("/api/admin/reports").status_code == 200, "'domain' (any case) is an admin")
reg(alex, "Alex"); login(alex, "Alex")
check(alex.get("/api/admin/reports").status_code == 200, "'Alex' is an admin")
check(b.get("/api/admin/reports").status_code == 403, "normal player is NOT an admin")
with A.app.app_context():
    check(User.query.filter_by(username="Bob").first().is_admin is False, "Bob's flag stays off")

# --- servers
r = client().get("/api/ping"); d = r.get_json()
check(d["ok"] and d["server"] == "eu", "ping answers with the server id")
check(r.headers["Access-Control-Allow-Origin"] == "*", "ping allows cross-origin (so the browser can time it)")
sv = client().get("/api/servers").get_json()
check([s["id"] for s in sv["servers"]] == ["eu", "us"] and sv["current"] == "eu", "server list")
h = a.post("/api/servers/handoff", json={"server": "us"}).get_json()
check(h["success"] and h["url"].startswith("https://us.example.com/auth/handoff?t="), "handoff link points at the other server")
check(a.post("/api/servers/handoff", json={"server": "evil"}).status_code == 404, "handoff refuses unknown servers")
c2 = client(); tok = h["url"].split("t=")[1]
r = c2.get("/auth/handoff?t=" + tok)
check(r.status_code == 302 and c2.get("/api/friends").status_code == 200, "handoff token logs the player in on the other server")
check(client().get("/auth/handoff?t=garbage").status_code == 302 and client().get("/api/friends").status_code == 401, "bad token does not log anyone in")

# --- syndicate poll no longer parks a worker
import time
a.post("/api/coop/create", json={"firm_name": "T"})
st = a.get("/api/coop/state").get_json()
t0 = time.time(); r = a.get("/api/coop/poll?since=%d" % st.get("revision", 0)); dt = time.time() - t0
check(r.status_code == 200 and dt < 2, "coop poll returns immediately (%.2fs) instead of holding a thread for 20s" % dt)
print("\nALL %d CHECKS PASSED" % ok)

# --- syndicate walkthrough (also proves it follows the account across servers)
print("\nsyndicate:")
owner, member = client(), client()
reg(owner, "Boss"); login(owner, "boss"); reg(member, "Pal"); login(member, "PAL")
code = owner.post("/api/coop/create", json={"firm_name": "Night Desk"}).get_json()["room_code"]
check(member.post("/api/coop/join", json={"room_code": code.lower()}).get_json()["success"], "join with lowercase room code")
st = member.get("/api/coop/state").get_json()
check(st["success"] and len(st["member_stats"]) == 2, "state lists both members with presence")
check(member.post("/api/coop/chat", json={"message": "hello"}).get_json()["success"], "chat")
sym = next(iter(st["stocks"]))
tr = member.post("/api/coop/trade_share", json={"symbol": sym, "action": "buy", "qty": 1}).get_json()
check("success" in tr, "trade_share responds without crashing")
r1 = owner.get("/api/live/sync").get_json()["coop_rev"]
member.post("/api/coop/chat", json={"message": "again"})
check(owner.get("/api/live/sync").get_json()["coop_rev"] != r1, "room revision moves when a member chats (live update)")
fresh = client(); login(fresh, "pal")
check(fresh.get("/api/coop/state").get_json()["success"], "fresh login / other server is still in the syndicate")
check(owner.post("/api/coop/kick", json={"username": "PAL", "ban": True}).get_json()["success"], "owner kicks 'PAL' (any case) with ban")
check(fresh.get("/api/coop/state").status_code == 404, "kicked player is out")
print("\nALL %d CHECKS PASSED" % ok)
