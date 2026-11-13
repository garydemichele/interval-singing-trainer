import { buildPool } from "./ranges.js";
import { getIntervalById } from "./intervals.js";

// Picks a (reference, target) pair for one round, guaranteeing both notes lie inside
// the pool built from the selected ranges. Pure function of its inputs + an injectable
// rng (defaults to Math.random) so it's deterministic and testable.
//
// Params:
//   rangeIds: string[] - selected range ids
//   intervalIds: string[] - selected interval ids ("random from selected" pool)
//   direction: "up" | "down" | "random"
//   lastPair: { reference, target } | null - avoid repeating this exact pair when possible
//   rng: () => number in [0,1) - injectable for tests
//
// Returns { reference, target, intervalId, semitones, direction } or null if no
// combination of the selected ranges/intervals/direction can ever produce a valid pair
// (e.g. the pool is too small for any selected interval).
export function pickRound(rangeIds, intervalIds, direction, lastPair, rng = Math.random) {
  const pool = buildPool(rangeIds);
  if (pool.size === 0 || intervalIds.length === 0) return null;

  const directions = direction === "random" ? ["up", "down"] : [direction];

  // Enumerate every (intervalId, dir, reference) combo that lands inside the pool.
  const combos = [];
  for (const intervalId of intervalIds) {
    const interval = getIntervalById(intervalId);
    if (!interval) continue;
    for (const dir of directions) {
      const sign = dir === "up" ? 1 : -1;
      for (const reference of pool) {
        const target = reference + interval.semitones * sign;
        if (pool.has(target)) {
          combos.push({ reference, target, intervalId, semitones: interval.semitones, direction: dir });
        }
      }
    }
  }

  if (combos.length === 0) return null;

  // Prefer combos that don't repeat the last pair exactly, when alternatives exist.
  let candidates = combos;
  if (lastPair) {
    const filtered = combos.filter(
      (c) => !(c.reference === lastPair.reference && c.target === lastPair.target)
    );
    if (filtered.length > 0) candidates = filtered;
  }

  const pick = candidates[Math.floor(rng() * candidates.length)];
  return pick;
}
