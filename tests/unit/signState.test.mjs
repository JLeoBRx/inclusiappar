import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGN_GAME, countQuestion, vowelByCard, vowelByLetter } from '../../inclusiapp/src/sign/signConfig.js';
import { PHASE, SignMatch } from '../../inclusiapp/src/sign/signState.js';
import { maxRoundScore, rankFor, stepPoints } from '../../inclusiapp/src/sign/signScore.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newMatch(seed = 1) {
  const clock = { now: 0 };
  const match = new SignMatch(SIGN_GAME, { now: () => clock.now, random: seeded(seed) });
  return { match, clock };
}

/** Joga uma rodada inteira: sinal em `signS` s e contagem em `countS` s. */
function playRound(match, clock, { signS = 1, countS = 0.5, wrongAnswers = 0, skip = false } = {}) {
  const round = match.nextRound();
  assert.equal(match.cardSeen(round.letter).type, 'ok');
  match.startSign();
  clock.now += signS * 1000;
  const sign = skip ? match.skipSign() : match.signCorrect();
  assert.ok(match.startCount());
  for (let i = 0; i < wrongAnswers; i++) {
    const wrong = round.animals === 1 ? 2 : 1;
    assert.equal(match.answer(wrong).type, 'wrong');
  }
  clock.now += countS * 1000;
  const count = match.answer(round.animals);
  assert.equal(count.type, 'correct');
  const end = match.finishRound();
  return { round, sign, count, end };
}

test('configuração: as 5 vogais usam só as cartas de vogais em LIBRAS (11 a 15) e animais do livro', () => {
  assert.deepEqual(SIGN_GAME.vowels.map((v) => v.letter), ['A', 'E', 'I', 'O', 'U']);
  assert.deepEqual(SIGN_GAME.vowels.map((v) => v.card), [11, 12, 13, 14, 15]);
  assert.deepEqual(SIGN_GAME.vowels.map((v) => v.animal), ['abelha', 'elefante', 'iguana', 'onca', 'urso']);
  assert.equal(vowelByCard(13).letter, 'I');
  assert.equal(vowelByCard(3), null, 'cartas de animais não são vogais');
  assert.equal(vowelByCard(18), null, 'letras impressas não contam: só os sinais em LIBRAS');
  assert.equal(countQuestion(vowelByLetter('A')), 'Quantas abelhas apareceram?');
  assert.equal(countQuestion(vowelByLetter('E')), 'Quantos elefantes apareceram?');
  assert.equal(countQuestion(vowelByLetter('O')), 'Quantas onças apareceram?');
});

test('pontuação do sinal: +100 e bônus pelo Tempo 1 (≤2 s +50, 2–4 +30, 4–6 +15, >6 +5)', () => {
  const s = SIGN_GAME.scoring.sign;
  assert.deepEqual(stepPoints(1.2, s), { base: 100, bonus: 50, total: 150 });
  assert.deepEqual(stepPoints(2, s), { base: 100, bonus: 50, total: 150 });
  assert.deepEqual(stepPoints(3.5, s), { base: 100, bonus: 30, total: 130 });
  assert.deepEqual(stepPoints(5, s), { base: 100, bonus: 15, total: 115 });
  assert.deepEqual(stepPoints(30, s), { base: 100, bonus: 5, total: 105 });
});

test('pontuação da contagem: +50 e bônus pelo Tempo 2 (≤1 s +30, 1–2 +20, 2–4 +10, >4 +0)', () => {
  const c = SIGN_GAME.scoring.count;
  assert.deepEqual(stepPoints(0.8, c), { base: 50, bonus: 30, total: 80 });
  assert.deepEqual(stepPoints(1.5, c), { base: 50, bonus: 20, total: 70 });
  assert.deepEqual(stepPoints(3, c), { base: 50, bonus: 10, total: 60 });
  assert.deepEqual(stepPoints(9, c), { base: 50, bonus: 0, total: 50 });
  assert.equal(maxRoundScore(SIGN_GAME.scoring), 230);
});

test('partida: 5 rodadas, cada vogal exatamente uma vez (baralho sem repetição)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { match, clock } = newMatch(seed);
    match.start();
    const letters = [];
    for (let i = 0; i < 5; i++) letters.push(playRound(match, clock).round.letter);
    assert.deepEqual([...letters].sort(), ['A', 'E', 'I', 'O', 'U']);
    assert.equal(match.phase, PHASE.FINISHED);
    assert.equal(match.nextRound(), null);
  }
});

test('"Jogar novamente": novo embaralhamento a cada partida', () => {
  const { match, clock } = newMatch(5);
  const orders = new Set();
  for (let game = 0; game < 8; game++) {
    match.start();
    const letters = [];
    for (let i = 0; i < 5; i++) letters.push(playRound(match, clock).round.letter);
    assert.deepEqual([...letters].sort(), ['A', 'E', 'I', 'O', 'U']);
    orders.add(letters.join(''));
  }
  assert.ok(orders.size >= 6, `ordens diferentes: ${orders.size}`);
});

