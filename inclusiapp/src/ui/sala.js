/**
 * SALA DE JOGOS: Jogo de Cartas, Bichinho Virtual e o próximo jogo (em breve).
 *
 * Os cartões mostram um resumo do progresso salvo de cada jogo — só leitura:
 * nada aqui muda o funcionamento dos jogos.
 */
import { savedGameInfo } from '../game/cardGame.js';
import { PETS } from '../pet/petConfig.js';
import { hasSavedState, loadState, petStatus, simulate } from '../pet/petState.js';
import { storage } from './storage.js';
import { toast } from './notifications.js';

/** Quantos bichinhos precisam de cuidado agora (prévia, sem sortear doenças). */
export function petsNeedingCare() {
  if (!hasSavedState(storage)) return null;
  const { state } = loadState(storage);
  simulate(state, Date.now(), { random: () => 1 });
  return {
    stars: state.stars,
    needy: PETS.filter((p) => petStatus(state.pets[p.id]).alerts.length).length,
  };
}

export function setupSala(screen) {
  const soon = screen.querySelector('[data-action="soon"]');
  soon.addEventListener('click', () => {
    toast('🔒 Em breve! Um novo jogo está sendo preparado para você.', { duration: 3200 });
    soon.classList.remove('is-locked');
    void soon.offsetWidth;
    soon.classList.add('is-locked');
  });
  const cardsMeta = screen.querySelector('[data-tile-meta="cards"]');
  const petMeta = screen.querySelector('[data-tile-meta="pet"]');
  const sala = screen.querySelector('.sala');

  return {
    enter() {
      // Jogo de Cartas: jogo salvo ou recorde (as mesmas informações que o jogo já guarda)
      const saved = savedGameInfo();
      const record = storage.get('gameRecord', 0);
      cardsMeta.textContent = saved ? `▶️ Jogo salvo: ${saved.used}/${saved.total} cartas`
        : record ? `🏆 Recorde: ${record} pontos` : '';
      cardsMeta.hidden = !cardsMeta.textContent;

      const pets = petsNeedingCare();
      if (!pets) petMeta.textContent = '✨ Novidade! Cuide dos 5 animais';
      else if (pets.needy) petMeta.textContent = `🐾 ${pets.needy} bichinho${pets.needy > 1 ? 's precisam' : ' precisa'} de você!`;
      else petMeta.textContent = `⭐ ${pets.stars} estrelas · todos bem!`;

      sala.classList.remove('is-entering');
      requestAnimationFrame(() => sala.classList.add('is-entering'));
    },
  };
}
