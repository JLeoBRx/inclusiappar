/**
 * ★ CONFIGURAÇÃO DO BICHINHO VIRTUAL
 *
 * Tudo o que define o jogo fica aqui: os bichinhos, as necessidades e a
 * velocidade com que mudam, os itens da mochila, as ações de cuidado e,
 * principalmente, a MAGIA DE CADA CARTA (CARD_MAGIC, no fim do arquivo).
 * Nenhum outro arquivo precisa mudar para trocar o que uma carta faz.
 *
 * Os bichinhos são os mesmos 5 animais do livro (ANIMALS em config.js), com
 * os mesmos modelos 3D. As cartas são as mesmas do Jogo de Cartas
 * (assets/targets/cartas.*), reconhecidas pela câmera com o MindAR.
 */
import { ANIMALS } from '../config.js';

/* ------------------------------------------------------------ regras gerais */
export const PET = {
  /** chave no localStorage ("sinalizaacao:pet"); a cópia de segurança usa "pet.backup" */
  storageKey: 'pet',
  /** versão do formato salvo — aumente ao mudar a estrutura e trate em migrate() (petState.js) */
  schema: 1,

  /** abaixo disto a necessidade vira alerta ("com fome", "sujo"...) */
  low: 30,
  /** abaixo disto a necessidade é crítica e a saúde começa a cair */
  critical: 15,
  /** necessidades de um bichinho novo (0 a 100) */
  start: { fome: 80, sede: 80, higiene: 90, diversao: 75, sono: 85, saude: 100 },

  time: {
    /** tempo máximo simulado quando o jogo fica fechado (h) — ninguém volta para um desastre */
    maxOfflineHours: 72,
    /** passo da simulação (min): sono, doenças e cocôs são avaliados a cada passo */
    stepMinutes: 10,
    /** ao voltar depois deste tempo (min), mostra "Enquanto você estava fora..." */
    awayReportMinutes: 20,
  },

  sleep: {
    /** sono recuperado por hora dormindo */
    recoverPerHour: 12,
    /** com o sono abaixo disto, o bichinho dorme sozinho de cansaço */
    autoSleepBelow: 8,
    /** acorda sozinho quando o sono chega a este valor */
    wakeAt: 100,
    /** só aceita ir dormir com o sono abaixo disto */
    canSleepBelow: 85,
    /** dormindo, as outras necessidades caem mais devagar (multiplicador) */
    decayFactor: { fome: 0.5, sede: 0.5, higiene: 0.5, diversao: 0.25 },
  },

  health: {
    /** saúde perdida por hora para cada necessidade crítica entre fome, sede e higiene */
    criticalLossPerHour: 3,
    /** saúde perdida por hora com diversão ou sono críticos */
    minorLossPerHour: 1,
    /** saúde perdida por hora enquanto estiver doente */
    sickLossPerHour: 4,
    /** saúde recuperada por hora quando todas as necessidades estão acima de recoverAbove */
    recoverPerHour: 2,
    recoverAbove: 40,
  },

  /** chance de ficar doente (por hora) — somam-se as que se aplicam */
  sickness: {
    basePerHour: 0.003,
    dirtyPerHour: 0.03, // higiene abaixo de dirtyBelow
    dirtyBelow: 25,
    hungryPerHour: 0.02, // fome ou sede críticas
    weakPerHour: 0.03, // saúde abaixo de weakBelow
    weakBelow: 40,
    poopPerHour: 0.01, // por cocô no quarto
    /** depois de curado, fica protegido por este tempo (h) */
    immunityHours: 8,
    /** saúde perdida no momento em que adoece */
    healthLossOnSick: 10,
  },

  poop: {
    /** o cocô aparece entre min e max minutos depois de comer */
    minMinutes: 30,
    maxMinutes: 90,
    /** máximo de cocôs no quarto de cada bichinho */
    max: 3,
    /** higiene perdida por hora para cada cocô no quarto */
    dirtPerHour: 1.5,
  },

  inventory: {
    /** máximo de cada item na mochila */
    max: 9,
  },
  /** salva sozinho a cada tantos segundos (além de salvar a cada cuidado) */
  autosaveSeconds: 15,
  /** presente de boas-vindas (primeira vez) */
  starterKit: { mel: 2, ovo: 1, uva: 1, agua: 3, esponja: 2, folhas: 1 },
  /** presente do dia: quantos itens (escolhidos pelo que os bichinhos mais precisam) */
  dailyGift: 2,

  magic: {
    /** cada carta só pode ser usada de novo depois deste tempo (s) */
    cardCooldownSeconds: 60,
    /** intervalo mínimo entre duas magias seguidas (s), para a animação terminar */
    betweenCastsSeconds: 2.5,
  },

  rewards: {
    actionStars: 1, // ⭐ por cuidado feito pelos botões
    magicStars: 2, // ⭐ por carta mágica usada
    newCardStars: 5, // ⭐ extras na primeira vez de cada carta
    actionXp: 5, // experiência do bichinho por cuidado
    magicXp: 10, // experiência por magia recebida
    caressXp: 1,
    /** experiência para subir de nível: levelXp + (nível − 1) × levelXpStep */
    levelXp: 100,
    levelXpStep: 50,
  },

  caress: {
    /** diversão ganha com um carinho (tocar no bichinho) */
    fun: 3,
    cooldownSeconds: 4,
  },
};

