import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS, PET, PETS } from '../../inclusiapp/src/pet/petConfig.js';
import {
  addItem, addXp, checkDaily, createState, dayKey, hasSavedState, itemCount, loadState, neededActions,
  normalizeState, petStatus, saveState, simulate, takeItem, xpForLevel,
} from '../../inclusiapp/src/pet/petState.js';

const HOUR = 3600e3;
const T0 = new Date(2026, 9, 8, 9, 0, 0).getTime(); // 8/out/2026 09:00 (hora local)
const never = () => 0.999999; // nunca adoece nos testes que não tratam disso

function memoryStore() {
  const data = new Map();
  return {
    data,
    get(key, fallback) {
      return data.has(key) ? JSON.parse(data.get(key)) : fallback;
    },
    set(key, value) {
      data.set(key, JSON.stringify(value));
    },
    remove(key) {
      data.delete(key);
    },
  };
}

test('estado novo: os 5 bichinhos do livro, necessidades iniciais e kit de boas-vindas', () => {
  const state = createState(T0);
  assert.deepEqual(Object.keys(state.pets), ['abelha', 'elefante', 'iguana', 'onca', 'urso']);
  assert.equal(PETS.length, 5);
  for (const pet of Object.values(state.pets)) {
    assert.deepEqual(Object.keys(pet.needs), NEEDS.map((n) => n.id));
    assert.deepEqual(pet.needs, PET.start);
    assert.equal(pet.lastUpdate, T0);
    assert.equal(pet.sick, false);
  }
  assert.deepEqual(state.inventory, PET.starterKit);
  assert.equal(state.selected, null);
});

test('salvar e carregar devolve o mesmo progresso', () => {
  const store = memoryStore();
  const state = createState(T0);
  state.selected = 'iguana';
  state.pets.iguana.needs.fome = 12.3456;
  state.pets.iguana.sick = true;
  state.pets.iguana.sickSince = T0;
  state.pets.urso.sleeping = true;
  state.pets.urso.sleepSince = T0;
  state.stars = 42;
  state.inventory = { agua: 4 };
  state.magic.used[7] = 2;
  saveState(store, state);
  assert.ok(hasSavedState(store));
  const { state: loaded, source } = loadState(store, T0);
  assert.equal(source, 'main');
  assert.equal(loaded.selected, 'iguana');
  assert.equal(loaded.pets.iguana.needs.fome, 12.35); // salvo com 2 casas
  assert.equal(loaded.pets.iguana.sick, true);
  assert.equal(loaded.pets.urso.sleeping, true);
  assert.equal(loaded.stars, 42);
  assert.deepEqual(loaded.inventory, { agua: 4 });
  assert.equal(loaded.magic.used[7], 2);
});

test('progresso corrompido usa a cópia de segurança; sem nada, começa do zero', () => {
  const store = memoryStore();
  const state = createState(T0);
  state.stars = 7;
  saveState(store, state, { backup: true });
  store.data.set(PET.storageKey, '{"isto não é json');
  store.get = ((get) => (key, fallback) => {
    try {
      return get(key, fallback);
    } catch {
      return fallback;
    }
  })(store.get);
  const restored = loadState(store, T0);
  assert.equal(restored.source, 'backup');
  assert.equal(restored.state.stars, 7);
  const empty = loadState(memoryStore(), T0);
  assert.equal(empty.source, 'new');
});

test('dados incompletos ou estranhos são corrigidos sem perder o resto', () => {
  const state = normalizeState({
    schema: 1,
    selected: 'dragao',
    stars: -5,
    inventory: { mel: 99, agua: -2, uva: 'x' },
    pets: {
      elefante: { needs: { fome: 150, sede: -3, higiene: 'sujo' }, poops: 12, level: 3, xp: 20 },
      unicornio: { needs: { fome: 50 } },
    },
  }, T0);
  assert.equal(state.selected, null);
  assert.equal(state.stars, 0);
  assert.deepEqual(state.inventory, { mel: PET.inventory.max });
  const e = state.pets.elefante;
  assert.equal(e.needs.fome, 100);
  assert.equal(e.needs.sede, 0);
  assert.equal(e.needs.higiene, PET.start.higiene);
  assert.equal(e.poops, PET.poop.max);
  assert.equal(e.level, 3);
  assert.ok(state.pets.abelha, 'bichinhos ausentes são criados');
  assert.ok(state.pets.unicornio, 'bichinho fora da configuração é guardado');
});

