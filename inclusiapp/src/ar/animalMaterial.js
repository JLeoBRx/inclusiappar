/**
 * Material dos animais 3D.
 *
 * Os modelos originais (Unity .asset) vieram sem texturas e sem animações.
 * O conversor (tools/convert_models.py) grava no GLB:
 *   - COLOR_0        → cores por região (corpo, cabeça, presas, barriga...)
 *   - _ANIMWEIGHTS   → até 4 "partes" animáveis, com pesos derivados do rig
 *                      original (asas, orelhas, tromba, cauda, cabeça)
 *   - _PATTERN       → onde aplicar um padrão procedural (listras, rosetas)
 *   - extras.parts   → pivô, eixo e movimento de cada parte
 *
 * Este módulo injeta, via onBeforeCompile, a rotação das partes no vertex
 * shader e o padrão procedural no fragment shader. Tudo roda na GPU: animar
 * um animal custa só a atualização de 4 floats por quadro.
 */
import * as THREE from '../lib/three.js';

export const MAX_PARTS = 4;

const PATTERN_TYPES = { none: 0, stripes: 1, rosettes: 2 };

const VERTEX_HEAD = /* glsl */`
attribute vec4 _animweights;
attribute float _pattern;
uniform vec3 uPivot[${MAX_PARTS}];
uniform vec3 uAxis[${MAX_PARTS}];
uniform float uAngle[${MAX_PARTS}];
varying vec3 vRestPos;
varying float vPattern;
mat3 animRotation(vec3 axis, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  float t = 1.0 - c;
  return mat3(
    t * axis.x * axis.x + c,          t * axis.x * axis.y + s * axis.z, t * axis.x * axis.z - s * axis.y,
    t * axis.x * axis.y - s * axis.z, t * axis.y * axis.y + c,          t * axis.y * axis.z + s * axis.x,
    t * axis.x * axis.z + s * axis.y, t * axis.y * axis.z - s * axis.x, t * axis.z * axis.z + c
  );
}
`;

const VERTEX_NORMAL = /* glsl */`
mat3 animRot[${MAX_PARTS}];
for (int i = 0; i < ${MAX_PARTS}; i++) {
  animRot[i] = animRotation(uAxis[i], uAngle[i] * _animweights[i]);
  objectNormal = animRot[i] * objectNormal;
}
`;

const VERTEX_POSITION = /* glsl */`
vRestPos = position;
vPattern = _pattern;
for (int i = 0; i < ${MAX_PARTS}; i++) {
  transformed = uPivot[i] + animRot[i] * (transformed - uPivot[i]);
}
`;

const FRAGMENT_HEAD = /* glsl */`
uniform int uPatternType;
uniform vec4 uPatternParams;
uniform vec3 uPatternColor;
uniform vec3 uPatternColor2;
varying vec3 vRestPos;
varying float vPattern;
vec3 animalHash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// Rosetas de onça: anel escuro em volta de um miolo levemente mais escuro.
// x = anel (0..1), y = miolo (0..1)
vec2 animalRosette(vec3 p) {
  vec3 cell = floor(p);
  vec3 local = fract(p);
  float best = 8.0;
  vec3 bestCell = cell;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + 0.15 + 0.7 * animalHash3(cell + g) - local;
    float d = dot(r, r);
    if (d < best) { best = d; bestCell = cell + g; }
  }
  float d = sqrt(best);
  float rnd = animalHash3(bestCell + 17.0).x;
  float radius = uPatternParams.y + 0.08 * rnd;
  float width = uPatternParams.z;
  float ring = smoothstep(radius - width - 0.05, radius - width, d) * (1.0 - smoothstep(radius, radius + 0.05, d));
  float core = 1.0 - smoothstep(radius - width - 0.06, radius - width, d);
  // algumas manchas são sólidas (como nas patas e na cabeça)
  float solid = step(0.82, rnd) * (1.0 - smoothstep(radius * 0.6, radius * 0.6 + 0.05, d));
  return vec2(max(ring, solid), core * (1.0 - solid));
}
`;

