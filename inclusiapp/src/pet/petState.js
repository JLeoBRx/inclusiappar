/**
 * ESTADO DO BICHINHO VIRTUAL — dados, passagem do tempo e salvamento.
 *
 * Só lógica (sem DOM): roda no navegador e nos testes em Node.
 *
 * Estrutura salva no aparelho (localStorage "sinalizaacao:pet"):
 *
 *   {
 *     schema: 1,                       versão do formato (ver migrate)
 *     createdAt, lastSeen,             horários em ms (Date.now())
 *     selected: 'elefante' | null,     bichinho escolhido
 *     pets: {
 *       elefante: {
 *         id, needs: { fome, sede, higiene, diversao, sono, saude },   0 a 100
 *         sick, sickSince, immuneUntil,                               doença
 *         sleeping, sleepSince,                                       sono
 *         poops, digestion: [ms...],                                  cocôs no quarto / a caminho
 *         xp, level, bornAt, lastUpdate, lastCaress,
 *         stats: { alimentar: 3, banho: 1, ... },                     cuidados recebidos
 *       }, ...
 *     },
 *     inventory: { mel: 2, agua: 3, ... },    mochila
 *     stars: 0,                               ⭐
 *     magic: { cooldowns: { 7: ms }, used: { 7: 2 } },   cartas usadas (Livro de Magias)
 *     daily: { lastDay: 'AAAA-MM-DD', streak: 1 },       dias seguidos
 *     stats: { actions, magics, sessions },
 *     settings: { tutorialSeen },
 *   }
 *
 * Cada bichinho guarda o horário da última atualização (lastUpdate). Ao abrir
 * o jogo, simulate() avança o tempo que passou — fome, sede, sono, sujeira,
 * doenças — em passos de alguns minutos, até um máximo (PET.time).
 */
import { ACTIONS, ITEMS, NEEDS, PET, PETS } from './petConfig.js';

export const NEED_IDS = NEEDS.map((n) => n.id);
export const PET_IDS = PETS.map((p) => p.id);
const PET_BY_ID = new Map(PETS.map((p) => [p.id, p]));
const NEED_BY_ID = new Map(NEEDS.map((n) => [n.id, n]));
const HOUR = 3600e3;
const BACKUP_SUFFIX = '.backup';

export const petInfo = (id) => PET_BY_ID.get(id);
export const needInfo = (id) => NEED_BY_ID.get(id);
/** Bichinho "feminino" (a Abelha, a Iguana, a Onça) — para concordar as frases. */
export const isFeminine = (petId) => PET_BY_ID.get(petId)?.article === 'a';
/** Estado de necessidade baixa, concordando com o bichinho ("Sujo"/"Suja"). */
export function needLowLabel(needId, petId) {
  const label = NEED_BY_ID.get(needId)?.lowLabel;
  return Array.isArray(label) ? label[isFeminine(petId) ? 1 : 0] : label;
}

const clamp = (v, min = 0, max = 100) => Math.min(max, Math.max(min, v));
const num = (v, fallback, min = -Infinity, max = Infinity) => (Number.isFinite(v) ? clamp(v, min, max) : fallback);

export function clampNeeds(pet) {
  for (const id of NEED_IDS) pet.needs[id] = clamp(pet.needs[id]);
}

/* ------------------------------------------------------------ criação */
export function createPet(id, now = Date.now()) {
  return {
    id,
    needs: { ...PET.start },
    sick: false,
    sickSince: null,
    immuneUntil: 0,
    sleeping: false,
    sleepSince: null,
    poops: 0,
    digestion: [],
    xp: 0,
    level: 1,
    bornAt: now,
    lastUpdate: now,
    lastCaress: 0,
    stats: {},
  };
}

export function createState(now = Date.now()) {
  return {
    schema: PET.schema,
    createdAt: now,
    lastSeen: now,
    selected: null,
    pets: Object.fromEntries(PET_IDS.map((id) => [id, createPet(id, now)])),
    inventory: { ...PET.starterKit },
    stars: 0,
    magic: { cooldowns: {}, used: {} },
    daily: { lastDay: null, streak: 0 },
    stats: { actions: 0, magics: 0, sessions: 0 },
    settings: { tutorialSeen: false },
  };
}

/* ------------------------------------------------------------ versões e validação */
/**
 * Migrações do formato salvo: MIGRATIONS[n] recebe dados da versão n e
 * devolve dados da versão n + 1. Ex.: { 1: (d) => ({ ...d, schema: 2, novoCampo: 0 }) }
 */
const MIGRATIONS = {};

function migrate(data) {
  let d = { ...data, schema: Number.isFinite(data.schema) ? data.schema : 1 };
  for (let guard = 0; MIGRATIONS[d.schema] && guard < 50; guard++) d = MIGRATIONS[d.schema](d);
  return d;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function countMap(raw, max = Infinity) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Number.isFinite(v) && v > 0) out[k] = Math.floor(Math.min(v, max));
  }
  return out;
}

