#!/usr/bin/env node
/**
 * Teste de reconhecimento dos alvos (páginas e cartas) com o MindAR real.
 *
 *   python3 tests/make_frames.py   # gera os quadros sintéticos (uma vez)
 *   node tests/e2e/recognition.mjs [paginas|cartas] [arquivo.mind]
 *
 * Falha (exit 1) se alguma imagem for confundida com outro alvo, ou se a taxa
 * de detecção ficar abaixo do mínimo.
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIN_DETECTION = 0.85;

const sets = (process.argv[2] ? [process.argv[2]] : ['paginas', 'cartas']).map((id) => {
  const mind = process.argv[3] || `/inclusiapp/assets/targets/${id}.mind`;
  const manifest = JSON.parse(readFileSync(join(ROOT, 'inclusiapp/assets/targets', `${id}.json`), 'utf8'));
  return { id, mind, count: manifest.count };
});
if (!existsSync(join(ROOT, 'tests/fixtures/frames'))) {
  console.error('Gere os quadros antes: python3 tests/make_frames.py');
  process.exit(2);
}

const server = await startServer({ port: 0, root: ROOT });
const { port } = server.address();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  for (const set of sets) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[página]', e.message));
    const url = `http://127.0.0.1:${port}/tests/e2e/recognition.html?mind=${set.mind}&frames=${set.id}&count=${set.count}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__RESULT__, null, { timeout: 20 * 60 * 1000 });
    const results = await page.evaluate(() => window.__RESULT__);
    await page.close();

    const byVariant = {};
    for (const r of results) {
      const v = (byVariant[r.variant] ||= { total: 0, ok: 0 });
      v.total++;
      if (r.first === r.target) v.ok++;
    }
    const confused = results.filter((r) => r.wrong.length);
    const detected = results.filter((r) => r.first === r.target).length / results.length;
    const notTracked = results.filter((r) => r.first === r.target && !r.tracked);
    console.log(`\n== ${set.id} (${set.mind}) ==`);
    for (const [v, s] of Object.entries(byVariant)) console.log(`  ${v.padEnd(10)} ${s.ok}/${s.total}`);
    console.log(`  detecção: ${(detected * 100).toFixed(1)}%  | confusões: ${confused.length}  | sem tracking: ${notTracked.length}`);
    for (const r of confused) console.log(`  ✗ alvo ${r.target} (${r.variant}) confundido com ${r.wrong.join(', ')}`);
    for (const r of results.filter((x) => x.first === -1)) console.log(`  · alvo ${r.target} (${r.variant}) não detectado`);
    if (confused.length || detected < MIN_DETECTION) failed = true;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
