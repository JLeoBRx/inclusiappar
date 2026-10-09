/**
 * JOGO DE CARTAS
 *
 *   carta sorteada → procurar → escanear → ✓ acerto (+pontos +bônus de tempo)
 *                                        → ✗ erro (−pontos, a carta continua)
 *   ⏭️ Pular → próxima carta (a pulada só volta no próximo ciclo)
 *   baralho esgotado → 🎉 CICLO COMPLETO → 🔄 novo baralho
 *
 * Reproduz o ARCombinationGameManager.cs: embaralhamento com "roleta"
 * (ShuffleAndGenerate), espera entre missões (delayNextMission), retorno
 * visual na própria carta (objetos "correto"/"incorreto" da Aia) e sons de
 * acerto/erro. A lógica de regras fica em gameState.js (testada em Node).
 */
import * as THREE from '../lib/three.js';
import { AR, GAME } from '../config.js';
import { ARSession } from '../ar/arSession.js';
import { loadTargets } from '../ar/targets.js';
import { CardGameEngine, PHASE } from './gameState.js';
import { formatClock, formatSeconds } from './timer.js';
import { timeBonus } from './scoring.js';
import { showARError, toast, announce, clearToasts } from '../ui/notifications.js';
import { storage } from '../ui/storage.js';
import { isSoundOn, setSound, sfx, unlockAudio } from '../ui/sound.js';
import { confetti } from '../ui/effects.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const SAVE_KEY = 'game';
const RECORD_KEY = 'gameRecord';

/** Lista de cartas a partir do manifesto (cartas.json) ou da contagem do .mind. */
export function buildCardList(manifest, count) {
  const list = (manifest?.targets?.length ? manifest.targets : Array.from({ length: count }, (_, i) => ({
    index: i, file: `cartas/carta${i + 1}.png`,
  }))).slice(0, count || undefined);
  return list.map((t, index) => {
    const id = Number(/(\d+)\.\w+$/.exec(t.file)?.[1]) || index + 1;
    return { index, id, file: t.file, label: GAME.labels?.[id] || `Carta ${id}` };
  });
}

/** Há um jogo salvo para continuar? */
export function savedGameInfo() {
  const state = storage.get(SAVE_KEY, null);
  if (!state?.deck || state.phase === PHASE.CYCLE_COMPLETE) return null;
  const used = state.deck.position || 0;
  if (!used) return null;
  return { used, total: state.deck.order?.length || 0, score: state.stats?.score || 0 };
}

export function clearSavedGame() {
  storage.remove(SAVE_KEY);
}

/* ------------------------------------------------ retorno visual em AR */
const FRAME_FRAGMENT = /* glsl */`
uniform vec3 color;
uniform float aspect;
uniform float opacity;
uniform float time;
varying vec2 vUv;
float roundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, aspect);
  float d = roundRect(p, vec2(0.5, aspect * 0.5) - 0.035, 0.07);
  float line = 1.0 - smoothstep(0.012, 0.028, abs(d));
  float glow = (1.0 - smoothstep(0.0, 0.09, abs(d))) * (0.45 + 0.25 * sin(time * 7.0));
  float tint = step(d, 0.0) * 0.16;
  float a = max(max(line, glow), tint) * opacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
}`;

