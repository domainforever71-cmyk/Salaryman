"""Account-backed city travel and daily-needs routes."""

import json
import random
import time

from flask import Blueprint, jsonify, request

from models import db


CITY = {
    "apartmentsA": {"name": "Neon Heights", "x": 1, "y": 1, "kind": "home"},
    "supermarket": {"name": "FreshMart Supermarket", "x": 3, "y": 2, "kind": "food"},
    "restaurant": {"name": "Pixel Plate Diner", "x": 5, "y": 1, "kind": "food"},
    "workdistrict": {"name": "Brokerage Row", "x": 10, "y": 1, "kind": "work"},
    "carshop": {"name": "Metro Motors", "x": 8, "y": 2, "kind": "cars"},
    "hospital": {"name": "City Clinic", "x": 1, "y": 3, "kind": "service"},
    "downtown": {"name": "Old Town Center", "x": 6, "y": 4, "kind": "district"},
    "gasstation": {"name": "Highway Fuel", "x": 10, "y": 4, "kind": "fuel"},
    "apartmentsC": {"name": "Harbor Court", "x": 3, "y": 5, "kind": "home"},
    "parking": {"name": "Central Parking", "x": 5, "y": 6, "kind": "service"},
    "apartmentsB": {"name": "Greenline Flats", "x": 8, "y": 6, "kind": "home"},
    "taxi_stand": {"name": "Southside Taxi Stand", "x": 1, "y": 6, "kind": "taxi"},
    "suburban_house": {"name": "Maplewood House", "x": 10, "y": 6, "kind": "home"},
    "highway": {"name": "East Loop Highway", "x": 6, "y": 0, "kind": "highway"},
}

FOOD = {
    "bread": {"name": "Bread", "price": 4, "hunger": 18},
    "milk": {"name": "Milk", "price": 3, "hunger": 14},
    "fruit": {"name": "Fresh fruit", "price": 6, "hunger": 22},
    "meal": {"name": "Ready meal", "price": 11, "hunger": 38},
    "noodles": {"name": "Instant noodles", "price": 5, "hunger": 24},
}

CARS = {
    "hatchback": {"name": "Rusty Hatchback", "price": 1800, "speed": 0.82, "acceleration": 0.68, "handling": 0.76, "efficiency": 1.2, "class": "Used", "paint": "#c87943"},
    "sedan": {"name": "City Sedan", "price": 6200, "speed": 1.0, "acceleration": 0.82, "handling": 0.9, "efficiency": 1.0, "class": "Standard", "paint": "#3d78c9"},
    "sport": {"name": "Night Coupe", "price": 14500, "speed": 1.18, "acceleration": 1.15, "handling": 1.08, "efficiency": 0.78, "class": "Sport", "paint": "#c2423f"},
    "luxury": {"name": "Grand Avenue", "price": 28500, "speed": 1.08, "acceleration": 0.94, "handling": 1.2, "efficiency": 0.92, "class": "Luxury", "paint": "#222b37"},
    "supercar": {"name": "Comet GT", "price": 58000, "speed": 1.3, "acceleration": 1.28, "handling": 1.14, "efficiency": 0.62, "class": "Performance", "paint": "#a35dd1"},
}

START_STATE = {
    "location": "apartmentsA",
    "inventory": {},
    "owned_cars": [],
    "current_car": None,
    "driving_skill": 0,
    "active_trip": None,
}


