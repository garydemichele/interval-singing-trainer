// Browser-only audio: reference tone playback and microphone capture.
// Kept separate from pitchDetector.js (pure math) so that module stays unit-testable.

import { midiToFreq } from "./noteMath.js";

let audioCtx = null;
let silentAudioEl = null;

// Must be called from inside a user-gesture handler (iOS requirement).
export function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  ensureSilentLoop();
  return audioCtx;
}

// iOS mutes Web Audio output when the ringer/silent switch is set to silent, UNLESS
// a looping <audio> element is also playing - that keeps the "media" audio session
// category active and routes Web Audio output as if it were media playback.
function ensureSilentLoop() {
  if (silentAudioEl) return;
  silentAudioEl = new Audio(buildSilentWavDataUri());
  silentAudioEl.loop = true;
  silentAudioEl.volume = 0.0001;
  silentAudioEl.play().catch(() => {
    // Autoplay can still be blocked in rare cases; the UI already warns about the
    // ringer switch, so there's nothing further to do here.
  });
}

// Builds a minimal but fully valid silent WAV (8kHz, mono, 8-bit PCM, ~0.3s) as a data
// URI, so the silent <audio> loop has no external asset dependency.
function buildSilentWavDataUri() {
  const sampleRate = 8000;
  const numSamples = Math.round(sampleRate * 0.3);
  const headerSize = 44;
  const buf = new ArrayBuffer(headerSize + numSamples);
  const view = new DataView(buf);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (1 byte/sample for 8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) view.setUint8(headerSize + i, 128); // 128 = silence for 8-bit PCM

  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

// Synthesized piano-like tone: a handful of decaying harmonics via a custom periodic
// wave, with a fast-attack / exponential-decay envelope. Real piano samples would
// sound better but require shipping/licensing a sample pack; this keeps the app
// self-contained. Swap in sampled playback later by replacing this function.
export function playReferenceTone(midi, durationSec = 1.5) {
  const ctx = ensureAudioContext();
  const freq = midiToFreq(midi);
  const now = ctx.currentTime;

  // Harmonic amplitudes roughly modeling a struck string: strong fundamental, decaying
  // overtones, with the even harmonics slightly attenuated (brighter piano-like timbre).
  const numHarmonics = 8;
  const real = new Float32Array(numHarmonics + 1);
  const imag = new Float32Array(numHarmonics + 1);
  for (let h = 1; h <= numHarmonics; h++) {
    const falloff = 1 / Math.pow(h, 1.4);
    const evenPenalty = h % 2 === 0 ? 0.6 : 1;
    real[h] = falloff * evenPenalty;
  }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.9, now + 0.015); // fast attack
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec); // exponential decay

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.05);

  return new Promise((resolve) => {
    osc.onended = () => resolve();
  });
}

let micStream = null;
let analyser = null;

// Requests mic permission (on first call, ideally from a "Start" tap) and sets up an
// AnalyserNode for pulling time-domain data. Processing features are disabled because
// echo cancellation / noise suppression / AGC all distort pitch.
export async function startMic() {
  const ctx = ensureAudioContext();
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  }
  if (!analyser) {
    const source = ctx.createMediaStreamSource(micStream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);
  }
  return { ctx, analyser };
}

export function getMicBuffer() {
  if (!analyser) return null;
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  return buffer;
}

export function stopMic() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  analyser = null;
}

export function getSampleRate() {
  return audioCtx ? audioCtx.sampleRate : null;
}
