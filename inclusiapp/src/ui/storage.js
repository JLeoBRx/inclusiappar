/**
 * localStorage tolerante a falhas (modo privado, armazenamento bloqueado):
 * se não der para salvar, o app continua funcionando sem lembrar preferências.
 */
const PREFIX = 'sinalizaacao:';

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch { /* sem armazenamento: ignora */ }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch { /* ignora */ }
  },
};
