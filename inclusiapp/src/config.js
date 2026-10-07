/**
 * CONFIGURAÇÃO CENTRAL — SinalizaAção: Animais em Voga
 *
 * Tudo o que liga página → alvo AR → animal → modelo 3D → vídeo de LIBRAS,
 * as regras de pontuação do jogo e os ajustes de AR ficam aqui.
 * Altere este arquivo para mudar o comportamento do app sem mexer no resto
 * do código.
 */

export const APP = {
  name: 'SinalizaAção',
  subtitle: 'Animais em Voga',
  version: '1.0.0',
  links: {
    store: 'https://loja.inclusivr.com.br/',
    site: 'http://inclusivr.com.br/',
  },
};

/**
 * LIVRO EM AR
 *
 * `target` é o índice do alvo dentro de assets/targets/paginas.mind, que segue
 * a numeração dos arquivos em /pag (Pagina1 → 0, Pagina2 → 1, ...).
 *
 * `scale`  tamanho do animal em relação à largura da página (1 = largura toda)
 * `lift`   altura acima da página (fração da largura), usada pela abelha que voa
 * `offset` deslocamento [x, y] sobre a página (fração da largura; +y = topo)
 */
export const ANIMALS = [
  {
    id: 'abelha',
    page: 1,
    target: 0,
    image: 'pag/Pagina1.png',
    name: 'Abelha',
    emoji: '🐝',
    model: 'assets/models/abelha.glb',
    video: 'videos/abelha.mp4',
    scale: 0.4,
    lift: 0.12,
    offset: [0, 0.05],
  },
  {
    id: 'elefante',
    page: 2,
    target: 1,
    image: 'pag/Pagina2.png',
    name: 'Elefante',
    emoji: '🐘',
    model: 'assets/models/elefante.glb',
    video: 'videos/elefante.mp4',
    scale: 0.5,
    lift: 0,
    offset: [0, 0],
  },
  {
    id: 'iguana',
    page: 3,
    target: 2,
    image: 'pag/Pagina3.png',
    name: 'Iguana',
    emoji: '🦎',
    model: 'assets/models/iguana.glb',
    video: 'videos/iguana.mp4',
    scale: 0.5,
    lift: 0,
    offset: [0, 0],
  },
  {
    id: 'onca',
    page: 4,
    target: 3,
    image: 'pag/Pagina4.png',
    name: 'Onça',
    emoji: '🐆',
    model: 'assets/models/onca.glb',
    video: 'videos/onca.mp4',
    scale: 0.55,
    lift: 0,
    offset: [0, 0],
  },
  {
    id: 'urso',
    page: 5,
    target: 4,
    image: 'pag/Pagina5.png',
    name: 'Urso',
    emoji: '🐻',
    model: 'assets/models/urso.glb',
    video: 'videos/urso.mp4',
    scale: 0.5,
    lift: 0,
    offset: [0, 0],
  },
];

export const BOOK = {
  targets: 'assets/targets/paginas', // .mind / .mind.gz / .json
  /** segundos sem encontrar página até mostrar a dica de aproximar/afastar */
  notFoundHintAfter: 8,
  /** Modo Interação: tamanho do animal na tela e limites do zoom (pinça) */
  interaction: {
    distance: 1.6, // distância da câmera (unidades da cena)
    size: 0.85, // tamanho do animal na frente da câmera
    minZoom: 0.45,
    maxZoom: 2.6,
    transitionMs: 650,
  },
};

/**
 * LIBRAS: chroma key calibrado para o fundo verde-limão dos vídeos.
 * O "score" de fundo de cada pixel é  s + hueWeight·h, onde
 *   s = (min(R,G) − B) / max(R,G,B)   (saturação amarelo-esverdeada)
 *   h = (G − R) / max(R,G,B)          (verde acima do vermelho)
 * Pixels com score acima de `high` ficam transparentes; abaixo de `low`, opacos.
 */
