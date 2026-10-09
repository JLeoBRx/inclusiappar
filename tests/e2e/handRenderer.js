/**
 * Mão 3D articulada para gerar imagens de teste dos sinais das vogais.
 *
 *   await handLab.ready
 *   handLab.setHand('right' | 'left')
 *   handLab.setPose(handLab.POSES.A)         // ângulos das articulações (graus)
 *   handLab.render({ yaw, pitch, roll, background, distance }) → dataURL (JPEG)
 *
 * Os eixos de cada articulação são calculados pela geometria do modelo em
 * repouso (direção do osso × normal da palma), então "dobrar" sempre leva o
 * dedo em direção à palma, qualquer que seja a convenção do arquivo .glb.
 * Modelo: "generic-hand" do WebXR Input Profiles (MIT) — ver
 * tests/fixtures/hand-model/LICENSE.md.
 */
import * as THREE from '/inclusiapp/src/lib/three.js';

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const DEG = Math.PI / 180;

/* ---------------- poses ----------------
 * fingers.<dedo>.curl = [MCP, PIP, DIP] em graus (positivo = dobra para a palma)
 * fingers.<dedo>.spread  em graus (positivo = abre em direção ao dedo mínimo)
 * thumb.path = posições (mm) desejadas para [MCP, IP, ponta] do polegar no
 *   referencial da mão: [lado do polegar, para cima (dedos), à frente da palma],
 *   com origem no centro da palma. Vale para a mão direita e a esquerda.
 */
const FIST = { curl: [88, 100, 65] };
const POSES = {
  open: {},
  // A: mão fechada, polegar esticado para cima, encostado na lateral do indicador
  A: {
    fingers: { index: FIST, middle: FIST, ring: FIST, pinky: FIST },
    thumb: { path: [[38, 18, 27], [41, 50, 30], [41, 64, 31]] },
  },
  // E: dedos dobrados com as pontas apoiadas no polegar, que cruza a palma
  E: {
    fingers: {
      index: { curl: [38, 100, 75] }, middle: { curl: [38, 100, 75] },
      ring: { curl: [38, 100, 75] }, pinky: { curl: [38, 100, 75] },
    },
    thumb: { path: [[22, 10, 34], [-4, 24, 36], [-18, 28, 34]] },
  },
  // I: mão fechada, só o dedo mínimo esticado; polegar por cima dos dedos
  I: {
    fingers: { index: FIST, middle: FIST, ring: FIST, pinky: { curl: [0, 0, 0] } },
    thumb: { path: [[36, 10, 42], [16, 27, 66], [0, 30, 66]] },
  },
  // O: dedos curvos e a ponta do polegar encostada na ponta do indicador
  O: {
    fingers: {
      index: { curl: [40, 60, 35] }, middle: { curl: [42, 62, 35] },
      ring: { curl: [45, 64, 35] }, pinky: { curl: [48, 66, 35] },
    },
    thumb: { path: [[30, 12, 45], [24, 40, 66], [20, 60, 70]] },
  },
  // U: indicador e médio esticados e juntos, anelar e mínimo fechados
  U: {
    fingers: {
      index: { curl: [0, 0, 0], spread: 4 }, middle: { curl: [0, 0, 0], spread: -4 },
      ring: FIST, pinky: FIST,
    },
    thumb: { path: [[30, 10, 42], [5, 24, 58], [-12, 27, 56]] },
  },
};

