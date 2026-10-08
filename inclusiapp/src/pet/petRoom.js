/**
 * Quarto do Bichinho Virtual em 3D.
 *
 * Usa os mesmos modelos dos animais do livro (assets/models/*.glb), mas com
 * instâncias próprias — mudar a cor do bichinho sujo ou doente nunca afeta o
 * livro. O desenho é feito no renderer WebGL único do app (arSession.js):
 * quando a câmera das cartas mágicas abre, o quarto para e o mesmo bichinho
 * passa para a cena de Realidade Aumentada.
 *
 * O cenário (parede, janela, chão) é CSS; aqui fica só o animal, com:
 *   - pose: olha em volta, deita para dormir, treme quando doente
 *   - reações: comer, beber, banho, pular, girar (magia), carinho, recusar
 *   - cor: amarronzado quando sujo, esverdeado quando doente
 */
import * as THREE from '../lib/three.js';
import { AR } from '../config.js';
import { getRenderer } from '../ar/arSession.js';
import { AnimalModel } from '../ar/modelManager.js';

const loader = new THREE.GLTFLoader();
const models = new Map();

/** Modelo 3D de um bichinho (carregado uma vez, só para este jogo). */
export function loadPetModel(pet) {
  if (!models.has(pet.id)) {
    const promise = loader.loadAsync(pet.model).then((gltf) => new AnimalModel(gltf, { id: `bichinho-${pet.id}`, lift: pet.lift }));
    models.set(pet.id, promise);
    promise.catch(() => models.delete(pet.id));
  }
  return models.get(pet.id);
}

