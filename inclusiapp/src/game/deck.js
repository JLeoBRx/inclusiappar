/**
 * Baralho em ciclos: cada carta aparece UMA vez por ciclo.
 *
 * Adaptado do ARCombinationGameManager.cs (Unity):
 *   ResetDeck()          → embaralhamento Fisher–Yates (mesmo laço do original:
 *                           para cada i, troca com um índice aleatório em [i, n))
 *   GenerateNewMission() → retira a carta do topo; baralho vazio = novo ciclo
 *
 * Melhorias em relação ao original:
 *   - na virada de ciclo, a primeira carta nunca repete a última sorteada
 *     (o original podia sortear a mesma carta duas vezes seguidas);
 *   - o estado pode ser salvo/restaurado (continuar o jogo depois);
 *   - funciona com qualquer quantidade de cartas (1, 20, 30...).
 */

/** Embaralhamento Fisher–Yates; devolve uma cópia. */
export function shuffle(items, random = Math.random) {
  const a = items.slice();
  for (let i = 0; i < a.length; i++) {
    const j = i + Math.floor(random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Deck {
  /**
   * @param {Array} items  identificadores das cartas (ex.: [1, 2, ..., 20])
   * @param {object} [options]
   * @param {() => number} [options.random]  gerador aleatório (testes)
   * @param {object} [options.state]         estado salvo por toJSON()
   */
  constructor(items, { random = Math.random, state = null } = {}) {
    if (!items || !items.length) throw new Error('O baralho precisa de pelo menos uma carta.');
    this.items = items.slice();
    this.random = random;
    this.cycle = 0;
    this.order = [];
    this.position = 0;
    this.last = null;
    if (!(state && this.restore(state))) this.newCycle();
  }

  /** Embaralha de novo e começa um ciclo. */
  newCycle() {
    const order = shuffle(this.items, this.random);
    if (this.last !== null && order.length > 1 && order[0] === this.last) {
      const k = 1 + Math.floor(this.random() * (order.length - 1));
      [order[0], order[k]] = [order[k], order[0]];
    }
    this.order = order;
    this.position = 0;
    this.cycle += 1;
  }

  /** Retira a próxima carta (pular também consome a carta do ciclo). */
  draw() {
    if (this.isCycleComplete) this.newCycle();
    const card = this.order[this.position];
    this.position += 1;
    this.last = card;
    return card;
  }

  get size() { return this.order.length; }
  get drawnInCycle() { return this.position; }
  get remaining() { return this.order.length - this.position; }
  get isCycleComplete() { return this.position >= this.order.length; }

  toJSON() {
    return { items: this.items, order: this.order, position: this.position, cycle: this.cycle, last: this.last };
  }

  /** Restaura um estado salvo; recusa se as cartas mudaram desde então. */
  restore(state) {
    const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
    const sorted = (a) => [...a].sort((x, y) => (x > y ? 1 : x < y ? -1 : 0));
    const valid = same(state.items, this.items) &&
      Array.isArray(state.order) && same(sorted(state.order), sorted(this.items)) &&
      Number.isInteger(state.position) && state.position >= 0 && state.position <= this.items.length;
    if (!valid) return false;
    this.order = state.order.slice();
    this.position = state.position;
    this.cycle = Number.isInteger(state.cycle) && state.cycle > 0 ? state.cycle : 1;
    this.last = state.last ?? null;
    return true;
  }
}
