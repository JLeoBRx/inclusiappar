import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJudge } from '../../inclusiapp/src/sign/signJudge.js';

const OPTS = { minScore: 0.5, holdMs: 700, wrongMs: 1600, unknownMs: 3200, cooldownMs: 2600, lostMs: 800, smoothing: 0.45 };
const hand = (scores) => [{ scores: { A: 0, E: 0, I: 0, O: 0, U: 0, ...scores } }];

/** Alimenta o juiz com o mesmo quadro por `ms` (12 quadros/s); devolve os eventos. */
function feed(judge, frame, ms, clock) {
  const events = [];
  let last = null;
  for (let t = 0; t <= ms; t += 83) {
    last = judge.update(frame, clock.now);
    if (last.event) events.push({ event: last.event, seen: last.seen, at: clock.now });
    clock.now += 83;
  }
  return { events, last };
}

test('sinal certo segurado por um instante → "correct" (uma única vez)', () => {
  const judge = new SignJudge('A', OPTS);
  const clock = { now: 1000 };
  const first = judge.update(hand({ A: 0.9 }), clock.now);
  assert.equal(first.state, 'match');
  assert.equal(first.event, null); // um quadro só não decide
  const { events, last } = feed(judge, hand({ A: 0.9 }), 1500, clock);
  assert.deepEqual(events.map((e) => e.event), ['correct']);
  assert.ok(events[0].at - 1000 >= 700, 'precisa segurar o sinal');
  assert.equal(last.progress, 1);
});

test('progresso cresce enquanto o sinal certo é segurado', () => {
  const judge = new SignJudge('E', OPTS);
  const clock = { now: 0 };
  const a = judge.update(hand({ E: 0.8 }), 0);
  const b = judge.update(hand({ E: 0.8 }), 350);
  assert.equal(a.progress, 0);
  assert.ok(b.progress > 0.4 && b.progress < 0.6);
  assert.equal(clock.now, 0);
});

test('mostrar outro sinal → "wrong" depois de wrongMs, respeitando o intervalo entre avisos', () => {
  const judge = new SignJudge('A', OPTS);
  const clock = { now: 0 };
  const { events } = feed(judge, hand({ E: 0.9 }), 6000, clock);
  assert.ok(events.length >= 2);
  assert.ok(events.every((e) => e.event === 'wrong' && e.seen === 'E'));
  assert.ok(events[0].at >= 1600);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].at - events[i - 1].at >= 2600);
});

test('formato de mão desconhecido demora mais para gerar o aviso', () => {
  const judge = new SignJudge('U', OPTS);
  const clock = { now: 0 };
  const { events } = feed(judge, hand({}), 4000, clock);
  assert.equal(events.length, 1);
  assert.equal(events[0].seen, null);
  assert.ok(events[0].at >= 3200);
});

test('passar rapidamente por outro sinal não gera aviso falso', () => {
  const judge = new SignJudge('O', OPTS);
  const clock = { now: 0 };
  const a = feed(judge, hand({ E: 0.9 }), 900, clock); // transição
  const b = feed(judge, hand({ O: 0.95 }), 1200, clock);
  assert.equal(a.events.length, 0);
  assert.deepEqual(b.events.map((e) => e.event), ['correct']);
});

test('um quadro ruim no meio não zera o tempo segurando o sinal', () => {
  const judge = new SignJudge('I', OPTS);
  judge.update(hand({ I: 0.9 }), 0);
  judge.update(hand({ I: 0.9 }), 300);
  const glitch = judge.update(hand({ I: 0.1, U: 0.2 }), 380);
  assert.equal(glitch.state, 'match', 'tolerância a 1 quadro');
  const r = judge.update(hand({ I: 0.9 }), 720);
  assert.equal(r.event, 'correct');
});

test('sem mão na câmera: nada acontece, e a contagem recomeça se a mão some', () => {
  const judge = new SignJudge('A', OPTS);
  const none = judge.update([], 0);
  assert.equal(none.state, 'nohand');
  assert.equal(none.event, null);
  judge.update(hand({ A: 0.9 }), 100);
  judge.update(hand({ A: 0.9 }), 500);
  judge.update([], 600);
  judge.update([], 1500); // sumiu por mais que lostMs
  const back = judge.update(hand({ A: 0.9 }), 1600);
  assert.equal(back.progress, 0);
  assert.equal(back.event, null);
});

test('com duas mãos, vale a que faz o sinal pedido', () => {
  const judge = new SignJudge('U', OPTS);
  const frame = [{ scores: { A: 0.9, E: 0, I: 0, O: 0, U: 0 } }, { scores: { A: 0, E: 0, I: 0, O: 0, U: 0.85 } }];
  let event = null;
  for (let t = 0; t <= 900; t += 83) event = judge.update(frame, t).event || event;
  assert.equal(event, 'correct');
});

test('o sinal pedido precisa ser o mais parecido (empate com outra vogal não basta para errar)', () => {
  const judge = new SignJudge('E', OPTS);
  const r = judge.update(hand({ E: 0.6, O: 0.7 }), 0);
  assert.equal(r.state, 'other');
  assert.equal(r.seen, 'O');
});