const TINT = {
  normal: new THREE.Color(1, 1, 1),
  dirty: new THREE.Color(0.76, 0.64, 0.5),
  sick: new THREE.Color(0.72, 0.9, 0.6),
};
const GLOW = {
  heal: new THREE.Color(0.25, 0.6, 0.25),
  magic: new THREE.Color(0.45, 0.35, 0.05),
  bath: new THREE.Color(0.3, 0.42, 0.55),
};
/** duração de cada reação (s) */
const REACTIONS = {
  eat: 1.3, drink: 1.2, bath: 1.8, hop: 1.3, spin: 1.1, caress: 0.8, refuse: 0.8, heal: 1.4, wake: 0.9, sleep: 0.6,
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Um bichinho em cena: modelo + pose + reações. */
export class PetActor {
  constructor(model, pet) {
    this.model = model;
    this.pet = pet;
    this.group = new THREE.Group();
    this.group.name = `bichinho-${pet.id}`;
    this.pose = new THREE.Group();
    this.group.add(this.pose);
    this.pose.add(model.root);
    model.root.position.set(0, 0, 0);
    model.root.quaternion.identity();
    model.root.scale.setScalar(1);
    this.size = model.info.size || [1, 1, 1];
    this.state = { sleeping: false, sick: false, dirty: false, mood: 'bem' };
    this.reactions = [];
    this.tint = TINT.normal.clone();
    this.glow = new THREE.Color(0, 0, 0);
    this.sleepBlend = 0;
    this.time = Math.random() * 10;
    this.resetPose();
  }

  /** Altura do topo do bichinho (unidades do modelo, antes da escala). */
  get height() {
    return this.size[1] + (this.model.hover ? this.pet.lift || 0 : 0);
  }

  resetPose() {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, this.pet.yaw ?? -0.6, 0);
    this.group.scale.setScalar(this.pet.scale ?? 1);
  }

  setState(state) {
    Object.assign(this.state, state);
  }

  react(type) {
    if (!REACTIONS[type]) return;
    this.reactions = this.reactions.filter((r) => r.type !== type);
    this.reactions.push({ type, t: 0, duration: REACTIONS[type] });
    if (type === 'heal') this.glow.copy(GLOW.heal);
    if (type === 'spin') this.glow.copy(GLOW.magic);
    if (type === 'bath') this.glow.copy(GLOW.bath);
    if (type === 'hop' || type === 'spin') this.model.pop?.();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const s = this.state;
    this.sleepBlend += ((s.sleeping ? 1 : 0) - this.sleepBlend) * Math.min(1, dt * 2.5);
    const awake = 1 - this.sleepBlend;

    let x = 0;
    let y = 0;
    let rx = 0;
    let ry = 0.22 * Math.sin(t * 0.45) * awake; // olha em volta
    let rz = 0;
    let sx = 1;
    let sy = 1;
    // dormindo: encolhe, abaixa a cabeça e respira devagar
    sy *= 1 - 0.13 * this.sleepBlend;
    sx *= 1 + 0.04 * this.sleepBlend;
    rx += 0.1 * this.sleepBlend;
    if (s.sick && !s.sleeping) {
      rx += 0.07;
      x += 0.006 * Math.sin(t * 38); // tremedeira
    } else if (s.mood === 'triste') {
      rx += 0.06;
    } else if (s.mood === 'feliz' && !s.sleeping) {
      y += 0.02 * Math.max(0, Math.sin(t * 2.6)) ** 6; // pulinhos de alegria
    }

    for (const r of this.reactions) {
      r.t += dt;
      const k = Math.min(1, r.t / r.duration);
      const fade = 1 - k;
      switch (r.type) {
        case 'eat':
          rx += 0.2 * Math.abs(Math.sin(r.t * 12)) * fade;
          break;
        case 'drink':
          rx += 0.16 * (0.6 + 0.4 * Math.sin(r.t * 9)) * fade;
          break;
        case 'bath':
          rz += 0.12 * Math.sin(r.t * 24) * fade;
          ry += 0.1 * Math.sin(r.t * 11) * fade;
          break;
        case 'hop':
          y += 0.18 * Math.abs(Math.sin((r.t * Math.PI) / 0.43)) * fade;
          break;
        case 'spin':
          ry += Math.PI * 2 * easeInOut(k);
          y += 0.14 * Math.sin(Math.PI * k);
          break;
        case 'caress':
          sy *= 1 - 0.08 * Math.sin(r.t * 15) * fade;
          sx *= 1 + 0.04 * Math.sin(r.t * 15) * fade;
          break;
        case 'refuse':
          ry += 0.32 * Math.sin(r.t * 17) * fade;
          break;
        case 'wake':
          y += 0.1 * Math.sin(Math.PI * k);
          break;
        default:
          break;
      }
    }
    this.reactions = this.reactions.filter((r) => r.t < r.duration);

    this.pose.position.set(x, y, 0);
    this.pose.rotation.set(rx, ry, rz);
    this.pose.scale.set(sx, sy, sx);
    // a sombra fica no chão quando o bichinho pula
    this.model.shadow.position.y = 0.003 - y / Math.max(sy, 0.01);
    this.model.shadow.material.opacity = Math.max(0.35, 1 - y * 3);

    const tint = s.sick ? TINT.sick : s.dirty ? TINT.dirty : TINT.normal;
    this.tint.lerp(tint, Math.min(1, dt * 2));
    this.glow.multiplyScalar(Math.max(0, 1 - dt * 1.6));
    for (const m of this.model.materials) {
      m.color.copy(this.tint);
      m.emissive.copy(this.glow);
    }
    let intensity = 1;
    if (s.sleeping) intensity = 0.08;
    else if (s.sick) intensity = 0.4;
    else if (s.mood === 'triste') intensity = 0.65;
    else if (s.mood === 'feliz') intensity = 1.25;
    this.model.animator.intensity += (intensity - this.model.animator.intensity) * Math.min(1, dt * 3);
    this.model.update(dt);
  }

  detach() {
    this.group.removeFromParent();
  }
}

