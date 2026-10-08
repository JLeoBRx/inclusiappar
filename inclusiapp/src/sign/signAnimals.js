/**
 * 🐾 Os animais para contar: 1, 2 ou 3 cópias do animal da vogal, em 3D,
 * na frente da câmera (cena de Realidade Aumentada da ARSession).
 *
 * Usa os mesmos modelos do livro (assets/models/*.glb) e a mesma classe
 * AnimalModel (cores, partes animadas, sombra e "pop" de entrada). Cada cópia
 * é um clone da cena original; a geometria é compartilhada entre as cópias
 * e nunca é descartada (os modelos ficam em cache para as próximas rodadas).
 */
import * as THREE from '../lib/three.js';
import { AnimalModel } from '../ar/modelManager.js';
import { tone } from '../ui/sound.js';

const loader = new THREE.GLTFLoader();
const pristine = new Map(); // url → Promise<THREE.Group>

/** Cena original do modelo (carregada uma vez). */
function loadScene(animal) {
  if (!pristine.has(animal.model)) {
    const promise = loader.loadAsync(animal.model).then((gltf) => gltf.scene);
    pristine.set(animal.model, promise);
    promise.catch(() => pristine.delete(animal.model));
  }
  return pristine.get(animal.model);
}

/** Baixa os modelos em segundo plano. */
export function prefetchAnimals(animals) {
  animals.forEach((a) => loadScene(a).catch(() => {}));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Uma cópia do animal, com pulinhos e um leve balanço. */
class Critter {
  constructor(scene, animal, index) {
    this.model = new AnimalModel({ scene: scene.clone(true) }, animal);
    this.group = new THREE.Group();
    this.group.add(this.model.root);
    // em 3/4, todos para o mesmo lado (um desfile): o perfil é o jeito mais
    // fácil de reconhecer o animal
    this.yaw = 0.7 + [0, -0.12, 0.12][index % 3];
    this.model.root.rotation.y = this.yaw;
    this.t = 0;
    this.drop = 0;
    this.hops = [];
    this.model.pop();
  }

  hop(delay = 0) {
    this.hops.push({ t: -delay });
  }

  update(dt) {
    this.t += dt;
    this.model.update(dt);
    // chega caindo do alto
    this.drop = Math.min(1, this.drop + dt / 0.45);
    let y = (1 - easeOutBack(this.drop)) * 0.6;
    for (const h of this.hops) {
      h.t += dt;
      if (h.t > 0 && h.t < 0.5) y += Math.sin((h.t / 0.5) * Math.PI) * 0.28;
    }
    this.hops = this.hops.filter((h) => h.t < 0.5);
    this.group.position.y = y;
    this.model.root.rotation.y = this.yaw + 0.12 * Math.sin(this.t * 1.3);
  }

  dispose() {
    this.group.removeFromParent();
    this.model.root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.material.dispose();
      if (obj === this.model.shadow) obj.geometry.dispose();
    });
  }
}

export class AnimalParade {
  /** @param {import('../ar/arSession.js').ARSession} session */
  constructor(session) {
    this.session = session;
    this.stage = new THREE.Group();
    this.stage.name = 'animais-para-contar';
    this.lights = [new THREE.HemisphereLight(0xfff6e5, 0x4a3b2a, 1.7), new THREE.DirectionalLight(0xffffff, 2.1)];
    this.lights[1].position.set(-300, 900, 600);
    session.scene.add(this.stage, ...this.lights);
    this.critters = [];
    this.token = 0;
  }

  get count() {
    return this.critters.length;
  }

  /**
   * Mostra `count` animais, um de cada vez (`gapMs` entre eles).
   * Resolve quando todos já apareceram (ou false se foi cancelado).
   */
  async show(animal, count, { gapMs = 450 } = {}) {
    this.clear();
    const token = ++this.token;
    const scene = await loadScene(animal);
    if (token !== this.token) return false;
    for (let i = 0; i < count; i++) {
      if (i) await sleep(gapMs);
      if (token !== this.token) return false;
      const critter = new Critter(scene, animal, i);
      this.critters.push(critter);
      this.stage.add(critter.group);
      this.layout();
      tone(520 + i * 160, 0, 0.14, { type: 'triangle', gain: 0.14 });
      tone(780 + i * 160, 0.07, 0.16, { type: 'triangle', gain: 0.1 });
    }
    await sleep(500); // termina o pulo de chegada
    return token === this.token;
  }

  /** Todos pulam (convite para contar de novo / comemoração). */
  hopAll() {
    this.critters.forEach((c, i) => c.hop(i * 0.14));
  }

  clear() {
    this.token += 1;
    this.critters.forEach((c) => c.dispose());
    this.critters = [];
  }

  /** Enfileira os animais no centro da tela, de frente para a câmera. */
  layout() {
    const { session } = this;
    if (!session.viewport) return;
    const { width, height } = session.viewport;
    const cam = session.camera;
    const distance = 1000;
    const viewH = 2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const viewW = viewH * cam.aspect;
    const n = Math.max(1, this.critters.length);
    const portrait = height >= width;
    // posições em unidades do modelo (o palco inteiro é escalado por `size`):
    // cada animal ocupa ~1 de largura em 3/4. O tamanho é o mesmo para 1, 2
    // ou 3 animais — o tamanho não pode "entregar" a resposta.
    const GAP = 1.2;
    const usableW = portrait ? viewW : viewW * 0.55;
    const size = Math.min(usableW / (3 * GAP + 0.2), viewH * (portrait ? 0.22 : 0.3));
    this.critters.forEach((c, i) => {
      c.group.position.x = (i - (n - 1) / 2) * GAP;
      c.group.position.z = 0;
    });
    // um pouco abaixo do centro da tela, acima do painel de respostas; no
    // celular deitado o painel fica à direita, então os animais vão para a esquerda
    const phoneLandscape = !portrait && height <= 540;
    const centerX = phoneLandscape ? -0.2 * viewW : 0;
    const centerY = portrait ? -0.06 * viewH : phoneLandscape ? -0.16 * viewH : -0.1 * viewH;
    this.stage.position.set(centerX, centerY, -distance);
    this.stage.rotation.set(0.28, 0, 0);
    this.stage.scale.setScalar(size);
  }

  update(dt) {
    this.critters.forEach((c) => c.update(dt));
  }

  dispose() {
    this.clear();
    this.stage.removeFromParent();
    this.lights.forEach((l) => l.removeFromParent());
  }
}