/* ------------------------------------------------------------ bichinhos */
/**
 * Detalhes de cada bichinho. `theme` é a cor do quarto; `scale` ajusta o
 * tamanho do modelo 3D; `yaw` gira o animal (rad) para aparecer de três
 * quartos; `favorite` é a comida favorita (dá diversão extra); `article`
 * ('a' ou 'o') deixa as frases certas ("a Iguana ficou suja").
 */
const ROOMS = {
  abelha: { theme: 'mel', scale: 0.8, yaw: -0.7, article: 'a', favorite: 'mel', phrase: 'Zum-zum! Eu adoro mel!' },
  elefante: { theme: 'ceu', scale: 1.0, yaw: -0.75, article: 'o', favorite: 'uva', phrase: 'Banho de tromba é o melhor!' },
  iguana: { theme: 'folha', scale: 1.08, yaw: -0.8, article: 'a', favorite: 'uva', phrase: 'Gosto de sol e de folhinhas.' },
  onca: { theme: 'laranja', scale: 1.0, yaw: -0.8, article: 'a', favorite: 'ovo', phrase: 'Corro mais rápido que o vento!' },
  urso: { theme: 'madeira', scale: 0.98, yaw: -0.7, article: 'o', favorite: 'mel', phrase: 'Um abraço de urso para você!' },
};

export const PETS = ANIMALS.map((a) => ({
  id: a.id,
  name: a.name,
  emoji: a.emoji,
  model: a.model,
  lift: a.lift || 0,
  ...ROOMS[a.id],
}));

/* ------------------------------------------------------------ necessidades */
/**
 * Necessidades (0 a 100; 100 = satisfeito). `decay` é quanto cai por hora com
 * o bichinho acordado. A saúde não cai sozinha: depende das outras (veja PET.health).
 * `lowLabel` é o estado quando a necessidade está baixa ([masculino, feminino]).
 */
export const NEEDS = [
  { id: 'fome', label: 'Fome', icon: '🍎', lowLabel: ['Com fome', 'Com fome'], decay: 3 },
  { id: 'sede', label: 'Sede', icon: '💧', lowLabel: ['Com sede', 'Com sede'], decay: 3.5 },
  { id: 'higiene', label: 'Higiene', icon: '🛁', lowLabel: ['Sujo', 'Suja'], decay: 2 },
  { id: 'diversao', label: 'Diversão', icon: '🎾', lowLabel: ['Entediado', 'Entediada'], decay: 2.5 },
  { id: 'sono', label: 'Sono', icon: '😴', lowLabel: ['Com sono', 'Com sono'], decay: 3 },
  { id: 'saude', label: 'Saúde', icon: '❤️', lowLabel: ['Fraquinho', 'Fraquinha'], decay: 0 },
];