/* ------------------------------------------------------------ quarto */
const VIEW = {
  fov: 30,
  /** área mínima visível na altura do bichinho (unidades do modelo) */
  minWidth: 1.75,
  minHeight: 1.3,
  /** o chão (y = 0) fica a esta fração da altura, a partir de baixo */
  floor: 0.2,
  pitch: THREE.MathUtils.degToRad(7),
};

const _v = new THREE.Vector3();

export class PetRoom {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.05, 50);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5440, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-1.5, 3, 2.5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.6);
    fill.position.set(2, 1, 1);
    this.scene.add(fill);
    this.actor = null;
    this.running = false;
    this.size = { width: 0, height: 0 };
    /** chamado quando a posição do bichinho na tela muda: ({x, y, width, height, headX, headY}) */
    this.onLayout = null;
    this._acc = 0;
    this._clock = new THREE.Clock(false);
    this._onResize = () => this.resize();
    this._onVisibility = () => this._visibility();
    this._resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this._onResize) : null;
  }

  /** WebGL disponível neste aparelho? */
  static available() {
    try {
      getRenderer();
      return true;
    } catch {
      return false;
    }
  }

  setActor(actor) {
    if (this.actor && this.actor !== actor) this.actor.detach();
    this.actor = actor;
    if (actor) {
      actor.resetPose();
      this.scene.add(actor.group);
    }
    this.layout();
  }

  start() {
    if (this.running) return;
    const renderer = getRenderer();
    this.container.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, AR.maxPixelRatio));
    this.running = true;
    this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._resizeObserver?.observe(this.container);
    this._clock.start();
    renderer.setAnimationLoop(() => this._loop());
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const renderer = getRenderer();
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._resizeObserver?.disconnect();
    if (renderer.domElement.parentNode === this.container) {
      renderer.clear();
      renderer.domElement.remove();
    }
    this._clock.stop();
  }

  resize() {
    if (!this.running) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    getRenderer().setSize(width, height);
    const cam = this.camera;
    cam.aspect = width / height;
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const viewH = Math.max(VIEW.minHeight, VIEW.minWidth / cam.aspect);
    const distance = viewH / (2 * tan);
    const targetY = (0.5 - VIEW.floor) * viewH;
    cam.position.set(0, targetY + distance * Math.tan(VIEW.pitch), distance);
    cam.lookAt(0, targetY, 0);
    cam.updateProjectionMatrix();
    this.size = { width, height };
    this.layout();
  }

  /** Ponto do mundo → pixels dentro do quarto. */
  toScreen(point) {
    _v.copy(point).project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.size.width, y: (-_v.y * 0.5 + 0.5) * this.size.height };
  }

  /** Retângulo do bichinho na tela (para o toque de carinho e os balões). */
  layout() {
    const actor = this.actor;
    if (!actor || !this.size.width) return null;
    actor.group.updateMatrixWorld(true);
    const [w, , d] = actor.size;
    const h = actor.height;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cx of [-w / 2, w / 2]) {
      for (const cy of [0, h]) {
        for (const cz of [-d / 2, d / 2]) {
          const p = this.toScreen(_v.set(cx, cy, cz).applyMatrix4(actor.group.matrixWorld));
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
    const head = this.toScreen(_v.set(0, h, 0).applyMatrix4(actor.group.matrixWorld));
    const rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY, headX: head.x, headY: head.y };
    this.rect = rect;
    this.onLayout?.(rect);
    return rect;
  }

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);
    // ~30 quadros por segundo bastam para um bichinho e poupam bateria
    this._acc += dt;
    if (this._acc < 1 / 32) return;
    const step = Math.min(this._acc, 0.1);
    this._acc = 0;
    this.actor?.update(step);
    const renderer = getRenderer();
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
  }

  _visibility() {
    if (!this.running) return;
    const renderer = getRenderer();
    if (document.visibilityState === 'hidden') {
      renderer.setAnimationLoop(null);
    } else {
      this._clock.getDelta();
      renderer.setAnimationLoop(() => this._loop());
    }
  }
}
