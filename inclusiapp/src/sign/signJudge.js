/**
 * Juiz do sinal: olha vários quadros seguidos da câmera e decide se o
 * jogador está fazendo o sinal pedido — ou mostrando outro sinal.
 *
 * Um único quadro não decide nada: as notas de cada vogal (handSigns.js)
 * são suavizadas ao longo do tempo, o sinal certo precisa ficar parado por
 * um instante (`holdMs`) e o aviso de sinal incorreto só aparece quando outro
 * sinal (ou um formato de mão desconhecido) continua na câmera por um tempo.
 * Assim, a mão passando de um formato para outro não gera avisos falsos.
 *
 * Sem DOM: testado em tests/unit/signJudge.test.mjs.
 */
import { SIGN_VOWELS } from './handSigns.js';

export class SignJudge {
  /**
   * @param {string} target  vogal pedida ('A' … 'U')
   * @param {object} [opts]  SIGN_GAME.recognition
   */
  constructor(target, {
    minScore = 0.5,
    holdMs = 700,
    wrongMs = 1600,
    unknownMs = 3200,
    cooldownMs = 2600,
    lostMs = 800,
    smoothing = 0.45,
    graceMs = 250,
  } = {}) {
    this.target = target;
    this.opts = { minScore, holdMs, wrongMs, unknownMs, cooldownMs, lostMs, smoothing, graceMs };
    this.done = false;
    this.lastWrongAt = -Infinity;
    this._clear();
  }

  _clear() {
    this.ema = null;
    this.holdStart = null;
    this.lastMatchAt = null;
    this.otherStart = null;
    this.otherVowel = null;
    this.unknownStart = null;
    this.lastHandAt = null;
  }

  /** Escolhe, entre as mãos do quadro, a que mais se parece com o sinal pedido. */
  _pick(hands) {
    let best = null;
    for (const h of hands || []) {
      if (!h?.scores) continue;
      const t = h.scores[this.target] ?? 0;
      const top = Math.max(...SIGN_VOWELS.map((v) => h.scores[v] ?? 0));
      const key = t * 2 + top; // prioriza a nota da vogal pedida
      if (!best || key > best.key) best = { key, scores: h.scores };
    }
    return best?.scores || null;
  }

  /**
   * Um quadro analisado.
   * @param {Array<{scores: Record<string, number>}>} hands  resultado de classifyHand() de cada mão (vazio = sem mão)
   * @param {number} now  ms
   * @returns {{ state: 'nohand'|'match'|'other'|'unknown', progress: number,
   *            event: null|'correct'|'wrong', seen: string|null, scores: object|null }}
   */
  update(hands, now) {
    const o = this.opts;
    const scores = this._pick(hands);
    if (!scores) {
      if (this.lastHandAt === null || now - this.lastHandAt > o.lostMs) this._clear();
      this.holdStart = null;
      return { state: 'nohand', progress: 0, event: null, seen: null, scores: this.ema };
    }
    this.lastHandAt = now;

    // média móvel exponencial das notas
    if (!this.ema) this.ema = { ...scores };
    else for (const v of SIGN_VOWELS) this.ema[v] += o.smoothing * ((scores[v] ?? 0) - this.ema[v]);
    const ema = this.ema;
    const t = ema[this.target];
    let seen = null;
    let top = 0;
    for (const v of SIGN_VOWELS) {
      if (ema[v] > top) {
        top = ema[v];
        seen = v;
      }
    }
    if (top < o.minScore) seen = null;

    const matching = t >= o.minScore && t >= top;
    if (matching) this.lastMatchAt = now;
    // pequenas falhas de 1 quadro não zeram o tempo segurando o sinal
    const holding = matching || (this.lastMatchAt !== null && now - this.lastMatchAt <= o.graceMs);

    if (holding) {
      this.otherStart = null;
      this.unknownStart = null;
      if (this.holdStart === null) this.holdStart = now;
      const progress = Math.min(1, (now - this.holdStart) / o.holdMs);
      let event = null;
      if (progress >= 1 && !this.done) {
        this.done = true;
        event = 'correct';
      }
      return { state: 'match', progress, event, seen: this.target, scores: ema };
    }

    this.holdStart = null;
    let event = null;
    const cooled = now - this.lastWrongAt >= o.cooldownMs;
    if (seen) {
      // a mão está fazendo OUTRO sinal
      this.unknownStart = null;
      if (this.otherVowel !== seen) {
        this.otherVowel = seen;
        this.otherStart = now;
      }
      if (now - this.otherStart >= o.wrongMs && cooled && !this.done) {
        event = 'wrong';
        this.lastWrongAt = now;
        this.otherStart = now;
      }
      return { state: 'other', progress: 0, event, seen, scores: ema };
    }
    // formato de mão que não é nenhuma vogal
    this.otherStart = null;
    this.otherVowel = null;
    if (this.unknownStart === null) this.unknownStart = now;
    if (now - this.unknownStart >= o.unknownMs && cooled && !this.done) {
      event = 'wrong';
      this.lastWrongAt = now;
      this.unknownStart = now;
    }
    return { state: 'unknown', progress: 0, event, seen: null, scores: ema };
  }
}
