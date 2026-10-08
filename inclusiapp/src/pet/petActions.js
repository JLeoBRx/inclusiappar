/**
 * AÇÕES DE CUIDADO do Bichinho Virtual (sem DOM).
 *
 *   applyCare()  cuida de um bichinho (comer, beber, banho, brincar, remédio,
 *                energia) sem mexer na mochila — usado pelas cartas mágicas
 *   useAction()  o que os botões fazem: usa o item da mochila e cuida
 *   sleep(), wake(), clean(), caress()   ações livres
 *
 * Toda ação devolve { ok, reason?, ... }. Quando não dá para fazer, `reason`
 * diz o porquê ('sleeping', 'full', 'no-item', 'tired', 'not-tired',
 * 'awake', 'clean', 'cooldown') e a interface mostra a mensagem certa.
 */
import { ACTIONS, ITEMS, PET } from './petConfig.js';
import { addXp, clampNeeds, petInfo, takeItem } from './petState.js';

/** Primeiro item da mochila que serve para a ação (ou null). */
export function availableItem(state, actionId) {
  return ACTIONS[actionId]?.items?.find((id) => (state.inventory[id] || 0) > 0) || null;
}

/** Por que o bichinho não pode receber a ação agora (ou null se pode). */
export function blockReason(pet, actionId) {
  const action = ACTIONS[actionId];
  if (!action) return 'unknown';
  if (pet.sleeping && !action.whileSleeping) return 'sleeping';
  if (action.need) {
    // doente sempre aceita remédio
    const needsCure = action.cures && pet.sick;
    if (!needsCure && pet.needs[action.need] >= action.refuseAbove) return 'full';
  }
  if (action.tiredBelow != null && pet.needs.sono < action.tiredBelow) return 'tired';
  return null;
}

function diff(before, after) {
  const out = {};
  for (const [k, v] of Object.entries(after)) {
    const d = Math.round(v - before[k]);
    if (d) out[k] = d;
  }
  return out;
}

function count(pet, actionId) {
  pet.stats[actionId] = (pet.stats[actionId] || 0) + 1;
}

/** Estrelas para o jogador e experiência para o bichinho. */
export function reward(state, pet, { stars = 0, xp = 0 } = {}) {
  state.stars += stars;
  const ups = pet && xp ? addXp(pet, xp) : 0;
  return { stars, levelUp: ups ? pet.level : 0 };
}

/**
 * Cuida de um bichinho (não usa a mochila).
 * @param {object} pet
 * @param {string} actionId  'alimentar' | 'beber' | 'banho' | 'brincar' | 'remedio' | 'energia'
 * @param {object} [opts]
 * @param {number} [opts.power]   recuperação (padrão: do item ou da ação)
 * @param {string} [opts.item]    item usado (bônus, comida favorita)
 * @param {object} [opts.cost]    gasto em outras necessidades (ex.: brincar cansa)
 */
export function applyCare(pet, actionId, { power, item = null, cost = null, now = Date.now(), random = Math.random } = {}) {
  const action = ACTIONS[actionId];
  const reason = blockReason(pet, actionId);
  if (reason) return { ok: false, reason, pet: pet.id, action: actionId, item };
  if (!action.need) return { ok: false, reason: 'unknown', pet: pet.id, action: actionId, item };

  const before = { ...pet.needs };
  const info = item ? ITEMS[item] : null;
  pet.needs[action.need] += power ?? info?.power ?? action.power;
  for (const [need, value] of Object.entries(info?.bonus || {})) pet.needs[need] += value;
  let favorite = false;
  if (actionId === 'alimentar' && item && petInfo(pet.id)?.favorite === item) {
    pet.needs.diversao += 10;
    favorite = true;
  }
  for (const [need, value] of Object.entries(cost || {})) pet.needs[need] -= value;

  let cured = false;
  if ((action.cures || info?.cures) && pet.sick) {
    pet.sick = false;
    pet.sickSince = null;
    pet.immuneUntil = now + PET.sickness.immunityHours * 3600e3;
    cured = true;
  }
  let poopAt = null;
  if (action.poop && pet.poops + pet.digestion.length < PET.poop.max) {
    const { minMinutes, maxMinutes } = PET.poop;
    poopAt = now + (minMinutes + random() * (maxMinutes - minMinutes)) * 60e3;
    pet.digestion.push(poopAt);
  }
  clampNeeds(pet);
  count(pet, actionId);
  return { ok: true, pet: pet.id, action: actionId, item, deltas: diff(before, pet.needs), cured, favorite, poopAt };
}

