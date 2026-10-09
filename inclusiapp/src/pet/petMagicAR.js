/**
 * CARTAS MÁGICAS em Realidade Aumentada.
 *
 * Reaproveita a infraestrutura de AR do app sem mudar nada nela:
 *   - ARSession (câmera + MindAR + Three.js), com os MESMOS alvos e o MESMO
 *     Controller do Jogo de Cartas (id 'game'): nada é baixado ou compilado
 *     duas vezes;
 *   - buildCardList() do Jogo de Cartas para saber qual carta (cartaN.png)
 *     corresponde a cada alvo reconhecido.
 *
 * Na tela: a câmera, o bichinho em 3D no canto e, sobre a carta reconhecida,
 * um círculo mágico com o item da magia saindo dela.
 */
import * as THREE from '../lib/three.js';
import { AR, GAME } from '../config.js';
import { ARSession } from '../ar/arSession.js';
import { loadTargets } from '../ar/targets.js';
import { buildCardList } from '../game/cardGame.js';

const textures = new Map();
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

function canvasTexture(key, draw, size = 256) {
  if (!textures.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, tex);
  }
  return textures.get(key);
}

function emojiTexture(emoji) {
  return canvasTexture(`emoji:${emoji}`, (ctx, size) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(size * 0.74)}px ${EMOJI_FONT}`;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = size * 0.05;
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  }, 160);
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.32 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function ringTexture() {
  return canvasTexture('ring', (ctx, size) => {
    const c = size / 2;
    const glow = ctx.createRadialGradient(c, c, size * 0.18, c, c, c);
    glow.addColorStop(0, 'rgba(255,236,170,0)');
    glow.addColorStop(0.6, 'rgba(255,214,110,0.28)');
    glow.addColorStop(0.78, 'rgba(255,236,170,0.85)');
    glow.addColorStop(0.84, 'rgba(214,150,255,0.55)');
    glow.addColorStop(1, 'rgba(170,90,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = size * 0.012;
    for (const r of [0.8, 0.62]) {
      ctx.beginPath();
      ctx.arc(c, c, c * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff6d0';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      star(ctx, c + Math.cos(a) * c * 0.71, c + Math.sin(a) * c * 0.71, size * (i % 3 ? 0.022 : 0.04));
    }
  });
}

function sparkTexture() {
  return canvasTexture('spark', (ctx, size) => {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,240,170,0.9)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    star(ctx, c, c, c * 0.9);
  }, 64);
}

const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Círculo mágico + item subindo da carta + faíscas. */
class MagicBurst {
  constructor(anchor, emoji) {
    this.group = new THREE.Group();
    anchor.add(this.group);
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, depthTest: false }),
    );
    this.ring.position.z = 0.02;
    this.ring.renderOrder = 5;
    this.item = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthTest: false }));
    this.item.renderOrder = 7;
    this.sparks = Array.from({ length: 10 }, (_, i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, depthTest: false }));
      s.renderOrder = 6;
      s.userData = { angle: (i / 10) * Math.PI * 2 + Math.random() * 0.4, speed: 0.6 + Math.random() * 0.6, size: 0.06 + Math.random() * 0.07 };
      return s;
    });
    this.group.add(this.ring, this.item, ...this.sparks);
    this.t = 0;
    this.duration = 2.6;
  }

  get done() {
    return this.t >= this.duration;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const k = Math.min(1, t / this.duration);
    const fade = k < 0.75 ? 1 : Math.max(0, (1 - k) / 0.25);
    this.ring.scale.setScalar(Math.max(0.001, easeOutBack(Math.min(1, t / 0.5))) * (1 + 0.05 * Math.sin(t * 7)));
    this.ring.rotation.z += dt * 1.4;
    this.ring.material.opacity = fade;
    const rise = Math.min(1, t / 0.9);
    this.item.position.set(0, 0.05 * Math.sin(t * 3), 0.08 + 0.55 * (1 - (1 - rise) ** 3));
    this.item.scale.setScalar(Math.max(0.001, 0.6 * easeOutBack(Math.min(1, t / 0.55))));
    this.item.material.opacity = fade;
    for (const s of this.sparks) {
      const { angle, speed, size } = s.userData;
      const r = 0.25 + 0.55 * k * speed;
      s.position.set(Math.cos(angle + t * 1.8) * r, Math.sin(angle + t * 1.8) * r, 0.05 + k * 0.7 * speed);
      s.scale.setScalar(size * (1 + 0.4 * Math.sin(t * 10 + angle)));
      s.material.opacity = fade * (0.6 + 0.4 * Math.sin(t * 12 + angle));
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.item.material.dispose();
    this.sparks.forEach((s) => s.material.dispose());
  }
}

const _v = new THREE.Vector3();

export class MagicScanner {
  constructor(stageEl) {
    this.stageEl = stageEl;
    this.session = null;
    this.actor = null;
    this.bursts = [];
    /** (card: {index, id, label, file}) => void */
    this.onCard = null;
    this.onStatus = null;
    this.onCameraEnded = null;
  }

  get running() {
    return !!this.session?.running;
  }

  /** Liga a câmera. Lança ARError se não der (câmera negada, sem WebGL...). */
  async open(actor) {
    const session = new ARSession({ container: this.stageEl, targets: GAME.targets, id: 'game', tuning: AR.game });
    this.session = session;
    session.onStatus = (step, progress) => this.onStatus?.(step, progress);
    session.onFrame = (dt) => this._frame(dt);
    session.onResize = () => this._placePet();
    session.onCameraEnded = () => this.onCameraEnded?.();
    session.scene.add(new THREE.HemisphereLight(0xfff6e5, 0x4a3b2a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-300, 900, 600);
    session.scene.add(sun);
    this.petStage = new THREE.Group();
    session.scene.add(this.petStage);
    this.actor = actor || null;
    if (this.actor) {
      this.petStage.add(this.actor.group);
      this.actor.group.position.set(0, 0, 0);
      this.actor.group.rotation.set(0, 0.7, 0);
      this.actor.group.scale.setScalar(1);
    }
    try {
      await session.start();
    } catch (err) {
      if (this.session === session) this.session = null;
      this.actor?.detach();
      await session.stop();
      throw err;
    }
    if (this.session !== session) return false;
    const { manifest } = await loadTargets(GAME.targets);
    if (this.session !== session) return false;
    this.cards = buildCardList(manifest, session.targetCount);
    this.byIndex = new Map(this.cards.map((c) => [c.index, c]));
    session.onTargetFound = (index) => this._found(index);
    this._placePet();
    // a carta pode já estar na frente da câmera
    session.visibleTargets.forEach((index) => this._found(index));
    return true;
  }

  async close() {
    const session = this.session;
    this.session = null;
    this.bursts.forEach((b) => b.dispose());
    this.bursts = [];
    this.actor?.detach();
    this.actor = null;
    if (!session) return;
    session.onTargetFound = session.onTargetLost = null;
    await session.stop();
  }

  isVisible(index) {
    return !!this.session?.isVisible(index);
  }

  _found(index) {
    const card = this.byIndex?.get(index);
    if (card) this.onCard?.(card);
  }

  /** Efeito mágico sobre a carta. */
  burst(index, emoji) {
    if (!this.session) return;
    this.bursts.push(new MagicBurst(this.session.anchor(index), emoji));
  }

  _toScreen(point) {
    const { camera, viewport } = this.session;
    _v.copy(point).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * viewport.width, y: (-_v.y * 0.5 + 0.5) * viewport.height };
  }

  /** Centro da carta na tela (px), ou null se ela não estiver visível. */
  cardPoint(index) {
    if (!this.session?.viewport || !this.session.isVisible(index)) return null;
    const anchor = this.session.anchor(index);
    anchor.updateWorldMatrix(true, false);
    return this._toScreen(_v.set(0, 0, 0.3).applyMatrix4(anchor.matrixWorld));
  }

  /** Cabeça do bichinho na tela (px). */
  petPoint() {
    if (!this.session?.viewport || !this.actor) return null;
    this.actor.group.updateWorldMatrix(true, false);
    return this._toScreen(_v.set(0, this.actor.height * 0.8, 0).applyMatrix4(this.actor.group.matrixWorld));
  }

  /** Bichinho no canto de baixo, sempre de frente para a câmera. */
  _placePet() {
    const session = this.session;
    if (!session?.viewport || !this.petStage) return;
    const { width, height } = session.viewport;
    const cam = session.camera;
    const distance = 1000;
    const viewH = 2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const viewW = viewH * cam.aspect;
    const portrait = height >= width;
    const size = Math.min(viewH * (portrait ? 0.26 : 0.4), viewW * (portrait ? 0.46 : 0.28));
    const bottom = ((portrait ? 112 : 84) / height) * viewH;
    this.petStage.position.set(-viewW / 2 + size * 0.72, -viewH / 2 + bottom, -distance);
    this.petStage.rotation.set(0.32, 0, 0);
    this.petStage.scale.setScalar(size);
  }

  _frame(dt) {
    this.actor?.update(dt);
    for (const b of this.bursts) b.update(dt);
    if (this.bursts.some((b) => b.done)) {
      this.bursts.filter((b) => b.done).forEach((b) => b.dispose());
      this.bursts = this.bursts.filter((b) => !b.done);
    }
  }
}
