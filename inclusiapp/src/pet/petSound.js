/**
 * Sons do Bichinho Virtual, sintetizados com o mesmo motor do resto do app
 * (ui/sound.js): respeitam o botão 🔊/🔇 e não precisam de arquivos.
 * Todo som tem um retorno visual equivalente na tela.
 */
import { tone } from '../ui/sound.js';

const seq = (notes, step, opts) => notes.forEach((f, i) => tone(f, i * step, opts.duration || 0.12, opts));

export const petSfx = {
  eat() {
    // "nham, nham"
    seq([330, 262, 330, 262], 0.13, { type: 'square', gain: 0.045, duration: 0.07, slide: 0.85 });
  },
  drink() {
    seq([520, 660, 820], 0.1, { type: 'sine', gain: 0.09, duration: 0.09, slide: 1.35 });
  },
  bath() {
    for (let i = 0; i < 7; i++) tone(900 + Math.random() * 900, i * 0.07, 0.06, { type: 'sine', gain: 0.05, slide: 1.5 });
  },
  play() {
    tone(420, 0, 0.12, { type: 'triangle', gain: 0.12, slide: 1.6 });
    tone(640, 0.14, 0.14, { type: 'triangle', gain: 0.12, slide: 1.4 });
  },
  heal() {
    seq([523.25, 659.25, 783.99, 1046.5], 0.09, { type: 'sine', gain: 0.1, duration: 0.25 });
  },
  energy() {
    seq([392, 523.25, 659.25, 783.99, 1046.5], 0.06, { type: 'triangle', gain: 0.09, duration: 0.16 });
  },
  magic() {
    seq([783.99, 987.77, 1174.66, 1567.98, 1975.53], 0.065, { type: 'sine', gain: 0.08, duration: 0.3 });
  },
  happy() {
    seq([659.25, 783.99, 1046.5], 0.08, { type: 'triangle', gain: 0.11, duration: 0.18 });
  },
  refuse() {
    tone(392, 0, 0.13, { type: 'triangle', gain: 0.08, slide: 0.8 });
    tone(330, 0.15, 0.18, { type: 'triangle', gain: 0.08, slide: 0.8 });
  },
  sleep() {
    seq([523.25, 440, 349.23], 0.28, { type: 'sine', gain: 0.08, duration: 0.4 });
  },
  wake() {
    seq([349.23, 440, 523.25, 698.46], 0.1, { type: 'triangle', gain: 0.09, duration: 0.18 });
  },
  clean() {
    tone(1400, 0, 0.22, { type: 'sawtooth', gain: 0.018, slide: 0.35 });
  },
  pop() {
    tone(760, 0, 0.06, { type: 'sine', gain: 0.07, slide: 1.7 });
  },
  levelUp() {
    seq([523.25, 659.25, 783.99, 1046.5, 1318.51], 0.11, { type: 'triangle', gain: 0.14, duration: 0.3 });
  },
};
