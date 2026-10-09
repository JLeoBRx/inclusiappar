/**
 * ✋ SINALIZE E CONTE — a tela do jogo (Jogo 3 da Sala de Jogos).
 *
 *   🃏 carta sorteada → 📷 escanear a carta (MindAR) → ✋ fazer o sinal
 *   (MediaPipe) → 🐾 aparecem 1, 2 ou 3 animais (3D) → 🔢 contar → ⭐ pontos
 *   … 5 rodadas → 🏆 resultado e recordes
 *
 * Reaproveita, sem mudar nada neles:
 *   - ARSession (câmera + MindAR + Three.js) com os MESMOS alvos e o MESMO
 *     Controller do Jogo de Cartas (id 'game'): nada é baixado ou compilado
 *     duas vezes;
 *   - buildCardList() do Jogo de Cartas (alvo reconhecido → número da carta);
 *   - Deck, Stopwatch e timeBonus do Jogo de Cartas (via signState.js);
 *   - modelos 3D dos animais (AnimalModel), sons, confete e avisos do app.
 *
 * Escanear a carta só diz QUAL sinal fazer: os pontos do sinal vêm apenas
 * quando o MediaPipe vê a mão fazendo o sinal certo (signJudge.js).
 */
import { AR, GAME } from '../config.js';
import { ARSession } from '../ar/arSession.js';
import { loadTargets } from '../ar/targets.js';
import { buildCardList } from '../game/cardGame.js';
import { formatClock, formatSeconds } from '../game/timer.js';
import { timeBonus } from '../game/scoring.js';
import { announce, clearErrors, clearToasts, showARError } from '../ui/notifications.js';
import { storage } from '../ui/storage.js';
import { isSoundOn, setSound, sfx, unlockAudio } from '../ui/sound.js';
import { confetti } from '../ui/effects.js';
import { SIGN_GAME, countQuestion, vowelByCard } from './signConfig.js';
import { PHASE, SignMatch } from './signState.js';
import { SignJudge } from './signJudge.js';
import { HAND_BONES, HandTracker } from './handTracker.js';
import { AnimalParade } from './signAnimals.js';
import { applyMatch, formatDuration, loadRecords, saveRecords } from './signRecords.js';
import { animalOf, cardThumb, recordsHtml } from './signIntro.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cardFile = (card) => `cartas/carta${card}.png`;
const T = SIGN_GAME.timing;

export class SignGame {
  constructor(screen) {
    this.screen = screen;
    const q = (s) => screen.querySelector(s);
    this.stageEl = q('[data-ar-stage]');
    this.ui = q('.ar-ui');
    this.el = {
      hands: q('[data-hands]'),
      sound: q('[data-action="sound"]'),
      cardSlot: q('[data-card-slot]'),
      cardImg: q('[data-card-img]'),
      cardLetter: q('[data-card-letter]'),
      round: q('[data-round]'),
      rounds: q('[data-rounds]'),
      score: q('[data-score]'),
      clock: q('[data-clock]'),
      steps: [...screen.querySelectorAll('[data-step]')],
      scanTitle: q('[data-scan-title]'),
      scanHint: q('[data-scan-hint]'),
      signTitle: q('[data-sign-title]'),
      signCard: q('[data-sign-card]'),
      signStatus: q('[data-sign-status]'),
      signError: q('[data-sign-error]'),
      meter: q('[data-meter]'),
      signClock: q('[data-sign-clock]'),
      signBonus: q('[data-sign-bonus]'),
      watchText: q('[data-watch-text]'),
      question: q('[data-question]'),
      answers: q('[data-answers]'),
      fallback: q('[data-fallback-animals]'),
      countClock: q('[data-count-clock]'),
      countBonus: q('[data-count-bonus]'),
      skipScan: q('[data-action="skip-scan"]'),
      skipSign: q('[data-action="skip-sign"]'),
      flash: q('[data-flash]'),
      reveal: q('[data-reveal]'),
      revealImg: q('[data-reveal-img]'),
      revealLetter: q('[data-reveal-letter]'),
      revealName: q('[data-reveal-name]'),
      revealText: q('[data-reveal-text]'),
      feedback: q('[data-feedback]'),
      summary: q('[data-summary]'),
      status: q('[data-status]'),
      statusText: q('[data-status-text]'),
      statusBar: q('[data-status-bar]'),
    };
    this.el.rounds.textContent = SIGN_GAME.rounds;

    // botões de resposta: de animals.min até animals.max (1 | 2 | 3)
    const { min, max } = SIGN_GAME.animals;
    this.el.answers.replaceChildren(...Array.from({ length: max - min + 1 }, (_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const n = min + i;
      b.className = 'sg-answer';
      b.dataset.answer = String(n);
      b.setAttribute('aria-label', String(n));
      b.innerHTML = `<span class="sg-answer__n">${n}</span><span class="sg-answer__dots" aria-hidden="true">${'●'.repeat(n)}</span>`;
      b.addEventListener('click', () => this.answer(n));
      return b;
    }));

    this.el.sound.addEventListener('click', () => {
      setSound(!isSoundOn());
      this._renderSound();
      if (isSoundOn()) sfx.tick();
    });
    this.el.skipScan.addEventListener('click', () => this.skipScan());
    this.el.skipSign.addEventListener('click', () => this.skipSign());
    q('[data-action="retry-hands"]').addEventListener('click', () => this._startSign());
    q('[data-action="replay"]').addEventListener('click', () => this.newMatch());
    this.el.reveal.addEventListener('click', () => this._skipWait?.());

    this.tracker = new HandTracker();
    this.ctx = this.el.hands.getContext('2d');
    this._timers = new Set();
  }

