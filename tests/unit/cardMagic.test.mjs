import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../../inclusiapp/src/config.js';
import { ACTIONS, CARD_MAGIC, ITEMS, PET, PETS } from '../../inclusiapp/src/pet/petConfig.js';
import { createState } from '../../inclusiapp/src/pet/petState.js';
import {
  castCard, cooldownLeft, describeMagic, effectTypes, magicBook, magicFor, registerEffect,
} from '../../inclusiapp/src/pet/cardMagic.js';

const T0 = new Date(2026, 9, 8, 9, 0, 0).getTime();

function setup(selected = 'elefante') {
  const state = createState(T0);
  state.selected = selected;
  return state;
}

test('todas as 20 cartas têm uma magia válida (efeitos, ações e itens existentes)', () => {
  const types = effectTypes();
  for (let id = 1; id <= 20; id++) {
    const magic = CARD_MAGIC[id];
    assert.ok(magic, `carta ${id} sem magia`);
    assert.ok(magic.name && magic.emoji, `carta ${id} sem nome/emoji`);
    assert.ok(magic.effects.length, `carta ${id} sem efeitos`);
    for (const e of magic.effects) {
      assert.ok(types.includes(e.type), `carta ${id}: tipo ${e.type}`);
      if (e.action) assert.ok(ACTIONS[e.action]?.need, `carta ${id}: ação ${e.action}`);
      if (e.item) assert.ok(ITEMS[e.item], `carta ${id}: item ${e.item}`);
    }
    assert.ok(describeMagic(magicFor(id)).every((t) => t.length > 5), `carta ${id}: descrição`);
    assert.equal(magicFor(id).label, GAME.labels[id]);
  }
});

test('cada necessidade com item pode ser atendida por cartas', () => {
  const covered = new Set();
  for (const magic of Object.values(CARD_MAGIC)) {
    for (const e of magic.effects) {
      if (e.type === 'care') covered.add(ACTIONS[e.action].need);
      if (e.type === 'item') covered.add(ACTIONS[ITEMS[e.item].action].need);
    }
  }
  for (const need of ['fome', 'sede', 'higiene', 'diversao', 'sono', 'saude']) assert.ok(covered.has(need), need);
});

test('carta da Abelha: o bichinho escolhido come mel na hora', () => {
  const state = setup('iguana');
  state.pets.iguana.needs.fome = 20;
  const r = castCard(state, 1, { now: T0, random: () => 0.5 });
  assert.equal(r.ok, true);
  assert.equal(r.magic.name, CARD_MAGIC[1].name);
  const care = r.outcomes.find((o) => o.kind === 'care');
  assert.equal(care.pet, 'iguana');
  assert.equal(care.ok, true);
  assert.equal(state.pets.iguana.needs.fome, 20 + ITEMS.mel.power);
  assert.equal(state.pets.elefante.needs.fome, PET.start.fome, 'os outros não comem');
});

test('sinal do Elefante em LIBRAS: banho e água para os 5 bichinhos', () => {
  const state = setup();
  for (const p of Object.values(state.pets)) {
    p.needs.higiene = 10;
    p.needs.sede = 10;
  }
  const r = castCard(state, 7, { now: T0 });
  assert.equal(r.ok, true);
  for (const p of PETS) {
    assert.ok(state.pets[p.id].needs.higiene > 70, `${p.id} higiene`);
    assert.ok(state.pets[p.id].needs.sede > 30, `${p.id} sede`);
  }
});

test('vogal em LIBRAS dá itens em dobro; letra dá um item', () => {
  const state = setup();
  state.inventory = {};
  castCard(state, 11, { now: T0 });
  assert.equal(state.inventory.agua, 2);
  castCard(state, 16, { now: T0 });
  assert.equal(state.inventory.agua, 3);
});

