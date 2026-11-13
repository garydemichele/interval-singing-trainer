import { midiToName } from "./noteMath.js";

// MIDI numbers. Edit or extend this array to add/change voice ranges.
export const RANGES = [
  { id: "baritone", name: "Baritone", low: 45, high: 69 }, // A2 - A4
  { id: "tenor", name: "Tenor", low: 48, high: 72 }, // C3 - C5
  { id: "alto", name: "Alto", low: 53, high: 77 }, // F3 - F5
  { id: "soprano", name: "Soprano", low: 60, high: 84 }, // C4 - C6
];

export function getRangeById(id) {
  return RANGES.find((r) => r.id === id) || null;
}

// Returns the set of allowed MIDI note numbers: the union of the selected ranges.
export function buildPool(selectedIds) {
  const pool = new Set();
  for (const id of selectedIds) {
    const range = getRangeById(id);
    if (!range) continue;
    for (let midi = range.low; midi <= range.high; midi++) pool.add(midi);
  }
  return pool;
}

// Collapses a pool (Set of MIDI numbers) into merged contiguous [low, high] intervals,
// for display purposes (e.g. "A2 to C5", or "A2 to C3, F4 to F5" if there are gaps).
export function poolToIntervals(pool) {
  const sorted = [...pool].sort((a, b) => a - b);
  const intervals = [];
  for (const midi of sorted) {
    const last = intervals[intervals.length - 1];
    if (last && midi === last.high + 1) {
      last.high = midi;
    } else {
      intervals.push({ low: midi, high: midi });
    }
  }
  return intervals;
}

export function describePool(pool) {
  const intervals = poolToIntervals(pool);
  if (intervals.length === 0) return "(none selected)";
  return intervals.map((iv) => `${midiToName(iv.low)} to ${midiToName(iv.high)}`).join(", ");
}
