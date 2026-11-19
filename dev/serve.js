// Dev-only static file server (zero dependencies), so dev/index.html can load
// the engine as ES modules. Not part of the game.
//
// Usage (from the project root):  node dev/serve.js [port]
// Then open:                      http://localhost:8080/dev/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') {
      res.writeHead(302, { Location: '/dev/' }).end();
      return;
    }
    let filePath = normalize(join(root, urlPath));
    // Never serve anything outside the project folder.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if ((await stat(filePath)).isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(302, { Location: `${urlPath}/` }).end();
        return;
      }
      filePath = join(filePath, 'index.html');
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Dev page: http://localhost:${port}/dev/`);
});