function normalizePet(raw, id, now) {
  const pet = createPet(id, now);
  if (!isObject(raw)) return pet;
  for (const need of NEED_IDS) pet.needs[need] = num(raw.needs?.[need], pet.needs[need], 0, 100);
  pet.sick = raw.sick === true;
  pet.sickSince = pet.sick ? num(raw.sickSince, now, 0) : null;
  pet.immuneUntil = num(raw.immuneUntil, 0, 0);
  pet.sleeping = raw.sleeping === true;
  pet.sleepSince = pet.sleeping ? num(raw.sleepSince, now, 0) : null;
  pet.poops = Math.floor(num(raw.poops, 0, 0, PET.poop.max));
  pet.digestion = Array.isArray(raw.digestion) ? raw.digestion.filter(Number.isFinite).slice(0, PET.poop.max) : [];
  pet.xp = num(raw.xp, 0, 0);
  pet.level = Math.floor(num(raw.level, 1, 1, 9999));
  pet.bornAt = num(raw.bornAt, now, 0);
  pet.lastUpdate = num(raw.lastUpdate, now, 0);
  pet.lastCaress = num(raw.lastCaress, 0, 0);
  pet.stats = countMap(raw.stats);
  if (typeof raw.name === 'string') pet.name = raw.name.slice(0, 24);
  return pet;
}

/**
 * Transforma dados lidos do aparelho (talvez antigos, incompletos ou
 * corrompidos) num estado válido, sem perder o que puder ser aproveitado.
 */
export function normalizeState(raw, now = Date.now()) {
  const state = createState(now);
  if (!isObject(raw)) return state;
  const data = migrate(raw);
  state.createdAt = num(data.createdAt, now, 0, now);
  state.lastSeen = num(data.lastSeen, now, 0, now);
  state.selected = PET_BY_ID.has(data.selected) ? data.selected : null;
  state.stars = Math.floor(num(data.stars, 0, 0));
  if (isObject(data.inventory)) state.inventory = countMap(data.inventory, PET.inventory.max);
  const pets = isObject(data.pets) ? data.pets : {};
  for (const id of PET_IDS) state.pets[id] = normalizePet(pets[id], id, now);
  // bichinhos que saíram da configuração ficam guardados (não são simulados)
  for (const [id, pet] of Object.entries(pets)) {
    if (!state.pets[id] && isObject(pet)) state.pets[id] = pet;
  }
  if (isObject(data.magic)) {
    state.magic.cooldowns = countMap(data.magic.cooldowns);
    state.magic.used = countMap(data.magic.used);
  }
  if (isObject(data.daily)) {
    state.daily.lastDay = typeof data.daily.lastDay === 'string' ? data.daily.lastDay : null;
    state.daily.streak = Math.floor(num(data.daily.streak, 0, 0));
  }
  state.stats = { ...state.stats, ...countMap(data.stats) };
  state.settings.tutorialSeen = data.settings?.tutorialSeen === true;
  return state;
}

/* ------------------------------------------------------------ salvamento */
const isSave = (d) => isObject(d) && isObject(d.pets);

/**
 * Lê o progresso. `store` é o storage do app (get/set/remove) ou um falso nos testes.
 * Se o principal estiver ilegível, usa a cópia de segurança.
 * @returns {{ state: object, source: 'main' | 'backup' | 'new' }}
 */
export function loadState(store, now = Date.now()) {
  const main = store.get(PET.storageKey, null);
  if (isSave(main)) return { state: normalizeState(main, now), source: 'main' };
  const backup = store.get(PET.storageKey + BACKUP_SUFFIX, null);
  if (isSave(backup)) return { state: normalizeState(backup, now), source: 'backup' };
  return { state: createState(now), source: 'new' };
}

export function hasSavedState(store) {
  return isSave(store.get(PET.storageKey, null)) || isSave(store.get(PET.storageKey + BACKUP_SUFFIX, null));
}

/** Cópia compacta para salvar (números com 2 casas). */
export function serialize(state) {
  return JSON.parse(JSON.stringify(state, (key, value) => (
    typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value
  )));
}

/** Salva o progresso; com `backup`, atualiza também a cópia de segurança. */
export function saveState(store, state, { backup = false } = {}) {
  const data = serialize(state);
  store.set(PET.storageKey, data);
  if (backup) store.set(PET.storageKey + BACKUP_SUFFIX, data);
}

