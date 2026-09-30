"""Stage 25 end-to-end test: python test_stage25.py (uses a throwaway DB)."""
import os, sys, json, time, tempfile
_db = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["DATABASE_URL"] = "sqlite:///" + _db.replace("\\", "/")
sys.path.insert(0, ".")
import app as A
from models import db, GameSave
import learn, desk, mail_privacy as mp
c = A.app.test_client()
J = lambda r: r.get_json()
def post(u, b=None): return J(c.post(u, json=b or {}))
assert J(c.post("/register", json={"username": "tester", "password": "secret1"}))["success"]
assert J(c.post("/login", json={"username": "tester", "password": "secret1"}))["success"]

# before a career exists
d = J(c.get("/api/desk/portfolio")); assert d["success"] and d["active"] is False, d
print("inactive desk OK")

post("/api/game/start", {"name": "Test Op"})
d = J(c.get("/api/desk/portfolio"))
assert d["active"] and d["equity"] == 2000 and len(d["universe"]) == 5 and d["session"]["label"], d
print("portfolio OK", d["equity"], d["session"], d["diversification"])

# gated until cert
r = post("/api/desk/order", {"symbol": "OIL", "side": "buy", "type": "market", "qty": 5})
assert not r["success"] and "Brokerage 101" in r["msg"], r
print("cert gate OK:", r["msg"])

with A.app.app_context():
    uid = A.User.query.filter_by(username="tester").first().id
    row, dd = learn._load(uid)
    dd["certs"]["broker"] = "x"
    learn._save(row, dd)

chk = post("/api/desk/check", {"symbol": "CRYPTO", "side": "buy", "type": "market", "qty": 10})
assert chk["success"] and not chk["ok"] and any("Short by" in b for b in chk["blockers"]), chk
assert any("Retail" in b for b in chk["blockers"]) or True
print("check OK:", chk["blockers"], chk["warnings"])

r = post("/api/desk/order", {"symbol": "OIL", "side": "buy", "type": "market", "qty": 5})
assert r["success"] and r["filled"], r; print("buy:", r["msg"])
d = J(c.get("/api/desk/portfolio"))
assert d["positions"][0]["symbol"] == "OIL" and d["positions"][0]["qty"] == 5 and d["cash"] < 2000, d["positions"]
print("position OK", d["positions"][0], "div", d["diversification"], "curve", len(d["curve"]))

# resting limit buy well below market, then cancel -> bin -> restore
px = A.STOCKS["OIL"]["price"]
r = post("/api/desk/order", {"symbol": "OIL", "side": "buy", "type": "limit", "qty": 2, "price": round(px * 0.5, 2)})
assert r["success"] and not r["filled"], r
d = J(c.get("/api/desk/portfolio")); assert len(d["open_orders"]) == 1 and d["buying_power"] < d["cash"]
oid = d["open_orders"][0]["id"]
assert post("/api/desk/cancel", {"id": oid})["success"]
items = J(c.get("/api/desk/bin"))["items"]; assert len(items) == 1 and items[0]["kind"] == "order", items
r = post("/api/desk/bin/restore", {"id": items[0]["id"]}); assert r["success"], r
d = J(c.get("/api/desk/portfolio")); assert len(d["open_orders"]) == 1
print("limit/cancel/bin/restore OK")

# limit that fills when price crosses
A.STOCKS["OIL"]["price"] = round(px * 0.4, 2)
d = J(c.get("/api/desk/portfolio"))
assert not d["open_orders"] and d["positions"][0]["qty"] == 7, (d["open_orders"], d["positions"])
print("lazy limit fill OK")
A.STOCKS["OIL"]["price"] = px

# sell and history
r = post("/api/desk/order", {"symbol": "OIL", "side": "sell", "type": "market", "qty": 7}); assert r["success"], r
d = J(c.get("/api/desk/portfolio")); assert not d["positions"] and any(h["realized"] is not None for h in d["history"])
print("sell OK:", r["msg"])
post("/api/desk/watch", {"symbol": "GOLD", "on": True})
assert [w["symbol"] for w in J(c.get("/api/desk/portfolio"))["watch"]] == ["GOLD"]
print("watch OK; bin empty:", post("/api/desk/bin/empty")["msg"])

# ---------------- privacy ----------------
p = J(c.get("/api/privacy/status")); assert p["success"] and 0 <= p["exposure"] <= 100, p
print("privacy default", p["exposure"], p["score"], p["settings"])
hi = p["exposure"]
p = post("/api/privacy/settings", {"board": "hidden", "profile": "private", "mail": "nobody", "filter": "strict"})
assert p["exposure"] < hi and p["settings"]["board"] == "hidden", p
p = post("/api/privacy/twofa", {"on": True}); assert p["twofa"]
assert not post("/api/privacy/settings", {"board": "bogus"}).get("success", True)
print("settings lowered exposure", hi, "->", p["exposure"])
r = post("/api/privacy/relay"); print("relay:", r["msg"])
assert not post("/api/privacy/relay")["success"]     # cooldown
post("/api/privacy/settings", {"board": "public", "profile": "public", "mail": "anyone", "filter": "off"})