  /* ------------------------------------------------ ciclo de vida */
  async enter() {
    this.active = true;
    this.token = {};
    const token = this.token;
    unlockAudio();
    this._renderSound();
    this._reset();
    this.records = loadRecords(storage);
    this.match = new SignMatch(SIGN_GAME);
    this._renderHud();
    this._setStatus('loading');
    // o reconhecimento de mãos baixa junto com a câmera
    this.tracker.load().catch(() => {});

    const session = new ARSession({ container: this.stageEl, targets: GAME.targets, id: 'game', tuning: AR.game });
    this.session = session;
    session.onStatus = (step, p) => this._setStatus(step, p);
    session.onFrame = (dt) => this._frame(dt);
    session.onResize = () => this._resize();
    session.onSuspend = () => this.match?.pause();
    session.onResume = () => this.match?.resume();
    session.onCameraEnded = () => showARError({ code: 'ended' }, { onRetry: () => this.restart(), screen: this.screen });
    this.el.status.hidden = false;
    try {
      await session.start();
    } catch (err) {
      if (!this._alive(token)) return;
      this.el.status.hidden = true;
      await session.stop();
      showARError(err, { onRetry: () => this.restart(), screen: this.screen });
      return;
    }
    if (!this._alive(token)) return;
    this.el.status.hidden = true;

    const { manifest } = await loadTargets(GAME.targets);
    if (!this._alive(token)) return;
    this.cards = buildCardList(manifest, session.targetCount);
    this.byIndex = new Map(this.cards.map((c) => [c.index, c]));
    session.onTargetFound = (index) => this._found(index);
    this.parade = new AnimalParade(session);
    this._resize();
    await this.newMatch();
  }

  async restart() {
    await this.leave();
    if (!this.screen.hidden) await this.enter();
  }

  async leave() {
    this.active = false;
    this.token = {};
    this._clearTimers();
    this._skipWait = null;
    this.judge = null;
    this.parade?.dispose();
    this.parade = null;
    this._clearHands();
    const session = this.session;
    this.session = null;
    if (session) {
      session.onTargetFound = session.onTargetLost = null;
      await session.stop();
    }
    this.el.status.hidden = true;
    clearErrors(this.screen);
  }

  _alive(token) {
    return this.active && token === this.token;
  }

  _reset() {
    this._clearTimers();
    this._showStep(null);
    this.el.reveal.hidden = true;
    this.el.feedback.hidden = true;
    this.el.summary.hidden = true;
    this.el.flash.hidden = true;
    this.el.skipScan.hidden = true;
    this.el.skipSign.hidden = true;
    this.el.cardSlot.classList.remove('has-card');
  }

  /* ------------------------------------------------ partida e rodadas */
  async newMatch() {
    if (!this.session) return;
    this._reset();
    clearToasts();
    this.match.start();
    this._renderHud();
    await this.nextRound();
  }

