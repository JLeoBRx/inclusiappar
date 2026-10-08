/**
 * CARTAS MÁGICAS — o que acontece quando a câmera reconhece uma carta.
 *
 * A tabela Carta → magia fica em petConfig.js (CARD_MAGIC). Cada magia é uma
 * lista de efeitos; cada TIPO de efeito é registrado aqui com registerEffect():
 *
 *   registerEffect('confete', {
 *     apply(ctx, effect) { ...; return [{ kind: 'confete' }]; },   // muda o estado
 *     describe(effect) { return 'Faz uma festa'; },                  // texto do Livro de Magias
 *   });
 *
 * `ctx` traz: state, now, random, current (bichinho escolhido), allPets e
 * cared (Set dos bichinhos que receberam cuidado — ganham experiência).
 * Os efeitos devolvem "resultados" que a interface usa para animar e explicar.
 *
 * Sem DOM: testado em Node (tests/unit/cardMagic.test.mjs).
 */
import { GAME } from '../config.js';
import { ACTIONS, CARD_GROUPS, CARD_MAGIC, DEFAULT_MAGIC, ITEMS, NEEDS, PET, PETS } from './petConfig.js';
import { applyCare } from './petActions.js';
import { addItem, addXp, clampNeeds, itemForAction, neededActions } from './petState.js';

const effects = new Map();
const needInfo = (id) => NEEDS.find((n) => n.id === id);

/** Cria (ou substitui) um tipo de efeito. */
export function registerEffect(type, { apply, describe }) {
  effects.set(type, { apply, describe: describe || (() => '') });
}

export function effectTypes() {
  return [...effects.keys()];
}

function targets(ctx, effect) {
  if (effect.target === 'all') return ctx.allPets;
  return ctx.current ? [ctx.current] : [];
}

/* ------------------------------------------------------------ efeitos padrão */
registerEffect('care', {
  apply(ctx, effect) {
    const action = ACTIONS[effect.action];
    if (!action?.need) {
      console.warn(`[magia] ação desconhecida: ${effect.action}`);
      return [];
    }
    const out = [];
    let applied = 0;
    for (const pet of targets(ctx, effect)) {
      const r = applyCare(pet, effect.action, {
        power: effect.power, item: effect.item || null, cost: effect.cost || null, now: ctx.now, random: ctx.random,
      });
      out.push({
        kind: 'care', pet: pet.id, action: effect.action, item: effect.item || null,
        ok: r.ok, reason: r.reason, deltas: r.deltas || {}, cured: !!r.cured, favorite: !!r.favorite,
      });
      if (r.ok) {
        applied++;
        ctx.cared.add(pet.id);
      }
    }
    if (!applied) {
      // ninguém precisava agora: a magia não se perde — vira item na mochila (ou estrelinha)
      const item = effect.item || action.items?.[0];
      if (item && ITEMS[item]) {
        out.push({ kind: 'item', item, amount: 1, added: addItem(ctx.state, item, 1), stored: true });
      } else {
        ctx.state.stars += 1;
        out.push({ kind: 'stars', amount: 1, converted: true });
      }
    }
    return out;
  },
  describe(effect) {
    const action = ACTIONS[effect.action];
    if (!action?.need) return '';
    const all = effect.target === 'all';
    const phrase = (action.phrase?.[all ? 1 : 0] || action.label).replace('{n}', PETS.length);
    const need = needInfo(action.need);
    const power = effect.power ?? ITEMS[effect.item]?.power ?? action.power;
    return `${phrase} (${need.icon}\u00a0${need.label}\u00a0+${power})`;
  },
});

registerEffect('item', {
  apply(ctx, effect) {
    if (!ITEMS[effect.item]) {
      console.warn(`[magia] item desconhecido: ${effect.item}`);
      return [];
    }
    const amount = effect.amount ?? 1;
    return [{ kind: 'item', item: effect.item, amount, added: addItem(ctx.state, effect.item, amount) }];
  },
  describe(effect) {
    const item = ITEMS[effect.item];
    return item ? `+${effect.amount ?? 1} ${item.emoji}\u00a0${item.name} na mochila` : '';
  },
});

registerEffect('surprise', {
  apply(ctx, effect) {
    const pets = ctx.current ? [ctx.current] : ctx.allPets;
    const action = neededActions(pets)[0];
    const item = action && itemForAction(ctx.state, action);
    if (!item) return [];
    const amount = effect.amount ?? 1;
    return [{ kind: 'item', item, amount, added: addItem(ctx.state, item, amount), surprise: true }];
  },
  describe(effect) {
    const n = effect.amount ?? 1;
    return `${n} ${n > 1 ? 'itens' : 'item'} surpresa: o que o seu bichinho mais precisa`;
  },
});

registerEffect('stars', {
  apply(ctx, effect) {
    const amount = effect.amount ?? 1;
    ctx.state.stars += amount;
    return [{ kind: 'stars', amount }];
  },
  describe(effect) {
    return `+${effect.amount ?? 1} ⭐`;
  },
});

