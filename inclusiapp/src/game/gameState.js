/**
 * Motor do jogo de cartas (sem DOM — testável em Node).
 *
 * Fluxo herdado do ARCombinationGameManager.cs:
 *   sorteio (baralho) → cronômetro → carta detectada → acerto ou erro
 *   → espera → embaralhar → nova missão; "Pular" consome a carta atual.
 *
 * Novidades pedidas para a versão Web:
 *   - erro desconta pontos (com proteções contra descontos repetidos);
 *   - acerto = pontos fixos + bônus de tempo;
 *   - fim de ciclo com resumo antes de embaralhar de novo.
 */
import { Deck } from './deck.js';
import { applyPenalty, hitScore } from './scoring.js';
import { Stopwatch } from './timer.js';

export const PHASE = Object.freeze({
  IDLE: 'idle', // aguardando a próxima missão (embaralhando)
  SEARCHING: 'searching', // carta sorteada, cronômetro correndo
  RESOLVED: 'resolved', // acertou ou pulou; aguardando a próxima
  CYCLE_COMPLETE: 'cycleComplete', // todas as cartas do ciclo foram usadas
});

const emptyStats = () => ({ score: 0, hits: 0, errors: 0, skips: 0, bestTime: null });

export class CardGameEngine {
  /**
   * @param {object} opts
   * @param {Array}  opts.cards      identificadores das cartas (ex.: 1..N)
   * @param {object} opts.scoring    GAME.scoring
   * @param {object} opts.wrongScan  GAME.wrongScan
   * @param {object} [opts.state]    estado salvo (toJSON) para continuar
   */
  constructor({ cards, scoring, wrongScan, random = Math.random, now = () => performance.now(), state = null }) {
    this.scoring = scoring;
    this.wrongScan = wrongScan;
    this.now = now;
    this.deck = new Deck(cards, { random, state: state?.deck });
    this.stopwatch = new Stopwatch(now);
    this.stats = { ...emptyStats(), ...(state?.stats || {}) };
    this.phase = PHASE.IDLE;
    this.current = null;
    this.mission = this._newMissionGuards([]);
    if (state && state.current != null && state.phase === PHASE.SEARCHING && this.deck.last === state.current) {
      // continua procurando a mesma carta (o cronômetro recomeça)
      this.current = state.current;
      this.phase = PHASE.SEARCHING;
      this.stopwatch.start();
    } else if (state && this.deck.isCycleComplete) {
      this.phase = PHASE.CYCLE_COMPLETE;
    }
  }

  _newMissionGuards(visibleCards) {
    return {
      penalties: 0,
      lastPenaltyAt: -Infinity,
      penalizedAt: new Map(),
      // cartas que já estavam na câmera quando a missão começou não penalizam
      // até sumirem da câmera (evita punir a carta do acerto anterior)
      immune: new Set(visibleCards),
    };
  }

  get elapsed() { return this.stopwatch.elapsed; }

  /** Sorteia a próxima carta. Devolve null se o ciclo acabou. */
  startMission({ visibleCards = [] } = {}) {
    if (this.deck.isCycleComplete) {
      this.phase = PHASE.CYCLE_COMPLETE;
      this.current = null;
      return null;
    }
    this.current = this.deck.draw();
    this.mission = this._newMissionGuards(visibleCards.filter((c) => c !== this.current));
    this.phase = PHASE.SEARCHING;
    this.stopwatch.start();
    return this.current;
  }

  /** Uma carta saiu do campo da câmera. */
  cardLost(card) {
    this.mission.immune.delete(card);
  }

  /** Uma carta foi reconhecida pela câmera. */
  detect(card) {
    if (this.phase !== PHASE.SEARCHING) return { type: 'ignored', reason: 'not-searching', card };

    if (card === this.current) {
      const seconds = this.stopwatch.elapsed;
      this.stopwatch.pause();
      const points = hitScore(seconds, this.scoring);
      this.stats.score += points.total;
      this.stats.hits += 1;
      if (this.stats.bestTime === null || seconds < this.stats.bestTime) this.stats.bestTime = seconds;
      this.phase = PHASE.RESOLVED;
      return { type: 'hit', card, seconds, ...points, score: this.stats.score };
    }

    const guards = this.mission;
    if (guards.immune.has(card)) return { type: 'ignored', reason: 'already-visible', card };
    const t = this.now() / 1000;
    const cfg = this.wrongScan;
    const last = guards.penalizedAt.get(card);
    let reason = null;
    if (guards.penalties >= cfg.maxPerMission) reason = 'max-per-mission';
    else if (t - guards.lastPenaltyAt < cfg.globalCooldown) reason = 'cooldown';
    else if (last !== undefined && t - last < cfg.sameCardCooldown) reason = 'same-card';
    if (reason) return { type: 'wrong', counted: false, reason, card, expected: this.current, penalty: 0, score: this.stats.score };

    const { score, deducted } = applyPenalty(this.stats.score, this.scoring);
    this.stats.score = score;
    this.stats.errors += 1;
    guards.penalties += 1;
    guards.lastPenaltyAt = t;
    guards.penalizedAt.set(card, t);
    return { type: 'wrong', counted: true, card, expected: this.current, penalty: deducted, score };
  }

  /** Botão Pular: a carta atual sai do ciclo e não volta até o próximo. */
  skip() {
    if (this.phase !== PHASE.SEARCHING) return { type: 'ignored', reason: 'not-searching' };
    const card = this.current;
    this.stopwatch.pause();
    this.stats.skips += 1;
    this.phase = PHASE.RESOLVED;
    return { type: 'skipped', card };
  }

  /** Depois de um acerto/pulo: o ciclo terminou? */
  get cycleComplete() {
    return this.deck.isCycleComplete && this.phase !== PHASE.SEARCHING;
  }

  /** Resumo do ciclo (tela "CICLO COMPLETO"). */
  summary() {
    return {
      used: this.deck.drawnInCycle,
      total: this.deck.size,
      cycle: this.deck.cycle,
      ...this.stats,
    };
  }

  /** Novo baralho: embaralha, zera o placar do ciclo e aguarda a próxima missão. */
  newCycle() {
    this.deck.newCycle();
    this.stats = emptyStats();
    this.phase = PHASE.IDLE;
    this.current = null;
  }

  pause() { this.stopwatch.pause(); }

  resume() { if (this.phase === PHASE.SEARCHING) this.stopwatch.resume(); }

  toJSON() {
    return { deck: this.deck.toJSON(), stats: this.stats, current: this.current, phase: this.phase };
  }
}
