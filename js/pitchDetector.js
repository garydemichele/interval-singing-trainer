// Monophonic pitch detector using the normalized square difference function (NSDF),
// as in the McLeod Pitch Method, with parabolic interpolation for sub-sample lag
// refinement. Pure math on a Float32Array buffer - no Web Audio dependency - so it
// can be unit-tested with synthetic sine waves in Node or a browser.
//
// Two deliberate departures from naive "pick the global max lag" autocorrelation:
//
// 1. Normalization: plain ACF normalized by acf(0) decays at longer lags purely from
//    window-overlap shrinkage (fewer summed samples), biasing the detector against
//    low frequencies. NSDF normalizes each lag by the energy of just the two
//    overlapping windows at that lag, so a clean periodic signal reads ~1.0 at every
//    lag, independent of lag position.
// 2. Peak picking: NSDF has a tall peak at every multiple of the true period, not
//    just the first one (a pure tone's autocorrelation is itself periodic). Taking
//    the global argmax over the whole lag range causes octave errors - it can latch
//    onto 2x or 3x the true period. Instead we take the FIRST local peak that comes
//    within a fraction of the tallest peak found, which is almost always the true
//    (shortest) period.

export const MIN_FREQ_HZ = 70;
export const MAX_FREQ_HZ = 1100;

const RMS_SILENCE_THRESHOLD = 0.01;
const DEFAULT_CLARITY_THRESHOLD = 0.85;
const PEAK_PICK_RATIO = 0.9; // accept the first peak within 90% of the global best

// buffer: Float32Array of time-domain samples (e.g. from AnalyserNode.getFloatTimeDomainData)
// sampleRate: in Hz
// Returns { frequency, clarity } or null if no clear pitch (silence / noise / unvoiced).
export function detectPitch(buffer, sampleRate, clarityThreshold = DEFAULT_CLARITY_THRESHOLD) {
  const n = buffer.length;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += buffer[i];
  mean /= n;

  const centered = new Float32Array(n);
  let rms = 0;
  for (let i = 0; i < n; i++) {
    const v = buffer[i] - mean;
    centered[i] = v;
    rms += v * v;
  }
  rms = Math.sqrt(rms / n);
  if (rms < RMS_SILENCE_THRESHOLD) return null;

  const minLag = Math.max(1, Math.floor(sampleRate / MAX_FREQ_HZ));
  const maxLag = Math.min(Math.ceil(sampleRate / MIN_FREQ_HZ), n - 1);
  if (maxLag <= minLag) return null;

  // Cumulative sum of squares, so the energy of any [a, b) slice is prefixSq[b] - prefixSq[a]
  // in O(1), without re-summing per lag.
  const prefixSq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefixSq[i + 1] = prefixSq[i] + centered[i] * centered[i];

  function acfAt(lag) {
    let acf = 0;
    for (let i = 0; i < n - lag; i++) acf += centered[i] * centered[i + lag];
    return acf;
  }

  function nsdfAt(lag) {
    const acf = acfAt(lag);
    const energyHead = prefixSq[n - lag]; // sum x[i]^2 for i in [0, n-lag)
    const energyTail = prefixSq[n] - prefixSq[lag]; // sum x[i+lag]^2 for i in [0, n-lag)
    const m = energyHead + energyTail;
    return m > 0 ? (2 * acf) / m : 0;
  }

  // Compute NSDF across the full candidate range (plus one sample of padding on each
  // side, where available, so boundary lags can still be tested for local-max-ness).
  const loBound = Math.max(1, minLag - 1);
  const hiBound = Math.min(n - 1, maxLag + 1);
  const nsdf = new Float64Array(hiBound - loBound + 1);
  for (let lag = loBound; lag <= hiBound; lag++) nsdf[lag - loBound] = nsdfAt(lag);
  const at = (lag) => nsdf[lag - loBound];

  // Collect local maxima (peaks) within [minLag, maxLag].
  const peaks = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    const v = at(lag);
    const prev = lag > loBound ? at(lag - 1) : -Infinity;
    const next = lag < hiBound ? at(lag + 1) : -Infinity;
    if (v >= prev && v >= next && v > 0) peaks.push({ lag, value: v });
  }

  let bestLag;
  let bestNsdf;
  if (peaks.length > 0) {
    const globalBest = Math.max(...peaks.map((p) => p.value));
    const chosen = peaks.find((p) => p.value >= globalBest * PEAK_PICK_RATIO) || peaks[0];
    bestLag = chosen.lag;
    bestNsdf = chosen.value;
  } else {
    // Fallback: no clean local maximum (e.g. very noisy frame) - use the raw argmax.
    bestLag = -1;
    bestNsdf = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const v = at(lag);
      if (v > bestNsdf) {
        bestNsdf = v;
        bestLag = lag;
      }
    }
  }

  if (bestLag <= 0) return null;
  if (bestNsdf < clarityThreshold) return null;

  // Parabolic interpolation around bestLag using neighboring NSDF values for a
  // sub-sample-accurate lag estimate.
  const yMinus = bestLag > loBound ? at(bestLag - 1) : bestNsdf;
  const yPlus = bestLag < hiBound ? at(bestLag + 1) : bestNsdf;
  const denom = yMinus - 2 * bestNsdf + yPlus;
  const shift = denom !== 0 ? (0.5 * (yMinus - yPlus)) / denom : 0;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, shift));

  const frequency = sampleRate / refinedLag;
  if (frequency < MIN_FREQ_HZ * 0.98 || frequency > MAX_FREQ_HZ * 1.02) return null;

  return { frequency, clarity: bestNsdf };
}

// Smooths a short history of frequency readings (Hz) via median, to reduce jitter
// without the lag of a long moving average. Returns null if history is empty.
export function medianFrequency(history) {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
