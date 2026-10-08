#!/usr/bin/env node
/**
 * Testes ponta a ponta no Chromium (Playwright) com câmera falsa.
 *
 *   python3 tests/make_frames.py      # quadros sintéticos (uma vez)
 *   npm run test:e2e                   # todos
 *   npm run test:e2e -- livro          # só o livro   (ou: jogo, telas, erros, paisagem, sala, bichinho)
 *
 * Screenshots ficam em test-results/.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const FAKE_CAMERA = readFileSync(join(ROOT, 'tests/e2e/fakeCamera.js'), 'utf8');
const only = process.argv[2];

const results = [];
const t0 = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// sem H.264 no Chromium do Playwright: os .webm de teste entram no lugar dos .mp4
const server = await startServer({ port: 0, root: ROOT, overlays: [{ prefix: '/inclusiapp/videos/', dir: 'tests/fixtures/videos' }] });
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}/inclusiapp/?test=1`;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage(viewport = { width: 390, height: 844 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 900, hasTouch: true, ...extra });
  await ctx.addInitScript({ content: FAKE_CAMERA });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  return page;
}

const frame = (set, index, variant = 'frente') => `/tests/fixtures/frames/${set}/${index}_${variant}.jpg`;
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

/* ================================================================ telas */
async function testScreens() {
  const page = await newPage();
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('[data-screen="menu"].is-active');
  await page.waitForTimeout(700);
  check('menu: 4 botões visíveis', await page.locator('.menu-btn, .link-btn').count() === 4);
  const menuTitles = await page.locator('.menu-btn__title').allTextContents();
  check('menu: "Sala de Jogos" no lugar do "Jogo de Cartas"', menuTitles.join('|') === 'LIVRO EM AR|SALA DE JOGOS' &&
    await page.getAttribute('.menu-btn--game', 'href') === '#/sala', menuTitles.join(', '));
  const store = await page.getAttribute('[data-link="store"]', 'href');
  const site = await page.getAttribute('[data-link="site"]', 'href');
  check('menu: loja em nova aba', store === 'https://loja.inclusivr.com.br/' &&
    await page.getAttribute('[data-link="store"]', 'target') === '_blank', store);
  check('menu: site em nova aba', site === 'http://inclusivr.com.br/' &&
    await page.getAttribute('[data-link="site"]', 'target') === '_blank', site);
  await shot(page, 'menu-celular');

  // abrir AR direto pela URL não liga a câmera: leva à explicação
  await page.goto(`${BASE}#/livro/ar`);
  await page.waitForSelector('[data-screen="book-intro"].is-active');
  check('rota AR direta redireciona para a explicação', page.url().endsWith('#/livro'));
  check('câmera não é aberta antes de "Começar"', await page.evaluate(() => __fakeCam.calls) === 0);
  await shot(page, 'livro-explicacao');
  await page.goto(`${BASE}#/jogo`);
  await page.waitForSelector('[data-screen="game-intro"].is-active');
  await page.waitForFunction(() => document.querySelector('[data-card-count]').textContent.includes('cartas'));
  check('jogo: conta as cartas automaticamente', (await page.textContent('[data-card-count]')).includes('20 cartas'),
    await page.textContent('[data-card-count]'));
  await shot(page, 'jogo-explicacao');
  check('telas sem erros de JavaScript', page.errors.length === 0, page.errors.join(' | '));

  // responsividade
  for (const [name, vp] of [['paisagem', { width: 844, height: 390 }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]]) {
    const p = await newPage(vp);
    await p.goto(`${BASE}#/`);
    await p.waitForSelector('[data-screen="menu"].is-active');
    await p.waitForTimeout(700);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`menu ${name}: sem rolagem horizontal`, overflow <= 0, `${overflow}px`);
    await shot(p, `menu-${name}`);
    await p.goto(`${BASE}#/livro`);
    await p.waitForSelector('[data-screen="book-intro"].is-active');
    await p.waitForTimeout(500);
    await shot(p, `livro-explicacao-${name}`);
    await p.goto(`${BASE}#/jogo`);
    await p.waitForSelector('[data-screen="game-intro"].is-active');
    await p.waitForTimeout(500);
    await shot(p, `jogo-explicacao-${name}`);
    await p.goto(`${BASE}#/sala`);
    await p.waitForSelector('[data-screen="sala"].is-active');
    await p.waitForTimeout(800);
    const salaOverflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`sala ${name}: sem rolagem horizontal`, salaOverflow <= 0, `${salaOverflow}px`);
    await shot(p, `sala-${name}`);
    await p.goto(`${BASE}#/bichinho`);
    await p.waitForSelector('[data-screen="pet-intro"].is-active');
    await p.waitForTimeout(500);
    await shot(p, `bichinho-como-jogar-${name}`);
    await p.context().close();
  }
  await page.context().close();
}

