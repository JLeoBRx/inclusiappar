/**
 * Mãos na câmera com o MediaPipe Hand Landmarker (vendor/mediapipe, Apache-2.0).
 *
 * O MediaPipe encontra os 21 pontos de cada mão no quadro do vídeo; quem
 * decide qual vogal a mão está fazendo é o handSigns.js. Nada sai do
 * aparelho: tudo roda no navegador (WebAssembly + GPU).
 *
 * Carregado sob demanda e uma única vez (modelo ≈ 8 MB + WebAssembly ≈ 11 MB;
 * nas próximas vezes vem do cache do service worker).
 */
import { SIGN_GAME } from './signConfig.js';
import { classifyHand } from './handSigns.js';

const BASE = new URL('../../vendor/mediapipe/', import.meta.url);

/** Baixa um arquivo informando o progresso (0 … 1). */
async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body?.getReader || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(0.99, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}

let loading = null;
let loaded = false;
const listeners = new Set();

/**
 * Prepara o Hand Landmarker (uma vez). `onProgress(0 … 1)` acompanha o download do modelo.
 * Tenta a GPU e, se ela não funcionar no aparelho, usa a CPU.
 */
export function loadHandLandmarker({ onProgress } = {}) {
  if (onProgress) {
    if (loaded) onProgress(1);
    else listeners.add(onProgress);
  }
  if (!loading) {
    const progress = (p) => listeners.forEach((fn) => fn(p));
    loading = (async () => {
      const cfg = SIGN_GAME.recognition;
      const [vision, model] = await Promise.all([
        import('../../vendor/mediapipe/vision_bundle.mjs'),
        download(new URL('hand_landmarker.task', BASE).href, progress),
      ]);
      const fileset = await vision.FilesetResolver.forVisionTasks(new URL('wasm', BASE).href.replace(/\/$/, ''));
      const options = (delegate) => ({
        baseOptions: { modelAssetBuffer: model, delegate },
        // IMAGE: cada quadro é analisado do zero. No modo VIDEO o MediaPipe
        // segue a região onde a mão estava no quadro anterior e pode "ver"
        // uma mão no desenho da carta que aparece ali depois — e a carta
        // nunca pode valer como sinal.
        runningMode: 'IMAGE',
        numHands: cfg.numHands,
        minHandDetectionConfidence: cfg.minDetectionConfidence,
        minHandPresenceConfidence: cfg.minPresenceConfidence,
        minTrackingConfidence: cfg.minTrackingConfidence,
      });
      let landmarker;
      try {
        landmarker = await vision.HandLandmarker.createFromOptions(fileset, options(cfg.delegate));
      } catch (err) {
        if (cfg.delegate === 'CPU') throw err;
        console.warn('[mãos] GPU indisponível, usando a CPU', err);
        landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
      loaded = true;
      progress(1);
      return landmarker;
    })();
    loading.catch(() => {
      loading = null;
    }).finally(() => listeners.clear());
  }
  return loading;
}

/** Baixa o reconhecimento de mãos em segundo plano (tela "Como jogar"). */
export function prefetchHandLandmarker() {
  loadHandLandmarker().catch(() => {});
}

export class HandTracker {
  constructor({ fps = SIGN_GAME.recognition.fps } = {}) {
    this.interval = 1000 / fps;
    this.landmarker = null;
    this.lastRun = -Infinity;
  }

  get ready() {
    return !!this.landmarker;
  }

  /** Espera o MediaPipe ficar pronto (lança erro se não for possível carregar). */
  async load(onProgress) {
    this.landmarker = await loadHandLandmarker({ onProgress });
    return this;
  }

  /**
   * Analisa o quadro atual do vídeo — no máximo `fps` vezes por segundo.
   * Devolve null quando não é hora de analisar; senão, a lista de mãos:
   * { points (0 … 1 na imagem), world (metros), handedness, vowel, score, scores }.
   */
  detect(video, now = performance.now()) {
    if (!this.landmarker || !video || video.readyState < 2 || !video.videoWidth) return null;
    if (now - this.lastRun < this.interval) return null;
    this.lastRun = now;
    let result;
    try {
      result = this.landmarker.detect(video);
    } catch (err) {
      console.warn('[mãos] falha ao analisar o quadro', err);
      return [];
    }
    const hands = [];
    (result.landmarks || []).forEach((points, i) => {
      const world = result.worldLandmarks?.[i];
      const c = world && classifyHand(world);
      if (!c) return;
      hands.push({ points, world, handedness: result.handedness?.[i]?.[0]?.categoryName || '', ...c });
    });
    return hands;
  }
}

/** Ligações entre os 21 pontos (para desenhar a mão na tela). */
export const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
