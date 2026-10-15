"""learn_core.py - Stage 24: the knowledge layer (pure logic, no Flask).

Money is not free to touch. You need certificates, and you earn them by
reading the wiki, using the calculator, and passing an exam whose numbers are
different every attempt (seeded per sitting), so you cannot memorise answers -
you have to know the formula and run it.

  basics   Money Basics        (free)    -> required to apply for jobs
  credit   Credit & Debt       prereq basics -> required to take bank loans
  broker   Brokerage 101       prereq basics -> required to trade shares
  risk     Risk & Sizing       prereq broker -> lifts the 10 share/order retail cap
"""
import math
import random
import re

STUDY_SECONDS = 25        # must have had the article open this long before sitting
EXAM_MINUTES = 10         # a sitting expires
QUESTIONS = 5
PASS_MARK = 4
LOCKOUT_MIN = 3           # after a failed sitting
RETAIL_CAP = 10           # shares per order without the risk cert

CERTS = {
    "basics": dict(label="Money Basics", fee=0, prereq=None, article="money-basics",
                   unlocks="Applying for jobs (CAREER)"),
    "credit": dict(label="Credit & Debt", fee=30, prereq="basics", article="credit-debt",
                   unlocks="Bank loans (BANK)"),
    "broker": dict(label="Brokerage 101", fee=50, prereq="basics", article="brokerage-101",
                   unlocks="Buying and selling shares"),
    "risk":   dict(label="Risk & Sizing", fee=75, prereq="broker", article="risk-sizing",
                   unlocks=f"Orders above {RETAIL_CAP} shares"),
}

ARTICLES = {
    "money-basics": dict(
        title="Money Basics: pay, inflation, compounding", cert="basics",
        keywords="salary tax net pay gross inflation real return compound interest budget savings rate cpi",
        body=[
            "GROSS is what the contract says. NET = gross x (1 - tax rate). Plan on net, never gross.",
            "SAVINGS RATE = (income - spending) / income x 100. Below 0 you are burning capital.",
            "COMPOUNDING: FV = P x (1 + r)^n, r per period, n periods. Doubling time is about 72 / r%.",
            "INFLATION erodes cash. REAL RETURN = (1 + nominal) / (1 + inflation) - 1. A 6% return in 5% "
            "inflation is about 0.95% real, not 1%. The in-game CPI is in the WALLET.",
            "Before you apply anywhere: know your net target, your monthly costs, and your runway "
            "(cash / monthly costs = months you survive with no job).",
        ]),
    "credit-debt": dict(
        title="Credit & Debt: APR, payments, ratios", cert="credit",
        keywords="loan apr payment amortisation interest debt income ratio dti credit score principal",
        body=[
            "APR is yearly. Monthly rate r = APR / 12 / 100. Number of payments n = years x 12.",
            "LEVEL PAYMENT: M = P x r / (1 - (1 + r)^-n). Total paid = M x n. TOTAL INTEREST = M x n - P.",
            "DEBT-TO-INCOME = monthly debt payments / monthly gross income x 100. Lenders balk above ~40%.",
            "Missed payments wreck the credit score, and a low score gates you out of firms and lenders.",
            "Cheap-looking loans can be expensive: a low payment stretched over more years costs more interest.",
        ]),
    "brokerage-101": dict(
        title="Brokerage 101: cost basis, fees, break-even", cert="broker",
        keywords="stock shares trade buy sell fee commission cost basis average profit loss break even order",
        body=[
            "PROFIT = qty x (sell - buy) - fees. Fees are charged on BOTH legs.",
            "AVERAGE COST after adding: (q1 x p1 + q2 x p2) / (q1 + q2).",
            "BREAK-EVEN with a fee rate f on each leg: sell price = buy x (1 + f) / (1 - f).",
            "POSITION WEIGHT = position value / total portfolio value x 100.",
            "Regimes change the trade fee (see CIVICS). Read the fee before you press BUY.",
            "Retail accounts are capped at " + str(RETAIL_CAP) + " shares per order until you pass Risk & Sizing.",
        ]),
    "risk-sizing": dict(
        title="Risk & Sizing: drawdowns, EV, stops", cert="risk",
        keywords="risk expected value drawdown recovery stop loss position size diversification kelly portfolio",
        body=[
            "EXPECTED VALUE = sum(probability x payoff). Take a bet only if EV > 0, and the edge survives fees.",
            "DRAWDOWN RECOVERY: after losing d (as a fraction) you need d / (1 - d) to get back. -50% needs +100%.",
            "POSITION SIZE by risk budget: shares = floor(risk budget / (entry - stop)). Risk 1-2% of the account.",
            "PORTFOLIO RETURN = sum(weight x return). Weights sum to 1.",
            "One big position is a coin flip with your rent on it. Diversify, and size to survive being wrong.",
        ]),
    "wiki-howto": dict(
        title="How to use ASTRAWIKI", cert=None,
        keywords="help wiki search calc calculator exam certificate lockout fee tutorial start",
        body=[
            "SEARCH finds articles. Open one and study it - the exam desk only lets you sit after the article "
            "has been open for " + str(STUDY_SECONDS) + " seconds.",
            "The exam has " + str(QUESTIONS) + " numeric questions with fresh numbers every sitting; pass mark "
            + str(PASS_MARK) + "/" + str(QUESTIONS) + ". Use the CALC tab. Answers are checked to about 1%.",
            "A sitting costs a fee (scaled by inflation) and expires after " + str(EXAM_MINUTES) + " minutes. "
            "Fail and you are locked out for " + str(LOCKOUT_MIN) + " minutes. The fee is not refunded.",
            "Certificates chain: Money Basics -> Credit / Brokerage -> Risk.",
        ]),
}


