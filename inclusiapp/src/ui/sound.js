/**
 * Efeitos sonoros sintetizados (WebAudio) — sem arquivos para baixar.
 * O jogo original tocava "correctSound" e "errorSound"; aqui eles são gerados
 * na hora. O som é um complemento: todo retorno também é visual (e vibra no
 * Android), pensando em pessoas surdas.
 */
import { storage } from './storage.js';

let ctx = null;
let enabled = storage.get('sound', true);

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Chamar dentro de um toque/clique para liberar o áudio (iOS). */
export function unlockAudio() {
  audio();
}

export function isSoundOn() {
  return enabled;
}

export function setSound(on) {
  enabled = on;
  storage.set('sound', on);
}

export function tone(freq, start, duration, { type = 'sine', gain = 0.18, slide = 0 } = {}) {
  const ac = audio();
  if (!ac || !enabled) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + duration);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch { /* ignora */ }
}

export const sfx = {
  correct() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.085, 0.22, { type: 'triangle', gain: 0.2 }));
    vibrate(60);
  },
  wrong() {
    tone(220, 0, 0.18, { type: 'square', gain: 0.07, slide: 0.8 });
    tone(165, 0.16, 0.26, { type: 'square', gain: 0.07, slide: 0.75 });
    vibrate([40, 60, 40]);
  },
  tick() {
    tone(1400, 0, 0.03, { type: 'square', gain: 0.025 });
  },
  reveal() {
    tone(880, 0, 0.12, { type: 'triangle', gain: 0.12 });
    tone(1318.5, 0.08, 0.18, { type: 'triangle', gain: 0.12 });
  },
  skip() {
    tone(660, 0, 0.1, { type: 'sine', gain: 0.1, slide: 0.6 });
  },
  fanfare() {
    [523.25, 659.25, 783.99, 659.25, 1046.5].forEach((f, i) => tone(f, i * 0.13, 0.3, { type: 'triangle', gain: 0.18 }));
    vibrate([80, 60, 80, 60, 160]);
  },
};
