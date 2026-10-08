/**
 * Pontuação do ✋ Sinalize e Conte (regras em SIGN_GAME.scoring).
 * Reaproveita o cálculo de bônus por faixas de tempo do Jogo de Cartas.
 */
import { timeBonus } from '../game/scoring.js';

/** Pontos de uma etapa (sinal ou contagem) feita em `seconds`: { base, bonus, total }. */
export function stepPoints(seconds, step) {
  const base = step.points;
  const bonus = timeBonus(seconds, step.speed);
  return { base, bonus, total: base + bonus };
}

function maxBonus(speed) {
  if (speed.mode === 'tiers') return Math.max(0, ...speed.tiers.map((t) => t.bonus));
  return speed.max;
}

/** Maior pontuação possível em uma rodada (tudo certo e rapidíssimo). */
export function maxRoundScore(scoring) {
  return scoring.sign.points + maxBonus(scoring.sign.speed) + scoring.count.points + maxBonus(scoring.count.speed);
}

/** Classificação final pela fração da pontuação máxima. */
export function rankFor(score, maxScore, ranks) {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const sorted = [...ranks].sort((a, b) => b.min - a.min);
  return sorted.find((r) => ratio >= r.min) || sorted[sorted.length - 1];
}
