"""
ASTRA balance simulation harness.

This mirrors the exact formulas in app.py / models.py / game_data.py (day-tick
economy, compute_score, daily_royalty, award_credits) in pure Python, with no
Flask/DB/network dependency, so many simulated careers can run in a few
seconds. It exists to answer questions a single manual playtest can't:
"how many weeks before bills outrun income", "how many trades to hit the top
score title", "does a major-label track ever pay back its upfront cost" -
with numbers instead of guesses.

Every constant below is copied from the live source, with a comment pointing
at where. If a tuning pass changes a constant in the game, change it here
too, or this stops measuring the game that ships.

Usage: python3 sim/balance_sim.py
"""
import random
import statistics as stats
from dataclasses import dataclass, field


CREDIT_RULES = { 
    "day": 2, "deal": 10, "week": 15, "target_hit": 25,
    "track": 20, "business": 50, "interview": 30, "trade_p2p": 5,
}
FRAME_COSTS = {"violet": 150, "double": 300, "dashed": 300, "plasma": 600}  
TITLE_COST = 750           
AVATAR_CREDIT_COST = 400  
BUSINESS_STARTUP_COST = 20000.0

MUSIC_LABELS = {  
    "indie":   {"cut": 0.90, "reach": 1, "cost": 0},
    "midtier": {"cut": 0.60, "reach": 3, "cost": 500},
    "major":   {"cut": 0.35, "reach": 7, "cost": 3000},
}

JOB_LADDER_RAISES = 5

TITLE_THRESHOLDS = [
    (5000, "Terminal Legend"), (2000, "Desk Veteran"),
    (800, "Market Player"), (200, "Floor Regular"), (0, "Rookie Operator"),
]


def operator_title(score):
    for threshold, name in TITLE_THRESHOLDS:
        if score >= threshold:
            return name
    return "Rookie Operator"


def compute_score(balance, deals_closed, trades_count, week, boss_mood,
                   business_owner, times_fired):
    """models.py GameSave.compute_score(), verbatim."""
    tenure_weeks = max(0, week - 1)
    score = (
        (balance or 0) * 0.01
        + deals_closed * 25
        + trades_count * 3
        + tenure_weeks * 20
        + (boss_mood or 0) * 0.5
        + (150 if business_owner else 0)
        - times_fired * 40
    )
    return round(max(0, score), 2)


def daily_royalty(base_daily, age_days):
    """models.py MusicTrack.daily_royalty(), verbatim."""
    decay = max(0.15, 1 - (age_days or 0) * 0.01)
    return round((base_daily or 0.0) * decay, 2)

@dataclass
class Track:
    base_daily: float
    age_days: int = 0
    total_earned: float = 0.0