def _r(rng, a, b, step=1):
    return a + step * rng.randint(0, int((b - a) / step))


# ---- question generators: each returns (prompt, answer, unit_hint) ----------
def _pay(rng):
    g = _r(rng, 2400, 9600, 100); t = _r(rng, 12, 38)
    return (f"Gross monthly salary is ${g}. Tax rate is {t}%. What is the NET monthly pay in dollars?",
            g * (1 - t / 100), "$")


def _real(rng):
    n = _r(rng, 4, 14); i = _r(rng, 1, 9)
    return (f"An account returns {n}% nominal in a year with {i}% inflation. What is the REAL return in % (2 decimals)?",
            ((1 + n / 100) / (1 + i / 100) - 1) * 100, "%")


def _fv(rng):
    p = _r(rng, 1000, 9000, 500); r = _r(rng, 3, 12); n = _r(rng, 3, 10)
    return (f"You invest ${p} at {r}% per year compounded yearly for {n} years. Future value in dollars?",
            p * (1 + r / 100) ** n, "$")


def _save(rng):
    inc = _r(rng, 2000, 6000, 100); sp = int(inc * rng.uniform(0.55, 0.95))
    return (f"Income ${inc}/month, spending ${sp}/month. Savings rate in %?", (inc - sp) / inc * 100, "%")


def _runway(rng):
    cash = _r(rng, 3000, 20000, 500); cost = _r(rng, 900, 2400, 50)
    return (f"You have ${cash} in cash and monthly costs of ${cost}, no income. How many months of runway (2 decimals)?",
            cash / cost, "months")


def _pmt(rng):
    p = _r(rng, 5000, 40000, 1000); apr = _r(rng, 5, 24); y = _r(rng, 2, 6)
    r = apr / 1200; n = y * 12
    return (f"Loan ${p} at {apr}% APR over {y} years, level monthly payments. What is the monthly payment in dollars?",
            p * r / (1 - (1 + r) ** -n), "$")


def _tint(rng):
    p = _r(rng, 5000, 30000, 1000); apr = _r(rng, 6, 20); y = _r(rng, 2, 5)
    r = apr / 1200; n = y * 12
    m = p * r / (1 - (1 + r) ** -n)
    return (f"Loan ${p} at {apr}% APR over {y} years. What is the TOTAL INTEREST paid over the life of the loan, in dollars?",
            m * n - p, "$")


def _dti(rng):
    inc = _r(rng, 3000, 8000, 100); d = int(inc * rng.uniform(0.15, 0.55))
    return (f"Gross monthly income ${inc}; monthly debt payments ${d}. Debt-to-income ratio in %?", d / inc * 100, "%")


def _mrate(rng):
    apr = _r(rng, 6, 36)
    return (f"A card charges {apr}% APR. What is the monthly rate in % (3 decimals)?", apr / 12, "%")


def _owed(rng):
    b = _r(rng, 500, 5000, 100); apr = _r(rng, 12, 30)
    return (f"You owe ${b} and pay nothing for one month at {apr}% APR (simple monthly rate). "
            f"What do you owe after the month, in dollars?", b * (1 + apr / 1200), "$")


def _pl(rng):
    q = _r(rng, 2, 40); b = _r(rng, 20, 200); s = b + rng.choice([-1, 1]) * _r(rng, 2, 30); f = _r(rng, 1, 9)
    return (f"You buy {q} shares at ${b} and sell at ${s}. The fee is ${f} per trade (charged on each of the two trades). "
            f"Net profit in dollars (negative if a loss)?", q * (s - b) - 2 * f, "$")


def _avg(rng):
    q1 = _r(rng, 5, 30); p1 = _r(rng, 20, 90); q2 = _r(rng, 5, 30); p2 = _r(rng, 20, 90)
    return (f"You hold {q1} shares bought at ${p1} and add {q2} more at ${p2}. Average cost per share (2 decimals)?",
            (q1 * p1 + q2 * p2) / (q1 + q2), "$")


