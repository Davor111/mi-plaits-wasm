// Mirrors src/params.rs. Keep in sync.
export const PARAMS = {
  ENGINE: 0, NOTE: 1, HARMONICS: 2, TIMBRE: 3, MORPH: 4,
  DECAY: 5, LPG_COLOUR: 6, FM_AMOUNT: 7,
  TIMBRE_MOD_AMOUNT: 8, MORPH_MOD_AMOUNT: 9,
  MOD_ENGINE: 16, MOD_NOTE: 17, MOD_FREQUENCY: 18, MOD_HARMONICS: 19,
  MOD_TIMBRE: 20, MOD_MORPH: 21, MOD_TRIGGER: 22, MOD_LEVEL: 23,
  FREQUENCY_PATCHED: 32, TIMBRE_PATCHED: 33, MORPH_PATCHED: 34,
  TRIGGER_PATCHED: 35, LEVEL_PATCHED: 36,
};

export const ENGINE_NAMES = [
  'virtual analog VCF', 'phase distortion', 'six-op FM 1', 'six-op FM 2',
  'six-op FM 3', 'wave terrain', 'string machine', 'chiptune',
  'virtual analog', 'waveshaping', 'FM', 'grain',
  'additive', 'wavetable', 'chord', 'speech',
  'swarm', 'noise', 'particle', 'string',
  'modal', 'bass drum', 'snare drum', 'hi-hat',
];

let ctx = null;
let voices = [];
let analyser = null;
let wasmModule = null;
let wasmBytes = null;
let starting = false;
const VOICE_COUNT = 8;
let voiceAge = 0;
let voiceState = [];
const noteToVoice = new Map();
const noteHoldCount = new Map();
const COMPUTER_WHITE_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i'];
const computerKeyToNote = new Map();
const noteToKeyboardElement = new Map();
const pressedComputerKeys = new Set();

const status = (text) => { document.getElementById('status').textContent = text; };

// Looks up a param id by name, throwing on an unrecognised `data-param`
// instead of silently falling through to `undefined` -> `0` -> ENGINE.
function paramId(name) {
  const id = PARAMS[name];
  if (id === undefined) throw new Error(`unknown param "${name}"`);
  return id;
}

async function start() {
  // Guarded on `starting`, not `ctx`: `ctx` isn't assigned until the very
  // end (on success), so a guard keyed on it would let a second click in
  // while the first is still awaiting, and would wedge shut forever if the
  // first click throws partway through.
  if (starting || ctx) return;
  starting = true;

  let newCtx;
  try {
    const res = await fetch('plaits.wasm');
    if (!res.ok) {
      throw new Error(`failed to fetch plaits.wasm: ${res.status} ${res.statusText}`);
    }
    wasmBytes = await res.arrayBuffer();

    // The library's DSP is written for 48 kHz; other rates sound different.
    newCtx = new AudioContext({ sampleRate: 48000 });
    const rateWarning = newCtx.sampleRate !== 48000
      ? ` (warning: context is ${newCtx.sampleRate} Hz, not 48000)`
      : '';

    await newCtx.audioWorklet.addModule('worklet.js');
    const newVoices = [];
    const mixBus = newCtx.createGain();
    let readyVoices = 0;
    for (let i = 0; i < VOICE_COUNT; i++) {
      const newNode = new AudioWorkletNode(newCtx, 'plaits', { outputChannelCount: [2] });
      newNode.connect(mixBus);
      newNode.port.onmessage = (event) => {
        if (event.data.type === 'ready') {
          readyVoices += 1;
          if (readyVoices === VOICE_COUNT) {
            status(`running (${VOICE_COUNT} voices) at ${event.data.sampleRate} Hz${rateWarning}`);
            sendAll(newVoices);
          }
        }
      };
      newNode.port.postMessage({ type: 'wasm', bytes: wasmBytes });
      newVoices.push(newNode);
    }

    const newAnalyser = newCtx.createAnalyser();
    newAnalyser.fftSize = 2048;
    mixBus.connect(newAnalyser);
    newAnalyser.connect(newCtx.destination);

    await newCtx.resume();

    ctx = newCtx;
    voices = newVoices;
    analyser = newAnalyser;
    resetVoiceAllocation();

    requestAnimationFrame(meter);
  } catch (err) {
    status(`failed to start: ${err.message}`);
    if (newCtx) newCtx.close().catch(() => {});
    ctx = null;
    voices = [];
    analyser = null;
    resetVoiceAllocation();
  } finally {
    starting = false;
  }
}

