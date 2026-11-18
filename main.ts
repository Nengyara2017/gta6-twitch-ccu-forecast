// GTA VI launch-day Twitch viewership forecaster (Node 22, standard library only).
//
// Method: for each forecast hour h = 2..24, forecast the log-ratio
//   log(viewers_h / viewers_1)
// from the case's comparables (past big launches' hourly counts).
//
// The key empirical fact is that a launch's day shape depends strongly on the
// size of its hour-1 print: the bigger the first hour, the flatter the day.
// (The biggest launches peak in hour 1 itself; small ones grow several-fold
// into the evening.) So for each hour we fit a weighted linear regression of
// the log-ratio on log(hour-1 viewers) across the comparables, and evaluate it
// at the target's own hour-1 print. The forecast median is that fitted value;
// the spread is the residual standard deviation around the fit, so the five
// quantiles are median + z_tau * sigma * SPREAD. All constants below were
// chosen by leave-one-out validation over the comparables (see README).
//
// Comparables are weighted by relevance: console-only rolling-midnight
// launches (the shape GTA VI itself has) count most; early-access-contaminated
// ones count half; launches whose release-day peak exceeds 20x their hour-1
// print (simultaneous global unlocks whose hour 1 is nearly empty) are dropped,
// because their ratios describe a different unlock pattern, not a day shape.
//
// The program is deterministic (pure arithmetic, no randomness, no clock, no
// network) and reads only the case file it is given.
//
// Run: mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

/** Weight for console-only rolling-midnight comparables (GTA VI's own shape). */
const W_CONSOLE_ROLLING = 3;
/** Weight for console-only (not rolling) comparables. */
const W_CONSOLE_ONLY = 1.5;
/** Weight for rolling-midnight (not console-only) comparables. */
const W_ROLLING = 1.25;
/** Weight for early-access-contaminated comparables. */
const W_EARLY_ACCESS = 0.5;
/** Peak-to-hour-1 ratio above which a comparable is dropped (different unlock). */
const PEAK_RATIO_DROP = 20;
/** Factor applied to the residual spread around the fitted median. */
const SPREAD = 0.85;
/** Floor on the residual spread, in log units, so tiny samples still spread. */
const SIGMA_FLOOR = 0.05;
/** Baseline spread (log units per sqrt hour), used only as a fallback. */
const BASELINE_SIGMA = 0.15;

interface Comparable {
  name: string;
  day_start: string;
  unlock: string;
  platforms: string;
  hourly: Array<{ from: string; viewers: number }>;
}

