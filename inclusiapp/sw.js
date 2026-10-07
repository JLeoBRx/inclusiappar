/**
 * Service worker: deixa o app rápido em visitas seguintes e utilizável sem
 * internet depois do primeiro acesso.
 *
 *  - código e páginas (html/js/css/json): rede primeiro, cache como reserva
 *    → atualizações aparecem assim que publicadas;
 *  - arquivos pesados e estáveis (modelos, alvos, imagens, fontes): cache
 *    primeiro, atualizando em segundo plano;
 *  - vídeos (.mp4): sempre pela rede (o navegador cuida do streaming/Range).
 *
 * Ao publicar mudanças grandes, aumente VERSION para descartar caches antigos.
 */
const VERSION = 'v1';
const CODE_CACHE = `sinalizaacao-code-${VERSION}`;
const ASSET_CACHE = `sinalizaacao-assets-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [CODE_CACHE, ASSET_CACHE];
    for (const key of await caches.keys()) {
      if (key.startsWith('sinalizaacao-') && !keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const HEAVY = /\.(glb|mind|gz|webp|png|jpe?g|woff2)$/i;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/\.mp4$/i.test(url.pathname) || request.headers.has('range')) return;

  if (HEAVY.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then((res) => {
        if (res.ok && res.status === 200) cache.put(request, res.clone());
        return res;
      });
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CODE_CACHE);
    try {
      const res = await fetch(request);
      if (res.ok && res.status === 200) cache.put(request, res.clone());
      return res;
    } catch (err) {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      throw err;
    }
  })());
});