/* ---------------- cena ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(640, 480);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 640 / 480, 0.01, 10);
scene.add(new THREE.HemisphereLight(0xffffff, 0x886655, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.4, 0.8, 1);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffeedd, 0.8);
fill.position.set(-1, -0.3, 0.5);
scene.add(fill);

const pivot = new THREE.Group(); // gira a mão inteira (ângulo de câmera)
scene.add(pivot);

const loader = new THREE.GLTFLoader();
const hands = {};
let current = null;

const boneName = (finger, part) => (finger === 'thumb' ? `thumb-${part}` : `${finger}-finger-${part}`);
const CHAIN = {
  thumb: ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'],
  ...Object.fromEntries(FINGERS.map((f) => [f, ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']])),
};

async function loadHand(side) {
  const gltf = await loader.loadAsync(`/tests/fixtures/hand-model/${side}.glb`);
  const root = gltf.scene;
  const bones = {};
  const skins = [];
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) {
      o.material = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e3a983'), roughness: 0.62, metalness: 0 });
      o.frustumCulled = false;
      skins.push(o);
    }
  });
  // No modelo do WebXR todas as articulações são filhas diretas do esqueleto
  // (sem hierarquia): a cinemática dos dedos é feita aqui, em setPose().
  const rest = Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, { p: b.position.clone(), q: b.quaternion.clone() }]));
  const at = (n) => rest[n].p.clone();

  // base da mão (no espaço do esqueleto)
  const up = at(boneName('middle', 'phalanx-proximal')).sub(at('wrist')).normalize();
  const across = at(boneName('pinky', 'phalanx-proximal')).sub(at(boneName('index', 'phalanx-proximal')));
  const normal = new THREE.Vector3().crossVectors(up, across).normalize();
  // a palma fica do lado em que o polegar repousa
  const thumbSide = at(boneName('thumb', 'phalanx-distal')).sub(at(boneName('index', 'phalanx-proximal')));
  if (normal.dot(thumbSide) < 0) normal.negate();
  const x = new THREE.Vector3().crossVectors(up, normal).normalize();
  const N = new THREE.Vector3().crossVectors(x, up).normalize(); // normal da palma
  const toPinky = across.clone().sub(N.clone().multiplyScalar(across.dot(N))).normalize();

  // orientação de base: dedos para cima (+Y), palma virada para a câmera (+Z)
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(root);
  holder.add(inner);
  holder.updateMatrixWorld(true);
  const skeleton = bones.wrist.parent;
  const armQ = skeleton.getWorldQuaternion(new THREE.Quaternion());
  const basis = new THREE.Matrix4().makeBasis(x.clone().applyQuaternion(armQ), up.clone().applyQuaternion(armQ), N.clone().applyQuaternion(armQ));
  inner.quaternion.setFromRotationMatrix(basis).invert();
  holder.updateMatrixWorld(true);
  const palm = bones[boneName('middle', 'phalanx-proximal')].getWorldPosition(new THREE.Vector3())
    .add(bones.wrist.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  inner.position.sub(palm);
  holder.updateMatrixWorld(true);

  // referencial da mão (mm → espaço do esqueleto) para as posições do polegar
  const origin = at(boneName('middle', 'phalanx-proximal')).add(at('wrist')).multiplyScalar(0.5);
  const radial = toPinky.clone().negate();
  const toSkeleton = ([r, u, n]) => origin.clone()
    .addScaledVector(radial, r / 1000).addScaledVector(up, u / 1000).addScaledVector(N, n / 1000);

  // eixos das articulações dos dedos em repouso (espaço do esqueleto)
  const axes = {};
  for (const finger of FINGERS) {
    const parts = CHAIN[finger];
    for (let i = 0; i < parts.length - 1; i++) {
      const name = boneName(finger, parts[i]);
      const d = at(boneName(finger, parts[i + 1])).sub(at(name)).normalize();
      axes[name] = {
        flex: new THREE.Vector3().crossVectors(d, N).normalize(), // leva o dedo para a palma
        spread: new THREE.Vector3().crossVectors(d, toPinky).normalize(), // abre para o lado do mínimo
      };
    }
  }
  return { side, root, holder, bones, rest, axes, skins, toSkeleton };
}

const ready = Promise.all([loadHand('right'), loadHand('left')]).then(([r, l]) => {
  hands.right = r;
  hands.left = l;
  setHand('right');
});

function setHand(side) {
  if (current) pivot.remove(current.holder);
  current = hands[side];
  pivot.add(current.holder);
}

function setSkin(color) {
  for (const h of Object.values(hands)) h.skins.forEach((s) => s.material.color.set(color));
}

/**
 * Gira as articulações de um dedo, da base para a ponta: cada rotação leva
 * junto todas as articulações seguintes (cinemática direta).
 * ops[k] = [[eixo, graus] | ['aim', ponto], ...] para a k-ésima articulação.
 */
function bend(finger, ops) {
  const h = current;
  const names = CHAIN[finger].map((part) => boneName(finger, part));
  const P = names.map((n) => h.rest[n].p.clone());
  const Q = names.map((n) => h.rest[n].q.clone());
  const acc = new THREE.Quaternion();
  const R = new THREE.Quaternion();
  for (let k = 0; k < names.length - 1; k++) {
    for (const [axisKey, value] of ops[k] || []) {
      if (axisKey === 'aim') {
        // aponta o segmento k → k+1 para um ponto
        R.setFromUnitVectors(P[k + 1].clone().sub(P[k]).normalize(), value.clone().sub(P[k]).normalize());
      } else if (value) {
        R.setFromAxisAngle(h.axes[names[k]][axisKey].clone().applyQuaternion(acc), value * DEG);
      } else continue;
      for (let i = k; i < names.length; i++) {
        if (i > k) P[i].sub(P[k]).applyQuaternion(R).add(P[k]);
        Q[i].premultiply(R);
      }
      acc.premultiply(R);
    }
  }
  names.forEach((n, i) => {
    h.bones[n].position.copy(P[i]);
    h.bones[n].quaternion.copy(Q[i]);
  });
}

function setPose(pose = {}) {
  const h = current;
  for (const [name, b] of Object.entries(h.bones)) {
    b.position.copy(h.rest[name].p);
    b.quaternion.copy(h.rest[name].q);
  }
  for (const f of FINGERS) {
    const p = pose.fingers?.[f] || {};
    const [mcp = 0, pip = 0, dip = 0] = p.curl || [];
    bend(f, [[['spread', p.spread || 0], ['flex', mcp]], [['flex', pip]], [['flex', dip]]]);
  }
  const path = pose.thumb?.path;
  if (path) bend('thumb', path.map((point) => [['aim', h.toSkeleton(point)]]));
  h.holder.updateMatrixWorld(true);
}

function render({ yaw = 0, pitch = 0, roll = 0, distance = 0.42, background = '#7b5a3c', offsetX = 0, offsetY = 0 } = {}) {
  pivot.rotation.set(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ');
  scene.background = new THREE.Color(background);
  camera.position.set(offsetX, offsetY, distance);
  camera.lookAt(offsetX, offsetY, 0);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/jpeg', 0.9);
}

/** Posições das articulações no espaço da cena (para conferir eixos). */
function info() {
  const out = {};
  const v = new THREE.Vector3();
  current.holder.updateMatrixWorld(true);
  for (const [name, b] of Object.entries(current.bones)) {
    b.getWorldPosition(v);
    out[name] = v.toArray().map((c) => +c.toFixed(4));
  }
  return out;
}

window.handLab = { ready, setHand, setSkin, setPose, render, info, POSES };