/* ------------------------------------------------------------ itens da mochila */
/**
 * Itens ganhos com as cartas mágicas e usados pelos botões de cuidado.
 * `action` é a ação que o item faz; `power` quanto recupera; `bonus` soma em
 * outras necessidades; `cures` cura a doença.
 */
export const ITEMS = {
  mel: { emoji: '🍯', name: 'Mel', action: 'alimentar', power: 35, bonus: { diversao: 5 } },
  ovo: { emoji: '🥚', name: 'Ovo', action: 'alimentar', power: 30 },
  uva: { emoji: '🍇', name: 'Uva', action: 'alimentar', power: 25, bonus: { sede: 5 } },
  agua: { emoji: '💧', name: 'Água', action: 'beber', power: 40 },
  esponja: { emoji: '🧽', name: 'Esponja', action: 'banho', power: 60 },
  folhas: { emoji: '🌿', name: 'Folhinhas da Iguana', action: 'remedio', power: 30, cures: true },
};

/* ------------------------------------------------------------ ações de cuidado */
/**
 * `need`        necessidade que a ação recupera
 * `items`       itens da mochila que a ação usa (na ordem de preferência);
 *               sem `items` a ação é livre (não gasta nada)
 * `power`       recuperação padrão (itens e cartas podem ter outra)
 * `refuseAbove` acima disto o bichinho recusa ("Estou cheio!")
 * `whileSleeping` pode ser feita com o bichinho dormindo
 * `cost`        o que a ação gasta de outras necessidades (só pelos botões;
 *               magia não cansa)
 * `phrase`      textos do Livro de Magias: [um bichinho, todos]
 */
export const ACTIONS = {
  alimentar: {
    label: 'Alimentar', short: 'Comer', icon: '🍎', need: 'fome', power: 30, items: ['mel', 'ovo', 'uva'],
    refuseAbove: 95, refuse: 'Não estou com fome agora! 😋', done: 'comeu', poop: true, empty: 'Acabou a comida!',
    phrase: ['Alimenta o bichinho escolhido', 'Alimenta os {n} bichinhos'],
  },
  beber: {
    label: 'Água', icon: '💧', need: 'sede', power: 40, items: ['agua'],
    refuseAbove: 95, refuse: 'Não estou com sede! 😊', done: 'bebeu água', empty: 'Acabou a água!',
    phrase: ['Dá água ao bichinho escolhido', 'Dá água aos {n} bichinhos'],
  },
  banho: {
    label: 'Banho', icon: '🛁', need: 'higiene', power: 60, items: ['esponja'],
    refuseAbove: 95, refuse: 'Já tomei banho! ✨', done: 'tomou banho', empty: 'Acabaram as esponjas!',
    phrase: ['Dá banho no bichinho escolhido', 'Dá banho nos {n} bichinhos'],
  },
  brincar: {
    label: 'Brincar', icon: '🎾', need: 'diversao', power: 25,
    refuseAbove: 97, refuse: 'Já brinquei bastante! 😄', done: 'brincou',
    cost: { sono: 6, fome: 3, sede: 3 }, tiredBelow: 12, tired: 'Preciso descansar antes de brincar... 😴',
    phrase: ['Brinca com o bichinho escolhido', 'Brinca com os {n} bichinhos'],
  },
  remedio: {
    label: 'Remédio', icon: '💊', need: 'saude', power: 30, items: ['folhas'], cures: true, whileSleeping: true,
    refuseAbove: 98, refuse: 'Não preciso de remédio! 💪', done: 'tomou remédio', empty: 'Acabou o remédio!',
    phrase: ['Cuida da saúde do bichinho escolhido e cura doenças', 'Cuida da saúde dos {n} bichinhos e cura doenças'],
  },
  energia: {
    label: 'Energia', icon: '⚡', need: 'sono', power: 40, whileSleeping: true,
    refuseAbove: 97, refuse: 'Tenho energia de sobra! ⚡', done: 'ganhou energia',
    phrase: ['Dá energia ao bichinho escolhido', 'Dá energia aos {n} bichinhos'],
  },
  dormir: { label: 'Dormir', icon: '😴' },
  acordar: { label: 'Acordar', icon: '☀️' },
  limpar: { label: 'Limpar', icon: '🧹' },
  carinho: { label: 'Carinho', icon: '❤️' },
};