function badgeTexture(symbol, color) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${size * 0.56}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, size / 2, size / 2 + size * 0.03);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class CardFeedback {
  constructor(anchor, aspect, shared) {
    this.group = new THREE.Group();
    this.group.visible = false;
    anchor.add(this.group);
    this.aspect = aspect;
    this.frame = new THREE.Mesh(new THREE.PlaneGeometry(1.14, aspect + 0.14), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: FRAME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        color: { value: new THREE.Color() },
        aspect: { value: (aspect + 0.14) / 1.14 },
        opacity: { value: 1 },
        time: { value: 0 },
      },
    }));
    this.frame.position.z = 0.01;
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    this.badge.position.set(0.48, aspect / 2 + 0.02, 0.12);
    this.aia = new THREE.Sprite(new THREE.SpriteMaterial({ map: shared.aia, depthTest: false, transparent: true }));
    this.aia.center.set(0.5, 0);
    this.aia.position.set(0.95, -aspect / 2, 0.05);
    this.group.add(this.frame, this.badge, this.aia);
    this.shared = shared;
    this.t = 0;
  }

  show(kind) {
    const s = this.shared;
    this.kind = kind;
    this.t = 0;
    this.group.visible = true;
    const hit = kind === 'hit';
    this.frame.material.uniforms.color.value.set(hit ? 0x3ddc84 : kind === 'wrong' ? 0xff4d4d : 0xffffff);
    this.badge.visible = kind !== 'neutral';
    this.badge.material.map = hit ? s.check : s.cross;
    this.badge.material.needsUpdate = true;
    this.aia.visible = hit && !!s.aia.image;
  }

  hide() {
    this.group.visible = false;
    this.kind = null;
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const pop = Math.min(1, this.t / 0.35);
    const back = 1 + 2.7 * (pop - 1) ** 3 + 1.7 * (pop - 1) ** 2; // easeOutBack
    this.frame.material.uniforms.time.value = this.t;
    this.badge.scale.setScalar(0.38 * back);
    const ar = this.shared.aia.image ? this.shared.aia.image.height / this.shared.aia.image.width : 1.6;
    const h = this.aspect * 1.15 * back;
    this.aia.scale.set(h / ar, h, 1);
  }
}

/* ------------------------------------------------ experiência */
export class GameExperience {
  constructor(screen) {
    this.screen = screen;
    this.stageEl = screen.querySelector('[data-ar-stage]');
    this.ui = screen.querySelector('.ar-ui');
    const q = (s) => screen.querySelector(s);
    this.el = {
      targetSlot: q('[data-target-slot]'),
      targetImg: q('[data-target-img]'),
      targetName: q('[data-target-name]'),
      prompt: q('[data-prompt]'),
      clock: q('[data-clock]'),
      bonus: q('[data-bonus]'),
      stats: {
        score: q('[data-stat="score"]'),
        hits: q('[data-stat="hits"]'),
        errors: q('[data-stat="errors"]'),
        used: q('[data-stat="used"]'),
      },
      skip: q('[data-action="skip"]'),
      sound: q('[data-action="sound"]'),
      scan: q('[data-scan]'),
      reveal: q('[data-reveal]'),
      revealCard: q('[data-reveal-card]'),
      revealImg: q('[data-reveal-img]'),
      revealName: q('[data-reveal-name]'),
      revealText: q('[data-reveal-text]'),
      feedback: q('[data-feedback]'),
      summary: q('[data-summary]'),
      status: q('[data-status]'),
      statusText: q('[data-status-text]'),
      statusBar: q('[data-status-bar]'),
    };
    this.el.skip.addEventListener('click', () => this.skip());
    this.el.sound.addEventListener('click', () => {
      setSound(!isSoundOn());
      this._renderSound();
      if (isSoundOn()) sfx.tick();
    });
    q('[data-action="new-deck"]').addEventListener('click', () => this.newDeck());
    this.el.reveal.addEventListener('click', () => this._revealSkipWait?.());
  }

  /* ------------------------------------------------ ciclo de vida */
  async enter({ resume = false } = {}) {
    this.active = true;
    this.token = {};
    unlockAudio();
    this._renderSound();
    this.el.summary.hidden = true;
    this.el.feedback.hidden = true;
    this.el.reveal.hidden = true;
    this.el.skip.disabled = true;
    this._setPrompt('Preparando o baralho...');
    this._clearTarget();

    const session = new ARSession({ container: this.stageEl, targets: GAME.targets, id: 'game', tuning: AR.game });
    this.session = session;
    session.onStatus = (step, p) => this._status(step, p);
    session.onTargetFound = (i) => this._found(i);
    session.onTargetLost = (i) => this._lost(i);
    session.onFrame = (dt) => this._frame(dt);
    session.onSuspend = () => this.engine?.pause();
    session.onResume = () => this.engine?.resume();
    session.onCameraEnded = () => showARError({ code: 'ended' }, { onRetry: () => this.restart(), screen: this.screen });

    const token = this.token;
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
    if (manifest && manifest.count !== session.targetCount) {
      console.warn(`[jogo] cartas.json lista ${manifest.count} cartas, mas cartas.mind tem ${session.targetCount}. Recompile os alvos.`);
    }
    this.cards = buildCardList(manifest, session.targetCount);
    this.byIndex = new Map(this.cards.map((c) => [c.index, c]));
    this.byId = new Map(this.cards.map((c) => [c.id, c]));

    const saved = resume ? storage.get(SAVE_KEY, null) : null;
    this.engine = new CardGameEngine({
      cards: this.cards.map((c) => c.id), scoring: GAME.scoring, wrongScan: GAME.wrongScan, state: saved,
    });
    if (!saved) clearSavedGame();
    this.recordAtStart = storage.get(RECORD_KEY, 0);

    this._setupFeedback();
    this._renderStats();
    this._activity();

    if (this.engine.phase === PHASE.SEARCHING) {
      // continuar procurando a mesma carta
      await this._preload(this.byId.get(this.engine.current));
      if (!this._alive(token)) return;
      this._showTarget(this.engine.current);
      this._startSearching();
      toast('▶️ Jogo retomado de onde parou!', { type: 'success' });
    } else if (this.engine.phase === PHASE.CYCLE_COMPLETE) {
      this._showSummary();
    } else {
      await this.nextMission();
    }
  }

