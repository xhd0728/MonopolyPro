/**
 * Light sound cues synthesised with Web Audio, so no audio files ship with the game.
 * Quiet by design; browsers only allow audio after the first click or key press.
 */
export type Cue =
  | 'roll'
  | 'land'
  | 'hop'
  | 'buy'
  | 'build'
  | 'pay'
  | 'earn'
  | 'jail'
  | 'card'
  | 'news'
  | 'myturn'
  | 'offer'
  | 'win';

let context: AudioContext | null = null;
let enabled = localStorage.getItem('mp-sound') !== 'false';
let lastHop = 0;

export const soundEnabled = () => enabled;
export function setSoundEnabled(on: boolean) {
  enabled = on;
  localStorage.setItem('mp-sound', String(on));
}
/** Create or resume the audio context on a user gesture. */
export function unlockSound() {
  if (!enabled) return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  context ??= new Ctor();
  if (context.state === 'suspended') void context.resume();
}
function tone(
  freq: number,
  start: number,
  length: number,
  type: OscillatorType = 'sine',
  gain = 0.06,
) {
  const ctx = context!;
  const osc = ctx.createOscillator(),
    amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  amp.gain.setValueAtTime(0, ctx.currentTime + start);
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
}
function rattle(count: number) {
  const ctx = context!;
  for (let i = 0; i < count; i++) {
    const length = 0.03;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let n = 0; n < data.length; n++) data[n] = (Math.random() * 2 - 1) * (1 - n / data.length);
    const source = ctx.createBufferSource(),
      amp = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + Math.random() * 1200;
    amp.gain.value = 0.08;
    source.buffer = buffer;
    source.connect(filter).connect(amp).connect(ctx.destination);
    source.start(ctx.currentTime + i * 0.055);
  }
}
export function play(cue: Cue) {
  if (!enabled || !context || context.state !== 'running') return;
  switch (cue) {
    case 'roll':
      rattle(7);
      break;
    case 'land':
      tone(330, 0, 0.12, 'triangle', 0.07);
      break;
    case 'hop': {
      // Hops come quickly; keep them from stacking into noise.
      const now = performance.now();
      if (now - lastHop < 80) return;
      lastHop = now;
      tone(880, 0, 0.05, 'sine', 0.025);
      break;
    }
    case 'buy':
      tone(523, 0, 0.12, 'triangle');
      tone(784, 0.1, 0.18, 'triangle');
      break;
    case 'build':
      tone(392, 0, 0.1, 'square', 0.03);
      tone(587, 0.09, 0.16, 'triangle');
      break;
    case 'pay':
      tone(294, 0, 0.16, 'sawtooth', 0.03);
      tone(220, 0.12, 0.22, 'sawtooth', 0.03);
      break;
    case 'earn':
      tone(988, 0, 0.08, 'sine', 0.05);
      tone(1319, 0.07, 0.14, 'sine', 0.05);
      break;
    case 'jail':
      tone(147, 0, 0.35, 'square', 0.035);
      break;
    case 'card':
      tone(660, 0, 0.08);
      tone(990, 0.06, 0.08);
      tone(1320, 0.12, 0.14);
      break;
    case 'news':
      tone(440, 0, 0.12, 'triangle');
      tone(554, 0.12, 0.12, 'triangle');
      break;
    case 'myturn':
      tone(523, 0, 0.1, 'triangle', 0.07);
      tone(659, 0.1, 0.1, 'triangle', 0.07);
      tone(784, 0.2, 0.2, 'triangle', 0.07);
      break;
    case 'offer':
      tone(740, 0, 0.1);
      tone(740, 0.16, 0.1);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.25, 'triangle', 0.07));
      break;
  }
}
