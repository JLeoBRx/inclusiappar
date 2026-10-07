/**
 * Sessão de Realidade Aumentada: câmera + MindAR (image tracking) + Three.js.
 *
 * Usa o Controller de baixo nível do MindAR em vez do MindARThree pronto,
 * porque o app troca de cena várias vezes e precisa de:
 *   - mensagens de erro específicas (câmera negada × ocupada × inexistente);
 *   - liberar a câmera e os listeners ao sair (o MindARThree não remove o
 *     listener de resize nem descarta o renderer);
 *   - reaproveitar o Controller e o renderer WebGL entre sessões (o iOS
 *     limita a quantidade de contextos WebGL);
 *   - pausar o rastreamento sem desligar a câmera (Modo Interação).
 *
 * Coordenadas das âncoras (igual ao MindAR): origem no centro da imagem,
 * 1 unidade = largura da imagem, +Y = topo da imagem, +Z = para fora do papel.
 */
import * as THREE from '../lib/three.js';
import { AR } from '../config.js';
import { loadTargets } from './targets.js';

export class ARError extends Error {
  /**
   * code: insecure | unsupported | webgl | denied | notfound | busy | camera | load
   */
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'ARError';
    this.code = code;
    this.cause = cause;
  }
}

let mindarPromise = null;
/** Carrega a biblioteca do MindAR (≈2 MB) uma única vez. */
export function loadMindAR() {
  if (!mindarPromise) {
    mindarPromise = import('../../vendor/mind-ar/mindar-image.prod.js')
      .then(() => {
        if (!window.MINDAR?.IMAGE?.Controller) throw new Error('MindAR não inicializou');
        return window.MINDAR.IMAGE;
      })
      .catch((err) => {
        mindarPromise = null;
        throw new ARError('load', 'Não foi possível carregar o módulo de Realidade Aumentada.', err);
      });
  }
  return mindarPromise;
}

let sharedRenderer = null;
function getRenderer() {
  if (!sharedRenderer) {
    try {
      sharedRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      throw new ARError('webgl', 'Este aparelho não suporta gráficos 3D (WebGL).', err);
    }
    sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
    sharedRenderer.setClearColor(0x000000, 0);
    sharedRenderer.domElement.className = 'ar-canvas';
  }
  return sharedRenderer;
}

/** Um Controller do MindAR por conjunto de alvos, reaproveitado entre sessões. */
const controllers = new Map();

function disposeController(entry) {
  const c = entry.controller;
  try {
    c.dispose();
    c.worker?.terminate();
    const t = c.tracker;
    if (t) {
      for (const list of [t.featurePointsListT, t.imagePixelsListT, t.imagePropertiesListT]) {
        list?.forEach((tensor) => tensor?.dispose?.());
      }
    }
    const handle = c.inputLoader?.tempPixelHandle;
    if (handle) globalThis._tfengine?.backend?.disposeData?.(handle.dataId);
  } catch (err) {
    console.warn('[AR] falha ao descartar o controller', err);
  }
}