function sendToVoice(index, id, value) {
  const voice = voices[index];
  if (!voice) return;
  voice.port.postMessage({ type: 'param', id, value });
}

function send(id, value) {
  for (const voice of voices) voice.port.postMessage({ type: 'param', id, value });
}

function setMix(value, targetVoices = voices) {
  for (const voice of targetVoices) voice.port.postMessage({ type: 'mix', value });
}

function sendAll(targetVoices = voices) {
  for (const input of document.querySelectorAll('[data-param]')) {
    const id = paramId(input.dataset.param);
    const value = Number(input.value);
    for (const voice of targetVoices) voice.port.postMessage({ type: 'param', id, value });
  }
  setMix(Number(document.getElementById('mix').value), targetVoices);
  // Patch the trigger and level inputs so the keyboard gates the voice.
  // MOD_TRIGGER and MOD_LEVEL stay at 0 until a key is pressed, which is what
  // makes the page silent at rest instead of droning.
  for (const voice of targetVoices) {
    voice.port.postMessage({ type: 'param', id: PARAMS.TRIGGER_PATCHED, value: 1 });
    voice.port.postMessage({ type: 'param', id: PARAMS.LEVEL_PATCHED, value: 1 });
  }
}

function resetVoiceAllocation() {
  voiceAge = 0;
  noteToVoice.clear();
  noteHoldCount.clear();
  voiceState = Array.from({ length: voices.length }, () => ({
    active: false,
    note: null,
    age: 0,
  }));
}

function allocateVoice(midiNote) {
  const existing = noteToVoice.get(midiNote);
  if (existing !== undefined) return existing;

  const free = voiceState.findIndex((state) => !state.active);
  if (free !== -1) return free;

  let oldest = 0;
  for (let i = 1; i < voiceState.length; i++) {
    if (voiceState[i].age < voiceState[oldest].age) oldest = i;
  }

  const stolen = voiceState[oldest];
  if (stolen.active && stolen.note !== null) {
    noteToVoice.delete(stolen.note);
    sendToVoice(oldest, PARAMS.MOD_TRIGGER, 0);
    sendToVoice(oldest, PARAMS.MOD_LEVEL, 0);
  }
  stolen.active = false;
  stolen.note = null;

  return oldest;
}

// Polyphonic: each note is assigned to a voice; when all voices are busy, the
// oldest active one is stolen.
//
// NOTE goes first so the voice picks the pitch up on the rising edge rather
// than a block late. MOD_LEVEL is what opens the low-pass gate — without it
// the sustained engines stay inaudible and only the self-enveloping
// percussive ones would speak.
function noteOn(midiNote) {
  if (!voices.length) return;
  const holdCount = noteHoldCount.get(midiNote) ?? 0;
  noteHoldCount.set(midiNote, holdCount + 1);
  if (holdCount > 0) {
    setNoteSlider(midiNote);
    return;
  }

  const voice = allocateVoice(midiNote);
  sendToVoice(voice, PARAMS.NOTE, midiNote);
  sendToVoice(voice, PARAMS.MOD_LEVEL, 1);
  sendToVoice(voice, PARAMS.MOD_TRIGGER, 1);

  voiceState[voice].active = true;
  voiceState[voice].note = midiNote;
  voiceState[voice].age = ++voiceAge;
  noteToVoice.set(midiNote, voice);
  setNoteSlider(midiNote);
}