  async restart() {
    await this.leave();
    if (!this.screen.hidden) await this.enter({ resume: true });
  }

  async leave() {
    this.active = false;
    this.token = {};
    clearTimeout(this._idleTimer);
    this._save();
    if (this.session) {
      this.session.onTargetFound = this.session.onTargetLost = null;
      await this.session.stop();
    }
    this.session = null;
    this.feedbacks = null;
    this.el.status.hidden = true;
  }

  _alive(token) {
    return this.active && token === this.token;
  }

  _save() {
    if (this.engine) storage.set(SAVE_KEY, this.engine.toJSON());
  }

  /* ------------------------------------------------ missões */
  async nextMission() {
    const token = this.token;
    const engine = this.engine;
    if (engine.deck.isCycleComplete && engine.phase !== PHASE.IDLE) {
      this._showSummary();
      return;
    }
    this.el.skip.disabled = true;
    this.feedbacks?.forEach((f) => f.hide());
    const upcoming = this.byId.get(engine.deck.order[engine.deck.position] ?? engine.deck.order[0]);
    const preload = this._preload(upcoming);

    // "roleta" de embaralhar, como no ShuffleAndGenerate do jogo original
    this._clearTarget();
    this._setPrompt('🃏 Embaralhando...');
    const reveal = this.el.reveal;
    reveal.hidden = false;
    reveal.dataset.phase = 'shuffle';
    this.el.revealText.textContent = 'Embaralhando...';
    let elapsed = 0;
    let interval = 50;
    while (elapsed < GAME.shuffleTime * 1000) {
      reveal.style.setProperty('--shuffle-step', String(Math.random()));
      reveal.classList.toggle('tick');
      sfx.tick();
      await sleep(interval);
      if (!this._alive(token)) return;
      elapsed += interval;
      interval += 10;
    }
    await preload;
    if (!this._alive(token)) return;

    const id = engine.startMission({ visibleCards: this._visibleCardIds() });
    if (id === null) {
      reveal.hidden = true;
      this._showSummary();
      return;
    }
    const card = this.byId.get(id);
    this.el.revealImg.src = card.file;
    this.el.revealImg.alt = card.label;
    this.el.revealName.textContent = GAME.showLabels ? card.label : '';
    this.el.revealText.textContent = 'Encontre esta carta!';
    reveal.dataset.phase = 'reveal';
    sfx.reveal();
    announce(`Nova carta: ${card.label}. Encontre esta carta!`);
    this._showTarget(id);
    this._renderStats();
    this._save();
    // a carta-alvo pode já estar na frente da câmera
    if (this.session.isVisible(card.index)) this._found(card.index);

    // mostra grande por um instante e "voa" para o placar (toque para pular)
    await Promise.race([sleep(1700), new Promise((r) => { this._revealSkipWait = r; })]);
    this._revealSkipWait = null;
    if (!this._alive(token)) return;
    if (engine.phase === PHASE.SEARCHING) reveal.dataset.phase = 'fly';
    await sleep(350);
    if (!this._alive(token)) return;
    reveal.hidden = true;
    reveal.dataset.phase = '';
    if (engine.phase === PHASE.SEARCHING) this._startSearching();
  }

