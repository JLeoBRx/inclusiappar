/**
 * Cronômetro da missão (carta sorteada → acerto).
 * Pode ser pausado — por exemplo quando o app vai para segundo plano —
 * para não prejudicar a pontuação.
 */
export class Stopwatch {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.accumulated = 0;
    this.startedAt = null;
  }

  start() {
    this.accumulated = 0;
    this.startedAt = this.now();
  }

  pause() {
    if (this.startedAt === null) return;
    this.accumulated += this.now() - this.startedAt;
    this.startedAt = null;
  }

  resume() {
    if (this.startedAt === null) this.startedAt = this.now();
  }

  get running() { return this.startedAt !== null; }

  /** Tempo decorrido em segundos. */
  get elapsed() {
    const live = this.startedAt === null ? 0 : this.now() - this.startedAt;
    return (this.accumulated + live) / 1000;
  }
}

/** 8.4 → "00:08" */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 4.23 → "4,2 s" */
export function formatSeconds(seconds) {
  return `${Math.max(0, seconds).toFixed(1).replace('.', ',')} s`;
}
