/**
 * Regras de uma partida do ✋ Sinalize e Conte — sem DOM, testadas em Node
 * (tests/unit/signState.test.mjs).
 *
 *   start() → nextRound()
 *     [SCAN]    cardSeen(letra) até ser a carta certa   (ou skipScan())
 *     [SIGN]    startSign() → signWrong()* → signCorrect()   (ou skipSign())
 *     [ANIMALS] a interface mostra os animais → startCount()
 *     [COUNT]   answer(n)* até acertar a quantidade
 *     [DONE]    finishRound() → próxima rodada … → [FINISHED] summary()
 *
 * O baralho é o mesmo do Jogo de Cartas (game/deck.js): as vogais são
 * embaralhadas e cada uma sai uma vez — sem repetir até completar o ciclo.
 * Cada partida (inclusive "Jogar novamente") começa com um novo embaralhamento.
 *
 * Tempo 1 (sinal) e Tempo 2 (contagem) usam o cronômetro do Jogo de Cartas,
 * que pausa quando o app vai para segundo plano.
 */
import { Deck } from '../game/deck.js';
import { Stopwatch } from '../game/timer.js';
import { maxRoundScore, rankFor, stepPoints } from './signScore.js';

export const PHASE = {
  IDLE: 'idle',
  SCAN: 'scan',
  SIGN: 'sign',
  ANIMALS: 'animals',
  COUNT: 'count',
  DONE: 'done',
  FINISHED: 'finished',
};

export class SignMatch {
  /**
   * @param {object} config  SIGN_GAME (signConfig.js)
   * @param {object} [options]
   * @param {() => number} [options.now]     relógio em ms (testes)
   * @param {() => number} [options.random]  gerador aleatório (testes)
   */
  constructor(config, { now = () => performance.now(), random = Math.random } = {}) {
    this.config = config;
    this.random = random;
    this.vowels = new Map(config.vowels.map((v) => [v.letter, v]));
    this.deck = new Deck(config.vowels.map((v) => v.letter), { random });
    this.clock = new Stopwatch(now); // tempo total da partida
    this.signTimer = new Stopwatch(now); // Tempo 1
    this.countTimer = new Stopwatch(now); // Tempo 2
    this.fresh = true;
    this._reset();
  }

  _reset() {
    this.phase = PHASE.IDLE;
    this.round = null;
    this.results = [];
    this.stats = {
      score: 0,
      signsCorrect: 0,
      signsSkipped: 0,
      wrongSigns: 0,
      countsCorrect: 0, // contagens certas na primeira tentativa
      countsWrong: 0,
      streak: 0,
      bestStreak: 0,
    };
    this._paused = null;
    this.signTimer.reset();
    this.countTimer.reset();
  }

  get rounds() {
    return this.config.rounds;
  }

  /** Nova partida: novo embaralhamento, placar zerado e relógio correndo. */
  start() {
    if (!this.fresh) this.deck.newCycle();
    this.fresh = false;
    this._reset();
    this.clock.start();
  }

  /** Sorteia a próxima vogal (ou null se a partida acabou). */
  nextRound() {
    if (this.phase !== PHASE.IDLE) return null;
    if (this.results.length >= this.rounds) {
      this._finish();
      return null;
    }
    const letter = this.deck.draw();
    const { min, max } = this.config.animals;
    this.round = {
      number: this.results.length + 1,
      letter,
      vowel: this.vowels.get(letter),
      animals: min + Math.floor(this.random() * (max - min + 1)),
      scanned: false,
      scanSkipped: false,
      wrongCards: 0,
      signAttempts: 0,
      sign: null,
      countAttempts: 0,
      count: null,
    };
    this.signTimer.reset();
    this.countTimer.reset();
    this.phase = PHASE.SCAN;
    return this.round;
  }

  /* ------------------------------------------------ 📷 carta */

  /** Uma carta foi reconhecida (`letter` = vogal da carta, ou null se não é de vogal). */
  cardSeen(letter) {
    if (this.phase !== PHASE.SCAN) return { type: 'ignored' };
    if (letter !== this.round.letter) {
      this.round.wrongCards += 1;
      return { type: 'wrong', letter: letter ?? null };
    }
    this.round.scanned = true;
    this.phase = PHASE.SIGN;
    return { type: 'ok' };
  }

  /** Fazer o sinal sem escanear (ex.: a carta sumiu). */
  skipScan() {
    if (this.phase !== PHASE.SCAN) return false;
    this.round.scanSkipped = true;
    this.phase = PHASE.SIGN;
    return true;
  }

  /* ------------------------------------------------ ✋ sinal */

