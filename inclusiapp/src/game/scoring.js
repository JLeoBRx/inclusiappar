/**
 * Pontuação do jogo de cartas.
 *
 * Original (Unity): CalculatePoints(time) devolvia 100/70/40/10 pontos
 * conforme o tempo (≤3 s, ≤6 s, ≤10 s, mais). Aqui o acerto vale
 * `hitPoints` + um bônus de tempo configurável; o modo 'tiers' reproduz
 * exatamente a tabela original.
 */

/** Bônus pelo tempo gasto (segundos) até acertar. */
export function timeBonus(seconds, cfg) {
  const t = Math.max(0, Number(seconds) || 0);
  if (cfg.mode === 'tiers') {
    for (const tier of cfg.tiers) if (t <= tier.upTo) return tier.bonus;
    return 0;
  }
  if (t <= cfg.fullUntil) return cfg.max;
  if (t >= cfg.zeroAt) return 0;
  return Math.round((cfg.max * (cfg.zeroAt - t)) / (cfg.zeroAt - cfg.fullUntil));
}

/** Pontos de um acerto: { base, bonus, total }. */
export function hitScore(seconds, scoring) {
  const base = scoring.hitPoints;
  const bonus = timeBonus(seconds, scoring.timeBonus);
  return { base, bonus, total: base + bonus };
}

/**
 * Aplica a penalidade sem deixar a pontuação abaixo de `minScore`.
 * Devolve quanto foi efetivamente descontado.
 */
export function applyPenalty(score, scoring) {
  const next = Math.max(scoring.minScore, score - scoring.wrongPenalty);
  return { score: next, deducted: score - next };
}
