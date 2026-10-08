/**
 * Inicialização do app SinalizaAção: Animais em Voga.
 *
 *   MENU ─┬─ 📖 LIVRO ─────────── explicação ─ AR (páginas → animais 3D + LIBRAS)
 *         └─ 🎮 SALA DE JOGOS ─┬─ 🃏 JOGO DE CARTAS ─── explicação ─ AR (cartas → pontos)
 *                              ├─ 🐾 BICHINHO VIRTUAL ─ como jogar ─ quarto + cartas mágicas (AR)
 *                              └─ ✋ SINALIZE E CONTE ─ como jogar ─ AR (carta → sinal → contar)
 */
import { Router } from './router.js';
import { BookExperience } from './ar/bookAR.js';
import { GameExperience } from './game/cardGame.js';
import { loadMindAR } from './ar/arSession.js';
import { setupMenu } from './ui/menu.js';
import { setupBookIntro, setupGameIntro } from './ui/instructions.js';
import { setupSala } from './ui/sala.js';
import { PetGame } from './pet/petGame.js';
import { setupPetIntro } from './pet/petIntro.js';
import { SignGame } from './sign/signGame.js';
import { setupSignIntro } from './sign/signIntro.js';
import { toast } from './ui/notifications.js';

const params = new URLSearchParams(location.search);
const $ = (selector) => document.querySelector(selector);
const screens = {
  menu: $('[data-screen="menu"]'),
  bookIntro: $('[data-screen="book-intro"]'),
  bookAR: $('[data-screen="book-ar"]'),
  gameIntro: $('[data-screen="game-intro"]'),
  gameAR: $('[data-screen="game-ar"]'),
  sala: $('[data-screen="sala"]'),
  petIntro: $('[data-screen="pet-intro"]'),
  petGame: $('[data-screen="pet-game"]'),
  signIntro: $('[data-screen="sign-intro"]'),
  signGame: $('[data-screen="sign-game"]'),
};

/* ---------------------------------------------------------------- loading */
const loading = {
  bar: $('#loading-bar'),
  text: $('#loading-text'),
  set(progress, text) {
    this.bar.style.width = `${Math.round(progress * 100)}%`;
    if (text) this.text.textContent = text;
  },
  async hide() {
    const el = $('#loading');
    el.classList.add('is-done');
    await new Promise((r) => setTimeout(r, 450));
    el.remove();
  },
};

function decodeImage(src) {
  const img = new Image();
  img.src = src;
  return (img.decode ? img.decode() : new Promise((r) => { img.onload = r; })).catch(() => {});
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
}

/* ---------------------------------------------------------------- telas */
const book = new BookExperience(screens.bookAR);
const game = new GameExperience(screens.gameAR);
const pet = new PetGame(screens.petGame);
const sign = new SignGame(screens.signGame);
let permit = null; // rota AR liberada por um toque em "Começar"
let resumeGame = false;

const router = new Router({
  '': { screen: screens.menu, ...setupMenu(screens.menu) },
  livro: {
    screen: screens.bookIntro,
    ...setupBookIntro(screens.bookIntro, {
      start: () => {
        permit = 'livro/ar';
        router.go('livro/ar');
      },
    }),
  },
  'livro/ar': {
    screen: screens.bookAR,
    guard: () => (permit === 'livro/ar' ? null : 'livro'),
    enter: () => book.enter(),
    leave: () => {
      permit = null;
      return book.leave();
    },
  },
  jogo: {
    screen: screens.gameIntro,
    ...setupGameIntro(screens.gameIntro, {
      start: ({ resume }) => {
        resumeGame = resume;
        permit = 'jogo/jogar';
        router.go('jogo/jogar');
      },
    }),
  },
  'jogo/jogar': {
    screen: screens.gameAR,
    guard: () => (permit === 'jogo/jogar' ? null : 'jogo'),
    enter: () => game.enter({ resume: resumeGame }),
    leave: () => {
      permit = null;
      return game.leave();
    },
  },
  sala: { screen: screens.sala, ...setupSala(screens.sala) },
  bichinho: {
    screen: screens.petIntro,
    ...setupPetIntro(screens.petIntro, {
      start: () => {
        pet.markTutorialSeen();
        router.go('bichinho/jogar');
      },
    }),
  },
  // o quarto não liga a câmera (ela só abre no botão "Cartas mágicas");
  // na primeira vez, passa antes pelo "Como jogar?"
  'bichinho/jogar': {
    screen: screens.petGame,
    guard: () => (pet.tutorialSeen() ? null : 'bichinho'),
    enter: () => pet.enter(),
    leave: () => pet.leave(),
  },
  sinalize: {
    screen: screens.signIntro,
    ...setupSignIntro(screens.signIntro, {
      start: () => {
        permit = 'sinalize/jogar';
        router.go('sinalize/jogar');
      },
    }),
  },
  // a câmera só abre depois de "Iniciar" (abrir o link direto leva ao "Como jogar?")
  'sinalize/jogar': {
    screen: screens.signGame,
    guard: () => (permit === 'sinalize/jogar' ? null : 'sinalize'),
    enter: () => sign.enter(),
    leave: () => {
      permit = null;
      return sign.leave();
    },
  },
});

/* ---------------------------------------------------------------- boot */
async function boot() {
  const started = performance.now();
  loading.set(0.15, 'Preparando sua experiência...');
  const wide = window.matchMedia('(min-width: 900px), (min-resolution: 2.5dppx)').matches;
  const tasks = [
    withTimeout(document.fonts?.ready || Promise.resolve(), 2500),
    decodeImage('assets/img/logo.webp'),
    decodeImage(wide ? 'assets/img/vila-1920.webp' : 'assets/img/vila-1080.webp'),
  ];
  let done = 0;
  tasks.forEach((t) => t.then(() => loading.set(0.15 + (0.75 * ++done) / tasks.length)));
  await withTimeout(Promise.all(tasks), 6000);
  loading.set(1, 'Tudo pronto!');
  // um instante para a animação de abertura (sem atrasar quem tem internet lenta)
  const elapsed = performance.now() - started;
  if (elapsed < 900) await new Promise((r) => setTimeout(r, 900 - elapsed));
  await router.start();
  await loading.hide();

  // deixa a biblioteca de AR pronta enquanto a pessoa escolhe no menu
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  if (!navigator.connection?.saveData) idle(() => loadMindAR().catch(() => {}), { timeout: 4000 });

  if ('serviceWorker' in navigator && !params.has('nosw') && !params.has('test')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sw]', err));
  }
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('[app]', event.reason);
});
window.addEventListener('error', (event) => {
  console.error('[app]', event.error || event.message);
});
window.addEventListener('offline', () => toast('📶 Você está sem internet. O que já foi carregado continua funcionando.', { type: 'warning' }));

if (params.has('test')) window.__app = { router, book, game, pet, sign };

boot().catch((err) => {
  console.error(err);
  const box = $('#loading-error');
  if (box) {
    box.hidden = false;
    box.innerHTML = 'Não foi possível iniciar o aplicativo. <button type="button" onclick="location.reload()">Tentar novamente</button>';
  }
});
