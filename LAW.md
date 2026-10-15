# Astra legal system

Players open **`/law`** (a page served by the game server, e.g. `https://your-server/law`) with four tabs:

- **LAW CODE** - a long, searchable statute book generated from the country in force. A drop-down lets you read the other
  countries' codes too. Parts: I Constitution (how votes change the law, current tally, history of who won), II Taxes and
  commerce, III Criminal code (per-crime detection, fines and jail *with your own priors applied*), IV Civil courts,
  V Counsel, VI Appeals and clean slates, VII Your record, VIII Recent case law, IX How other countries differ.
- **MY RECORD** - your offenses, appeal buttons (time-limited), petition to erase a conviction.
- **LAWYERS** - four NPC firms (free public defender up to an elite firm) and player lawyers. Any player can take the bar.
- **COURT** - sue another player, answer a summons (contest / admit / offer a settlement), settle, withdraw, public docket.

"Country" = the four governments players vote between (Free Market Republic, Social Democracy, People's Collective,
Security State). When a vote flips the country, the whole code, fees, appeal odds and judging bias flip with it.
All country numbers live in the `LAW` table at the top of `law.py`, so the code text and the courts always agree.

Rulings list their factors: lawyer skill gap, country doctrine, wealth gap, each side's prior convictions, then chance.
Cases are heard by the server tick; admins can overrule with `/r verdict`.
New tables (`law_lawyers`, `law_cases`, `law_actions`, `law_regime_history`) are created automatically on first start.

## In the game UI
`static/astra_stage27_law.js` adds a **LAW** app (desktop icon + taskbar § icon) that shows `/law` inside the game window. Every 15 s it
checks `/api/law/inbox`; a new summons or settlement offer raises a toast and a red badge on the tab.
`app.py` injects that script tag into the index page, so `templates/index.html` does not need editing.
