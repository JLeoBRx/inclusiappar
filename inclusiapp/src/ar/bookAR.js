/**
 * LIVRO EM AR
 *
 *   câmera → MindAR detecta a página → animal 3D sobre a página
 *          → vídeo de LIBRAS do animal (chroma key)
 *
 * 📖 Modo Página ...... o animal fica preso à página (acompanha o livro)
 * ✋ Modo Interação ... o animal sai da página e fica na frente da câmera,
 *                       para girar, aproximar e explorar com os dedos
 *
 * A relação página → alvo → animal → modelo → vídeo vem de ANIMALS (config.js).
 */
import * as THREE from '../lib/three.js';
import { ANIMALS, AR, BOOK, LIBRAS } from '../config.js';
import { ARSession } from './arSession.js';
import { getAnimalModel, prefetchModel } from './modelManager.js';
import { GestureController } from './gestures.js';
import { LibrasVideo } from './videoChroma.js';
import { showARError, toast, announce } from '../ui/notifications.js';
import { storage } from '../ui/storage.js';

const byTarget = new Map(ANIMALS.map((a) => [a.target, a]));
const _inv = new THREE.Matrix4();
const _cam = new THREE.Vector3();
const _xAxis = new THREE.Vector3(1, 0, 0);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const IDLE_MS = 4000;

export class BookExperience {
  constructor(screen) {
    this.screen = screen;
    this.stageEl = screen.querySelector('[data-ar-stage]');
    this.ui = screen.querySelector('.ar-ui');
    this.el = {
      scan: screen.querySelector('[data-scan]'),
      scanText: screen.querySelector('[data-scan-text]'),
      chip: screen.querySelector('[data-animal-chip]'),
      loading: screen.querySelector('[data-model-loading]'),
      status: screen.querySelector('[data-status]'),
      statusText: screen.querySelector('[data-status-text]'),
      statusBar: screen.querySelector('[data-status-bar]'),
      controls: screen.querySelector('[data-controls]'),
      libras: screen.querySelector('[data-action="libras"]'),
      librasLabel: screen.querySelector('[data-libras-label]'),
      librasSize: screen.querySelector('[data-action="libras-size"]'),
      modePage: screen.querySelector('[data-action="mode-page"]'),
      modeInteract: screen.querySelector('[data-action="mode-interact"]'),
      reset: screen.querySelector('[data-action="reset"]'),
      interactHint: screen.querySelector('[data-interact-hint]'),
    };
    this.librasOn = storage.get('librasOn', LIBRAS.enabledByDefault);
    this.librasLarge = storage.get('librasLarge', false);
    this._bind();
  }

  _bind() {
    const on = (el, fn) => el?.addEventListener('click', fn);
    on(this.el.libras, () => this.setLibras(!this.librasOn));
    on(this.el.librasSize, () => this.setLibrasLarge(!this.librasLarge));
    on(this.el.modePage, () => this.setMode('page'));
    on(this.el.modeInteract, () => this.setMode('interact'));
    on(this.el.reset, () => this.gestures?.reset());
    // qualquer toque "acorda" a interface
    this.screen.addEventListener('pointerdown', () => this._activity(), { passive: true });
  }

