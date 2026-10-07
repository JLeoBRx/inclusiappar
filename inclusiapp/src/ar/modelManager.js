/**
 * Modelos 3D dos animais: carregamento sob demanda, cache e animação.
 *
 * Os GLB (assets/models/*.glb) vêm normalizados pelo conversor: Y para cima,
 * olhando para +Z, patas em y = 0 e maior dimensão = 1. Cada animal ganha:
 *   - material com cores por região, padrões e partes animadas (asas, cauda...)
 *   - "respiração" e, para a abelha, voo pairando
 *   - sombra de contato (deixa o animal "pousado" na página)
 *   - animação de entrada (pop) ao aparecer
 */
import * as THREE from '../lib/three.js';
import { createAnimalMaterial, PartAnimator } from './animalMaterial.js';

const loader = new THREE.GLTFLoader();
const gltfCache = new Map();
const instances = new Map();

function loadGLTF(url) {
  if (!gltfCache.has(url)) {
    gltfCache.set(url, loader.loadAsync(url).catch((err) => {
      gltfCache.delete(url);
      throw err;
    }));
  }
  return gltfCache.get(url);
}

let shadowTexture = null;
function getShadowTexture() {
  if (!shadowTexture) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    shadowTexture = new THREE.CanvasTexture(canvas);
  }
  return shadowTexture;
}

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

export class AnimalModel {
  constructor(gltf, animal) {
    this.animal = animal;
    const scene = gltf.scene;
    const info = scene.children[0]?.userData || {};
    this.info = info;

    /** `root` é o que se move (página ↔ modo interação) */
    this.root = new THREE.Group();
    this.root.name = `animal-${animal.id}`;
    /** `body` recebe as animações de vida (pairar, respirar, pop) */
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.body.add(scene);

    this.materials = [];
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const wings = obj.material?.name === 'asas';
      obj.material = createAnimalMaterial({
        parts: info.parts || [],
        pattern: wings ? null : info.pattern,
        transparent: wings,
        opacity: wings ? 0.42 : 1,
      });
      obj.frustumCulled = false;
      obj.renderOrder = wings ? 2 : 1;
      this.materials.push(obj.material);
    });
    this.animator = new PartAnimator(info.parts || [], this.materials);

    const size = info.size || [1, 1, 1];
    const footprint = Math.max(size[0], size[2]) * 0.9;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(footprint, footprint * (size[2] > size[0] ? 1 : 0.8)),
      new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.003;
    this.shadow.renderOrder = 0;
    this.root.add(this.shadow);

    this.hover = !!info.hover;
    this.hoverHeight = animal.lift || 0;
    this.time = Math.random() * 10;
    this.popT = 1;
  }

  /** Animação de entrada. */
  pop() {
    this.popT = 0;
  }

  update(dt) {
    this.time += dt;
    this.animator.update(dt);
    const t = this.time;
    let scale = 1 + 0.012 * Math.sin(t * 2.1); // respiração
    if (this.popT < 1) {
      this.popT = Math.min(1, this.popT + dt / 0.5);
      scale *= Math.max(0.001, easeOutBack(this.popT));
    }
    this.body.scale.setScalar(scale);
    if (this.hover) {
      // voo pairando em "oito", com leve inclinação
      const lift = this.hoverHeight / Math.max(this.root.scale.x, 1e-3);
      this.body.position.set(0.05 * Math.sin(t * 0.9), lift + 0.035 * Math.sin(t * 2.4), 0.04 * Math.sin(t * 1.8));
      this.body.rotation.set(0.08 * Math.sin(t * 2.4 + 0.6), 0.25 * Math.sin(t * 0.45), 0.05 * Math.sin(t * 1.8));
      this.shadow.scale.setScalar(0.85 - 0.08 * Math.sin(t * 2.4));
      this.shadow.material.opacity = 0.75;
    } else {
      this.body.position.set(0, 0, 0);
      this.body.rotation.set(0, 0, 0);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
  }
}

/** Devolve (carregando se preciso) a instância 3D de um animal. */
export async function getAnimalModel(animal) {
  if (!instances.has(animal.id)) {
    const promise = loadGLTF(animal.model).then((gltf) => new AnimalModel(gltf, animal));
    instances.set(animal.id, promise);
    promise.catch(() => instances.delete(animal.id));
  }
  return instances.get(animal.id);
}

/** Baixa o GLB em segundo plano (sem criar a instância). */
export function prefetchModel(animal) {
  loadGLTF(animal.model).catch(() => {});
}

/** Libera todos os modelos (ex.: memória baixa). */
export async function disposeAllModels() {
  for (const promise of instances.values()) {
    try {
      (await promise).dispose();
    } catch { /* ignorado */ }
  }
  instances.clear();
  gltfCache.clear();
}
