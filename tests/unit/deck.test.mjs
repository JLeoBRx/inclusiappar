import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Deck, shuffle } from '../../inclusiapp/src/game/deck.js';

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

// gerador determinístico (mulberry32) para testes reprodutíveis
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

test('shuffle devolve uma permutação sem alterar a entrada', () => {
  const input = range(20);
  const out = shuffle(input, seeded(1));
  assert.deepEqual(input, range(20));
  assert.deepEqual([...out].sort((a, b) => a - b), range(20));
  assert.notDeepEqual(out, input);
});

test('cada carta aparece exatamente uma vez por ciclo (20 cartas)', () => {
  const deck = new Deck(range(20), { random: seeded(7) });
  for (let cycle = 1; cycle <= 5; cycle++) {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const card = deck.draw();
      assert.ok(!seen.has(card), `carta ${card} repetida no ciclo ${cycle}`);
      seen.add(card);
    }
    assert.equal(seen.size, 20);
    assert.equal(deck.isCycleComplete, true);
    assert.equal(deck.cycle, cycle);
  }
});

test('funciona com qualquer quantidade de cartas (1, 2, 30)', () => {
  for (const n of [1, 2, 30]) {
    const deck = new Deck(range(n), { random: seeded(n) });
    const drawn = Array.from({ length: n }, () => deck.draw());
    assert.deepEqual([...drawn].sort((a, b) => a - b), range(n));
    assert.equal(deck.size, n);
  }
});

test('nunca repete a mesma carta na virada de ciclo', () => {
  for (let seed = 0; seed < 300; seed++) {
    const deck = new Deck(range(4), { random: seeded(seed) });
    let previous = null;
    for (let i = 0; i < 4 * 6; i++) {
      const card = deck.draw();
      assert.notEqual(card, previous, `seed ${seed}: carta ${card} repetida em sequência`);
      previous = card;
    }
  }
});

test('Math.random() puro repetiria cartas — o baralho não', () => {
  // sequência "ruim" do enunciado: 4, 4, 4, 2, 4
  const values = [0.75, 0.75, 0.75, 0.25, 0.75];
  let i = 0;
  const bad = () => values[i++ % values.length];
  const deck = new Deck([1, 2, 3, 4], { random: bad });
  const drawn = [deck.draw(), deck.draw(), deck.draw(), deck.draw()];
  assert.equal(new Set(drawn).size, 4);
});

test('pular consome a carta: ela não volta no mesmo ciclo', () => {
  const deck = new Deck(range(10), { random: seeded(3) });
  const skipped = deck.draw(); // o jogo "pula" esta carta
  const rest = Array.from({ length: 9 }, () => deck.draw());
  assert.ok(!rest.includes(skipped));
  assert.equal(deck.isCycleComplete, true);
});

test('contadores do ciclo', () => {
  const deck = new Deck(range(5), { random: seeded(9) });
  assert.equal(deck.remaining, 5);
  deck.draw();
  deck.draw();
  assert.equal(deck.drawnInCycle, 2);
  assert.equal(deck.remaining, 3);
});

test('salva e restaura o estado; recusa estado de outro baralho', () => {
  const deck = new Deck(range(8), { random: seeded(5) });
  deck.draw();
  deck.draw();
  const saved = JSON.parse(JSON.stringify(deck));
  const restored = new Deck(range(8), { random: seeded(99), state: saved });
  assert.deepEqual(restored.order, deck.order);
  assert.equal(restored.position, 2);
  assert.equal(restored.draw(), deck.draw());

  const other = new Deck(range(9), { random: seeded(1), state: saved });
  assert.equal(other.position, 0);
  assert.equal(other.size, 9);
});

test('baralho vazio é erro', () => {
  assert.throws(() => new Deck([]));
});