  /** Começa o Tempo 1 (quando aparece "✋ Faça o sinal"). */
  startSign() {
    if (this.phase !== PHASE.SIGN || this.signTimer.running || this.signTimer.elapsed > 0) return;
    this.signTimer.start();
  }

  /** O MediaPipe viu outro sinal: o tempo continua correndo. */
  signWrong() {
    if (this.phase !== PHASE.SIGN) return false;
    this.round.signAttempts += 1;
    this.stats.wrongSigns += 1;
    return true;
  }

  /** O MediaPipe reconheceu o sinal pedido. */
  signCorrect() {
    if (this.phase !== PHASE.SIGN) return null;
    this.startSign();
    this.signTimer.pause();
    const seconds = this.signTimer.elapsed;
    this.round.sign = { seconds, ...stepPoints(seconds, this.config.scoring.sign), skipped: false };
    this.stats.score += this.round.sign.total;
    this.stats.signsCorrect += 1;
    this._success();
    this.phase = PHASE.ANIMALS;
    return { ...this.round.sign, score: this.stats.score };
  }

  /** Pular o sinal: sem pontos do sinal, mas a rodada continua (contagem). */
  skipSign() {
    if (this.phase !== PHASE.SIGN) return null;
    this.signTimer.pause();
    this.round.sign = { seconds: this.signTimer.elapsed, base: 0, bonus: 0, total: 0, skipped: true };
    this.stats.signsSkipped += 1;
    this._fail();
    this.phase = PHASE.ANIMALS;
    return this.round.sign;
  }

  /* ------------------------------------------------ 🔢 contagem */

  /** Os animais terminaram de aparecer: começa o Tempo 2. */
  startCount() {
    if (this.phase !== PHASE.ANIMALS) return false;
    this.countTimer.start();
    this.phase = PHASE.COUNT;
    return true;
  }

  /** Resposta do jogador (1, 2, 3...). Errar não encerra a rodada. */
  answer(n) {
    if (this.phase !== PHASE.COUNT) return { type: 'ignored' };
    const round = this.round;
    if (n !== round.animals) {
      round.countAttempts += 1;
      this.stats.countsWrong += 1;
      if (round.countAttempts === 1) this._fail();
      return { type: 'wrong', attempts: round.countAttempts };
    }
    this.countTimer.pause();
    const seconds = this.countTimer.elapsed;
    const firstTry = round.countAttempts === 0;
    round.count = { seconds, ...stepPoints(seconds, this.config.scoring.count), firstTry };
    this.stats.score += round.count.total;
    if (firstTry) {
      this.stats.countsCorrect += 1;
      this._success();
    }
    this.phase = PHASE.DONE;
    return { type: 'correct', ...round.count, score: this.stats.score };
  }

  /** Fecha a rodada; devolve { finished } (true depois da última). */
  finishRound() {
    if (this.phase !== PHASE.DONE) return null;
    const r = this.round;
    this.results.push({
      number: r.number,
      letter: r.letter,
      animals: r.animals,
      scanned: r.scanned,
      sign: r.sign,
      signAttempts: r.signAttempts,
      count: r.count,
      countAttempts: r.countAttempts,
      points: (r.sign?.total || 0) + (r.count?.total || 0),
    });
    if (this.results.length >= this.rounds) {
      this._finish();
      return { finished: true };
    }
    this.phase = PHASE.IDLE;
    return { finished: false };
  }

  get finished() {
    return this.phase === PHASE.FINISHED;
  }

  /* ------------------------------------------------ sequência de acertos */
  _success() {
    this.stats.streak += 1;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
  }

  _fail() {
    this.stats.streak = 0;
  }

  _finish() {
    this.clock.pause();
    this.signTimer.pause();
    this.countTimer.pause();
    this.phase = PHASE.FINISHED;
  }

  /* ------------------------------------------------ pausa (app em segundo plano) */
  pause() {
    if (this._paused) return;
    this._paused = [this.clock, this.signTimer, this.countTimer].filter((t) => t.running);
    this._paused.forEach((t) => t.pause());
  }

  resume() {
    if (!this._paused) return;
    this._paused.forEach((t) => t.resume());
    this._paused = null;
  }

  /* ------------------------------------------------ resultado */
  get maxScore() {
    return maxRoundScore(this.config.scoring) * this.rounds;
  }

  summary() {
    const s = this.stats;
    const maxScore = this.maxScore;
    return {
      score: s.score,
      maxScore,
      seconds: this.clock.elapsed,
      rounds: this.rounds,
      played: this.results.length,
      signsCorrect: s.signsCorrect,
      signsSkipped: s.signsSkipped,
      countsCorrect: s.countsCorrect,
      bestStreak: s.bestStreak,
      rank: rankFor(s.score, maxScore, this.config.ranks),
      results: this.results.slice(),
    };
  }
}