/**
 * botões de cuidado, na ordem em que aparecem ("dormir" vira "acordar" com o
 * bichinho dormindo). Em telas estreitas o botão mostra `short`, se houver.
 */
export const ACTION_BAR = ['alimentar', 'beber', 'banho', 'brincar', 'remedio', 'dormir', 'limpar'];

/* ------------------------------------------------------------ CARTAS MÁGICAS */
/**
 * Cada carta (pelo número do arquivo: cartas/cartaN.png) tem uma magia:
 * nome, emoji e a lista de EFEITOS executados quando a câmera reconhece a carta.
 *
 * Tipos de efeito (novos tipos podem ser criados com registerEffect() em cardMagic.js):
 *
 *   { type: 'care', action: 'alimentar', target: 'current' }
 *       ação de cuidado no bichinho escolhido ('current') ou em todos ('all').
 *       Opcional: `power` (força), `item` (o que aparece na tela — e o que vai
 *       para a mochila se ninguém precisar agora: a magia nunca é desperdiçada).
 *   { type: 'item', item: 'agua', amount: 2 }
 *       coloca itens na mochila.
 *   { type: 'surprise', amount: 1 }
 *       o item de que o bichinho escolhido mais precisa.
 *   { type: 'stars', amount: 3 }
 *       estrelas ⭐.
 *   { type: 'need', needs: { diversao: 10 }, target: 'all' }
 *       muda necessidades diretamente.
 *
 * Uma carta pode ter vários efeitos. Exemplo — a carta da Abelha também dando banho:
 *
 *   1: { name: 'Pote de mel', emoji: '🍯', effects: [
 *        { type: 'care', action: 'alimentar', item: 'mel', target: 'current' },
 *        { type: 'care', action: 'banho', target: 'current' },
 *      ] },
 *
 * `hint` é uma dica curta mostrada no Livro de Magias.
 * Cartas novas (carta21.png...) sem entrada aqui usam DEFAULT_MAGIC.
 */