test('o tempo passa com o jogo fechado: necessidades caem conforme a configuração', () => {
  const state = createState(T0);
  simulate(state, T0 + 10 * HOUR, { random: never });
  const n = state.pets.elefante.needs;
  const decay = Object.fromEntries(NEEDS.map((d) => [d.id, d.decay]));
  assert.ok(Math.abs(n.fome - (PET.start.fome - 10 * decay.fome)) < 0.01, `fome ${n.fome}`);
  assert.ok(Math.abs(n.sede - (PET.start.sede - 10 * decay.sede)) < 0.01, `sede ${n.sede}`);
  assert.ok(Math.abs(n.sono - (PET.start.sono - 10 * decay.sono)) < 0.01, `sono ${n.sono}`);
  assert.equal(state.pets.elefante.lastUpdate, T0 + 10 * HOUR);
  assert.equal(state.lastSeen, T0 + 10 * HOUR);
});

test('a simulação dá o mesmo resultado em um passo grande ou em vários pequenos', () => {
  const a = createState(T0);
  const b = createState(T0);
  simulate(a, T0 + 6 * HOUR, { random: never });
  for (let t = T0 + 60e3; t <= T0 + 6 * HOUR; t += 60e3) simulate(b, t, { random: never });
  for (const id of Object.keys(a.pets[PETS[0].id].needs)) {
    assert.ok(Math.abs(a.pets.abelha.needs[id] - b.pets.abelha.needs[id]) < 0.05, id);
  }
});

test('ausência longa é limitada (ninguém volta para um desastre maior que o máximo)', () => {
  const a = createState(T0);
  const b = createState(T0);
  simulate(a, T0 + PET.time.maxOfflineHours * HOUR, { random: never });
  simulate(b, T0 + 30 * 24 * HOUR, { random: never });
  assert.deepEqual(b.pets.urso.needs, a.pets.urso.needs);
});

test('relógio do aparelho voltando no tempo não estraga nada', () => {
  const state = createState(T0);
  const before = JSON.stringify(state.pets.onca.needs);
  simulate(state, T0 - 5 * HOUR, { random: never });
  assert.equal(JSON.stringify(state.pets.onca.needs), before);
  assert.equal(state.pets.onca.lastUpdate, T0 - 5 * HOUR);
});

test('com sono baixo dorme sozinho e acorda descansado', () => {
  const state = createState(T0);
  const pet = state.pets.urso;
  pet.needs.sono = 10;
  const events = simulate(state, T0 + HOUR, { random: never });
  assert.ok(pet.sleeping, 'dormiu de cansaço');
  assert.ok(events.some((e) => e.type === 'fell-asleep' && e.pet === 'urso'));
  const fomeAoDormir = pet.needs.fome;
  const events2 = simulate(state, T0 + 12 * HOUR, { random: never });
  assert.equal(pet.sleeping, false);
  assert.ok(events2.some((e) => e.type === 'wake' && e.pet === 'urso'));
  // dormindo a fome cai mais devagar
  const acordado = createState(T0).pets.urso;
  assert.ok(fomeAoDormir - pet.needs.fome < (12 - 1) * NEEDS[0].decay * 0.8);
  assert.ok(acordado);
});

test('sujeira, fome e cocôs aumentam a chance de ficar doente; saúde cai doente', () => {
  const state = createState(T0);
  const pet = state.pets.iguana;
  pet.needs.higiene = 5;
  pet.needs.fome = 5;
  pet.poops = 3;
  const events = simulate(state, T0 + 2 * HOUR, { random: () => 0 }); // "sorteio" sempre positivo
  assert.ok(pet.sick, 'ficou doente');
  assert.ok(events.some((e) => e.type === 'sick' && e.pet === 'iguana'));
  const saude = pet.needs.saude;
  simulate(state, T0 + 4 * HOUR, { random: never });
  assert.ok(pet.needs.saude < saude, 'saúde cai enquanto está doente');
  // bichinho bem cuidado e imune não adoece
  const healthy = createState(T0);
  healthy.pets.abelha.immuneUntil = T0 + 100 * HOUR;
  simulate(healthy, T0 + 2 * HOUR, { random: () => 0 });
  assert.equal(healthy.pets.abelha.sick, false);
});