const FRAGMENT_COLOR = /* glsl */`
if (uPatternType == 1 && vPattern > 0.001) {
  // listras ao longo de Z (abdômen da abelha); params: x=frequência, y=deslocamento, z=proporção escura
  float s = sin((vRestPos.z + uPatternParams.y) * uPatternParams.x * 6.2831853);
  float band = smoothstep(uPatternParams.z - 0.18, uPatternParams.z + 0.18, s);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatternColor, band * vPattern);
} else if (uPatternType == 2 && vPattern > 0.001) {
  // rosetas; params: x=frequência, y=raio, z=espessura do anel, w=escurecimento do miolo
  vec2 r = animalRosette(vRestPos * uPatternParams.x);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uPatternColor2, r.y * uPatternParams.w * vPattern);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatternColor, r.x * vPattern);
}
`;

function vec3List(list, fallback) {
  return Array.from({ length: MAX_PARTS }, (_, i) => {
    const v = list[i] || fallback;
    return new THREE.Vector3(v[0], v[1], v[2]);
  });
}

/**
 * Cria o material de um animal.
 * @param {object} opts
 * @param {Array}  opts.parts    partes animáveis (extras.parts do GLB)
 * @param {object} opts.pattern  { type: 'stripes'|'rosettes', params:[4], color:[3], color2:[3] }
 * @param {boolean} opts.transparent  asas translúcidas
 */
export function createAnimalMaterial({ parts = [], pattern = null, transparent = false, opacity = 1,
  roughness = 0.72, metalness = 0, map = null } = {}) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: !map,
    map,
    roughness,
    metalness,
    transparent,
    opacity,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !transparent,
  });

  const patternType = PATTERN_TYPES[pattern?.type] ?? 0;
  const uniforms = {
    uPivot: { value: vec3List(parts.map((p) => p.pivot), [0, 0, 0]) },
    uAxis: { value: vec3List(parts.map((p) => p.axis), [0, 1, 0]) },
    uAngle: { value: new Array(MAX_PARTS).fill(0) },
    uPatternType: { value: patternType },
    uPatternParams: { value: new THREE.Vector4(...(pattern?.params || [0, 0, 0, 0])) },
    uPatternColor: { value: new THREE.Color().fromArray(pattern?.color || [0, 0, 0]) },
    uPatternColor2: { value: new THREE.Color().fromArray(pattern?.color2 || [1, 1, 1]) },
  };
  for (const v of uniforms.uAxis.value) v.normalize();

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERTEX_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_POSITION}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`);
  };
  material.customProgramCacheKey = () => `animal-p${patternType}-t${transparent ? 1 : 0}-m${map ? 1 : 0}`;
  material.userData.animalUniforms = uniforms;
  return material;
}

/**
 * Animação procedural das partes (asas, orelhas, cauda...).
 * Cada parte: { amplitude (graus), frequency (Hz), phase (rad), offset (graus) }.
 */
export class PartAnimator {
  constructor(parts, materials) {
    this.parts = parts.slice(0, MAX_PARTS);
    this.angles = materials.map((m) => m.userData.animalUniforms.uAngle.value);
    this.time = 0;
    this.intensity = 1;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const w = 2 * Math.PI * (p.frequency || 0);
      let wave = Math.sin(w * t + (p.phase || 0));
      // "pausas" naturais: algumas partes se movem em rajadas (ex.: cauda)
      if (p.burst) wave *= Math.max(0, Math.sin(2 * Math.PI * p.burst * t + (p.phase || 0)));
      const deg = (p.offset || 0) + (p.amplitude || 0) * wave * this.intensity;
      const rad = THREE.MathUtils.degToRad(deg);
      for (const angles of this.angles) angles[i] = rad;
    }
  }
}
