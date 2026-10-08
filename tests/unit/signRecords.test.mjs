import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatch, emptyRecords, formatDuration, loadRecords, saveRecords } from '../../inclusiapp/src/sign/signRecords.js';

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
  };
}

const summary = (over = {}) => ({ score: 900, seconds: 92.4, bestStreak: 6, signsCorrect: 5, countsCorrect: 4, ...over });

test('sem nada salvo: recordes zerados', () => {
  const store = memoryStore();
  assert.deepEqual(loadRecords(store), emptyRecords());
});

test('primeira partida vira recorde de pontos, tempo e sequência', () => {
  const { records, improved } = applyMatch(emptyRecords(), summary(), new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(improved, { score: true, time: true, streak: true });
  assert.equal(records.bestScore, 900);
  assert.equal(records.bestTime, 92.4);
  assert.equal(records.bestStreak, 6);
  assert.equal(records.matches, 1);
  assert.equal(records.signsCorrect, 5);
  assert.equal(records.countsCorrect, 4);
  assert.equal(records.updatedAt, '2026-10-08T12:00:00.000Z');
});

test('só melhora o que foi superado; totais sempre somam', () => {
  const first = applyMatch(emptyRecords(), summary()).records;
  const { records, improved } = applyMatch(first, summary({ score: 700, seconds: 80, bestStreak: 3, signsCorrect: 4, countsCorrect: 5 }));
  assert.deepEqual(improved, { score: false, time: true, streak: false });
  assert.equal(records.bestScore, 900);
  assert.equal(records.bestTime, 80);
  assert.equal(records.bestStreak, 6);
  assert.equal(records.matches, 2);
  assert.equal(records.signsCorrect, 9);
  assert.equal(records.countsCorrect, 9);
  assert.equal(records.lastScore, 700);
  assert.equal(first.matches, 1, 'não altera o objeto original');
});

test('salva e lê de volta; dados corrompidos voltam ao padrão', () => {
  const store = memoryStore();
  const { records } = applyMatch(emptyRecords(), summary());
  saveRecords(store, records);
  assert.deepEqual(loadRecords(store), records);
  store.set('signRecords', { bestScore: -3, bestTime: 'x', bestStreak: 2.7, matches: null, signsCorrect: 'a' });
  const r = loadRecords(store);
  assert.equal(r.bestScore, 0);
  assert.equal(r.bestTime, null);
  assert.equal(r.bestStreak, 2);
  assert.equal(r.matches, 0);
  store.set('signRecords', 'lixo');
  assert.deepEqual(loadRecords(store), emptyRecords());
});

test('formatDuration: 1min32s, 8s', () => {
  assert.equal(formatDuration(92.4), '1min32s');
  assert.equal(formatDuration(8.2), '8s');
  assert.equal(formatDuration(60), '1min00s');
  assert.equal(formatDuration(null), '—');
});