test('a chance de adoecer é pequena para um bichinho bem cuidado', () => {
  let sickCount = 0;
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 200; i++) {
    const state = createState(T0);
    simulate(state, T0 + 10 * HOUR, { random: rand });
    if (state.pets.abelha.sick) sickCount++;
  }
  assert.ok(sickCount < 20, `${sickCount}/200 adoeceram em 10 h`);
});

test('cocô aparece depois de comer (digestão) e respeita o máximo', () => {
  const state = createState(T0);
  const pet = state.pets.onca;
  pet.digestion = [T0 + 30 * 60e3, T0 + 40 * 60e3, T0 + 50 * 60e3, T0 + 60 * 60e3];
  const events = simulate(state, T0 + 2 * HOUR, { random: never });
  assert.equal(pet.poops, PET.poop.max);
  assert.equal(pet.digestion.length, 0);
  assert.ok(events.some((e) => e.type === 'poop'));
});

test('alertas e humor refletem as necessidades', () => {
  const state = createState(T0);
  const pet = state.pets.elefante;
  pet.needs = { fome: 100, sede: 100, higiene: 100, diversao: 100, sono: 100, saude: 100 };
  assert.equal(petStatus(pet).mood, 'feliz');
  pet.needs.fome = 20;
  let s = petStatus(pet);
  assert.equal(s.mood, 'precisa');
  assert.equal(s.urgent.need, 'fome');
  assert.equal(s.urgent.label, 'Com fome');
  pet.needs.higiene = 5;
  s = petStatus(pet);
  assert.equal(s.mood, 'triste');
  assert.equal(s.urgent.need, 'higiene', 'o mais baixo vem primeiro');
  pet.sick = true;
  s = petStatus(pet);
  assert.equal(s.mood, 'doente');
  assert.equal(s.urgent.label, 'Doente');
  pet.sleeping = true;
  assert.equal(petStatus(pet).mood, 'dormindo');
});

test('mochila: soma com limite e retira', () => {
  const state = createState(T0);
  state.inventory = {};
  assert.equal(addItem(state, 'agua', 3), 3);
  assert.equal(addItem(state, 'agua', 20), PET.inventory.max - 3);
  assert.equal(itemCount(state, 'agua'), PET.inventory.max);
  assert.ok(takeItem(state, 'agua'));
  assert.equal(takeItem(state, 'mel'), false);
});

test('experiência: sobe de nível e guarda o que sobrou', () => {
  const pet = createState(T0).pets.abelha;
  assert.equal(addXp(pet, xpForLevel(1) - 1), 0);
  assert.equal(addXp(pet, 1 + 10), 1);
  assert.equal(pet.level, 2);
  assert.equal(pet.xp, 10);
  assert.equal(addXp(pet, xpForLevel(2) + xpForLevel(3)), 2);
  assert.equal(pet.level, 4);
});

test('presente do dia e dias seguidos', () => {
  const state = createState(T0);
  const first = checkDaily(state, T0);
  assert.equal(first.first, true);
  assert.deepEqual(first.gift, {});
  assert.equal(checkDaily(state, T0 + HOUR), null, 'só uma vez por dia');
  state.inventory = {};
  state.pets.abelha.needs.sede = 0;
  const next = checkDaily(state, T0 + 24 * HOUR);
  assert.equal(next.streak, 2);
  assert.equal(Object.values(next.gift).reduce((a, b) => a + b, 0), PET.dailyGift);
  assert.ok(next.gift.agua, 'o presente traz o que os bichinhos mais precisam');
  const later = checkDaily(state, T0 + 5 * 24 * HOUR);
  assert.equal(later.streak, 1, 'pulou dias: recomeça');
  assert.equal(dayKey(T0), '2026-10-08');
});

test('remédio vira prioridade quando alguém está doente', () => {
  const state = createState(T0);
  state.pets.urso.sick = true;
  assert.equal(neededActions([state.pets.urso])[0], 'remedio');
});
