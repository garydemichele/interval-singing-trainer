import { midiToName, midiToFreq, freqToMidiCents, centsFromTarget } from "./noteMath.js";
import { RANGES, buildPool, describePool } from "./ranges.js";
import { INTERVALS } from "./intervals.js";
import { pickRound } from "./roundPicker.js";
import { detectPitch, medianFrequency } from "./pitchDetector.js";
import { playReferenceTone, startMic, getMicBuffer, getSampleRate, ensureAudioContext } from "./audioEngine.js";

// ---------------- Settings (persisted) ----------------

const STORAGE_KEY = "intervalTrainerSettings";
const SCORE_KEY = "intervalTrainerScore";

const DEFAULT_SETTINGS = {
  rangeIds: ["baritone", "tenor"],
  intervalIds: ["M3"],
  direction: "up",
  toleranceCents: 50,
  listenSeconds: 6,
  octaveAgnostic: false,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) - settings just won't persist.
  }
}

function loadScore() {
  try {
    const raw = localStorage.getItem(SCORE_KEY);
    if (!raw) return { score: 0, streak: 0 };
    return JSON.parse(raw);
  } catch {
    return { score: 0, streak: 0 };
  }
}

function saveScore(score) {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(score));
  } catch {
    // ignore
  }
}

const settings = loadSettings();
const scoreState = loadScore();
let lastPair = null;
let currentRound = null; // { reference, target, intervalId, semitones, direction }

// ---------------- DOM refs ----------------

const el = {
  micNotice: document.getElementById("micNotice"),
  rangeChips: document.getElementById("rangeChips"),
  intervalChips: document.getElementById("intervalChips"),
  poolDisplay: document.getElementById("poolDisplay"),
  directionSegmented: document.getElementById("directionSegmented"),
  toleranceSlider: document.getElementById("toleranceSlider"),
  toleranceValue: document.getElementById("toleranceValue"),
  listenSlider: document.getElementById("listenSlider"),
  listenValue: document.getElementById("listenValue"),
  octaveAgnosticToggle: document.getElementById("octaveAgnosticToggle"),
  refNoteLabel: document.getElementById("refNoteLabel"),
  instructionLabel: document.getElementById("instructionLabel"),
  stateLabel: document.getElementById("stateLabel"),
  detectedNote: document.getElementById("detectedNote"),
  centsMeter: document.getElementById("centsMeter"),
  toleranceZone: document.getElementById("toleranceZone"),
  needle: document.getElementById("needle"),
  result: document.getElementById("result"),
  buttonRow: document.getElementById("buttonRow"),
  startBtn: document.getElementById("startBtn"),
  scoreNum: document.getElementById("scoreNum"),
  streakNum: document.getElementById("streakNum"),
  settingsPanel: document.getElementById("settingsPanel"),
};

// ---------------- Settings UI ----------------

function renderRangeChips() {
  el.rangeChips.innerHTML = "";
  for (const range of RANGES) {
    const btn = document.createElement("button");
    btn.className = "chip" + (settings.rangeIds.includes(range.id) ? " active" : "");
    btn.textContent = range.name;
    btn.type = "button";
    btn.addEventListener("click", () => {
      const idx = settings.rangeIds.indexOf(range.id);
      if (idx >= 0) settings.rangeIds.splice(idx, 1);
      else settings.rangeIds.push(range.id);
      saveSettings(settings);
      renderRangeChips();
      updatePoolDisplay();
    });
    el.rangeChips.appendChild(btn);
  }
}

function updatePoolDisplay() {
  const pool = buildPool(settings.rangeIds);
  el.poolDisplay.textContent =
    pool.size > 0 ? `Active range: ${describePool(pool)}` : "Pick at least one voice range.";
}

function renderIntervalChips() {
  el.intervalChips.innerHTML = "";
  for (const interval of INTERVALS) {
    const btn = document.createElement("button");
    btn.className = "chip" + (settings.intervalIds.includes(interval.id) ? " active" : "");
    btn.textContent = interval.name;
    btn.type = "button";
    btn.addEventListener("click", () => {
      const idx = settings.intervalIds.indexOf(interval.id);
      if (idx >= 0) settings.intervalIds.splice(idx, 1);
      else settings.intervalIds.push(interval.id);
      saveSettings(settings);
      renderIntervalChips();
    });
    el.intervalChips.appendChild(btn);
  }
}

function renderDirectionSegmented() {
  for (const btn of el.directionSegmented.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.value === settings.direction);
  }
}

el.directionSegmented.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  settings.direction = btn.dataset.value;
  saveSettings(settings);
  renderDirectionSegmented();
});

function renderTolerance() {
  el.toleranceSlider.value = settings.toleranceCents;
  el.toleranceValue.textContent = `${settings.toleranceCents}¢`;
  updateToleranceZone();
}