function mapCameraError(err) {
  const name = err?.name || '';
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) {
    return new ARError('denied', 'Permissão da câmera negada.', err);
  }
  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)) {
    return new ARError('notfound', 'Nenhuma câmera encontrada.', err);
  }
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) {
    return new ARError('busy', 'A câmera está em uso por outro aplicativo.', err);
  }
  if (name === 'TypeError') return new ARError('unsupported', 'Câmera não suportada neste navegador.', err);
  return new ARError('camera', 'Não foi possível abrir a câmera.', err);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ARSession {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  elemento que recebe vídeo + canvas
   * @param {string} opts.targets         base dos arquivos de alvos (sem extensão)
   * @param {string} opts.id              'book' | 'game' (Controller reaproveitado)
   * @param {object} opts.tuning          AR.book | AR.game
   */
  constructor({ container, targets, id, tuning }) {
    this.container = container;
    this.targetsBase = targets;
    this.id = id;
    this.tuning = tuning;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 10, 100000);
    this.scene.add(this.camera);
    this.hud = { scene: new THREE.Scene(), camera: new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10) };

    this.anchors = [];
    this.postMatrices = [];
    this.dimensions = [];
    this.targetCount = 0;
    this.manifest = null;

    /** callbacks */
    this.onTargetFound = null;
    this.onTargetLost = null;
    this.onFrame = null;
    this.onStatus = null;

    this.running = false;
    this.tracking = false;
    this._clock = new THREE.Clock(false);
    this._onResize = () => this.resize();
    this._onVisibility = () => this._visibilityChanged();
    this._resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this._onResize) : null;
  }

  _status(step, progress) {
    this.onStatus?.(step, progress);
  }

  /** Renderer WebGL compartilhado entre as sessões. */
  get renderer() {
    return getRenderer();
  }

  /** Liga câmera, carrega alvos e começa o rastreamento. */
  async start() {
    if (this.running) return;
    if (!window.isSecureContext) throw new ARError('insecure', 'A câmera exige uma conexão segura (https).');
    if (!navigator.mediaDevices?.getUserMedia) throw new ARError('unsupported', 'Este navegador não permite usar a câmera.');
    this._stopped = false;
    const renderer = getRenderer();

    // biblioteca e alvos em paralelo com a câmera
    this._status('loading', 0);
    const libPromise = loadMindAR();
    const targetsPromise = loadTargets(this.targetsBase, { onProgress: (p) => this._status('targets', p) })
      .catch((err) => { throw new ARError('load', 'Não foi possível baixar as imagens de reconhecimento.', err); });
    libPromise.catch(() => {});
    targetsPromise.catch(() => {});

    this._status('camera');
    await this._openCamera();
    if (this._stopped) return;

    const [MINDAR, targets] = await Promise.all([libPromise, targetsPromise]);
    if (this._stopped) return;
    this.manifest = targets.manifest;

    this._status('preparing');
    try {
      await this._setupController(MINDAR, targets.bytes);
    } catch (err) {
      // o detector do MindAR roda em WebGL (TensorFlow.js)
      throw err instanceof ARError ? err : new ARError('webgl', 'Não foi possível iniciar o reconhecimento de imagens.', err);
    }
    if (this._stopped) return;

    this.container.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, AR.maxPixelRatio));
    this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._resizeObserver?.observe(this.container);

    this.running = true;
    this._clock.start();
    renderer.setAnimationLoop(() => this._render());
    this.resumeTracking();
    this._status('ready');
  }

  async _openCamera() {
    const { width, height } = AR.camera;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: width }, height: { ideal: height } },
      });
    } catch (err) {
      if (['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError'].includes(err?.name)) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } catch (err2) {
          throw mapCameraError(err2);
        }
      } else {
        throw mapCameraError(err);
      }
    }
    if (this._stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    const video = document.createElement('video');
    video.className = 'ar-video';
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.playsInline = true;
    this.container.prepend(video);
    this.video = video;
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      if (video.readyState >= 1 && video.videoWidth) return resolve();
      const timer = setTimeout(() => reject(new ARError('camera', 'A câmera não respondeu.')), 12000);
      video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    try {
      await video.play();
    } catch (err) {
      console.warn('[AR] video.play()', err);
    }
    video.setAttribute('width', video.videoWidth);
    video.setAttribute('height', video.videoHeight);
    // ao girar o celular, o vídeo da câmera pode trocar largura e altura
    video.addEventListener('resize', this._onResize);
    // a câmera pode ser desligada pelo sistema (ex.: outro app pediu a câmera)
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (this.running && document.visibilityState === 'visible') this.onCameraEnded?.();
    });
  }

  async _setupController(MINDAR, bytes) {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    let entry = controllers.get(this.id);
    // o MindAR trata a rotação (largura/altura trocadas); outra resolução exige outro controller
    const compatible = entry && entry.bytes === bytes &&
      ((entry.width === w && entry.height === h) || (entry.width === h && entry.height === w));
    if (entry && !compatible) {
      await entry.idle?.();
      disposeController(entry);
      controllers.delete(this.id);
      entry = null;
    }
    if (!entry) {
      const controller = new MINDAR.Controller({
        inputWidth: w,
        inputHeight: h,
        maxTrack: 1,
        filterMinCF: this.tuning.filterMinCF,
        filterBeta: this.tuning.filterBeta,
        warmupTolerance: this.tuning.warmupTolerance,
        missTolerance: this.tuning.missTolerance,
      });
      const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer : bytes.slice().buffer;
      const { dimensions } = controller.addImageTargetsFromBuffer(buffer);
      entry = { controller, width: w, height: h, bytes, dimensions, warmed: false, processing: false, onDone: null };
      entry.idle = () => (entry.processing ? new Promise((resolve) => {
        entry.onDone = resolve;
        setTimeout(resolve, 2000);
      }) : Promise.resolve());
      controllers.set(this.id, entry);
    }
    if (!entry.warmed) {
      // compila os shaders do detector (lento na 1ª vez)
      await sleep(30);
      entry.controller.dummyRun(this.video);
      entry.warmed = true;
    }
    this.entry = entry;
    this.controller = entry.controller;
    this.dimensions = entry.dimensions;
    this.targetCount = entry.dimensions.length;
    this.postMatrices = entry.dimensions.map(([mw, mh]) => new THREE.Matrix4().compose(
      new THREE.Vector3(mw / 2, mh / 2, 0), new THREE.Quaternion(), new THREE.Vector3(mw, mw, mw)));
    entry.controller.onUpdate = (data) => this._onUpdate(data);
  }

  /** Grupo que acompanha a imagem `targetIndex`. */
  anchor(targetIndex) {
    if (!this.anchors[targetIndex]) {
      const group = new THREE.Group();
      group.name = `alvo-${targetIndex}`;
      group.visible = false;
      group.matrixAutoUpdate = false;
      this.scene.add(group);
      this.anchors[targetIndex] = { group, visible: false };
    }
    return this.anchors[targetIndex].group;
  }

  isVisible(targetIndex) {
    return !!this.anchors[targetIndex]?.visible;
  }

  get visibleTargets() {
    return this.anchors.map((a, i) => (a?.visible ? i : -1)).filter((i) => i >= 0);
  }

  /** Proporção altura/largura da imagem-alvo. */
  aspect(targetIndex) {
    const d = this.dimensions[targetIndex];
    return d ? d[1] / d[0] : 1;
  }

  _onUpdate(data) {
    if (data.type === 'processDone') {
      if (!this.entry?.controller.processingVideo) {
        this.entry.processing = false;
        this.entry.onDone?.();
        this.entry.onDone = null;
      }
      return;
    }
    if (data.type !== 'updateMatrix' || !this.tracking) return;
    const { targetIndex, worldMatrix } = data;
    this.anchor(targetIndex);
    const a = this.anchors[targetIndex];
    if (worldMatrix) {
      a.group.matrix.fromArray(worldMatrix).multiply(this.postMatrices[targetIndex]);
      a.group.matrixWorldNeedsUpdate = true;
      a.group.visible = true;
      if (!a.visible) {
        a.visible = true;
        this.onTargetFound?.(targetIndex);
      }
    } else if (a.visible) {
      a.visible = false;
      a.group.visible = false;
      this.onTargetLost?.(targetIndex);
    }
  }

  /** Para o rastreamento (a câmera continua). Âncoras visíveis são "perdidas". */
  async pauseTracking() {
    if (!this.tracking) return;
    this.tracking = false;
    const entry = this.entry;
    if (entry?.processing) {
      const done = entry.idle();
      entry.controller.stopProcessVideo();
      await done;
    }
    this.anchors.forEach((a, i) => {
      if (a?.visible) {
        a.visible = false;
        a.group.visible = false;
        this.onTargetLost?.(i);
      }
    });
  }

  resumeTracking() {
    if (this.tracking || !this.running || !this.entry) return;
    this.tracking = true;
    this.entry.processing = true;
    this.entry.controller.processVideo(this.video);
  }

  resize() {
    const { video, container, camera, controller } = this;
    if (!video || !controller || !video.videoWidth) return;
    const renderer = getRenderer();
    video.setAttribute('width', video.videoWidth);
    video.setAttribute('height', video.videoHeight);
    const cw = container.clientWidth || window.innerWidth;
    const ch = container.clientHeight || window.innerHeight;

    // vídeo cobre a tela inteira (como object-fit: cover)
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = cw / ch;
    let vw;
    let vh;
    if (videoRatio > containerRatio) {
      vh = ch;
      vw = vh * videoRatio;
    } else {
      vw = cw;
      vh = vw / videoRatio;
    }
    Object.assign(video.style, {
      top: `${-(vh - ch) / 2}px`, left: `${-(vw - cw) / 2}px`, width: `${vw}px`, height: `${vh}px`,
    });

    // projeção da câmera virtual (portado de MindARThree.resize)
    const proj = controller.getProjectionMatrix();
    const inputRatio = controller.inputWidth / controller.inputHeight;
    const inputAdjust = inputRatio > containerRatio
      ? video.width / controller.inputWidth
      : video.height / controller.inputHeight;
    const videoDisplayHeight = inputRatio > containerRatio
      ? ch * inputAdjust
      : (cw / controller.inputWidth) * controller.inputHeight * inputAdjust;
    const fovAdjust = ch / videoDisplayHeight;
    camera.fov = (2 * Math.atan((1 / proj[5]) * fovAdjust) * 180) / Math.PI;
    camera.near = proj[14] / (proj[10] - 1.0);
    camera.far = proj[14] / (proj[10] + 1.0);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();

    renderer.setSize(cw, ch);
    const hc = this.hud.camera;
    hc.left = 0;
    hc.right = cw;
    hc.top = ch;
    hc.bottom = 0;
    hc.updateProjectionMatrix();
    this.viewport = { width: cw, height: ch };
    this.onResize?.(this.viewport);
  }

  _render() {
    const renderer = getRenderer();
    const dt = Math.min(this._clock.getDelta(), 0.1);
    try {
      this.onFrame?.(dt);
    } catch (err) {
      // um erro num quadro não pode parar a renderização (o three.js não
      // reagenda o próximo quadro se o callback lançar exceção)
      if (!this._frameErrorLogged) console.error('[AR] erro no quadro', err);
      this._frameErrorLogged = true;
    }
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
    if (this.hud.scene.children.length) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(this.hud.scene, this.hud.camera);
    }
  }

  async _visibilityChanged() {
    if (!this.running) return;
    if (document.visibilityState === 'hidden') {
      this._wasTracking = this.tracking;
      await this.pauseTracking();
      getRenderer().setAnimationLoop(null);
      this.onSuspend?.();
      return;
    }
    // voltou para o app: a câmera pode ter sido desligada pelo sistema (iOS)
    const track = this.stream?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      this.onCameraEnded?.();
      return;
    }
    this.video?.play().catch(() => {});
    this._clock.getDelta();
    getRenderer().setAnimationLoop(() => this._render());
    if (this._wasTracking) this.resumeTracking();
    this.onResume?.();
  }

  /** Desliga tudo e devolve a tela ao estado inicial. */
  async stop() {
    this._stopped = true;
    const renderer = sharedRenderer;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._resizeObserver?.disconnect();
    renderer?.setAnimationLoop(null);
    if (this.entry) {
      this.tracking = true; // garante que pauseTracking aguarde o laço do MindAR
      await this.pauseTracking();
      this.entry.controller.onUpdate = null;
    }
    this.running = false;
    this.tracking = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.removeEventListener('resize', this._onResize);
      this.video.pause();
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    if (renderer?.domElement.parentNode === this.container) {
      renderer.clear();
      renderer.domElement.remove();
    }
    this.anchors.forEach((a) => a && this.scene.remove(a.group));
    this.anchors = [];
    this._clock.stop();
  }
}