/* ------------------------------------------------------------ passagem do tempo */
function sicknessPerHour(pet) {
  const s = PET.sickness;
  const n = pet.needs;
  let p = s.basePerHour;
  if (n.higiene < s.dirtyBelow) p += s.dirtyPerHour;
  if (n.fome < PET.critical || n.sede < PET.critical) p += s.hungryPerHour;
  if (n.saude < s.weakBelow) p += s.weakPerHour;
  p += pet.poops * s.poopPerHour;
  return Math.min(p, 0.95);
}

function stepPet(pet, t0, t1, random, events) {
  const h = (t1 - t0) / HOUR;
  const n = pet.needs;
  const before = { ...n };
  const factor = pet.sleeping ? PET.sleep.decayFactor : {};

  if (pet.sleeping) n.sono += PET.sleep.recoverPerHour * h;
  else n.sono -= needInfo('sono').decay * h;
  for (const id of ['fome', 'sede', 'higiene', 'diversao']) {
    n[id] -= needInfo(id).decay * h * (factor[id] ?? 1);
  }
  n.higiene -= pet.poops * PET.poop.dirtPerHour * h;

  // digestão: cocôs aparecem um tempo depois de comer
  if (pet.digestion.length) {
    const due = pet.digestion.filter((at) => at <= t1);
    if (due.length) {
      pet.digestion = pet.digestion.filter((at) => at > t1);
      const added = Math.min(due.length, PET.poop.max - pet.poops);
      if (added > 0) {
        pet.poops += added;
        events.push({ type: 'poop', pet: pet.id, at: t1, count: added });
      }
    }
  }

  // saúde: cai com necessidades críticas ou doença; sobe com tudo em dia
  const hp = PET.health;
  let loss = 0;
  for (const id of ['fome', 'sede', 'higiene']) if (n[id] < PET.critical) loss += hp.criticalLossPerHour;
  for (const id of ['diversao', 'sono']) if (n[id] < PET.critical) loss += hp.minorLossPerHour;
  if (pet.sick) loss += hp.sickLossPerHour;
  if (loss > 0) {
    n.saude -= loss * h;
  } else if (!pet.sick && ['fome', 'sede', 'higiene', 'diversao', 'sono'].every((id) => n[id] >= hp.recoverAbove)) {
    n.saude += hp.recoverPerHour * h;
  }
  clampNeeds(pet);

  // sono: acorda descansado; dorme sozinho de cansaço
  if (pet.sleeping && n.sono >= PET.sleep.wakeAt) {
    pet.sleeping = false;
    pet.sleepSince = null;
    events.push({ type: 'wake', pet: pet.id, at: t1 });
  } else if (!pet.sleeping && n.sono <= PET.sleep.autoSleepBelow) {
    pet.sleeping = true;
    pet.sleepSince = t1;
    events.push({ type: 'fell-asleep', pet: pet.id, at: t1 });
  }

  // doença
  if (!pet.sick && t1 >= (pet.immuneUntil || 0) && h > 0) {
    const chance = 1 - (1 - sicknessPerHour(pet)) ** h;
    if (random() < chance) {
      pet.sick = true;
      pet.sickSince = t1;
      n.saude = clamp(n.saude - PET.sickness.healthLossOnSick);
      events.push({ type: 'sick', pet: pet.id, at: t1 });
    }
  }

  // necessidades que acabaram de ficar baixas
  for (const id of NEED_IDS) {
    if (before[id] >= PET.low && n[id] < PET.low) events.push({ type: 'low', pet: pet.id, need: id, at: t1 });
  }
}

function advancePet(pet, now, random, events) {
  let t = pet.lastUpdate;
  // relógio do aparelho voltou no tempo: recomeça a contar daqui
  if (!Number.isFinite(t) || t > now) {
    pet.lastUpdate = now;
    return;
  }
  t = Math.max(t, now - PET.time.maxOfflineHours * HOUR);
  const step = PET.time.stepMinutes * 60e3;
  while (t < now) {
    const next = Math.min(now, t + step);
    stepPet(pet, t, next, random, events);
    t = next;
  }
  pet.lastUpdate = now;
}

/**
 * Avança todos os bichinhos até `now`.
 * @returns {Array<{type: 'low'|'sick'|'poop'|'wake'|'fell-asleep', pet: string, at: number}>}
 */
export function simulate(state, now = Date.now(), { random = Math.random } = {}) {
  const events = [];
  for (const id of PET_IDS) {
    const pet = state.pets[id];
    if (pet) advancePet(pet, now, random, events);
  }
  if (now > state.lastSeen) state.lastSeen = now;
  return events;
}

/* ------------------------------------------------------------ humor e alertas */
export const MOODS = {
  feliz: { emoji: '😄', label: 'Feliz!' },
  bem: { emoji: '🙂', label: 'Bem' },
  precisa: { emoji: '😟', label: 'Precisa de você' },
  triste: { emoji: '😢', label: 'Triste' },
  doente: { emoji: '🤒', label: 'Doente' },
  dormindo: { emoji: '😴', label: 'Dormindo' },
};

