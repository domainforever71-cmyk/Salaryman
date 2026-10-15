"""Career clock, weekly compensation, and player-company target regressions."""
import os
import sys
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "career.db").replace("\\", "/")
os.environ["SECRET_KEY"] = "career-test-secret"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as A
import learn
from models import GameSave, User, db


def client():
    return A.app.test_client()


def register_and_login(c, username):
    assert c.post("/register", json={"username": username, "password": "secret1"}).get_json()["success"]
    assert c.post("/login", json={"username": username, "password": "secret1"}).get_json()["success"]


owner_client, employee_client, solo_client = client(), client(), client()
register_and_login(owner_client, "Founder")
register_and_login(employee_client, "Employee")
register_and_login(solo_client, "Solo")

for c, name in ((owner_client, "Founder"), (employee_client, "Employee"), (solo_client, "Solo")):
    assert c.post("/api/game/start", json={"name": name}).get_json()["success"]

with A.app.app_context():
    employee_user = User.query.filter_by(username="Employee").first()
    learn_row, learn_state = learn._load(employee_user.id)
    learn_state["certs"]["basics"] = "test"
    learn._save(learn_row, learn_state)
    owner_user = User.query.filter_by(username="Founder").first()
    owner_user_id = owner_user.id
    owner_save = GameSave.query.filter_by(user_id=owner_user.id).first()
    owner_save.job_status = "business_owner"
    owner_save.company_name = "Test Brokerage"
    owner_save.balance = 100000
    db.session.commit()

posted = owner_client.post(
    "/api/game/company/set_listing",
    json={"open": True, "role": "Junior Broker", "salary": 700, "target": 1000},
).get_json()
assert posted["success"] and posted["hiring_target"] == 1000, posted

listing = employee_client.get("/api/game/jobs").get_json()
player_job = next(j for j in listing["jobs"] if j.get("player_company"))
assert player_job["salary"] == 700 and player_job["target"] == 1000, player_job

opening, reply = A.ai.interview_opening, A.ai.interview_reply
A.ai.interview_opening = lambda firm, language: "Why this role?"
A.ai.interview_reply = lambda *args: {"decision": "HIRE", "reply": "Welcome aboard."}
try:
    apply_result = employee_client.post(
        "/api/game/apply_job", json={"firm_id": player_job["id"]}
    ).get_json()
    assert apply_result["success"], apply_result
    hired = employee_client.post(
        "/api/game/interview_answer", json={"message": "I can do the work."}
    ).get_json()
    assert hired["hired"], hired
finally:
    A.ai.interview_opening, A.ai.interview_reply = opening, reply

with A.app.app_context():
    employee_user = User.query.filter_by(username="Employee").first()
    owner_user = db.session.get(User, owner_user_id)
    owner_save = GameSave.query.filter_by(user_id=owner_user_id).first()
    employee_save = GameSave.query.filter_by(user_id=employee_user.id).first()
    assert employee_save.weekly_target == 1000
    before_owner, before_employee = owner_save.balance, employee_save.balance
    events = []
    A._process_player_company_payroll(owner_user, owner_save, events)
    assert round(before_owner - owner_save.balance, 2) == 100
    assert round(employee_save.balance - before_employee, 2) == 100

    employee_save.weekly_commission = 1250
    before_owner, before_employee = owner_save.balance, employee_save.balance
    A._process_player_company_bonus(employee_save, events)
    assert round(before_owner - owner_save.balance, 2) == 250
    assert round(employee_save.balance - before_employee, 2) == 250

    solo_user = User.query.filter_by(username="Solo").first()
    solo_save = GameSave.query.filter_by(user_id=solo_user.id).first()
    solo_save.job_status = "employed"
    solo_save.salary = 700
    solo_save.weekly_target = 100
    solo_save.weekly_commission = 150
    solo_save.weekly_bills = 0
    solo_save.balance = 10000
    solo_save.day = 7
    solo_save.week = 1
    solo_save.last_active_day = 7
    solo_save.health = 100
    before = solo_save.balance
    original_random = A.random.random
    A.random.random = lambda: 1.0
    try:
        day_events = []
        A._run_day_tick(solo_user, solo_save, day_events)
    finally:
        A.random.random = original_random
    assert round(solo_save.balance - before, 2) == 150
    assert any("Above-target bonus paid: +$50.00" in event for event in day_events)

    solo_save.day = 14
    solo_save.weekly_commission = solo_save.weekly_target
    solo_save.last_active_day = 14
    before = solo_save.balance
    A.random.random = lambda: 1.0
    try:
        exact_target_events = []
        A._run_day_tick(solo_user, solo_save, exact_target_events)
    finally:
        A.random.random = original_random
    assert round(solo_save.balance - before, 2) == 100
    assert not any("Above-target bonus paid" in event for event in exact_target_events)

    solo_save.day = 1
    solo_save.week = 1
    solo_save.month = 1
    solo_save.age = 20
    solo_save.world_tick = 1000
    solo_save.weekly_commission = 0
    original_target_day = A._target_day_number
    A._target_day_number = lambda: 1360
    try:
        A._catch_up_day(solo_user, solo_save)
    finally:
        A._target_day_number = original_target_day
    assert solo_save.world_tick == 1360
    assert solo_save.month == 13 and solo_save.age == 21

print("Career clock, salary, bonus, and real-player target checks passed.")