test('a magia nunca se perde: se ninguém precisa, vira item na mochila', () => {
  const state = setup();
  state.inventory = {};
  state.pets.elefante.needs.fome = 100;
  const r = castCard(state, 1, { now: T0 });
  assert.equal(r.ok, true);
  const stored = r.outcomes.find((o) => o.kind === 'item');
  assert.equal(stored.item, 'mel');
  assert.equal(stored.stored, true);
  assert.equal(state.inventory.mel, 1);
});

test('dormindo: comida vai para a mochila, mas a soneca do urso funciona', () => {
  const state = setup();
  const pet = state.pets.elefante;
  pet.sleeping = true;
  pet.needs.fome = 10;
  pet.needs.sono = 20;
  state.inventory = {};
  castCard(state, 1, { now: T0 });
  assert.equal(pet.needs.fome, 10);
  assert.equal(state.inventory.mel, 1);
  castCard(state, 3, { now: T0 });
  assert.equal(pet.needs.sono, 60);
});

test('cada carta recarrega antes de ser usada de novo', () => {
  const state = setup();
  assert.equal(castCard(state, 16, { now: T0 }).ok, true);
  const again = castCard(state, 16, { now: T0 + 5000 });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'cooldown');
  assert.equal(again.remaining, PET.magic.cardCooldownSeconds - 5);
  assert.equal(cooldownLeft(state, 16, T0 + PET.magic.cardCooldownSeconds * 1000), 0);
  assert.equal(castCard(state, 16, { now: T0 + PET.magic.cardCooldownSeconds * 1000 }).ok, true);
  assert.equal(castCard(state, 17, { now: T0 + 5000 }).ok, true, 'outra carta não espera');
});

test('primeira vez de cada carta dá estrelas extras e entra no Livro de Magias', () => {
  const state = setup();
  const first = castCard(state, 12, { now: T0 });
  assert.equal(first.firstTime, true);
  assert.equal(first.stars, PET.rewards.magicStars + PET.rewards.newCardStars);
  const second = castCard(state, 12, { now: T0 + 3600e3 });
  assert.equal(second.firstTime, false);
  assert.equal(second.stars, PET.rewards.magicStars);
  assert.equal(state.magic.used[12], 2);
});

test('sem bichinho escolhido a magia espera', () => {
  const state = createState(T0);
  assert.equal(castCard(state, 1, { now: T0 }).reason, 'no-pet');
});

test('carta nova (fora da tabela) usa a magia padrão: o item que o bichinho mais precisa', () => {
  const state = setup();
  state.inventory = {};
  state.pets.elefante.needs.higiene = 0;
  const r = castCard(state, 21, { now: T0 });
  assert.equal(r.ok, true);
  assert.equal(r.magic.isDefault, true);
  assert.equal(r.magic.label, 'Carta 21');
  assert.equal(state.inventory.esponja, 1);
});

test('é fácil criar um novo tipo de efeito', () => {
  registerEffect('festa-teste', {
    apply(ctx) {
      for (const pet of ctx.allPets) pet.needs.diversao = 100;
      return [{ kind: 'festa' }];
    },
    describe: () => 'Todo mundo se diverte',
  });
  const state = setup();
  CARD_MAGIC[99] = { name: 'Festa', emoji: '🎉', effects: [{ type: 'festa-teste' }] };
  try {
    const r = castCard(state, 99, { now: T0 });
    assert.deepEqual(r.outcomes, [{ kind: 'festa' }]);
    assert.ok(Object.values(state.pets).every((p) => p.needs.diversao === 100));
    assert.deepEqual(describeMagic(magicFor(99)), ['Todo mundo se diverte']);
  } finally {
    delete CARD_MAGIC[99];
  }
});

test('Livro de Magias: grupos das 20 cartas e cartas novas em "Outras cartas"', () => {
  const ids = Array.from({ length: 21 }, (_, i) => i + 1);
  const book = magicBook(ids);
  assert.deepEqual(book.map((g) => g.id), ['animais', 'sinais', 'vogais', 'letras', 'outras']);
  assert.equal(book.slice(0, 4).reduce((n, g) => n + g.cards.length, 0), 20);
  assert.equal(book[4].cards[0].card, 21);
});
