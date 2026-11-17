// Forecast the launch-day Twitch viewers of Grand Theft Auto VI, hour by hour
// (hours 2..24 of the UTC release day), from the launch-day shape of past big
// game launches.
//
// The forecast is a ratio to the case's own hour-1 print. For each forecast
// hour, the program takes the log of (that hour's viewers / hour-1 viewers)
// across the case's comparables, and reads off empirical quantiles. Three
// choices keep that ratio honest for a console-only, rolling-midnight launch
// like GTA VI:
//   - Console-only rolling-midnight launches count triple: they unlock the
//     way GTA VI does, so their day shape is the closest match.
//   - Early-access-contaminated launches count half: their release day is
//     already partly spent before the day starts.
//   - A comparable is dropped when its release-day peak is more than twenty
//     times its hour-1 print. That means hour 1 fell before the game really
//     unlocked, so a ratio to that near-empty hour says nothing about a
//     launch-day shape, and it would drag the upper quantiles absurdly high.
// The log-quantile spread is shrunk a little toward the median (factor 0.85):
// leave-one-out validation on the comparables showed the raw empirical band
// runs a touch wide for console-like launches, and the shrink keeps the
// 5%-to-95% band covering about nine hours in ten.
//
// Everything the program knows is in the case file. It uses the standard
// library only, no network, no clock, no randomness, so two runs write the
// same bytes.
//
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** How much of the log-quantile spread around the median to keep. */
const SPREAD_KEEP = 0.85;
/** Weight of a console-only rolling-midnight launch in the pool. */
const CONSOLE_ONLY_WEIGHT = 3;
/** Weight of an early-access-contaminated launch in the pool. */
const EARLY_ACCESS_WEIGHT = 0.5;
/** A comparable whose release-day peak tops this multiple of its hour 1 is
 *  dropped: its first hour fell before the unlock. */
const PEAK_TO_FIRST_CAP = 20;
/** The log-ratio quantiles are clamped to this band before exponentiating,
 *  so a comparable that collapses to near zero in some hour cannot drag a
 *  quantile to an absurdly small count. The top matches the peak cap. */
const LOG_RATIO_MIN = -3.5;
const LOG_RATIO_MAX = Math.log(PEAK_TO_FIRST_CAP);
/** When the filtered pool is this small, the quantiles are too noisy to
 *  trust, so the peak filter is relaxed and the pool rebuilt. */
const MIN_POOL = 8;
/** The standard normal's quantile at each level, for the fallback only. */
const NORMAL_Z = [-1.645, -0.674, 0, 0.674, 1.645];

type HourlyPoint = { from: string; viewers: number };
type Comparable = {
  name: string;
  day_start: string;
  unlock: string;
  platforms: string;
  hourly: HourlyPoint[];
};
type CaseFile = {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
};

/** The tier a comparable's unlock note assigns it ("comparable",
 *  "early-access-contaminated", "weak", "target-history", or ""). */
function tierOf(comp: Comparable): string {
  const m = /Tier:\s*([^.;]+)/i.exec(comp.unlock ?? '');
  return m ? m[1].trim().toLowerCase() : '';
}

/** True when a comparable launched on consoles only, at midnight local time
 *  rolling around the world: the unlock pattern GTA VI follows. */
function isConsoleRolling(comp: Comparable): boolean {
  const platforms = String(comp.platforms ?? '').toLowerCase();
  if (/pc|steam|windows/.test(platforms)) return false;
  const unlock = String(comp.unlock ?? '').toLowerCase();
  return unlock.includes('rolling') || unlock.includes('midnight local');
}

/** A comparable's 24 release-day viewer counts, hour 1 first, or null when
 *  any hour of that day is missing from its history. */
function releaseDay(comp: Comparable): number[] | null {
  const start = Date.parse(comp.day_start);
  if (Number.isNaN(start)) return null;
  const byTime = new Map<number, number>();
  for (const p of comp.hourly ?? []) {
    const t = Date.parse(p.from);
    if (!Number.isNaN(t)) byTime.set(t, p.viewers);
  }
  const day: number[] = [];
  for (let h = 0; h < 24; h++) {
    const v = byTime.get(start + h * 3600_000);
    if (v === undefined || v === null || !Number.isFinite(v)) return null;
    day.push(v);
  }
  return day;
}