/**
 * Situação do bichinho: humor e alertas (necessidades baixas, doença),
 * do mais urgente para o menos urgente.
 */
export function petStatus(pet) {
  const alerts = [];
  for (const need of NEEDS) {
    const value = pet.needs[need.id];
    if (need.id === 'saude' && pet.sick) continue;
    if (value < PET.low) {
      alerts.push({ need: need.id, icon: need.icon, label: needLowLabel(need.id, pet.id), value, critical: value < PET.critical });
    }
  }
  alerts.sort((a, b) => a.value - b.value);
  if (pet.sick) alerts.unshift({ need: 'saude', icon: '🤒', label: 'Doente', value: pet.needs.saude, critical: true, sick: true });
  const values = NEED_IDS.map((id) => pet.needs[id]);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  let mood;
  if (pet.sleeping) mood = 'dormindo';
  else if (pet.sick) mood = 'doente';
  else if (alerts.some((a) => a.critical) || alerts.length >= 3) mood = 'triste';
  else if (alerts.length) mood = 'precisa';
  else if (average >= 75 && !pet.poops) mood = 'feliz';
  else mood = 'bem';
  return { mood, alerts, urgent: alerts[0] || null, average };
}

/* ------------------------------------------------------------ experiência */
export function xpForLevel(level) {
  return PET.rewards.levelXp + (level - 1) * PET.rewards.levelXpStep;
}

/** Soma experiência; devolve quantos níveis o bichinho subiu. */
export function addXp(pet, amount) {
  pet.xp += amount;
  let ups = 0;
  while (pet.xp >= xpForLevel(pet.level)) {
    pet.xp -= xpForLevel(pet.level);
    pet.level += 1;
    ups++;
  }
  return ups;
}

/* ------------------------------------------------------------ mochila */
export function itemCount(state, item) {
  return state.inventory[item] || 0;
}

/** Coloca itens na mochila (respeitando o máximo); devolve quantos couberam. */
export function addItem(state, item, amount = 1) {
  const before = itemCount(state, item);
  const after = Math.min(PET.inventory.max, before + Math.max(0, amount));
  state.inventory[item] = after;
  return after - before;
}

export function takeItem(state, item) {
  if (itemCount(state, item) < 1) return false;
  state.inventory[item] -= 1;
  return true;
}

/**
 * Ações com itens (comer, beber, banho, remédio) da mais necessária para a
 * menos necessária, somando o quanto falta em cada bichinho.
 */
export function neededActions(pets) {
  const order = Object.keys(ACTIONS).filter((id) => ACTIONS[id].items?.length);
  const score = Object.fromEntries(order.map((id) => [id, 0]));
  for (const pet of pets) {
    for (const id of order) {
      const need = ACTIONS[id].need;
      score[id] += Math.max(0, 100 - pet.needs[need]);
      if (ACTIONS[id].cures && pet.sick) score[id] += 100;
    }
  }
  return order.slice().sort((a, b) => score[b] - score[a]);
}

/** Item para uma ação, preferindo o que está em menor quantidade na mochila. */
export function itemForAction(state, actionId) {
  const items = (ACTIONS[actionId]?.items || []).filter((id) => ITEMS[id]);
  if (!items.length) return null;
  return items.reduce((best, id) => (itemCount(state, id) < itemCount(state, best) ? id : best), items[0]);
}

/* ------------------------------------------------------------ dias seguidos */
const pad = (n) => String(n).padStart(2, '0');

/** Data local no formato AAAA-MM-DD. */
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function previousDayKey(ms) {
  const d = new Date(ms);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime());
}

/**
 * Primeiro acesso do dia: atualiza os dias seguidos e dá o presente do dia
 * (itens do que os bichinhos mais precisam). No primeiro dia de jogo não há
 * presente — já existe o de boas-vindas.
 * @returns {null | {streak: number, gift: Record<string, number>, first: boolean}}
 */
export function checkDaily(state, now = Date.now()) {
  const today = dayKey(now);
  if (state.daily.lastDay === today) return null;
  const first = !state.daily.lastDay;
  const streak = state.daily.lastDay === previousDayKey(now) ? state.daily.streak + 1 : 1;
  state.daily = { lastDay: today, streak };
  const gift = {};
  if (!first) {
    const pets = PET_IDS.map((id) => state.pets[id]).filter(Boolean);
    const actions = neededActions(pets);
    for (let i = 0; i < PET.dailyGift && actions.length; i++) {
      const item = itemForAction(state, actions[i % actions.length]);
      if (item && addItem(state, item, 1)) gift[item] = (gift[item] || 0) + 1;
    }
  }
  return { streak, gift, first };
}