registerEffect('need', {
  apply(ctx, effect) {
    const out = [];
    for (const pet of targets(ctx, effect)) {
      const deltas = {};
      for (const [need, value] of Object.entries(effect.needs || {})) {
        if (!(need in pet.needs)) continue;
        const before = pet.needs[need];
        pet.needs[need] += value;
        clampNeeds(pet);
        deltas[need] = Math.round(pet.needs[need] - before);
      }
      ctx.cared.add(pet.id);
      out.push({ kind: 'need', pet: pet.id, deltas });
    }
    return out;
  },
  describe(effect) {
    const who = effect.target === 'all' ? `Os ${PETS.length} bichinhos` : 'O bichinho escolhido';
    const list = Object.entries(effect.needs || {}).map(([id, v]) => {
      const need = needInfo(id);
      return need ? `${need.icon} ${need.label} ${v >= 0 ? '+' : ''}${v}` : '';
    }).filter(Boolean).join(', ');
    return `${who}: ${list}`;
  },
});

/* ------------------------------------------------------------ magias */
/** Magia de uma carta (pelo número do arquivo cartaN.png). */
export function magicFor(cardId) {
  const own = CARD_MAGIC[cardId];
  return {
    card: cardId,
    label: GAME.labels?.[cardId] || `Carta ${cardId}`,
    isDefault: !own,
    ...(own || DEFAULT_MAGIC),
  };
}

/** Textos do Livro de Magias para uma magia. */
export function describeMagic(magic) {
  return magic.effects.map((e) => effects.get(e.type)?.describe(e) || '').filter(Boolean);
}

/** Segundos até a carta poder ser usada de novo (0 = pronta). */
export function cooldownLeft(state, cardId, now = Date.now()) {
  const until = state.magic.cooldowns[cardId] || 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Usa a magia de uma carta.
 * @returns {{ok: boolean, reason?: 'cooldown'|'no-pet', remaining?: number, magic: object,
 *            outcomes?: object[], firstTime?: boolean, stars?: number, levelUps?: object[]}}
 */
export function castCard(state, cardId, { now = Date.now(), random = Math.random } = {}) {
  const magic = magicFor(cardId);
  const remaining = cooldownLeft(state, cardId, now);
  if (remaining > 0) return { ok: false, reason: 'cooldown', remaining, magic };
  const current = state.selected ? state.pets[state.selected] : null;
  if (!current) return { ok: false, reason: 'no-pet', magic };

  const ctx = {
    state, now, random, current,
    allPets: PETS.map((p) => state.pets[p.id]).filter(Boolean),
    cared: new Set(),
  };
  const outcomes = [];
  for (const effect of magic.effects) {
    const handler = effects.get(effect.type);
    if (!handler) {
      console.warn(`[magia] tipo de efeito desconhecido: ${effect.type}`);
      continue;
    }
    outcomes.push(...(handler.apply(ctx, effect) || []));
  }

  const firstTime = !state.magic.used[cardId];
  state.magic.used[cardId] = (state.magic.used[cardId] || 0) + 1;
  state.magic.cooldowns[cardId] = now + PET.magic.cardCooldownSeconds * 1000;
  const stars = PET.rewards.magicStars + (firstTime ? PET.rewards.newCardStars : 0);
  state.stars += stars;
  const levelUps = [];
  for (const id of ctx.cared) {
    const pet = state.pets[id];
    pet.stats.magias = (pet.stats.magias || 0) + 1;
    if (addXp(pet, PET.rewards.magicXp)) levelUps.push({ pet: id, level: pet.level });
  }
  state.stats.magics = (state.stats.magics || 0) + 1;
  return { ok: true, magic, outcomes, firstTime, stars, levelUps };
}

/** Cartas cuja magia ajuda numa ação (para a dica "use uma carta mágica"). */
export function cardsForAction(actionId, cardIds = Object.keys(CARD_MAGIC).map(Number)) {
  return cardIds.filter((id) => magicFor(id).effects.some((e) => (
    (e.type === 'care' && e.action === actionId) || (e.type === 'item' && ITEMS[e.item]?.action === actionId)
  )));
}

/**
 * Cartas organizadas para o Livro de Magias. `cardIds` vem do manifesto das
 * cartas (cartas.json), então cartas novas aparecem sozinhas em "Outras cartas".
 */
export function magicBook(cardIds = Object.keys(CARD_MAGIC).map(Number)) {
  const ids = [...new Set(cardIds)].sort((a, b) => a - b);
  const grouped = new Set();
  const groups = CARD_GROUPS.map((g) => {
    const cards = g.cards.filter((id) => ids.includes(id)).map(magicFor);
    cards.forEach((c) => grouped.add(c.card));
    return { ...g, cards };
  }).filter((g) => g.cards.length);
  const others = ids.filter((id) => !grouped.has(id)).map(magicFor);
  if (others.length) groups.push({ id: 'outras', icon: '🎁', title: 'Outras cartas', rule: 'Cada uma tem sua própria magia.', cards: others });
  return groups;
}
