#!/usr/bin/env node
/**
 * Servidor estático mínimo para desenvolvimento e testes.
 *
 *   node tools/serve.mjs [porta] [pasta]
 *
 * - Serve a raiz do repositório por padrão (o app fica em /inclusiapp/).
 * - Responde requisições Range (206), necessárias para tocar vídeos no Safari.
 * - Envia os tipos MIME corretos para módulos JS, .mind, .glb, .webp e .mp4.
 *
 * Para testar a câmera em um celular é preciso HTTPS: publique no GitHub
 * Pages (veja o README) ou use um túnel HTTPS apontando para esta porta.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.mind': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} [opts.root]  pasta servida (padrão: raiz do repositório)
 * @param {{prefix: string, dir: string}[]} [opts.overlays]  (testes) arquivos que
 *        não existirem em `prefix` são procurados em `dir`
 */
export function startServer({ port = 8080, root, overlays = [] } = {}) {
  const base = resolve(root || join(fileURLToPath(import.meta.url), '..', '..'));
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let path = normalize(join(base, pathname));
    if (path !== base && !path.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    for (const { prefix, dir } of overlays) {
      if (!pathname.startsWith(prefix)) continue;
      const alt = normalize(join(base, dir, pathname.slice(prefix.length)));
      try {
        statSync(path);
      } catch {
        try {
          statSync(alt);
          path = alt;
        } catch { /* segue o 404 normal */ }
      }
    }
    let stat;
    try {
      stat = statSync(path);
      if (stat.isDirectory()) {
        path = join(path, 'index.html');
        stat = statSync(path);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    const headers = {
      'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : stat.size - +range[2];
      const end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') res.end();
      else createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(path).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +(process.argv[2] || 8080);
  const server = await startServer({ port, root: process.argv[3] });
  const { port: actual } = server.address();
  console.log(`Servindo em http://localhost:${actual}/inclusiapp/  (Ctrl+C para parar)`);
}
