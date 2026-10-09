import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyHand, handFeatures, ramp, scoreVowels, SIGN_VOWELS } from '../../inclusiapp/src/sign/handSigns.js';
import { POSES, handPoints, transform } from './helpers/kinematicHand.mjs';

// gerador determinístico (mulberry32)
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Posições de câmera variadas (inclui mão esquerda = espelho). */
function views(n, seed) {
  const rnd = seeded(seed);
  const out = [{}];
  for (let i = 0; i < n; i++) {
    out.push({
      yaw: (rnd() - 0.5) * 120,
      pitch: (rnd() - 0.5) * 70,
      roll: (rnd() - 0.5) * 160,
      mirror: rnd() < 0.5,
      scale: 0.008 + rnd() * 0.006, // mãos maiores e menores
    });
  }
  return out;
}

test('ramp: rampa linear limitada a 0…1 (crescente e decrescente)', () => {
  assert.equal(ramp(0, 1, 2), 0);
  assert.equal(ramp(1.5, 1, 2), 0.5);
  assert.equal(ramp(3, 1, 2), 1);
  assert.ok(Math.abs(ramp(0.4, 0.6, 0.3) - 2 / 3) < 1e-12);
  assert.equal(ramp(5, 2, 2), 1);
});

test('handFeatures recusa dados inválidos', () => {
  assert.equal(handFeatures(null), null);
  assert.equal(handFeatures([]), null);
  assert.equal(handFeatures(Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))), null);
  const bad = handPoints(POSES.A).map(([x, y, z]) => ({ x, y, z }));
  bad[8] = { x: NaN, y: 0, z: 0 };
  assert.equal(handFeatures(bad), null);
  assert.equal(classifyHand(null), null);
});

test('mão ideal: cada vogal é reconhecida em qualquer ângulo, nas duas mãos', () => {
  for (const vowel of SIGN_VOWELS) {
    const points = handPoints(POSES[vowel]);
    for (const view of views(40, vowel.charCodeAt(0))) {
      const r = classifyHand(transform(points, view));
      assert.equal(r.vowel, vowel, `${vowel} visto como ${r.vowel} (${JSON.stringify(view)})`);
      assert.ok(r.score >= 0.75, `${vowel}: nota baixa ${r.score.toFixed(2)}`);
      for (const other of SIGN_VOWELS) {
        if (other !== vowel) assert.ok(r.scores[other] < 0.5, `${vowel} também parece ${other} (${r.scores[other].toFixed(2)})`);
      }
    }
  }
});

test('formatos que não são vogais não passam como vogal (mão aberta, S, V, Y, C, apontar)', () => {
  for (const name of ['open', 'S', 'V', 'Y', 'C', 'point']) {
    const points = handPoints(POSES[name]);
    for (const view of views(20, name.length * 31)) {
      const r = classifyHand(transform(points, view));
      assert.equal(r.vowel, null, `${name} reconhecido como ${r.vowel} (${JSON.stringify(r.scores)})`);
    }
  }
});

test('pequenos tremores nos pontos (ruído de 3 mm) não mudam a vogal', () => {
  const random = seeded(99);
  for (const vowel of SIGN_VOWELS) {
    const points = handPoints(POSES[vowel]);
    for (let i = 0; i < 20; i++) {
      const r = classifyHand(transform(points, { yaw: 20, pitch: -10, roll: 15, noise: 0.003, random }));
      assert.equal(r.vowel, vowel);
    }
  }
});

test('as medidas não dependem do tamanho da mão nem da posição na imagem', () => {
  const points = handPoints(POSES.O);
  const a = scoreVowels(handFeatures(transform(points, { scale: 0.01 })));
  const b = scoreVowels(handFeatures(transform(points, { scale: 0.02 }).map((p) => ({ x: p.x + 3, y: p.y - 1, z: p.z + 0.5 }))));
  for (const v of SIGN_VOWELS) assert.ok(Math.abs(a[v] - b[v]) < 1e-9);
});

test('MediaPipe de verdade: pontos da mão 3D de teste (direita e esquerda, 6 ângulos)', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/hands/mediapipe-world.json', import.meta.url), 'utf8'));
  const samples = fixture.samples;
  assert.equal(samples.length, 72);
  let correct = 0;
  for (const s of samples) {
    const r = classifyHand(s.world);
    const expected = s.sign === 'open' ? null : s.sign;
    // nunca confundir uma vogal com OUTRA vogal (no máximo "não sei")
    assert.ok(r.vowel === expected || r.vowel === null, `${s.side} ${s.sign} ${JSON.stringify(s.view)} → ${r.vowel}`);
    if (r.vowel === expected) correct += 1;
  }
  assert.ok(correct >= 66, `acertos: ${correct}/72`);
  // a mão aberta nunca é vogal
  assert.ok(samples.filter((s) => s.sign === 'open').every((s) => classifyHand(s.world).vowel === null));
});