/** The weighted quantile of value-weight pairs at level tau. Pairs must be
 *  sorted by value first; the result interpolates inside a weight step. */
function weightedQuantile(pairs: Array<{ v: number; w: number }>, tau: number): number {
  const total = pairs.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (let i = 0; i < pairs.length; i++) {
    const before = acc;
    acc += pairs[i].w;
    if (acc >= tau * total) {
      if (i === 0) return pairs[i].v;
      const frac = (tau * total - before) / pairs[i].w;
      return pairs[i - 1].v + (pairs[i].v - pairs[i - 1].v) * frac;
    }
  }
  return pairs[pairs.length - 1].v;
}

/** x rounded to 2 decimals (half up). */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** The five quantiles for one forecast hour, as viewer counts. `pool` holds
 *  each usable comparable's release-day counts and its weight. `p1` is the
 *  case's hour-1 print. Returns null when the pool is empty. */
function hourForecast(
  pool: Array<{ day: number[]; w: number }>,
  hour: number,
  p1: number,
): number[] | null {
  const pairs = pool
    .map(({ day, w }) => ({
      v: Math.log(Math.max(1, day[hour - 1]) / Math.max(1, day[0])),
      w,
    }))
    .sort((a, b) => a.v - b.v);
  if (pairs.length === 0) return null;
  const median = weightedQuantile(pairs, 0.5);
  const qs = LEVELS.map((tau) => {
    const q = median + (weightedQuantile(pairs, tau) - median) * SPREAD_KEEP;
    const clampedLog = Math.min(LOG_RATIO_MAX, Math.max(LOG_RATIO_MIN, q));
    return round2(p1 * Math.exp(clampedLog));
  });
  // Keep the row valid: finite, above 0, at most 1e9, non-decreasing.
  const clean: number[] = [];
  for (const q of qs) {
    const clamped = Math.min(1e9, Math.max(1, Number.isFinite(q) ? q : p1));
    clean.push(clean.length === 0 ? clamped : Math.max(clamped, clean[clean.length - 1]));
  }
  return clean;
}

/** The house persistence forecast, used only when a case has no usable
 *  comparable at all: every hour stays at hour 1's print, spread widening
 *  like a random walk in log space. */
function fallbackHour(p1: number, hour: number): number[] {
  const qs = NORMAL_Z.map((z) => round2(p1 * Math.exp(z * 0.15 * Math.sqrt(hour - 1))));
  const clean: number[] = [];
  for (const q of qs) {
    const clamped = Math.min(1e9, Math.max(1, q));
    clean.push(clean.length === 0 ? clamped : Math.max(clamped, clean[clean.length - 1]));
  }
  return clean;
}

mkdirSync(OUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const files = readdirSync(IN_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of files) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(IN_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);

  // The pool: usable comparables and their weights. The peak filter is
  // relaxed when it would leave too few comparables to trust.
  const buildPool = (peakCap: number): Array<{ day: number[]; w: number }> => {
    const pool: Array<{ day: number[]; w: number }> = [];
    for (const comp of c.comparables ?? []) {
      const tier = tierOf(comp);
      if (tier === 'target-history' || tier === 'weak') continue;
      const day = releaseDay(comp);
      if (day === null) continue;
      const peak = Math.max(...day.map((v) => v / Math.max(1, day[0])));
      if (peak > peakCap) continue;
      let w = 1;
      if (isConsoleRolling(comp)) w = CONSOLE_ONLY_WEIGHT;
      else if (tier === 'early-access-contaminated') w = EARLY_ACCESS_WEIGHT;
      pool.push({ day, w });
    }
    return pool;
  };
  let pool = buildPool(PEAK_TO_FIRST_CAP);
  if (pool.length < MIN_POOL) pool = buildPool(Number.POSITIVE_INFINITY);

  const hours = c.forecast.map(({ hour }) => {
    const q = hourForecast(pool, hour, p1) ?? fallbackHour(p1, hour);
    return { hour, q };
  });
  writeFileSync(join(OUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
