import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardGameEngine, PHASE } from '../../inclusiapp/src/game/gameState.js';
import { GAME } from '../../inclusiapp/src/config.js';

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function setup(n = 20, overrides = {}) {
  let now = 0;
  const clock = { advance: (s) => { now += s * 1000; } };
  const engine = new CardGameEngine({
    cards: range(n),
    scoring: { ...GAME.scoring, ...overrides.scoring },
    wrongScan: { ...GAME.wrongScan, ...overrides.wrongScan },
    random: () => 0.42,
    now: () => now,
    state: overrides.state,
  });
  return { engine, clock };
}

const other = (engine, n = 20) => range(n).find((c) => c !== engine.current);

test('acerto soma pontos fixos + bônus e registra tempo', () => {
  const { engine, clock } = setup();
  const card = engine.startMission();
  assert.equal(engine.phase, PHASE.SEARCHING);
  clock.advance(4.2);
  const r = engine.detect(card);
  assert.equal(r.type, 'hit');
  assert.equal(r.seconds, 4.2);
  assert.equal(r.base, GAME.scoring.hitPoints);
  assert.equal(r.bonus, GAME.scoring.timeBonus.max);
  assert.equal(engine.stats.hits, 1);
  assert.equal(engine.stats.score, r.total);
  assert.equal(engine.phase, PHASE.RESOLVED);
  // depois do acerto, novas leituras são ignoradas até a próxima missão
  assert.equal(engine.detect(card).type, 'ignored');
});

test('erro desconta pontos e a carta-alvo continua a mesma', () => {
  const { engine, clock } = setup();
  const target = engine.startMission();
  engine.stats.score = 100;
  clock.advance(2);
  const r = engine.detect(other(engine));
  assert.equal(r.type, 'wrong');
  assert.equal(r.counted, true);
  assert.equal(r.penalty, GAME.scoring.wrongPenalty);
  assert.equal(engine.stats.score, 100 - GAME.scoring.wrongPenalty);
  assert.equal(engine.stats.errors, 1);
  assert.equal(engine.current, target);
  assert.equal(engine.phase, PHASE.SEARCHING);
});

test('pontuação não fica negativa', () => {
  const { engine, clock } = setup();
  engine.startMission();
  for (let i = 0; i < 3; i++) {
    clock.advance(10);
    engine.detect(range(20).filter((c) => c !== engine.current)[i]);
  }
  assert.equal(engine.stats.score, 0);
});

test('proteções contra penalidade repetida', () => {
  const { engine, clock } = setup();
  engine.startMission();
  engine.stats.score = 1000;
  const [w1, w2, w3] = range(20).filter((c) => c !== engine.current);
  assert.equal(engine.detect(w1).counted, true); // t = 0 s
  clock.advance(2); // t = 2 s
  assert.equal(engine.detect(w1).reason, 'same-card'); // mesma carta antes de 6 s
  assert.equal(engine.detect(w2).counted, true); // outra carta, já passou 1,5 s
  clock.advance(7); // t = 9 s
  assert.equal(engine.detect(w1).counted, true); // mesma carta depois do intervalo
  clock.advance(10);
  assert.equal(engine.detect(w3).reason, 'max-per-mission'); // limite de 3 por carta sorteada
  assert.equal(engine.stats.errors, GAME.wrongScan.maxPerMission);
  assert.equal(engine.stats.score, 1000 - 3 * GAME.scoring.wrongPenalty);
});

test('intervalo global entre penalidades', () => {
  const { engine, clock } = setup();
  engine.startMission();
  engine.stats.score = 1000;
  const [a, b] = range(20).filter((c) => c !== engine.current);
  assert.equal(engine.detect(a).counted, true);
  clock.advance(0.5);
  assert.equal(engine.detect(b).reason, 'cooldown');
});

test('carta que já estava na câmera não penaliza até sair de cena', () => {
  const { engine, clock } = setup();
  const first = engine.startMission();
  engine.detect(first); // acerto
  const next = engine.startMission({ visibleCards: [first] });
  assert.notEqual(next, first);
  clock.advance(3);
  assert.equal(engine.detect(first).reason, 'already-visible');
  engine.cardLost(first);
  clock.advance(1);
  assert.equal(engine.detect(first).counted, true);
});

test('pular conta como pulo e consome a carta', () => {
  const { engine } = setup(3);
  const a = engine.startMission();
  assert.equal(engine.skip().type, 'skipped');
  assert.equal(engine.stats.skips, 1);
  const b = engine.startMission();
  const c = engine.startMission() && engine.current;
  assert.equal(new Set([a, b, c]).size, 3);
});

test('fim de ciclo: resumo e novo baralho', () => {
  const { engine, clock } = setup(20);
  for (let i = 0; i < 20; i++) {
    const card = engine.startMission();
    clock.advance(6);
    if (i % 5 === 4) engine.skip();
    else engine.detect(card);
  }
  assert.equal(engine.cycleComplete, true);
  assert.equal(engine.startMission(), null);
  assert.equal(engine.phase, PHASE.CYCLE_COMPLETE);
  const s = engine.summary();
  assert.equal(s.used, 20);
  assert.equal(s.total, 20);
  assert.equal(s.hits, 16);
  assert.equal(s.skips, 4);
  engine.newCycle();
  assert.equal(engine.stats.score, 0);
  assert.equal(engine.deck.cycle, 2);
  assert.ok(engine.startMission() !== null);
});

test('continuar jogo: restaura baralho, placar e carta atual', () => {
  const { engine, clock } = setup(10);
  const first = engine.startMission();
  clock.advance(3);
  engine.detect(first);
  const target = engine.startMission();
  const saved = JSON.parse(JSON.stringify(engine));
  const { engine: restored } = setup(10, { state: saved });
  assert.equal(restored.current, target);
  assert.equal(restored.phase, PHASE.SEARCHING);
  assert.deepEqual(restored.stats, engine.stats);
  assert.equal(restored.deck.drawnInCycle, 2);
});
