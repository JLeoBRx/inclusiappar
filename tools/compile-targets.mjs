#!/usr/bin/env node
/**
 * Compila os alvos do MindAR e grava em inclusiapp/assets/targets/:
 *   paginas.mind (+ .mind.gz) + paginas.json   (livro: Pagina1..N -> alvos 0..N-1)
 *   cartas.mind  (+ .mind.gz) + cartas.json    (jogo:  carta1..N  -> alvos 0..N-1)
 *
 * O .mind.gz é a mesma coisa comprimida (o app baixa ~metade); o manifesto
 * .json traz a contagem de alvos, o tamanho e o checksum do .mind.
 *
 *   npm run targets            # tudo
 *   npm run targets -- cartas  # só as cartas
 *
 * Usa o compilador oficial do MindAR (o mesmo do app) rodando no Chromium via
 * Playwright, através de tools/compile-targets.html. As cartas são contadas a
 * partir da pasta inclusiapp/cartas/ — basta adicionar/remover arquivos
 * cartaN.png e rodar de novo.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'inclusiapp');
const OUT = join(APP, 'assets', 'targets');

// Lista arquivos numerados (ex.: carta1.png ... carta20.png) em ordem numérica.
function numbered(folder, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)\\.(png|jpe?g|webp)$`, 'i');
  const files = readdirSync(join(APP, folder))
    .map((name) => ({ name, m: re.exec(name) }))
    .filter((f) => f.m)
    .sort((a, b) => +a.m[1] - +b.m[1]);
  files.forEach((f, i) => {
    if (+f.m[1] !== i + 1) throw new Error(`${folder}/: numeração com falha (esperado ${prefix}${i + 1}, achado ${f.name})`);
  });
  return files.map((f) => `${folder}/${f.name}`);
}

const only = process.argv[2];
const files = { paginas: numbered('pag', 'Pagina'), cartas: numbered('cartas', 'carta') };
console.log(`Páginas: ${files.paginas.length} | Cartas: ${files.cartas.length}`);

const server = await startServer({ port: 0, root: ROOT });
const { port } = server.address();
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[página]', e.message));
  await page.addInitScript((f) => { window.__TARGET_FILES__ = f; }, files);
  const url = `http://127.0.0.1:${port}/tools/compile-targets.html?auto=1${process.env.TARGET_MAX ? `&max=${process.env.TARGET_MAX}` : ''}${only ? `&only=${only}` : ''}`;
  await page.goto(url);
  const progress = setInterval(async () => {
    const values = await page.$$eval('progress', (els) => els.map((e) => Math.round(e.value))).catch(() => []);
    if (values.length) process.stdout.write(`\r  progresso: ${values.map((v) => `${v}%`).join(' | ')}   `);
  }, 2000);
  await page.waitForFunction(() => window.__COMPILED__, null, { timeout: 30 * 60 * 1000 });
  clearInterval(progress);
  process.stdout.write('\n');
  const results = await page.evaluate(() => window.__COMPILED__);
  mkdirSync(OUT, { recursive: true });
  for (const [id, result] of Object.entries(results)) {
    if (result.error) throw new Error(`${id}: ${result.error}`);
    const bytes = Buffer.from(result.mind, 'base64');
    writeFileSync(join(OUT, `${id}.mind`), bytes);
    const gz = gzipSync(bytes, { level: 9 });
    writeFileSync(join(OUT, `${id}.mind.gz`), gz);
    writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify(result.manifest, null, 2)}\n`);
    console.log(`✔ ${id}.mind (${result.manifest.count} alvos, ${(bytes.length / 1024).toFixed(0)} KB; ` +
      `gz ${(gz.length / 1024).toFixed(0)} KB) + ${id}.json`);
  }
} finally {
  await browser.close();
  server.close();
}