el.toleranceSlider.addEventListener("input", () => {
  settings.toleranceCents = Number(el.toleranceSlider.value);
  el.toleranceValue.textContent = `${settings.toleranceCents}¢`;
  updateToleranceZone();
  saveSettings(settings);
});

function renderListen() {
  el.listenSlider.value = settings.listenSeconds;
  el.listenValue.textContent = `${settings.listenSeconds}s`;
}

el.listenSlider.addEventListener("input", () => {
  settings.listenSeconds = Number(el.listenSlider.value);
  el.listenValue.textContent = `${settings.listenSeconds}s`;
  saveSettings(settings);
});

function renderOctaveToggle() {
  el.octaveAgnosticToggle.checked = settings.octaveAgnostic;
}

el.octaveAgnosticToggle.addEventListener("change", () => {
  settings.octaveAgnostic = el.octaveAgnosticToggle.checked;
  saveSettings(settings);
});

// Meter spans +/-600 cents (a tritone) across its width; the shaded tolerance zone
// scales with the tolerance setting.
const METER_SPAN_CENTS = 600;

function updateToleranceZone() {
  const pct = (settings.toleranceCents / METER_SPAN_CENTS) * 50; // half-width as % of full width
  el.toleranceZone.style.left = `${50 - pct}%`;
  el.toleranceZone.style.width = `${pct * 2}%`;
}

renderRangeChips();
updatePoolDisplay();
renderIntervalChips();
renderDirectionSegmented();
renderTolerance();
renderListen();
renderOctaveToggle();
updateScoreUI();

function updateScoreUI() {
  el.scoreNum.textContent = String(scoreState.score);
  el.streakNum.textContent = String(scoreState.streak);
}

// ---------------- Exercise flow ----------------

const SUCCESS_HOLD_MS = 400;
const DETECT_INTERVAL_MS = 50;
const FREQ_HISTORY_SIZE = 5;

let micReady = false;
let detectTimer = null;
let freqHistory = [];
let inToleranceSinceMs = null;
let listenDeadline = 0;
let listenTimeoutHandle = null;
let lastGoodDetection = null; // { midiExact, cents } most recent valid reading this round

function intervalPhrase(round) {
  const interval = INTERVALS.find((i) => i.id === round.intervalId);
  return `Sing a ${interval.name.toLowerCase()} ${round.direction}`;
}

function setButtons(buttons) {
  el.buttonRow.innerHTML = "";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = `action ${b.primary ? "primary" : "secondary"}`;
    btn.textContent = b.label;
    btn.type = "button";
    btn.addEventListener("click", b.onClick);
    el.buttonRow.appendChild(btn);
  }
}

function showNotice(message) {
  el.micNotice.textContent = message;
  el.micNotice.classList.toggle("visible", Boolean(message));
}

async function handleStart() {
  const pool = buildPool(settings.rangeIds);
  if (pool.size === 0) {
    showNotice("Pick at least one voice range in Settings before starting.");
    el.settingsPanel.open = true;
    return;
  }
  if (settings.intervalIds.length === 0) {
    showNotice("Pick at least one interval in Settings before starting.");
    el.settingsPanel.open = true;
    return;
  }

  el.startBtn.disabled = true;
  el.startBtn.textContent = "Requesting mic...";
  try {
    ensureAudioContext();
    await startMic();
    micReady = true;
    showNotice("");
  } catch (err) {
    showNotice(
      "Microphone permission was denied (or unavailable). Allow microphone access for this page and reload."
    );
    el.startBtn.disabled = false;
    el.startBtn.textContent = "Start";
    return;
  }

  el.settingsPanel.open = false;
  await runRound();
}

