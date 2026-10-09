/**
 * 🏆 Recordes do ✋ Sinalize e Conte, salvos só neste aparelho (localStorage,
 * pelo mesmo `storage` tolerante a falhas do resto do app — nada vai para
 * servidor). Funções puras + load/save: testadas em Node.
 */

const KEY = 'signRecords';

export function emptyRecords() {
  return {
    bestScore: 0, // maior pontuação
    bestTime: null, // menor tempo total de uma partida completa (s)
    bestStreak: 0, // maior sequência de acertos seguidos
    matches: 0, // partidas completas
    signsCorrect: 0, // sinais reconhecidos (todas as partidas)
    countsCorrect: 0, // contagens certas de primeira (todas as partidas)
    lastScore: null,
    updatedAt: null,
  };
}

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Lê os recordes (valores inválidos voltam ao padrão). */
export function loadRecords(store) {
  const raw = store.get(KEY, null);
  const r = emptyRecords();
  if (!raw || typeof raw !== 'object') return r;
  r.bestScore = count(raw.bestScore);
  r.bestTime = Number.isFinite(raw.bestTime) && raw.bestTime > 0 ? raw.bestTime : null;
  r.bestStreak = count(raw.bestStreak);
  r.matches = count(raw.matches);
  r.signsCorrect = count(raw.signsCorrect);
  r.countsCorrect = count(raw.countsCorrect);
  r.lastScore = Number.isFinite(raw.lastScore) ? raw.lastScore : null;
  r.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  return r;
}

export function saveRecords(store, records) {
  store.set(KEY, records);
}

/**
 * Soma uma partida completa aos recordes.
 * Devolve { records, improved: { score, time, streak } } — sem alterar o original.
 */
export function applyMatch(records, summary, date = new Date()) {
  const next = { ...records };
  const improved = {
    score: summary.score > 0 && summary.score > records.bestScore,
    time: summary.seconds > 0 && (records.bestTime === null || summary.seconds < records.bestTime),
    streak: summary.bestStreak > records.bestStreak,
  };
  if (improved.score) next.bestScore = summary.score;
  if (improved.time) next.bestTime = summary.seconds;
  if (improved.streak) next.bestStreak = summary.bestStreak;
  next.matches = records.matches + 1;
  next.signsCorrect = records.signsCorrect + summary.signsCorrect;
  next.countsCorrect = records.countsCorrect + summary.countsCorrect;
  next.lastScore = summary.score;
  next.updatedAt = date.toISOString();
  return { records: next, improved };
}

/** 92.4 → "1min32s"; 8.2 → "8s" */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}min${String(s).padStart(2, '0')}s` : `${s}s`;
}