test('quantidade de animais: sempre entre 1 e 3, e todas aparecem', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const { match } = newMatch(seed);
    match.start();
    const r = match.nextRound();
    assert.ok(r.animals >= 1 && r.animals <= 3);
    seen.add(r.animals);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('escanear a carta não basta: só o sinal reconhecido dá os pontos do sinal', () => {
  const { match, clock } = newMatch(2);
  match.start();
  const round = match.nextRound();
  const other = ['A', 'E', 'I', 'O', 'U'].find((l) => l !== round.letter);
  assert.equal(match.cardSeen(other).type, 'wrong');
  assert.equal(match.cardSeen(null).type, 'wrong', 'carta que não é de vogal');
  assert.equal(match.phase, PHASE.SCAN);
  assert.equal(match.signCorrect(), null, 'sinal antes de escanear é ignorado');
  assert.equal(match.cardSeen(round.letter).type, 'ok');
  assert.equal(match.phase, PHASE.SIGN);
  assert.equal(match.stats.score, 0, 'a carta sozinha não vale pontos');
  assert.equal(match.cardSeen(round.letter).type, 'ignored');
  match.startSign();
  clock.now += 3000;
  const r = match.signCorrect();
  assert.equal(r.total, 130);
  assert.equal(match.phase, PHASE.ANIMALS);
});

test('sinal errado: o tempo continua correndo (sem outra penalidade)', () => {
  const { match, clock } = newMatch(3);
  match.start();
  const round = match.nextRound();
  match.cardSeen(round.letter);
  match.startSign();
  clock.now += 1500;
  assert.ok(match.signWrong());
  clock.now += 3000;
  assert.ok(match.signWrong());
  const r = match.signCorrect();
  assert.equal(Math.round(r.seconds * 10) / 10, 4.5);
  assert.equal(r.total, 115);
  assert.equal(match.round.signAttempts, 2);
  assert.equal(match.stats.score, 115);
});

test('contagem errada: "vamos contar novamente" — a rodada continua até acertar', () => {
  const { match, clock } = newMatch(4);
  match.start();
  const { round, count } = playRound(match, clock, { countS: 1.5, wrongAnswers: 2 });
  assert.equal(round.countAttempts, 2);
  assert.equal(count.firstTry, false);
  assert.equal(count.total, 70);
  assert.equal(match.stats.countsCorrect, 0, 'só conta "contagem correta" quem acerta de primeira');
});

test('pular o sinal: sem pontos do sinal, mas a contagem continua', () => {
  const { match, clock } = newMatch(6);
  match.start();
  const { sign, count } = playRound(match, clock, { skip: true, countS: 0.5 });
  assert.equal(sign.skipped, true);
  assert.equal(sign.total, 0);
  assert.equal(count.total, 80);
  assert.equal(match.stats.signsCorrect, 0);
  assert.equal(match.stats.signsSkipped, 1);
});

test('pular a leitura da carta leva direto ao sinal', () => {
  const { match } = newMatch(7);
  match.start();
  match.nextRound();
  assert.ok(match.skipScan());
  assert.equal(match.phase, PHASE.SIGN);
  assert.equal(match.round.scanSkipped, true);
  assert.equal(match.skipScan(), false);
});

test('resumo: pontos, tempo total, sinais e contagens certas, sequência e classificação', () => {
  const { match, clock } = newMatch(8);
  match.start();
  playRound(match, clock, { signS: 1, countS: 0.5 }); // 150 + 80
  playRound(match, clock, { signS: 3, countS: 1.5 }); // 130 + 70
  playRound(match, clock, { signS: 5, countS: 3, wrongAnswers: 1 }); // 115 + 60 (quebra a sequência)
  playRound(match, clock, { signS: 1, countS: 0.5 }); // 150 + 80
  playRound(match, clock, { skip: true, signS: 20, countS: 0.5 }); // 0 + 80
  const s = match.summary();
  assert.equal(s.score, 230 + 200 + 175 + 230 + 80);
  assert.equal(s.maxScore, 1150);
  assert.equal(s.signsCorrect, 4);
  assert.equal(s.countsCorrect, 4);
  assert.equal(s.bestStreak, 5); // sinal+conta, sinal+conta, sinal (contagem errada quebra)
  assert.equal(Math.round(s.seconds), 1 + 0.5 + 3 + 1.5 + 5 + 3 + 1 + 0.5 + 20 + 0.5);
  assert.equal(s.results.length, 5);
  assert.equal(s.rank.title, 'Excelente!'); // 915 / 1150 ≈ 80%
});

test('classificação pela fração da pontuação máxima', () => {
  const ranks = SIGN_GAME.ranks;
  assert.equal(rankFor(1150, 1150, ranks).medal, '🥇');
  assert.equal(rankFor(870, 1150, ranks).title, 'Excelente!');
  assert.equal(rankFor(800, 1150, ranks).title, 'Muito bem!');
  assert.equal(rankFor(575, 1150, ranks).title, 'Muito bem!');
  assert.equal(rankFor(500, 1150, ranks).title, 'Continue praticando!');
  assert.equal(rankFor(0, 1150, ranks).medal, '🥉');
});

test('pausa (app em segundo plano) não conta tempo', () => {
  const { match, clock } = newMatch(9);
  match.start();
  const round = match.nextRound();
  match.cardSeen(round.letter);
  match.startSign();
  clock.now += 1000;
  match.pause();
  clock.now += 60000;
  match.resume();
  clock.now += 500;
  const r = match.signCorrect();
  assert.equal(r.seconds, 1.5);
  assert.equal(r.bonus, 50);
});

test('ações fora de hora são ignoradas', () => {
  const { match } = newMatch(10);
  match.start();
  assert.deepEqual(match.answer(1), { type: 'ignored' });
  assert.equal(match.startCount(), false);
  assert.equal(match.finishRound(), null);
  assert.equal(match.skipSign(), null);
  assert.equal(match.signWrong(), false);
});
