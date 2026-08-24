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

const status = (text) => { document.getElementById('status').textContent = text; };

async function start() {
  if (ctx) return;

  const bytes = await (await fetch('plaits.wasm')).arrayBuffer();
  wasmBytes = bytes;
  wasmModule = await WebAssembly.compile(bytes);

  // The library's DSP is written for 48 kHz; other rates sound different.
  ctx = new AudioContext({ sampleRate: 48000 });
  if (ctx.sampleRate !== 48000) {
    status(`warning: context is ${ctx.sampleRate} Hz, not 48000`);
  }

  await ctx.audioWorklet.addModule('worklet.js');
  node = new AudioWorkletNode(ctx, 'plaits', { outputChannelCount: [2] });

  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(analyser);
  analyser.connect(ctx.destination);

  node.port.onmessage = (event) => {
    if (event.data.type === 'ready') {
      status(`running at ${event.data.sampleRate} Hz`);
      sendAll();
    }
  };
  node.port.postMessage({ type: 'wasm', bytes: wasmBytes });

  await ctx.resume();
  requestAnimationFrame(meter);
}

const send = (id, value) => node && node.port.postMessage({ type: 'param', id, value });

function sendAll() {
  for (const input of document.querySelectorAll('[data-param]')) {
    send(PARAMS[input.dataset.param], Number(input.value));
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
      send(PARAMS[input.dataset.param], Number(input.value));
      const readout = document.getElementById(`${input.id}-value`);
      if (readout) readout.textContent = Number(input.value).toFixed(2);
    });
  }

  document.getElementById('mix').addEventListener('input', (e) => {
    node && node.port.postMessage({ type: 'mix', value: Number(e.target.value) });
  });

  document.getElementById('trigger').addEventListener('pointerdown', () => send(PARAMS.MOD_TRIGGER, 1));
  document.getElementById('trigger').addEventListener('pointerup', () => send(PARAMS.MOD_TRIGGER, 0));
  document.getElementById('start').addEventListener('click', start);
}

buildUi();
window.plaitsDemo = { start, rms, send, PARAMS };
