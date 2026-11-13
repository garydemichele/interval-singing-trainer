// Pure note-math helpers. No DOM/Web Audio deps so these can be unit-tested in Node.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToName(midi) {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Inverse of midiToFreq: nearest MIDI number plus a cents offset (-50..+50 typically,
// but can exceed that range for frequencies far from any note center).
export function freqToMidiCents(freq) {
  if (!(freq > 0)) return null;
  const exactMidi = 69 + 12 * Math.log2(freq / 440);
  const nearestMidi = Math.round(exactMidi);
  const cents = (exactMidi - nearestMidi) * 100;
  return { midi: nearestMidi, cents, exactMidi };
}

// Cents distance between a detected pitch and a target MIDI note, folding to the
// nearest octave when octaveAgnostic is true (so a target sung an octave away reads as ~0).
export function centsFromTarget(detectedMidiExact, targetMidi, octaveAgnostic) {
  let diffSemitones = detectedMidiExact - targetMidi;
  if (octaveAgnostic) {
    diffSemitones = ((diffSemitones % 12) + 18) % 12 - 6; // wrap to [-6, 6)
  }
  return diffSemitones * 100;
}