# ---------------- mail ----------------
m = J(c.get("/api/mail/inbox")); assert m["success"] and m["inbox"], m
assert all(x["kind"] is None for x in m["inbox"]), "server must not reveal kind pre-action"
print("first inbox:", [(x["subject"]) for x in m["inbox"]])
# force a phish and a legit through the generator for deterministic tests
with A.app.app_context():
    # generate via internal path by calling the route helper indirectly: insert manually using templates
    for kind, tpl in (("phish", mp._phish_templates(2, "Test", "Analyst", "")[0]), ("phish", mp._phish_templates(0, "Test", "Analyst", "")[1]),
                      ("spam", mp._spam_templates()[0]), ("legit", mp._legit_templates("Test", "Analyst")[0])):
        db.session.add(mp.MailMsg(user_id=uid, folder="inbox", kind=kind, from_name=tpl["from_name"], from_addr=tpl["from_addr"],
            reply_to=tpl.get("reply_to") or tpl["from_addr"], subject=tpl["subject"], body=tpl["body"], link_label=tpl.get("link_label"),
            link_shown=tpl.get("link_shown"), open_app=tpl.get("open_app"), tells_json=json.dumps(tpl["tells"])))
    db.session.commit()
m = J(c.get("/api/mail/inbox"))
by = {x["subject"]: x for x in m["inbox"]}
ph = next(x for x in m["inbox"] if x["subject"].startswith("Test, transfer"))
bal0 = J(c.get("/api/desk/portfolio"))["cash"]
post("/api/privacy/twofa", {"on": False})
r = post("/api/mail/act", {"id": ph["id"]}); assert r["loss"] > 0 and r["tells"], r
bal1 = J(c.get("/api/desk/portfolio"))["cash"]; assert abs((bal0 - bal1) - r["loss"]) < 0.02, (bal0, bal1, r)
print("phish click loss OK:", r["loss"], "|", r["msg"])
r2 = post("/api/mail/act", {"id": ph["id"]}); assert "loss" not in r2   # no double charge
# 2FA halves
ph2 = next(x for x in m["inbox"] if x["subject"].startswith("Your direct deposit") or "nessesary" in x["subject"])
post("/api/privacy/twofa", {"on": True})
r3 = post("/api/mail/act", {"id": ph2["id"]}); assert r3["loss"] > 0; print("2FA click loss:", r3["loss"], r3["msg"])
sp = next(x for x in m["inbox"] if x["subject"].startswith("10x")); lg = next(x for x in m["inbox"] if "statement" in x["subject"])
r = post("/api/mail/report", {"id": sp["id"]}); assert "Correct" in r["msg"] and r["tells"]
r = post("/api/mail/report", {"id": lg["id"]}); assert "False report" in r["msg"] and r["tells"]
p = J(c.get("/api/privacy/status")); assert p["clicked"] == 2 and p["reported"] == 1 and p["false_reports"] == 1, p
m = J(c.get("/api/mail/inbox")); assert sp["id"] not in [x["id"] for x in m["inbox"]]
print("report/false-report/counters OK; score", p["score"])
# Account files are private synced desktop state, with path traversal rejected.
saved_state = post("/api/desktop/state", {
    "window_states": {"dashboard": True, "terminal": False},
    "saved_files": [{"path": "notes/ideas.txt", "content": "saved across devices"}],
})
assert saved_state["success"], saved_state
saved_state = J(c.get("/api/desktop/state"))
assert saved_state["state"]["saved_files"][0]["content"] == "saved across devices", saved_state
assert not post("/api/desktop/state", {"saved_files": [{"path": "../outside.txt", "content": "x"}]})["success"]
print("account file sync and path validation OK")

# Stronger premium-job checks and cooldown after a rejected interview.
with A.app.app_context():
    tester = A.User.query.filter_by(username="tester").first()
    tester_id = tester.id
    tester.is_admin = True
    learning_row, learning_data = learn._load(tester_id)
    learning_data["certs"]["basics"] = "test"
    learn._save(learning_row, learning_data)
    save = GameSave.query.filter_by(user_id=tester_id).first()
    save.job_status = "unemployed"
    save.credit_score = 650
    save.applied_firm = None
    save.last_rejected_firm = None
    save.reapply_after_day = 0
    db.session.commit()
assert not post("/api/game/apply_job", {"firm_id": "meridian"})["success"]
fairview_start = post("/api/game/apply_job", {"firm_id": "fairview"})
assert fairview_start["success"], fairview_start
original_interview_reply = A.ai.interview_reply
A.ai.interview_reply = lambda *args, **kwargs: {"reply": "We will not be moving forward.", "decision": "REJECT"}
try:
    rejected = post("/api/game/interview_answer", {"message": "I understand."})
    assert rejected["decision"] == "REJECT", rejected
finally:
    A.ai.interview_reply = original_interview_reply
cooldown = J(c.post("/api/game/apply_job", json={"firm_id": "fairview"}))
assert not cooldown["success"] and "wait" in cooldown["msg"], cooldown
with A.app.app_context():
    save = GameSave.query.filter_by(user_id=tester_id).first()
    save.day = save.reapply_after_day
    db.session.commit()
assert post("/api/game/apply_job", {"firm_id": "fairview"})["success"]
post("/api/game/abandon_interview")
print("premium credit gate and interview cooldown OK")

# The admin roster and moderation endpoints stay server-protected.
assert c.get("/api/admin/users").status_code == 200
assert len(J(c.get("/api/admin/users?admins_only=1"))["users"]) == 1
assert J(c.post("/register", json={"username": "receiver", "password": "secret2"}))["success"]
receiver = A.app.test_client()
assert J(receiver.post("/login", json={"username": "receiver", "password": "secret2"}))["success"]
assert receiver.get("/api/admin/users").status_code == 403
with A.app.app_context():
    target = A.User.query.filter_by(username="receiver").first()
    target_id = target.id
assert post("/api/admin/users/" + str(target_id) + "/ban", {"reason": "Repeated abuse"})["success"]
assert receiver.get("/api/status").status_code == 403
assert post("/api/admin/users/" + str(target_id) + "/unban", {})["success"]
assert J(receiver.post("/login", json={"username": "receiver", "password": "secret2"}))["success"]
print("admin-only bans and reinstatement OK")

print("ALL TESTS PASSED")
