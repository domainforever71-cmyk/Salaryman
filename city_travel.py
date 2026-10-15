"""Account-backed city travel and daily-needs routes."""

import json
import hashlib
import math
import random
import re
import time

from flask import Blueprint, jsonify, request

from models import GameSave, User, db


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
CAR_PAINTS = ["#e0b341", "#3d78c9", "#d9d9d9", "#c2423f", "#8a5bd6", "#00ffcc", "#ff3366"]
FUEL_DELIVERY_FEE = 12
FUEL_PRICE_PER_PERCENT = 0.7
BUSINESS_LAND_COST = 10000.0
BUSINESS_STARTUP_COST = 250000.0
CRASH_INJURIES = (
    (40, "minor", 3, 50),
    (70, "moderate", 8, 175),
    (float("inf"), "severe", 18, 450),
)

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_BAG_PER_ITEM = 100
QUOTE_BUCKET_SECONDS = 300      # a quote you were shown is honoured for the whole bucket
TRIP_GRACE_SECONDS = 90         # a walk/drive abandoned this long after its ETA is finished for you

START_STATE = {
    "location": "apartmentsA",
    "inventory": {},
    "owned_cars": [],
    "current_car": None,
    "driving_skill": 0,
    "active_trip": None,
}


def _state(save, extra_locations=()):
    try:
        value = json.loads(save.city_state_json or "{}")
    except (TypeError, ValueError):
        value = {}
    state = dict(START_STATE)
    if isinstance(value, dict):
        state.update(value)
    valid_locations = set(CITY) | set(extra_locations)
    state["location"] = state["location"] if state["location"] in valid_locations else "apartmentsA"
    inventory = state["inventory"] if isinstance(state["inventory"], dict) else {}
    state["inventory"] = {
        item: max(0, min(100, int(count)))
        for item, count in inventory.items()
        if item in FOOD and isinstance(count, int) and not isinstance(count, bool)
    }
    cars = state["owned_cars"] if isinstance(state["owned_cars"], list) else []
    clean_cars, seen_ids = [], set()
    for car in cars:
        if not isinstance(car, dict) or car.get("id") not in CARS or car["id"] in seen_ids:
            continue
        seen_ids.add(car["id"])
        try:
            fuel = float(car.get("fuel", 0))
        except (TypeError, ValueError):
            fuel = 0.0
        if not math.isfinite(fuel):
            fuel = 0.0
        entry = {"id": car["id"], "fuel": round(max(0.0, min(100.0, fuel)), 2)}
        # These two used to be thrown away on every load, so the colour picked at purchase reverted.
        if isinstance(car.get("paint"), str) and HEX_COLOR.match(car["paint"]):
            entry["paint"] = car["paint"]
        if isinstance(car.get("driver_name"), str):
            entry["driver_name"] = car["driver_name"][:40]
        clean_cars.append(entry)
    state["owned_cars"] = clean_cars
    if state.get("current_car") not in {car["id"] for car in state["owned_cars"]}:
        state["current_car"] = None
    try:
        state["driving_skill"] = max(0, min(100, int(state.get("driving_skill", 0) or 0)))
    except (TypeError, ValueError):
        state["driving_skill"] = 0
    trip = state.get("active_trip")
    if not (isinstance(trip, dict) and trip.get("mode") in ("walk", "drive", "taxi")
            and isinstance(trip.get("destination"), str)):
        trip = None
    state["active_trip"] = trip
    return state


def _save_state(save, state):
    save.city_state_json = json.dumps(state, separators=(",", ":"))


def _crash_injury(speed):
    for limit, severity, health_loss, medical_bill in CRASH_INJURIES:
        if speed < limit:
            return {
                "severity": severity,
                "health_loss": health_loss,
                "medical_bill": medical_bill,
            }
    raise ValueError("Crash speed is outside the supported range.")


def _business_id(save):
    digest = hashlib.sha256(f"city-business:{save.user_id}".encode("utf-8")).hexdigest()[:12]
    return f"business_{digest}"