  _startSearching() {
    this.el.skip.disabled = false;
    this._setPrompt('Encontre esta carta!');
    this.el.scan.hidden = false;
  }

  async skip() {
    const r = this.engine?.skip();
    if (!r || r.type !== 'skipped') return;
    const card = this.byId.get(r.card);
    sfx.skip();
    toast(`⏭️ Carta pulada: ${card.label}. Ela volta no próximo baralho.`, { type: 'info', duration: 2600 });
    this._renderStats();
    this._save();
    this.el.skip.disabled = true;
    await sleep(350);
    if (this.active) this.nextMission();
  }

  async newDeck() {
    this.engine.newCycle();
    this.recordAtStart = storage.get(RECORD_KEY, 0);
    this.el.summary.hidden = true;
    this._renderStats();
    this._save();
    announce('Novo baralho embaralhado!');
    await this.nextMission();
  }

  /* ------------------------------------------------ detecção */
  _visibleCardIds() {
    return (this.session?.visibleTargets || []).map((i) => this.byIndex.get(i)?.id).filter(Boolean);
  }

  _found(index) {
    const card = this.byIndex.get(index);
    if (!card || !this.engine) return;
    const result = this.engine.detect(card.id);
    const fb = this.feedbacks?.[index];
    if (result.type === 'hit') this._hit(result, card, fb);
    else if (result.type === 'wrong') this._wrong(result, card, fb);
    else if (result.type === 'ignored' && result.reason === 'already-visible') fb?.show('neutral');
  }

  _lost(index) {
    const card = this.byIndex.get(index);
    if (card) this.engine?.cardLost(card.id);
    this.feedbacks?.[index]?.hide();
  }

  async _hit(result, card, fb) {
    const token = this.token;
    fb?.show('hit');
    sfx.correct();
    confetti(this.screen);
    this.el.skip.disabled = true;
    this.el.scan.hidden = true;
    this._feedback('hit', `
      <div class="feedback__icon">🎉</div>
      <div class="feedback__title">ACERTO!</div>
      <div class="feedback__text">Muito bem! Você achou <strong>${escapeHtml(card.label)}</strong> em ${formatSeconds(result.seconds)}.</div>
      <div class="feedback__points"><span>+${result.base} pontos</span>${result.bonus ? `<span class="bonus">+${result.bonus} bônus de tempo</span>` : ''}</div>`);
    announce(`Acerto! Mais ${result.total} pontos. Total: ${result.score}.`);
    this._renderStats(true);
    this._updateRecord();
    this._save();
    await sleep(GAME.delayNextMission * 1000);
    if (!this._alive(token)) return;
    this.el.feedback.hidden = true;
    if (this.engine.cycleComplete) this._showSummary();
    else this.nextMission();
  }

  _wrong(result, card, fb) {
    fb?.show('wrong');
    if (!result.counted) {
      this._setPrompt(`Essa é “${card.label}”. Procure a carta mostrada acima!`, true);
      return;
    }
    sfx.wrong();
    this._feedback('wrong', `
      <div class="feedback__icon">❌</div>
      <div class="feedback__title">OPS!</div>
      <div class="feedback__text">Essa não é a carta solicitada.</div>
      ${result.penalty ? `<div class="feedback__points"><span class="minus">−${result.penalty} pontos</span></div>` : ''}`, 1700);
    announce(`Essa não é a carta. ${result.penalty ? `Menos ${result.penalty} pontos.` : ''}`);
    this._renderStats(true);
    this._save();
  }

  /* ------------------------------------------------ interface */
  _setupFeedback() {
    const loader = new THREE.TextureLoader();
    const shared = {
      check: badgeTexture('✓', '#22b35e'),
      cross: badgeTexture('✗', '#e23b3b'),
      aia: loader.load('assets/img/aia.webp'),
    };
    shared.aia.colorSpace = THREE.SRGBColorSpace;
    this.feedbacks = this.cards.map((c) => new CardFeedback(this.session.anchor(c.index), this.session.aspect(c.index), shared));
  }

