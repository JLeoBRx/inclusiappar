/**
 * BICHINHO VIRTUAL — a tela do jogo.
 *
 *   escolher bichinho → ver necessidades → cuidar (botões / cartas mágicas)
 *   → o tempo passa (mesmo com o app fechado) → voltar para cuidar
 *
 * Este arquivo cuida só da interface; as regras ficam em:
 *   petConfig.js  (números, itens, ações e a magia de cada carta)
 *   petState.js   (dados, passagem do tempo, salvamento)
 *   petActions.js (cuidados) · cardMagic.js (cartas mágicas)
 *   petRoom.js    (quarto 3D) · petMagicAR.js (câmera e efeitos em AR)
 */
import { GAME } from '../config.js';
import { buildCardList } from '../game/cardGame.js';
import { storage } from '../ui/storage.js';
import { announce, clearErrors, showARError, toast } from '../ui/notifications.js';
import { isSoundOn, setSound, unlockAudio } from '../ui/sound.js';
import { confetti, prefersReducedMotion } from '../ui/effects.js';
import { ACTIONS, ACTION_BAR, ITEMS, NEEDS, PET, PETS } from './petConfig.js';
import {
  MOODS, checkDaily, isFeminine, loadState, needLowLabel, petStatus, saveState, simulate, xpForLevel,
} from './petState.js';
import { caress, clean, useAction } from './petActions.js';
import { castCard, cardsForAction, cooldownLeft, describeMagic, magicBook, magicFor } from './cardMagic.js';
import { PetActor, PetRoom, loadPetModel } from './petRoom.js';
import { MagicScanner } from './petMagicAR.js';
import { petSfx } from './petSound.js';

const petById = new Map(PETS.map((p) => [p.id, p]));
const needById = new Map(NEEDS.map((n) => [n.id, n]));
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
/** "a Iguana" / "o Urso" */
const the = (info, capital = false) => {
  const text = `${info.article || 'o'} ${info.name}`;
  return capital ? text[0].toUpperCase() + text.slice(1) : text;
};
const ofPet = (info) => (info.article === 'a' ? 'dela' : 'dele');
const center = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** reação do bichinho, som e partículas de cada cuidado */
const CARE_FX = {
  alimentar: { reaction: 'eat', sound: 'eat', particles: ['😋', '✨'] },
  beber: { reaction: 'drink', sound: 'drink', particles: ['💧', '💧', '✨'] },
  banho: { reaction: 'bath', sound: 'bath', particles: ['○', '◌', '○', '✨'] },
  brincar: { reaction: 'hop', sound: 'play', particles: ['🎾', '⭐', '✨'] },
  remedio: { reaction: 'heal', sound: 'heal', particles: ['💚', '✨'] },
  energia: { reaction: 'spin', sound: 'energy', particles: ['⚡', '✨'] },
};
const POOP_SLOTS = [[22, 9], [74, 12], [36, 3]]; // [esquerda %, baixo %]
const AWAY_EVENTS = ['sick', 'low', 'poop', 'fell-asleep', 'wake'];