/* ================================================================ livro */
async function waitAnimal(page, name, timeout = 45000) {
  await page.waitForFunction((n) => {
    const chip = document.querySelector('[data-animal-chip]');
    return !chip.hidden && chip.querySelector('[data-chip-name]').textContent === n;
  }, name, { timeout });
}

async function testBook() {
  const page = await newPage();
  await page.goto(`${BASE}#/livro`);
  await page.waitForSelector('[data-screen="book-intro"].is-active');
  await page.evaluate((u) => __fakeCam.show(u), frame('paginas', 0));
  await page.click('[data-action="start-book"]');
  await page.waitForFunction(() => document.querySelector('section[data-screen="book-ar"] [data-status]').hidden &&
    window.__app.book.session?.running, null, { timeout: 90000 });
  check('livro: câmera aberta após "Começar"', await page.evaluate(() => __fakeCam.calls) === 1);

  const expected = [['Abelha', 'abelha'], ['Elefante', 'elefante'], ['Iguana', 'iguana'], ['Onça', 'onca'], ['Urso', 'urso']];
  for (let i = 0; i < 5; i++) {
    const [name, id] = expected[i];
    await page.evaluate((u) => __fakeCam.show(u), frame('paginas', i));
    try {
      await waitAnimal(page, name);
      await page.waitForFunction((animalId) => {
        const b = window.__app.book;
        const m = b.models.get(animalId);
        return m && m.root.parent && m.root.parent.visible;
      }, id, { timeout: 30000 });
      const info = await page.evaluate(() => {
        const b = window.__app.book;
        return { current: b.current.id, page: b.current.page, video: b.libras.video.currentSrc || b.libras.video.src };
      });
      check(`livro: Pagina${i + 1} → ${name} (modelo 3D sobre a página)`, info.current === id && info.page === i + 1);
      check(`livro: Pagina${i + 1} → vídeo ${id}`, info.video.includes(`/videos/${id}.`), info.video.split('/').pop());
      await page.waitForFunction(() => window.__app.book.libras.ready && !window.__app.book.libras.video.paused, null, { timeout: 20000 });
      await page.waitForTimeout(1200);
      await shot(page, `livro-ar-${id}`);
    } catch (err) {
      check(`livro: Pagina${i + 1} → ${name}`, false, err.message.split('\n')[0]);
      await shot(page, `livro-ar-${id}-falhou`);
    }
  }
  check('livro: só um vídeo carregado por vez', await page.evaluate(() => document.querySelectorAll('video.libras-source').length) === 1);

  // chroma key: o fundo verde-limão não pode aparecer na tela
  const chroma = await page.evaluate(() => {
    const b = window.__app.book;
    const box = b.libras.box;
    const renderer = b.session.renderer;
    const canvas = renderer.domElement;
    const vp = b.session.viewport;
    const gl = renderer.getContext();
    if (!b.libras.mesh.visible) return { opaque: 0, lime: 1, hidden: true };
    // só o HUD (vídeo de LIBRAS) sobre fundo transparente
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.render(b.session.hud.scene, b.session.hud.camera);
    const sx = canvas.width / vp.width;
    const sy = canvas.height / vp.height;
    const w = Math.floor(box.width * sx);
    const h = Math.floor(box.height * sy);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(Math.floor(box.x * sx), Math.floor(box.y * sy), w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let opaque = 0;
    let lime = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 200) {
        opaque++;
        const [r, g, bb] = [px[i], px[i + 1], px[i + 2]];
        if (g > 150 && r > 140 && bb < 110 && g >= r - 5) lime++;
      }
    }
    return { opaque: opaque / (w * h), lime: lime / Math.max(1, opaque) };
  });
  check('LIBRAS: pessoa visível (pixels opacos)', chroma.opaque > 0.08, `${(chroma.opaque * 100).toFixed(1)}% opacos`);
  check('LIBRAS: fundo verde removido', chroma.lime < 0.01, `${(chroma.lime * 100).toFixed(2)}% de verde-limão restante`);

  // LIBRAS ON/OFF
  await page.click('[data-action="libras"]');
  const off = await page.evaluate(() => ({ paused: window.__app.book.libras.video.paused, label: document.querySelector('[data-libras-label]').textContent }));
  check('LIBRAS: OFF pausa o vídeo', off.paused && off.label === 'LIBRAS: OFF', off.label);
  await page.click('[data-action="libras"]');
  await page.waitForFunction(() => !window.__app.book.libras.video.paused);
  check('LIBRAS: ON retoma o vídeo', (await page.textContent('[data-libras-label]')) === 'LIBRAS: ON');

  // Modo Interação
  await page.click('[data-action="mode-interact"]');
  await page.waitForFunction(() => window.__app.book.mode === 'interact' && !window.__app.book.transition, null, { timeout: 10000 });
  const inStage = await page.evaluate(() => {
    const b = window.__app.book;
    return b.models.get(b.current.id).root.parent === b.stage && !b.session.tracking;
  });
  check('interação: animal sai da página (rastreamento pausado)', inStage);
  const q0 = await page.evaluate(() => window.__app.book.stage.quaternion.toArray());
  const stage = await page.locator('section[data-screen="book-ar"] [data-ar-stage]').boundingBox();
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 14, cy + i * 3);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const q1 = await page.evaluate(() => window.__app.book.stage.quaternion.toArray());
  check('interação: arrastar gira o animal', q0.some((v, i) => Math.abs(v - q1[i]) > 0.05));
  const s0 = await page.evaluate(() => window.__app.book.stage.scale.x);
  // pinça com dois dedos (eventos de toque reais via CDP)
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 40 - i * 12, cy], [cx + 40 + i * 12, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  const s1 = await page.evaluate(() => window.__app.book.stage.scale.x);
  check('interação: pinça para fora aumenta', s1 > s0 * 1.4, `${(s1 / s0).toFixed(2)}x`);
  await touch('touchStart', [[cx - 150, cy], [cx + 150, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 150 + i * 14, cy], [cx + 150 - i * 14, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => window.__app.book.stage.scale.x);
  check('interação: pinça para dentro diminui', s2 < s1 * 0.75, `${(s2 / s1).toFixed(2)}x`);
  await shot(page, 'livro-interacao');
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(700);
  const reset = await page.evaluate(() => window.__app.book.gestures.state);
  check('interação: duplo toque centraliza', reset.zoom === 1 && reset.yaw === 0 && reset.pitch === 0);

  // volta ao Modo Página
  await page.click('[data-action="mode-page"]');
  await page.waitForFunction(() => window.__app.book.mode === 'page' && window.__app.book.session.tracking, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const b = window.__app.book;
    const m = b.models.get(b.current.id);
    return m.root.parent !== b.stage && m.root.parent.visible;
  }, null, { timeout: 30000 });
  check('modo página: animal volta a seguir a página', true);

  // sem página: dica de aproximar/afastar
  await page.evaluate(() => __fakeCam.clear());
  await page.waitForFunction(() => document.querySelector('section[data-screen="book-ar"] [data-scan]').dataset.state === 'hint', null, { timeout: 30000 });
  check('dica "Não encontramos a imagem" aparece', (await page.textContent('[data-scan-text]')).includes('Não encontramos a imagem'));
  await shot(page, 'livro-dica');

  // voltar ao menu desliga a câmera
  await page.click('section[data-screen="book-ar"] .ar-topbar a');
  await page.waitForSelector('[data-screen="menu"].is-active');
  await page.waitForFunction(() => __fakeCam.liveTracks() === 0, null, { timeout: 8000 }).catch(() => {});
  check('menu: câmera desligada ao sair do AR', await page.evaluate(() => __fakeCam.liveTracks()) === 0);
  check('menu: vídeo de LIBRAS liberado', await page.evaluate(() => document.querySelectorAll('video.libras-source').length) === 0);

  // reentrar reaproveita tudo
  await page.click('a[href="#/livro"]');
  await page.evaluate((u) => __fakeCam.show(u), frame('paginas', 3));
  await page.click('[data-action="start-book"]');
  try {
    await waitAnimal(page, 'Onça');
    check('livro: reentrar funciona (sessão reaproveitada)', true);
  } catch (err) {
    check('livro: reentrar funciona', false, err.message.split('\n')[0]);
  }
  check('livro sem erros de JavaScript', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.context().close();
}

/* ================================================================ jogo */
async function currentTarget(page) {
  await page.waitForFunction(() => window.__app.game.engine?.phase === 'searching', null, { timeout: 60000 });
  return page.evaluate(() => {
    const g = window.__app.game;
    return g.byId.get(g.engine.current).index;
  });
}

async function testGame() {
  const page = await newPage();
  await page.goto(`${BASE}#/jogo`);
  await page.waitForSelector('[data-screen="game-intro"].is-active');
  await page.evaluate(() => __fakeCam.clear());
  await page.click('[data-action="start-game"]');
  let target = await currentTarget(page);
  check('jogo: carta sorteada e cronômetro rodando', target >= 0);
  await page.waitForSelector('[data-reveal]', { state: 'hidden', timeout: 10000 });
  await shot(page, 'jogo-procurando');

  // erro
  const wrong = (target + 1) % 20;
  await page.evaluate(() => { window.__app.game.engine.stats.score = 100; });
  await page.evaluate((u) => __fakeCam.show(u), frame('cartas', wrong));
  await page.waitForFunction(() => window.__app.game.engine.stats.errors === 1, null, { timeout: 45000 });
  const afterWrong = await page.evaluate(() => ({ ...window.__app.game.engine.stats, current: window.__app.game.engine.current }));
  check('jogo: carta errada desconta pontos', afterWrong.score === 80, `pontos ${afterWrong.score}`);
  check('jogo: carta-alvo continua a mesma após erro', afterWrong.current === await page.evaluate(() => window.__app.game.engine.current));
  await page.waitForTimeout(400);
  await shot(page, 'jogo-erro');

  // acerto
  await page.evaluate((u) => __fakeCam.show(u), frame('cartas', target));
  await page.waitForFunction(() => window.__app.game.engine.stats.hits === 1, null, { timeout: 45000 });
  const hit = await page.evaluate(() => window.__app.game.engine.stats);
  check('jogo: acerto soma pontos + bônus', hit.score >= 80 + 100, `pontos ${hit.score}`);
  await page.waitForTimeout(500);
  await shot(page, 'jogo-acerto');
  check('jogo: retorno visual de acerto', await page.isVisible('.feedback--hit'));

  // próxima missão e Pular
  await page.evaluate(() => __fakeCam.clear());
  target = await currentTarget(page);
  const used0 = await page.evaluate(() => window.__app.game.engine.deck.drawnInCycle);
  check('jogo: próxima carta sorteada após o acerto', used0 === 2);
  await page.waitForSelector('[data-action="skip"]:not([disabled])', { timeout: 10000 });
  await page.click('[data-action="skip"]');
  const next = await currentTarget(page);
  const st = await page.evaluate(() => ({ skips: window.__app.game.engine.stats.skips, used: window.__app.game.engine.deck.drawnInCycle }));
  check('jogo: Pular troca a carta', st.skips === 1 && st.used === 3 && next !== target);

  // sem repetição no ciclo + fim do ciclo (pulando o resto)
  const seen = await page.evaluate(() => window.__app.game.engine.deck.order.slice(0, 3));
  // a 3ª carta está na tela: pula da 3ª até a 20ª
  for (let i = 3; i <= 20; i++) {
    await page.waitForSelector('[data-action="skip"]:not([disabled])', { timeout: 20000 });
    await page.click('[data-action="skip"]');
    if (i < 20) await currentTarget(page);
  }
  await page.waitForSelector('[data-summary]:not([hidden])', { timeout: 30000 });
  const order = await page.evaluate(() => window.__app.game.engine.deck.order);
  check('jogo: 20 cartas no ciclo, sem repetição', new Set(order).size === 20 && seen.every((c, i) => order[i] === c));
  check('jogo: tela de ciclo completo', (await page.textContent('[data-sum="used"]')) === '20/20',
    await page.textContent('[data-sum="used"]'));
  await shot(page, 'jogo-ciclo-completo');
  await page.click('[data-action="new-deck"]');
  await currentTarget(page);
  const cycle = await page.evaluate(() => ({ cycle: window.__app.game.engine.deck.cycle, score: window.__app.game.engine.stats.score }));
  check('jogo: novo baralho embaralhado', cycle.cycle === 2 && cycle.score === 0);
  check('jogo sem erros de JavaScript', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.context().close();
}

/* ================================================================ paisagem */
async function testLandscape() {
  const page = await newPage({ width: 844, height: 390 });
  await page.goto(`${BASE}#/livro`);
  await page.waitForSelector('[data-screen="book-intro"].is-active');
  await page.evaluate((u) => __fakeCam.show(u), frame('paginas', 1, 'inclinada'));
  await page.click('[data-action="start-book"]');
  try {
    await waitAnimal(page, 'Elefante');
    await page.waitForFunction(() => window.__app.book.libras.ready, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot(page, 'paisagem-livro-ar');
    const overlap = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const a = r('section[data-screen="book-ar"] .ar-topbar');
      const b = r('section[data-screen="book-ar"] [data-controls]');
      return a.bottom > b.top;
    });
    check('paisagem: livro AR com controles visíveis', !overlap);
  } catch (err) {
    check('paisagem: livro AR', false, err.message.split('\n')[0]);
  }
  await page.click('section[data-screen="book-ar"] .ar-topbar a');
  await page.waitForSelector('[data-screen="menu"].is-active');
  // Menu → Sala de Jogos → Jogo de Cartas
  await page.click('a[href="#/sala"]');
  await page.waitForSelector('[data-screen="sala"].is-active');
  await page.click('a[href="#/jogo"]');
  await page.evaluate(() => __fakeCam.clear());
  await page.click('[data-action="start-game"]');
  await currentTarget(page);
  await page.waitForSelector('[data-reveal]', { state: 'hidden', timeout: 10000 });
  await shot(page, 'paisagem-jogo');
  const hud = await page.evaluate(() => {
    const r = document.querySelector('.game-hud').getBoundingClientRect();
    return r.bottom <= innerHeight && r.right <= innerWidth;
  });
  check('paisagem: placar do jogo cabe na tela', hud);
  await page.context().close();
}

/* ================================================================ sala de jogos */
async function testSala() {
  const page = await newPage();
  await page.goto(`${BASE}#/`);
  await page.waitForSelector('[data-screen="menu"].is-active');
  await page.click('a[href="#/sala"]');
  await page.waitForSelector('[data-screen="sala"].is-active');
  await page.waitForTimeout(800);
  const tiles = await page.locator('.game-tile__title').allTextContents();
  check('sala: 3 opções (Jogo de Cartas, Bichinho Virtual, Em breve)',
    tiles.map((t) => t.trim()).join('|') === '🃏 Jogo de Cartas|🐾 Bichinho Virtual|🔒 Em breve', tiles.join(', '));
  await shot(page, 'sala');
  await page.click('[data-action="soon"]', { force: true });
  await page.waitForSelector('.toast');
  check('sala: "Em breve" não abre nenhum jogo', (await page.textContent('.toast')).includes('Em breve') &&
    await page.evaluate(() => location.hash) === '#/sala' && await page.getAttribute('[data-action="soon"]', 'aria-disabled') === 'true');
  await page.click('a[href="#/jogo"]');
  await page.waitForSelector('[data-screen="game-intro"].is-active');
  check('sala → Jogo de Cartas (explicação original)', (await page.textContent('#game-intro-title')).includes('Como jogar?'));
  await page.click('[data-screen="game-intro"] a.btn--ghost');
  await page.waitForSelector('[data-screen="sala"].is-active');
  check('Jogo de Cartas: "← VOLTAR" volta para a Sala', page.url().endsWith('#/sala'));
  await page.click('.sala__actions a');
  await page.waitForSelector('[data-screen="menu"].is-active');
  check('sala: "← VOLTAR" volta para o menu', page.url().endsWith('#/'));
  check('sala sem erros de JavaScript', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.context().close();
}

/* ================================================================ bichinho virtual */
const petState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.pet.state)));
const setPet = (page, fn, arg) => page.evaluate(([code, a]) => {
  const g = window.__app.pet;
  // eslint-disable-next-line no-new-func
  new Function('g', 'state', 'pet', 'arg', code)(g, g.state, g.pet, a);
  g._render();
}, [fn, arg]);

