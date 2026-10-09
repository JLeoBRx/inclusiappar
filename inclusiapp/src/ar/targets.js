/**
 * Carregamento dos alvos do MindAR (.mind).
 *
 * Cada conjunto (páginas, cartas) tem três arquivos gerados por
 * `npm run targets` / tools/compile-targets.html:
 *   <base>.json     manifesto: quantidade de alvos, tamanho e checksum do .mind
 *   <base>.mind.gz  o .mind comprimido (cerca de metade do tamanho)
 *   <base>.mind     o arquivo original, usado como reserva
 *
 * O .mind.gz é descomprimido no navegador (DecompressionStream). Se o
 * navegador não suportar, ou se o .gz não corresponder ao manifesto (ficou
 * desatualizado), baixa o .mind.
 */

const cache = new Map();

/** FNV-1a 32 bits (o mesmo do compilador) */
export function checksum(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function readAll(response, onProgress) {
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!response.body || !total || !onProgress) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function matches(bytes, manifest) {
  return !manifest || (bytes.length === manifest.bytes && checksum(bytes) === manifest.checksum);
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res;
}

async function load(base, onProgress) {
  let manifest = null;
  try {
    manifest = await (await fetchOk(`${base}.json`)).json();
  } catch (err) {
    console.warn(`[alvos] manifesto ${base}.json indisponível; seguindo sem verificação`, err);
  }
  // o checksum na URL evita usar uma versão antiga guardada em cache
  const version = manifest?.checksum ? `?v=${manifest.checksum}` : '';

  if (typeof DecompressionStream === 'function') {
    try {
      let bytes = await readAll(await fetchOk(`${base}.mind.gz${version}`), onProgress);
      // alguns servidores já entregam o .gz descomprimido (Content-Encoding)
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
      if (matches(bytes, manifest)) return { bytes, manifest };
      console.warn(`[alvos] ${base}.mind.gz não corresponde ao manifesto; usando ${base}.mind`);
    } catch (err) {
      console.warn(`[alvos] falha no ${base}.mind.gz; usando ${base}.mind`, err);
    }
  }
  const bytes = await readAll(await fetchOk(`${base}.mind${version}`), onProgress);
  if (!matches(bytes, manifest)) {
    console.warn(`[alvos] ${base}.mind difere do manifesto — recompile com "npm run targets".`);
  }
  return { bytes, manifest };
}

/**
 * Carrega (uma única vez) um conjunto de alvos. Vários chamadores podem
 * acompanhar o progresso do mesmo download.
 * @returns {Promise<{bytes: Uint8Array, manifest: object|null}>}
 */
export function loadTargets(base, { onProgress } = {}) {
  let entry = cache.get(base);
  if (!entry) {
    const listeners = new Set();
    let last = 0;
    const report = (p) => {
      last = p;
      listeners.forEach((fn) => fn(p));
    };
    entry = { listeners, progress: () => last };
    entry.promise = load(base, report).catch((err) => {
      cache.delete(base);
      throw err;
    });
    entry.promise.finally(() => listeners.clear()).catch(() => {});
    cache.set(base, entry);
  }
  if (onProgress) {
    entry.listeners.add(onProgress);
    onProgress(entry.progress());
  }
  return entry.promise;
}

/** Inicia o download em segundo plano (ex.: enquanto a pessoa lê as instruções). */
export function prefetchTargets(base) {
  loadTargets(base).catch(() => {});
}