@dataclass
class Career:
    difficulty: str = "Normal"
    rng: random.Random = field(default_factory=random.Random)

    balance: float = 2000.0
    salary: float = 2500.0
    health: int = 80
    age: int = 20
    day: int = 1
    week: int = 1
    month: int = 1
    weekly_target: float = 800.0
    weekly_bills: float = 450.0
    weekly_commission: float = 0.0
    job_status: str = "employed"     
    company_name: str = "Entry Level Desk"
    boss_mood: int = 100
    acted_today: bool = True
    deals_closed: int = 0
    trades_count: int = 0
    times_fired: int = 0
    credits: int = 0
    employees: int = 0
    tracks: list = field(default_factory=list)
    active: bool = True
    end_reason: str = ""

    bills_cap_mult: float = None
    target_cap_mult: float = None
    starting_bills: float = 450.0
    starting_target: float = 800.0

    def trade_round_trip(self, price=54.10, spread_pct=0.0):
        """One buy + one sell of 1 share at `price`, i.e. exactly what the
        client can currently do for free between market ticks. spread_pct is
        the *proposed* fix - 0.0 reproduces the shipped, frictionless rule."""
        buy_price = price * (1 + spread_pct / 2)
        sell_price = price * (1 - spread_pct / 2)
        self.balance -= buy_price
        self.balance += sell_price
        self.trades_count += 2
        self.acted_today = True

    def close_deal(self, net_worth):
        commission = round(net_worth * 0.005, 2)
        self.balance += commission
        self.weekly_commission += commission
        self.deals_closed += 1
        self.credits += CREDIT_RULES["deal"]
        self.acted_today = True
        return commission

    def release_track(self, label_id, score=100):
        label = MUSIC_LABELS[label_id]
        if self.balance < label["cost"]:
            return False
        base_daily = round((score / 100.0) * 3.2 * label["reach"] * label["cut"], 2)
        self.balance -= label["cost"]
        self.tracks.append(Track(base_daily=base_daily))
        self.credits += CREDIT_RULES["track"]
        self.acted_today = True
        return True

    def found_business(self, headcount=0):
        if self.balance < BUSINESS_STARTUP_COST:
            return False
        self.balance -= BUSINESS_STARTUP_COST
        self.job_status = "business_owner"
        self.salary = 0.0
        self.weekly_target = 0.0
        self.employees = headcount
        self.credits += CREDIT_RULES["business"]
        self.acted_today = True
        return True

    def advance_day(self):
        """app.py game_advance_day(), verbatim in structure and numbers."""
        if self.job_status in ("employed", "business_owner"):
            if self.acted_today:
                self.boss_mood = min(100, self.boss_mood + 5)
            else:
                self.boss_mood = max(0, self.boss_mood - 15)
            if self.boss_mood <= 0 and self.job_status == "employed":
                self.job_status = "unemployed"
                self.company_name = None
                self.salary = 0.0
                self.weekly_target = 0.0
                self.times_fired += 1
                self.boss_mood = 50

        if self.job_status == "business_owner":
            revenue = round(self.rng.uniform(40, 120) +
                             self.employees * self.rng.uniform(60, 140), 2)
            self.balance += revenue
        else:
            self.balance += self.salary / 30

        for t in self.tracks:
            payout = daily_royalty(t.base_daily, t.age_days)
            self.balance += payout
            t.total_earned += payout
            t.age_days += 1

        self.day += 1
        self.credits += CREDIT_RULES["day"]

        if self.day % 7 == 0:
            self.week += 1
            hit_target = self.weekly_commission >= self.weekly_target
            self.credits += CREDIT_RULES["week"]
            if hit_target and self.weekly_target > 0:
                self.credits += CREDIT_RULES["target_hit"]
            self.balance -= self.weekly_bills
            if not hit_target and self.weekly_target > 0:
                self.health = max(0, self.health - 2)
            scale = 1.15 if self.difficulty == "Hard" else 1.12
            bills_scale = 1.10 if self.difficulty == "Hard" else 1.08
            bills_ceiling = (self.starting_bills * self.bills_cap_mult
                              if self.bills_cap_mult else float("inf"))
            target_ceiling = (self.starting_target * self.target_cap_mult
                               if self.target_cap_mult else float("inf"))
            self.weekly_target = round(min(self.weekly_target * scale, target_ceiling), 2)
            self.weekly_bills = round(min(self.weekly_bills * bills_scale, bills_ceiling), 2)
            self.weekly_commission = 0.0
            self.health = max(0, self.health - 1)

        if self.day % 30 == 0:
            self.month += 1
            self.age = 20 + self.month // 12
            if self.balance > 0:
                self.balance -= round(self.balance * 0.04, 2)
            if self.job_status == "employed" and self.company_name == "Entry Level Desk":
                rung = min(JOB_LADDER_RAISES - 1, self.month // 12)
                if rung > 0:
                    self.salary = round(self.salary * 1.15 ** min(rung, 1), 2)

        if self.health <= 0:
            self.active, self.end_reason = False, "health"
        elif self.balance <= -1000:
            self.active, self.end_reason = False, "bankrupt"
        elif self.age >= 80:
            self.active, self.end_reason = False, "retired"

        self.acted_today = False

    def score(self):
        return compute_score(self.balance, self.deals_closed, self.trades_count,
                              self.week, self.boss_mood, self.job_status == "business_owner",
                              self.times_fired)


def run_default_employee(seed, days=1095, difficulty="Normal", deal_prob=0.35,
                          bills_cap_mult=None, target_cap_mult=None):
    """The out-of-the-box path: stay at 'Entry Level Desk', try to close one
    deal most days at `deal_prob` success (an average, not-scripting player),
    never trade or release music. Tracks how long it survives."""
    rng = random.Random(seed)
    c = Career(difficulty=difficulty, rng=rng,
               bills_cap_mult=bills_cap_mult, target_cap_mult=target_cap_mult)
    history = []
    for _ in range(days):
        if not c.active:
            break
        if rng.random() < deal_prob:
            net_worth = rng.randint(50_000, 2_500_000)
            c.close_deal(net_worth)
        c.advance_day()
        history.append((c.day, c.week, c.balance, c.weekly_bills, c.weekly_target, c.score()))
    return c, history


def run_score_farm(seed, trades_per_day=200, days=30, spread_pct=0.0):
    """Quantifies the trades_count exploit: spam free round-trips instead of
    doing anything the game actually asks of a player."""
    rng = random.Random(seed)
    c = Career(rng=rng)
    for _ in range(days):
        if not c.active:
            break
        for _ in range(trades_per_day):
            if c.balance <= -1000:
                break
            c.trade_round_trip(spread_pct=spread_pct)
        c.advance_day()
    return c


def run_musician(seed, label_id, days=730, score=100):
    """One max-quality track released under `label_id` on day 0, nothing else
    happening. Isolates ROI of the label deal itself - assumes the upfront
    cost is already in hand (the main-path sims separately show whether a
    player can actually save up that much before wanting to spend it)."""
    label = MUSIC_LABELS[label_id]
    base_daily = round((score / 100.0) * 3.2 * label["reach"] * label["cut"], 2)
    breakeven_day = None
    cumulative = -label["cost"]
    if cumulative >= 0:
        breakeven_day = 0
    for d in range(days):
        payout = daily_royalty(base_daily, d)
        cumulative += payout
        if breakeven_day is None and cumulative >= 0:
            breakeven_day = d
    return cumulative, breakeven_day


def run_frame_afford(seed, days=730, difficulty="Normal", deal_prob=0.35):
    """Legit-play credit accrual: same as run_default_employee, but tracking
    the day each frame/title/avatar becomes affordable."""
    rng = random.Random(seed)
    c = Career(difficulty=difficulty, rng=rng)
    targets = {**FRAME_COSTS, "custom_title": TITLE_COST, "avatar": AVATAR_CREDIT_COST}
    hit_day = {}
    for _ in range(days):
        if not c.active:
            break
        if rng.random() < deal_prob:
            net_worth = rng.randint(50_000, 2_500_000)
            c.close_deal(net_worth)
        c.advance_day()
        for k, cost in targets.items():
            if k not in hit_day and c.credits >= cost:
                hit_day[k] = c.day
    return hit_day, c.credits



def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * p
    f, c = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def report_default_employee(n=200, days=1095, difficulty="Normal", deal_prob=0.35,
                             bills_cap_mult=None, target_cap_mult=None):
    cap_label = f", bills_cap={bills_cap_mult}x target_cap={target_cap_mult}x" if bills_cap_mult else ""
    print(f"\n=== Default employee path, {difficulty}, deal_prob={deal_prob}, "
          f"n={n} careers x {days} days{cap_label} ===")
    survival_days, end_reasons, scores_at_end, titles_hit = [], {}, [], {200: [], 800: [], 2000: [], 5000: []}
    for seed in range(n):
        c, history = run_default_employee(seed, days=days, difficulty=difficulty, deal_prob=deal_prob,
                                           bills_cap_mult=bills_cap_mult, target_cap_mult=target_cap_mult)
        survival_days.append(c.day)
        end_reasons[c.end_reason or "survived_full_span"] = end_reasons.get(c.end_reason or "survived_full_span", 0) + 1
        scores_at_end.append(c.score())
        for th in titles_hit:
            hit = next((day for day, week, bal, bills, target, score in history if score >= th), None)
            titles_hit[th].append(hit)
    print(f"  survival (days): p10={pct(survival_days,.1):.0f} "
          f"median={pct(survival_days,.5):.0f} p90={pct(survival_days,.9):.0f}")
    print(f"  end reasons: {end_reasons}")
    print(f"  score at end/death: median={pct(scores_at_end,.5):.0f} p90={pct(scores_at_end,.9):.0f}")
    for th, days_list in titles_hit.items():
        reached = [d for d in days_list if d is not None]
        rate = len(reached) / n * 100
        med = pct(reached, .5) if reached else float("nan")
        print(f"  score>={th} ({operator_title(th)}): reached by {rate:.0f}% of careers, "
              f"median day {med:.0f}" if reached else
              f"  score>={th} ({operator_title(th)}): reached by 0% of careers")
    return survival_days, end_reasons


def report_score_farm(spread_pct, label, trades_per_day=200, days=30):
    c = run_score_farm(seed=1, trades_per_day=trades_per_day, days=days, spread_pct=spread_pct)
    print(f"  [{label}] spread={spread_pct*100:.2f}%: survived {c.day} days, "
          f"{c.trades_count} trades, balance=${c.balance:,.2f}, score={c.score():.0f} "
          f"({operator_title(c.score())})")


def report_musician():
    print("\n=== Music label ROI: one max-quality (score=100) track, 2 years, no other income ===")
    for label_id in MUSIC_LABELS:
        cumulative, breakeven = run_musician(seed=1, label_id=label_id)
        cost = MUSIC_LABELS[label_id]["cost"]
        status = f"breaks even on day {breakeven}" if breakeven is not None else "never breaks even in 2 years"
        print(f"  {label_id:8s} cost=${cost:5.0f}  2yr net=${cumulative:8.2f}  {status}")


def report_frame_afford(n=100, days=1095, difficulty="Normal", deal_prob=0.35):
    print(f"\n=== Credit accrual (legit play), {difficulty}, deal_prob={deal_prob}, n={n} ===")
    all_hits = {}
    total_credits = []
    for seed in range(n):
        hit_day, credits = run_frame_afford(seed, days=days, difficulty=difficulty, deal_prob=deal_prob)
        total_credits.append(credits)
        for k, d in hit_day.items():
            all_hits.setdefault(k, []).append(d)
    for k in ["violet", "double", "dashed", "plasma", "avatar", "custom_title"]:
        days_list = all_hits.get(k, [])
        rate = len(days_list) / n * 100
        med = pct(days_list, .5) if days_list else float("nan")
        print(f"  {k:14s} rate={rate:5.0f}%  median day affordable: {med if days_list else 'never'}")


def report_bills_growth():
    """Bills/target compound weekly regardless of income - this shows the
    trajectory on its own, independent of any player strategy, against a
    generous income ceiling (closing a deal on every single day)."""
    print("\n=== Weekly bills compounding in isolation (no player action needed) ===")
    max_deal = 2_500_000 * 0.005  
    avg_deal = 1_275_000 * 0.005 
    ceiling_income_week = 7 * max_deal
    print(f"  Reference: closing the best possible deal every day of the week = "
          f"${ceiling_income_week:,.0f}/week income")
    for difficulty, bills_scale in (("Normal", 1.08), ("Hard", 1.10)):
        bills = 450.0
        weeks_to_ceiling = None
        for week in range(1, 261):
            bills *= bills_scale
            if weeks_to_ceiling is None and bills > ceiling_income_week:
                weeks_to_ceiling = week
        bills_at = {}
        b = 450.0
        for week in range(1, 261):
            b *= bills_scale
            if week in (10, 20, 30, 52, 80, 100, 150):
                bills_at[week] = b
        print(f"  {difficulty} (bills x{bills_scale}/wk): "
              + ", ".join(f"wk{w}=${v:,.0f}" for w, v in bills_at.items()))
        print(f"    -> exceeds best-case-every-day income (${ceiling_income_week:,.0f}/wk) "
              f"at week {weeks_to_ceiling} (~{weeks_to_ceiling/52:.1f} years), "
              f"regardless of player skill")


if __name__ == "__main__":
    print("#" * 70)
    print("ASTRA balance simulation - see sim/README.md for methodology")
    print("#" * 70)

    report_default_employee(n=200, days=1095, difficulty="Normal", deal_prob=0.35)
    report_default_employee(n=200, days=1095, difficulty="Normal", deal_prob=0.15)
    report_default_employee(n=200, days=1095, difficulty="Hard", deal_prob=0.35)
    report_bills_growth()

    print("\n=== Sweeping a bills/target growth cap for sustainability (deal_prob=0.35) ===")
    for bc, tc in [(None, None), (30, 40), (20, 30), (15, 22), (10, 15)]:
        sd, er = report_default_employee(n=150, days=1825, difficulty="Normal",
                                          deal_prob=0.35, bills_cap_mult=bc, target_cap_mult=tc)
        survived_full = er.get("survived_full_span", 0)
        print(f"    -> {survived_full}/150 survived the full 5-year span")
    print("\n  -- same sweep, weak/unlucky player (deal_prob=0.15) --")
    for bc, tc in [(None, None), (20, 30), (15, 22)]:
        sd, er = report_default_employee(n=150, days=1825, difficulty="Normal",
                                          deal_prob=0.15, bills_cap_mult=bc, target_cap_mult=tc)
        survived_full = er.get("survived_full_span", 0)
        print(f"    -> {survived_full}/150 survived the full 5-year span")

    print("\n=== Trades_count exploit: score from spamming free round-trips ===")
    print(" -- current shipped rules (no spread) --")
    report_score_farm(spread_pct=0.0, label="current", trades_per_day=200, days=10)
    report_score_farm(spread_pct=0.0, label="current-30d", trades_per_day=500, days=30)
    print(" -- with a proposed spread --")
    for sp in (0.001, 0.003, 0.006, 0.01):
        report_score_farm(spread_pct=sp, label=f"spread {sp*100:.1f}%", trades_per_day=500, days=60)

    report_musician()
    report_frame_afford(n=150, days=1095, difficulty="Normal", deal_prob=0.35)