def _be(rng):
    b = _r(rng, 20, 200); f = _r(rng, 1, 5)
    return (f"Fee is {f}% on each leg. You buy at ${b}. What sell price breaks even (2 decimals)?",
            b * (1 + f / 100) / (1 - f / 100), "$")


def _wt(rng):
    pos = _r(rng, 500, 5000, 100); tot = pos + _r(rng, 2000, 15000, 500)
    return (f"A position is worth ${pos} in a portfolio worth ${tot}. Position weight in %?", pos / tot * 100, "%")


def _fee(rng):
    q = _r(rng, 5, 60); p = _r(rng, 20, 150); f = rng.choice([0.5, 1, 1.5, 2])
    return (f"An order of {q} shares at ${p} carries a {f}% fee on order value. Fee in dollars (2 decimals)?",
            q * p * f / 100, "$")


def _ev(rng):
    p = _r(rng, 20, 70); w = _r(rng, 50, 300, 10); l = _r(rng, 40, 200, 10)
    return (f"A trade wins ${w} with probability {p}% and loses ${l} otherwise. Expected value in dollars (2 decimals)?",
            p / 100 * w - (1 - p / 100) * l, "$")


def _rec(rng):
    d = _r(rng, 10, 60, 5)
    return (f"Your account drops {d}%. What percentage GAIN do you need to get back to even (2 decimals)?",
            d / (100 - d) * 100, "%")


def _size(rng):
    acct = _r(rng, 2000, 20000, 500); rp = rng.choice([1, 2]); e = _r(rng, 40, 150); st = e - _r(rng, 2, 10)
    return (f"Account ${acct}. You risk {rp}% of it. Entry ${e}, stop ${st}. Max whole shares by the risk rule?",
            math.floor(acct * rp / 100 / (e - st)), "shares")


def _pret(rng):
    w = _r(rng, 20, 80, 10); r1 = _r(rng, -10, 25); r2 = _r(rng, -10, 25)
    return (f"{w}% of a portfolio returns {r1}% and the other {100 - w}% returns {r2}%. Portfolio return in % (2 decimals)?",
            w / 100 * r1 + (1 - w / 100) * r2, "%")


def _dbl(rng):
    r = _r(rng, 3, 18)
    return (f"By the rule of 72, roughly how many years to double at {r}% a year (2 decimals)?", 72 / r, "years")


GENS = {
    "basics": [_pay, _real, _fv, _save, _runway, _dbl],
    "credit": [_pmt, _tint, _dti, _mrate, _owed],
    "broker": [_pl, _avg, _be, _wt, _fee],
    "risk":   [_ev, _rec, _size, _pret, _wt],
}


def make_exam(cert, seed):
    """Deterministic for a seed. Returns list of dict(prompt, answer, unit)."""
    rng = random.Random(seed)
    gens = list(GENS[cert]); rng.shuffle(gens)
    out = []
    for g in gens[:QUESTIONS]:
        prompt, ans, unit = g(rng)
        out.append(dict(prompt=prompt, answer=float(ans), unit=unit))
    return out


def is_correct(given, answer):
    try:
        g = float(str(given).replace(",", "").replace("$", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return False
    tol = max(0.02, abs(answer) * 0.01)
    return abs(g - answer) <= tol


def grade(cert, seed, answers):
    qs = make_exam(cert, seed)
    answers = list(answers or [])[:QUESTIONS] + [None] * QUESTIONS
    marks = [is_correct(answers[i], q["answer"]) for i, q in enumerate(qs)]
    return marks, sum(marks)


def search(query, limit=6):
    toks = [t for t in re.findall(r"[a-z0-9]+", (query or "").lower()) if len(t) > 1]
    if not toks:
        return []
    scored = []
    for aid, a in ARTICLES.items():
        title = a["title"].lower(); kw = a["keywords"].lower(); body = " ".join(a["body"]).lower()
        s = 0
        for t in toks:
            s += 5 * title.count(t) + 3 * kw.count(t) + body.count(t)
        if s:
            scored.append((s, aid))
    scored.sort(reverse=True)
    return [aid for _, aid in scored[:limit]]


def session_label(utc_hour):
    """Cosmetic: the market never closes, but liquidity follows the sun."""
    h = utc_hour % 24
    if 13 <= h < 16:
        return "LONDON / NEW YORK OVERLAP", "deep"
    if 8 <= h < 13:
        return "LONDON SESSION", "good"
    if 16 <= h < 21:
        return "NEW YORK SESSION", "good"
    if h >= 21 or h < 1:
        return "SYDNEY SESSION", "thin"
    return "ASIA SESSION", "thin"
