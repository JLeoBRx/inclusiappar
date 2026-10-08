import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, ITEMS, PET } from '../../inclusiapp/src/pet/petConfig.js';
import { createState } from '../../inclusiapp/src/pet/petState.js';
import { applyCare, blockReason, caress, clean, sleep, useAction, wake } from '../../inclusiapp/src/pet/petActions.js';

const T0 = new Date(2026, 9, 8, 9, 0, 0).getTime();
const half = () => 0.5;

function setup() {
  const state = createState(T0);
  state.selected = 'elefante';
  const pet = state.pets.elefante;
  return { state, pet };
}

test('alimentar usa comida da mochila, mata a fome e dá estrelas', () => {
  const { state, pet } = setup();
  pet.needs.fome = 20;
  const mel = state.inventory.mel;
  const stars = state.stars;
  const r = useAction(state, 'elefante', 'alimentar', { now: T0, random: half });
  assert.equal(r.ok, true);
  assert.equal(r.item, 'mel', 'usa o primeiro item disponível da lista');
  assert.equal(state.inventory.mel, mel - 1);
  assert.equal(pet.needs.fome, 20 + ITEMS.mel.power);
  assert.equal(r.deltas.fome, ITEMS.mel.power);
  assert.equal(state.stars, stars + PET.rewards.actionStars);
  assert.equal(pet.digestion.length, 1, 'vai fazer cocô depois');
  assert.ok(r.poopAt >= T0 + PET.poop.minMinutes * 60e3);
});

test('sem comida na mochila: pede uma carta mágica', () => {
  const { state, pet } = setup();
  pet.needs.fome = 10;
  state.inventory = {};
  const r = useAction(state, 'elefante', 'alimentar', { now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-item');
  assert.equal(pet.needs.fome, 10);
});

test('cheio recusa e não gasta o item', () => {
  const { state, pet } = setup();
  pet.needs.fome = 99;
  const before = { ...state.inventory };
  const r = useAction(state, 'elefante', 'alimentar', { now: T0 });
  assert.equal(r.reason, 'full');
  assert.deepEqual(state.inventory, before);
});

test('dormindo: não come nem brinca, mas toma remédio', () => {
  const { state, pet } = setup();
  pet.sleeping = true;
  pet.needs.fome = 10;
  pet.needs.saude = 40;
  assert.equal(useAction(state, 'elefante', 'alimentar').reason, 'sleeping');
  assert.equal(useAction(state, 'elefante', 'brincar').reason, 'sleeping');
  assert.equal(useAction(state, 'elefante', 'remedio').ok, true);
});

test('remédio cura a doença (mesmo com a saúde alta) e protege por um tempo', () => {
  const { state, pet } = setup();
  pet.sick = true;
  pet.needs.saude = 100;
  const r = useAction(state, 'elefante', 'remedio', { now: T0 });
  assert.equal(r.ok, true);
  assert.equal(r.cured, true);
  assert.equal(pet.sick, false);
  assert.equal(pet.immuneUntil, T0 + PET.sickness.immunityHours * 3600e3);
});

test('brincar é livre, diverte e cansa; cansado demais não brinca', () => {
  const { state, pet } = setup();
  pet.needs.diversao = 30;
  pet.needs.sono = 50;
  const inv = { ...state.inventory };
  const r = useAction(state, 'elefante', 'brincar', { now: T0 });
  assert.equal(r.ok, true);
  assert.deepEqual(state.inventory, inv, 'não gasta item');
  assert.equal(pet.needs.diversao, 30 + ACTIONS.brincar.power);
  assert.equal(pet.needs.sono, 50 - ACTIONS.brincar.cost.sono);
  pet.needs.sono = 5;
  pet.needs.diversao = 10;
  assert.equal(useAction(state, 'elefante', 'brincar').reason, 'tired');
});

test('comida favorita dá diversão extra', () => {
  const { state } = setup();
  const abelha = state.pets.abelha;
  abelha.needs.fome = 10;
  abelha.needs.diversao = 50;
  const r = applyCare(abelha, 'alimentar', { item: 'mel', now: T0 });
  assert.equal(r.favorite, true);
  assert.equal(abelha.needs.diversao, 50 + 10 + ITEMS.mel.bonus.diversao);
});

test('dormir só com sono; acordar só dormindo', () => {
  const { pet } = setup();
  pet.needs.sono = 95;
  assert.equal(sleep(pet, T0).reason, 'not-tired');
  pet.needs.sono = 40;
  assert.equal(sleep(pet, T0).ok, true);
  assert.equal(pet.sleeping, true);
  assert.equal(sleep(pet, T0).reason, 'sleeping');
  assert.equal(wake(pet).ok, true);
  assert.equal(wake(pet).reason, 'awake');
});

test('limpar remove os cocôs (todos ou um) e melhora a higiene', () => {
  const { state, pet } = setup();
  pet.poops = 3;
  pet.needs.higiene = 50;
  const one = clean(state, pet, 1);
  assert.equal(one.removed, 1);
  assert.equal(pet.poops, 2);
  const all = clean(state, pet);
  assert.equal(all.removed, 2);
  assert.equal(pet.poops, 0);
  assert.ok(pet.needs.higiene > 50);
  assert.equal(clean(state, pet).reason, 'clean');
});

test('carinho diverte com intervalo mínimo', () => {
  const { state, pet } = setup();
  pet.needs.diversao = 50;
  assert.equal(caress(state, pet, T0).ok, true);
  assert.equal(pet.needs.diversao, 50 + PET.caress.fun);
  assert.equal(caress(state, pet, T0 + 1000).reason, 'cooldown');
  assert.equal(caress(state, pet, T0 + PET.caress.cooldownSeconds * 1000).ok, true);
});

test('as necessidades nunca passam de 0 a 100', () => {
  const { pet } = setup();
  pet.needs.fome = 90;
  applyCare(pet, 'alimentar', { power: 500, now: T0 });
  assert.equal(pet.needs.fome, 100);
  assert.equal(blockReason(pet, 'alimentar'), 'full');
});
