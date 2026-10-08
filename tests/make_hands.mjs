#!/usr/bin/env node
/**
 * Gera as imagens de mão usadas no teste ponta a ponta do ✋ Sinalize e Conte:
 * tests/fixtures/hands/{A,E,I,O,U,open}.jpg (640×480, como a câmera falsa).
 *
 * A mão 3D (tests/e2e/handRenderer.js, modelo "generic-hand" do WebXR Input
 * Profiles, MIT) faz cada vogal; para cada uma, procura um ângulo de câmera
 * em que o MediaPipe encontra a mão E o classificador do jogo
 * (src/sign/handSigns.js) reconhece a vogal com folga. Assim o teste ponta a
 * ponta exercita o caminho real: imagem → MediaPipe → classificador.
 *
 * Uso: node tests/make_hands.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/fixtures/hands');
mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  { distance: 0.4 },
  { distance: 0.38, yaw: 15 },
  { distance: 0.38, yaw: -15 },
  { distance: 0.4, roll: 12 },
  { distance: 0.4, pitch: -12 },
  { distance: 0.36, yaw: 25, roll: -8 },
  { distance: 0.36, yaw: -25, roll: 8 },
];

const server = await startServer({ port: 0, root: ROOT });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.error('[página]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/tests/e2e/hand-renderer.html`);
await page.waitForFunction(() => window.handLab);
await page.evaluate(() => window.handLab.ready);

const results = await page.evaluate(async (candidates) => {
  const { FilesetResolver, HandLandmarker } = await import('/inclusiapp/vendor/mediapipe/vision_bundle.mjs');
  const { classifyHand } = await import('/inclusiapp/src/sign/handSigns.js');
  const fileset = await FilesetResolver.forVisionTasks('/inclusiapp/vendor/mediapipe/wasm');
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/inclusiapp/vendor/mediapipe/hand_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numHands: 1,
  });
  const lab = window.handLab;
  lab.setHand('right');
  const out = {};
  for (const sign of ['A', 'E', 'I', 'O', 'U', 'open']) {
    lab.setPose(lab.POSES[sign]);
    for (const view of candidates) {
      const url = lab.render({ ...view, background: '#7b5a3c' });
      const img = new Image();
      img.src = url;
      await img.decode();
      const r = landmarker.detect(img);
      if (!r.worldLandmarks.length) continue;
      const c = classifyHand(r.worldLandmarks[0]);
      const sorted = Object.entries(c.scores).sort((a, b) => b[1] - a[1]);
      const ok = sign === 'open'
        ? c.vowel === null && sorted[0][1] < 0.2
        : c.vowel === sign && c.score >= 0.8 && sorted[1][1] <= 0.3;
      if (ok) {
        out[sign] = { url, view, scores: c.scores };
        break;
      }
    }
  }
  return out;
}, CANDIDATES);

let missing = 0;
for (const sign of ['A', 'E', 'I', 'O', 'U', 'open']) {
  const r = results[sign];
  if (!r) {
    console.error(`✘ ${sign}: nenhum ângulo reconhecido com folga`);
    missing++;
    continue;
  }
  writeFileSync(join(OUT, `${sign}.jpg`), Buffer.from(r.url.split(',')[1], 'base64'));
  const scores = Object.entries(r.scores).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ');
  console.log(`✔ ${sign}.jpg  ${JSON.stringify(r.view)}  ${scores}`);
}
await browser.close();
server.close();
process.exit(missing ? 1 : 0);