def _business_info(save):
    try:
        state = json.loads(save.city_state_json or "{}")
    except (TypeError, ValueError):
        state = {}
    business = state.get("business") if isinstance(state, dict) else None
    if not isinstance(business, dict):
        business = {}
    try:
        ready_day = max(1, int(business.get("ready_day", save.business_started_day or save.day or 1)))
    except (TypeError, ValueError):
        ready_day = max(1, int(save.business_started_day or save.day or 1))
    kind = str(business.get("type") or "General Business").strip()[:40] or "General Business"
    return {
        "id": _business_id(save),
        "type": kind,
        "ready_day": ready_day,
        "status": "open" if (save.day or 1) >= ready_day else "building",
    }


def business_profile(save):
    if not save or save.job_status != "business_owner":
        return None
    info = _business_info(save)
    current_day = max(1, int(save.day or 1))
    return {
        "type": info["type"],
        "ready_day": info["ready_day"],
        "status": "open" if current_day >= info["ready_day"] else "building",
        "days_left": max(0, info["ready_day"] - current_day),
    }


_BIZ_CACHE = {"t": 0.0, "v": None}
_BIZ_TTL = 4.0


def _invalidate_businesses():
    _BIZ_CACHE["v"] = None


def _public_businesses():
    """Cached for a few seconds: every open Maps tab polls this, and it is a full table join."""
    now = time.time()
    if _BIZ_CACHE["v"] is not None and now - _BIZ_CACHE["t"] < _BIZ_TTL:
        return _BIZ_CACHE["v"]
    value = _public_businesses_uncached()
    _BIZ_CACHE["v"], _BIZ_CACHE["t"] = value, now
    return value


def _public_businesses_uncached():
    rows = (db.session.query(GameSave, User.username)
            .outerjoin(User, User.id == GameSave.user_id)
            .filter(GameSave.job_status == "business_owner")
            .order_by(GameSave.user_id.asc()).all())
    businesses = []
    for index, (save, owner_name) in enumerate(rows):
        info = _business_info(save)
        x = 12 + (index % 20)
        y = 1 + (index // 20) * 2
        businesses.append({
            **info,
            "id": info["id"],
            "name": (save.company_name or "Unnamed Business")[:64],
            "owner": owner_name or "Operator",
            "x": x,
            "y": y,
            "status": "open" if (save.day or 1) >= info["ready_day"] else "building",
            "ready_day": info["ready_day"],
            "hiring": bool(save.hiring_open),
            "hiring_role": (save.hiring_role or "")[:64] if save.hiring_open else "",
            "hiring_salary": round(save.hiring_salary or 0, 2) if save.hiring_open else 0,
        })
    return businesses


def _locations(businesses):
    locations = dict(CITY)
    for business in businesses:
        locations[business["id"]] = {
            "name": business["name"],
            "x": business["x"],
            "y": business["y"],
            "kind": "business",
        }
    return locations


def _payload(save, state, businesses=None):
    businesses = _public_businesses() if businesses is None else businesses
    locations = _locations(businesses)
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
        "locations": locations,
        "businesses": businesses,
        "business": _business_info(save) if save.job_status == "business_owner" else None,
        "food": FOOD,
        "car_catalog": CARS,
    }