  _frame(dt) {
    this.feedbacks?.forEach((f) => f.update(dt));
    const engine = this.engine;
    if (!engine) return;
    if (engine.phase === PHASE.SEARCHING) {
      const t = engine.elapsed;
      const sec = Math.floor(t);
      if (sec !== this._lastSec) {
        this._lastSec = sec;
        this.el.clock.textContent = formatClock(t);
        const bonus = timeBonus(t, GAME.scoring.timeBonus);
        this.el.bonus.textContent = bonus > 0 ? `+${bonus} bônus` : 'sem bônus';
        this.el.bonus.classList.toggle('is-zero', bonus === 0);
      }
    }
  }

  _renderStats(bump = false) {
    const s = this.engine.stats;
    const { stats } = this.el;
    const set = (el, value) => {
      if (el.textContent !== String(value)) {
        el.textContent = value;
        if (bump) {
          el.classList.remove('bump');
          void el.offsetWidth;
          el.classList.add('bump');
        }
      }
    };
    set(stats.score, s.score);
    set(stats.hits, s.hits);
    set(stats.errors, s.errors);
    set(stats.used, `${this.engine.deck.drawnInCycle}/${this.engine.deck.size}`);
  }

  _showTarget(id) {
    const card = this.byId.get(id);
    this.el.targetImg.src = card.file;
    this.el.targetImg.alt = `Carta alvo: ${card.label}`;
    this.el.targetName.textContent = GAME.showLabels ? card.label : '';
    this.el.targetSlot.classList.add('has-card');
    this._lastSec = -1;
    this.el.clock.textContent = '00:00';
  }

  _clearTarget() {
    this.el.targetSlot.classList.remove('has-card');
    this.el.targetName.textContent = '';
    this.el.scan.hidden = true;
  }

  _setPrompt(text, warn = false) {
    this.el.prompt.textContent = text;
    this.el.prompt.classList.toggle('is-warn', warn);
    clearTimeout(this._promptTimer);
    if (warn) this._promptTimer = setTimeout(() => this._setPrompt('Encontre esta carta!'), 2600);
  }

  _feedback(kind, html, duration = 0) {
    const box = this.el.feedback;
    box.className = `feedback feedback--${kind}`;
    box.innerHTML = html;
    box.hidden = false;
    clearTimeout(this._feedbackTimer);
    if (duration) this._feedbackTimer = setTimeout(() => { box.hidden = true; }, duration);
  }

  _showSummary() {
    clearToasts();
    const s = this.engine.summary();
    const record = Math.max(storage.get(RECORD_KEY, 0), this.recordAtStart || 0);
    const box = this.el.summary;
    box.querySelector('[data-sum="used"]').textContent = `${s.used}/${s.total}`;
    box.querySelector('[data-sum="hits"]').textContent = s.hits;
    box.querySelector('[data-sum="errors"]').textContent = s.errors;
    box.querySelector('[data-sum="skips"]').textContent = s.skips;
    box.querySelector('[data-sum="score"]').textContent = s.score;
    box.querySelector('[data-sum="best"]').textContent = s.bestTime === null ? '—' : formatSeconds(s.bestTime);
    box.querySelector('[data-sum="record"]').textContent = Math.max(record, s.score);
    box.querySelector('[data-sum-new-record]').hidden = !(s.score > 0 && s.score > (this.recordAtStart || 0));
    box.hidden = false;
    this.el.skip.disabled = true;
    this.el.scan.hidden = true;
    this._updateRecord();
    sfx.fanfare();
    confetti(this.screen, 60);
    announce(`Ciclo completo! ${s.hits} acertos, ${s.errors} erros, ${s.score} pontos.`);
    box.querySelector('[data-action="new-deck"]').focus();
  }

  _updateRecord() {
    const record = storage.get(RECORD_KEY, 0);
    if (this.engine.stats.score > record) storage.set(RECORD_KEY, this.engine.stats.score);
  }

  _renderSound() {
    const on = isSoundOn();
    this.el.sound.textContent = on ? '🔊' : '🔇';
    this.el.sound.setAttribute('aria-pressed', String(on));
    this.el.sound.setAttribute('aria-label', on ? 'Desligar sons' : 'Ligar sons');
  }

  _preload(card) {
    if (!card) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = card.file;
      setTimeout(resolve, 4000);
    });
  }

  _status(step, progress) {
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

  _activity() {
    this.ui.classList.remove('is-idle');
  }
}
