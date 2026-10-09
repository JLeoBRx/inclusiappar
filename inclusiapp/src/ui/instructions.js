/**
 * Telas explicativas (antes da câmera).
 *
 * Enquanto a pessoa lê, os arquivos pesados da próxima etapa (biblioteca de
 * AR e imagens de reconhecimento) já começam a baixar em segundo plano —
 * exceto quando o celular está em modo de economia de dados.
 */
import { BOOK, GAME } from '../config.js';
import { loadMindAR } from '../ar/arSession.js';
import { prefetchTargets, loadTargets } from '../ar/targets.js';
import { savedGameInfo } from '../game/cardGame.js';
import { unlockAudio } from './sound.js';

const saveData = () => !!navigator.connection?.saveData;

function prefetch(targets) {
  if (saveData()) return;
  loadMindAR().catch(() => {});
  prefetchTargets(targets);
}

export function setupBookIntro(screen, { start }) {
  screen.querySelector('[data-action="start-book"]').addEventListener('click', () => start());
  return {
    enter() {
      prefetch(BOOK.targets);
    },
  };
}

export function setupGameIntro(screen, { start }) {
  const continueBtn = screen.querySelector('[data-action="continue-game"]');
  const continueInfo = screen.querySelector('[data-continue-info]');
  const countInfo = screen.querySelector('[data-card-count]');
  screen.querySelector('[data-action="start-game"]').addEventListener('click', () => {
    unlockAudio();
    start({ resume: false });
  });
  continueBtn.addEventListener('click', () => {
    unlockAudio();
    start({ resume: true });
  });
  return {
    enter() {
      prefetch(GAME.targets);
      const saved = savedGameInfo();
      continueBtn.hidden = !saved;
      if (saved) continueInfo.textContent = `(${saved.used}/${saved.total} cartas · ${saved.score} pts)`;
      // quantidade de cartas vem do manifesto gerado a partir da pasta /cartas
      fetch(`${GAME.targets}.json`).then((r) => (r.ok ? r.json() : null)).then((m) => {
        if (m?.count) countInfo.textContent = `Este baralho tem ${m.count} cartas.`;
      }).catch(() => {});
      if (saveData()) return;
      loadTargets(GAME.targets).catch(() => {});
    },
  };
}