async function showCard(page, index, variant = 'frente') {
  await page.evaluate(() => __fakeCam.clear());
  await page.waitForTimeout(400);
  await page.evaluate((u) => __fakeCam.show(u), frame('cartas', index, variant));
}

async function testPet() {
  const page = await newPage();
  const origin = new URL(BASE).origin;

  // primeira vez: abrir o jogo direto leva ao "Como jogar?"
  await page.goto(`${BASE}#/bichinho/jogar`);
  await page.waitForSelector('[data-screen="pet-intro"].is-active');
  check('bichinho: primeira vez mostra o "Como jogar?"', page.url().endsWith('#/bichinho'));
  const steps = (await page.locator('.pet-step h3').allTextContents()).map((t) => t.trim());
  check('como jogar: os 5 passos', steps.join('|') === '1. Escolha um bichinho|2. Observe suas necessidades|3. Use as cartas mágicas|4. Cuide do seu bichinho|5. Continue cuidando', steps.join(' | '));
  const chips = (await page.locator('.pet-chips li').allTextContents()).map((t) => t.trim());
  check('como jogar: estados (fome, sede, sujo, entediado, sono, doente)', chips.join('|') === '🍎 Com fome|💧 Com sede|🛁 Sujo|🎾 Entediado|😴 Com sono|❤️ Doente', chips.join(', '));
  await shot(page, 'bichinho-como-jogar');
  check('como jogar: a câmera não abre', await page.evaluate(() => __fakeCam.calls) === 0);

  await page.click('[data-action="start-pet"]');
  await page.waitForSelector('[data-modal="choose"]:not([hidden])');
  check('bichinho: escolha entre os 5 animais', await page.locator('[data-choose]').count() === 5);
  await shot(page, 'bichinho-escolha');
  await page.click('[data-choose="elefante"]');
  await page.waitForFunction(() => window.__app.pet.actor && window.__app.pet.room.rect, null, { timeout: 30000 });
  let st = await petState(page);
  check('bichinho: elefante escolhido, com o modelo 3D no quarto', st.selected === 'elefante' &&
    await page.evaluate(() => window.__app.pet.room.running && window.__app.pet.actor.pet.id === 'elefante'));
  check('bichinho: 6 necessidades e 7 cuidados', await page.locator('[data-needs] .need').count() === 6 &&
    await page.locator('[data-actions] .care-btn').count() === 7);
  check('bichinho: câmera só abre nas cartas mágicas', await page.evaluate(() => __fakeCam.calls) === 0);
  await page.waitForTimeout(4500);
  await shot(page, 'bichinho-quarto');

  // alimentar pelo botão (usa a comida da mochila)
  await setPet(page, 'pet.needs.fome = 20;');
  const mel = st.inventory.mel;
  await page.click('[data-care="alimentar"]');
  st = await petState(page);
  check('alimentar: usa o mel da mochila e mata a fome', st.pets.elefante.needs.fome >= 54 && st.inventory.mel === mel - 1,
    `fome ${Math.round(st.pets.elefante.needs.fome)}, mel ${st.inventory.mel}`);
  await page.waitForTimeout(900);
  await shot(page, 'bichinho-comendo');
  await setPet(page, 'pet.needs.fome = 100;');
  const inv = JSON.stringify((await petState(page)).inventory);
  await page.click('[data-care="alimentar"]');
  await page.waitForSelector('[data-speech]:not([hidden])');
  check('alimentar satisfeito: recusa sem gastar item', JSON.stringify((await petState(page)).inventory) === inv &&
    (await page.textContent('[data-speech]')).includes('fome'));

  // sem item: dica de quais cartas trazem mais
  await setPet(page, 'state.inventory.agua = 0; pet.needs.sede = 10;');
  await page.click('[data-care="beber"]');
  await page.waitForSelector('[data-modal="hint"]:not([hidden])');
  const hint = await page.textContent('[data-modal="hint"]');
  check('sem água: indica as cartas mágicas (A, A em LIBRAS, Elefante)', hint.includes('Acabou a água') && hint.includes('Letra A') && hint.includes('Elefante'));
  await shot(page, 'bichinho-dica-cartas');
  await page.click('[data-modal="hint"] [data-close]');

  // sujeira: tocar no cocô e no botão Limpar
  await setPet(page, 'pet.poops = 2; pet.needs.higiene = 20;');
  check('cocôs aparecem no quarto', await page.locator('[data-poop]').count() === 2);
  await page.locator('[data-poop]').first().click();
  check('tocar no cocô limpa', (await petState(page)).pets.elefante.poops === 1);
  await page.click('[data-care="limpar"]');
  check('botão Limpar limpa o quarto', (await petState(page)).pets.elefante.poops === 0);

  // carinho
  await setPet(page, 'pet.needs.diversao = 50; pet.lastCaress = 0;');
  await page.click('[data-action="caress"]');
  check('carinho (tocar no bichinho) diverte', (await petState(page)).pets.elefante.needs.diversao > 50);

  // doença e remédio
  await setPet(page, 'pet.sick = true; pet.needs.saude = 30; state.inventory.folhas = 1;');
  await page.waitForTimeout(1500);
  check('doente: aparece no quarto e nos alertas', await page.evaluate(() => document.querySelector('[data-room]').hasAttribute('data-sick')) &&
    (await page.textContent('[data-mood]')).includes('Doente'));
  await shot(page, 'bichinho-doente');
  await page.click('[data-care="remedio"]');
  st = await petState(page);
  check('remédio cura e recupera a saúde', !st.pets.elefante.sick && st.pets.elefante.needs.saude >= 59, `saúde ${Math.round(st.pets.elefante.needs.saude)}`);

  // dormir e acordar
  await setPet(page, 'pet.needs.sono = 30;');
  await page.click('[data-care="dormir"]');
  check('dormir: luzes apagadas', (await petState(page)).pets.elefante.sleeping &&
    await page.evaluate(() => document.querySelector('[data-room]').hasAttribute('data-night')));
  await page.waitForTimeout(1500);
  await shot(page, 'bichinho-dormindo');
  check('dormindo: não come', await page.evaluate(() => {
    window.__app.pet.state.pets.elefante.needs.fome = 10;
    return document.querySelector('[data-care="alimentar"]').click() || window.__app.pet.state.pets.elefante.needs.fome === 10;
  }));
  await page.click('[data-care="acordar"]');
  check('acordar', !(await petState(page)).pets.elefante.sleeping);

  // trocar de bichinho
  await page.click('[data-pet="abelha"]');
  await page.waitForFunction(() => window.__app.pet.actor?.pet.id === 'abelha', null, { timeout: 30000 });
  check('trocar para a abelha', (await petState(page)).selected === 'abelha');
  await page.waitForTimeout(1200);
  await shot(page, 'bichinho-abelha');

  // ---------------------------------------------------- cartas mágicas (câmera)
  await setPet(page, `for (const p of Object.values(state.pets)) { p.needs.fome = 20; p.needs.higiene = 15; p.needs.sede = 20; p.sleeping = false; }
    state.inventory.agua = 0;`);
  await page.evaluate((u) => __fakeCam.show(u), frame('cartas', 0));
  await page.click('.pet-panel [data-action="magic"]');
  await page.waitForFunction(() => window.__app.pet.scanner.running, null, { timeout: 90000 });
  check('cartas mágicas: câmera aberta', await page.evaluate(() => __fakeCam.liveTracks()) > 0);
  try {
    await page.waitForFunction(() => window.__app.pet.state.magic.used[1] === 1, null, { timeout: 45000 });
    st = await petState(page);
    check('carta 1 (Abelha) → o bichinho escolhido come mel', st.pets.abelha.needs.fome >= 54 && st.pets.urso.needs.fome < 25,
      `abelha ${Math.round(st.pets.abelha.needs.fome)}, urso ${Math.round(st.pets.urso.needs.fome)}`);
    await page.waitForSelector('[data-spell]:not([hidden])');
    check('magia explicada na tela', (await page.textContent('[data-spell]')).includes('Pote de mel'));
    await page.waitForTimeout(700);
    await shot(page, 'bichinho-magia-abelha');
  } catch (err) {
    check('carta 1 (Abelha) → magia', false, err.message.split('\n')[0]);
  }

  await showCard(page, 6, 'inclinada');
  try {
    await page.waitForFunction(() => window.__app.pet.state.magic.used[7] === 1, null, { timeout: 45000 });
    st = await petState(page);
    const clean = Object.values(st.pets).filter((p) => p.needs.higiene >= 80).length;
    check('carta 7 (Elefante em LIBRAS) → banho e água para os 5', clean === 5 && Object.values(st.pets).every((p) => p.needs.sede >= 44), `${clean}/5 limpos`);
    await page.waitForTimeout(900);
    await shot(page, 'bichinho-magia-libras');
  } catch (err) {
    check('carta 7 (Elefante em LIBRAS) → magia', false, err.message.split('\n')[0]);
  }

  await page.waitForTimeout(2600);
  await showCard(page, 10);
  try {
    await page.waitForFunction(() => window.__app.pet.state.magic.used[11] === 1, null, { timeout: 45000 });
    check('carta 11 (A em LIBRAS) → 2 águas na mochila', (await petState(page)).inventory.agua === 2);
  } catch (err) {
    check('carta 11 (A em LIBRAS)', false, err.message.split('\n')[0]);
  }

  await page.waitForTimeout(2600);
  const fomeAntes = (await petState(page)).pets.abelha.needs.fome;
  await showCard(page, 0, 'inclinada');
  try {
    await page.waitForFunction(() => document.querySelector('[data-spell]')?.textContent.includes('Recarregando'), null, { timeout: 45000 });
    check('a mesma carta recarrega antes de funcionar de novo', (await petState(page)).magic.used[1] === 1 &&
      Math.abs((await petState(page)).pets.abelha.needs.fome - fomeAntes) < 1);
  } catch (err) {
    check('recarga da carta', false, err.message.split('\n')[0]);
  }

  await page.click('[data-action="close-magic"]');
  await page.waitForFunction(() => !window.__app.pet.magicOpen && window.__app.pet.room.running, null, { timeout: 15000 });
  await page.waitForFunction(() => __fakeCam.liveTracks() === 0, null, { timeout: 8000 }).catch(() => {});
  check('fechar as cartas mágicas desliga a câmera e volta ao quarto', await page.evaluate(() => __fakeCam.liveTracks()) === 0 &&
    await page.evaluate(() => !!document.querySelector('[data-room-stage] canvas')));

  // Livro de Magias
  await page.click('.pet-topbar [data-action="book"]');
  await page.waitForSelector('[data-modal="book"]:not([hidden])');
  check('Livro de Magias: 20 cartas, 3 descobertas', await page.locator('.book-card').count() === 20 &&
    (await page.textContent('[data-book-count]')).includes('3 de 20'), await page.textContent('[data-book-count]'));
  await page.waitForTimeout(600);
  await shot(page, 'bichinho-livro-de-magias');
  await page.click('[data-modal="book"] [data-close]');

  // ---------------------------------------------------- salvamento local
  const saved = await petState(page);
  await page.reload();
  await page.waitForSelector('[data-screen="pet-game"].is-active');
  await page.waitForFunction(() => window.__app.pet.state && window.__app.pet.actor, null, { timeout: 30000 });
  st = await petState(page);
  check('progresso salvo ao recarregar (bichinho, mochila, estrelas, cartas)', st.selected === saved.selected &&
    st.inventory.agua === saved.inventory.agua && st.stars === saved.stars && st.magic.used[7] === 1 &&
    Math.abs(st.pets.urso.needs.higiene - saved.pets.urso.needs.higiene) < 1);

  // o tempo passa com o jogo fechado (10 horas)
  await page.goto(`${origin}/inclusiapp/manifest.webmanifest`);
  const before = await page.evaluate(() => {
    const key = 'sinalizaacao:pet';
    const data = JSON.parse(localStorage.getItem(key));
    const h = 10 * 3600e3;
    data.lastSeen -= h;
    for (const p of Object.values(data.pets)) p.lastUpdate -= h;
    localStorage.setItem(key, JSON.stringify(data));
    return data.pets.abelha.needs;
  });
  await page.goto(`${BASE}#/bichinho/jogar`);
  await page.waitForSelector('[data-screen="pet-game"].is-active');
  await page.waitForSelector('[data-modal="away"]:not([hidden])', { timeout: 15000 });
  st = await petState(page);
  check('10 h fora: a fome e a sede caíram com o tempo', before.fome - st.pets.abelha.needs.fome > 25 && before.sede - st.pets.abelha.needs.sede > 25,
    `fome ${Math.round(before.fome)} → ${Math.round(st.pets.abelha.needs.fome)}`);
  check('10 h fora: "Enquanto você estava fora..."', (await page.textContent('[data-away-time]')).includes('10 horas'), await page.textContent('[data-away-time]'));
  await shot(page, 'bichinho-enquanto-fora');
  await page.click('[data-modal="away"] [data-close]');

  // Sala mostra o resumo do bichinho
  await page.click('.pet-topbar a[href="#/sala"]');
  await page.waitForSelector('[data-screen="sala"].is-active');
  check('sala: resumo do Bichinho Virtual', (await page.textContent('[data-tile-meta="pet"]')).includes('precisa'), await page.textContent('[data-tile-meta="pet"]'));

  // o Jogo de Cartas continua funcionando depois das cartas mágicas (mesmo Controller do MindAR)
  await page.click('a[href="#/jogo"]');
  await page.waitForSelector('[data-screen="game-intro"].is-active');
  await page.evaluate(() => __fakeCam.clear());
  await page.click('[data-action="start-game"]');
  try {
    const target = await currentTarget(page);
    await page.waitForSelector('[data-reveal]', { state: 'hidden', timeout: 10000 });
    await page.evaluate((u) => __fakeCam.show(u), frame('cartas', target));
    await page.waitForFunction(() => window.__app.game.engine.stats.hits === 1, null, { timeout: 45000 });
    check('Jogo de Cartas funciona depois do Bichinho (acerto reconhecido)', true);
  } catch (err) {
    check('Jogo de Cartas funciona depois do Bichinho', false, err.message.split('\n')[0]);
  }
  check('bichinho sem erros de JavaScript', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.context().close();
}

/* ================================================================ erros */
async function testErrors() {
  const page = await newPage();
  await page.goto(`${BASE}#/livro`);
  await page.waitForSelector('[data-screen="book-intro"].is-active');
  for (const [mode, text] of [['denied', 'Precisamos acessar sua câmera'], ['notfound', 'Não encontramos uma câmera'], ['busy', 'A câmera está ocupada']]) {
    await page.evaluate((m) => { __fakeCam.mode = m; }, mode);
    if (await page.isVisible('[data-retry]')) await page.click('[data-retry]');
    else await page.click('[data-action="start-book"]');
    await page.waitForSelector('.ar-error', { timeout: 20000 });
    const msg = await page.textContent('.ar-error h2');
    check(`erro de câmera "${mode}": mensagem amigável`, msg.includes(text), msg);
    if (mode === 'denied') await shot(page, 'erro-camera-negada');
  }
  await page.evaluate(() => { __fakeCam.mode = 'ok'; });
  await page.evaluate((u) => __fakeCam.show(u), frame('paginas', 1));
  await page.click('[data-retry]');
  try {
    await waitAnimal(page, 'Elefante');
    check('erro de câmera: "Tentar novamente" recupera', true);
  } catch (err) {
    check('erro de câmera: "Tentar novamente" recupera', false, err.message.split('\n')[0]);
  }
  await page.context().close();
}

try {
  if (!only || only === 'telas') await testScreens();
  if (!only || only === 'livro') await testBook();
  if (!only || only === 'jogo') await testGame();
  if (!only || only === 'erros') await testErrors();
  if (!only || only === 'paisagem') await testLandscape();
  if (!only || only === 'sala') await testSala();
  if (!only || only === 'bichinho') await testPet();
} catch (err) {
  check('execução sem exceções', false, err.stack);
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações ok em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed.length ? 1 : 0);