  async nextRound() {
    const token = this.token;
    this._clearTimers();
    this.parade?.clear();
    // o MindAR só procura cartas na etapa "📷 Escaneie" (não durante o sorteio)
    await this.session?.pauseTracking();
    if (!this._alive(token)) return;
    const round = this.match.nextRound();
    if (!round) {
      this._finish();
      return;
    }
    this._showStep(null);
    this.el.skipScan.hidden = true;
    this.el.skipSign.hidden = true;
    this.el.cardSlot.classList.remove('has-card');
    this._renderHud();
    if (!(await this._reveal(round)) || !this._alive(token)) return;
    this._startScan();
  }

  /** "Roleta" de embaralhar e a carta sorteada em destaque (toque para pular). */
  async _reveal(round) {
    const token = this.token;
    const r = this.el.reveal;
    const file = cardFile(round.vowel.card);
    const preload = new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = file;
      setTimeout(resolve, 4000);
    });
    r.hidden = false;
    r.dataset.phase = 'shuffle';
    this.el.revealName.textContent = `Rodada ${round.number} de ${SIGN_GAME.rounds}`;
    this.el.revealText.textContent = 'Sorteando a carta...';
    let elapsed = 0;
    let interval = 50;
    while (elapsed < T.shuffleMs) {
      r.style.setProperty('--shuffle-step', String(Math.random()));
      r.classList.toggle('tick');
      sfx.tick();
      await sleep(interval);
      if (!this._alive(token)) return false;
      elapsed += interval;
      interval += 12;
    }
    await preload;
    if (!this._alive(token)) return false;
    this.el.revealImg.src = file;
    this.el.revealImg.alt = `Carta da letra ${round.letter} em LIBRAS`;
    this.el.revealLetter.textContent = round.letter;
    this.el.revealName.textContent = `Vogal ${round.letter}`;
    this.el.revealText.textContent = `Encontre a carta ${round.letter}!`;
    r.dataset.phase = 'reveal';
    sfx.reveal();
    announce(`Rodada ${round.number}. Carta sorteada: letra ${round.letter}. Encontre a carta e escaneie.`);
    this._showCard(round);
    await Promise.race([sleep(T.revealMs), new Promise((resolve) => { this._skipWait = resolve; })]);
    this._skipWait = null;
    if (!this._alive(token)) return false;
    r.dataset.phase = 'fly';
    await sleep(350);
    if (!this._alive(token)) return false;
    r.hidden = true;
    r.dataset.phase = '';
    return true;
  }

  /* ------------------------------------------------ 📷 escanear a carta */
  _startScan() {
    if (this.match.phase !== PHASE.SCAN) return;
    const round = this.match.round;
    this._showStep('scan');
    this.el.scanTitle.textContent = `📷 Escaneie a carta ${round.letter}`;
    this.el.scanHint.textContent = 'Aponte a câmera para a carta';
    this.el.scanHint.classList.remove('is-warn');
    this.session.resumeTracking();
    this._later(T.skipScanAfter * 1000, () => {
      if (this.match.phase === PHASE.SCAN) this.el.skipScan.hidden = false;
    });
    // a carta pode já estar na frente da câmera
    this.session.visibleTargets.forEach((i) => this._found(i));
  }

  _found(index) {
    if (this.match?.phase !== PHASE.SCAN || this.step !== 'scan') return;
    const card = this.byIndex?.get(index);
    if (!card) return;
    const vowel = vowelByCard(card.id);
    const result = this.match.cardSeen(vowel?.letter ?? null);
    if (result.type === 'ok') this._cardOk();
    else if (result.type === 'wrong') this._cardWrong(vowel);
  }

  _cardWrong(vowel) {
    const target = this.match.round.letter;
    const now = performance.now();
    const text = vowel
      ? `Essa é a carta ${vowel.letter}. Procure a carta ${target}!`
      : `Essa carta não é uma vogal em LIBRAS. Procure a carta ${target}!`;
    if (this._lastWrongCard?.text === text && now - this._lastWrongCard.at < 2500) return;
    this._lastWrongCard = { text, at: now };
    sfx.skip();
    this.el.scanHint.textContent = text;
    this.el.scanHint.classList.add('is-warn');
    announce(text);
  }

  _cardOk() {
    const round = this.match.round;
    this.el.skipScan.hidden = true;
    sfx.reveal();
    this._flash(`✅ Carta ${round.letter} encontrada!`, 'ok', 1400);
    this._startSign();
  }

  skipScan() {
    if (!this.match?.skipScan()) return;
    this.el.skipScan.hidden = true;
    sfx.skip();
    this._startSign();
  }

  /* ------------------------------------------------ ✋ fazer o sinal */
  async _startSign() {
    const token = this.token;
    const round = this.match.round;
    if (this.match.phase !== PHASE.SIGN) return;
    this._signLocked = false;
    this.judge = null;
    this._showStep('sign');
    this.el.signTitle.textContent = `Faça o sinal de ${round.letter}`;
    this.el.signCard.src = cardThumb(round.vowel.card);
    this.el.signCard.alt = `Sinal da letra ${round.letter} em LIBRAS`;
    this.el.signError.hidden = true;
    this._meter(0);
    this._signStatus('✋ Coloque a mão na frente da câmera', 'idle');
    // o desenho da carta nunca vale como sinal: a avaliação só começa depois
    // que a carta sai da frente da câmera (a mão na frente dela já basta)
    if (this.session?.visibleTargets.length) {
      this._signStatus('🃏 Tire a carta da frente da câmera e mostre a sua mão ✋', 'hint');
      announce('Agora tire a carta da frente da câmera e faça o sinal com a mão.');
      while (this.session?.visibleTargets.length) {
        await sleep(150);
        if (!this._alive(token) || this.match.phase !== PHASE.SIGN) return;
      }
      this._signStatus('✋ Coloque a mão na frente da câmera', 'idle');
    }
    // durante o sinal, o MindAR descansa: só a mão importa
    await this.session?.pauseTracking();
    if (!this._alive(token) || this.match.phase !== PHASE.SIGN) return;
    if (!this.tracker.ready) {
      this._signStatus('⏳ Preparando o reconhecimento de mãos...', 'loading');
      try {
        await this.tracker.load((p) => {
          if (this._alive(token)) this._signStatus(`⏳ Preparando o reconhecimento de mãos... ${Math.round(p * 100)}%`, 'loading');
        });
      } catch (err) {
        console.error('[mãos]', err);
        if (!this._alive(token)) return;
        this._signStatus('📶 Não foi possível carregar o reconhecimento de mãos.', 'error');
        this.el.signError.hidden = false;
        this.el.skipSign.hidden = false;
        return;
      }
      if (!this._alive(token) || this.match.phase !== PHASE.SIGN) return;
    }
    this.judge = new SignJudge(round.letter, SIGN_GAME.recognition);
    this.match.startSign(); // Tempo 1 começa aqui
    this._signStatus('✋ Coloque a mão na frente da câmera', 'idle');
    announce(`Faça o sinal da letra ${round.letter} em LIBRAS, com a mão na frente da câmera.`);
    this._later(T.skipSignAfter * 1000, () => {
      if (this.match.phase === PHASE.SIGN) this.el.skipSign.hidden = false;
    });
  }

  _onHands(hands, now) {
    const verdict = this.judge.update(hands, now);
    this._drawHands(hands, verdict);
    this._meter(verdict.state === 'match' ? verdict.progress : 0);
    const [text, state] = this._hint(hands, verdict);
    this._signStatus(text, state);
    if (verdict.event === 'correct') this._signCorrect();
    else if (verdict.event === 'wrong') this._signWrong();
  }

  /** Dica para a criança, conforme o que a câmera está vendo. */
  _hint(hands, verdict) {
    const letter = this.match.round.letter;
    if (!hands.length) return ['✋ Coloque a mão na frente da câmera', 'idle'];
    const hand = hands.reduce((a, b) => ((b.scores[letter] ?? 0) > (a.scores[letter] ?? 0) ? b : a));
    const xs = hand.points.map((p) => p.x);
    const ys = hand.points.map((p) => p.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (verdict.state === 'match') return ['👍 Isso! Segure o sinal...', 'match'];
    if (Math.min(...xs) < 0.01 || Math.max(...xs) > 0.99 || Math.min(...ys) < 0.01 || Math.max(...ys) > 0.99) {
      return ['🖐️ Mostre a mão inteira na câmera', 'hint'];
    }
    if (size < 0.18) return ['🔍 Aproxime a mão da câmera', 'hint'];
    if (verdict.state === 'other') return [`🤔 Esse não é o ${letter}. Confira o desenho da carta!`, 'other'];
    return [`✋ Faça o sinal de ${letter} igual ao da carta`, 'hint'];
  }

  async _signCorrect() {
    if (this._signLocked) return;
    this._signLocked = true;
    const token = this.token;
    const r = this.match.signCorrect();
    if (!r) return;
    const letter = this.match.round.letter;
    this._clearHands();
    this.el.skipSign.hidden = true;
    this._meter(1);
    sfx.correct();
    confetti(this.screen, 26);
    this._feedback('hit', `
      <div class="feedback__icon">✅</div>
      <div class="feedback__title">SINAL CORRETO!</div>
      <div class="feedback__text">Você fez o <strong>${letter}</strong> em LIBRAS em ${formatSeconds(r.seconds)}.</div>
      <div class="feedback__points"><span>+${r.base} pontos</span><span class="bonus">+${r.bonus} rapidez</span></div>`, T.celebrateMs);
    announce(`Sinal correto! Mais ${r.total} pontos.`);
    this._renderHud(true);
    await sleep(T.celebrateMs);
    if (!this._alive(token)) return;
    this._showAnimals();
  }

  _signWrong() {
    if (!this.match.signWrong()) return;
    sfx.wrong();
    this._flash(`❌ Sinal incorreto. Tente novamente! Faça o ${this.match.round.letter} igual ao da carta.`, 'wrong', 2200);
    announce('Sinal incorreto. Tente novamente.');
  }

  skipSign() {
    if (this.match?.phase !== PHASE.SIGN) return;
    this._signLocked = true;
    this.match.skipSign();
    this.judge = null;
    this._clearHands();
    this.session?.pauseTracking();
    this.el.skipSign.hidden = true;
    sfx.skip();
    this._flash('⏭️ Sinal pulado (sem pontos do sinal). Vamos contar os animais!', 'info', 2200);
    this._showAnimals();
  }

  /* ------------------------------------------------ 🐾 animais e 🔢 contagem */
  async _showAnimals() {
    const token = this.token;
    const round = this.match.round;
    const animal = animalOf(round.vowel);
    this._showStep('watch');
    this.el.watchText.textContent = '👀 Olhe com atenção!';
    this.el.fallback.hidden = true;
    let shown = false;
    try {
      shown = await this.parade.show(animal, round.animals, { gapMs: T.animalGapMs });
    } catch (err) {
      console.error('[animais]', err);
      if (!this._alive(token)) return;
      // sem o modelo 3D (sem internet?): os animais aparecem como figurinhas
      this.el.fallback.textContent = Array.from({ length: round.animals }, () => animal.emoji).join(' ');
      this.el.fallback.hidden = false;
      shown = true;
    }
    if (!shown || !this._alive(token)) return;
    this.match.startCount(); // Tempo 2 começa quando todos apareceram
    this._showStep('count');
    this.el.question.textContent = countQuestion(round.vowel);
    this.el.answers.querySelectorAll('button').forEach((b) => {
      b.disabled = false;
      b.classList.remove('is-right', 'is-wrong');
    });
    announce(countQuestion(round.vowel));
  }

  async answer(n) {
    if (this.match?.phase !== PHASE.COUNT) return;
    const token = this.token;
    const button = this.el.answers.querySelector(`[data-answer="${n}"]`);
    const r = this.match.answer(n);
    if (r.type === 'wrong') {
      sfx.wrong();
      button?.classList.remove('is-wrong');
      void button?.offsetWidth;
      button?.classList.add('is-wrong');
      this._flash('🤏 Quase! Vamos contar novamente.', 'warn', 2200);
      this.parade?.hopAll();
      announce('Quase! Vamos contar novamente.');
      return;
    }
    if (r.type !== 'correct') return;
    this.el.answers.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    button?.classList.add('is-right');
    sfx.correct();
    confetti(this.screen, 30);
    this.parade?.hopAll();
    const round = this.match.round;
    this._feedback('hit', `
      <div class="feedback__icon">🎉</div>
      <div class="feedback__title">MUITO BEM!</div>
      <div class="feedback__text">${round.animals === 1
        ? `Era <strong>1</strong> ${animalOf(round.vowel).name.toLowerCase()}!`
        : `Eram <strong>${round.animals}</strong> ${round.vowel.plural}!`}</div>
      <div class="feedback__points"><span>+${r.base} pontos</span>${r.bonus ? `<span class="bonus">+${r.bonus} rapidez</span>` : ''}</div>`, T.nextRoundMs);
    announce(`Muito bem! Mais ${r.total} pontos. Total: ${r.score}.`);
    this._renderHud(true);
    await sleep(T.nextRoundMs);
    if (!this._alive(token)) return;
    this.el.feedback.hidden = true;
    const end = this.match.finishRound();
    if (end?.finished) this._finish();
    else this.nextRound();
  }

  /* ------------------------------------------------ 🏆 resultado */
  _finish() {
    this._clearTimers();
    this._showStep(null);
    this.parade?.clear();
    this.session?.pauseTracking();
    clearToasts();
    const s = this.match.summary();
    const { records, improved } = applyMatch(this.records, s);
    saveRecords(storage, records);
    this.records = records;
    const box = this.el.summary;
    const set = (key, value) => { box.querySelector(`[data-sum="${key}"]`).textContent = value; };
    set('score', s.score);
    set('time', formatDuration(s.seconds));
    set('signs', `${s.signsCorrect}/${s.rounds}`);
    set('counts', `${s.countsCorrect}/${s.rounds}`);
    set('streak', `${s.bestStreak} acerto${s.bestStreak === 1 ? '' : 's'}`);
    box.querySelector('[data-sum-medal]').textContent = s.rank.medal;
    box.querySelector('[data-sum-rank]').textContent = s.rank.title;
    box.querySelector('[data-sum-rounds]').innerHTML = s.results.map((r) => `
      <li aria-label="Vogal ${r.letter}: sinal ${r.sign?.skipped ? 'pulado' : 'correto'}, contagem ${r.count?.firstTry ? 'certa de primeira' : 'certa depois de tentar de novo'}, ${r.points} pontos">
        <b>${r.letter}</b><span>✋${r.sign?.skipped ? '⏭️' : '✅'}</span><span>🔢${r.count?.firstTry ? '✅' : '🔁'}</span><small>+${r.points}</small></li>`).join('');
    box.querySelector('[data-sum-records]').innerHTML = recordsHtml(records, improved);
    box.querySelector('[data-sum-new-record]').hidden = !improved.score;
    box.hidden = false;
    sfx.fanfare();
    confetti(this.screen, 60);
    announce(`Partida concluída! ${s.score} pontos em ${formatDuration(s.seconds)}. ${s.rank.title}`);
    box.querySelector('[data-action="replay"]').focus();
  }

  /* ------------------------------------------------ quadro a quadro */
  _frame(dt) {
    this.parade?.update(dt);
    const match = this.match;
    if (!match) return;
    const now = performance.now();
    if (match.phase === PHASE.SIGN && this.judge && !this._signLocked && this.tracker.ready) {
      const hands = this.tracker.detect(this.session?.video, now);
      if (hands) this._onHands(hands, now);
    }
    if (now - (this._lastClock || 0) > 100) {
      this._lastClock = now;
      this._renderClocks();
    }
  }

  _renderClocks() {
    const m = this.match;
    this.el.clock.textContent = formatClock(m.clock.elapsed);
    const chip = (el, bonusEl, timer, speed) => {
      const t = timer.elapsed;
      el.textContent = formatSeconds(t);
      const bonus = timeBonus(t, speed);
      bonusEl.textContent = bonus ? `+${bonus} rapidez` : 'sem bônus';
      bonusEl.classList.toggle('is-zero', !bonus);
    };
    if (m.phase === PHASE.SIGN && this.judge) chip(this.el.signClock, this.el.signBonus, m.signTimer, SIGN_GAME.scoring.sign.speed);
    if (m.phase === PHASE.COUNT) chip(this.el.countClock, this.el.countBonus, m.countTimer, SIGN_GAME.scoring.count.speed);
  }

  /* ------------------------------------------------ mão desenhada na tela */
  _resize() {
    const canvas = this.el.hands;
    const rect = this.stageEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this._dpr = dpr;
    this.parade?.layout();
  }

  _drawHands(hands, verdict) {
    const video = this.session?.video;
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    ctx.clearRect(0, 0, this.el.hands.width, this.el.hands.height);
    if (!video || !hands.length) return;
    // o vídeo cobre a tela (como object-fit: cover): mesma conta da ARSession
    const left = parseFloat(video.style.left) || 0;
    const top = parseFloat(video.style.top) || 0;
    const w = parseFloat(video.style.width) || this.el.hands.width / dpr;
    const h = parseFloat(video.style.height) || this.el.hands.height / dpr;
    const color = verdict.state === 'match' ? '#3ddc84' : verdict.state === 'other' ? '#ff9f6b' : '#ffd979';
    for (const hand of hands) {
      const P = hand.points.map((p) => [(left + p.x * w) * dpr, (top + p.y * h) * dpr]);
      ctx.lineCap = 'round';
      ctx.lineWidth = 5 * dpr;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(P[a][0], P[a][1]);
        ctx.lineTo(P[b][0], P[b][1]);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      for (const [x, y] of P) {
        ctx.beginPath();
        ctx.arc(x, y, 5.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _clearHands() {
    this.ctx?.clearRect(0, 0, this.el.hands.width, this.el.hands.height);
  }

  /* ------------------------------------------------ interface */
  _showStep(name) {
    this.step = name;
    this.el.steps.forEach((s) => { s.hidden = s.dataset.step !== name; });
    if (name !== 'sign') this._clearHands();
  }

  _showCard(round) {
    this.el.cardImg.src = cardFile(round.vowel.card);
    this.el.cardImg.alt = `Carta sorteada: letra ${round.letter} em LIBRAS`;
    this.el.cardLetter.textContent = round.letter;
    this.el.cardSlot.classList.add('has-card');
  }

  _renderHud(bump = false) {
    const m = this.match;
    const set = (el, value) => {
      const text = String(value);
      if (el.textContent === text) return;
      el.textContent = text;
      if (bump) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    };
    set(this.el.round, m.round?.number || 1);
    set(this.el.score, m.stats.score);
    this.el.clock.textContent = formatClock(m.clock.elapsed);
  }

  _signStatus(text, state) {
    if (this.el.signStatus.textContent !== text) this.el.signStatus.textContent = text;
    this.el.signStatus.dataset.state = state;
  }

  _meter(progress) {
    this.el.meter.style.setProperty('--progress', String(Math.max(0, Math.min(1, progress))));
    this.el.meter.classList.toggle('is-full', progress >= 1);
  }

  /** Mensagem curta que não cobre a mão nem os animais. */
  _flash(text, kind = 'info', duration = 1800) {
    const el = this.el.flash;
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = false;
    el.classList.remove('is-in');
    void el.offsetWidth;
    el.classList.add('is-in');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { el.hidden = true; }, duration);
  }

  _feedback(kind, html, duration = 0) {
    const box = this.el.feedback;
    box.className = `feedback feedback--${kind}`;
    box.innerHTML = html;
    box.hidden = false;
    clearTimeout(this._feedbackTimer);
    if (duration) this._feedbackTimer = setTimeout(() => { box.hidden = true; }, duration);
  }

  _renderSound() {
    const on = isSoundOn();
    this.el.sound.textContent = on ? '🔊' : '🔇';
    this.el.sound.setAttribute('aria-pressed', String(on));
    this.el.sound.setAttribute('aria-label', on ? 'Desligar sons' : 'Ligar sons');
  }

  _setStatus(step, progress) {
    const text = {
      loading: 'Preparando o jogo...',
      camera: '📷 Abrindo a câmera... Se o navegador perguntar, toque em “Permitir”.',
      targets: 'Carregando as cartas...',
      preparing: 'Quase pronto...',
    }[step];
    if (text) this.el.statusText.textContent = text;
    if (step === 'targets' && typeof progress === 'number') {
      this.el.statusBar.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
    }
  }

  _later(ms, fn) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      if (this.active) fn();
    }, ms);
    this._timers.add(id);
  }

  _clearTimers() {
    this._timers.forEach((id) => clearTimeout(id));
    this._timers.clear();
    clearTimeout(this._flashTimer);
    clearTimeout(this._feedbackTimer);
  }
}
