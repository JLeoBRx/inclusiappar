/**
 * Reconhecimento dos sinais das VOGAIS em LIBRAS (A, E, I, O, U) a partir dos
 * 21 pontos da mão que o MediaPipe Hand Landmarker devolve.
 *
 * Usa os pontos 3D "do mundo" (worldLandmarks, em metros, centrados na mão):
 * as medidas abaixo não dependem da distância até a câmera, do lado da mão
 * (direita/esquerda) nem de a mão estar um pouco girada.
 *
 * Pontos do MediaPipe:  0 punho · polegar 1–4 · indicador 5–8 · médio 9–12
 *                       anelar 13–16 · mínimo 17–20  (4, 8, 12, 16, 20 = pontas)
 *
 * Como cada vogal é reconhecida (configuração de mão):
 *   A  mão fechada, polegar esticado para cima ao lado do indicador
 *   E  dedos dobrados, polegar dobrado cruzando a palma, por baixo das pontas
 *   I  mão fechada, só o dedo mínimo esticado
 *   O  dedos curvos, ponta do polegar encostando na ponta do indicador
 *   U  indicador e médio esticados, anelar e mínimo fechados
 *
 * Cada vogal recebe uma nota de 0 a 1 (o quanto a mão combina com ela).
 * Funções puras, sem DOM: testadas em tests/unit/handSigns.test.mjs.
 */

export const SIGN_VOWELS = ['A', 'E', 'I', 'O', 'U'];

const FINGERS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

/* ---------------- vetores ---------------- */
const vec = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (norm(a) || 1));
const dist = (a, b) => norm(sub(a, b));
const angle = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;

/** 0 quando x ≤ lo, 1 quando x ≥ hi (rampa linear); com lo > hi, inverte. */
export function ramp(x, lo, hi) {
  if (lo === hi) return x >= hi ? 1 : 0;
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
}

/**
 * Medidas da mão (todas sem unidade):
 *   fingers.<dedo>.straight  0,3 (fechado) … 1 (esticado): ponta→base ÷ comprimento do dedo
 *   fingers.<dedo>.height    altura da ponta ao longo da palma ÷ comprimento da palma
 *   fingers.<dedo>.pip       ângulo da articulação do meio (graus; 0 = reto)
 *   fingers.<dedo>.mcp       ângulo da junta da base (graus; ~90 = mão fechada)
 *   thumb.straight           o polegar está esticado? (0,7 … 1)
 *   thumb.across             posição da ponta do polegar de lado a lado da palma:
 *                            < 0 fora da mão, do lado do indicador · 0 indicador · 1 mínimo
 *   thumb.height             altura da ponta do polegar ÷ comprimento da palma
 *   thumb.toIndexTip         distância ponta do polegar → ponta do indicador ÷ palma
 */
export function handFeatures(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  const P = landmarks.map(vec);
  if (P.some((p) => p.some((c) => !Number.isFinite(c)))) return null;
  const palm = dist(P[0], P[9]);
  const width = dist(P[5], P[17]);
  if (!(palm > 1e-6) || !(width > 1e-6)) return null;
  const up = unit(sub(P[9], P[0]));
  const side = sub(P[17], P[5]);
  const across = unit(sub(side, scale(up, dot(side, up))));
  const normal = cross(up, across);

  const fingers = {};
  for (const [name, [mcp, pip, dip, tip]] of Object.entries(FINGERS)) {
    const length = dist(P[mcp], P[pip]) + dist(P[pip], P[dip]) + dist(P[dip], P[tip]);
    fingers[name] = {
      straight: dist(P[mcp], P[tip]) / length,
      height: dot(sub(P[tip], P[0]), up) / palm,
      pip: angle(sub(P[pip], P[mcp]), sub(P[dip], P[pip])),
      mcp: angle(sub(P[mcp], P[0]), sub(P[pip], P[mcp])),
    };
  }
  const thumbTip = P[4];
  const thumb = {
    straight: dist(P[2], thumbTip) / (dist(P[2], P[3]) + dist(P[3], thumbTip)),
    across: dot(sub(thumbTip, P[5]), across) / width,
    height: dot(sub(thumbTip, P[0]), up) / palm,
    out: Math.abs(dot(sub(thumbTip, P[0]), normal)) / palm,
    toIndexTip: dist(thumbTip, P[8]) / palm,
    toMiddleTip: dist(thumbTip, P[12]) / palm,
  };
  return { fingers, thumb, gapIndexMiddle: dist(P[8], P[12]) / width };
}

