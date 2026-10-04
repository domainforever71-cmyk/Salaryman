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
        state = json.loads(save.city_state_json)
        state.update(location="supermarket", active_trip=None)
        save.hunger = 50
        save.health = 70
        save.city_state_json = json.dumps(state)
        db.session.commit()

    bought = client.post("/api/game/city/action", json={"action": "buy_food", "item": "bread"}).get_json()
    assert bought["inventory"]["bread"] == 1
    assert bought["balance"] == 1996
    eaten = client.post("/api/game/city/action", json={"action": "eat", "item": "bread"}).get_json()
    assert eaten["hunger"] == 68 and eaten["health"] == 71

    with app.app_context():
        save = get_save(user)
        save.balance = 300000
        db.session.commit()
    company = client.post(
        "/api/game/start_business",
        json={"name": "Night Shift Motors", "type": "Car Dealership"},
    ).get_json()
    assert company["success"]
    assert company["land_cost"] == 10000 and company["startup_cost"] == 250000
    assert company["balance"] == 40000
    assert company["build_days"] in (1, 2)

    with app.app_context():
        other_owner = User(username="OtherOperator", password_hash="test-hash")
        db.session.add(other_owner)
        db.session.flush()
        db.session.add(GameSave(
            user_id=other_owner.id, active=True, name="OtherOperator", balance=0,
            job_status="business_owner", company_name="Harbor Repair",
            business_started_day=1, day=1,
            city_state_json=json.dumps({
                "location": "apartmentsA",
                "business": {"type": "Repair Shop", "ready_day": 1},
            }),
        ))
        db.session.commit()

    city_state = client.get("/api/game/city/state").get_json()
    business = next(place for place in city_state["businesses"] if place["name"] == "Night Shift Motors")
    assert business["name"] == "Night Shift Motors"
    assert business["type"] == "Car Dealership"
    assert business["status"] == "building"
    assert business["x"] >= 12
    other_business = next(place for place in city_state["businesses"] if place["name"] == "Harbor Repair")
    assert other_business["owner"] == "OtherOperator"
    assert other_business["status"] == "open"
    assert (other_business["x"], other_business["y"]) != (business["x"], business["y"])
    business_quotes = client.get(
        f"/api/game/city/quotes?destination={business['id']}"
    ).get_json()["quotes"]
    assert business_quotes["walk"]["available"]
    assert business_quotes["drive"]["available"] is False

    business_trip = client.post(
        "/api/game/city/action",
        json={"action": "travel", "destination": business["id"], "mode": "walk"},
    ).get_json()
    assert business_trip["active_trip"]["destination"] == business["id"]
    with app.app_context():
        save = get_save(user)
        save.day = company["ready_day"]
        state = json.loads(save.city_state_json)
        state["active_trip"]["min_arrive_after"] = time.time() - 1
        save.city_state_json = json.dumps(state)
        db.session.commit()
    arrived_at_business = client.post(
        "/api/game/city/action",
        json={"action": "arrive"},
    ).get_json()
    assert arrived_at_business["location"] == business["id"]
    assert arrived_at_business["businesses"][0]["status"] == "open"

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
    assert bought_car["cars"][0]["paint"].startswith("#")
    assert bought_car["cars"][0]["driver_name"] == "CityTester"

    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state.update(location="apartmentsA", active_trip=None)
        state["owned_cars"][0]["fuel"] = 4
        save.city_state_json = json.dumps(state)
        db.session.commit()

    low_fuel = client.get("/api/game/city/quotes?destination=suburban_house").get_json()["quotes"]["drive"]
    assert not low_fuel["available"]
    assert low_fuel["fuel_needed"] > low_fuel["current_fuel"]
    assert low_fuel["delivery_percent"] > 0
    delivered = client.post(
        "/api/game/city/action",
        json={"action": "order_fuel", "amount": low_fuel["delivery_percent"]},
    ).get_json()
    assert delivered["cars"][0]["fuel"] >= low_fuel["fuel_needed"]

    long_trip = client.get("/api/game/city/quotes?destination=suburban_house").get_json()["quotes"]
    assert long_trip["walk"]["eta_seconds"] > 60
    assert long_trip["walk"]["eta_seconds"] <= 120
    assert long_trip["drive"]["available"]
    started = client.post(
        "/api/game/city/action",
        json={"action": "travel", "destination": "suburban_house", "mode": "drive"},
    ).get_json()
    assert started["active_trip"]["mode"] == "drive"
    assert started["active_trip"]["driver_name"] == "CityTester"
    assert started["cars"][0]["fuel"] < 100
    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state["active_trip"]["arrive_after"] = time.time() - 1
        save.city_state_json = json.dumps(state)
        db.session.commit()
    driving_state = client.get("/api/game/city/state").get_json()
    assert driving_state["location"] == "apartmentsA"
    assert driving_state["active_trip"]["mode"] == "drive"

    early_arrival = client.post(
        "/api/game/city/action",
        json={"action": "arrive", "drive_score": 1},
    )
    assert early_arrival.status_code == 409
    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state["active_trip"]["min_arrive_after"] = time.time() - 1
        save.city_state_json = json.dumps(state)
        db.session.commit()
    arrived_by_car = client.post(
        "/api/game/city/action",
        json={"action": "arrive", "drive_score": 1},
    ).get_json()
    assert arrived_by_car["location"] == "suburban_house"
    assert arrived_by_car["active_trip"] is None

    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state.update(location="apartmentsA", active_trip=None)
        save.city_state_json = json.dumps(state)
        db.session.commit()
    balance_before_taxi = client.get("/api/game/city/state").get_json()["balance"]
    taxi = client.post(
        "/api/game/city/action",
        json={"action": "travel", "destination": "supermarket", "mode": "taxi"},
    ).get_json()
    assert taxi["balance"] == balance_before_taxi
    fare = taxi["active_trip"]["price"]
    with app.app_context():
        save = get_save(user)
        state = json.loads(save.city_state_json)
        state["active_trip"]["arrive_after"] = time.time() - 1
        save.city_state_json = json.dumps(state)
        db.session.commit()
    arrived = client.get("/api/game/city/state").get_json()
    assert arrived["location"] == "supermarket"
    assert arrived["balance"] == round(balance_before_taxi - fare, 2)


if __name__ == "__main__":
    test_maps_city_uses_career_wallet_needs_and_vehicle_state()
    print("Maps city travel and daily-needs checks passed.")