function noteOff(midiNote) {
  const holdCount = noteHoldCount.get(midiNote);
  if (holdCount === undefined) return;
  if (holdCount > 1) {
    noteHoldCount.set(midiNote, holdCount - 1);
    return;
  }
  noteHoldCount.delete(midiNote);

  const voice = noteToVoice.get(midiNote);
  if (voice === undefined) return;

  sendToVoice(voice, PARAMS.MOD_TRIGGER, 0);
  sendToVoice(voice, PARAMS.MOD_LEVEL, 0);
  voiceState[voice].active = false;
  voiceState[voice].note = null;
  noteToVoice.delete(midiNote);
}

// Keeps the note slider and its readout in step with the keyboard so the two
// controls never disagree, and so sendAll() has a truthful value to send.
function setNoteSlider(midiNote) {
  const slider = document.getElementById('note');
  slider.value = String(midiNote);
  document.getElementById('note-value').textContent = Number(midiNote).toFixed(2);
}

// Exposed for the automated check; reports output RMS.
export function rms() {
  if (!analyser) return 0;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

function meter() {
  document.getElementById('rms').textContent = rms().toFixed(4);
  requestAnimationFrame(meter);
}

// Two octaves from C3 (MIDI 48, the patch default) to C5. Plaits' `note`
// parameter is a plain MIDI note number: note_to_frequency gives
// 13.75 * 2^((n - 9) / 12), so 57 is 220 Hz and 60 is middle C.
const FIRST_NOTE = 48;
const LAST_NOTE = 72;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlackKey = (midiNote) => NOTE_NAMES[midiNote % 12].includes('#');

// Wires one element as a momentary key. Pointer capture means a drag off the
// element still routes the release here, so a note can never stick on.
function bindKey(el, note) {
  let heldNote = null;
  const release = () => {
    el.classList.remove('playing');
    if (heldNote === null) return;
    noteOff(heldNote);
    heldNote = null;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('playing');
    heldNote = Number(note());
    noteOn(heldNote);
  });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
}