def _state(save):
    try:
        value = json.loads(save.city_state_json or "{}")
    except (TypeError, ValueError):
        value = {}
    state = dict(START_STATE)
    if isinstance(value, dict):
        state.update(value)
    state["location"] = state["location"] if state["location"] in CITY else "apartmentsA"
    inventory = state["inventory"] if isinstance(state["inventory"], dict) else {}
    state["inventory"] = {
        item: max(0, min(100, int(count)))
        for item, count in inventory.items()
        if item in FOOD and isinstance(count, int) and not isinstance(count, bool)
    }
    cars = state["owned_cars"] if isinstance(state["owned_cars"], list) else []
    state["owned_cars"] = [
        {"id": car["id"], "fuel": max(0, min(100, float(car.get("fuel", 0))))}
        for car in cars
        if isinstance(car, dict) and car.get("id") in CARS
    ]
    if state.get("current_car") not in {car["id"] for car in state["owned_cars"]}:
        state["current_car"] = None
    try:
        state["driving_skill"] = max(0, min(100, int(state.get("driving_skill", 0) or 0)))
    except (TypeError, ValueError):
        state["driving_skill"] = 0
    return state


def _save_state(save, state):
    save.city_state_json = json.dumps(state, separators=(",", ":"))


def _payload(save, state):
    cars = []
    for owned in state["owned_cars"]:
        spec = CARS.get(owned.get("id"))
        if spec:
            cars.append({**spec, **owned})
    return {
        "success": True,
        "career_active": bool(save.active),
        "balance": round(save.balance or 0, 2),
        "health": max(0, min(100, save.health if save.health is not None else 80)),
        "hunger": max(0, min(100, save.hunger if save.hunger is not None else 100)),
        "location": state["location"],
        "inventory": state["inventory"],
        "cars": cars,
        "current_car": state["current_car"],
        "driving_skill": state["driving_skill"],
        "active_trip": state["active_trip"],
        "locations": CITY,
        "food": FOOD,
        "car_catalog": CARS,
    }


def _quote(state, destination, mode):
    if destination not in CITY or state["location"] not in CITY or destination == state["location"]:
        return None
    start, end = CITY[state["location"]], CITY[destination]
    blocks = abs(start["x"] - end["x"]) + abs(start["y"] - end["y"])
    distance = blocks * 0.3
    rush_hour = time.gmtime().tm_hour in (7, 8, 9, 16, 17, 18)
    traffic = random.uniform(0.9, 1.12) + (0.22 if rush_hour else 0)
    highway = blocks >= 7
    event = random.uniform(1.0, 1.12) if random.random() < 0.24 else 1.0
    state_car = next((car for car in state["owned_cars"] if car.get("id") == state["current_car"]), None)
    spec = CARS.get(state_car["id"]) if state_car else None

    if mode == "walk":
        duration = blocks * 9.5 * random.uniform(0.94, 1.08)
        price = 0
    elif mode == "drive":
        if not state_car or not spec:
            return {"mode": mode, "available": False, "reason": "Visit Metro Motors to buy a car."}
        fuel_needed = blocks * 1.5 * spec["efficiency"]
        if state_car.get("fuel", 0) < fuel_needed:
            return {"mode": mode, "available": False, "reason": "Not enough fuel. Visit Highway Fuel."}
        skill = state["driving_skill"] / 100
        duration = blocks * 7.2 * traffic * event * (0.88 if highway else 1) / spec["speed"]
        duration *= 1 - skill * 0.18
        price = 0
    elif mode == "taxi":
        duration = 3 + blocks * 7.7 * traffic * event * (0.9 if highway else 1)
        price = round(4 + distance * (3.8 + (0.8 if rush_hour else 0)) * traffic, 2)
    else:
        return None

    return {
        "mode": mode,
        "available": True,
        "distance_km": round(distance, 1),
        "blocks": blocks,
        "eta_seconds": round(max(8, min(120, duration)), 1),
        "price": price,
        "traffic": "heavy" if traffic >= 1.28 else "busy" if traffic >= 1.1 else "light",
        "highway": highway,
        "event": event > 1.05,
    }


