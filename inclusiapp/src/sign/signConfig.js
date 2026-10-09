/**
 * ✋ SINALIZE E CONTE — configuração central do Jogo 3 da Sala de Jogos.
 *
 *   carta sorteada → 📷 escanear a carta → ✋ fazer o sinal (MediaPipe)
 *   → 🐾 aparecem 1, 2 ou 3 animais → 🔢 contar → ⭐ pontos
 *
 * Tudo o que liga vogal → carta → animal, as regras de pontuação, os tempos
 * e os ajustes do reconhecimento de mãos fica aqui: mude este arquivo para
 * alterar o jogo sem mexer no resto do código.
 */

export const SIGN_GAME = {
  /** rodadas por partida (cada vogal aparece uma vez por partida) */
  rounds: 5,

  /**
   * As 5 vogais do jogo (só as cartas das vogais em LIBRAS).
   *   card    número da carta (arquivo cartas/cartaN.png) com o sinal em LIBRAS
   *   animal  id do animal (ANIMALS em src/config.js) que aparece para contar
   *   plural  nome usado na pergunta: "Quantas abelhas apareceram?"
   *   male    true para "Quantos", false para "Quantas"
   *
   * Cada vogal é a inicial do seu animal: A de Abelha, E de Elefante,
   * I de Iguana, O de Onça e U de Urso. Para trocar um animal, basta mudar
   * `animal`, `plural` e `male` da vogal.
   */
  vowels: [
    { letter: 'A', card: 11, animal: 'abelha', plural: 'abelhas', male: false },
    { letter: 'E', card: 12, animal: 'elefante', plural: 'elefantes', male: true },
    { letter: 'I', card: 13, animal: 'iguana', plural: 'iguanas', male: false },
    { letter: 'O', card: 14, animal: 'onca', plural: 'onças', male: false },
    { letter: 'U', card: 15, animal: 'urso', plural: 'ursos', male: true },
  ],

  /** quantos animais podem aparecer para contar (e os botões de resposta) */
  animals: { min: 1, max: 3 },

  /**
   * PONTUAÇÃO — quanto mais rápido e preciso, mais pontos.
   *   sign   sinal correto: `points` + bônus pelo Tempo 1
   *          (de "✋ Faça o sinal" até o MediaPipe reconhecer o sinal certo;
   *          errar o sinal não tira pontos, mas o tempo continua correndo)
   *   count  contagem correta: `points` + bônus pelo Tempo 2
   *          (de quando os animais aparecem até a resposta certa)
   * Faixas: o bônus da primeira faixa com tempo ≤ `upTo` segundos.
   */
  scoring: {
    sign: {
      points: 100,
      speed: {
        mode: 'tiers',
        tiers: [
          { upTo: 2, bonus: 50 },
          { upTo: 4, bonus: 30 },
          { upTo: 6, bonus: 15 },
          { upTo: Infinity, bonus: 5 },
        ],
      },
    },
    count: {
      points: 50,
      speed: {
        mode: 'tiers',
        tiers: [
          { upTo: 1, bonus: 30 },
          { upTo: 2, bonus: 20 },
          { upTo: 4, bonus: 10 },
          { upTo: Infinity, bonus: 0 },
        ],
      },
    },
  },

  /** classificação no fim da partida: fração da pontuação máxima possível */
  ranks: [
    { min: 0.75, medal: '🥇', title: 'Excelente!' },
    { min: 0.5, medal: '🥈', title: 'Muito bem!' },
    { min: 0, medal: '🥉', title: 'Continue praticando!' },
  ],

  /** tempos da interface */
  timing: {
    shuffleMs: 1500, // "roleta" ao sortear a carta
    revealMs: 1800, // carta sorteada em destaque (toque para pular)
    celebrateMs: 1300, // comemoração do sinal certo, antes dos animais
    animalGapMs: 450, // intervalo entre um animal e o próximo aparecer
    nextRoundMs: 2200, // depois da contagem certa, até a próxima rodada
    skipScanAfter: 8, // s até oferecer "fazer o sinal sem escanear"
    skipSignAfter: 15, // s até oferecer "pular este sinal"
  },

  /**
   * RECONHECIMENTO DO SINAL (MediaPipe Hand Landmarker + src/sign/handSigns.js)
   *   fps          análises da câmera por segundo (menos = menos bateria)
   *   minScore     nota mínima (0 … 1) para considerar que a mão faz uma vogal
   *   holdMs       tempo segurando o sinal certo até ele ser aceito
   *   wrongMs      tempo mostrando OUTRO sinal até aparecer "❌ Sinal incorreto"
   *   unknownMs    tempo com a mão na câmera sem nenhum sinal reconhecível até o aviso
   *   cooldownMs   intervalo mínimo entre dois avisos de sinal incorreto
   *   lostMs       se a mão some por mais que isso, a contagem recomeça
   *   smoothing    peso de cada novo quadro na média das notas (0 … 1)
   *   delegate     'GPU' (mais rápido) ou 'CPU' — se a GPU falhar, usa a CPU
   */
  recognition: {
    fps: 12,
    numHands: 2,
    minScore: 0.5,
    holdMs: 700,
    wrongMs: 1600,
    unknownMs: 3200,
    cooldownMs: 2600,
    lostMs: 800,
    smoothing: 0.45,
    delegate: 'GPU',
    minDetectionConfidence: 0.5,
    minPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },
};

/** Vogal pela letra ('A' … 'U'). */
export function vowelByLetter(letter) {
  return SIGN_GAME.vowels.find((v) => v.letter === letter) || null;
}

/** Vogal pelo número da carta (11 … 15), ou null se a carta não é de vogal. */
export function vowelByCard(card) {
  return SIGN_GAME.vowels.find((v) => v.card === card) || null;
}

/** "Quantas abelhas apareceram?" */
export function countQuestion(vowel) {
  return `${vowel.male ? 'Quantos' : 'Quantas'} ${vowel.plural} apareceram?`;
}
