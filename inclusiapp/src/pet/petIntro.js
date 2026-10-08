/**
 * Tela "🐾 COMO JOGAR?" do Bichinho Virtual (antes do jogo).
 *
 * Enquanto a pessoa lê, o modelo 3D do bichinho e a biblioteca de AR com as
 * imagens das cartas começam a baixar em segundo plano — exceto no modo de
 * economia de dados.
 */
import { GAME } from '../config.js';
import { loadMindAR } from '../ar/arSession.js';
import { prefetchTargets } from '../ar/targets.js';
import { storage } from '../ui/storage.js';
import { unlockAudio } from '../ui/sound.js';
import { petsNeedingCare } from '../ui/sala.js';
import { PETS } from './petConfig.js';
import { loadState } from './petState.js';
import { loadPetModel } from './petRoom.js';

export function setupPetIntro(screen, { start }) {
  const button = screen.querySelector('[data-action="start-pet"]');
  const label = button.querySelector('[data-pet-label]');
  const info = button.querySelector('[data-pet-info]');
  button.addEventListener('click', () => {
    unlockAudio();
    start();
  });

  return {
    enter() {
      const pets = petsNeedingCare();
      label.textContent = pets ? '▶️ CONTINUAR CUIDANDO' : '🐾 COMEÇAR A CUIDAR';
      info.textContent = pets ? `⭐ ${pets.stars}${pets.needy ? ` · ${pets.needy} ${pets.needy > 1 ? 'precisam' : 'precisa'} de você` : ' · todos bem'}` : '';
      info.hidden = !pets;
      if (navigator.connection?.saveData) return;
      const selected = pets ? loadState(storage).state.selected : null;
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
      idle(() => {
        loadPetModel(PETS.find((p) => p.id === selected) || PETS[0]).catch(() => {});
        loadMindAR().catch(() => {});
        prefetchTargets(GAME.targets);
      }, { timeout: 3000 });
    },
  };
}
