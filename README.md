# Interval Ear Trainer

Static web app (no backend) that drills singing intervals by ear: it plays a reference
note, you sing the requested interval, and it listens through the mic to tell you how
close you got.

Built from `interval-singing-trainer-spec.md`.

## Running it

Any static file server works, served over **HTTPS** (or `localhost`, which browsers
treat as a secure context) - the microphone API requires it.

```bash
cd interval-singing-trainer
python3 -m http.server 8123
```

Then open `http://localhost:8123/`.

## Project layout

- `index.html`, `css/style.css` - the app shell and styling.
- `js/noteMath.js` - MIDI <-> frequency <-> note-name conversions, cents math. Pure, no DOM.
- `js/ranges.js` - voice range data and pool-union logic. Pure, no DOM.
- `js/intervals.js` - interval name/semitone table.
- `js/roundPicker.js` - picks a valid (reference, target) pair per round. Pure, no DOM.
- `js/pitchDetector.js` - monophonic pitch detector (NSDF / McLeod Pitch Method). Pure math, no Web Audio dependency.
- `js/audioEngine.js` - the only browser-specific module: reference tone synthesis, iOS silent-switch workaround, mic capture.
- `js/app.js` - wires it all together: settings UI, exercise state machine, scoring.
- `tests/` - unit tests (see below).
- `manifest.json`, `icons/icon.svg` - optional "Add to Home Screen" support.

## Reference tone: synthesized, not sampled

The spec's preferred option was real piano samples. This build uses the Web Audio
fallback instead (a custom periodic wave with a fast attack / exponential decay
envelope, in `js/audioEngine.js`'s `playReferenceTone`) - it keeps the app fully
self-contained with no sample-pack licensing to track down or asset files to host.
Swapping in a sampled piano later is a localized change to that one function.

## Testing

### Unit tests (automated, no mic needed)

Covers note math, range-union logic, the "target must be inside the pool" rule, and a
pitch-detector self-test that feeds synthetic sine waves across the full 70-1100Hz
voice range.

Open `tests/test.html` in a browser (via the same local server, not `file://`, since
it uses ES module imports). Results render on the page and log to the console.

There's no Node.js in this environment, but if you have Node installed elsewhere, the
same suite runs headlessly:

```bash
cd interval-singing-trainer
node tests/run-tests.mjs
```

### Manual checklist (real device only)

Pitch detection against an actual voice and microphone can only be verified on a real
device - do this on the iPhone before trusting the app day to day:

- [ ] First tap on "Start" shows the iOS microphone permission prompt; allowing it lets a round start.
- [ ] Denying the permission shows the on-screen error message (not a silent failure).
- [ ] With the ringer switch **off** (silent), the reference tone still plays.
- [ ] With the ringer switch **on**, the reference tone plays normally.
- [ ] Sing in tune for the target note while the app is listening -> round reports success, with the needle sitting in the shaded tolerance zone.
- [ ] Sing audibly sharp/flat -> the needle and cents reading move the correct direction, and the round reports a miss (or succeeds right at the tolerance edge, as expected).
- [ ] Stay silent through the whole listening window -> result shows "no clear pitch detected", not a false reading.
- [ ] Try it near background noise (TV, fan) - confirm the detector doesn't lock onto noise as a false pitch.
- [ ] Try it through the phone's built-in mic/speaker and, separately, through wired headphones with a mic - both should behave reasonably (headphone mic is usually cleaner).
- [ ] Toggle "Octave-agnostic" on, then deliberately sing the target an octave away from the sung reference - should count as correct.
- [ ] Change voice ranges / intervals in Settings, confirm the displayed active range updates and new rounds respect it.
- [ ] Close Safari and relaunch - settings, score, and streak should have persisted (localStorage).
- [ ] If you add it to the Home Screen, re-check the microphone prompt still appears correctly in that standalone mode; if it's flaky, fall back to using it as a normal Safari tab (noted in the spec as a known iOS quirk).

## Possible later additions

See the spec's "Possible later additions" section (custom ranges like Bass, ear-only
mode, progress history / spaced repetition, a native SwiftUI port) - none of these are
in this build.
