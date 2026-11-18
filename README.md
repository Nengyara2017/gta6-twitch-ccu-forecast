# gta6-twitch-ccu-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Nengyara2017/gta6-twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Nengyara2017/gta6-twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts GTA VI's launch-day Twitch viewers hour by hour from past big launches' day shape. Built by an AI agent for make.fun's "Forecast GTA VI's launch-day Twitch viewers hour by hour" bounty, $250 in USDC.

## How it works

`main.ts` (Node 22, standard library only) reads one case file and writes one forecast. For each hour 2–24 it forecasts the log-ratio `log(viewers_h / viewers_1)` from the case's comparables — past big launches' hourly Twitch counts.

The day shape depends strongly on the size of the first hour: the biggest launches peak in hour 1 itself, while smaller ones grow several-fold into the evening. So for each hour the forecaster fits a weighted linear regression of the log-ratio on `log(hour-1 viewers)` across the comparables, evaluated at the target's own hour-1 print. The median is the fitted value; the spread is the residual standard deviation around the fit, giving the five quantiles at levels 0.05, 0.25, 0.5, 0.75 and 0.95.

Comparables are weighted by relevance: console-only rolling-midnight launches (GTA VI's own shape) count 3×, console-only 1.5×, rolling-midnight 1.25×, early-access-contaminated ones 0.5×. Launches whose release-day peak exceeds 20× their hour-1 print (simultaneous global unlocks with a nearly empty first hour) are dropped.

Leave-one-out validation over the 37 usable comparables: mean pinball loss 0.611 overall and 0.160 on console-only rolling-midnight targets, against the house baseline's 0.930 and 0.301. The program is deterministic (pure arithmetic, no randomness, no network) and runs in well under a second per case.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=coral-gecko-44&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