  /* ------------------------------------------------------------ ciclo de vida */
  async enter() {
    const token = {};
    this.token = token;
    this.active = true;
    this.mode = 'page';
    this.current = null;
    this.models = new Map();
    this.transition = null;
    this.base = null;
    this._switching = false;
    this.screen.dataset.mode = 'page';
    this._renderMode();
    this._renderLibras();
    this._showChip(null);
    this._setScan('searching');
    this.el.loading.hidden = true;

    const session = new ARSession({ container: this.stageEl, targets: BOOK.targets, id: 'book', tuning: AR.book });
    this.session = session;
    session.onStatus = (step, progress) => this._status(step, progress);
    session.onTargetFound = (i) => this._found(i);
    session.onTargetLost = (i) => this._lost(i);
    session.onFrame = (dt) => this._frame(dt);
    session.onResize = (vp) => this._layoutLibras(vp);
    session.onCameraEnded = () => this._cameraEnded();

    // luzes (no espaço da câmera, valem para a página e para o Modo Interação)
    session.scene.add(new THREE.HemisphereLight(0xfff6e5, 0x4a3b2a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(300, 900, 600);
    session.scene.add(sun);

    this.stage = new THREE.Group();
    this.stage.name = 'modo-interacao';
    session.scene.add(this.stage);

    this.libras = new LibrasVideo({ chroma: LIBRAS.chroma, crop: LIBRAS.crop });
    this.libras.setEnabled(this.librasOn);
    this.libras.onLayout = () => this._layoutLibras(session.viewport);
    this.libras.onReady = () => this._layoutLibras(session.viewport);
    this.libras.onError = () => {
      this._renderLibras();
      if (this.active) toast('🎥 O vídeo de LIBRAS não pôde ser carregado agora. A Realidade Aumentada continua funcionando.', { type: 'warning' });
    };
    session.hud.scene.add(this.libras.mesh);

    this.gestures = new GestureController(this.stageEl, {
      minZoom: BOOK.interaction.minZoom,
      maxZoom: BOOK.interaction.maxZoom,
      onInteract: () => this._activity(),
    });

    this._showStatus(true);
    try {
      await session.start();
    } catch (err) {
      if (!this._alive(token)) return;
      this._showStatus(false);
      await session.stop();
      showARError(err, { onRetry: () => this.restart(), screen: this.screen });
      return;
    }
    if (!this._alive(token)) return;
    this._showStatus(false);
    for (const animal of ANIMALS) session.anchor(animal.target);
    this._scanStartedAt = performance.now();
    this._activity();
    // modelos em segundo plano, na ordem das páginas
    ANIMALS.forEach((a) => prefetchModel(a));
  }

  _alive(token) {
    return this.active && token === this.token;
  }

  async restart() {
    await this.leave();
    if (!this.screen.hidden) await this.enter();
  }

  async leave() {
    this.active = false;
    this.token = null;
    clearTimeout(this._idleTimer);
    clearTimeout(this._lostTimer);
    clearTimeout(this._hintTimer);
    // conclui uma transição pendente (o laço de renderização vai parar)
    this.transition?.done?.();
    this.transition = null;
    this._switching = false;
    this.gestures?.disable();
    if (this.session) {
      this.session.onTargetFound = this.session.onTargetLost = null;
      await this.session.stop();
    }
    for (const model of this.models?.values() || []) model.root.removeFromParent();
    this.libras?.dispose();
    this.libras = null;
    this.session = null;
    this._showStatus(false);
  }

  /* ------------------------------------------------------------ detecção */
  async _found(targetIndex) {
    const animal = byTarget.get(targetIndex);
    if (!animal || this.mode !== 'page') return;
    const token = this.token;
    clearTimeout(this._lostTimer);
    this._setScan('found');
    const changed = this.current?.id !== animal.id;
    this.current = animal;
    this._showChip(animal);
    this.libras.setSource(animal.video);
    this._renderLibras();
    if (changed) announce(`${animal.name} encontrado! Página ${animal.page}.`);

    let model = this.models.get(animal.id);
    if (!model) {
      this.el.loading.hidden = false;
      try {
        model = await getAnimalModel(animal);
      } catch (err) {
        console.error(err);
        this.el.loading.hidden = true;
        toast(`🐾 Não foi possível carregar o animal (${animal.name}). Verifique a conexão e aponte de novo para a página.`, { type: 'error' });
        return;
      } finally {
        this.el.loading.hidden = true;
      }
      if (!this._alive(token)) return;
      this.models.set(animal.id, model);
    }
    if (this.mode === 'page' && model.root.parent !== this.session.anchor(targetIndex)) {
      this._placeOnPage(model, animal);
    }
    if (this.session.isVisible(targetIndex)) model.pop();
    this._renderMode();
  }

  _lost() {
    if (this.mode !== 'page' || !this.active) return;
    clearTimeout(this._lostTimer);
    this._lostTimer = setTimeout(() => {
      if (this.session?.visibleTargets.length === 0 && this.mode === 'page') {
        this._scanStartedAt = performance.now();
        this._setScan('searching');
      }
    }, 700);
  }

  /**
   * Com o celular quase paralelo à página (visto "de cima"), o animal se
   * inclina um pouco para trás para mostrar o rosto; em ângulos normais de
   * leitura ele fica em pé sobre a página.
   */
  _faceCamera(model, dt) {
    const anchor = model.root.parent;
    _inv.copy(anchor.matrixWorld).invert();
    _cam.set(0, 0, 0).applyMatrix4(_inv).sub(model.root.position).normalize();
    const elevation = Math.asin(THREE.MathUtils.clamp(_cam.z, -1, 1)); // 90° = visto de cima
    const target = -THREE.MathUtils.clamp((elevation - THREE.MathUtils.degToRad(40)) * 0.8, 0, THREE.MathUtils.degToRad(40));
    model.lean = THREE.MathUtils.lerp(model.lean || 0, target, 1 - Math.exp(-4 * dt));
    model.root.quaternion.setFromAxisAngle(_xAxis, Math.PI / 2 + model.lean);
  }

  _placeOnPage(model, animal) {
    const anchor = this.session.anchor(animal.target);
    anchor.add(model.root);
    // em pé sobre a página: +Y do modelo vira +Z da âncora (para fora do papel);
    // a frente do animal aponta para a borda de baixo da página (para o leitor)
    model.root.position.set(animal.offset?.[0] || 0, animal.offset?.[1] || 0, 0);
    model.root.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    model.root.scale.setScalar(animal.scale);
  }

  /* ------------------------------------------------------------ modos */
  async setMode(mode) {
    if (mode === this.mode || !this.session?.running || this._switching) return;
    if (mode === 'interact' && !this.current) {
      toast('📖 Primeiro aponte o celular para uma página do livro.', { type: 'info' });
      return;
    }
    this._switching = true;
    try {
      if (mode === 'interact') await this._enterInteraction();
      else await this._exitInteraction();
    } finally {
      this._switching = false;
    }
  }

  async _enterInteraction() {
    const model = this.models.get(this.current.id);
    if (!model) {
      toast('🐾 Preparando o animal... tente de novo em instantes.', { type: 'info' });
      return;
    }
    const { session } = this;
    const camera = session.camera;
    const visible = session.isVisible(this.current.target) && model.root.parent;
    const from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
    if (visible) {
      model.root.updateWorldMatrix(true, false);
      model.root.matrixWorld.decompose(from.p, from.q, from.s);
    }

    // enquadramento: o animal ocupa ~70% do menor lado da tela
    const distance = visible ? THREE.MathUtils.clamp(from.p.length(), 500, 1600) : 900;
    const viewH = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * camera.aspect;
    const fit = BOOK.interaction.size * Math.min(viewH, viewW);
    const size = model.info.size || [1, 1, 1];
    this.base = {
      p: new THREE.Vector3(0, -size[1] * fit * 0.45, -distance),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, -0.55, 0, 'YXZ')),
      s: fit,
      viewH,
    };
    if (!visible) {
      from.p.copy(this.base.p).add(new THREE.Vector3(0, 0, 200));
      from.q.copy(this.base.q);
      from.s.setScalar(fit * 0.01);
    }
    // o animal muda para o "palco" na mesma posição em que estava na página
    this.stage.position.copy(from.p);
    this.stage.quaternion.copy(from.q);
    this.stage.scale.copy(from.s);
    this.stage.add(model.root);
    model.root.position.set(0, 0, 0);
    model.root.quaternion.identity();
    model.root.scale.setScalar(1);
    model.lean = 0;

    this.gestures.reset();
    this.transition = { from, t: 0, duration: BOOK.interaction.transitionMs / 1000 };
    this.mode = 'interact';
    this.screen.dataset.mode = 'interact';
    clearTimeout(this._lostTimer);
    this.gestures.enable();
    this._setScan('hidden');
    this._renderMode();
    this.el.interactHint.hidden = false;
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => { this.el.interactHint.hidden = true; }, 5000);
    announce(`Modo Interação: gire e aproxime ${this.current.name} com os dedos.`);
    // o rastreamento fica parado no Modo Interação: economiza bateria e processamento
    await session.pauseTracking();
  }

  async _exitInteraction() {
    const model = this.models.get(this.current.id);
    this.gestures.disable();
    this.el.interactHint.hidden = true;
    // encolhe e volta para a página
    const token = this.token;
    this.transition = { out: true, t: 0, duration: 0.22, s0: this.stage.scale.x };
    await new Promise((resolve) => { this.transition.done = resolve; });
    if (!this._alive(token)) return;
    this.mode = 'page';
    this.screen.dataset.mode = 'page';
    if (model) this._placeOnPage(model, this.current);
    this._renderMode();
    this._scanStartedAt = performance.now();
    this._setScan('searching');
    this.session.resumeTracking();
    announce('Modo Página: aponte para a página do livro.');
  }

  _applyInteraction(dt) {
    const tr = this.transition;
    if (!this.base) return;
    if (tr?.out) {
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      this.stage.scale.setScalar(Math.max(0.0001, tr.s0 * (1 - easeInOut(tr.t))));
      if (tr.t >= 1) {
        this.transition = null;
        tr.done();
      }
      return;
    }
    this.gestures.update(dt);
    const g = this.gestures.state;
    const target = {
      q: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), g.pitch))
        .multiply(this.base.q),
      s: this.base.s * g.zoom,
      p: this.base.p.clone().add(new THREE.Vector3(g.panX * this.base.viewH, g.panY * this.base.viewH, 0)),
    };
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const k = easeInOut(tr.t);
      this.stage.position.lerpVectors(tr.from.p, target.p, k);
      this.stage.quaternion.slerpQuaternions(tr.from.q, target.q, k);
      this.stage.scale.setScalar(THREE.MathUtils.lerp(tr.from.s.x, target.s, k));
      if (tr.t >= 1) this.transition = null;
      return;
    }
    // segue os gestos com um leve amortecimento
    const k = 1 - Math.exp(-18 * dt);
    this.stage.position.lerp(target.p, k);
    this.stage.quaternion.slerp(target.q, k);
    this.stage.scale.setScalar(THREE.MathUtils.lerp(this.stage.scale.x, target.s, k));
  }

  /* ------------------------------------------------------------ quadro a quadro */
  _frame(dt) {
    if (this.mode === 'interact' || this.transition) this._applyInteraction(dt);
    for (const model of this.models.values()) {
      if (model.root.parent && (model.root.parent.visible || this.mode === 'interact')) {
        if (this.mode === 'page' && !this.transition) this._faceCamera(model, dt);
        model.update(dt);
      }
    }
    this.libras?.update(dt);
    if (this.mode === 'page' && this.el.scan.dataset.state === 'searching' &&
        performance.now() - this._scanStartedAt > BOOK.notFoundHintAfter * 1000) {
      this._setScan('hint');
    }
  }

  /* ------------------------------------------------------------ LIBRAS */
  setLibras(on) {
    this.librasOn = on;
    storage.set('librasOn', on);
    this.libras?.setEnabled(on);
    this._renderLibras();
    announce(on ? 'Vídeo de LIBRAS ligado.' : 'Vídeo de LIBRAS desligado.');
  }

  setLibrasLarge(large) {
    this.librasLarge = large;
    storage.set('librasLarge', large);
    this._layoutLibras(this.session?.viewport);
  }

  _renderLibras() {
    const on = this.librasOn;
    this.el.libras.setAttribute('aria-pressed', String(on));
    this.el.librasLabel.textContent = on ? 'LIBRAS: ON' : 'LIBRAS: OFF';
    this.el.libras.classList.toggle('is-off', !on);
    const showing = on && this.current && this.libras?.ready && !this.libras?.failed;
    this.el.librasSize.hidden = !showing;
  }

  _layoutLibras(viewport) {
    if (!viewport || !this.libras) return;
    const { width, height } = viewport;
    const controls = this.el.controls.getBoundingClientRect();
    const stage = this.stageEl.getBoundingClientRect();
    const bottom = Math.max(8, stage.bottom - controls.top + 8);
    const landscape = width > height;
    let h = landscape ? height * 0.42 : Math.min(width * 0.5 / this.libras.aspect * 1.25, height * 0.27);
    if (this.librasLarge) h = landscape ? height * 0.7 : Math.min(width * 0.95 / this.libras.aspect, height * 0.48);
    h = Math.min(h, height - bottom - 70);
    const box = this.libras.place({ x: 6, y: bottom, height: h });
    const btn = this.el.librasSize;
    btn.style.left = `${Math.max(8, box.x + box.width * 0.86 - 22)}px`;
    btn.style.bottom = `${box.y + box.height * 0.62}px`;
    btn.setAttribute('aria-label', this.librasLarge ? 'Diminuir vídeo de LIBRAS' : 'Aumentar vídeo de LIBRAS');
    btn.textContent = this.librasLarge ? '⤡' : '⤢';
    this._renderLibras();
  }

  /* ------------------------------------------------------------ interface */
  _renderMode() {
    const interact = this.mode === 'interact';
    this.el.modePage.setAttribute('aria-pressed', String(!interact));
    this.el.modeInteract.setAttribute('aria-pressed', String(interact));
    this.el.modeInteract.disabled = !this.current;
    this.el.reset.hidden = !interact;
  }

  _showChip(animal) {
    const chip = this.el.chip;
    if (!animal) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    chip.querySelector('[data-chip-emoji]').textContent = animal.emoji;
    chip.querySelector('[data-chip-name]').textContent = animal.name;
    chip.querySelector('[data-chip-page]').textContent = `Página ${animal.page}`;
  }

  _setScan(state) {
    const scan = this.el.scan;
    scan.dataset.state = state;
    scan.hidden = state === 'found' || state === 'hidden';
    if (state === 'searching') {
      this.el.scanText.innerHTML = '<strong>📱 Aponte para uma página do livro</strong><span>Mantenha cerca de 30 cm de distância</span>';
    } else if (state === 'hint') {
      this.el.scanText.innerHTML = '<strong>🔎 Não encontramos a imagem.</strong><span>Tente aproximar ou afastar o celular e deixe a página bem iluminada.</span>';
    }
  }

  _status(step, progress) {
    const text = {
      loading: 'Preparando a Realidade Aumentada...',
      camera: '📷 Abrindo a câmera... Se o navegador perguntar, toque em “Permitir”.',
      targets: 'Carregando as páginas do livro...',
      preparing: 'Quase pronto...',
      ready: 'Pronto!',
    }[step];
    if (text) this.el.statusText.textContent = text;
    if (step === 'targets' && typeof progress === 'number') {
      this.el.statusBar.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
    }
    this.el.status.dataset.step = step;
  }

  _showStatus(show) {
    this.el.status.hidden = !show;
    if (show) this.el.statusBar.style.setProperty('--progress', '0%');
  }

  _activity() {
    this.ui.classList.remove('is-idle');
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this.active) this.ui.classList.add('is-idle');
    }, IDLE_MS);
  }

  _cameraEnded() {
    showARError({ code: 'ended' }, { onRetry: () => this.restart(), screen: this.screen });
  }
}
