import random
from flask import Flask, session, jsonify
from functools import wraps
from models import db, User, GameSave
from world import init_world, CRIMES
from economy import init_economy, cpi, Holding, Wallet, StockState
app = Flask(__name__); app.secret_key="k"
app.config["SQLALCHEMY_DATABASE_URI"]="sqlite:///:memory:"; app.config["SQLALCHEMY_TRACK_MODIFICATIONS"]=False
db.init_app(app)
def cu(): return db.session.get(User, session.get("user_id"))
def login_required(v):
    @wraps(v)
    def w(*a,**k):
        if not cu(): return jsonify(error="x"),401
        return v(*a,**k)
    return w
def admin_required(v):
    @wraps(v)
    def w(*a,**k):
        u=cu()
        if not u or not u.is_admin: return jsonify(error="x"),403
        return v(*a,**k)
    return w
def gsave(u):
    s=GameSave.query.filter_by(user_id=u.id).first()
    if not s: s=GameSave(user_id=u.id); db.session.add(s); db.session.commit()
    return s
@app.route("/api/exchange/send",methods=["POST"])
def ex(): return jsonify(ok=1)
@app.route("/api/game/x",methods=["POST"])
def gx(): return jsonify(ok=1)
ms={"tax_rate":0.04}
with app.app_context():
    db.create_all()
init_world(app, login_required, admin_required, cu, gsave, ms, price_index=cpi)
init_economy(app, login_required, cu, gsave)
with app.app_context():
    for i,n in enumerate(["alex","bob","cat","dan"]):
        u=User(username=n); 
        try: u.set_password("pw12345678")
        except Exception: pass
        db.session.add(u)
    db.session.commit()
    for u in User.query.all():
        s=gsave(u); s.active=True; s.balance=100000.0 if u.username=="alex" else 1000.0
    User.query.filter_by(username="alex").first().is_admin=True
    db.session.commit()
    ids={u.username:u.id for u in User.query.all()}
def client(n):
    c=app.test_client()
    with c.session_transaction() as s: s["user_id"]=ids[n]
    return c
a,b,c_,d=client("alex"),client("bob"),client("cat"),client("dan")
print("state", a.get("/api/world/state").json["regime"])
# votes -> communism (quorum 3)
for c in (a,b,c_): r=c.post("/api/world/vote",json={"regime":"communism"}).json
print("after votes:", r["regime"], "tax", ms["tax_rate"])
print("trade blocked:", a.post("/api/exchange/send",json={}).status_code)
# redistribution happens on state call
st=a.get("/api/world/state").json
with app.app_context():
    print("balances", {s.user.username if hasattr(s,'user') else s.user_id: round(s.balance) for s in GameSave.query.all()})
# crime + jail
random.seed(1)
jailed=False
for i in range(30):
    import world
    with app.app_context():
        world.CriminalRecord.query.update({world.CriminalRecord.last_crime_at:None}); db.session.commit()
    r=b.post("/api/world/crime",json={"crime":"bank_hack"}).json
    if r.get("outcome")=="jailed": jailed=True; print("crime:", r["msg"]); break
print("game action while jailed:", b.post("/api/game/x",json={}).status_code)
print("bail:", b.post("/api/world/bail").json)
# blabber
print(a.post("/api/blabber/post",json={"body":"hello","anonymous":True}).json["success"])
feed=b.get("/api/blabber/feed").json; print("feed handle:", feed["posts"][0]["handle"], "mine?", feed["posts"][0]["mine"])
pid=feed["posts"][0]["id"]
for c in (b,c_,d): r=c.post("/api/blabber/report",json={"post_id":pid,"reason":"nsfw"}).json
print("hidden after 3 reports:", len(b.get("/api/blabber/feed").json["posts"])==0)
print("reveal:", a.get(f"/api/admin/blabber/{pid}/reveal").json, "non-admin:", b.get(f"/api/admin/blabber/{pid}/reveal").status_code)
# notes
print("notes locked:", b.get("/api/notes/list").status_code)
with app.app_context(): GameSave.query.filter_by(user_id=ids["bob"]).update({GameSave.balance:5000}); db.session.commit()
print("buy:", b.post("/api/notes/buy").json["success"], "again:", b.post("/api/notes/buy").json["success"])
n=b.post("/api/notes/save",json={"title":"t","body":"x=2","tags":"math"}).json["note"]["id"]
code=b.post("/api/share/create",json={"kind":"note","note_id":n}).json["code"]
print("share open:", c_.post("/api/share/open",json={"code":code}).json["from_user"])
s=b.get("/api/stats/me").json
print("stats verify ok:", b.post("/api/stats/verify",json={"payload":s["payload"],"sig":s["sig"]}).json["valid"],
      "tampered:", b.post("/api/stats/verify",json={"payload":s["payload"].replace("1000","9999999"),"sig":s["sig"]}).json["valid"])
print("cheatcheck:", a.get("/api/admin/cheatcheck").json["players"][0])

# ---------------- economy ----------------
e = client("cat")
with app.app_context(): GameSave.query.filter_by(user_id=ids["cat"]).update({GameSave.balance: 50000}); db.session.commit()
st = e.get("/api/econ/state").json; print("stocks:", [x["symbol"] for x in st["stocks"]])
b1 = e.post("/api/econ/buy", json={"symbol": "QUIK", "shares": 100}).json; print("buy QUIK:", b1["msg"])
print("overdraw KRON (no KRN):", e.post("/api/econ/buy", json={"symbol": "KRON", "shares": 5}).json["msg"])
print("convert:", e.post("/api/econ/convert", json={"from": "ASD", "to": "KRN", "amount": 1000}).json["msg"])
with app.app_context():  # fast-forward dividends: pretend the last claim was 3 intervals ago
    Holding.query.update({Holding.last_div_idx: Holding.last_div_idx - 3}); db.session.commit()
print("claim:", e.post("/api/econ/claim", json={}).json["msg"], "| again:", e.post("/api/econ/claim", json={}).json["msg"])
s1 = e.post("/api/econ/sell", json={"symbol": "QUIK", "shares": 100}).json; print("sell:", s1["msg"])
with app.app_context():
    print("pool restored:", db.session.get(StockState, "QUIK").available == 2000)
print("jailed players can't trade:", end=" ")
with app.app_context():
    import world as w; w.CriminalRecord.query.filter_by(user_id=ids["cat"]).update({w.CriminalRecord.jail_until: w._now() + w.timedelta(minutes=5)}) if w.CriminalRecord.query.filter_by(user_id=ids["cat"]).first() else db.session.add(w.CriminalRecord(user_id=ids["cat"], jail_until=w._now() + w.timedelta(minutes=5))); db.session.commit()
print(e.post("/api/econ/buy", json={"symbol": "QUIK", "shares": 1}).status_code)