function formatDuration(ms) {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `${min} minuto${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  if (h < 48) {
    const m = min % 60;
    return `${h} hora${h === 1 ? '' : 's'}${m ? ` e ${m} minuto${m === 1 ? '' : 's'}` : ''}`;
  }
  return `${Math.floor(h / 24)} dias`;
}

export class PetGame {
  constructor(screen) {
    this.screen = screen;
    const q = (s) => screen.querySelector(s);
    this.el = {
      picker: q('[data-picker]'),
      room: q('[data-room]'),
      stage: q('[data-room-stage]'),
      poops: q('[data-poops]'),
      hit: q('[data-action="caress"]'),
      bubble: q('[data-bubble]'),
      speech: q('[data-speech]'),
      badge: q('[data-room-badge]'),
      loading: q('[data-room-loading]'),
      fallback: q('[data-room-fallback]'),
      frame: q('[data-room-frame]'),
      mood: q('[data-mood]'),
      needs: q('[data-needs]'),
      actions: q('[data-actions]'),
      stars: q('[data-stars]'),
      sound: q('[data-action="sound"]'),
      fx: q('[data-fx]'),
      magic: q('[data-magic]'),
      magicStage: q('[data-magic-stage]'),
      magicPet: q('[data-magic-pet]'),
      magicNeeds: q('[data-magic-needs]'),
      spell: q('[data-spell]'),
      status: q('[data-magic] [data-status]'),
      statusText: q('[data-magic] [data-status-text]'),
      statusBar: q('[data-magic] [data-status-bar]'),
      modals: Object.fromEntries([...screen.querySelectorAll('[data-modal]')].map((m) => [m.dataset.modal, m])),
    };
    this.room = new PetRoom(this.el.stage);
    this.room.onLayout = (rect) => this._layoutOverlays(rect);
    this.scanner = new MagicScanner(this.el.magicStage);
    this.scanner.onCard = (card) => this._onCard(card);
    this.scanner.onStatus = (step, progress) => this._magicStatus(step, progress);
    this.scanner.onCameraEnded = () => this._magicError({ code: 'ended' });
    this.actors = new Map();
    this.state = null;
    this.active = false;
    this._onVisibility = () => {
      if (document.visibilityState === 'hidden') this._save();
      else if (this.active) this._tick();
    };
    this._onPageHide = () => this._save();
    this._onPopState = () => {
      if (this.magicOpen) this._closeMagic({ fromHistory: true });
    };
    this._onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (this.openModal) this._closeModal();
      else if (this.magicOpen) this._closeMagic();
    };
    this._build();
    this._bind();
  }

  get pet() {
    return this.state?.selected ? this.state.pets[this.state.selected] : null;
  }

  get info() {
    return this.state?.selected ? petById.get(this.state.selected) : null;
  }

  /* ------------------------------------------------------------ tutorial */
  /** Já viu o "Como jogar?" (para abrir o jogo direto nas próximas vezes). */
  tutorialSeen() {
    return this._tutorialSeen || loadState(storage).state.settings.tutorialSeen;
  }

  markTutorialSeen() {
    this._tutorialSeen = true;
    const { state } = loadState(storage);
    if (!state.settings.tutorialSeen) {
      state.settings.tutorialSeen = true;
      saveState(storage, state);
    }
  }

  /* ------------------------------------------------------------ montagem */
  _build() {
    this.el.picker.innerHTML = PETS.map((p) => `
      <button type="button" class="picker-btn" data-pet="${p.id}" data-theme="${p.theme}" aria-pressed="false">
        <span class="picker-btn__avatar" aria-hidden="true">${p.emoji}</span>
        <span class="picker-btn__name">${esc(p.name)}</span>
        <span class="picker-btn__level" data-level aria-hidden="true"></span>
        <span class="picker-btn__alert" data-alert aria-hidden="true" hidden></span>
      </button>`).join('');
    this.pickerButtons = [...this.el.picker.querySelectorAll('[data-pet]')];

    this.el.needs.innerHTML = NEEDS.map((n) => `
      <li class="need" data-need="${n.id}">
        <span class="need__icon" aria-hidden="true">${n.icon}</span>
        <span class="need__label">${esc(n.label)}</span>
        <span class="need__bar" role="progressbar" aria-label="${esc(n.label)}" aria-valuemin="0" aria-valuemax="100"><i></i></span>
      </li>`).join('');
    this.needItems = [...this.el.needs.querySelectorAll('[data-need]')];

    this.el.actions.innerHTML = ACTION_BAR.map((id) => `
      <button type="button" class="care-btn" data-care="${id}">
        <span class="care-btn__icon" aria-hidden="true">${ACTIONS[id].icon}</span>
        <span class="care-btn__label">${this._careLabel(id)}</span>
        <span class="care-btn__count" data-count aria-hidden="true" hidden></span>
      </button>`).join('');
    this.actionButtons = [...this.el.actions.querySelectorAll('[data-care]')];

    this.el.magicNeeds.innerHTML = NEEDS.map((n) => `
      <span class="mini-need" data-need="${n.id}" title="${esc(n.label)}">
        <span aria-hidden="true">${n.icon}</span><i><b></b></i>
      </span>`).join('');
    this.miniNeeds = [...this.el.magicNeeds.querySelectorAll('[data-need]')];

    const choose = this.el.modals.choose.querySelector('[data-choose-list]');
    choose.innerHTML = PETS.map((p) => `
      <button type="button" class="choose-btn" data-choose="${p.id}" data-theme="${p.theme}">
        <span class="choose-btn__emoji" aria-hidden="true">${p.emoji}</span>
        <span class="choose-btn__name">${esc(p.name)}</span>
        <span class="choose-btn__phrase">“${esc(p.phrase)}”</span>
      </button>`).join('');
  }

  /** Nome no botão de cuidado (versão curta em telas estreitas). */
  _careLabel(id) {
    const { label, short } = ACTIONS[id];
    return short ? `<span class="care-btn__long">${esc(label)}</span><span class="care-btn__short">${esc(short)}</span>` : esc(label);
  }

  _bind() {
    this.el.picker.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pet]');
      if (btn) this._select(btn.dataset.pet);
    });
    this.el.actions.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-care]');
      if (btn) this._care(btn.dataset.care, btn);
    });
    this.el.hit.addEventListener('click', (e) => this._caress(e));
    this.el.poops.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-poop]');
      if (btn) this._cleanOne(btn);
    });
    this.screen.querySelectorAll('[data-action="magic"]').forEach((b) => b.addEventListener('click', () => this._openMagic()));
    this.screen.querySelectorAll('[data-action="book"]').forEach((b) => b.addEventListener('click', () => this._openBook()));
    this.screen.querySelector('[data-action="close-magic"]').addEventListener('click', () => this._closeMagic());
    this.el.sound.addEventListener('click', () => {
      setSound(!isSoundOn());
      this._renderSound();
      if (isSoundOn()) petSfx.pop();
    });
    for (const modal of Object.values(this.el.modals)) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-close]')) this._closeModal();
      });
    }
    this.el.modals.choose.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-choose]');
      if (!btn) return;
      this._closeModal();
      this._select(btn.dataset.choose, { first: true });
    });
    this.el.spell.addEventListener('click', () => { this.el.spell.hidden = true; });
  }

  /* ------------------------------------------------------------ ciclo de vida */
  async enter() {
    this.active = true;
    const token = {};
    this.token = token;
    unlockAudio();
    this._renderSound();
    const now = Date.now();
    const { state, source } = loadState(storage, now);
    this.state = state;
    const away = now - state.lastSeen;
    const events = simulate(state, now);
    const daily = checkDaily(state, now);
    state.stats.sessions = (state.stats.sessions || 0) + 1;
    state.settings.tutorialSeen = true;
    // a cópia de segurança guarda o progresso do início de cada sessão
    this._save({ backup: source === 'main' });
    this._checkStorage();

    this.webgl = PetRoom.available();
    this.el.room.classList.toggle('is-flat', !this.webgl);
    if (this.webgl) this.room.start();
    this._render();

    this._timer = setInterval(() => this._tick(), 1000);
    this._autosave = setInterval(() => this._save(), PET.autosaveSeconds * 1000);
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('popstate', this._onPopState);
    window.addEventListener('keydown', this._onKey);

    if (!state.selected) {
      this._openModal('choose');
    } else {
      if (away >= PET.time.awayReportMinutes * 60e3) this._showAway(events, away);
      await this._showPet(state.selected);
      if (!this._alive(token)) return;
    }
    if (daily?.streak > 1 || Object.keys(daily?.gift || {}).length) {
      const gift = Object.entries(daily.gift).map(([id, n]) => `${n} ${ITEMS[id].emoji}`).join(' ');
      setTimeout(() => {
        if (this._alive(token)) {
          toast(`🎁 Presente do dia${gift ? `: ${gift}` : ''} · ${daily.streak} dia${daily.streak > 1 ? 's' : ''} seguido${daily.streak > 1 ? 's' : ''} cuidando! 🔥`, { type: 'success', duration: 5000 });
        }
      }, 900);
    }
  }

  async leave() {
    this.active = false;
    this.token = null;
    clearInterval(this._timer);
    clearInterval(this._autosave);
    clearTimeout(this._pendingTimer);
    clearTimeout(this._spellTimer);
    clearTimeout(this._speechTimer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('pagehide', this._onPageHide);
    window.removeEventListener('popstate', this._onPopState);
    window.removeEventListener('keydown', this._onKey);
    this._closeModal();
    await this._closeMagic({ leaving: true });
    this.room.stop();
    this.el.fx.replaceChildren();
    this._save();
  }

  _alive(token) {
    return this.active && token === this.token;
  }

  _save({ backup = false } = {}) {
    if (!this.state) return;
    this.state.lastSeen = Math.max(this.state.lastSeen, Date.now());
    saveState(storage, this.state, { backup });
  }

  /** Avisa se o navegador não deixa salvar; pede armazenamento persistente (uma vez). */
  _checkStorage() {
    try {
      localStorage.setItem('sinalizaacao:teste', '1');
      localStorage.removeItem('sinalizaacao:teste');
    } catch {
      toast('⚠️ Este navegador não está deixando salvar o progresso (navegação anônima?). Dá para jogar, mas os bichinhos não serão lembrados.', { type: 'warning', duration: 8000 });
      return;
    }
    if (!storage.get('petPersistAsked', false) && navigator.storage?.persist) {
      storage.set('petPersistAsked', true);
      navigator.storage.persist().catch(() => {});
    }
  }

  _tick() {
    if (!this.state || !this.active) return;
    const events = simulate(this.state, Date.now());
    for (const event of events) this._liveEvent(event);
    this._render();
  }

  _liveEvent(event) {
    const info = petById.get(event.pet);
    if (!info) return;
    const current = event.pet === this.state.selected;
    if (event.type === 'sick') {
      toast(`🤒 ${the(info, true)} ficou doente! Dê remédio 🌿 para ${ofPet(info)}.`, { type: 'warning', duration: 6000 });
    } else if (event.type === 'fell-asleep') {
      toast(`😴 ${the(info, true)} dormiu de cansaço.`, { duration: 3500 });
    } else if (event.type === 'wake') {
      toast(`☀️ ${the(info, true)} acordou ${isFeminine(info.id) ? 'descansada' : 'descansado'}!`, { duration: 3500 });
      if (current) {
        this.actor?.react('wake');
        petSfx.wake();
      }
    } else if (event.type === 'poop' && current) {
      petSfx.pop();
    }
  }

  /* ------------------------------------------------------------ bichinho */
  _select(id, { first = false } = {}) {
    const info = petById.get(id);
    if (!info || !this.active) return;
    if (this.state.selected === id) return;
    this.state.selected = id;
    this._save();
    petSfx.pop();
    this._render();
    const status = petStatus(this.state.pets[id]);
    announce(`${info.name}: ${MOODS[status.mood].label}${status.alerts.length ? `. ${status.alerts.map((a) => a.label).join(', ')}` : ''}.`);
    this._showPet(id, { greet: first });
  }

  async _showPet(id, { greet = false } = {}) {
    const info = petById.get(id);
    const token = this.token;
    this._render();
    if (!this.webgl) {
      if (greet) this._speech(`Olá! Eu sou ${the(info)}. ${info.phrase}`, 4000);
      return;
    }
    let actor = this.actors.get(id);
    if (!actor) {
      this.el.loading.hidden = false;
      try {
        actor = new PetActor(await loadPetModel(info), info);
        this.actors.set(id, actor);
      } catch (err) {
        console.error('[bichinho] modelo 3D', err);
        if (this._alive(token)) {
          this.el.room.classList.add('is-flat');
          toast(`🐾 Não foi possível carregar ${the(info)} em 3D agora. Verifique a internet.`, { type: 'warning' });
          if (greet) this._speech(`Olá! Eu sou ${the(info)}. ${info.phrase}`, 4000);
        }
        return;
      } finally {
        this.el.loading.hidden = true;
      }
    }
    if (!this._alive(token) || this.state.selected !== id) return;
    this.el.room.classList.remove('is-flat');
    this.actor = actor;
    this._syncActor();
    if (!this.magicOpen) this.room.setActor(actor);
    actor.react('hop');
    if (greet) this._speech(`Olá! Eu sou ${the(info)}. ${info.phrase}`, 4000);
  }

  _syncActor() {
    const pet = this.pet;
    if (!pet || !this.actor) return;
    this.actor.setState({
      sleeping: pet.sleeping, sick: pet.sick, dirty: pet.needs.higiene < PET.low, mood: petStatus(pet).mood,
    });
  }

  /* ------------------------------------------------------------ cuidados */
  _care(actionId, button) {
    const pet = this.pet;
    if (!pet || !this.active) {
      if (this.active) this._openModal('choose');
      return;
    }
    unlockAudio();
    const info = this.info;
    const result = useAction(this.state, pet.id, actionId, { now: Date.now() });
    if (!result.ok) {
      this._explain(result, info);
      return;
    }
    this._save();
    const to = this._petPoint();
    if (actionId === 'dormir') {
      petSfx.sleep();
      this._speech('Boa noite! 💤');
      announce(`${the(info, true)} foi dormir. Boa noite!`);
    } else if (actionId === 'acordar') {
      petSfx.wake();
      this.actor?.react('wake');
      this._speech('Bom dia! ☀️');
      announce(`${the(info, true)} acordou.`);
    } else if (actionId === 'limpar') {
      petSfx.clean();
      this.el.poops.querySelectorAll('[data-poop]').forEach((p) => this._particles(['💨', '✨'], center(p), { count: 4 }));
      this._particles(['⭐'], center(button), { count: 2, rise: 50 });
      announce(`Quarto limpinho! Mais ${result.stars} estrela.`);
    } else {
      const emoji = result.item ? ITEMS[result.item].emoji : ACTIONS[actionId].icon;
      this._fly(emoji, center(button), to).then(() => {
        if (!this.active) return;
        this._careFx(actionId, result);
      });
      const delta = result.deltas[ACTIONS[actionId].need];
      announce(`${info.name} ${ACTIONS[actionId].done}${delta ? `: ${needById.get(ACTIONS[actionId].need).label} mais ${delta}` : ''}.`);
    }
    if (result.levelUp) this._levelUp(info, result.levelUp);
    this._render();
  }

  /** Reação, som, partículas e números de um cuidado que deu certo. */
  _careFx(actionId, result, { at = this._petPoint(), speech = true } = {}) {
    const fx = CARE_FX[actionId];
    if (!fx) return;
    this.actor?.react(fx.reaction);
    petSfx[fx.sound]?.();
    this._particles(fx.particles, at, { count: actionId === 'banho' ? 10 : 7, className: actionId === 'banho' ? 'fx--bubble' : '' });
    this._showDeltas(result.deltas);
    if (!speech) return;
    const info = petById.get(result.pet);
    if (result.cured) this._speech(isFeminine(info.id) ? 'Fiquei boa! 💚' : 'Fiquei bom! 💚');
    else if (result.favorite) this._speech('Minha comida favorita! 😍');
    else if (actionId === 'alimentar') this._speech('Nham, nham! 😋');
    else if (actionId === 'banho') this._speech('Que cheirinho bom! ✨');
  }

  _explain(result, info) {
    const action = ACTIONS[result.action];
    switch (result.reason) {
      case 'sleeping':
        this._speech('Zzz... 💤');
        toast(`😴 ${the(info, true)} está dormindo. Toque em ☀️ Acordar para cuidar ${ofPet(info)}.`, { duration: 3500 });
        break;
      case 'full':
        this._refuse(action.refuse);
        break;
      case 'tired':
        this._refuse(action.tired);
        break;
      case 'not-tired':
        this._refuse('Ainda não estou com sono! 😊');
        break;
      case 'clean':
        toast('✨ O quarto já está limpinho!', { duration: 2500 });
        break;
      case 'no-item':
        petSfx.refuse();
        this._showHint(result.action);
        break;
      default:
        break;
    }
  }

  _refuse(text) {
    this.actor?.react('refuse');
    petSfx.refuse();
    this._speech(text);
    announce(text);
  }

  _caress(event) {
    const pet = this.pet;
    if (!pet) return;
    unlockAudio();
    const at = { x: event.clientX || center(this.el.hit).x, y: event.clientY || center(this.el.hit).y };
    const result = caress(this.state, pet, Date.now());
    if (result.reason === 'sleeping') {
      this._speech('Zzz... 💤');
      return;
    }
    this._particles(['❤️', '💛', '💕'], at, { count: 5, rise: 90 });
    this.actor?.react('caress');
    if (result.ok) {
      petSfx.happy();
      this._showDeltas(result.deltas);
      if (result.levelUp) this._levelUp(this.info, result.levelUp);
      this._save();
      this._render();
    }
  }

  _cleanOne(button) {
    const pet = this.pet;
    if (!pet) return;
    const result = clean(this.state, pet, 1);
    if (!result.ok) return;
    petSfx.clean();
    this._particles(['💨', '✨'], center(button), { count: 5 });
    announce('Sujeira limpa!');
    this._save();
    this._render();
  }

  _levelUp(info, level) {
    petSfx.levelUp();
    confetti(this.screen, 50);
    this.actor?.react('spin');
    toast(`🎉 ${the(info, true)} subiu para o nível ${level}!`, { type: 'success', duration: 4000 });
  }

  /** "Acabou a comida!" — mostra quais cartas mágicas trazem mais. */
  async _showHint(actionId) {
    const action = ACTIONS[actionId];
    const modal = this.el.modals.hint;
    const cards = await this._cards();
    const ids = cardsForAction(actionId, cards.map((c) => c.id));
    modal.querySelector('[data-hint-icon]').textContent = (action.items || []).map((id) => ITEMS[id]?.emoji).join('') || action.icon;
    modal.querySelector('[data-hint-title]').textContent = action.empty || `Sem itens para ${action.label}`;
    modal.querySelector('[data-hint-cards]').innerHTML = ids.map((id) => {
      const m = magicFor(id);
      return `<li>${this._thumb(id)}<span><strong>${esc(m.label)}</strong><small>${m.emoji} ${esc(m.name)}</small></span></li>`;
    }).join('');
    this._wireThumbs(modal);
    this._openModal('hint');
  }

  /* ------------------------------------------------------------ cartas mágicas */
  async _openMagic() {
    if (!this.active || this.magicOpen) return;
    if (!this.state.selected) {
      this._openModal('choose');
      return;
    }
    unlockAudio();
    this._closeModal();
    this.magicOpen = true;
    // o "voltar" do celular fecha a câmera (e não o jogo)
    history.pushState({ petMagic: true }, '');
    this.room.stop();
    this.el.magic.hidden = false;
    this.screen.classList.add('is-magic');
    this.el.spell.hidden = true;
    this.el.magicPet.textContent = `${this.info.emoji} ${this.info.name}`;
    this._render();
    await this._startScanner();
  }

  async _startScanner() {
    const token = this.token;
    this.el.status.hidden = false;
    this._magicStatus('loading', 0);
    try {
      const ok = await this.scanner.open(this.webgl ? this.actor : null);
      if (!ok || !this.magicOpen || !this._alive(token)) return;
      this.el.status.hidden = true;
      announce('Câmera aberta. Mostre uma carta mágica.');
    } catch (err) {
      if (!this.magicOpen || !this._alive(token)) return;
      this.el.status.hidden = true;
      this._magicError(err);
    }
  }

  _magicError(err) {
    if (!this.magicOpen) return;
    const box = showARError(err, {
      screen: this.el.magic,
      onRetry: async () => {
        await this.scanner.close();
        if (this.magicOpen) this._startScanner();
      },
    });
    // aqui "voltar" leva de volta ao quarto do bichinho
    const back = box.querySelector('a');
    back.textContent = '← Voltar ao quarto';
    back.addEventListener('click', (e) => {
      e.preventDefault();
      this._closeMagic();
    });
  }

  async _closeMagic({ fromHistory = false, leaving = false } = {}) {
    if (!this.magicOpen) return;
    this.magicOpen = false;
    clearTimeout(this._pendingTimer);
    clearErrors(this.el.magic);
    this.el.spell.hidden = true;
    this.el.status.hidden = true;
    await this.scanner.close();
    this.el.magic.hidden = true;
    this.screen.classList.remove('is-magic');
    if (!leaving && this.active) {
      if (this.webgl) {
        this.room.start();
        if (this.actor) this.room.setActor(this.actor);
      }
      this._render();
      this.screen.querySelector('.pet-panel [data-action="magic"]')?.focus({ preventScroll: true });
    }
    if (!fromHistory && !leaving && history.state?.petMagic) history.back();
  }

  _magicStatus(step, progress) {
    const text = {
      loading: 'Preparando a magia... ✨',
      camera: '📷 Abrindo a câmera... Se o navegador perguntar, toque em “Permitir”.',
      targets: 'Carregando as cartas mágicas...',
      preparing: 'Quase pronto...',
    }[step];
    if (text) this.el.statusText.textContent = text;
    const pct = step === 'targets' && typeof progress === 'number' ? progress : step === 'preparing' ? 1 : 0;
    this.el.statusBar.style.setProperty('--progress', `${Math.round(pct * 100)}%`);
  }

  /** Uma carta foi reconhecida pela câmera. */
  _onCard(card) {
    if (!this.magicOpen || !this.active) return;
    const now = Date.now();
    // a magia anterior ainda está acontecendo: esta entra em seguida
    if (now < (this._castLock || 0)) {
      this._pendingCard = card;
      clearTimeout(this._pendingTimer);
      this._pendingTimer = setTimeout(() => {
        const next = this._pendingCard;
        this._pendingCard = null;
        if (next && this.scanner.isVisible(next.index)) this._onCard(next);
      }, this._castLock - now + 60);
      return;
    }
    const result = castCard(this.state, card.id, { now });
    if (!result.ok) {
      if (result.reason === 'cooldown') this._spellCooldown(card, result);
      return;
    }
    this._castLock = now + PET.magic.betweenCastsSeconds * 1000;
    this._save();
    this.scanner.burst(card.index, result.magic.emoji);
    petSfx.magic();
    try {
      navigator.vibrate?.(40);
    } catch { /* ignora */ }

    const stage = this.el.magicStage.getBoundingClientRect();
    const local = this.scanner.cardPoint(card.index);
    const from = local ? { x: stage.left + local.x, y: stage.top + local.y } : center(this.el.magicStage);
    const mine = result.outcomes.filter((o) => o.kind === 'care' && o.ok && o.pet === this.state.selected);
    if (mine.length) {
      this._fly(result.magic.emoji, from, this._petPoint(), { duration: 900, delay: 350 }).then(() => {
        if (!this.magicOpen) return;
        mine.forEach((o) => this._careFx(o.action, o, { speech: false }));
      });
    } else if (result.outcomes.some((o) => o.kind === 'item')) {
      this._fly(result.magic.emoji, from, center(this.el.magicNeeds), { duration: 900, delay: 350 });
    }
    this._spell(card, result);
    if (result.firstTime) confetti(this.el.magic, 40);
    for (const up of result.levelUps) this._levelUp(petById.get(up.pet), up.level);
    announce(`Magia ${result.magic.name}! ${this._outcomeLines(result).join('. ')}`);
    this._render();
  }

  _spell(card, result) {
    const lines = this._outcomeLines(result);
    const extra = result.firstTime ? `<p class="spell__new">✨ Nova magia descoberta! +${result.stars} ⭐</p>` : `<p class="spell__stars">+${result.stars} ⭐</p>`;
    this._showSpell(`
      ${this._thumb(card.id, 'spell__card')}
      <div class="spell__body">
        <p class="spell__label">Carta ${card.id} · ${esc(result.magic.label)}</p>
        <p class="spell__title"><span aria-hidden="true">${result.magic.emoji}</span> ${esc(result.magic.name)}!</p>
        <ul class="spell__lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        ${extra}
      </div>`, 'cast');
  }

  _spellCooldown(card, result) {
    this._showSpell(`
      ${this._thumb(card.id, 'spell__card')}
      <div class="spell__body">
        <p class="spell__label">Carta ${card.id} · ${esc(result.magic.label)}</p>
        <p class="spell__title">⏳ Recarregando a magia...</p>
        <ul class="spell__lines"><li>Esta carta volta a funcionar em ${result.remaining} s. Experimente outra carta!</li></ul>
      </div>`, 'wait');
  }

  _showSpell(html, kind) {
    const box = this.el.spell;
    box.className = `spell spell--${kind}`;
    box.innerHTML = html;
    box.hidden = false;
    this._wireThumbs(box);
    clearTimeout(this._spellTimer);
    this._spellTimer = setTimeout(() => { box.hidden = true; }, kind === 'wait' ? 3000 : 4600);
  }

  /** Frases curtas explicando o que a magia fez. */
  _outcomeLines(result) {
    const lines = [];
    const byAction = new Map();
    for (const o of result.outcomes) {
      if (o.kind !== 'care') continue;
      const group = byAction.get(o.action) || { ok: [], fail: [] };
      (o.ok ? group.ok : group.fail).push(o);
      byAction.set(o.action, group);
    }
    for (const [actionId, group] of byAction) {
      const need = needById.get(ACTIONS[actionId].need);
      if (group.ok.length === 1) {
        const o = group.ok[0];
        const info = petById.get(o.pet);
        const delta = o.deltas[need.id] || 0;
        lines.push(`${info.emoji} ${info.name}: ${need.icon} ${need.label} +${delta}${o.cured ? ' · curad' + (isFeminine(info.id) ? 'a' : 'o') + '! 💚' : ''}${o.favorite ? ' · comida favorita! 😍' : ''}`);
      } else if (group.ok.length > 1) {
        const cured = group.ok.filter((o) => o.cured).length;
        const best = Math.max(...group.ok.map((o) => o.deltas[need.id] || 0));
        lines.push(`${group.ok.map((o) => petById.get(o.pet).emoji).join('')} ${need.icon} ${need.label} até +${best}${cured ? ` · ${cured} curado${cured > 1 ? 's' : ''}! 💚` : ''}`);
      } else if (group.fail.length) {
        const o = group.fail[0];
        const info = petById.get(o.pet);
        const why = o.reason === 'sleeping' ? 'está dormindo 😴' : 'não precisava disso agora';
        lines.push(group.fail.length > 1 ? '😊 Os bichinhos não precisavam disso agora' : `${info.emoji} ${info.name} ${why}`);
      }
    }
    for (const o of result.outcomes) {
      const item = ITEMS[o.item];
      if (o.kind === 'item' && item) {
        if (o.stored) lines.push(`🎒 Guardei ${item.emoji} ${item.name} na mochila`);
        else if (o.surprise) lines.push(`🎁 Surpresa: +${o.added} ${item.emoji} ${item.name} na mochila`);
        else lines.push(`🎒 +${o.added} ${item.emoji} ${item.name} na mochila${o.added < o.amount ? ' (mochila cheia)' : ''}`);
      } else if (o.kind === 'stars' && o.converted) {
        lines.push('⭐ A magia virou uma estrelinha!');
      } else if (o.kind === 'need') {
        const info = petById.get(o.pet);
        const parts = Object.entries(o.deltas).map(([id, d]) => `${needById.get(id)?.icon || ''} ${d >= 0 ? '+' : ''}${d}`);
        if (parts.length) lines.push(`${info.emoji} ${info.name}: ${parts.join(' ')}`);
      }
    }
    return lines;
  }

  /* ------------------------------------------------------------ Livro de Magias */
  /** Cartas existentes (do manifesto das cartas), com o arquivo de cada uma. */
  async _cards() {
    if (!this._cardList) {
      this._cardList = fetch(`${GAME.targets}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((manifest) => (manifest?.targets?.length ? buildCardList(manifest, manifest.count)
          : Array.from({ length: 20 }, (_, i) => ({ index: i, id: i + 1, file: `cartas/carta${i + 1}.png` }))))
        .then((cards) => {
          this._cardFiles = new Map(cards.map((c) => [c.id, c.file]));
          return cards;
        });
    }
    return this._cardList;
  }

  _thumb(id, className = 'thumb') {
    const file = this._cardFiles?.get(id) || `cartas/carta${id}.png`;
    return `<img class="${className}" src="assets/img/cartas-mini/carta${id}.webp" data-fallback="${esc(file)}" alt="" width="120" height="180" loading="lazy" decoding="async">`;
  }

  /** Miniatura ausente (carta nova): mostra a carta original. */
  _wireThumbs(root) {
    root.querySelectorAll('img[data-fallback]').forEach((img) => {
      img.addEventListener('error', () => {
        if (img.src.includes('/cartas-mini/')) img.src = img.dataset.fallback;
      }, { once: true });
    });
  }

  async _openBook() {
    if (!this.state) return;
    const cards = await this._cards();
    const ids = cards.map((c) => c.id);
    const now = Date.now();
    const used = this.state.magic.used;
    const modal = this.el.modals.book;
    modal.querySelector('[data-book-count]').textContent = `Magias descobertas: ${ids.filter((id) => used[id]).length} de ${ids.length}`;
    modal.querySelector('[data-book-groups]').innerHTML = magicBook(ids).map((group) => `
      <section class="book-group">
        <h3><span aria-hidden="true">${group.icon}</span> ${esc(group.title)}</h3>
        <p class="book-group__rule">${esc(group.rule)}</p>
        <ul class="book-cards">${group.cards.map((m) => {
          const count = used[m.card] || 0;
          const wait = cooldownLeft(this.state, m.card, now);
          return `<li class="book-card${count ? ' is-used' : ''}">
            ${this._thumb(m.card, 'book-card__img')}
            <div class="book-card__body">
              <p class="book-card__label">Carta ${m.card} · ${esc(m.label)}</p>
              <p class="book-card__magic"><span aria-hidden="true">${m.emoji}</span> ${esc(m.name)}</p>
              ${m.hint ? `<p class="book-card__hint">${esc(m.hint)}</p>` : ''}
              <ul class="book-card__effects">${describeMagic(m).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
              <p class="book-card__status">${count ? `✔ Usada ${count}×` : '✨ Ainda não usada'}${wait ? ` · ⏳ volta em ${wait} s` : ''}</p>
            </div>
          </li>`;
        }).join('')}</ul>
      </section>`).join('');
    this._wireThumbs(modal);
    this._openModal('book');
  }

  /* ------------------------------------------------------------ "enquanto você estava fora" */
  _showAway(events, away) {
    const notable = events.filter((e) => AWAY_EVENTS.includes(e.type));
    if (!notable.length) return;
    const perPet = new Map();
    for (const e of notable) {
      const info = petById.get(e.pet);
      if (!info) continue;
      const fem = isFeminine(info.id);
      let text = '';
      if (e.type === 'sick') text = 'ficou doente 🤒';
      else if (e.type === 'poop') text = 'fez cocô 💩';
      else if (e.type === 'fell-asleep') text = 'dormiu de cansaço 😴';
      else if (e.type === 'wake') text = `acordou ${fem ? 'descansada' : 'descansado'} ☀️`;
      else if (e.type === 'low') text = `ficou ${needLowLabel(e.need, info.id).toLowerCase()} ${needById.get(e.need).icon}`;
      const set = perPet.get(info.id) || new Set();
      set.add(text);
      perPet.set(info.id, set);
    }
    const modal = this.el.modals.away;
    modal.querySelector('[data-away-time]').textContent = `Você ficou fora por ${formatDuration(away)}. Veja o que aconteceu:`;
    modal.querySelector('[data-away-list]').innerHTML = [...perPet].map(([id, texts]) => {
      const info = petById.get(id);
      return `<li><span class="away-list__emoji" aria-hidden="true">${info.emoji}</span><span><strong>${esc(info.name)}</strong> ${esc([...texts].join(', '))}</span></li>`;
    }).join('');
    this._openModal('away');
  }

  /* ------------------------------------------------------------ janelas */
  _openModal(name) {
    const modal = this.el.modals[name];
    if (!modal) return;
    this._closeModal();
    this._lastFocus = document.activeElement;
    modal.hidden = false;
    this.openModal = name;
    (modal.querySelector('[data-autofocus]') || modal.querySelector('button'))?.focus({ preventScroll: true });
  }

  _closeModal() {
    if (!this.openModal) return;
    this.el.modals[this.openModal].hidden = true;
    this.openModal = null;
    if (this._lastFocus?.isConnected) this._lastFocus.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ efeitos na tela */
  /** Cabeça do bichinho em coordenadas da janela. */
  _petPoint() {
    if (this.magicOpen) {
      const p = this.scanner.petPoint();
      const r = this.el.magicStage.getBoundingClientRect();
      if (p) return { x: r.left + p.x, y: r.top + p.y };
      return { x: r.left + r.width * 0.25, y: r.bottom - 160 };
    }
    const r = this.el.room.getBoundingClientRect();
    const rect = this.room.rect;
    if (this.webgl && this.actor && rect && !this.el.room.classList.contains('is-flat')) {
      return { x: r.left + rect.headX, y: r.top + rect.headY + rect.height * 0.2 };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
  }

  _fly(emoji, from, to, { duration = 750, delay = 0 } = {}) {
    if (!from || !to || prefersReducedMotion() || !Element.prototype.animate) return Promise.resolve();
    const el = document.createElement('span');
    el.className = 'fx fx--fly';
    el.textContent = emoji;
    el.style.opacity = '0';
    this.el.fx.appendChild(el);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 80 };
    const at = (p, s) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
    const anim = el.animate([
      { transform: at(from, 0.5), opacity: 0 },
      { transform: at(mid, 1.3), opacity: 1, offset: 0.45 },
      { transform: at(to, 0.7), opacity: 1 },
    ], { duration, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' });
    return anim.finished.catch(() => {}).then(() => el.remove());
  }

  _particles(symbols, at, { count = 6, spread = 70, rise = 70, duration = 1100, className = '' } = {}) {
    if (!at || prefersReducedMotion() || !Element.prototype.animate) return;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = `fx ${className}`;
      el.textContent = symbols[i % symbols.length];
      this.el.fx.appendChild(el);
      const dx = (Math.random() - 0.5) * spread * 2;
      const dy = -rise * (0.4 + Math.random());
      el.animate([
        { transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%) scale(0.4)`, opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: `translate(${at.x + dx}px, ${at.y + dy}px) translate(-50%, -50%) scale(1)`, opacity: 0 },
      ], { duration: duration * (0.7 + Math.random() * 0.6), delay: i * 45, easing: 'ease-out', fill: 'both' })
        .finished.catch(() => {}).then(() => el.remove());
    }
  }

  /** "+35" subindo da barra de cada necessidade que melhorou. */
  _showDeltas(deltas = {}) {
    const items = this.magicOpen ? this.miniNeeds : this.needItems;
    for (const [need, delta] of Object.entries(deltas)) {
      if (delta <= 0) continue;
      const item = items.find((el) => el.dataset.need === need);
      if (!item || !item.offsetParent) continue;
      const r = item.getBoundingClientRect();
      this._particles([`+${delta}`], { x: r.left + r.width / 2, y: r.top }, { count: 1, spread: 4, rise: 34, duration: 1200, className: 'fx--number' });
    }
  }

  /** Balão de fala do bichinho. */
  _speech(text, ms = 2400) {
    const el = this.el.speech;
    if (this.magicOpen) {
      toast(text, { duration: ms });
      return;
    }
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-in');
    void el.offsetWidth;
    el.classList.add('is-in');
    clearTimeout(this._speechTimer);
    this._speechTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  _layoutOverlays(rect) {
    if (!rect) return;
    const s = this.el.room.style;
    s.setProperty('--pet-head-x', `${rect.headX}px`);
    s.setProperty('--pet-head-y', `${rect.headY}px`);
    s.setProperty('--pet-left', `${rect.x}px`);
    s.setProperty('--pet-top', `${rect.y}px`);
    s.setProperty('--pet-width', `${rect.width}px`);
    s.setProperty('--pet-height', `${rect.height}px`);
    this.el.room.classList.add('has-layout');
  }

  /* ------------------------------------------------------------ desenho da interface */
  _render() {
    if (!this.state) return;
    const pet = this.pet;
    this.el.stars.textContent = `⭐ ${this.state.stars}`;
    this._renderPicker();
    this._renderRoom(pet);
    this._renderNeeds(pet);
    this._renderActions(pet);
    if (this.magicOpen) this._renderMiniNeeds(pet);
    this._syncActor();
  }

  _renderPicker() {
    for (const btn of this.pickerButtons) {
      const id = btn.dataset.pet;
      const pet = this.state.pets[id];
      const info = petById.get(id);
      const status = petStatus(pet);
      btn.setAttribute('aria-pressed', String(id === this.state.selected));
      btn.querySelector('[data-level]').textContent = `Nv${pet.level}`;
      let mark = '';
      let kind = '';
      if (pet.sick) [mark, kind] = ['🤒', 'sick'];
      else if (pet.sleeping) [mark, kind] = ['💤', 'sleep'];
      else if (status.alerts.length) [mark, kind] = ['!', status.alerts.some((a) => a.critical) ? 'critical' : 'warn'];
      else if (pet.poops) [mark, kind] = ['💩', 'poop'];
      const alert = btn.querySelector('[data-alert]');
      alert.hidden = !mark;
      alert.textContent = mark;
      alert.dataset.kind = kind;
      const alerts = status.alerts.map((a) => a.label).join(', ');
      btn.setAttribute('aria-label', `${info.name}, nível ${pet.level}: ${MOODS[status.mood].label}${alerts ? ` (${alerts})` : ''}`);
    }
  }

  _renderRoom(pet) {
    const room = this.el.room;
    if (!pet) {
      room.removeAttribute('data-night');
      room.removeAttribute('data-dirty');
      room.removeAttribute('data-sick');
      room.dataset.empty = 'true';
      this.el.badge.hidden = true;
      this.el.bubble.hidden = true;
      this.el.poops.replaceChildren();
      this.el.mood.innerHTML = '<span class="pet-mood__emoji" aria-hidden="true">👆</span><span class="pet-mood__text"><strong>Escolha um bichinho para começar!</strong></span>';
      return;
    }
    delete room.dataset.empty;
    const info = petById.get(pet.id);
    const status = petStatus(pet);
    room.dataset.theme = info.theme;
    room.toggleAttribute('data-night', pet.sleeping);
    room.toggleAttribute('data-dirty', pet.needs.higiene < PET.low);
    room.toggleAttribute('data-sick', pet.sick);
    this.el.frame.textContent = info.emoji;
    this.el.fallback.textContent = info.emoji;

    const xp = Math.round((pet.xp / xpForLevel(pet.level)) * 100);
    const badge = `${info.id}|${pet.level}|${xp}`;
    if (this._badgeKey !== badge) {
      this._badgeKey = badge;
      this.el.badge.hidden = false;
      this.el.badge.innerHTML = `
        <span class="room-badge__name">${info.emoji} ${esc(info.name)}</span>
        <span class="room-badge__level">Nível ${pet.level}</span>
        <span class="room-badge__xp" role="progressbar" aria-label="Experiência para o próximo nível" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${xp}"><i style="width:${xp}%"></i></span>`;
    }

    const mood = MOODS[status.mood];
    const chips = status.alerts.slice(0, 3).map((a) => `<span class="alert-chip${a.critical ? ' is-critical' : ''}">${a.icon} ${esc(a.label)}</span>`).join('');
    const moodKey = `${status.mood}|${chips}`;
    if (this._moodKey !== moodKey) {
      this._moodKey = moodKey;
      this.el.mood.dataset.mood = status.mood;
      this.el.mood.innerHTML = `<span class="pet-mood__emoji" aria-hidden="true">${mood.emoji}</span>
        <span class="pet-mood__text"><strong>${esc(mood.label)}</strong>${chips ? `<span class="pet-mood__alerts">${chips}</span>` : ''}</span>`;
    }

    if (this.el.poops.children.length !== pet.poops) {
      this.el.poops.innerHTML = POOP_SLOTS.slice(0, pet.poops).map(([left, bottom]) => `
        <button type="button" class="poop" data-poop style="left:${left}%;bottom:${bottom}%" aria-label="Limpar a sujeira">💩</button>`).join('');
    }

    const urgent = !pet.sleeping && status.urgent;
    this.el.bubble.hidden = !urgent;
    if (urgent) this.el.bubble.textContent = urgent.icon;
  }

  _renderNeeds(pet) {
    for (const li of this.needItems) {
      const id = li.dataset.need;
      const value = pet ? Math.round(pet.needs[id]) : 0;
      const sick = !!(pet?.sick && id === 'saude');
      const key = `${value}|${sick}`;
      if (li._key === key) continue;
      li._key = key;
      li.querySelector('i').style.width = `${value}%`;
      const bar = li.querySelector('[role="progressbar"]');
      bar.setAttribute('aria-valuenow', String(value));
      bar.setAttribute('aria-valuetext', `${value}%${sick ? ', doente' : ''}`);
      li.dataset.level = value < PET.critical ? 'critical' : value < PET.low ? 'low' : value < 60 ? 'mid' : 'ok';
      li.toggleAttribute('data-sick', sick);
    }
  }

  _renderMiniNeeds(pet) {
    for (const el of this.miniNeeds) {
      const value = pet ? Math.round(pet.needs[el.dataset.need]) : 0;
      el.querySelector('b').style.width = `${value}%`;
      el.dataset.level = value < PET.critical ? 'critical' : value < PET.low ? 'low' : value < 60 ? 'mid' : 'ok';
    }
  }

  _renderActions(pet) {
    for (const btn of this.actionButtons) {
      let id = btn.dataset.care;
      if (id === 'dormir' || id === 'acordar') {
        id = pet?.sleeping ? 'acordar' : 'dormir';
        if (btn.dataset.care !== id) {
          btn.dataset.care = id;
          btn.querySelector('.care-btn__icon').textContent = ACTIONS[id].icon;
          btn.querySelector('.care-btn__label').innerHTML = this._careLabel(id);
        }
      }
      const action = ACTIONS[id];
      const count = btn.querySelector('[data-count]');
      let label = action.label;
      if (action.items?.length) {
        const n = action.items.reduce((sum, item) => sum + (this.state.inventory[item] || 0), 0);
        count.hidden = false;
        count.textContent = n || '✨';
        btn.dataset.empty = String(!n);
        label = `${action.label}: ${n ? `${n} na mochila (${action.items.map((i) => ITEMS[i].name).join(', ')})` : 'acabou — use uma carta mágica'}`;
      } else if (id === 'limpar') {
        count.hidden = !pet?.poops;
        count.textContent = pet?.poops || '';
        btn.dataset.empty = 'false';
        if (pet?.poops) label = `Limpar: ${pet.poops} sujeira${pet.poops > 1 ? 's' : ''}`;
      } else {
        count.hidden = true;
        btn.dataset.empty = 'false';
      }
      btn.setAttribute('aria-label', label);
      btn.disabled = !pet;
    }
  }

  _renderSound() {
    const on = isSoundOn();
    this.el.sound.textContent = on ? '🔊' : '🔇';
    this.el.sound.setAttribute('aria-pressed', String(on));
    this.el.sound.setAttribute('aria-label', on ? 'Desligar sons' : 'Ligar sons');
  }
}