function buildKeyboard() {
  const keyboard = document.getElementById('keyboard');
  let whiteIndex = 0;

  for (let note = FIRST_NOTE; note <= LAST_NOTE; note++) {
    const key = document.createElement('button');
    const black = isBlackKey(note);
    const name = `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

    key.type = 'button';
    key.className = black ? 'key black' : 'key white';
    key.dataset.note = String(note);
    key.setAttribute('aria-label', `${name} (MIDI ${note})`);
    key.title = name;
    noteToKeyboardElement.set(note, key);
    if (!black) {
      const computerKey = COMPUTER_WHITE_KEYS[whiteIndex];
      whiteIndex += 1;
      if (computerKey) {
        computerKeyToNote.set(computerKey, note);
        key.dataset.keyboard = computerKey;
        key.textContent = computerKey.toUpperCase();
        key.title = `${name} (${computerKey.toUpperCase()})`;
      }
    }

    // Black keys are positioned by CSS relative to the white key they follow,
    // so they have to sit next to it in document order.
    keyboard.append(key);
    bindKey(key, () => note);
  }
}

function bindComputerKeyboard() {
  const releaseKey = (keyboardKey) => {
    if (!pressedComputerKeys.has(keyboardKey)) return;
    pressedComputerKeys.delete(keyboardKey);
    const note = computerKeyToNote.get(keyboardKey);
    if (note === undefined) return;
    const keyEl = noteToKeyboardElement.get(note);
    if (keyEl) keyEl.classList.remove('playing');
    noteOff(note);
  };

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const keyboardKey = event.key.toLowerCase();
    const note = computerKeyToNote.get(keyboardKey);
    if (note === undefined) return;
    if (event.repeat || pressedComputerKeys.has(keyboardKey)) {
      event.preventDefault();
      return;
    }

    pressedComputerKeys.add(keyboardKey);
    const keyEl = noteToKeyboardElement.get(note);
    if (keyEl) keyEl.classList.add('playing');
    noteOn(note);
    event.preventDefault();
  });

  document.addEventListener('keyup', (event) => {
    const keyboardKey = event.key.toLowerCase();
    if (!computerKeyToNote.has(keyboardKey)) return;
    releaseKey(keyboardKey);
    event.preventDefault();
  });

  window.addEventListener('blur', () => {
    for (const keyboardKey of Array.from(pressedComputerKeys)) {
      releaseKey(keyboardKey);
    }
  });
}

function buildUi() {
  const select = document.getElementById('engine');
  ENGINE_NAMES.forEach((name, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `${i} — ${name}`;
    select.append(option);
  });

  for (const input of document.querySelectorAll('[data-param]')) {
    input.addEventListener('input', () => {
      send(paramId(input.dataset.param), Number(input.value));
      const readout = document.getElementById(`${input.id}-value`);
      if (readout) readout.textContent = Number(input.value).toFixed(2);
    });
  }

  document.getElementById('mix').addEventListener('input', (e) => {
    setMix(Number(e.target.value));
  });

  buildKeyboard();
  bindComputerKeyboard();

  // The trigger button plays whatever pitch the slider is set to, so it goes
  // through the same gate as the keyboard rather than duplicating it. It stays
  // useful for the percussive engines, where the pitch hardly matters.
  const trigger = document.getElementById('trigger');
  bindKey(trigger, () => Number(document.getElementById('note').value));

  document.getElementById('start').addEventListener('click', start);

  document.getElementById('bench').addEventListener('click', async () => {
    document.getElementById('bench-status').textContent = 'running…';
    const rows = await benchmark();
    const worst = rows.reduce((a, b) => (a.xRealtime < b.xRealtime ? a : b));
    document.getElementById('bench-results').innerHTML =
      '<tr><th>engine</th><th>x realtime</th><th>µs/block</th></tr>' +
      rows.map((r) => `<tr><td>${r.engine} — ${r.name}</td><td>${r.xRealtime.toFixed(0)}</td><td>${r.usPerBlock.toFixed(2)}</td></tr>`).join('');
    document.getElementById('bench-status').textContent =
      `worst: ${worst.name} at ${worst.xRealtime.toFixed(0)}x realtime`;
  });
}

// Runs on the main thread, not in the worklet: performance.now() is not
// reliably exposed in AudioWorkletGlobalScope, and timing the audio thread
// would perturb what it measures. Uses a second instance of the same module.
export async function benchmark({ seconds = 2, blockSize = 128, sampleRate = 48000 } = {}) {
  if (!wasmModule) {
    const bytes = await (await fetch('plaits.wasm')).arrayBuffer();
    wasmModule = await WebAssembly.compile(bytes);
  }

  const x = new WebAssembly.Instance(wasmModule, {}).exports;
  const blocks = Math.round((sampleRate * seconds) / blockSize);
  const results = [];

  for (let engine = 0; engine < ENGINE_NAMES.length; engine++) {
    const synth = x.plaits_new(blockSize, sampleRate);
    x.plaits_set_param(synth, PARAMS.ENGINE, engine);
    x.plaits_set_param(synth, PARAMS.TRIGGER_PATCHED, 1);
    x.plaits_set_param(synth, PARAMS.LEVEL_PATCHED, 1);
    x.plaits_set_param(synth, PARAMS.MOD_LEVEL, 1);

    for (let i = 0; i < 32; i++) x.plaits_render(synth); // settle engine switch

    const triggerEvery = Math.round(sampleRate / 4 / blockSize); // 4 Hz, matches the native baseline
    const t0 = performance.now();
    for (let b = 0; b < blocks; b++) {
      x.plaits_set_param(synth, PARAMS.MOD_TRIGGER, b % triggerEvery < 2 ? 1 : 0);
      x.plaits_render(synth);
    }
    const elapsedMs = performance.now() - t0;
    x.plaits_free(synth);

    results.push({
      engine,
      name: ENGINE_NAMES[engine],
      xRealtime: (seconds * 1000) / elapsedMs,
      usPerBlock: (elapsedMs * 1000) / blocks,
    });
  }

  return results;
}

buildUi();
window.plaitsDemo = { start, rms, send, PARAMS, benchmark };