/* ------------------------------------------------------------ ações livres */
export function sleep(pet, now = Date.now()) {
  if (pet.sleeping) return { ok: false, reason: 'sleeping', pet: pet.id, action: 'dormir' };
  if (pet.needs.sono >= PET.sleep.canSleepBelow) return { ok: false, reason: 'not-tired', pet: pet.id, action: 'dormir' };
  pet.sleeping = true;
  pet.sleepSince = now;
  count(pet, 'dormir');
  return { ok: true, pet: pet.id, action: 'dormir' };
}

export function wake(pet) {
  if (!pet.sleeping) return { ok: false, reason: 'awake', pet: pet.id, action: 'acordar' };
  pet.sleeping = false;
  pet.sleepSince = null;
  return { ok: true, pet: pet.id, action: 'acordar' };
}

/** Limpa os cocôs do quarto (todos, ou `amount`). */
export function clean(state, pet, amount = Infinity) {
  if (!pet.poops) return { ok: false, reason: 'clean', pet: pet.id, action: 'limpar' };
  const removed = Math.min(amount, pet.poops);
  const before = { ...pet.needs };
  pet.poops -= removed;
  pet.needs.higiene += 3 * removed;
  clampNeeds(pet);
  count(pet, 'limpar');
  const prize = reward(state, pet, { stars: PET.rewards.actionStars, xp: PET.rewards.actionXp });
  return { ok: true, pet: pet.id, action: 'limpar', removed, deltas: diff(before, pet.needs), ...prize };
}

/** Carinho: tocar no bichinho. */
export function caress(state, pet, now = Date.now()) {
  if (pet.sleeping) return { ok: false, reason: 'sleeping', pet: pet.id, action: 'carinho' };
  if (now - (pet.lastCaress || 0) < PET.caress.cooldownSeconds * 1000) {
    return { ok: false, reason: 'cooldown', pet: pet.id, action: 'carinho' };
  }
  const before = { ...pet.needs };
  pet.lastCaress = now;
  pet.needs.diversao += PET.caress.fun;
  clampNeeds(pet);
  count(pet, 'carinho');
  const prize = reward(state, pet, { xp: PET.rewards.caressXp });
  return { ok: true, pet: pet.id, action: 'carinho', deltas: diff(before, pet.needs), ...prize };
}

/* ------------------------------------------------------------ botões */
/**
 * O que acontece ao tocar num botão de cuidado: confere se o bichinho aceita,
 * usa um item da mochila (se a ação precisar de item) e cuida.
 */
export function useAction(state, petId, actionId, { now = Date.now(), random = Math.random } = {}) {
  const pet = state.pets[petId];
  if (!pet) return { ok: false, reason: 'no-pet', action: actionId };
  if (actionId === 'dormir') return sleep(pet, now);
  if (actionId === 'acordar') return wake(pet);
  if (actionId === 'limpar') return clean(state, pet);
  if (actionId === 'carinho') return caress(state, pet, now);

  const action = ACTIONS[actionId];
  const reason = blockReason(pet, actionId);
  if (reason) return { ok: false, reason, pet: petId, action: actionId };
  let item = null;
  if (action.items?.length) {
    item = availableItem(state, actionId);
    if (!item) return { ok: false, reason: 'no-item', pet: petId, action: actionId };
  }
  const result = applyCare(pet, actionId, { item, cost: action.cost, now, random });
  if (!result.ok) return result;
  if (item) takeItem(state, item);
  state.stats.actions = (state.stats.actions || 0) + 1;
  return { ...result, ...reward(state, pet, { stars: PET.rewards.actionStars, xp: PET.rewards.actionXp }) };
}
