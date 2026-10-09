/**
 * Efeitos visuais leves (sem bibliotecas): confete de comemoração.
 * Respeita "reduzir movimento" do sistema operacional.
 */
const COLORS = ['#f6c343', '#3ddc84', '#ff7a59', '#4fc3f7', '#c77dff', '#ffffff'];

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function confetti(host = document.body, count = 34) {
  if (prefersReducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('i');
    const angle = (Math.random() - 0.5) * Math.PI * 1.1;
    const dist = 140 + Math.random() * 260;
    piece.style.setProperty('--x', `${Math.sin(angle) * dist}px`);
    piece.style.setProperty('--y', `${-Math.cos(angle) * dist * 0.9 - 40}px`);
    piece.style.setProperty('--r', `${(Math.random() - 0.5) * 900}deg`);
    piece.style.setProperty('--d', `${0.9 + Math.random() * 0.7}s`);
    piece.style.background = COLORS[i % COLORS.length];
    if (i % 3 === 0) piece.style.borderRadius = '50%';
    layer.appendChild(piece);
  }
  host.appendChild(layer);
  setTimeout(() => layer.remove(), 1900);
}