/** Quanto o dedo está esticado (0 … 1), combinando "reto" e "ponta alta". */
function extended(f, name) {
  const byShape = ramp(f.straight, 0.62, 0.86);
  const byHeight = name === 'pinky' ? ramp(f.height, 0.95, 1.3) : ramp(f.height, 1.15, 1.5);
  return (byShape + byHeight) / 2;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Notas (0 … 1) de cada vogal para as medidas de uma mão. */
export function scoreVowels(features) {
  const { fingers: F, thumb: T } = features;
  const ext = Object.fromEntries(Object.keys(FINGERS).map((n) => [n, extended(F[n], n)]));
  const closed = (n) => 1 - ext[n];
  const fist = Math.min(closed('index'), closed('middle'), closed('ring'), closed('pinky'));

  // polegar aberto para fora da mão (formatos como Y ou "3" não são vogais)
  const thumbIn = ramp(T.across, -0.55, -0.25);

  // A: mão fechada + polegar esticado, para cima e do lado do indicador
  const A = Math.min(
    fist,
    ramp(T.height, 0.85, 1.0),
    ramp(T.across, 0.4, 0.15),
    ramp(T.straight, 0.85, 0.95),
  );

  // E: dedos dobrados (não esticados) + polegar cruzando a palma, baixo.
  // Diferente da mão fechada (S): os dedos dobram pouco na base.
  const bent = Math.min(...Object.keys(FINGERS).map((n) => ramp(F[n].straight, 0.97, 0.85)));
  const E = Math.min(
    bent,
    1 - Math.max(ext.index, ext.middle) * ramp(F.index.pip, 25, 10), // indicador e médio não podem estar retos
    ramp(mean([F.index.mcp, F.middle.mcp]), 72, 52),
    ramp(T.across, 0.2, 0.45),
    ramp(T.height, 1.2, 1.0),
    ramp(closed('pinky'), 0.3, 0.6),
  );

  // I: só o mínimo esticado (polegar recolhido)
  const I = Math.min(ext.pinky, closed('index'), closed('middle'), closed('ring'), thumbIn);

  // O: dedos curvos (nem retos, nem fechados) + polegar tocando a ponta do indicador
  const curved = mean(['index', 'middle'].map((n) => ramp(F[n].pip, 12, 28)));
  const O = Math.min(
    curved,
    ramp(F.index.height, 0.88, 1.03), // a ponta do indicador fica no alto (não é mão fechada)
    ramp(T.toIndexTip, 0.6, 0.38),
    ramp(T.height, 0.75, 0.9),
    ramp(T.across, 0.5, 0.3),
    1 - ext.pinky * 0.8,
  );

  // U: indicador e médio esticados, anelar e mínimo fechados, polegar recolhido
  const U = Math.min(
    ext.index, ext.middle, closed('ring'), closed('pinky'),
    ramp(features.gapIndexMiddle, 1.3, 0.9),
    ramp(T.toIndexTip, 0.45, 0.7),
    thumbIn,
  );

  return { A, E, I, O, U };
}

/**
 * Classifica uma mão: { vowel, score, scores, features } — vowel = null quando
 * nenhuma vogal passa de `minScore`.
 */
export function classifyHand(landmarks, { minScore = 0.5 } = {}) {
  const features = handFeatures(landmarks);
  if (!features) return null;
  const scores = scoreVowels(features);
  let vowel = null;
  let score = 0;
  for (const v of SIGN_VOWELS) {
    if (scores[v] > score) {
      score = scores[v];
      vowel = v;
    }
  }
  return { vowel: score >= minScore ? vowel : null, score, scores, features };
}