export const CARD_MAGIC = {
  /* 🐾 cartas dos animais: magia na hora para o bichinho escolhido */
  1: {
    name: 'Pote de mel', emoji: '🍯', hint: 'A abelha faz mel',
    effects: [{ type: 'care', action: 'alimentar', item: 'mel', target: 'current' }],
  },
  2: {
    name: 'Chuveirada de tromba', emoji: '💦', hint: 'O elefante espirra água com a tromba',
    effects: [
      { type: 'care', action: 'banho', power: 70, target: 'current' },
      { type: 'care', action: 'beber', power: 25, target: 'current' },
    ],
  },
  3: {
    name: 'Soneca de urso', emoji: '💤', hint: 'O urso hiberna e acorda cheio de energia',
    effects: [{ type: 'care', action: 'energia', power: 40, target: 'current' }],
  },
  4: {
    name: 'Pega-pega da onça', emoji: '🏃', hint: 'A onça é rápida e brincalhona',
    effects: [{ type: 'care', action: 'brincar', power: 40, target: 'current' }],
  },
  5: {
    name: 'Chá de folhas', emoji: '🌿', hint: 'As folhinhas da iguana curam',
    effects: [{ type: 'care', action: 'remedio', item: 'folhas', target: 'current' }],
  },

  /* 🤟 sinais dos animais em LIBRAS: a mesma magia para os 5 bichinhos */
  6: {
    name: 'Banquete de mel', emoji: '🍯', hint: 'Sinal de ABELHA em LIBRAS',
    effects: [{ type: 'care', action: 'alimentar', item: 'mel', target: 'all' }],
  },
  7: {
    name: 'Chuveirada geral', emoji: '💦', hint: 'Sinal de ELEFANTE em LIBRAS',
    effects: [
      { type: 'care', action: 'banho', power: 70, target: 'all' },
      { type: 'care', action: 'beber', power: 25, target: 'all' },
    ],
  },
  8: {
    name: 'Chá para todos', emoji: '🌿', hint: 'Sinal de IGUANA em LIBRAS',
    effects: [{ type: 'care', action: 'remedio', item: 'folhas', target: 'all' }],
  },
  9: {
    name: 'Festa da floresta', emoji: '🎉', hint: 'Sinal de ONÇA em LIBRAS',
    effects: [{ type: 'care', action: 'brincar', power: 40, target: 'all' }],
  },
  10: {
    name: 'Soneca coletiva', emoji: '💤', hint: 'Sinal de URSO em LIBRAS',
    effects: [{ type: 'care', action: 'energia', power: 40, target: 'all' }],
  },

  /* ✋ vogais em LIBRAS: magia em dobro (2 itens para a mochila) */
  11: { name: 'Água em dobro', emoji: '💧', hint: 'A de Água', effects: [{ type: 'item', item: 'agua', amount: 2 }] },
  12: { name: 'Esponjas em dobro', emoji: '🧽', hint: 'E de Esponja', effects: [{ type: 'item', item: 'esponja', amount: 2 }] },
  13: { name: 'Folhinhas em dobro', emoji: '🌿', hint: 'I de Iguana', effects: [{ type: 'item', item: 'folhas', amount: 2 }] },
  14: { name: 'Ovos em dobro', emoji: '🥚', hint: 'O de Ovo', effects: [{ type: 'item', item: 'ovo', amount: 2 }] },
  15: { name: 'Uvas em dobro', emoji: '🍇', hint: 'U de Uva', effects: [{ type: 'item', item: 'uva', amount: 2 }] },

  /* 🔤 letras: 1 item para a mochila */
  16: { name: 'Água', emoji: '💧', hint: 'A de Água', effects: [{ type: 'item', item: 'agua', amount: 1 }] },
  17: { name: 'Esponja', emoji: '🧽', hint: 'E de Esponja', effects: [{ type: 'item', item: 'esponja', amount: 1 }] },
  18: { name: 'Folhinhas', emoji: '🌿', hint: 'I de Iguana', effects: [{ type: 'item', item: 'folhas', amount: 1 }] },
  19: { name: 'Ovo', emoji: '🥚', hint: 'O de Ovo', effects: [{ type: 'item', item: 'ovo', amount: 1 }] },
  20: { name: 'Uva', emoji: '🍇', hint: 'U de Uva', effects: [{ type: 'item', item: 'uva', amount: 1 }] },
};

/** magia das cartas que não estão em CARD_MAGIC (ex.: cartas novas adicionadas à pasta) */
export const DEFAULT_MAGIC = {
  name: 'Surpresa mágica', emoji: '🎁', hint: 'O item de que seu bichinho mais precisa',
  effects: [{ type: 'surprise', amount: 1 }],
};

/** grupos do Livro de Magias (cartas fora dos grupos aparecem em "Outras cartas") */
export const CARD_GROUPS = [
  { id: 'animais', icon: '🐾', title: 'Cartas dos animais', rule: 'Magia na hora para o bichinho escolhido.', cards: [1, 2, 3, 4, 5] },
  { id: 'sinais', icon: '🤟', title: 'Sinais dos animais em LIBRAS', rule: 'A mesma magia para os 5 bichinhos de uma vez!', cards: [6, 7, 8, 9, 10] },
  { id: 'vogais', icon: '✋', title: 'Vogais em LIBRAS', rule: 'Magia em dobro: 2 itens para a mochila.', cards: [11, 12, 13, 14, 15] },
  { id: 'letras', icon: '🔤', title: 'Letras', rule: '1 item para a mochila.', cards: [16, 17, 18, 19, 20] },
];