def init_city(app, login_required, current_user, get_or_create_save):
    bp = Blueprint("city_travel", __name__)

    @bp.get("/maps")
    @login_required
    def maps_page():
        from flask import render_template
        return render_template("city.html")

    @bp.get("/api/game/city/state")
    @login_required
    def city_state():
        save = get_or_create_save(current_user())
        state = _state(save)
        if state["active_trip"] and time.time() >= state["active_trip"].get("arrive_after", 0):
            trip = state["active_trip"]
            if trip.get("mode") == "taxi":
                save.balance = round(max(0, save.balance - trip.get("price", 0)), 2)
            state["location"] = trip["destination"]
            state["active_trip"] = None
            _save_state(save, state)
            db.session.commit()
        return jsonify(_payload(save, state))

    @bp.get("/api/game/city/quotes")
    @login_required
    def city_quotes():
        save = get_or_create_save(current_user())
        state = _state(save)
        destination = request.args.get("destination", "")
        if not save.active:
            return jsonify(success=False, msg="Start a career before taking a trip."), 400
        if state["active_trip"]:
            return jsonify(success=False, msg="Finish your current trip first."), 409
        if destination not in CITY or destination == state["location"]:
            return jsonify(success=False, msg="Choose a different destination."), 400
        quotes = {mode: _quote(state, destination, mode) for mode in ("walk", "drive", "taxi")}
        return jsonify(success=True, destination=destination, name=CITY[destination]["name"], quotes=quotes)

    @bp.post("/api/game/city/action")
    @login_required
    def city_action():
        data = request.get_json(silent=True) or {}
        action = data.get("action")
        save = get_or_create_save(current_user())
        state = _state(save)
        if not save.active:
            return jsonify(success=False, msg="Start a career before using Maps."), 400

        if action == "buy_food":
            item_id = data.get("item")
            try:
                quantity = int(data.get("quantity", 1))
            except (TypeError, ValueError):
                quantity = 0
            item = FOOD.get(item_id)
            if state["location"] != "supermarket":
                return jsonify(success=False, msg="Travel to FreshMart before shopping."), 400
            if not item or quantity < 1 or quantity > 10:
                return jsonify(success=False, msg="Choose a valid food item and quantity."), 400
            total = item["price"] * quantity
            if save.balance < total:
                return jsonify(success=False, msg=f"You need ${total - save.balance:.2f} more."), 400
            save.balance = round(save.balance - total, 2)
            state["inventory"][item_id] = int(state["inventory"].get(item_id, 0)) + quantity
        elif action == "eat":
            item_id = data.get("item")
            if not FOOD.get(item_id) or state["inventory"].get(item_id, 0) < 1:
                return jsonify(success=False, msg="You don't have that food in your bag."), 400
            if save.hunger >= 100:
                return jsonify(success=False, msg="You're already full."), 400
            state["inventory"][item_id] -= 1
            save.hunger = min(100, (save.hunger or 0) + FOOD[item_id]["hunger"])
            save.health = min(100, (save.health or 0) + 1)
        elif action == "buy_meal":
            if state["location"] != "restaurant":
                return jsonify(success=False, msg="Visit Pixel Plate Diner to order a meal."), 400
            if save.balance < 16:
                return jsonify(success=False, msg="A diner meal costs $16."), 400
            save.balance = round(save.balance - 16, 2)
            save.hunger = min(100, (save.hunger or 0) + 42)
            save.health = min(100, (save.health or 0) + 2)
        elif action == "clinic":
            if state["location"] != "hospital":
                return jsonify(success=False, msg="Travel to City Clinic for care."), 400
            if (save.health or 0) >= 100:
                return jsonify(success=False, msg="You're already in good health."), 400
            if save.balance < 30:
                return jsonify(success=False, msg="A clinic visit costs $30."), 400
            save.balance = round(save.balance - 30, 2)
            save.health = min(100, (save.health or 0) + 15)
        elif action == "buy_car":
            car_id = data.get("car")
            spec = CARS.get(car_id)
            if state["location"] != "carshop":
                return jsonify(success=False, msg="Visit Metro Motors to buy a car."), 400
            if not spec:
                return jsonify(success=False, msg="Choose a valid vehicle."), 400
            if any(car.get("id") == car_id for car in state["owned_cars"]):
                return jsonify(success=False, msg="You already own this vehicle."), 400
            if save.balance < spec["price"]:
                return jsonify(success=False, msg="You can't afford this car yet."), 400
            save.balance = round(save.balance - spec["price"], 2)
            state["owned_cars"].append({"id": car_id, "fuel": 100})
            state["current_car"] = car_id
        elif action == "select_car":
            car_id = data.get("car")
            if not any(car.get("id") == car_id for car in state["owned_cars"]):
                return jsonify(success=False, msg="You don't own that vehicle."), 400
            state["current_car"] = car_id
        elif action == "refuel":
            if state["location"] != "gasstation":
                return jsonify(success=False, msg="Travel to Highway Fuel to refuel."), 400
            car = next((car for car in state["owned_cars"] if car.get("id") == state["current_car"]), None)
            if not car:
                return jsonify(success=False, msg="You need a car before buying fuel."), 400
            price = 15
            if save.balance < price:
                return jsonify(success=False, msg="You need $15 to refuel."), 400
            save.balance = round(save.balance - price, 2)
            car["fuel"] = min(100, car.get("fuel", 0) + 35)
        elif action == "travel":
            destination, mode = data.get("destination"), data.get("mode")
            if state["active_trip"]:
                return jsonify(success=False, msg="Finish your current trip first."), 409
            quote = _quote(state, destination, mode)
            if not quote or not quote["available"]:
                return jsonify(success=False, msg=(quote or {}).get("reason", "Choose a valid destination and travel mode.")), 400
            if save.balance < quote["price"]:
                return jsonify(success=False, msg="You don't have enough money for that fare."), 400
            if mode != "taxi":
                save.balance = round(save.balance - quote["price"], 2)
            if mode == "drive":
                car = next(car for car in state["owned_cars"] if car.get("id") == state["current_car"])
                spec = CARS[car["id"]]
                car["fuel"] = max(0, car.get("fuel", 0) - quote["blocks"] * 1.5 * spec["efficiency"])
            now = time.time()
            quote["destination"] = destination
            quote["destination_name"] = CITY[destination]["name"]
            quote["started_at"] = now
            quote["arrive_after"] = now + quote["eta_seconds"] * (0.58 if mode == "drive" else 0.9)
            state["active_trip"] = quote
        elif action == "arrive":
            trip = state["active_trip"]
            if not trip:
                return jsonify(success=False, msg="There isn't an active trip."), 400
            if time.time() < trip.get("arrive_after", 0):
                return jsonify(success=False, msg="The trip is still in progress."), 409
            if trip["mode"] == "taxi":
                save.balance = round(max(0, save.balance - trip["price"]), 2)
            score = data.get("drive_score", 0.6)
            try:
                score = max(0, min(1, float(score)))
            except (TypeError, ValueError):
                score = 0.6
            event = None
            if trip["mode"] == "drive":
                state["driving_skill"] = min(100, state["driving_skill"] + (2 if score < 0.45 else 4))
                car = next((owned for owned in state["owned_cars"] if owned["id"] == state["current_car"]), None)
                handling = CARS[car["id"]]["handling"] if car else 0.7
                base_risk = 0.24 if score < 0.3 else 0.08 if score < 0.5 else 0.015
                risk = max(0.005, base_risk + (1 - handling) * 0.08 - state["driving_skill"] * 0.001)
                if random.random() < risk:
                    save.health = max(0, (save.health or 0) - 3)
                    event = "A minor fender-bender cost 3 health. Ease off before turns next time."
            state["location"] = trip["destination"]
            state["active_trip"] = None
            _save_state(save, state)
            db.session.commit()
            payload = _payload(save, state)
            payload["message"] = event or f"Arrived at {CITY[state['location']]['name']}."
            return jsonify(payload)
        else:
            return jsonify(success=False, msg="Unknown Maps action."), 400

        _save_state(save, state)
        db.session.commit()
        return jsonify(_payload(save, state))

    app.register_blueprint(bp)
