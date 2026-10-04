"""Career-backed Maps travel, car ownership, and food regressions."""
import json
import os
import tempfile
import time
import atexit

from flask import Flask

from city_travel import init_city
from models import GameSave, User, db


def test_maps_city_uses_career_wallet_needs_and_vehicle_state():
    temp_dir = tempfile.TemporaryDirectory()
    atexit.register(temp_dir.cleanup)
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.update(
        SECRET_KEY="city-test-secret",
        SQLALCHEMY_DATABASE_URI="sqlite:///" + os.path.join(temp_dir.name, "city.db").replace("\\", "/"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )
    db.init_app(app)
    with app.app_context():
        db.create_all()
        user = User(username="CityTester", password_hash="test-hash")
        db.session.add(user)
        db.session.flush()
        save = GameSave(user_id=user.id, active=True, name="CityTester", balance=2000, health=80, hunger=100)
        db.session.add(save)
        db.session.commit()
        user_id = user.id

    def current_user():
        return user

    def get_save(_user):
        return GameSave.query.filter_by(user_id=user_id).first()

    init_city(app, lambda handler: handler, current_user, get_save)
    client = app.test_client()
    assert client.get("/maps").status_code == 200

    state = client.get("/api/game/city/state").get_json()
    assert state["career_active"] and state["hunger"] == 100
    assert state["balance"] == 2000
    quotes = client.get("/api/game/city/quotes?destination=supermarket").get_json()
    assert quotes["quotes"]["walk"]["available"]
    assert 15 <= quotes["quotes"]["walk"]["eta_seconds"] <= 60
    assert not quotes["quotes"]["drive"]["available"]
    assert quotes["quotes"]["taxi"]["price"] > 0

    with app.app_context():
        save = get_save(user)
        save.city_state_json = json.dumps({
            "location": "supermarket", "inventory": {}, "owned_cars": [],
            "current_car": None, "driving_skill": 0, "active_trip": None,
        })
        save.hunger = 50
        save.health = 70
        db.session.commit()

    bought = client.post("/api/game/city/action", json={"action": "buy_food", "item": "bread"}).get_json()
    assert bought["inventory"]["bread"] == 1
    assert bought["balance"] == 1996
    eaten = client.post("/api/game/city/action", json={"action": "eat", "item": "bread"}).get_json()
    assert eaten["hunger"] == 68 and eaten["health"] == 71

    with app.app_context():
        save = get_save(user)
        save.city_state_json = json.dumps({
            "location": "carshop", "inventory": {}, "owned_cars": [],
            "current_car": None, "driving_skill": 0, "active_trip": None,
        })
        save.balance = 8000
        db.session.commit()

    bought_car = client.post("/api/game/city/action", json={"action": "buy_car", "car": "sedan"}).get_json()
    assert bought_car["current_car"] == "sedan"
    assert bought_car["balance"] == 1800
    assert bought_car["cars"][0]["fuel"] == 100

    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state.update(location="apartmentsA", active_trip=None)
        save.city_state_json = json.dumps(state)
        db.session.commit()

    long_trip = client.get("/api/game/city/quotes?destination=suburban_house").get_json()["quotes"]
    assert long_trip["walk"]["eta_seconds"] > 60
    assert long_trip["walk"]["eta_seconds"] <= 120
    assert long_trip["drive"]["available"]
    started = client.post(
        "/api/game/city/action",
        json={"action": "travel", "destination": "suburban_house", "mode": "drive"},
    ).get_json()
    assert started["active_trip"]["mode"] == "drive"
    assert started["cars"][0]["fuel"] < 100

    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state.update(location="apartmentsA", active_trip=None)
        save.city_state_json = json.dumps(state)
        db.session.commit()
    taxi = client.post(
        "/api/game/city/action",
        json={"action": "travel", "destination": "supermarket", "mode": "taxi"},
    ).get_json()
    assert taxi["balance"] == 1800
    fare = taxi["active_trip"]["price"]
    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state["active_trip"]["arrive_after"] = time.time() - 1
        save.city_state_json = json.dumps(state)
        db.session.commit()
    arrived = client.get("/api/game/city/state").get_json()
    assert arrived["location"] == "supermarket"
    assert arrived["balance"] == round(1800 - fare, 2)


if __name__ == "__main__":
    test_maps_city_uses_career_wallet_needs_and_vehicle_state()
    print("Maps city travel and daily-needs checks passed.")