def _quote_rng(user_key, origin, destination, mode, bucket):
    digest = hashlib.sha256(f"{user_key}|{origin}|{destination}|{mode}|{bucket}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def _quote(state, destination, mode, locations=None, user_key="anon"):
    """Price/time for one trip.

    The randomness is seeded from (player, origin, destination, mode, 5-minute bucket), so the fare
    and ETA you are shown are the ones you actually get when you press START. Before, every call
    rolled fresh dice and the taxi price on the button differed from the price charged.
    """
    locations = locations or CITY
    if destination not in locations or state["location"] not in locations or destination == state["location"]:
        return None
    start, end = locations[state["location"]], locations[destination]
    blocks = abs(start["x"] - end["x"]) + abs(start["y"] - end["y"])
    distance = blocks * 0.3
    now = time.time()
    bucket = int(now // QUOTE_BUCKET_SECONDS)
    rng = _quote_rng(user_key, state["location"], destination, mode, bucket)
    rush_hour = time.gmtime(bucket * QUOTE_BUCKET_SECONDS).tm_hour in (7, 8, 9, 16, 17, 18)
    traffic = rng.uniform(0.9, 1.12) + (0.22 if rush_hour else 0)
    highway = blocks >= 7
    event = rng.uniform(1.0, 1.12) if rng.random() < 0.24 else 1.0
    state_car = next((car for car in state["owned_cars"] if car.get("id") == state["current_car"]), None)
    spec = CARS.get(state_car["id"]) if state_car else None

    if mode == "walk":
        duration = blocks * 9.5 * rng.uniform(0.94, 1.08)
        price = 0
    elif mode == "drive":
        if not state_car or not spec:
            return {"mode": mode, "available": False, "reason": "Visit Metro Motors to buy a car."}
        fuel_needed = round(blocks * 1.5 * spec["efficiency"], 2)
        if state_car.get("fuel", 0) < fuel_needed:
            return {
                "mode": mode, "available": False,
                "reason": "Order fuel or visit Highway Fuel.",
                "fuel_needed": round(fuel_needed, 1),
                "current_fuel": round(state_car.get("fuel", 0), 1),
                "delivery_percent": math.floor(min(100 - state_car.get("fuel", 0),
                                                   fuel_needed - state_car.get("fuel", 0) + 5) * 10) / 10,
            }
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
        "fuel_needed": round(blocks * 1.5 * spec["efficiency"], 2) if mode == "drive" and spec else 0,
        "current_fuel": round(state_car.get("fuel", 0), 1) if mode == "drive" and state_car else 0,
    }


def _finish_trip(save, state, locations, trip):
    """Land the player at the trip's destination (used by arrive and by stale-trip recovery)."""
    if trip.get("mode") == "taxi" and not trip.get("paid"):
        # trips started before fares were taken up-front
        save.balance = round(max(0, (save.balance or 0) - trip.get("price", 0)), 2)
    destination = trip.get("destination")
    state["location"] = destination if destination in locations else "apartmentsA"
    state["active_trip"] = None


def _recover_stale_trip(save, state, locations):
    """A trip nobody finished (closed tab, lost connection) must not lock the player out of Maps.

    Taxis land by themselves at their ETA. Walks and drives are given a grace period past their ETA
    because the browser normally reports arrival itself.
    """
    trip = state.get("active_trip")
    if not trip:
        return False
    now = time.time()
    due = trip.get("arrive_after", 0)
    grace = 0 if trip.get("mode") == "taxi" else TRIP_GRACE_SECONDS
    if now >= due + grace:
        _finish_trip(save, state, locations, trip)
        return True
    return False


def init_city(app, login_required, current_user, get_or_create_save,
              award_credits=None, log_event=None):
    bp = Blueprint("city_travel", __name__)

    @bp.get("/maps")
    @login_required
    def maps_page():
        from flask import render_template
        return render_template("city.html")

    @bp.post("/api/game/start_business")
    @login_required
    def start_business():
        data = request.get_json(silent=True)
        data = data if isinstance(data, dict) else {}
        name = data.get("name") if isinstance(data.get("name"), str) else ""
        business_type = data.get("type") if isinstance(data.get("type"), str) else ""
        name, business_type = name.strip()[:64], business_type.strip()[:40]
        if not name:
            return jsonify(success=False, msg="Name your business first."), 400
        if not business_type:
            return jsonify(success=False, msg="Choose what kind of company you want to open."), 400

        user = current_user()
        save = get_or_create_save(user)
        if not save.active:
            return jsonify(success=False, msg="Start a career before founding a business."), 400
        if save.job_status == "business_owner":
            return jsonify(success=False, msg="You already own a business."), 409
        total_cost = BUSINESS_LAND_COST + BUSINESS_STARTUP_COST
        if (save.balance or 0) < total_cost:
            return jsonify(
                success=False,
                msg=f"Insufficient funds - land costs ${BUSINESS_LAND_COST:,.0f} and company startup costs ${BUSINESS_STARTUP_COST:,.0f}.",
            ), 400

        build_days = random.choice((1, 2))
        ready_day = (save.day or 1) + build_days
        try:
            city_state = json.loads(save.city_state_json or "{}")
        except (TypeError, ValueError):
            city_state = {}
        if not isinstance(city_state, dict):
            city_state = {}
        city_state["business"] = {"type": business_type, "ready_day": ready_day, "build_days": build_days}
        save.city_state_json = json.dumps(city_state, separators=(",", ":"))
        save.balance = round((save.balance or 0) - total_cost, 2)
        save.business_capital = BUSINESS_STARTUP_COST
        save.business_started_day = ready_day
        save.job_status = "business_owner"
        save.job_title = f"Founder & CEO, {name}"
        save.company_name = name
        save.salary = 0.0
        save.weekly_target = 0.0
        save.weekly_commission = 0.0
        save.boss_mood = 100
        save.applied_firm = None
        save.employer_user_id = None
        save.hiring_open = False
        save.hiring_role = None
        save.hiring_salary = 0.0
        save.hiring_target = 0.0
        if award_credits:
            award_credits(user, "business", commit=False)
        db.session.commit()
        _invalidate_businesses()
        if log_event:
            log_event(
                f"{user.username} bought land for ${BUSINESS_LAND_COST:,.0f} and founded "
                f"{name} ({business_type}) with ${BUSINESS_STARTUP_COST:,.0f} in startup capital."
            )
        return jsonify(
            success=True, name=name, type=business_type, land_cost=BUSINESS_LAND_COST,
            startup_cost=BUSINESS_STARTUP_COST, build_days=build_days, ready_day=ready_day,
            balance=save.balance,
        )

    @bp.get("/api/game/city/state")
    @login_required
    def city_state():
        save = get_or_create_save(current_user())
        businesses = _public_businesses()
        locations = _locations(businesses)
        state = _state(save, locations)
        if _recover_stale_trip(save, state, locations):
            _save_state(save, state)
            db.session.commit()
        return jsonify(_payload(save, state, businesses))

    @bp.get("/api/game/city/quotes")
    @login_required
    def city_quotes():
        save = get_or_create_save(current_user())
        businesses = _public_businesses()
        locations = _locations(businesses)
        state = _state(save, locations)
        if _recover_stale_trip(save, state, locations):
            _save_state(save, state)
            db.session.commit()
        destination = request.args.get("destination", "")
        if not isinstance(destination, str):
            destination = ""
        if not save.active:
            return jsonify(success=False, msg="Start a career before taking a trip."), 400
        if state["active_trip"]:
            return jsonify(success=False, msg="Finish your current trip first."), 409
        if destination not in locations or destination == state["location"]:
            return jsonify(success=False, msg="Choose a different destination."), 400
        quotes = {mode: _quote(state, destination, mode, locations, user_key=save.user_id)
                  for mode in ("walk", "drive", "taxi")}
        return jsonify(success=True, destination=destination, name=locations[destination]["name"], quotes=quotes)

    @bp.post("/api/game/city/action")
    @login_required
    def city_action():
        data = request.get_json(silent=True)
        data = data if isinstance(data, dict) else {}
        action = data.get("action")
        save = get_or_create_save(current_user())
        businesses = _public_businesses()
        locations = _locations(businesses)
        state = _state(save, locations)
        _recover_stale_trip(save, state, locations)
        if not save.active:
            return jsonify(success=False, msg="Start a career before using Maps."), 400

        # Location-bound actions are only valid when parked. During a trip state["location"] is still the
        # ORIGIN, so without this you could shop, buy cars or refuel "remotely" while travelling.
        if state["active_trip"] and action in ("buy_food", "buy_meal", "clinic", "buy_car", "select_car", "refuel"):
            return jsonify(success=False, msg="Finish your current trip first."), 409

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
            have = int(state["inventory"].get(item_id, 0))
            if have + quantity > MAX_BAG_PER_ITEM:
                return jsonify(success=False, msg=f"Your bag only holds {MAX_BAG_PER_ITEM} of each item."), 400
            total = item["price"] * quantity
            if (save.balance or 0) < total:
                return jsonify(success=False, msg=f"You need ${total - (save.balance or 0):.2f} more."), 400
            save.balance = round((save.balance or 0) - total, 2)
            state["inventory"][item_id] = have + quantity
        elif action == "eat":
            item_id = data.get("item")
            if not FOOD.get(item_id) or state["inventory"].get(item_id, 0) < 1:
                return jsonify(success=False, msg="You don't have that food in your bag."), 400
            if (save.hunger if save.hunger is not None else 100) >= 100:
                return jsonify(success=False, msg="You're already full."), 400
            state["inventory"][item_id] -= 1
            save.hunger = min(100, (save.hunger or 0) + FOOD[item_id]["hunger"])
            save.health = min(100, (save.health or 0) + 1)
        elif action == "buy_meal":
            if state["location"] != "restaurant":
                return jsonify(success=False, msg="Visit Pixel Plate Diner to order a meal."), 400
            if (save.balance or 0) < 16:
                return jsonify(success=False, msg="A diner meal costs $16."), 400
            save.balance = round((save.balance or 0) - 16, 2)
            save.hunger = min(100, (save.hunger or 0) + 42)
            save.health = min(100, (save.health or 0) + 2)
        elif action == "clinic":
            if state["location"] != "hospital":
                return jsonify(success=False, msg="Travel to City Clinic for care."), 400
            if (save.health or 0) >= 100:
                return jsonify(success=False, msg="You're already in good health."), 400
            if (save.balance or 0) < 30:
                return jsonify(success=False, msg="A clinic visit costs $30."), 400
            save.balance = round((save.balance or 0) - 30, 2)
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
            if (save.balance or 0) < spec["price"]:
                return jsonify(success=False, msg="You can't afford this car yet."), 400
            save.balance = round((save.balance or 0) - spec["price"], 2)
            state["owned_cars"].append({
                "id": car_id,
                "fuel": 100,
                "paint": random.choice(CAR_PAINTS),
                "driver_name": save.name,
            })
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
            room = 100 - car.get("fuel", 0)
            if room < 1:
                return jsonify(success=False, msg="Your tank is already full."), 400
            added = min(35.0, room)
            price = round(max(2.0, 15 * added / 35.0), 2)      # $15 buys a full 35%; a top-up costs less
            if (save.balance or 0) < price:
                return jsonify(success=False, msg=f"You need ${price:.2f} to refuel."), 400
            save.balance = round(save.balance - price, 2)
            car["fuel"] = round(min(100, car.get("fuel", 0) + added), 2)
        elif action == "order_fuel":
            if state["active_trip"]:
                return jsonify(success=False, msg="Fuel delivery can only meet you while parked."), 409
            car = next((car for car in state["owned_cars"] if car["id"] == state["current_car"]), None)
            if not car:
                return jsonify(success=False, msg="You need a car before ordering fuel."), 400
            try:
                amount = float(data.get("amount", 35))
            except (TypeError, ValueError):
                return jsonify(success=False, msg="Choose a valid fuel amount."), 400
            if not math.isfinite(amount):
                return jsonify(success=False, msg="Choose a valid fuel amount."), 400
            room = 100 - car.get("fuel", 0)
            # 0.05 of slack: the browser computes `100 - fuel` in floating point and rounds it
            if amount < 1 or amount > room + 0.05:
                return jsonify(success=False, msg="Choose a fuel amount that fits your tank."), 400
            amount = round(min(amount, room), 1)
            cost = round(FUEL_DELIVERY_FEE + amount * FUEL_PRICE_PER_PERCENT, 2)
            if (save.balance or 0) < cost:
                return jsonify(success=False, msg=f"Fuel delivery costs ${cost:.2f}."), 400
            save.balance = round(save.balance - cost, 2)
            car["fuel"] = round(min(100, car.get("fuel", 0) + amount), 2)
        elif action == "travel":
            destination, mode = data.get("destination"), data.get("mode")
            if not isinstance(destination, str) or mode not in ("walk", "drive", "taxi"):
                return jsonify(success=False, msg="Choose a valid destination and travel mode."), 400
            if state["active_trip"]:
                return jsonify(success=False, msg="Finish your current trip first."), 409
            quote = _quote(state, destination, mode, locations, user_key=save.user_id)
            if not quote or not quote["available"]:
                return jsonify(success=False, msg=(quote or {}).get("reason", "Choose a valid destination and travel mode.")), 400
            if (save.balance or 0) < quote["price"]:
                return jsonify(success=False, msg="You don't have enough money for that fare."), 400
            # The fare is taken now. It used to be taken on arrival with max(0, ...), so spending the
            # money elsewhere during the ride made the taxi free, and two overlapping arrival requests
            # could charge it twice.
            save.balance = round((save.balance or 0) - quote["price"], 2)
            quote["paid"] = True
            if mode == "drive":
                car = next(car for car in state["owned_cars"] if car.get("id") == state["current_car"])
                spec = CARS[car["id"]]
                car["fuel"] = round(max(0, car.get("fuel", 0) - quote["blocks"] * 1.5 * spec["efficiency"]), 2)
            now = time.time()
            quote["destination"] = destination
            quote["destination_name"] = locations[destination]["name"]
            quote["started_at"] = now
            quote["driver_name"] = save.name
            # Earliest believable arrival. The fastest car can legitimately beat the ETA by ~40%, so
            # 40% is the floor (it was a flat 3-10 s, which let a script "drive" across the city instantly).
            quote["arrive_after"] = now + quote["eta_seconds"] * 0.9
            # A taxi cannot be skipped: it lands no earlier than its ETA (it used to be "now", so a script
            # could pay the fare and teleport). Walks/drives keep the 40% floor.
            quote["min_arrive_after"] = now + (max(3, quote["eta_seconds"] * 0.4) if mode in ("drive", "walk")
                                              else quote["eta_seconds"] * 0.9)
            state["active_trip"] = quote
        elif action == "crash":
            trip = state["active_trip"]
            if not trip or trip.get("mode") != "drive":
                return jsonify(success=False, msg="There isn't an active driving trip."), 409
            speed = data.get("speed")
            vehicle_id = data.get("vehicle_id")
            if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 20 <= speed <= 120:
                return jsonify(success=False, msg="Crash speed must be between 20 and 120."), 400
            if isinstance(vehicle_id, bool) or not isinstance(vehicle_id, int) or not 0 <= vehicle_id < 54:
                return jsonify(success=False, msg="Crash vehicle is invalid."), 400
            crashed_vehicles = trip.setdefault("crashed_vehicles", [])
            if vehicle_id in crashed_vehicles:
                return jsonify(success=False, msg="This vehicle has already been involved in a crash this trip."), 409
            if len(crashed_vehicles) >= 10:
                return jsonify(success=False, msg="No further crash reports can be recorded this trip."), 409
            injury = _crash_injury(speed)
            save.health = max(0, (save.health or 0) - injury["health_loss"])
            save.balance = round((save.balance or 0) - injury["medical_bill"], 2)
            crashed_vehicles.append(vehicle_id)
            trip["crash_count"] = len(crashed_vehicles)
            trip["medical_bills"] = round(trip.get("medical_bills", 0) + injury["medical_bill"], 2)
            _save_state(save, state)
            db.session.commit()
            payload = _payload(save, state, businesses)
            payload["message"] = (
                f"{injury['severity'].title()} crash at {round(speed)} speed: "
                f"-{injury['health_loss']} HP and a ${injury['medical_bill']} medical bill."
            )
            return jsonify(payload)
        elif action == "arrive":
            trip = state["active_trip"]
            if not trip:
                # Already landed (a taxi lands by itself, or a second tab reported it first).
                payload = _payload(save, state, businesses)
                payload["message"] = f"Arrived at {locations[state['location']]['name']}."
                payload["already_arrived"] = True
                return jsonify(payload)
            if time.time() < trip.get("min_arrive_after", trip.get("arrive_after", 0)):
                return jsonify(success=False, msg="The trip is still in progress."), 409
            score = data.get("drive_score", 0.6)
            try:
                score = float(score)
                score = max(0.0, min(1.0, score)) if math.isfinite(score) else 0.6
            except (TypeError, ValueError):
                score = 0.6
            event = None
            if trip["mode"] == "drive":
                state["driving_skill"] = min(100, state["driving_skill"] + (2 if score < 0.45 else 4))
                crash_count = trip.get("crash_count", 0)
                if crash_count:
                    event = (
                        f"Arrived after {crash_count} crash(es). "
                        f"Medical bills paid: ${trip.get('medical_bills', 0):.2f}."
                    )
            _finish_trip(save, state, locations, trip)
            _save_state(save, state)
            db.session.commit()
            payload = _payload(save, state, businesses)
            payload["message"] = event or f"Arrived at {locations[state['location']]['name']}."
            return jsonify(payload)
        else:
            return jsonify(success=False, msg="Unknown Maps action."), 400

        _save_state(save, state)
        db.session.commit()
        return jsonify(_payload(save, state, businesses))

    app.register_blueprint(bp)
