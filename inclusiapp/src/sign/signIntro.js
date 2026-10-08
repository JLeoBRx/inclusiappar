/**
 * Tela "✋ COMO JOGAR?" do Sinalize e Conte (antes da câmera).
 *
 * Mostra as vogais com seus animais (lidas de signConfig.js) e os recordes
 * salvos. Enquanto a pessoa lê, já baixa em segundo plano o que o jogo usa:
 * biblioteca de AR e imagens das cartas (as mesmas do Jogo de Cartas), o
 * reconhecimento de mãos (MediaPipe) e os modelos 3D dos animais — exceto
 * no modo de economia de dados do celular.
 */
import { ANIMALS, GAME } from '../config.js';
import { loadMindAR } from '../ar/arSession.js';
import { prefetchTargets } from '../ar/targets.js';
import { storage } from '../ui/storage.js';
import { unlockAudio } from '../ui/sound.js';
import { SIGN_GAME } from './signConfig.js';
import { formatDuration, loadRecords } from './signRecords.js';
import { prefetchHandLandmarker } from './handTracker.js';
import { prefetchAnimals } from './signAnimals.js';

export const animalOf = (vowel) => ANIMALS.find((a) => a.id === vowel.animal);
export const cardThumb = (card) => `assets/img/cartas-mini/carta${card}.webp`;

function renderVowels(list) {
  list.replaceChildren(...SIGN_GAME.vowels.map((v) => {
    const animal = animalOf(v);
    const li = document.createElement('li');
    li.className = 'sign-vowel';
    li.innerHTML = `
      <img class="sign-vowel__card" src="${cardThumb(v.card)}" alt="Sinal da letra ${v.letter} em LIBRAS" width="120" height="169" loading="lazy">
      <span class="sign-vowel__letter">${v.letter}</span>
      <span class="sign-vowel__animal"><span aria-hidden="true">${animal?.emoji || '🐾'}</span> ${animal?.name || v.animal}</span>`;
    return li;
  }));
}

/** Caixa "🏆 SEUS RECORDES" (também usada no fim da partida). */
export function recordsHtml(records, improved = {}) {
  const badge = (on) => (on ? ' <b class="sign-records__new">NOVO!</b>' : '');
  return `
    <div><dt>⭐ Maior pontuação</dt><dd>${records.bestScore}${badge(improved.score)}</dd></div>
    <div><dt>⏱️ Melhor tempo</dt><dd>${records.bestTime === null ? '—' : formatDuration(records.bestTime)}${badge(improved.time)}</dd></div>
    <div><dt>🔥 Maior sequência</dt><dd>${records.bestStreak} acerto${records.bestStreak === 1 ? '' : 's'}${badge(improved.streak)}</dd></div>`;
}

/** Bônus máximo de rapidez de uma etapa (para o texto da pontuação). */
const maxBonus = (speed) => (speed.mode === 'tiers' ? Math.max(...speed.tiers.map((t) => t.bonus)) : speed.max);

function renderScoring(list) {
  const { sign, count } = SIGN_GAME.scoring;
  list.innerHTML = `
    <li><span aria-hidden="true">✋</span> Sinal correto: <strong>+${sign.points}</strong> pontos + até <strong>${maxBonus(sign.speed)}</strong> de rapidez</li>
    <li><span aria-hidden="true">🔢</span> Contagem correta: <strong>+${count.points}</strong> pontos + até <strong>${maxBonus(count.speed)}</strong> de rapidez</li>
    <li><span aria-hidden="true">🔁</span> Errou? Sem problema: tente de novo — só o tempo continua correndo.</li>`;
}

export function setupSignIntro(screen, { start }) {
  const button = screen.querySelector('[data-action="start-sign"]');
  const box = screen.querySelector('[data-records]');
  const stats = box.querySelector('[data-records-list]');
  const empty = box.querySelector('[data-records-empty]');
  const totals = box.querySelector('[data-records-totals]');
  renderVowels(screen.querySelector('[data-vowels]'));
  renderScoring(screen.querySelector('[data-scoring]'));
  button.addEventListener('click', () => {
    unlockAudio();
    start();
  });

  return {
    enter() {
      const records = loadRecords(storage);
      const played = records.matches > 0;
      stats.hidden = !played;
      totals.hidden = !played;
      empty.hidden = played;
      if (played) {
        stats.innerHTML = recordsHtml(records);
        totals.textContent = `🎮 ${records.matches} partida${records.matches > 1 ? 's' : ''} · ✋ ${records.signsCorrect} sinais certos · 🔢 ${records.countsCorrect} contagens certas`;
      }
      if (navigator.connection?.saveData) return;
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
      idle(() => {
        loadMindAR().catch(() => {});
        prefetchTargets(GAME.targets);
        prefetchAnimals(SIGN_GAME.vowels.map(animalOf).filter(Boolean));
        prefetchHandLandmarker();
      }, { timeout: 3000 });
    },
  };
}