async function runRound() {
  const round = pickRound(settings.rangeIds, settings.intervalIds, settings.direction, lastPair);
  if (!round) {
    showNotice(
      "No valid reference/target pair fits the current ranges and intervals. Widen the voice ranges or pick smaller intervals."
    );
    setButtons([{ label: "Back to Settings", primary: true, onClick: () => (el.settingsPanel.open = true) }]);
    return;
  }
  currentRound = round;
  lastPair = { reference: round.reference, target: round.target };

  el.refNoteLabel.textContent = `Reference: ${midiToName(round.reference)}`;
  el.instructionLabel.textContent = intervalPhrase(round);
  el.result.innerHTML = "";
  setButtons([]);
  resetMeter();

  el.stateLabel.textContent = "Playing reference...";
  await playReferenceTone(round.reference, 1.5);

  el.stateLabel.textContent = "Get ready...";
  await wait(600);

  await listenForTarget(round);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetMeter() {
  freqHistory = [];
  inToleranceSinceMs = null;
  lastGoodDetection = null;
  el.detectedNote.textContent = "—";
  el.detectedNote.classList.add("idle");
  el.needle.classList.add("hidden");
}

function listenForTarget(round) {
  return new Promise((resolve) => {
    el.stateLabel.textContent = "Listening...";
    const durationMs = settings.listenSeconds * 1000;
    listenDeadline = performance.now() + durationMs;
    let consecutiveNulls = 0;

    const finish = (outcome, detail) => {
      clearInterval(detectTimer);
      clearTimeout(listenTimeoutHandle);
      detectTimer = null;
      showResult(round, outcome, detail);
      resolve();
    };

    detectTimer = setInterval(() => {
      const buffer = getMicBuffer();
      const sampleRate = getSampleRate();
      if (!buffer || !sampleRate) return;

      const detection = detectPitch(buffer, sampleRate);
      if (!detection) {
        consecutiveNulls++;
        if (consecutiveNulls >= 3) {
          // Only clear to "neutral" after a few misses in a row, so brief dropouts
          // between voiced frames don't make the display flicker.
          freqHistory = [];
          inToleranceSinceMs = null;
          el.detectedNote.textContent = "—";
          el.detectedNote.classList.add("idle");
          el.needle.classList.add("hidden");
        }
      } else {
        consecutiveNulls = 0;
        freqHistory.push(detection.frequency);
        if (freqHistory.length > FREQ_HISTORY_SIZE) freqHistory.shift();
        const smoothedFreq = medianFrequency(freqHistory);
        const { midi: nearestMidi, exactMidi } = freqToMidiCents(smoothedFreq);
        const cents = centsFromTarget(exactMidi, round.target, settings.octaveAgnostic);
        const inTolerance = Math.abs(cents) <= settings.toleranceCents;

        lastGoodDetection = { exactMidi, cents };
        updateMeter(nearestMidi, cents, inTolerance);

        if (inTolerance) {
          if (inToleranceSinceMs === null) inToleranceSinceMs = performance.now();
          if (performance.now() - inToleranceSinceMs >= SUCCESS_HOLD_MS) {
            finish("success", lastGoodDetection);
          }
        } else {
          inToleranceSinceMs = null;
        }
      }

      if (performance.now() >= listenDeadline) {
        finish("miss", lastGoodDetection);
      }
    }, DETECT_INTERVAL_MS);
  });
}

function updateMeter(nearestMidi, cents, inTolerance) {
  el.detectedNote.textContent = midiToName(nearestMidi);
  el.detectedNote.classList.remove("idle");
  const clamped = Math.max(-METER_SPAN_CENTS, Math.min(METER_SPAN_CENTS, cents));
  const pct = 50 + (clamped / METER_SPAN_CENTS) * 50;
  el.needle.style.left = `${pct}%`;
  el.needle.classList.remove("hidden");
  el.needle.classList.toggle("in-tolerance", inTolerance);
}

function showResult(round, outcome, detection) {
  el.stateLabel.textContent = "";
  const targetName = midiToName(round.target);

  if (outcome === "success") {
    scoreState.score += 1;
    scoreState.streak += 1;
    saveScore(scoreState);
    updateScoreUI();
    const cents = Math.round(detection.cents);
    const direction = cents === 0 ? "right on pitch" : cents > 0 ? `${cents}¢ sharp` : `${Math.abs(cents)}¢ flat`;
    el.result.innerHTML = `
      <div class="verdict success">Nailed it!</div>
      <div class="detail">You sang ${midiToName(Math.round(detection.exactMidi))} - ${direction}, matching ${targetName}</div>
    `;
  } else {
    scoreState.streak = 0;
    saveScore(scoreState);
    updateScoreUI();
    if (detection) {
      const cents = Math.round(detection.cents);
      const direction = cents > 0 ? `${cents}¢ sharp` : `${Math.abs(cents)}¢ flat`;
      el.result.innerHTML = `
        <div class="verdict miss">Not quite</div>
        <div class="detail">Target was ${targetName}. Closest you sang: ${midiToName(Math.round(detection.exactMidi))} (${direction})</div>
      `;
    } else {
      el.result.innerHTML = `
        <div class="verdict miss">Not quite</div>
        <div class="detail">Target was ${targetName}. No clear pitch was detected - try again a bit louder or closer to the mic.</div>
      `;
    }
  }

  setButtons([
    { label: "Hear it again", primary: false, onClick: () => playReferenceTone(round.reference, 1.5) },
    { label: "Hear the target note", primary: false, onClick: () => playReferenceTone(round.target, 1.5) },
    { label: "Next", primary: true, onClick: () => runRound() },
  ]);
}

el.startBtn.addEventListener("click", handleStart);
