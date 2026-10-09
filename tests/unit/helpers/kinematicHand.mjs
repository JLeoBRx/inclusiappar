/**
 * Mão "ideal" para testes: calcula os 21 pontos do MediaPipe a partir de
 * ângulos das articulações (cm, referencial da mão):
 *   x → lado do polegar · y → para cima (dedos) · z → para fora da palma
 * Depois gira a mão em qualquer direção e espelha (mão esquerda), para
 * conferir que o classificador não depende da posição da mão na câmera.
 */
const DEG = Math.PI / 180;

const MCP = { index: [2.2, 8.4, 0], middle: [0.2, 8.8, 0], ring: [-1.7, 8.3, 0], pinky: [-3.3, 7.4, 0] };
const LENGTHS = { index: [3.9, 2.3, 1.9], middle: [4.4, 2.7, 2.0], ring: [4.1, 2.6, 2.0], pinky: [3.2, 1.9, 1.8] };
const FAN = { index: 6, middle: 1, ring: -5, pinky: -12 }; // leque natural dos dedos (graus)
const FIRST = { thumb: 1, index: 5, middle: 9, ring: 13, pinky: 17 };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a, b, t) => add(mul(a, 1 - t), mul(b, t));

function dir(spread, alpha) {
  const s = spread * DEG;
  const a = alpha * DEG;
  return [Math.sin(s) * Math.cos(a), Math.cos(s) * Math.cos(a), Math.sin(a)];
}

/** Pontas e articulações de um dedo: curl = [MCP, PIP, DIP] em graus. */
function finger(name, { curl = [0, 0, 0], spread = 0 } = {}) {
  const pts = [MCP[name]];
  let alpha = 0;
  for (let i = 0; i < 3; i++) {
    alpha += curl[i];
    pts.push(add(pts[i], mul(dir(FAN[name] + spread, alpha), LENGTHS[name][i])));
  }
  return pts;
}

const FIST = { curl: [90, 100, 60] };
const STRAIGHT = { curl: [0, 0, 0] };

/** Poses (posições do polegar em cm: [CMC, MCP, IP, ponta]). */
export const POSES = {
  open: {
    fingers: { index: STRAIGHT, middle: STRAIGHT, ring: STRAIGHT, pinky: STRAIGHT },
    thumb: [[2.6, 2.4, 0.8], [4.6, 4.6, 1.6], [6.4, 6.4, 2.2], [7.6, 7.6, 2.5]],
  },
  A: {
    fingers: { index: FIST, middle: FIST, ring: FIST, pinky: FIST },
    thumb: [[2.6, 2.4, 1.0], [3.9, 4.8, 1.8], [4.3, 7.5, 2.0], [4.3, 9.4, 2.1]],
  },
  E: {
    fingers: { index: { curl: [40, 100, 70] }, middle: { curl: [40, 100, 70] }, ring: { curl: [40, 100, 70] }, pinky: { curl: [40, 100, 70] } },
    thumb: [[2.6, 2.4, 1.0], [3.0, 4.6, 2.4], [0.8, 5.6, 2.9], [-1.2, 5.9, 2.9]],
  },
  I: {
    fingers: { index: FIST, middle: FIST, ring: FIST, pinky: STRAIGHT },
    thumb: [[2.6, 2.4, 1.0], [3.4, 4.8, 3.0], [1.6, 6.2, 4.8], [-0.3, 6.6, 4.9]],
  },
  O: {
    fingers: { index: { curl: [45, 60, 35] }, middle: { curl: [47, 62, 35] }, ring: { curl: [50, 64, 35] }, pinky: { curl: [52, 66, 35] } },
    thumb: 'meet-index',
  },
  U: {
    fingers: { index: { curl: [0, 0, 0], spread: -6 }, middle: { curl: [0, 0, 0], spread: 1 }, ring: FIST, pinky: FIST },
    thumb: [[2.6, 2.4, 1.0], [3.2, 4.6, 3.0], [0.8, 6.0, 4.5], [-1.4, 6.3, 4.4]],
  },
  // formatos que NÃO são vogais
  S: { // mão fechada com o polegar por cima dos dedos
    fingers: { index: FIST, middle: FIST, ring: FIST, pinky: FIST },
    thumb: [[2.6, 2.4, 1.0], [3.4, 4.8, 3.0], [1.6, 6.2, 4.8], [-0.3, 6.6, 4.9]],
  },
  V: { // indicador e médio abertos em V
    fingers: { index: { curl: [0, 0, 0], spread: 10 }, middle: { curl: [0, 0, 0], spread: -14 }, ring: FIST, pinky: FIST },
    thumb: [[2.6, 2.4, 1.0], [3.2, 4.6, 3.0], [0.8, 6.0, 4.5], [-1.4, 6.3, 4.4]],
  },
  Y: { // mínimo e polegar abertos ("hang loose")
    fingers: { index: FIST, middle: FIST, ring: FIST, pinky: STRAIGHT },
    thumb: [[2.6, 2.4, 0.8], [4.6, 4.0, 1.2], [6.6, 5.2, 1.4], [8.2, 6.0, 1.5]],
  },
  C: { // dedos curvos, polegar longe do indicador
    fingers: { index: { curl: [30, 40, 25] }, middle: { curl: [30, 40, 25] }, ring: { curl: [32, 42, 25] }, pinky: { curl: [34, 44, 25] } },
    thumb: [[2.6, 2.4, 1.0], [4.0, 4.2, 2.8], [4.8, 5.4, 5.0], [4.6, 6.0, 6.6]],
  },
  point: { // só o indicador esticado
    fingers: { index: STRAIGHT, middle: FIST, ring: FIST, pinky: FIST },
    thumb: [[2.6, 2.4, 1.0], [3.4, 4.8, 3.0], [1.6, 6.2, 4.8], [-0.3, 6.6, 4.9]],
  },
};

/** 21 pontos [x, y, z] (cm) de uma pose no referencial da mão. */
export function handPoints(pose) {
  const pts = new Array(21);
  pts[0] = [0, 0, 0];
  for (const name of ['index', 'middle', 'ring', 'pinky']) {
    finger(name, pose.fingers[name]).forEach((p, i) => { pts[FIRST[name] + i] = p; });
  }
  let thumb = pose.thumb;
  if (thumb === 'meet-index') {
    const tip = add(pts[8], [0.4, -0.6, 0.3]);
    const cmc = [2.6, 2.4, 1.0];
    const mcp = [3.9, 4.6, 2.9];
    const ip = add(lerp(mcp, tip, 0.55), [0.9, -0.4, 0.9]);
    thumb = [cmc, mcp, ip, tip];
  }
  thumb.forEach((p, i) => { pts[1 + i] = p; });
  return pts;
}

/** Rotação 3D (graus) + espelho opcional (mão esquerda) + escala (cm → m). */
export function transform(points, { yaw = 0, pitch = 0, roll = 0, mirror = false, scale = 0.01, noise = 0, random = Math.random } = {}) {
  const [a, b, c] = [yaw * DEG, pitch * DEG, roll * DEG];
  const rot = (p) => {
    let [x, y, z] = p;
    [x, z] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)]; // em torno de y
    [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)]; // em torno de x
    [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]; // em torno de z
    return [x, y, z];
  };
  return points.map((p) => {
    const q = rot(mirror ? [-p[0], p[1], p[2]] : p).map((v) => v * scale + (noise ? (random() - 0.5) * 2 * noise : 0));
    return { x: q[0], y: q[1], z: q[2] };
  });
}
