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
let node = null;
let analyser = null;
let wasmModule = null;
let wasmBytes = null;
let starting = false;

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
    const newNode = new AudioWorkletNode(newCtx, 'plaits', { outputChannelCount: [2] });

    const newAnalyser = newCtx.createAnalyser();
    newAnalyser.fftSize = 2048;
    newNode.connect(newAnalyser);
    newAnalyser.connect(newCtx.destination);

    newNode.port.onmessage = (event) => {
      if (event.data.type === 'ready') {
        // Folded into the ready message: it fires right after and would
        // otherwise overwrite a warning printed earlier.
        status(`running at ${event.data.sampleRate} Hz${rateWarning}`);
        sendAll();
      }
    };
    newNode.port.postMessage({ type: 'wasm', bytes: wasmBytes });

    await newCtx.resume();

    ctx = newCtx;
    node = newNode;
    analyser = newAnalyser;

    requestAnimationFrame(meter);
  } catch (err) {
    status(`failed to start: ${err.message}`);
    if (newCtx) newCtx.close().catch(() => {});
  } finally {
    starting = false;
  }
}

const send = (id, value) => node && node.port.postMessage({ type: 'param', id, value });

function sendAll() {
  for (const input of document.querySelectorAll('[data-param]')) {
    send(paramId(input.dataset.param), Number(input.value));
  }
  node.port.postMessage({ type: 'mix', value: Number(document.getElementById('mix').value) });
  // Use the internal envelope + level so the demo is audible without a gate.
  send(PARAMS.TRIGGER_PATCHED, 1);
  send(PARAMS.LEVEL_PATCHED, 1);
  send(PARAMS.MOD_LEVEL, 1);
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
    node && node.port.postMessage({ type: 'mix', value: Number(e.target.value) });
  });

  const trigger = document.getElementById('trigger');
  const releaseTrigger = () => send(PARAMS.MOD_TRIGGER, 0);
  trigger.addEventListener('pointerdown', (e) => {
    // Captures the pointer so a drag off the button still routes pointerup
    // (and friends) here, instead of leaving the trigger stuck on.
    trigger.setPointerCapture(e.pointerId);
    send(PARAMS.MOD_TRIGGER, 1);
  });
  trigger.addEventListener('pointerup', releaseTrigger);
  trigger.addEventListener('pointercancel', releaseTrigger);
  trigger.addEventListener('pointerleave', releaseTrigger);
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
