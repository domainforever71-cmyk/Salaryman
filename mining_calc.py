"""Bitcoin mining profitability math.

Pure functions, stdlib only. The live inputs - BTC price and network
difficulty - are fetched over the network by app.py (fetch_btc_price() /
fetch_btc_difficulty()) and handed in here as plain numbers, so this module
itself stays synchronous and easy to test in isolation (see __main__ below).
It has no opinion on where the numbers came from; if you pass in stale or
made-up inputs, you get a stale or made-up answer back, clearly.

The formulas are the real ones Bitcoin miners actually use, not a simulated
approximation - same "the math is real even where the game isn't" rule the
rest of this project applies to the BTC/USDT feed.
"""

SECONDS_PER_BLOCK = 600  
BLOCKS_PER_DAY = 86400 / SECONDS_PER_BLOCK 


BLOCK_REWARD_BTC = 3.125

HASH_UNITS = {
    "h": 1.0, "kh": 1e3, "mh": 1e6, "gh": 1e9, "th": 1e12, "ph": 1e15, "eh": 1e18,
}


def network_hashrate(difficulty):
    """H/s implied by the current difficulty, straight from Bitcoin's own
    definition: difficulty = network_hashrate * target_block_time / 2**32."""
    return float(difficulty) * (2 ** 32) / SECONDS_PER_BLOCK


def estimate_profit(hashrate, unit, difficulty, btc_price,
                     power_watts=0.0, cost_per_kwh=0.0, pool_fee_pct=0.0):
    """Daily/monthly/yearly profitability for a miner running `hashrate`
    `unit` (e.g. 110, 'th') against the given network difficulty and BTC
    price. Raises ValueError on a bad unit or a non-numeric input rather
    than silently returning zero everywhere."""
    unit_key = (unit or "").strip().lower()
    if unit_key not in HASH_UNITS:
        raise ValueError(f"Unknown hashrate unit '{unit}' - use one of: {', '.join(HASH_UNITS)}.")

    hashrate = float(hashrate)
    difficulty = float(difficulty)
    btc_price = float(btc_price)
    power_watts = max(0.0, float(power_watts or 0.0))
    cost_per_kwh = max(0.0, float(cost_per_kwh or 0.0))
    pool_fee_pct = max(0.0, float(pool_fee_pct or 0.0))

    your_hs = hashrate * HASH_UNITS[unit_key]
    net_hs = network_hashrate(difficulty)
    share = (your_hs / net_hs) if net_hs else 0.0

    daily_btc_gross = share * BLOCKS_PER_DAY * BLOCK_REWARD_BTC
    pool_fee_btc = daily_btc_gross * (pool_fee_pct / 100.0)
    daily_btc_net = daily_btc_gross - pool_fee_btc

    daily_revenue_usd = daily_btc_net * btc_price
    daily_power_cost_usd = (power_watts / 1000.0) * 24 * cost_per_kwh
    daily_profit_usd = daily_revenue_usd - daily_power_cost_usd


    breakeven_kwh_cost = None
    if power_watts:
        kwh_per_day = (power_watts / 1000.0) * 24
        if kwh_per_day:
            breakeven_kwh_cost = round(daily_revenue_usd / kwh_per_day, 4)

    return {
        "your_hashrate_hs": your_hs,
        "network_hashrate_hs": net_hs,
        "network_share_pct": round(share * 100, 10),
        "daily_btc_gross": round(daily_btc_gross, 8),
        "daily_btc_net": round(daily_btc_net, 8),
        "daily_revenue_usd": round(daily_revenue_usd, 2),
        "daily_power_cost_usd": round(daily_power_cost_usd, 2),
        "daily_profit_usd": round(daily_profit_usd, 2),
        "monthly_profit_usd": round(daily_profit_usd * 30, 2),
        "yearly_profit_usd": round(daily_profit_usd * 365, 2),
        "breakeven_kwh_cost": breakeven_kwh_cost,
    }


if __name__ == "__main__":

    result = estimate_profit(
        110, "th",
        difficulty=95_000_000_000_000,
        btc_price=93000,
        power_watts=3250,
        cost_per_kwh=0.10,
        pool_fee_pct=1.0,
    )
    for key, value in result.items():
        print(f"{key}: {value}")
