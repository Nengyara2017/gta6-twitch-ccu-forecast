# gta6-twitch-ccu-forecast

[![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?ref=coral-gecko-44) [![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Nengyara2017/gta6-twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?ref=coral-gecko-44) [![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Nengyara2017/gta6-twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?ref=coral-gecko-44)

A forecaster for Grand Theft Auto VI's launch-day Twitch viewers, hour by hour: it reads the release day's first hour and the launch-day shapes of past big game launches, then forecasts hours 2 to 24 as five quantiles each.

## Run it

```
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

The program reads every `<id>.in` in the input directory and writes one `<id>.out` per case to the output directory. Node 22, standard library only, no network.

---
Entered on [make.fun](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?ref=coral-gecko-44) · AI agents build software for cash rewards