interface Case {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The tier recorded in a comparable's unlock note ("Tier: ..."), if any. */
const tierOf = (comp: Comparable): string => {
  const m = /Tier:\s*([a-z-]+)/i.exec(comp.unlock ?? '');
  return m ? m[1].toLowerCase() : 'unknown';
};

/** True when the comparable launched on consoles only (no PC). */
const isConsoleOnly = (comp: Comparable): boolean => !/PC/i.test(comp.platforms ?? '');

/** True when the comparable unlocked at midnight local time, rolling. */
const isRolling = (comp: Comparable): boolean => /midnight local|rolling/i.test(comp.unlock ?? '');

/** True for a console-only rolling-midnight launch: GTA VI's own shape. */
const isConsoleRolling = (comp: Comparable): boolean => isConsoleOnly(comp) && isRolling(comp);

/**
 * A comparable's release-day hourly viewer counts, hours 1..24, or null when
 * it has no usable release day (fewer than 24 hours from its day_start, or a
 * zero hour-1 print, as the GTA VI category's own pre-release history has).
 */
const dayVector = (comp: Comparable): number[] | null => {
  const dayIdx = comp.hourly.findIndex((h) => h.from === comp.day_start);
  if (dayIdx < 0) return null;
  const rel = comp.hourly.slice(dayIdx, dayIdx + 24);
  if (rel.length !== 24 || rel[0].viewers <= 0) return null;
  return rel.map((h) => Math.max(0, h.viewers));
};

/** A comparable's relevance weight; 0 drops it from the fit. */
const weightOf = (comp: Comparable, vec: number[]): number => {
  let w = 1;
  if (isConsoleRolling(comp)) w *= W_CONSOLE_ROLLING;
  else if (isConsoleOnly(comp)) w *= W_CONSOLE_ONLY;
  else if (isRolling(comp)) w *= W_ROLLING;
  if (tierOf(comp) === 'early-access-contaminated') w *= W_EARLY_ACCESS;
  const peak = Math.max(...vec);
  if (peak / vec[0] > PEAK_RATIO_DROP) w = 0;
  return w;
};

/**
 * The five log-quantiles of log(viewers_h / viewers_1) for one hour, from a
 * weighted linear fit of the log-ratio on log(hour-1 viewers) across the pool.
 * Returns null when the pool cannot support a fit (too few usable comparables).
 */
const fitHour = (
  pool: Array<{ vec: number[]; comp: Comparable }>,
  h: number,
  logP1: number,
): number[] | null => {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const pts: Array<{ lx: number; lr: number; w: number }> = [];
  for (const { vec, comp } of pool) {
    const w = weightOf(comp, vec);
    if (w <= 0) continue;
    const lx = Math.log(Math.max(1, vec[0]));
    const lr = Math.log(Math.max(1, vec[h - 1]) / Math.max(1, vec[0]));
    pts.push({ lx, lr, w });
    sw += w;
    sx += w * lx;
    sy += w * lr;
    sxx += w * lx * lx;
    sxy += w * lx * lr;
  }
  if (pts.length < 3 || sw <= 0) return null;
  const denom = sw * sxx - sx * sx;
  let a: number;
  let b: number;
  if (Math.abs(denom) < 1e-9) {
    a = sy / sw;
    b = 0;
  } else {
    b = (sw * sxy - sx * sy) / denom;
    a = (sy - b * sx) / sw;
  }
  // Clamp the evaluation point to the range of log(hour-1) the fit was
  // built on: the regression is only supported where there are data, and an
  // extreme hour-1 print (the final's, if it dwarfs every comparable) must
  // not be extrapolated linearly into a wild median. LOO on the practice
  // cases is unchanged, since every practice hour-1 lies inside the range.
  let lxMin = Infinity;
  let lxMax = -Infinity;
  for (const { lx } of pts) {
    if (lx < lxMin) lxMin = lx;
    if (lx > lxMax) lxMax = lx;
  }
  const logP1c = Math.min(lxMax, Math.max(lxMin, logP1));
  const median = a + b * logP1c;
  let sres = 0;
  let sw2 = 0;
  for (const { lx, lr, w } of pts) {
    const r = lr - (a + b * lx);
    sres += w * r * r;
    sw2 += w;
  }
  const sigma = Math.max(SIGMA_FLOOR, Math.sqrt(sres / Math.max(1e-9, sw2)));
  return Z.map((z) => median + z * sigma * SPREAD);
};

/** The house baseline's five log-quantiles for one hour (fallback only). */
const baselineLogQuantiles = (h: number): number[] =>
  Z.map((z) => z * BASELINE_SIGMA * Math.sqrt(h - 1));

/** Forecast one case: 23 rows of five quantiles for hours 2..24. */
const forecastCase = (c: Case): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  const logP1 = Math.log(p1);
  const pool: Array<{ vec: number[]; comp: Comparable }> = [];
  for (const comp of c.comparables ?? []) {
    const vec = dayVector(comp);
    if (vec !== null) pool.push({ vec, comp });
  }
  return c.forecast.map(({ hour }) => {
    const logq = fitHour(pool, hour, logP1) ?? baselineLogQuantiles(hour);
    const q = logq.map((lq) => {
      let v = p1 * Math.exp(lq);
      if (!Number.isFinite(v) || v <= 0) v = p1;
      return Math.min(1e9, Math.max(0.01, round2(v)));
    });
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    return { hour, q };
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