export const LIBRAS = {
  enabledByDefault: true,
  chroma: {
    hueWeight: 2.0,
    low: 0.24,
    high: 0.4,
    minLuma: 0.12, // pixels muito escuros (cabelo, camiseta) nunca são removidos
    despill: 0.75, // remove o reflexo verde na pele/cabelo
  },
  /** recorte do quadro do vídeo [x0, y0, x1, y1] (0..1) — tira bordas vazias */
  crop: [0.04, 0.0, 0.96, 1.0],
};

/**
 * JOGO DE CARTAS
 *
 * As cartas são lidas de assets/targets/cartas.json, gerado a partir da pasta
 * /cartas (carta1.png ... cartaN.png). Para adicionar/remover cartas basta
 * mudar os arquivos e rodar `npm run targets` (ou tools/compile-targets.html).
 *
 * `labels` é opcional: nomes usados em textos acessíveis e mensagens.
 * Cartas sem nome aparecem como "Carta N".
 */
export const GAME = {
  targets: 'assets/targets/cartas',
  labels: {
    1: 'Abelha',
    2: 'Elefante',
    3: 'Urso',
    4: 'Onça',
    5: 'Iguana',
    6: 'Abelha em LIBRAS',
    7: 'Elefante em LIBRAS',
    8: 'Iguana em LIBRAS',
    9: 'Onça em LIBRAS',
    10: 'Urso em LIBRAS',
    11: 'Letra A em LIBRAS',
    12: 'Letra E em LIBRAS',
    13: 'Letra I em LIBRAS',
    14: 'Letra O em LIBRAS',
    15: 'Letra U em LIBRAS',
    16: 'Letra A',
    17: 'Letra E',
    18: 'Letra I',
    19: 'Letra O',
    20: 'Letra U',
  },
  showLabels: true,

  scoring: {
    /** pontos por acerto */
    hitPoints: 100,
    /** pontos perdidos ao escanear a carta errada */
    wrongPenalty: 20,
    /** a pontuação nunca fica abaixo deste valor */
    minScore: 0,
    /**
     * Bônus de tempo (quanto mais rápido, maior):
     *  - 'linear': `max` pontos até `fullUntil` segundos, caindo até 0 em `zeroAt`
     *  - 'tiers' : faixas fixas; o padrão abaixo reproduz a tabela do jogo
     *              original em Unity (ARCombinationGameManager.cs)
     */
    timeBonus: {
      mode: 'linear',
      max: 100,
      fullUntil: 5,
      zeroAt: 40,
      tiers: [
        { upTo: 3, bonus: 100 },
        { upTo: 6, bonus: 70 },
        { upTo: 10, bonus: 40 },
        { upTo: Infinity, bonus: 10 },
      ],
    },
  },

  /** proteção contra penalidades repetidas pela mesma leitura errada */
  wrongScan: {
    /** intervalo mínimo entre duas penalidades (s) — no original era 1 s */
    globalCooldown: 1.5,
    /** a mesma carta errada só volta a penalizar depois deste tempo (s) */
    sameCardCooldown: 6,
    /** máximo de penalidades por carta sorteada */
    maxPerMission: 3,
  },

  /** tempos de transição, como no jogo original (s) */
  delayNextMission: 2,
  shuffleTime: 2,
};

/**
 * Ajustes do MindAR (rastreamento), filtro "One Euro" aplicado à pose:
 *  - filterMinCF: menor = mais estável parado (porém com mais atraso)
 *  - filterBeta : maior = acompanha melhor movimentos rápidos (porém treme mais)
 *  - warmupTolerance: quadros seguidos vendo a imagem até mostrá-la
 *  - missTolerance  : quadros sem ver a imagem até considerá-la perdida
 * Padrão do MindAR: 0.001 / 1000 / 5 / 5.
 */
export const AR = {
  camera: { width: 640, height: 480 },
  maxPixelRatio: 2,
  book: { filterMinCF: 0.001, filterBeta: 1, warmupTolerance: 4, missTolerance: 8 },
  game: { filterMinCF: 0.001, filterBeta: 1000, warmupTolerance: 3, missTolerance: 4 },
};
